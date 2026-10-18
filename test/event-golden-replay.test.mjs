// test/event-golden-replay.test.mjs
// Pins what the CONSUMERS do with a stream, before they move to the normalized
// event vocabulary. Every captured claude
// stream in test/fixtures/{ask,hooks} plus one mock run per writer role is
// replayed into (a) orch._onAgentEvent and (b) the Ask Worca turn reducer, and
// what they emit is compared with test/fixtures/event-golden/<name>.json.
//   Regenerate (only after a DELIBERATE consumer change, review the diff):
//   UPDATE_EVENT_GOLDEN=1 WORCA_HOME=$(mktemp -d) node --test test/event-golden-replay.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { createTurnReducer } from '../src/core/ask/events.mjs';
import { runClaude, MOCK_WRITER_ROLES, extractResultCost } from '../src/core/claude-runner.mjs';
import { recordShaperFeature } from './helpers/shaper-fixture.mjs';
import { featureCardModel } from '../ui/public/shape/feature-card.mjs';

useTempHome(after);
const REPO = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(REPO, 'test', 'fixtures', 'event-golden');
const ATTR = { nodeId: 'n1', stepIndex: 0, cycle: 1, stepKey: '0:n1', executionId: 'x:n1:1', model: 'sonnet' };
const scratch = [];
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The envelope the claude runner builds for one stream-json frame. */
function envelope(raw) {
  const content = raw.message?.content ?? raw.content;
  const text = typeof raw.result === 'string' ? raw.result
    : Array.isArray(content) ? content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('')
      : typeof content === 'string' ? content : '';
  const cost = extractResultCost(raw);
  return { type: raw.type || 'event', raw, text: text || undefined, ...(cost != null ? { costUsd: cost } : {}) };
}

const TIME_KEY = /(^ts$|At$|^t$|durationMs|elapsed)/;
const scrub = (v) => JSON.parse(JSON.stringify(v, (k, x) => (TIME_KEY.test(k) && (typeof x === 'string' || typeof x === 'number') ? '<T>' : x)));

function replayOrchestrator(events) {
  const orch = createOrchestrator({ projectDir: '/tmp/golden-proj' });
  orch.state.steps.push({ key: ATTR.stepKey, nodeId: ATTR.nodeId, cycle: 1 });
  const emitted = [];
  const emit = orch.emit.bind(orch);
  orch.emit = (name, payload) => { if (name !== 'state') emitted.push({ name, payload }); return emit(name, payload); };
  for (const e of events) orch._onAgentEvent('planner', e, ATTR);
  return scrub({ emitted, subAgents: orch.state.subAgents, step: orch.state.steps[0], totalCost: orch.state.totalCostUsd ?? null });
}

function replayAsk(events) {
  let t = 0;
  const frames = [];
  const r = createTurnReducer({
    onFrame: (f) => frames.push(f), now: () => (t += 10),
    setTimeout: () => 0, clearTimeout: () => {},
  });
  for (const e of events) r.push(e);
  r.flush?.();
  const summary = r.finish();
  return scrub({ frames, summary });
}

function check(name, actual) {
  const file = join(OUT, `${name}.json`);
  const text = `${JSON.stringify(actual, null, 1)}\n`;
  if (process.env.UPDATE_EVENT_GOLDEN === '1') { mkdirSync(OUT, { recursive: true }); writeFileSync(file, text); return; }
  assert.ok(existsSync(file), `${name}: no golden file; regenerate with UPDATE_EVENT_GOLDEN=1 (see header)`);
  assert.equal(text, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `${name}: consumer output changed`);
}

const fixtureDir = (d) => (existsSync(join(REPO, 'test/fixtures', d))
  ? readdirSync(join(REPO, 'test/fixtures', d)).filter((f) => f.endsWith('.jsonl')).sort().map((f) => join(REPO, 'test/fixtures', d, f)) : []);

for (const file of [...fixtureDir('ask'), ...fixtureDir('hooks')]) {
  const name = file.split('/').slice(-2).join('-').replace(/\.jsonl$/, '');
  test(`golden: ${name}`, () => {
    const events = lines(file).map(envelope);
    check(`orch-${name}`, replayOrchestrator(events));
    check(`ask-${name}`, replayAsk(events));
  });
}

