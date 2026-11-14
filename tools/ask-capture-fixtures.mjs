#!/usr/bin/env node
// tools/ask-capture-fixtures.mjs
// Capture REAL claude stream-json fixtures for the Ask Worca reducer tests
// (ask-worca-design.md §12): seven scenarios through the exact sandbox recipe,
// SANITISED (home paths, uuids, message/tool/agent ids, timestamps, secrets) and
// written to test/fixtures/ask/<name>.jsonl + <name>.meta.json. Re-running
// replaces the set. Spends money (haiku, < $0.30) and needs `claude` 2.1.239.
// Design P2 probes (recipe 'design': R1 long Write chunking, R17 overwrite, R18
// edit splitting) run only by name with --only, and default to test/fixtures/design.
//
//   node --disable-warning=ExperimentalWarning tools/ask-capture-fixtures.mjs [--only <name>] [--model <id>] [--out <dir>]
//
// HARD GATE: this is the only code in the repo that spawns the real claude CLI,
// so it refuses to run unless WORCA_ALLOW_LIVE_CLAUDE=1 is set by hand. Nothing
// in `npm test`, the smoke scripts, the hooks or CI sets it — a stray
// `npm run ask:fixtures` fails before a single process is spawned.
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
const resultText = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((x) => x?.type === 'text').map((x) => x.text).join('') : null);

// ── Design P2 probe (R1, R17, R18) ─────────────────────────────────────────
// recipe 'design': a builder-shaped spawn in a scratch folder, never part of a bare capture (selectScenarios).
// The six C-2 builder rules, as the design-many-edits probe gives them (a failed R18 probe tightens rule 1 here first).
const DESIGN_BUILDER_RULES = [
  '1. Write `index.html` in one `Write`, top-down in visual order, one root.',
  '2. Then `style.css`.',
  '3. Then `script.js` if the plan asks.',
  '4. Asset URLs relative to work/ (`assets/x.png`).',
  '5. No external URLs.',
  '6. End with one line, used as the `.crew.json` summary.',
];
const DESIGN_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const DESIGN_SYSTEM_PROMPT = 'You build one web page section. Follow the request exactly.';
// The input field whose first byte is "first content" for the R1 latency.
const CONTENT_FIELD = { Write: 'content', Edit: 'new_string' };

/** Whole Write/Edit calls per `file_path` on the main thread (R18), each tool_use id counted once. */
function writesPerPathOf(frames) {
  const out = {};
  const seen = new Set();
  for (const t of mainToolUses(frames)) {
    if ((t.name !== 'Write' && t.name !== 'Edit') || seen.has(t.id)) continue;
    seen.add(t.id);
    const p = t.input?.file_path;
    if (typeof p !== 'string' || !p) continue;
    const row = (out[p] ??= { write: 0, edit: 0 });
    if (t.name === 'Write') row.write += 1; else row.edit += 1;
  }
  return out;
}

/**
 * How each main-thread tool_use block's input streamed in (R1). `arrivals[i]` is the ms at which `frames[i]` arrived.
 * `spreadRatio = (t90 - t10) / blockMs`, where t10 and t90 are the arrivals by which 10% and 90% of the block's BYTES
 * had arrived: byte weighting, because an early `file_path` chunk followed by a held value looks gradual by chunk
 * count (L2.18). Empty chunks do not count. `firstContentMs` is the arrival of the first byte of the content value
 * (`Write.content`, `Edit.new_string`). A block cut off before its stop ends at its last chunk.
 * @param {object[]} frames  raw stream-json frames
 * @param {number[]} [arrivals]
 * @returns {{tools:{toolUseId:string|null,name:string|null,chunks:number,bytes:number,blockMs:number|null,largestGapMs:number|null,spreadRatio:number|null,firstContentMs:number|null}[], writesPerPath:Record<string,{write:number,edit:number}>}}
 */
