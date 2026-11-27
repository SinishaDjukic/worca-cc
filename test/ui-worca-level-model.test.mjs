// test/ui-worca-level-model.test.mjs — the pure client model for the worca level: the two fetch
// helpers (fetch stubbed), the hover-card model and which dialog shows first.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fetchWorcaLevel,
  ackWorcaLevel,
  tooltipModel,
  pickDialog,
  isRunResultRoute,
  isLiveRunRoute,
} from '../ui/public/worca-level/model.mjs';
import * as modelModule from '../ui/public/worca-level/model.mjs';
import { renderSegments } from '../ui/public/worca-level/segments.mjs';
import { browserTimeZone } from '../ui/public/schedule-sheet.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const action = (id, done) => ({ id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#/${id}`, done, doneAt: done ? 't' : null });

const view = (over = {}) => ({
  level: { index: 2, key: 'runner', name: 'Runner', tagline: 'runs a pipeline end to end', description: 'd', avatar: 'a.svg' },
  nextLevel: { index: 3, key: 'hooked', name: 'Hooked' },
  progress: { done: 1, total: 4, unit: 'items' },
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
  assert.equal(calls[0].url, `/api/worca-level?tz=${encodeURIComponent(browserTimeZone())}`);
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
  assert.deepEqual(JSON.parse(calls[0].init.body), { what: 'celebration', tz: browserTimeZone() });
});

test('ackWorcaLevel sends the level index of a celebration and omits it when there is none', async () => {
  const calls = stubFetch(200, view({ celebration: null }));
  await ackWorcaLevel('celebration', 3);
  await ackWorcaLevel('welcome');
  assert.deepEqual(JSON.parse(calls[0].init.body), { what: 'celebration', index: 3, tz: browserTimeZone() });
  assert.deepEqual(JSON.parse(calls[1].init.body), { what: 'welcome', tz: browserTimeZone() });
});

test('ackWorcaLevel surfaces the server error on a non-OK response', async () => {
  stubFetch(400, { error: 'what must be one of: celebration' });
  await assert.rejects(ackWorcaLevel('nope'), /must be one of/);
});

test('tooltipModel names the level, progress and the first two not-done actions in order', () => {
  const m = tooltipModel(view());
  assert.equal(m.name, 'Runner');
  assert.equal(m.levelLine, 'Level 2 of 5');
  assert.equal(m.tagline, 'runs a pipeline end to end');
  assert.equal(m.nextName, 'Hooked');
  assert.equal(m.progressText, '1 of 4 done');
  assert.deepEqual(m.segments, { done: 1, total: 4 });
  assert.equal(m.tryNextHeading, 'Try next');
  assert.deepEqual(m.tryNext.map((a) => a.label), ['Label b', 'Label c']);
  assert.deepEqual(Object.keys(m.tryNext[0]).sort(), ['hint', 'href', 'label']);
  assert.equal(m.topLine, null);
});

test('tooltipModel offers at most two suggestions and one when only one is left', () => {
  assert.equal(tooltipModel(view({ next: [action('a', false), action('b', false), action('c', false)] })).tryNext.length, 2);
  assert.deepEqual(tooltipModel(view({ next: [action('a', true), action('b', false)] })).tryNext.map((a) => a.label), ['Label b']);
});

const levelView = (index, key, name, next, progress) => view({
  level: { index, key, name, tagline: `tag ${key}`, description: 'd', avatar: 'a.svg' },
  nextLevel: next,
  progress,
});

test('tooltipModel heading is "Your first steps" at level 1 and "Try next" at levels 2 to 4', () => {
  const l1 = tooltipModel(levelView(1, 'curious', 'Curious', { index: 2, key: 'runner', name: 'Runner' }, { done: 0, total: 3, unit: 'items' }));
  assert.equal(l1.tryNextHeading, 'Your first steps');
  assert.equal(l1.levelLine, 'Level 1 of 5');
  const l2 = tooltipModel(levelView(2, 'runner', 'Runner', { index: 3, key: 'hooked', name: 'Hooked' }, { done: 0, total: 4, unit: 'items' }));
  const l3 = tooltipModel(levelView(3, 'hooked', 'Hooked', { index: 4, key: 'worcaholic', name: 'WorcaHolic' }, { done: 0, total: 4, unit: 'items' }));
  const l4 = tooltipModel(levelView(4, 'worcaholic', 'WorcaHolic', { index: 5, key: 'council', name: "Worca's Council" }, { done: 3, total: 30, unit: 'days' }));
  for (const m of [l2, l3, l4]) assert.equal(m.tryNextHeading, 'Try next');
});

