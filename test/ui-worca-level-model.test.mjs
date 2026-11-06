// test/ui-worca-level-model.test.mjs — the pure client model for the worca level: the two fetch
// helpers (fetch stubbed), the hover-card model and which dialog shows first.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchWorcaLevel,
  ackWorcaLevel,
  tooltipModel,
  pickDialog,
} from '../ui/public/worca-level/model.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const action = (id, done) => ({ id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#/${id}`, done, doneAt: done ? 't' : null });

const view = (over = {}) => ({
  level: { index: 2, key: 'swimmer', name: 'Swimmer', description: 'd', avatar: 'a.svg' },
  progress: { done: 1, total: 4 },
  next: [action('a', true), action('b', false), action('c', false), action('d', false)],
  top: false,
  ladder: [],
  welcome: null,
  celebration: null,
  ...over,
});

const stubFetch = (status, body, calls = []) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return calls;
};

test('fetchWorcaLevel GETs the view and returns it parsed', async () => {
  const v = view();
  const calls = stubFetch(200, v);
  assert.deepEqual(await fetchWorcaLevel(), v);
  assert.equal(calls[0].url, '/api/worca-level');
});

test('fetchWorcaLevel surfaces the server error text on a non-OK response', async () => {
  stubFetch(500, { error: 'store unreadable' });
  await assert.rejects(fetchWorcaLevel(), /store unreadable/);
});

test('fetchWorcaLevel falls back to a status message when the body has no error', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => { throw new Error('bad json'); } });
  await assert.rejects(fetchWorcaLevel(), /503/);
});

test('ackWorcaLevel POSTs { what } as JSON and returns the new view', async () => {
  const v = view({ celebration: null });
  const calls = stubFetch(200, v);
  assert.deepEqual(await ackWorcaLevel('celebration'), v);
  assert.equal(calls[0].url, '/api/worca-level/ack');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { what: 'celebration' });
});

test('ackWorcaLevel sends the level index of a celebration and omits it for the welcome', async () => {
  const calls = stubFetch(200, view({ celebration: null }));
  await ackWorcaLevel('celebration', 3);
  await ackWorcaLevel('welcome');
  assert.deepEqual(JSON.parse(calls[0].init.body), { what: 'celebration', index: 3 });
  assert.deepEqual(JSON.parse(calls[1].init.body), { what: 'welcome' });
});

test('ackWorcaLevel surfaces the server error on a non-OK response', async () => {
  stubFetch(400, { error: 'what must be welcome or celebration' });
  await assert.rejects(ackWorcaLevel('nope'), /welcome or celebration/);
});

test('tooltipModel names the level, progress and the first two not-done actions in order', () => {
  const m = tooltipModel(view());
  assert.equal(m.name, 'Swimmer');
  assert.equal(m.levelLine, 'Level 2 of 4');
  assert.equal(m.progressLine, '1 of 4 done');
  assert.deepEqual(m.tryNext.map((a) => a.id), ['b', 'c']);
  assert.equal(m.topLine, null);
});

test('tooltipModel offers at most two suggestions and one when only one is left', () => {
  assert.equal(tooltipModel(view({ next: [action('a', false), action('b', false), action('c', false)] })).tryNext.length, 2);
  assert.deepEqual(tooltipModel(view({ next: [action('a', true), action('b', false)] })).tryNext.map((a) => a.id), ['b']);
});

test('tooltipModel at the top level carries the top line and no suggestions', () => {
  const m = tooltipModel(view({
    level: { index: 4, key: 'pod-leader', name: 'Pod Leader', description: 'd', avatar: 'p.svg' },
    top: true,
    next: null,
    progress: null,
  }));
  assert.equal(m.levelLine, 'Level 4 of 4');
  assert.deepEqual(m.tryNext, []);
  assert.equal(typeof m.topLine, 'string');
  assert.ok(m.topLine.length > 0);
  assert.equal(m.progressLine, null);
});

test('tooltipModel does not mutate the view', () => {
  const v = view();
  const before = JSON.stringify(v);
  tooltipModel(v);
  assert.equal(JSON.stringify(v), before);
});

test('pickDialog: welcome kinds first, then celebration, else null', () => {
  const none = { firstRunWelcomeOpen: false, setupOpen: false };
  const celebration = { index: 2, key: 'swimmer', name: 'Swimmer', avatar: 'a.svg' };
  assert.equal(pickDialog(view({ welcome: { kind: 'new' } }), none), 'welcome-new');
  assert.equal(pickDialog(view({ welcome: { kind: 'existing' } }), none), 'welcome-existing');
  assert.equal(pickDialog(view({ celebration }), none), 'celebration');
  assert.equal(pickDialog(view({ welcome: { kind: 'new' }, celebration }), none), 'welcome-new');
  assert.equal(pickDialog(view(), none), null);
});

test('pickDialog is null while the first-run welcome or setup is open, for both kinds', () => {
  const celebration = { index: 2, key: 'swimmer', name: 'Swimmer', avatar: 'a.svg' };
  for (const open of [{ firstRunWelcomeOpen: true, setupOpen: false }, { firstRunWelcomeOpen: false, setupOpen: true }]) {
    assert.equal(pickDialog(view({ welcome: { kind: 'new' } }), open), null);
    assert.equal(pickDialog(view({ celebration }), open), null);
  }
});

test('pickDialog tolerates a missing options bag', () => {
  assert.equal(pickDialog(view({ welcome: { kind: 'existing' } })), 'welcome-existing');
});

test('tooltipModel never suggests an action whose href is not an in-app hash route', () => {
  const m = tooltipModel(view({ next: [
    { id: 'x', label: 'X', href: 'javascript:alert(1)', done: false },
    { id: 'y', label: 'Y', href: 'https://example.com', done: false },
    { id: 'z', label: 'Z', href: '#runs', done: false },
  ] }));
  assert.deepEqual(m.tryNext.map((a) => a.id), ['z']);
});