export function toolInputChunkStats(frames, arrivals = []) {
  const tools = [];
  const open = new Map();                                            // content-block index → its block, while it streams
  const at = (i) => (Number.isFinite(arrivals[i]) ? arrivals[i] : null);
  const finish = ({ rec, startMs, chunks }, endMs) => {
    const bytes = chunks.reduce((n, c) => n + c.bytes, 0);
    rec.chunks = chunks.length;
    rec.bytes = bytes;
    const marks = [startMs, ...chunks.map((c) => c.ms), endMs];
    if (!marks.every(Number.isFinite)) return;                       // no arrival times: counts only
    rec.blockMs = endMs - startMs;
    rec.largestGapMs = marks.slice(1).reduce((g, ms, i) => Math.max(g, ms - marks[i]), 0);
    if (bytes > 0) {
      let cum = 0;
      let t10 = null;
      let t90 = null;
      for (const c of chunks) {
        cum += c.bytes;
        if (t10 === null && cum * 10 >= bytes) t10 = c.ms;
        if (t90 === null && cum * 10 >= bytes * 9) t90 = c.ms;
      }
      rec.spreadRatio = rec.blockMs > 0 ? (t90 - t10) / rec.blockMs : 0;
    }
    const field = CONTENT_FIELD[rec.name];
    if (field) {
      const re = new RegExp(`"${field}"\\s*:\\s*"[^"]`);
      let text = '';
      for (const c of chunks) { text += c.text; if (re.test(text)) { rec.firstContentMs = c.ms; break; } }
    }
  };
  frames.forEach((f, i) => {
    if (f?.type !== 'stream_event' || (f.parent_tool_use_id ?? null) !== null) return;
    const ev = f.event;
    if (ev?.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      const rec = { toolUseId: ev.content_block.id ?? null, name: ev.content_block.name ?? null, chunks: 0, bytes: 0, blockMs: null, largestGapMs: null, spreadRatio: null, firstContentMs: null };
      tools.push(rec);
      open.set(ev.index, { rec, startMs: at(i), chunks: [] });
    } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
      const b = open.get(ev.index);
      const s = typeof ev.delta.partial_json === 'string' ? ev.delta.partial_json : '';
      if (b && s) b.chunks.push({ ms: at(i), bytes: Buffer.byteLength(s, 'utf8'), text: s });
    } else if (ev?.type === 'content_block_stop' && open.has(ev.index)) {
      finish(open.get(ev.index), at(i));
      open.delete(ev.index);
    }
  });
  for (const b of open.values()) finish(b, b.chunks.length ? b.chunks[b.chunks.length - 1].ms : b.startMs);
  return { tools, writesPerPath: writesPerPathOf(frames) };
}

/** R1 verdict for one tool's stats: spread 0.5 or more is gradual, less is coarse, no bytes is unknown. */
export function probeVerdict(toolStat) {
  const r = toolStat?.spreadRatio;
  if (typeof r !== 'number' || !Number.isFinite(r)) return 'unknown';
  return r >= 0.5 ? 'gradual' : 'coarse';
}

/** `--only` picks that one scenario; a bare capture takes every scenario but the paid design probes. */
export function selectScenarios(all, { only = null } = {}) {
  return only ? all.filter((s) => s.name === only) : all.filter((s) => s.recipe !== 'design');
}

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
  // R1: does a long Write.content arrive gradually? The verdict is in meta.toolInput.
  { name: 'design-long-write', recipe: 'design', timeoutMs: 300_000, maxBudgetUsd: 2,
    prompt: 'Use the Write tool once to create page.html in the current folder: a complete landing page of at least 20000 characters with one root element and no external URLs. Then reply with one line.',
    check: (f) => { const sizes = mainToolUses(f).filter((t) => t.name === 'Write' && typeof t.input?.content === 'string').map((t) => t.input.content.length);
      if (!sizes.some((n) => n >= 15000)) throw new Error(`expected a Write whose content has at least 15000 characters, got [${sizes}]`); } },
  // R17: is a Write over an existing, unread file refused? Recorded, never thrown.
  { name: 'design-overwrite-no-read', recipe: 'design', timeoutMs: 300_000, maxBudgetUsd: 2, seed: { 'page.html': '<p>old</p>\n' },
    prompt: 'Use the Write tool to replace page.html in the current folder with the text: new. Do not use any other tool first. Then reply with one line.',
    check: (f, meta) => { const w = mainToolUses(f).find((t) => t.name === 'Write'); const r = w ? toolResult(f, w.id) : null;
      const c = r?.message.content.find((x) => x?.tool_use_id === w.id);
      meta.overwrite = c ? { isError: c.is_error === true, text: resultText(c.content) } : { isError: null, text: null }; } },
  // R18: does a builder following C-2 split one file into many edits? Recorded, never thrown.
  { name: 'design-many-edits', recipe: 'design', timeoutMs: 300_000, maxBudgetUsd: 2,
    prompt: [...DESIGN_BUILDER_RULES, 'Section id: pricing. Build a three-tier pricing band in this folder.'].join('\n'),
    check: (f, meta) => { meta.writesPerPath = writesPerPathOf(f); } },
];