test('R-po-12: the Runner tooltip is Level 2 of 5, toward Hooked, with 4 segments', () => {
  const m = tooltipModel(levelView(2, 'runner', 'Runner', { index: 3, key: 'hooked', name: 'Hooked' }, { done: 1, total: 4, unit: 'items' }));
  assert.equal(m.levelLine, 'Level 2 of 5');
  assert.equal(m.nextName, 'Hooked');
  assert.equal(m.segments.total, 4);
});

test('R-po-27: Council progress reads "n of 30 days" with 30 segments', () => {
  const m = tooltipModel(levelView(4, 'worcaholic', 'WorcaHolic', { index: 5, key: 'council', name: "Worca's Council" }, { done: 12, total: 30, unit: 'days' }));
  assert.equal(m.progressText, '12 of 30 days');
  assert.equal(m.segments.total, 30);
  assert.equal(m.nextName, "Worca's Council");
});

test('R-po-13: the top level has no next name, progress or segments, and the exact top text', () => {
  const m = tooltipModel(view({
    level: { index: 5, key: 'council', name: "Worca's Council", tagline: 'council member', description: 'd', avatar: 'c.svg' },
    top: true,
    next: null,
    nextLevel: null,
    progress: null,
  }));
  assert.equal(m.levelLine, 'Level 5 of 5');
  assert.equal(m.nextName, null);
  assert.equal(m.progressText, null);
  assert.equal(m.segments, null);
  assert.deepEqual(m.tryNext, []);
  assert.equal(m.topLine, "You've reached the top level. There is no next level to work toward.");
});

test('tooltipModel does not mutate the view', () => {
  const v = view();
  const before = JSON.stringify(v);
  tooltipModel(v);
  assert.equal(JSON.stringify(v), before);
});

const CLEAR = { setupOpen: false, welcomeOpen: false, dialogOpen: false, guideOpen: false, menuOpen: false, liveRunOpen: false, shownThisSession: false, resultSeen: false };
const celebrating = (index = 3) => view({ celebration: { index, key: 'k', name: 'N', avatar: 'a.svg' } });

test('pickDialog: a celebration, else null; a view carrying a welcome still opens nothing', () => {
  const celebration = { index: 3, key: 'hooked', name: 'Hooked', avatar: 'a.svg' };
  assert.equal(pickDialog(view({ celebration }), CLEAR), 'celebration');
  assert.equal(pickDialog(view({ welcome: { kind: 'new' } }), CLEAR), null);
  assert.equal(pickDialog(view({ welcome: { kind: 'existing' }, celebration }), CLEAR), 'celebration');
  assert.equal(pickDialog(view(), CLEAR), null);
});

test('pickDialog gate truth table (R-po-13): every blocker alone silences a celebration', () => {
  for (const blocker of ['setupOpen', 'welcomeOpen', 'dialogOpen', 'guideOpen', 'menuOpen', 'liveRunOpen', 'shownThisSession']) {
    assert.equal(pickDialog(celebrating(), { ...CLEAR, [blocker]: true }), null, blocker);
    assert.equal(pickDialog(celebrating(), { ...CLEAR, resultSeen: true, [blocker]: true }), null, `${blocker} with a result seen`);
  }
  assert.equal(pickDialog(celebrating(), CLEAR), 'celebration', 'nothing in the way');
  assert.equal(pickDialog(celebrating(), { ...CLEAR, resultSeen: true }), 'celebration', 'a seen result does not block other levels');
});

