// test/stillhet-new-task-refusals-host.test.mjs — COV-2 (docs/stillhet/forms.md form.run-options): New task's engine and sync
// refusals, on dev's routes and in classic's words (split from stillhet-new-task-options-host for CI's per-file limit).
// Live app host (jsdom), the real shell, a stubbed fetch.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, posts, LISTS } from './helpers/stillhet-chat-live-host.mjs';
import { demoTaskHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const FLOWS = { ...LISTS, '/api/workflows': { workflows: [{ id: 'wf_shape', name: 'Shaper' }, { id: 'wf_lean', name: 'Lean', nodes: [{ id: 'plan', kind: 'agent' }, { id: 'build', kind: 'agent' }] }] } };
const DIVERGED = { error: 'main has diverged from origin/main (2 ahead, 3 behind)', code: 'sync-diverged', kind: 'diverged', options: ['origin', 'cancel'], members: [{ projectKey: 'web-1', projectName: 'web', base: 'main', remote: 'origin', ahead: 2, behind: 3 }] };
const ENGINE = { error: 'OpenAI Codex cannot enforce the guardrails Strict', code: 'engine-refused', overridable: true };
async function open({ reads = {}, write = () => [200, { runId: 'r-new' }], hold, lists = FLOWS } = {}) {
  const h = await liveHost({ lists, write, hold, read: (u) => reads[u] || null });
  await go(h.w, '#runs', 120);
  h.w.StillhetCenters.maker('tasks').newPick('form'); await settle(80);
  return h;
}
const q = (d, sel) => d.querySelector(`#center-dlg ${sel}`);
const pick = async (d, id, v) => { q(d, `[data-menu="f-${id}"]`).click(); await settle(10); q(d, `[data-menu-pick="f-${id}|${v}"]`).click(); await settle(40); };
const type = (w, d, sel, v) => { const t = q(d, sel); t.value = v; t.dispatchEvent(new w.Event('input', { bubbles: true })); };
const start = async (d) => { q(d, '[data-dialog="yes"]').click(); await settle(80); };
const runs = (calls) => posts(calls).filter(([, u]) => u === '/api/run').map(([, , b]) => b);
const note = (d) => q(d, '.choice-note');

test('COV-2 engine: the refusal shows its note and Allow unguarded; ticked, the next Start sends allowUnguardedEngine', async () => {
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, ENGINE] : [200, { runId: 'r-new' }]) : [200, {}]) });
  await pick(d, 'agent', 'OpenAI Codex');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.match(note(d).textContent, /OpenAI Codex cannot enforce the guardrails Strict/);
  assert.match(note(d).textContent, /Tick Allow unguarded to run anyway, or pick Claude\./);
  const box = q(d, 'input[data-c-allow]');
  assert.match(box.closest('label').textContent, /Allow unguarded: run without the rules this engine cannot enforce/);
  assert.equal(q(d, '[id$="-note"]'), null, 'the refusal is only in the note');
  box.click(); await settle(20);
  await start(d);
  const [a, b] = runs(calls);
  assert.equal(a.allowUnguardedEngine, undefined);
  assert.deepEqual(b, { ...a, allowUnguardedEngine: true });
});

test('COV-2 engine: a changed Agent clears the note and the consent', async () => {
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? [409, ENGINE] : [200, {}]) });
  await pick(d, 'agent', 'OpenAI Codex');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  q(d, 'input[data-c-allow]').click(); await settle(20);
  await pick(d, 'agent', 'Gemini CLI');
  assert.equal(note(d), null);
  await start(d);
  assert.equal(runs(calls).at(-1).allowUnguardedEngine, undefined, 'the consent was for the engine refused');
});

test('COV-2 sync: a diverged base shows classic\'s words; Start from origin/main resends the same body plus syncPolicy', async () => {
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, DIVERGED] : [200, { runId: 'r-new' }]) : [200, {}]) });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.match(note(d).textContent, /main has diverged from origin\/main/);
  assert.match(note(d).textContent, /\(2 ahead, 3 behind\)/);
  const ways = [...note(d).querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(ways, ['Cancel', 'Start from origin/main']);
  q(d, '[data-c-sync="origin"]').click(); await settle(80);
  const [a, b] = runs(calls);
  assert.deepEqual(b, { ...a, syncPolicy: 'origin' });
  assert.equal(d.querySelector('#center-dlg .dlg'), null, 'started: the form closed');
});

test('COV-2 sync: an edit after the refusal goes with the resend, never the text from before it', async () => {
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, DIVERGED] : [200, { runId: 'r-new' }]) : [200, {}]) });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  type(w, d, '#cc-text', 'Add a pager and a footer');
  q(d, '[data-c-sync="origin"]').click(); await settle(80);
  const [a, b] = runs(calls);
  assert.deepEqual(b, { ...a, prompt: 'Add a pager and a footer', syncPolicy: 'origin' });
});