// ── main ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { only: null, model: 'claude-haiku-4-5', out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') out.only = argv[++i];
    else if (argv[i] === '--model') out.model = argv[++i];
    else if (argv[i] === '--out') out.out = resolve(argv[++i]);
  }
  // A design probe's fixtures stay out of fixtures/ask, which test/event-golden-replay.test.mjs replays whole.
  const design = SCENARIOS.some((s) => s.name === out.only && s.recipe === 'design');
  out.out ??= join(REPO, 'test', 'fixtures', design ? 'design' : 'ask');
  return out;
}

/**
 * The hard gate. Real claude processes cost money and are non-deterministic, so
 * capturing is opt-in ONLY: exactly '1', nothing truthy-ish, and never inferred
 * from an existing env var that something else might already set.
 * Exported so the suite can pin it without ever reaching the capture itself.
 * @param {Record<string,string|undefined>} [env]
 */
export function assertLiveClaudeAllowed(env = process.env) {
  if (env.WORCA_ALLOW_LIVE_CLAUDE === '1') return;
  throw new Error(
    'refusing to spawn the real claude CLI: this capture makes live model calls and spends money. '
    + 'Re-run with WORCA_ALLOW_LIVE_CLAUDE=1 if that is what you want.');
}

/**
 * One capture turn: spawn through the Claude adapter's RAW entry point, the
 * credential broker included when it is on (runClaude emits the normalized
 * vocabulary; the fixtures are raw stream-json)
 * and record every frame and stderr line, and per frame the ms since the spawn
 * (`arrivals[i]` belongs to `frames[i]`). Rejections propagate. With no `bin` it
 * spawns what runClaude would: WORCA_CLAUDE_BIN / ORCH_CLAUDE_BIN, else `claude`.
 * @param {object} options  runClaude-shaped options (buildAskSpawnOptions)
 * @returns {Promise<{frames:object[], stderr:string[], arrivals:number[], result:{text:string, exitCode:number}}>}
 */
export async function runCaptureTurn(options, { frames = [], stderr = [], arrivals = [] } = {}) {
  const { runClaudeAdapter, DEFAULT_BIN } = await import('../src/core/engines/claude.mjs');   // lazily: main() sets WORCA_HOME first
  const t0 = Date.now();
  const result = await runClaudeAdapter({
    ...options,
    bin: options.bin ?? DEFAULT_BIN,
    onEvent: (e) => {
      if (e.type === 'stderr') stderr.push(e.text);
      else if (e.raw && typeof e.raw === 'object') { frames.push(e.raw); arrivals.push(Date.now() - t0); }
    },
  });
  return { frames, stderr, arrivals, result };
}