test('pickDialog: a summary wins over a celebration and obeys the same gate', () => {
  const both = view({ summary: { kind: 'x' }, celebration: { index: 3 } });
  assert.equal(pickDialog(both, CLEAR), 'summary');
  assert.equal(pickDialog(view({ summary: { kind: 'x' } }), CLEAR), 'summary');
  for (const blocker of ['setupOpen', 'welcomeOpen', 'dialogOpen', 'guideOpen', 'menuOpen', 'liveRunOpen', 'shownThisSession']) {
    assert.equal(pickDialog(both, { ...CLEAR, [blocker]: true }), null, blocker);
  }
});

test('pickDialog: Runner waits for a result route (R-po-7)', () => {
  const runner = celebrating(2);
  assert.equal(pickDialog(runner, CLEAR), null);
  assert.equal(pickDialog(runner, { ...CLEAR, resultSeen: true }), 'celebration');
  assert.equal(pickDialog(runner, { ...CLEAR, resultSeen: true, liveRunOpen: true }), null);
});

test('pickDialog: a second level in one session waits', () => {
  assert.equal(pickDialog(celebrating(3), { ...CLEAR, shownThisSession: true }), null);
  assert.equal(pickDialog(celebrating(1), { ...CLEAR, shownThisSession: true }), null);
});

test('pickDialog tolerates a missing options bag', () => {
  assert.equal(pickDialog(view({ celebration: { index: 3 } })), 'celebration');
  assert.equal(pickDialog(view({ celebration: { index: 2 } })), null);
});

test('isRunResultRoute / isLiveRunRoute: result routes are saved runs or terminal live ones', () => {
  const statuses = { live: 'running', paused: 'paused', done: 'done', err: 'error', stop: 'stopped' };
  const statusOf = (id) => statuses[id];
  for (const hash of ['#history/proj/abc', 'history/proj/abc', '#history/proj/abc/details/diff']) {
    assert.equal(isRunResultRoute(hash, statusOf), true, hash);
    assert.equal(isLiveRunRoute(hash, statusOf), false, hash);
  }
  for (const hash of ['#running/done', '#running/err', '#running/stop', '#running/done/details', '#running/done/details/cost']) {
    assert.equal(isRunResultRoute(hash, statusOf), true, hash);
    assert.equal(isLiveRunRoute(hash, statusOf), false, hash);
  }
  for (const hash of ['#running/live', '#running/paused', '#running/live/details/log']) {
    assert.equal(isRunResultRoute(hash, statusOf), false, hash);
    assert.equal(isLiveRunRoute(hash, statusOf), true, hash);
  }
  for (const hash of ['', '#', '#runs', '#history', '#history/proj', '#chat/abc', '#running', '#running/unknown']) {
    assert.equal(isRunResultRoute(hash, statusOf), false, hash || '(empty)');
    assert.equal(isLiveRunRoute(hash, statusOf), false, hash || '(empty)');
  }
  assert.equal(isRunResultRoute(undefined, statusOf), false);
  assert.equal(isLiveRunRoute(null, statusOf), false);
});

test('the client no longer posts page-view events (D-19)', () => {
  assert.equal(typeof modelModule.postWorcaLevelEvent, 'undefined');
});

test('tooltipModel never suggests an action whose href is not an in-app hash route', () => {
  const m = tooltipModel(view({ next: [
    { id: 'x', label: 'X', href: 'javascript:alert(1)', done: false },
    { id: 'y', label: 'Y', href: 'https://example.com', done: false },
    { id: 'z', label: 'Z', href: '#runs', done: false },
  ] }));
  assert.deepEqual(m.tryNext.map((a) => a.href), ['#runs']);
});

