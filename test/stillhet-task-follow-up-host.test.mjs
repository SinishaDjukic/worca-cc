// test/stillhet-task-follow-up-host.test.mjs — gate G w3a-1 on Start a follow-up task / Schedule a task after this (B5.6,
// V-TW-15), live app host (jsdom, the real live adapter and StillhetTaskLive):
// F-W3a1-05: after an empty text is refused in place the button keeps its words (it read Start task, then Start run);
// F-W3a1-06: a press that lands after the form closed (a double press) throws nothing (the generic confirm read ui.confirm);
// F-W3a1-07: a task waiting for plan approval has not finished, so it schedules after itself, never "Now, as a follow-up".
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, withRun, posts } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
const card = (d) => d.querySelector('#route-run:not([hidden]) #card');
const sources = (src = clone(SOURCES)) => { for (const p of src.history.pipelines) p.projectKey = 'web-1'; src.history.pipelines.find((p) => p.id === 'h2').pr = { url: PR_URL, state: 'OPEN' }; return src; };
const read = (u) => {
  if (u === '/api/history/web-1/h2') return [200, { state: { ...TASK_DETAILS.approved.state, projectKey: 'web-1' } }];
  if (u.startsWith('/api/pr/checks?id=h2')) return [200, TASK_DETAILS.approved.checks];
  // the plan is written and waits for approval: its step is done (the seed's Shaper run at its plan)
  if (u === '/api/history/web-1/pa') return [200, { state: { ...TASK_DETAILS.plan.state, projectKey: 'web-1', projectDir: '/src/web', steps: TASK_DETAILS.plan.state.steps.map((x) => ({ ...x, status: 'done' })) } }];
  return null;
};
async function page(hash, { src = sources(), write = () => [200, { ok: true }] } = {}) {
  const h = await liveHost({ sources: src, read, write });
  const errors = [];
  h.w.addEventListener('error', (e) => errors.push(e.message || String(e.error)));
  await go(h.w, hash, 200); await settle(400);
  return { ...h, errors };
}
const menu = async (d) => { card(d).querySelector('[data-menu="more"]').click(); await settle(20); return [...card(d).querySelectorAll('[data-menu-pick]')].map((x) => x.textContent.trim()); };
const openAfter = async (d, text) => {
  await menu(d);
  card(d).querySelector('[data-menu-pick="more:after"]').click(); await settle(40);
  const inp = card(d).querySelector('#after-task'); inp.value = text; inp.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
};
const yes = (d) => card(d).querySelector('[data-confirm="yes"]');
const sent = (calls) => posts(calls).filter(([m, u]) => m !== 'GET' && !/^\/api\/ask\//.test(u));

test('F-W3a1-05: an empty follow-up refused in place keeps its button\'s words', async () => {
  const { d } = await page('#run/h2');
  await openAfter(d, '   ');
  const before = yes(d).textContent.trim();
  yes(d).click(); await settle(60);
  assert.ok(card(d).querySelector('#after-task-note'), 'refused in place');
  assert.equal(yes(d).textContent.trim(), before);
  assert.equal(before, 'Start task', 'a task, as everywhere in Stillhet');
});

test('F-W3a1-06: a second press that lands after the follow-up form closed throws nothing', async () => {
  const { d, errors, calls } = await page('#run/h2', { write: (u) => (u === '/api/run' ? [200, { ok: true, scheduled: true }] : [200, { ok: true }]) });
  await openAfter(d, 'Add paging tests');
  const btn = yes(d);
  btn.click(); await settle(150);
  assert.equal(card(d).querySelector('#after-task'), null, 'the form closed');
  card(d).appendChild(btn);   // the same button, still under the pointer for the second press
  btn.click(); await settle(60);
  assert.deepEqual(errors, []);
  assert.equal(sent(calls).length, 1, 'one POST');
});

test('F-W3a1-07: a task waiting for plan approval schedules after itself; it is not finished', async () => {
  const q = { id: 'q-plan', kind: 'plan', plan: { title: 'Ask me' } };
  for (const [what, src] of [['live', sources(withRun({ pendingQuestion: q }))], ['saved', sources((() => { const s = clone(SOURCES); s.hello.runs = s.hello.runs.filter((r) => r.runId !== 'run-a'); return s; })())]]) {
    const { d } = await page(what === 'live' ? '#run/run-a' : '#run/pa', { src });
    if (what === 'live') assert.match(card(d).textContent, /Needs approval/);
    const items = await menu(d);
    assert.ok(items.some((x) => x.startsWith('Schedule a task after this')), `${what}: ${items.join(' | ')}`);
    assert.ok(!items.some((x) => x.startsWith('Start a follow-up task')), what);
    card(d).querySelector('[data-menu-pick="more:after"]').click(); await settle(40);
    assert.match(card(d).querySelector('#after-when-t').textContent, /When this task finishes/, what);
    closeHosts();
  }
});