async function main() {
  assertLiveClaudeAllowed();
  const args = parseArgs(process.argv.slice(2));
  const mock = process.env.WORCA_MOCK ?? process.env.ORCH_MOCK;
  if (mock && mock !== '0' && mock.toLowerCase() !== 'false') throw new Error('refusing to capture under WORCA_MOCK — this script needs the real claude CLI');
  const base = mkdtempSync(join(tmpdir(), 'worca-ask-capture-'));
  process.env.WORCA_HOME = base;                                   // before the first getDb() — the core reads it lazily
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
    const design = sc.recipe === 'design';
    const frames = [];
    const stderr = [];
    const arrivals = [];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), sc.timeoutMs ?? 120_000);
    const meta = { scenario: sc.name, prompt, model: args.model, exitCode: null, error: null, stderr, flags: { maxTurns: sc.maxTurns ?? 6, maxBudgetUsd: sc.maxBudgetUsd ?? 1, resume: sc.resume ?? null }, captured: new Date().toISOString(), claudeVersion: null };
    let cwd = null;
    let options;
    if (design) {                                                    // a builder-shaped spawn in its own scratch folder
      cwd = mkdtempSync(join(tmpdir(), 'worca-design-probe-'));
      for (const [rel, text] of Object.entries(sc.seed ?? {})) writeFileSync(join(cwd, rel), text, 'utf8');
      options = {
        cwd, prompt, model: args.model, tools: DESIGN_TOOLS, allowedTools: DESIGN_TOOLS, permissionMode: 'acceptEdits',
        includePartialMessages: true, strictMcpConfig: true, settingSources: ['project'], disableSlashCommands: true,
        envScrub: true, envAllowlist: [], maxTurns: meta.flags.maxTurns, maxBudgetUsd: meta.flags.maxBudgetUsd,
        systemPrompt: DESIGN_SYSTEM_PROMPT, signal: ac.signal,
      };
    } else {
      options = buildAskSpawnOptions({
        thread: { id: thread.id, sessionId: sc.resume ?? null },
        turn: { prompt, systemPrompt, model: args.model, effort: 'medium', modelEnv: resolveModelEnv(args.model), signal: ac.signal },
        limits: { maxTurns: meta.flags.maxTurns, maxBudgetUsd: meta.flags.maxBudgetUsd },
        mcpConfigPath, scratchDir,
      });
    }
    try {
      const { result: r } = await runCaptureTurn(options, { frames, stderr, arrivals });
      meta.exitCode = r.exitCode;
    } catch (err) {
      const m = /exited with code (\d+)/.exec(err.message);
      meta.exitCode = m ? Number(m[1]) : 1;
      meta.error = err.message;
    } finally {
      clearTimeout(timer);
      if (cwd) rmSync(cwd, { recursive: true, force: true });
    }
    if (design) {                                                    // R1: how each tool input streamed, with its verdict
      const stats = toolInputChunkStats(frames, arrivals);
      meta.toolInput = { ...stats, tools: stats.tools.map((t) => ({ ...t, verdict: probeVerdict(t) })) };
    }
    return { frames, stderr, meta };
  }

  /** The recipe assertions (an automated slice of the manual gate) + the scenario's own check. Throws on violation. */
  function verify(sc, frames, meta) {
    const init = frames.find((f) => f.type === 'system' && f.subtype === 'init');
    if (sc.recipe === 'design') {                                    // not the Ask recipe: only the scenario's own check
      meta.claudeVersion = init?.claude_code_version ?? null;
      sc.check(frames, meta);
      return;
    }
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
    for (const sc of selectScenarios(SCENARIOS, { only: args.only })) {
      let captured = null;
      const attempts = sc.recipe === 'design' ? 1 : MAX_ATTEMPTS;    // a paid design attempt can last 300 s
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const c = await captureOnce(sc);
        const r = lastResult(c.frames);
        if (r && typeof r.total_cost_usd === 'number') totalCost += r.total_cost_usd;   // every attempt is paid for
        try {
          verify(sc, c.frames, c.meta);
          captured = c;
          break;
        } catch (err) {
          if (FATAL.test(err.message) || attempt === attempts) throw err;              // recipe problems never retry; model flakiness does
          console.warn(`[ask-capture] ${sc.name}: ${err.message} — retrying (${attempt}/${attempts})`);
        }
      }
      const { frames, stderr, meta } = captured;
      const sanitize = createSanitizer(roots);                        // per scenario: id numbering restarts in every file
      const r = lastResult(frames);
      const lines = frames.map((f) => sanitize(JSON.stringify(f)));
      writeFileSync(join(args.out, `${sc.name}.jsonl`), lines.join('\n') + '\n', 'utf8');
      meta.stderr = stderr.map((l) => JSON.parse(sanitize(JSON.stringify(l))));
      if (meta.error) meta.error = JSON.parse(sanitize(JSON.stringify(meta.error)));
      for (const k of ['toolInput', 'overwrite', 'writesPerPath']) {  // design probe fields carry tool ids and scratch paths
        if (meta[k] !== undefined) meta[k] = JSON.parse(sanitize(JSON.stringify(meta[k])));
      }
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