const teamItem = { id: 'teamSetUp', label: 'Team set up', hint: 'h', href: '#team-policy', kind: 'single', onlyFor: 'team', done: false };
const pickItem = (choices) => ({ id: 'hookedPick', label: 'Pick any 2', hint: 'h', href: null, kind: 'pick', need: 2, done: false, choices });
const choice = (id, done = false) => ({ id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#${id}`, kind: 'single', done });

test('solo tryNext never links to #team-* (A-16)', () => {
  const next = [teamItem, choice('runs'), pickItem([choice('schedules'), choice('marketplace')])];
  const solo = tooltipModel(view({ next, onTeam: false }));
  assert.deepEqual(solo.tryNext.map((a) => a.href), ['#runs', '#schedules']);
  assert.equal(solo.tryNext.some((a) => a.href.startsWith('#team-')), false);
  const team = tooltipModel(view({ next, onTeam: true }));
  assert.equal(team.tryNext[0].href, '#team-policy');
});

test('tooltipModel lists the undone choices of a pick item, skipping done ones, at most two', () => {
  const m = tooltipModel(view({ next: [pickItem([choice('a', true), choice('b'), choice('c'), choice('d')])] }));
  assert.deepEqual(m.tryNext.map((a) => a.href), ['#b', '#c']);
  assert.deepEqual(Object.keys(m.tryNext[0]).sort(), ['hint', 'href', 'label']);
});

test('the model imports browserTimeZone and WORCA_LEVEL_COUNT instead of re-implementing them', () => {
  const src = readFileSync(new URL('../ui/public/worca-level/model.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*browserTimeZone[^}]*\} from '\.\.\/schedule-sheet\.mjs'/);
  assert.match(src, /import \{[^}]*WORCA_LEVEL_COUNT[^}]*\} from '\.\.\/\.\.\/\.\.\/src\/shared\/worca-levels\.mjs'/);
  assert.doesNotMatch(src, /resolvedOptions/);
});

// A minimal DOM: renderSegments only needs createElement, setAttribute, append and className.
function fakeDoc() {
  const mk = (tag) => ({
    tag, className: '', children: [], attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.children.push(c); },
  });
  return { createElement: mk };
}

test('renderSegments builds a progressbar with one span per segment and data-done on the first `done`', () => {
  const el = renderSegments(fakeDoc(), { done: 2, total: 4 }, { size: 'lg' });
  assert.equal(el.tag, 'div');
  assert.equal(el.className, 'wl-seg');
  assert.equal(el.getAttribute('role'), 'progressbar');
  assert.equal(el.getAttribute('aria-valuenow'), '2');
  assert.equal(el.getAttribute('aria-valuemax'), '4');
  assert.equal(el.getAttribute('data-size'), 'lg');
  assert.equal(el.children.length, 4);
  assert.deepEqual(el.children.map((c) => c.getAttribute('data-done')), ['true', 'true', null, null]);
  for (const c of el.children) { assert.equal(c.tag, 'span'); assert.equal(c.className, 'wl-seg-i'); }
});

test('renderSegments clamps done to [0, total]', () => {
  const over = renderSegments(fakeDoc(), { done: 9, total: 3 }, { size: 'sm' });
  assert.equal(over.getAttribute('aria-valuenow'), '3');
  assert.equal(over.children.filter((c) => c.getAttribute('data-done') === 'true').length, 3);
  const under = renderSegments(fakeDoc(), { done: -2, total: 3 }, { size: 'sm' });
  assert.equal(under.getAttribute('aria-valuenow'), '0');
  assert.equal(under.children.filter((c) => c.getAttribute('data-done') === 'true').length, 0);
});

test('renderSegments marks a sm bar of more than 10 segments as dense (gap 2px) and not otherwise', () => {
  const dense = renderSegments(fakeDoc(), { done: 1, total: 30 }, { size: 'sm' });
  assert.equal(dense.children.length, 30);
  assert.equal(dense.getAttribute('data-gap'), '2');
  assert.equal(renderSegments(fakeDoc(), { done: 1, total: 4 }, { size: 'sm' }).getAttribute('data-gap'), null);
  assert.equal(renderSegments(fakeDoc(), { done: 1, total: 30 }, { size: 'lg' }).getAttribute('data-gap'), null);
});

test('pickDialog: shownThisSession blocks a backlog celebration but not a live level-up', () => {
  assert.equal(pickDialog(celebrating(), { ...CLEAR, shownThisSession: true, liveLevelUp: false }), null);
  assert.equal(pickDialog(celebrating(), { ...CLEAR, shownThisSession: true, liveLevelUp: true }), 'celebration');
  assert.equal(pickDialog(celebrating(), { ...CLEAR, menuOpen: true, shownThisSession: true, liveLevelUp: true }), null, 'other gates still hold');
});
