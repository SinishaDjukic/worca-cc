#!/usr/bin/env node
// experiments/messaging-bus/e7-noise.mjs — E7 (plan §4.11): the noise of all three publish layers on a replay
// of a REAL past Decompose run. The touch pattern (who called which tool on which file, in order) is real;
// the content is the run's real final diff applied hunk by hunk to the real base blobs (from this
// repository's history). Every task call goes through the REAL hook with --detect; layer 1 events are
// published at the scheduler points; layer 3 is a stated model. Readers' cost is what readRenderAck shows.
//   node e7-noise.mjs [--quick] [--out <path>]     (--quick = phase 2 only)
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createSqliteBus } from './lib/sqlite-bus.mjs';
import { openDetectState } from './lib/detect-state.mjs';
import { runFlush, DEBOUNCE_MS, DEBOUNCE_CALLS, MAX_AUTO, AUTO_MAX_HOP } from './lib/detector.mjs';
import { seedTree, assignHunks, applyCall, toolInputFor, checkFinal, ARMED_TOOLS } from './lib/replay-tree.mjs';
import { estimateTokens } from './lib/render.mjs';
import { SECRET_PATTERNS } from './lib/redact.mjs';
import { promptTokens } from './lib/prompts.mjs';
import { round } from './lib/stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'lib', 'hook.mjs');
const FIXTURE = join(HERE, 'test', 'fixtures', 'replay-decompose.json.gz');
const RUN = 'r_e7';
const SIBLINGS = `run.${RUN}.siblings`;
const IMPL = `run.${RUN}.step.impl`;
const PREFIX = IMPL;
const SYSTEM = { kind: 'system', id: 'worca', sub: null };
const OPTS = { topic: SIBLINGS, debounceMs: DEBOUNCE_MS, debounceCalls: DEBOUNCE_CALLS, maxAuto: MAX_AUTO, maxHop: AUTO_MAX_HOP };
const ID_RE = /m_[0-9A-HJKMNP-TV-Z]{26}/g;
// layer 3 model: one implementer question per task in a phase with ≥ 2 tasks (an assumed, typical text)
const QUESTION = 'question for my phase-mates: does the function I import from your file keep its current signature, and does it throw or return null on a missing row?';

function repoTop() {
  try { return execFileSync('git', ['-C', HERE, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); } catch { return null; }
}

export function loadFixture({ quick = false } = {}) {
  const fx = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString('utf8'));
  if (!quick) return fx;
  return { ...fx, phases: fx.phases.filter((p) => p.ordinal === 2), calls: fx.calls.filter((c) => c.phase === 2) };
}

/** One rendered mailbox → its blocks: `{ id, header, body }`. */
function blocksOf(text) {
  const out = [];
  const re = /^@ (m_[0-9A-HJKMNP-TV-Z]{26}) [^\n]*\n<<<data\n([\s\S]*?)\n>>>$/gm;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ id: m[1], header: m[0].split('\n')[0], body: m[2] });
  return out;
}

