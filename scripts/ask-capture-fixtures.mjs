#!/usr/bin/env node
// scripts/ask-capture-fixtures.mjs
// Capture REAL claude stream-json fixtures for the Ask Worca reducer tests
// (ask-worca-design.md §12): seven scenarios through the exact sandbox recipe,
// SANITISED (home paths, uuids, message/tool/agent ids, timestamps, secrets) and
// written to test/fixtures/ask/<name>.jsonl + <name>.meta.json. Re-running
// replaces the set. Spends money (haiku, < $0.30) and needs `claude` 2.1.239.
//
//   node --disable-warning=ExperimentalWarning scripts/ask-capture-fixtures.mjs [--only <name>] [--model <id>] [--out <dir>]
//
// Capture-time assertions make this an automated slice of the manual gate: the
// recipe (no plugins/skills/hooks, worca connected, Task + mcp__worca__* only),
// the FOREGROUND sub-agent shape (probe F1/F3) and the exit-1 limit shapes (F5).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { redactAskText } from '../src/core/ask/redact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ── sanitiser (pure; unit-tested) ──────────────────────────────────────────
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{home:string, base:string, repo:string, tmp:string}} roots  longest paths are replaced first
 * @param {{redact?: (s:string)=>string}} [opts]
 * @returns {(line:string)=>string}  SYNCHRONOUS; throws on non-JSON input, on a plugin marker, or when the result is not JSON
 */
export function createSanitizer(roots, { redact = redactAskText } = {}) {
  const uuids = new Map();
  const msgs = new Map();
  const tools = new Map();
  const agents = new Map();
  const mapped = (map, key, fmt) => { if (!map.has(key)) map.set(key, fmt(map.size + 1)); return map.get(key); };
  const pathRules = Object.entries({ realBase: '/WORCA_BASE', base: '/WORCA_BASE', repo: '/REPO', home: '/HOME', realTmp: '/TMP', tmp: '/TMP' })
    .filter(([k]) => roots[k])
    .sort((a, b) => roots[b[0]].length - roots[a[0]].length)
    .map(([k, placeholder]) => [new RegExp(escapeRe(roots[k]), 'g'), placeholder]);
  return function sanitizeFixtureLine(line) {
    let out = String(line);
    try { JSON.parse(out); } catch { throw new Error('line is not JSON'); }
    if (/plugin:[A-Za-z0-9_-]/.test(out)) throw new Error('recipe violation: a plugin name reached the capture');
    for (const [re, placeholder] of pathRules) out = out.replace(re, placeholder);
    out = out.replace(/\/tmp\/cc-socks\/\d+\.sock/g, '/tmp/cc-socks/0.sock');
    out = out.replace(UUID_RE, (u) => (u === ZERO_UUID ? u : mapped(uuids, u.toLowerCase(), (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)));
    out = out.replace(/\bmsg_[A-Za-z0-9]{6,}\b/g, (m) => mapped(msgs, m, (n) => `msg_${String(n).padStart(4, '0')}`));
    out = out.replace(/\btoolu_[A-Za-z0-9]{6,}\b/g, (t) => mapped(tools, t, (n) => `toolu_${String(n).padStart(4, '0')}`));
    out = out.replace(/"agentId":"([A-Za-z0-9_-]+)"/g, (_, id) => `"agentId":"${mapped(agents, id, (n) => `agent_${String(n).padStart(2, '0')}`)}"`);
    out = out.replace(/"signature":"[^"]*"/g, '"signature":""');
    out = out.replace(TS_RE, '2026-01-01T00:00:00.000Z');
    let obj;
    try { obj = JSON.parse(out); } catch { throw new Error('sanitised line is not JSON'); }
    if (redact) obj = redactStrings(obj, redact);                   // per string VALUE — never over the serialised line: a `token=` match would eat the JSON
    return JSON.stringify(obj);
  };
}

/** Apply `fn` to every string VALUE of a JSON tree (keys untouched). */
function redactStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => redactStrings(x, fn));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = redactStrings(x, fn); return o; }
  return v;
}

// ── scenarios ──────────────────────────────────────────────────────────────
const hasMain = (frames, pred) => frames.some((f) => (f.parent_tool_use_id ?? null) === null && pred(f));
const mainToolUses = (frames) => frames.filter((f) => f.type === 'assistant' && (f.parent_tool_use_id ?? null) === null)
  .flatMap((f) => (Array.isArray(f.message?.content) ? f.message.content : []).filter((c) => c?.type === 'tool_use'));