for (const role of [...MOCK_WRITER_ROLES].sort()) {
  test(`golden: mock ${role}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'worca-golden-'));
    scratch.push(cwd);
    const events = [];
    await runClaude({
      cwd, mock: true, onEvent: (e) => events.push(e),
      prompt: `x\nMOCK_ROLE: ${role}\nMOCK_OUT: ${join(cwd, 'out.md')}\nMOCK_JSON: ${join(cwd, 'out.json')}\nMOCK_TASKS_DIR: ${join(cwd, 'tasks')}`,
    }).catch(() => {});
    const out = replayOrchestrator(events);
    check(`orch-mock-${role}`, JSON.parse(JSON.stringify(out).split(cwd).join('<CWD>')));
  });
}

// The same captures down the REAL spawn path: a fake `claude` replays each capture's
// stdout frames, stderr lines and exit code, and runClaude's own line handler, session
// event and (after PR 1b) adapter normalizer shape what the consumers receive. The
// orchestrator gets them the way phases.mjs forwards them ({...e, role}). The stdout
// events are replayed before the stderr ones: the two pipes race, and each consumer
// handles a stderr line on its own, so the order between them carries no signal.
// The golden files for this block were generated on the base (a517091e).
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixture' } : {};
for (const file of fixtureDir('ask')) {
  const name = file.split('/').slice(-2).join('-').replace(/\.jsonl$/, '');
  test(`golden (real spawn path): ${name}`, POSIX, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'worca-golden-spawn-'));
    scratch.push(dir);
    const meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    writeFileSync(join(dir, 'stderr.txt'), (meta.stderr || []).map((l) => `${l}\n`).join(''));
    const bin = join(dir, 'claude');
    writeFileSync(bin, `#!/bin/sh\ncat '${file}'\ncat '${join(dir, 'stderr.txt')}' >&2\nexit ${Number(meta.exitCode) || 0}\n`);
    chmodSync(bin, 0o755);
    const events = [];
    const outcome = await runClaude({ cwd: dir, bin, prompt: 'x', onEvent: (e) => events.push(e) }).then(
      (r) => ({ text: r.text, exitCode: r.exitCode }),
      (err) => ({ error: err.message.split(dir).join('<DIR>'), errorClass: err.errorClass ?? null, stream: err.stream ?? null }));
    const ordered = [...events.filter((e) => e.type !== 'stderr'), ...events.filter((e) => e.type === 'stderr')];
    check(`spawn-orch-${name}`, { outcome, ...replayOrchestrator(ordered.map((e) => ({ ...e, role: 'planner' }))) });
    check(`spawn-ask-${name}`, replayAsk(ordered));
  });
}

// Shaper s2 (D18): the Chat feature card over a recorded 3-run feature (test/helpers/shaper-fixture.mjs), every frame.
test('golden: Shaper feature, 3 runs — proposal → clarify → split → run 1..3 → gate → ready, every frame', async () => {
  const frames = await recordShaperFeature();
  const out = frames.map((f) => {
    const m = featureCardModel({ own: f.own, card: f.card, snapOf: (pid) => f.snaps[pid] || null });
    return { label: f.label, chip: m.chip, status: m.status,
      bars: { run: m.run ? { stage: m.run.stage, tone: m.run.tone } : null, group: m.group ? { text: m.group.text, parts: m.group.parts.map((p) => p.state) } : null },
      log: m.log.map((l) => (l.run ? `Run ${l.run} · ${l.text}` : l.text)),
      step: m.step ? { index: m.step.index, kind: m.step.kind } : null,
      members: m.members.map((r) => `${r.label} · ${r.state}`) };
  });
  // The acceptance words, pinned here as well as in the golden file.
  assert.deepEqual(out.map((o) => [o.label, o.chip, o.status]), [
    ['proposal', 'Shaping', 'Running · Plan'],
    ['clarify', 'Shaping', 'Needs you · Plan'],
    ['split', 'Shaping', 'Needs you · Plan'],
    ['run1-plan', 'Feature · 1/3', 'Needs you · Run 1 · Plan'],
    ['run1-build', 'Feature · 1/3', 'Running · Run 1 · Build'],
    ['run2-plan', 'Feature · 2/3', 'Needs you · Run 2 · Plan'],
    ['run2-build', 'Feature · 2/3', 'Running · Run 2 · Build'],
    ['run3-plan', 'Feature · 3/3', 'Needs you · Run 3 · Plan'],
    ['run3-review', 'Feature · 3/3', 'Running · Run 3 · Review'],
    ['gate', 'Feature · 3/3', 'Needs you · Run 3 · Review'],
    ['ready', 'Feature · 3/3', 'Ready to ship · 3/3'],
  ]);
  assert.deepEqual(out.at(-1).log, ['Clarify · 2 answers', 'Split into 3 runs', 'Run 1 · Plan approved · after 1 round of changes',
    'Run 2 · Plan approved', 'Run 3 · Plan approved', 'Run 3 · Another cycle approved']);
  assert.deepEqual(out.map((o) => o.step && o.step.kind), [null, 'clarify', 'outline', 'plan', null, 'plan', null, 'plan', null, 'gate', null]);
  assert.deepEqual(out.find((o) => o.label === 'run1-build').members.slice(0, 2), ['Planning · Done', '1 · Store chart definitions · Building']);
  assert.deepEqual(out.find((o) => o.label === 'run2-plan').bars.group.parts, ['done', 'done', 'current', 'waiting']);
  check('shaper-feature-3-runs', out);
});
