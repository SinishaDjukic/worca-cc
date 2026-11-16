// test/stillhet-classic-extras-task-host.test.mjs — COV-3 (#1390) on the live task page: classic's run extras on dev's own
// routes. ⋯ Restore posts the per-run restore; ⋯ Send a direction posts straight to the run; a usage-limit pause's Resume ▾
// lists Resume on ‹Engine› and asks first; an old run link opens its saved task. The prototype draws the same items and
// posts nothing. Live app host (jsdom): the page, its menus and its dialog are the subject.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts, toastText, until } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS } from './helpers/stillhet-live-fixture.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { usageLimitSwitches, engineLabel } from '../src/shared/engine-switch.mjs';

afterEach(closeHosts);
const card = (d) => d.querySelector('#card');
const sent = (calls) => posts(calls).filter(([m, u]) => m !== 'GET' && !/^\/api\/ask\//.test(u));
function sources(edit = (s) => s) { const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1'; return edit(s) || s; }
const moreItems = async (d) => { card(d).querySelector('[data-menu="more"]').click(); await settle(20); return [...card(d).querySelectorAll('[data-menu-pick]')].map((x) => x.dataset.menuPick); };
const pickMore = async (d, id) => { card(d).querySelector('[data-menu="more"]').click(); await settle(20); card(d).querySelector(`[data-menu-pick="${id}"]`).click(); await settle(40); };
const actItems = async (d) => { card(d).querySelector('[data-menu="act"]')?.click(); await settle(20); return [...card(d).querySelectorAll('[data-menu-pick]')].map((x) => x.textContent.trim()); };
const typeIn = (d, el, v) => { el.value = v; el.dispatchEvent(new d.defaultView.Event('input', { bubbles: true })); };

test('COV-3 #3: the page ⋯ Restore on an archived task posts the per-run route with its project, no body; the toast says it is back', async () => {
  const s = sources((x) => { x.archived = { pipelines: [{ id: 'x7', title: 'Old work', status: 'done', archived: true, projectKey: 'web-1', projectName: 'web', startedAt: x.history.pipelines[0].startedAt }] }; });
  const h = await liveHost({ sources: s, read: (u) => (u === '/api/history/web-1/x7' ? [200, { state: { ...TASK_DETAILS.approved.state, id: 'x7', status: 'done', archivedAt: '2026-11-12T10:00:00Z' } }] : null), write: (u) => (/\/restore\?/.test(u) ? [200, { ok: true }] : [404, {}]) });
  await go(h.w, '#run/x7', 200); await settle(300);
  assert.ok((await moreItems(h.d)).includes('more:restore'), 'an archived task offers Restore');
  card(h.d).querySelector('[data-menu-pick="more:restore"]').click(); await settle(80);
  assert.deepEqual(sent(h.calls), [['POST', '/api/runs/x7/restore?projectKey=web-1', undefined]]);
  assert.match(toastText(h.d) + h.d.body.textContent, /The record is back in Tasks/);
});

test('COV-3 #1: ⋯ Send a direction opens the field; an empty send asks nothing; Send posts {text} and closes; Not now asks nothing', async () => {
  const h = await liveHost({ sources: sources(), write: (u) => (u === '/api/runs/pb/directions' ? [201, { id: 'd1' }] : [404, {}]) });
  await go(h.w, '#run/run-b', 200); await settle(300);
  const { d } = h;
  await pickMore(d, 'more:direction');
  const field = card(d).querySelector('#page-dir');
  assert.ok(field, 'a field under the status line');
  assert.ok(card(d).querySelector('.rc-card .ask-changes [data-page-direction-send]'));
  card(d).querySelector('[data-page-direction-send]').click(); await settle(40);
  assert.deepEqual(sent(h.calls), [], 'COV-3 #1: an empty direction asks nothing');
  assert.match(toastText(d) + card(d).textContent, /Say what it should take into account first/);
  typeIn(d, card(d).querySelector('#page-dir'), 'Use the v2 API');
  card(d).querySelector('[data-page-direction-send]').click(); await settle(80);
  assert.deepEqual(sent(h.calls), [['POST', '/api/runs/pb/directions', { text: 'Use the v2 API' }]]);
  assert.equal(card(d).querySelector('#page-dir'), null, 'the field closes once dev took it');
  assert.match(toastText(d) + card(d).textContent, /Sent: the run reads it at its next step/);
  await pickMore(d, 'more:direction');
  card(d).querySelector('[data-page-direction-cancel]').click(); await settle(30);
  assert.equal(card(d).querySelector('#page-dir'), null);
  assert.equal(sent(h.calls).length, 1, 'Not now asks nothing');
});

test('COV-3 #1: a run that finished meanwhile answers 409; the field stays open with its text and the toast says why', async () => {
  const h = await liveHost({ sources: sources(), write: (u) => (u === '/api/runs/pb/directions' ? [409, { error: 'run is finished; a direction would never be read' }] : [404, {}]) });
  await go(h.w, '#run/run-b', 200); await settle(300);
  await pickMore(h.d, 'more:direction');
  typeIn(h.d, card(h.d).querySelector('#page-dir'), 'Too late');
  card(h.d).querySelector('[data-page-direction-send]').click(); await settle(80);
  assert.equal(card(h.d).querySelector('#page-dir')?.value, 'Too late', 'COV-3 #1: a finished run\'s 409 keeps the text');
  assert.match(toastText(h.d), /Could not send the direction: run is finished/);
});

test('COV-3 #1: a finished task and an archived one offer no Send a direction', async () => {
  const h = await liveHost({ sources: sources(), read: (u) => (u === '/api/history/web-1/h2' ? [200, { state: { ...TASK_DETAILS.approved.state, status: 'done' } }] : null) });
  await go(h.w, '#run/h2', 200); await settle(300);
  assert.ok(!(await moreItems(h.d)).includes('more:direction'));
});

const limited = () => sources((s) => { s.hello.runs = s.hello.runs.map((r) => (r.runId === 'run-c' ? { ...r, pauseReason: 'usage_limit', projectKey: 'api-2' } : r)); });
const OTHERS = usageLimitSwitches({ reason: 'usage_limit', limitEngine: 'claude' });
test('COV-3 #12/#14: a usage-limit pause lists Resume on ‹Engine› per other engine; picking one asks first; Cancel asks nothing; yes posts classic\'s body', async () => {
  const h = await liveHost({ sources: limited(), write: (u) => (u === '/api/resume' ? [200, { ok: true }] : [404, {}]) });
  await go(h.w, '#run/run-c', 200); await settle(300);
  const { d } = h;
  const items = await actItems(d);
  const want = OTHERS.map((e) => `Resume on ${engineLabel(e)}`);
  for (const w of want) assert.ok(items.some((t) => t.startsWith(w)), `${w} in ${items.join(' | ')}`);
  assert.ok(!items.some((t) => /Resume on Codex$/.test(t)), 'never the design\'s sample engine');
  const first = want[0];
  [...card(d).querySelectorAll('[data-menu-pick]')].find((x) => x.textContent.trim().startsWith(first)).click(); await settle(40);
  const dlg = card(d).querySelector('#fd-h')?.closest('dialog, .viewer-modal, [role="dialog"]') || card(d);
  assert.match(dlg.textContent, new RegExp(`${first}\\?`), 'the dialog asks first');
  assert.match(dlg.textContent, /Starts the paused step fresh/, 'engineSwitchNote');
  card(d).querySelector('[data-fd="cancel"]').click(); await settle(30);
  assert.deepEqual(sent(h.calls), [], 'Cancel asks nothing');
  await actItems(d);
  [...card(d).querySelectorAll('[data-menu-pick]')].find((x) => x.textContent.trim().startsWith(first)).click(); await settle(40);
  card(d).querySelector('[data-fd="ok"]').click(); await settle(120);
  assert.deepEqual(sent(h.calls), [['POST', '/api/resume', { pipelineId: 'pc', baseCheck: true, engine: OTHERS[0] }]]);
  assert.match(toastText(d) + card(d).textContent, new RegExp(`Resumed on ${engineLabel(OTHERS[0])}`));
});

test('COV-3 #12: a base that moved asks before resuming; Resume anyway posts baseAck with the same engine', async () => {
  let n = 0;
  const h = await liveHost({ sources: limited(), write: (u) => (u === '/api/resume' ? (++n === 1 ? [409, { error: 'dev moved since the run started', code: 'base-moved' }] : [200, { ok: true }]) : [404, {}]) });
  await go(h.w, '#run/run-c', 200); await settle(300);
  const { d } = h;
  await actItems(d);
  [...card(d).querySelectorAll('[data-menu-pick]')].find((x) => x.textContent.trim().startsWith('Resume on')).click(); await settle(40);
  card(d).querySelector('[data-fd="ok"]').click(); await settle(120);
  const yes = await until(() => card(d).querySelector('[data-confirm="yes"]'));
  yes.click(); await settle(120);
  assert.deepEqual(sent(h.calls), [['POST', '/api/resume', { pipelineId: 'pc', baseCheck: true, engine: OTHERS[0] }], ['POST', '/api/resume', { pipelineId: 'pc', baseCheck: true, baseAck: true, engine: OTHERS[0] }]]);
});

test('COV-3 #16: the saved paused task\'s page lists Resume on ‹Engine› too', async () => {
  const s = sources((x) => { x.history.pipelines = x.history.pipelines.map((r) => (r.id === 'h1' ? { ...r, pauseReason: 'usage_limit', limitEngine: 'claude' } : r)); });
  const h = await liveHost({ sources: s, read: (u) => (u === '/api/history/web-1/h1' ? [200, { state: { ...TASK_DETAILS.approved.state, id: 'h1', status: 'paused', pauseReason: 'usage_limit', limitEngine: 'claude' } }] : null) });
  await go(h.w, '#run/h1', 200); await settle(300);
  const items = await actItems(h.d);
  assert.ok(items.some((t) => t.startsWith(`Resume on ${engineLabel(OTHERS[0])}`)), items.join(' | '));
});

test('COV-3 #11: an old run link opens the saved task it became', async () => {
  const h = await liveHost({ sources: sources(), read: (u) => (u === '/api/run-links/run-old' ? [200, { pipelineId: 'h2', historyKey: 'web-1' }] : u === '/api/history/web-1/h2' ? [200, { state: { ...TASK_DETAILS.approved.state, title: 'Shipped' } }] : null) });
  await go(h.w, '#run/run-old', 200); await settle(400);
  assert.equal(h.calls.filter((c) => c.url === '/api/run-links/run-old').length, 1);
  assert.match(card(h.d).querySelector('h1')?.textContent || '', /Shipped/);
});

test('prototype: paused-limit lists Resume on Codex, asks first, and posts nothing; a running task\'s Send a direction answers the demo', async () => {
  const calls = [];
  const w = stillhetHost({ adapter: 'demo', hash: '#run/paused-limit', fetch: async (u, o = {}) => { calls.push([o.method || 'GET', String(u)]); return { ok: false, status: 404, json: async () => ({}) }; }, after: () => {} });
  await settle(200);
  const d = w.document;
  card(d).querySelector('[data-menu="act"]').click(); await settle(20);
  const item = [...card(d).querySelectorAll('[data-menu-pick]')].find((x) => /^Resume on Codex/.test(x.textContent.trim()));
  assert.ok(item);
  item.click(); await settle(40);
  assert.match(card(d).textContent, /Resume on Codex\?/);
  card(d).querySelector('[data-fd="ok"]').click(); await settle(1200);
  assert.match(toastText(d) + card(d).textContent, /Resumed on Codex/);
  w.location.hash = '#run/working'; await settle(200);
  await pickMore(d, 'more:direction');
  typeIn(d, card(d).querySelector('#page-dir'), 'x');
  card(d).querySelector('[data-page-direction-send]').click(); await settle(40);
  assert.match(toastText(d) + card(d).textContent, /Not connected to Worca yet/, 'the demo\'s answer: it would send the direction');
  assert.deepEqual(calls.filter(([m]) => m !== 'GET'), [], 'the prototype posts nothing');
  w.close();
});