test('COV-2 sync: a failed fetch offers Start anyway with last-fetch; a forbidden one offers Cancel only', async () => {
  const fetchFailed = { error: 'Could not reach origin (network)', code: 'sync-fetch-failed', kind: 'fetch-failed', fetchKind: 'network', options: ['last-fetch', 'cancel'], members: [{ base: 'main', remote: 'origin', fetchKind: 'network' }] };
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, fetchFailed] : n === 2 ? [200, { runId: 'r-new' }] : [409, { ...DIVERGED, options: ['cancel'], forbidden: true }]) : [200, {}]) });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.match(note(d).textContent, /Could not reach origin/);
  assert.match(note(d).textContent, /origin could not be reached\. Worca will start from the last fetch instead\./);
  q(d, '[data-c-sync="last-fetch"]').click(); await settle(80);
  assert.equal(runs(calls)[1].syncPolicy, 'last-fetch');
  w.StillhetCenters.maker('tasks').newPick('form'); await settle(80);
  type(w, d, '#cc-text', 'Again'); await start(d);
  assert.match(note(d).textContent, /This project's sync setting does not allow starting from the remote\./);
  assert.deepEqual([...note(d).querySelectorAll('button')].map((b) => b.textContent), ['Cancel']);
});

test('COV-2 sync: Cancel clears the note, says Start cancelled and starts nothing', async () => {
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? [409, DIVERGED] : [200, {}]) });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  q(d, '[data-c-sync="cancel"]').click(); await settle(30);
  assert.equal(note(d), null);
  assert.match([...d.querySelectorAll('body > .rc-toast')].map((e) => e.textContent).join(' '), /Start cancelled/);
  assert.equal(runs(calls).length, 1);
  assert.equal(q(d, '#cc-text').value, 'Add a pager', 'what was typed stays');
});

// ---- COV-2: the waiting clause's way out and the run before it's branch, drawn in the demo kind ----
const AFTER = { after: { kind: 'ticket', id: 's-docs', title: 'Nightly docs' } };
const demo = async (keep) => { const w = demoTaskHost({ after }); await settle(60); w.StillhetCenters.newTask(keep); await settle(60); return { w, d: w.document }; };
const baseItems = async (d) => { q(d, '[data-menu="f-base"]').click(); await settle(10); const got = [...d.querySelectorAll('#center-dlg [data-menu-pick^="f-base|"]')].map((x) => x.textContent.trim()); q(d, '[data-menu="f-base"]').click(); await settle(10); return got; };

test('COV-2 Start now instead / Start run / Start run now (demo): the waiting clause\'s link drops it and the yes button reads Start task', async () => {
  const { w, d } = await demo(AFTER);
  assert.match(q(d, '.cc-frame').textContent, /It starts once Nightly docs ends/);
  assert.equal(q(d, '[data-dialog="yes"]').textContent, 'Start after it');
  q(d, '[data-c-nowinstead]').click(); await settle(20);
  assert.doesNotMatch(q(d, '.cc-frame').textContent, /It starts once/);
  assert.equal(q(d, '[data-c-nowinstead]'), null);
  assert.equal(q(d, '[data-dialog="yes"]').textContent, 'Start task');
  assert.equal(d.activeElement, q(d, '[data-dialog="yes"]'));
  assert.notEqual(q(d, '[data-menu="f-base"]').textContent.trim(), 'the task before it\'s branch', 'no run before it, no such base');
  type(w, d, '#cc-text', 'Write the release notes'); await start(d);
  assert.ok(w.StillhetWorld.rows().some((r) => r.title === 'Write the release notes' && r.case === 'starting'), 'Start task starts it now');
});

test('COV-2 Branch off the run before it (demo): with a run before it, the base picker offers and defaults to the run before it\'s branch; without one it is absent', async () => {
  const { w, d } = await demo(AFTER);
  assert.equal(q(d, '[data-menu="f-base"]').textContent.trim(), 'The task before it\'s branch');   // a field's value starts with a capital
  assert.deepEqual(await baseItems(d), ['The task before it\'s branch', 'main (the project\'s default branch)', 'dev']   /* the default branch says what it is */);
  q(d, '[data-dialog="cancel"]').click(); await settle(20);
  w.StillhetCenters.newTask(); await settle(60);
  assert.equal(q(d, '[data-menu="f-base"]').textContent.trim(), 'main (the project\'s default branch)');
  assert.deepEqual(await baseItems(d), ['main', 'dev']);
});

test('COV-2 Branch off the run before it (demo): Schedule… from a waiting task does not carry the task before it\'s branch', async () => {
  const { d } = await demo(AFTER);
  q(d, '[data-c-tosched]').click(); await settle(30);
  assert.equal(q(d, '[data-menu="f-base"]').textContent.trim(), 'main (the project\'s default branch)');
});