const toolResult = (frames, id) => frames.find((f) => f.type === 'user' && (f.parent_tool_use_id ?? null) === null
  && Array.isArray(f.message?.content) && f.message.content.some((c) => c?.type === 'tool_result' && c.tool_use_id === id));
const lastResult = (frames) => [...frames].reverse().find((f) => f.type === 'result');

export const SCENARIOS = [
  { name: 'plain-text', prompt: 'Reply with exactly the single word: pong',
    check: (f) => { const r = lastResult(f); if (!r || r.subtype !== 'success') throw new Error('expected result.subtype success');
      if (!hasMain(f, (x) => x.type === 'stream_event' && x.event?.type === 'content_block_delta' && x.event.delta?.type === 'text_delta')) throw new Error('no main-stream text delta');
      if (!hasMain(f, (x) => x.type === 'assistant' && x.message?.content?.some((c) => c.type === 'text'))) throw new Error('no assistant text block');
      if (mainToolUses(f).length) throw new Error('unexpected tool use'); } },
  { name: 'tool-list-runs', prompt: 'Call the list_runs tool exactly once with input {} and then answer with only the number of runs it returned.',
    check: (f) => { const t = mainToolUses(f); if (t.length !== 1 || t[0].name !== 'mcp__worca__list_runs') throw new Error(`expected exactly one list_runs call, got ${t.map((x) => x.name)}`);
      const r = toolResult(f, t[0].id); if (!r) throw new Error('no tool_result'); const c = r.message.content.find((x) => x.tool_use_id === t[0].id); if (c.is_error) throw new Error('list_runs errored');
      if (lastResult(f)?.subtype !== 'success') throw new Error('expected success'); } },
  { name: 'task-subagent', prompt: 'Use the Task tool once (subagent_type "general-purpose", description "count runs") and instruct the sub-agent to call list_runs with {} and report only the count. CAPTURE-SECRET-7f3a must not be repeated. Then answer with only that count.',
    check: (f) => { const t = mainToolUses(f).filter((x) => x.name === 'Task' || x.name === 'Agent'); if (t.length !== 1) throw new Error(`expected one Task/Agent spawn, got ${t.length}`);
      const r = toolResult(f, t[0].id); if (!r) throw new Error('no finishing tool_result'); const tur = r.tool_use_result;
      if (!tur || typeof tur !== 'object' || Array.isArray(tur) || !tur.agentId || tur.isAsync) throw new Error('sub-agent did not finish in the FOREGROUND shape (probe F1: set CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1)');
      if (!tur.usage || typeof tur.totalTokens !== 'number') throw new Error('tool_use_result lacks usage/totalTokens (F3)');
      if (!f.some((x) => x.parent_tool_use_id === t[0].id)) throw new Error('no child frames');
      if (f.filter((x) => x.type === 'system' && x.subtype === 'init').length !== 1) throw new Error('second system/init: background mode');
      if (f.filter((x) => x.type === 'result').length !== 1) throw new Error('two result frames: background mode'); } },
  { name: 'propose-run', promptFor: (ctx) => `Call propose_run with projectKey "${ctx.projectKey}", workflowId "wf_default", brief "Add a README badge for the test status" and guardrailsId "normal"; then answer with only the word proposed.`,
    check: (f) => { const t = mainToolUses(f); const p = t.find((x) => x.name === 'mcp__worca__propose_run'); if (!p) throw new Error('no propose_run call');
      const r = toolResult(f, p.id); const c = r?.message.content.find((x) => x.tool_use_id === p.id); const text = Array.isArray(c?.content) ? c.content.map((x) => x.text).join('') : c?.content;
      if (!JSON.parse(text || '{}').ok) throw new Error(`propose_run did not return ok:true: ${text}`); } },
  { name: 'max-turns', prompt: 'Call the list_runs tool with input {}, then call it again with input {"limit":1}, then reply.', maxTurns: 1,
    check: (f, meta) => { const r = lastResult(f); if (r?.subtype !== 'error_max_turns') throw new Error(`expected error_max_turns, got ${r?.subtype}`); meta.expect = { subtype: r.subtype, exitCode: meta.exitCode }; } },
  { name: 'max-budget', prompt: 'Call the list_runs tool with input {}, then call it again with input {"limit":1}, then reply.', maxBudgetUsd: 0.0001,
    check: (f, meta) => { const r = lastResult(f); if (r?.subtype !== 'error_max_budget_usd') throw new Error(`expected error_max_budget_usd, got ${r?.subtype}`); meta.expect = { subtype: r.subtype, exitCode: meta.exitCode }; } },
  { name: 'bogus-resume', prompt: 'Reply with exactly the single word: pong', resume: ZERO_UUID,
    check: (f, meta) => { const r = lastResult(f); if (!r || !/No conversation found/.test((r.errors || []).join(' '))) throw new Error('expected the No-conversation-found result');
      if (meta.exitCode !== 1 || !meta.error) throw new Error('expected a rejection with exit code 1');
      if (f.some((x) => x.type === 'assistant')) throw new Error('an assistant frame means a model call was made'); } },
];

