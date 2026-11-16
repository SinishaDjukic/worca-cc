// test/stillhet-chat-proposal-options-host.test.mjs — COV-2 D12 (docs/rail/forms.md form.run-options): Chat's TaskProposal
// gets New task's start-time behaviour: the project's saved engine and tags, the team policy notes, and a refused Start's
// sync or engine note with its ways out. No presets and no ticket source. Live app host (jsdom), the real shell.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, THREAD, saidText, toastText } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const DEFAULTS = '/api/run-defaults?projectDir=%2Fsrc%2Fweb', POLICY = '/api/policy/notes?scope=project%3Aweb-1';
const DIVERGED = { error: 'main has diverged from origin/main (2 ahead, 3 behind)', code: 'sync-diverged', options: ['origin', 'cancel'], members: [{ projectKey: 'web-1', projectName: 'web', base: 'main', remote: 'origin', ahead: 2, behind: 3 }] };
const ENGINE = { error: 'OpenAI Codex cannot enforce the guardrails Strict', code: 'engine-refused', overridable: true };
// card_prop names its project's folder, so Start can say where it runs
const thread = () => { const t = clone(THREAD); t.messages[1].blocks.find((b) => b.id === 'card_prop').card.projectDir = '/src/web'; return t; };
async function open({ reads = {}, write = () => [200, { runId: 'r-new' }] } = {}) {
  const h = await liveHost({ thread: () => [200, thread()], read: (u) => reads[u] || null, write });
  await go(h.w, '#chat/ask_1', 120);
  return h;
}
const q = (d, sel) => d.querySelector(`#route-chat ${sel}`);
const card = (d) => q(d, '[data-anchor="card_prop"]');
const note = (d) => card(d).querySelector('.choice-note');
const start = async (d) => { q(d, '[data-pp-start="card_prop"]').click(); await settle(80); };
const runs = (calls) => calls.filter((c) => c.url === '/api/run').map((c) => c.body);
const CODEX = { [DEFAULTS]: [200, { engine: { value: 'codex' }, tags: ['client'], projectKey: 'web-1' }] };

test('COV-2 proposal: the team policy note sits in the card, in classic\'s words', async () => {
  const { d } = await open({ reads: { [DEFAULTS]: [200, { engine: { value: 'claude' }, tags: [], projectKey: 'web-1' }], [POLICY]: [200, { policy: { home: 'acme/policy', caps: {} }, notes: [{ level: 'warn', text: 'Required plugin jira is not installed.' }] }] } });
  const n = note(d);
  assert.match(n.className, /is-amber/);
  assert.match(n.textContent, /team policy · acme\/policy · 1 note · nothing here blocks the task/);
  assert.match(n.textContent, /Required plugin jira is not installed\./);
});

test('COV-2 proposal: the project\'s saved engine and tags are shown and sent when the card names none', async () => {
  const { d, calls } = await open({ reads: CODEX });
  assert.match(card(d).querySelector('.tp-sentence').textContent, /run by\s*OpenAI Codex/);
  await start(d);
  const [b] = runs(calls);
  assert.equal(b.engine, 'codex'); assert.deepEqual(b.tags, ['client']);
});

test('COV-2 proposal: a Claude default and no saved tags leave Start\'s body as it was', async () => {
  const { d, calls } = await open({ reads: { [DEFAULTS]: [200, { engine: { value: 'claude' }, tags: [], projectKey: 'web-1' }] } });
  assert.doesNotMatch(card(d).querySelector('.tp-sentence').textContent, /run by/);
  await start(d);
  const [b] = runs(calls);
  assert.equal(b.engine, undefined); assert.equal(b.tags, undefined);
});

test('COV-2 proposal sync: a diverged base shows its note; Start from origin/main resends the same body plus syncPolicy', async () => {
  let n = 0;
  const { d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, DIVERGED] : [200, { runId: 'r-new' }]) : [200, {}]) });
  await start(d);
  assert.match(note(d).textContent, /main has diverged from origin\/main/);
  assert.match(note(d).textContent, /\(2 ahead, 3 behind\)/);
  assert.doesNotMatch(toastText(d), /Could not start/, 'the note says it, not a toast');
  q(d, '[data-pp-sync="card_prop|origin"]').click(); await settle(80);
  const [a, b] = runs(calls);
  assert.deepEqual(b, { ...a, syncPolicy: 'origin' });
});

test('COV-2 proposal sync: a title edited after the refusal goes with the resend', async () => {
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, DIVERGED] : [200, { runId: 'r-new' }]) : [200, {}]) });
  await start(d);
  const t = q(d, '[data-pp-title="card_prop"]'); t.value = 'A sharper title'; t.dispatchEvent(new w.Event('input', { bubbles: true }));
  q(d, '[data-pp-sync="card_prop|origin"]').click(); await settle(80);
  const [a, b] = runs(calls);
  assert.deepEqual(b, { ...a, title: 'A sharper title', syncPolicy: 'origin' });
});

test('COV-2 proposal sync: Cancel clears the note, says Start cancelled and sends nothing more', async () => {
  const { d, calls } = await open({ write: (u) => (u === '/api/run' ? [409, DIVERGED] : [200, {}]) });
  await start(d);
  q(d, '[data-pp-sync="card_prop|cancel"]').click(); await settle(40);
  assert.equal(note(d), null);
  assert.match(saidText(d), /Start cancelled/);
  assert.equal(runs(calls).length, 1);
});

test('COV-2 proposal engine: the refusal and Allow unguarded; ticked, the next Start sends the consent', async () => {
  let n = 0;
  const { d, calls } = await open({ reads: CODEX, write: (u) => (u === '/api/run' ? (++n === 1 ? [409, ENGINE] : [200, { runId: 'r-new' }]) : [200, {}]) });
  await start(d);
  assert.match(note(d).textContent, /OpenAI Codex cannot enforce the guardrails Strict/);
  assert.match(note(d).textContent, /Tick Allow unguarded to run anyway, or pick Claude\./);
  q(d, 'input[data-pp-allow="card_prop"]').click(); await settle(30);
  assert.equal(q(d, 'input[data-pp-allow="card_prop"]').checked, true);
  await start(d);
  const [a, b] = runs(calls);
  assert.deepEqual(b, { ...a, allowUnguardedEngine: true });
});

test('COV-2 proposal: the note survives a redraw of the conversation', async () => {
  const { w, d } = await open({ write: (u) => (u === '/api/run' ? [409, DIVERGED] : [200, {}]) });
  await start(d);
  assert.ok(note(d));
  await go(w, '#chat/ask_2', 60);
  await go(w, '#chat/ask_1', 120);
  assert.match(note(d).textContent, /main has diverged/);
});

test('COV-2 proposal: any other refusal is the one toast, with no note', async () => {
  const { d } = await open({ write: (u) => (u === '/api/run' ? [400, { error: 'prompt is required' }] : [200, {}]) });
  await start(d);
  assert.equal(note(d), null);
  assert.match(toastText(d), /Could not start the task: prompt is required/);
});

test('COV-2 proposal: a card with no project folder reads no defaults and no policy', async () => {
  const h = await liveHost({ read: (u) => (u === DEFAULTS ? [200, { engine: { value: 'codex' }, tags: ['client'], projectKey: 'web-1' }] : null) });
  await go(h.w, '#chat/ask_1', 120);
  assert.ok(!h.calls.some((c) => c.url.startsWith('/api/run-defaults') || c.url.startsWith('/api/policy/')), 'nothing to read for');
  assert.equal(note(h.d), null);
});