export async function runReplay({ quick = false } = {}) {
  const fx = loadFixture({ quick });
  const top = repoTop();
  const readBlob = (id) => {
    if (!top) return null;
    try { return execFileSync('git', ['-C', top, 'cat-file', '-p', id], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  };
  const dir = mkdtempSync(join(tmpdir(), 'bus-e7-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const db = join(dir, 'bus.db');
  const bus = createSqliteBus({ path: db, origin: 'h_e7' });
  const state = openDetectState(bus.db);
  const s = {
    calls: fx.calls.length, armedCalls: 0, bashCalls: 0, fixCalls: 0, unapplied: 0, nonUnique: 0, contentless: 0, finalMismatch: 0,
    detectErrors: 0,
  };
  const stats = { nonUnique: 0 };
  const readers = {};
  const headerTokens = [];
  const lifecycle = new Map(); // id → step
  let lifecycleShownToOwnStep = 0;
  let modelledQuestions = 0;
  const pathUnapplied = new Map();
  const offsets = new Map();
  const files = new Map(fx.files.map((f) => [f.path, f]));
  try {
    const seed = seedTree(repo, fx, readBlob);
    const missing = new Set(seed.baseMissing);
    const assigned = assignHunks(fx);
    const lifecycleMsg = (topic, step, data) => {
      const id = bus.publish({ topic, kind: 'status', body: { text: `${step}: ${data.event}`, data } }, { from: SYSTEM }).id;
      lifecycle.set(id, step);
      return id;
    };

    for (const phase of [...fx.phases].sort((a, b) => a.ordinal - b.ordinal)) {
      const mark = `step:${RUN}:impl:p${phase.ordinal}`;
      const mapPath = join(dir, `task-map-p${phase.ordinal}.json`);
      writeFileSync(mapPath, JSON.stringify({ v: 1, tasks: Object.fromEntries(phase.tasks.map((t) => [t.id, { title: t.id, file: '', files: t.files, parsed: t.files.length > 0 }])) }));
      // layer 1: the step-start status goes out BEFORE the step-start mark, so the step's agents never see it
      lifecycleMsg(IMPL, 'impl', { event: 'step.started', nodeId: 'n_implementer', attempt: 1, phase: phase.ordinal });
      bus.mark(mark);
      const calls = fx.calls.map((c, i) => [c, i]).filter(([c]) => c.phase === phase.ordinal).sort((a, b) => a[0].t - b[0].t);
      const lastIndex = new Map();
      const midIndex = new Map();
      for (const t of phase.tasks) {
        const mine = calls.filter(([c]) => c.task === t.id);
        if (mine.length) { lastIndex.set(t.id, mine.at(-1)[1]); midIndex.set(t.id, mine[Math.floor(mine.length / 2)][1]); }
      }
      const hook = (task, payload) => {
        // the step's agents read their own step topic too: only the start-mark order keeps the lifecycle rows from them
        const args = [HOOK, '--db', db, '--consumer-prefix', PREFIX, '--topics', `${SIBLINGS},${IMPL}`, '--start-mark', mark,
          '--detect', '--publish-topic', SIBLINGS, '--task-map', mapPath, '--task-id', task, '--root', repo];
        const r = spawnSync(process.execPath, args, { input: JSON.stringify({ session_id: task, cwd: repo, ...payload }), encoding: 'utf8', maxBuffer: 1 << 26 });
        s.detectErrors += (r.stderr.match(/^BUS_DETECT_ERROR/gm) ?? []).length;
        if (!r.stdout) return;
        const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
        const rd = (readers[task] ??= { messages: 0, tokens: 0 });
        rd.tokens += estimateTokens(text);
        for (const b of blocksOf(text)) {
          rd.messages += 1;
          headerTokens.push(estimateTokens(`${b.header}\n<<<data\n\n>>>`));
          if (lifecycle.get(b.id) === 'impl') lifecycleShownToOwnStep += 1;
        }
      };
      for (const [c, i] of calls) {
        if (c.tool === 'Bash') {
          // no effect: the log keeps only the first ~87 chars of a command and none of its effects
          s.bashCalls += 1;
          hook(c.task, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: c.cmd0 ?? '' } });
          hook(c.task, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: c.cmd0 ?? '' } });
        } else if (ARMED_TOOLS.has(c.tool) && assigned.has(i)) {
          s.armedCalls += 1;
          const a = assigned.get(i);
          if (a.contentless) s.contentless += 1;
          const abs = join(repo, a.path);
          const before = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
          let input;
          if (before === null && files.get(a.path).status === 'modified' && missing.has(a.path)) {
            // degraded host: no base text, so the call carries only its hunk snippets
            const lines = a.hunks.flatMap((h) => h.lines);
            input = { old_string: lines.filter((l) => l[0] === '-').map((l) => l.slice(1)).join('\n'), new_string: lines.filter((l) => l[0] === '+').map((l) => l.slice(1)).join('\n') };
            s.unapplied += a.hunks.length;
          } else {
            const r = applyCall(before ?? '', a.hunks, offsets.get(a.path) ?? 0);
            s.unapplied += r.unapplied;
            pathUnapplied.set(a.path, (pathUnapplied.get(a.path) ?? 0) + r.unapplied);
            offsets.set(a.path, r.offset);
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, r.text);
            input = toolInputFor(a.tool, before ?? '', r.text, stats);
          }
          hook(c.task, { hook_event_name: 'PostToolUse', tool_name: a.tool === 'MultiEdit' ? 'Edit' : a.tool, tool_input: { file_path: abs, ...input }, tool_use_id: `tu_${i}` });
        } else {
          // an edit tool on a path the final diff does not hold: no content to replay
          s.armedCalls += 1;
          s.contentless += 1;
          hook(c.task, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: join(repo, c.path ?? '') } });
        }
        // layer 3 model: a question to the phase-mates, half-way through the task
        if (phase.tasks.length >= 2 && midIndex.get(c.task) === i) {
          bus.publish({ topic: SIBLINGS, kind: 'question', body: { text: QUESTION } }, { from: { kind: 'agent', id: c.task, sub: 'main' } });
          modelledQuestions += 1;
        }
        // layer 1: the task is done after its last call; still-running phase-mates read it
        if (lastIndex.get(c.task) === i) {
          const t = phase.tasks.find((x) => x.id === c.task);
          lifecycleMsg(SIBLINGS, 'siblings', { event: 'task.done', taskId: c.task, files: t.files.slice(0, 20) });
        }
      }
      // phase end: the step-end flush per task, then the step-finished status
      for (const t of phase.tasks) {
        runFlush({ bus, state, scope: `${mark}|${PREFIX}:${t.id}:main`, opts: { ...OPTS, now: Date.now() }, from: { kind: 'agent', id: t.id, sub: 'main' } });
      }
      lifecycleMsg(IMPL, 'impl', { event: 'step.finished', phase: phase.ordinal });
    }
    // review cycles and the fix cycle: layer 1 only (a single fix agent has no siblings: layer 2 is not armed)
    s.fixCalls = fx.calls.filter((c) => c.phase === 'fix').length;
    fx.review.cycles.forEach((c, n) => {
      const topic = `run.${RUN}.step.review`;
      lifecycleMsg(topic, 'review', { event: 'step.started', nodeId: 'n_reviewer', attempt: n + 1 });
      lifecycleMsg(topic, 'review', { event: 'verdict', verdict: c.blocking ? 'changes-requested' : 'approved', issues: c.blocking });
      lifecycleMsg(topic, 'review', { event: 'step.finished' });
      if (c.blocking && !quick) {
        lifecycleMsg(`run.${RUN}.step.fix`, 'fix', { event: 'step.started', nodeId: 'n_implementer', attempt: 2 });
        lifecycleMsg(`run.${RUN}.step.fix`, 'fix', { event: 'step.finished' });
      }
    });

    // the final-blob check: every armed path whose base was present and whose hunks all applied
    const armedPaths = new Set([...assigned.values()].map((a) => a.path));
    const checked = [...armedPaths].filter((p) => !missing.has(p) && (pathUnapplied.get(p) ?? 0) === 0);
    const mismatched = checkFinal(checked, files, (p) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), 'utf8') : null));
    s.finalMismatch = mismatched.length;
    s.nonUnique = stats.nonUnique;

    const rows = bus.read('e7:audit:main', ['run.*']);
    const layer2 = rows.filter((m) => m.body?.data?.source === 'hook');
    const layer1 = rows.filter((m) => m.from?.kind === 'system');
    const reviewerFindings = fx.review.cycles.reduce((x, c) => x + c.blocking, 0);
    const tasks = fx.phases.flatMap((p) => p.tasks);
    const readerList = tasks.map((t) => readers[t.id] ?? { messages: 0, tokens: 0 });
    const fanOutRoles = (fx.source.fanOut ?? []).length;
    const summary = {
      'e7.replay.calls': s.calls,
      'e7.replay.armedCalls': s.armedCalls,
      'e7.replay.bashCalls': s.bashCalls,
      'e7.fixCycle.calls': s.fixCalls,
      'e7.replay.baseMissing': seed.baseMissing.length,
      'e7.replay.unapplied': s.unapplied,
      'e7.replay.nonUnique': s.nonUnique,
      'e7.replay.contentlessCalls': s.contentless,
      'e7.replay.finalMismatch': s.finalMismatch,
      'e7.replay.unarmedPaths': fx.files.filter((f) => !armedPaths.has(f.path)).length,
      'e7.replay.degraded': seed.baseMissing.length > 0,
      'e7.detectErrors': s.detectErrors,
      'e7.tasks': tasks.length,
      'e7.layer1.messages': layer1.length,
      'e7.layer2.messages': layer2.length,
    };
    const byReason = {};
    for (const m of layer2) byReason[m.body.data.reason ?? m.body.data.event] = (byReason[m.body.data.reason ?? m.body.data.event] ?? 0) + 1;
    for (const [k, v] of Object.entries(byReason).sort()) summary[`e7.layer2.byReason.${k}`] = v;
    Object.assign(summary, {
      'e7.layer3.modelledMessages': modelledQuestions + reviewerFindings,
      'e7.agentShown.total': readerList.reduce((x, r) => x + r.messages, 0),
      'e7.perReader.meanTokens': round(readerList.reduce((x, r) => x + r.tokens, 0) / Math.max(1, readerList.length), 1),
      'e7.perReader.maxTokens': Math.max(0, ...readerList.map((r) => r.tokens)),
      'e7.perReader.maxMessages': Math.max(0, ...readerList.map((r) => r.messages)),
      'e7.headerTokensPerMessage': headerTokens.length ? round(headerTokens.reduce((x, y) => x + y, 0) / headerTokens.length, 1) : 0,
      // Σ fixture tokens × the agents that would get them with prompt:true (stated counts, see RESULTS.md)
      'e7.layer3.promptTokens': (tasks.length + (s.fixCalls ? 1 : 0)) * (promptTokens('implementer') + promptTokens('receive'))
        + fx.review.cycles.length * (promptTokens('reviewer') + promptTokens('receive'))
        + promptTokens('planner') + promptTokens('decomposer') + fanOutRoles * promptTokens('in-agent-parent'),
      'e7.lifecycleShownToOwnStep': lifecycleShownToOwnStep,
      'e7.secretLeaks': rows.filter((m) => SECRET_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace('g', '')).test(JSON.stringify(m)))).length,
    });
    return {
      summary,
      layer2: layer2.map((m) => ({ kind: m.kind, file: m.body.data.file ?? null, reason: m.body.data.reason ?? m.body.data.event, owner: m.body.data.owner ?? null,
        names: (m.body.data.changes ?? []).map((c) => c.name), text: m.body.text, from: m.from.id })),
      readers: Object.fromEntries(tasks.map((t) => [t.id, readers[t.id] ?? { messages: 0, tokens: 0 }])),
      mismatched,
    };
  } finally {
    bus.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const o = { quick: false, out: join(HERE, 'results', 'e7.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--quick') o.quick = true;
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const r = await runReplay({ quick: o.quick });
  if (r.summary['e7.replay.degraded']) process.stderr.write(`E7_DEGRADED baseMissing=${r.summary['e7.replay.baseMissing']}\n`);
  const result = {
    experiment: 'e7', quick: o.quick,
    method: 'real touch pattern of a past Decompose run; content = its real final diff applied hunk by hunk to the real base blobs; Bash replayed without effects; fix cycle counted, not armed; layer 3 modelled',
    env: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cpus: cpus().length },
    durationMs: Date.now() - t0, summary: r.summary, layer2: r.layer2, readers: r.readers, mismatched: r.mismatched,
  };
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(r.summary) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}