// ── main ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { only: null, model: 'claude-haiku-4-5', out: join(REPO, 'test', 'fixtures', 'ask') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') out.only = argv[++i];
    else if (argv[i] === '--model') out.model = argv[++i];
    else if (argv[i] === '--out') out.out = resolve(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mock = process.env.WORCA_MOCK ?? process.env.ORCH_MOCK;
  if (mock && mock !== '0' && mock.toLowerCase() !== 'false') throw new Error('refusing to capture under WORCA_MOCK — this script needs the real claude CLI');
  const base = mkdtempSync(join(tmpdir(), 'worca-ask-capture-'));
  process.env.WORCA_HOME = base;                                   // before the first getDb() — the core reads it lazily
  const { runClaude } = await import('../src/core/claude-runner.mjs');
  const { resolveModelEnv } = await import('../src/core/config.mjs');
  const { worcaHome, addProject } = await import('../src/core/projects.mjs');
  const { seedPipeline } = await import('../test/helpers/db-seed.mjs');
  const { createThread } = await import('../src/core/ask/store.mjs');
  const { buildCatalog } = await import('../src/core/ask/catalog.mjs');
  const { buildSystemPrompt } = await import('../src/core/ask/prompt.mjs');
  const { buildAskSpawnOptions, buildMcpConfig, ASK_MCP_SERVER_PATH } = await import('../src/core/ask/spawn.mjs');

  // seed: one project with one finished run carrying a 3-file diff (one protected file)
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-ask-capture-proj-'));
  const [project] = await addProject({ name: 'capture-demo', path: projectDir });
  const seeded = await seedPipeline(projectDir, { title: 'Seeded run', status: 'done', prompt: 'Add a README badge', branch: { source: 'main', feature: 'worca-cc/seeded-run' } });
  await writeFile(join(seeded.dir, 'diff-patch.patch'), [
    'diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md', '@@ -1 +1,2 @@', ' # demo', '+badge',
    'diff --git a/.env b/.env', '--- /dev/null', '+++ b/.env', '@@ -0,0 +1 @@', '+TOKEN=sk-ant-api03-capturecapturecapturecapture',
    'diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1 +1 @@', '-old', '+new', '',
  ].join('\n'), 'utf8');

  const thread = createThread({ model: args.model, effort: 'medium' });
  const scratchDir = join(worcaHome(), 'tmp', 'ask');
  mkdirSync(scratchDir, { recursive: true });
  const mcpConfigPath = join(scratchDir, 'mcp-capture.json');
  writeFileSync(mcpConfigPath, JSON.stringify(buildMcpConfig({ homeBase: base, threadId: thread.id, serverPath: ASK_MCP_SERVER_PATH }), null, 2));
  const systemPrompt = buildSystemPrompt(await buildCatalog());
  const roots = { home: homedir(), base, repo: REPO, tmp: tmpdir(), realBase: realpathSync(base), realTmp: realpathSync(tmpdir()) };   // macOS: /var → /private/var
  mkdirSync(args.out, { recursive: true });

  const ctx = { projectKey: project.key };
  let totalCost = 0;
  const rows = [];
  const MAX_ATTEMPTS = 3;                                            // haiku is not deterministic: "Task once" sometimes yields two spawns
  const FATAL = /recipe violation|FOREGROUND|no system\/init|worca MCP not connected|unexpected tools|hook frames/;

  /** One claude turn through the real recipe → { frames, stderr, meta }. Never throws on a runner rejection (recorded in meta). */
  async function captureOnce(sc) {
    const prompt = sc.promptFor ? sc.promptFor(ctx) : sc.prompt;
    const frames = [];
    const stderr = [];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    const meta = { scenario: sc.name, prompt, model: args.model, exitCode: null, error: null, stderr, flags: { maxTurns: sc.maxTurns ?? 6, maxBudgetUsd: sc.maxBudgetUsd ?? 1, resume: sc.resume ?? null }, captured: new Date().toISOString(), claudeVersion: null };
    const options = buildAskSpawnOptions({
      thread: { id: thread.id, sessionId: sc.resume ?? null },
      turn: { prompt, systemPrompt, model: args.model, effort: 'medium', modelEnv: resolveModelEnv(args.model), signal: ac.signal,
        onEvent: (e) => { if (e.type === 'stderr') stderr.push(e.text); else if (e.raw && typeof e.raw === 'object') frames.push(e.raw); } },
      limits: { maxTurns: meta.flags.maxTurns, maxBudgetUsd: meta.flags.maxBudgetUsd },
      mcpConfigPath, scratchDir,
    });
    try {
      const r = await runClaude(options);
      meta.exitCode = r.exitCode;
    } catch (err) {
      const m = /exited with code (\d+)/.exec(err.message);
      meta.exitCode = m ? Number(m[1]) : 1;
      meta.error = err.message;
    } finally { clearTimeout(timer); }
    return { frames, stderr, meta };
  }

  /** The recipe assertions (an automated slice of the manual gate) + the scenario's own check. Throws on violation. */
  function verify(sc, frames, meta) {
    const init = frames.find((f) => f.type === 'system' && f.subtype === 'init');
    if (init) {
      meta.claudeVersion = init.claude_code_version ?? null;
      meta.initTools = init.tools; meta.initMcpServers = init.mcp_servers;
      if ((init.plugins || []).length || (init.skills || []).length) throw new Error(`${sc.name}: recipe violation — plugins/skills loaded`);
      if (JSON.stringify(init.mcp_servers) !== JSON.stringify([{ name: 'worca', status: 'connected' }])) throw new Error(`${sc.name}: worca MCP not connected: ${JSON.stringify(init.mcp_servers)}`);
      if (!(init.tools || []).every((t) => t === 'Task' || t.startsWith('mcp__worca__'))) throw new Error(`${sc.name}: unexpected tools ${init.tools}`);
    } else if (sc.name !== 'bogus-resume') throw new Error(`${sc.name}: no system/init frame`);
    if (frames.some((f) => f.type === 'system' && /^hook_/.test(f.subtype || ''))) throw new Error(`${sc.name}: hook frames present`);
    sc.check(frames, meta);
  }

  try {
    for (const sc of SCENARIOS) {
      if (args.only && sc.name !== args.only) continue;
      let captured = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const c = await captureOnce(sc);
        const r = lastResult(c.frames);
        if (r && typeof r.total_cost_usd === 'number') totalCost += r.total_cost_usd;   // every attempt is paid for
        try {
          verify(sc, c.frames, c.meta);
          captured = c;
          break;
        } catch (err) {
          if (FATAL.test(err.message) || attempt === MAX_ATTEMPTS) throw err;          // recipe problems never retry; model flakiness does
          console.warn(`[ask-capture] ${sc.name}: ${err.message} — retrying (${attempt}/${MAX_ATTEMPTS})`);
        }
      }
      const { frames, stderr, meta } = captured;
      const sanitize = createSanitizer(roots);                        // per scenario: id numbering restarts in every file
      const r = lastResult(frames);
      const lines = frames.map((f) => sanitize(JSON.stringify(f)));
      writeFileSync(join(args.out, `${sc.name}.jsonl`), lines.join('\n') + '\n', 'utf8');
      meta.stderr = stderr.map((l) => JSON.parse(sanitize(JSON.stringify(l))));
      if (meta.error) meta.error = JSON.parse(sanitize(JSON.stringify(meta.error)));
      writeFileSync(join(args.out, `${sc.name}.meta.json`), JSON.stringify(meta, null, 2) + '\n', 'utf8');
      rows.push([sc.name, frames.length, meta.exitCode, r?.subtype ?? '-', r?.total_cost_usd ?? '-']);
      console.log(`captured ${sc.name}: ${frames.length} frames, exit ${meta.exitCode}, ${r?.subtype ?? '-'}`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });                  // always: a failed run must not leak the temp home / project
    rmSync(projectDir, { recursive: true, force: true });
  }
  console.table(rows.map(([name, frames, exit, subtype, cost]) => ({ name, frames, exit, subtype, cost })));
  console.log(`total cost ≈ $${totalCost.toFixed(4)} (all attempts); fixtures in ${args.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`[ask-capture] ${err && err.stack ? err.stack : err}`); process.exit(1); });
}
