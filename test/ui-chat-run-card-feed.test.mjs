// test/ui-chat-run-card-feed.test.mjs — worca Chat P3: the controller that keeps chat run cards fed (run store frames,
// the tick, the REST hydrate and the finished-run facts) and its registration as the chat's `progress` card.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { snapshotFromState } from '../ui/public/ask-run-card.mjs';
import { createRunCardController, registerChatRunCard, PROGRESS_REHYDRATE_MS } from '../ui/public/chat/run-card.mjs';
import { chatCardBuilder, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { makePanel } from './helpers/ask-panel-harness.mjs';

const trackDom = useDomRelease(afterEach);

const agent = (id, key, over = {}) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true }, ...over });
const MANIFEST = { version: 2, template: { id: 'wf_t', name: 'T' }, graph: { nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer', { x: 300, color: 'green' })],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'task' }, loop: false }] } };
const step = (over) => ({ key: over.executionId, cycle: over.ordinal ?? 1, status: 'done', activeMs: 1000, costUsd: 0.1, startedAt: '2026-08-26T10:00:00Z', ...over });
const STATE = (over = {}) => ({ id: 'abcd1234', title: 'Fix login', projectKey: 'proj-00000001', projectDir: '/repos/proj', status: 'running', stepper: MANIFEST,
  steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1, status: 'running' })], active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }],
  totalCostUsd: 0.1, totalActiveMs: 5000, startedAt: '2026-09-07T10:00:00Z', ...over });
const liveSnap = (over = {}, stateOver = {}) => ({ ...snapshotFromState(STATE(stateOver), { now: 0 }), source: 'live', runId: 'run-uuid-1', ...over });
const BLOCK = { kind: 'card', id: 'card_00000001', state: 'tracked', card: { type: 'progress', pipelineId: 'abcd1234', runId: 'run-uuid-1', projectKey: 'proj-00000001', title: 'Fix login', label: 'proj' } };
const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function fakeStore() {
  const snaps = new Map();
  const subs = new Set();
  return {
    snaps, subs,
    get: (id) => snaps.get(id) || null,
    byPipeline: (pid) => [...snaps.values()].find((s) => s.pipelineId === pid) || null,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    poke(runId, type = 'state') { for (const fn of [...subs]) fn(runId, type); },
  };
}
function env(fetchHandler = null) {
  const dom = trackDom(new JSDOM('<!doctype html><html><body></body></html>'));
  const fetches = [];
  const ctx = { doc: dom.window.document, win: dom.window,
    fetch: (u) => { fetches.push(String(u)); return Promise.resolve(fetchHandler ? fetchHandler(String(u)) : { ok: false, status: 404, json: async () => ({}) }); },
    openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} };
  return { dom, doc: dom.window.document, ctx, fetches };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('controller: a card goes live from the run store, repaints on frames (never on log lines), reads the finished run\'s facts once', async () => {
  const store = fakeStore();
  store.snaps.set('run-uuid-1', liveSnap());
  const extras = { results: { filesChanged: 1, additions: 2, deletions: 0, checks: 0, topFiles: [{ path: 'a.mjs', additions: 2, deletions: 0, status: 'M' }] }, artifacts: [], moreArtifacts: false, pr: null };
  const { doc, ctx, fetches } = env((u) => (u === '/api/ask/runs/abcd1234' ? ok({ state: STATE({ status: 'done', active: [] }), live: null, extras }) : null));
  const ctl = createRunCardController({ controls: { prHost: () => true }, runStore: store, tickMs: 0 });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'working');
  assert.deepEqual(fetches, [], 'a run in the live map is never fetched');
  assert.equal(typeof built.handle.relayout, 'function');
  assert.equal(built.handle.parts.graph, built.el.querySelector('.chat-rc-well'));
  store.snaps.set('run-uuid-1', liveSnap({ status: 'done', terminal: true, active: [] }, { status: 'done', active: [] }));
  store.poke('run-uuid-1', 'log');
  await settle();
  assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'working', 'a log line repaints nothing');
  store.poke('run-uuid-1', 'done');
  await settle();
  assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'ready');
  assert.deepEqual(fetches, ['/api/ask/runs/abcd1234'], 'the finished run\'s facts, once');
  assert.equal(built.el.querySelector('.chat-rc-res-title').textContent, 'Clean: no blocking issues flagged', 'REST facts merged into the live snapshot');
  assert.equal(built.el.querySelector('.chat-rc-file-path').textContent, 'a.mjs');
  store.poke('run-uuid-1', 'state');
  await settle();
  assert.equal(fetches.length, 1, 'not again for the same terminal status');
  built.dispose();
  assert.equal(ctl.size, 0);
  assert.equal(store.subs.size, 0, 'the last card going away unsubscribes');
});

test('controller: REST hydration for runs this tab gets no frames for — on build, then every 30 s while shown; junk never paints', async () => {
  await checkRows([
    { name: 'build hydrates, the tick re-hydrates only after PROGRESS_REHYDRATE_MS, and a hidden card is skipped', run: async () => {
      let t = 1000;
      const store = fakeStore();
      const { doc, ctx, fetches } = env(() => ok({ state: STATE({ status: 'running' }), live: null, extras: null }));
      const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0, now: () => t });
      const built = ctl.build(BLOCK, ctx);
      doc.body.appendChild(built.el);
      await settle();
      assert.equal(fetches.length, 1);
      assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'working', 'painted from REST');
      ctl.tick();
      assert.equal(fetches.length, 1, 'not yet due');
      t += PROGRESS_REHYDRATE_MS;
      const wrapper = doc.createElement('section');
      wrapper.className = 'view hidden';
      doc.body.appendChild(wrapper);
      wrapper.appendChild(built.el);
      ctl.tick();
      assert.equal(fetches.length, 1, 'a card on a hidden view is not polled');
      doc.body.appendChild(built.el);
      ctl.tick();
      await settle();
      assert.equal(fetches.length, 2, 'due and shown: re-hydrated');
      ctl.destroy();
    } },
    { name: 'a junk 200 (no envelope) never paints; a failed hydrate keeps the last paint', run: async () => {
      const store = fakeStore();
      const { doc, ctx } = env(() => ok({ config: {} }));
      const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0 });
      const built = ctl.build(BLOCK, ctx);
      doc.body.appendChild(built.el);
      await settle();
      assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'starting');
      assert.equal(built.el.querySelector('.ask-rc-title').textContent, 'Fix login', 'the identity title');
      ctl.destroy();
    } },
  ]);
});

test('controller: a started run proposal learns its pipeline id from the store, or from the thread\'s run links (ctx.runLinkFor); a failed launch shows its reason', async () => {
  await checkRows([
    { name: 'from the store', run: async () => {
      const store = fakeStore();
      const { doc, ctx, fetches } = env();
      const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0 });
      const built = ctl.build({ kind: 'card', id: 'card_2', state: 'started', runId: 'run-uuid-9', card: { projectKey: 'proj-00000001', projectName: 'proj', title: 'Fix login' } }, ctx);
      doc.body.appendChild(built.el);
      assert.deepEqual(fetches, [], 'no pipeline id yet: nothing to fetch');
      store.snaps.set('run-uuid-9', liveSnap({ runId: 'run-uuid-9' }));
      store.poke('run-uuid-9');
      await settle();
      assert.equal(built.el.querySelector('.ask-rc-sub').textContent, 'proj');
      assert.equal(built.el.querySelector('.chat-rc-where').title, 'Run abcd1234');
      ctl.destroy();
    } },
    { name: 'from the run links after a reload (P1 ctx.runLinkFor), then REST', run: async () => {
      const store = fakeStore();
      const { doc, ctx, fetches } = env(() => ok({ state: STATE({ status: 'done', active: [] }), live: null, extras: null }));
      ctx.runLinkFor = ({ cardId }) => (cardId === 'card_3' ? { runId: 'run-uuid-3', pipelineId: 'abcd1234' } : null);
      const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0 });
      const built = ctl.build({ kind: 'card', id: 'card_3', state: 'started', runId: 'run-uuid-3', card: { projectKey: 'proj-00000001', projectName: 'proj' } }, ctx);
      doc.body.appendChild(built.el);
      await settle();
      assert.deepEqual(fetches, ['/api/ask/runs/abcd1234']);
      assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'ready');
      ctl.destroy();
    } },
    { name: 'a failed launch', run: async () => {
      const { doc, ctx } = env();
      const ctl = createRunCardController({ controls: {}, runStore: fakeStore(), tickMs: 0 });
      const built = ctl.build({ kind: 'card', id: 'card_4', state: 'failed', runId: 'run-uuid-4', error: 'Preflight failed', card: { projectKey: 'p' } }, ctx);
      doc.body.appendChild(built.el);
      assert.equal(built.el.querySelector('.ask-rc-reason').textContent, 'Run failed: Preflight failed');
      ctl.destroy();
    } },
  ]);
});

test('controller: the first load says loading, deleted or unreachable; a painted card keeps its paint (§5a.2)', async () => {
  const LOADING = 'Loading run…';
  const DELETED = 'This run was deleted. The chat keeps what was said about it.';
  const UNREACHABLE = "Could not load this run: Worca's server could not be reached. The card fills in when it is back.";
  const reasonOf = (built) => { const r = built.el.querySelector('.ask-rc-reason'); return r.hidden ? '' : r.textContent; };
  const card = (handler, { now } = {}) => {
    const { doc, ctx } = env(handler);
    const ctl = createRunCardController({ controls: {}, runStore: fakeStore(), tickMs: 0, ...(now ? { now } : {}) });
    const built = ctl.build(BLOCK, ctx);
    doc.body.appendChild(built.el);
    return { ctl, built };
  };
  await checkRows([
    { name: 'in flight: Loading run…', run: async () => {
      const { ctl, built } = card(() => new Promise(() => {}));
      await settle();
      assert.equal(reasonOf(built), LOADING);
      ctl.destroy();
    } },
    { name: 'a 404: the run was deleted', run: async () => {
      const { ctl, built } = card(() => ({ ok: false, status: 404, json: async () => ({}) }));
      await settle();
      assert.equal(reasonOf(built), DELETED);
      ctl.destroy();
    } },
    { name: 'a network error: unreachable', run: async () => {
      const { ctl, built } = card(() => Promise.reject(new TypeError('Failed to fetch')));
      await settle();
      assert.equal(reasonOf(built), UNREACHABLE);
      ctl.destroy();
    } },
    { name: 'painted, then the server goes: the last paint stays, no reason', run: async () => {
      let t = 1000;
      let up = true;
      const { ctl, built } = card(() => (up ? ok({ state: STATE({ status: 'running' }), live: null, extras: null }) : Promise.reject(new TypeError('Failed to fetch'))), { now: () => t });
      await settle();
      assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'working');
      up = false;
      t += PROGRESS_REHYDRATE_MS;
      ctl.tick();
      await settle();
      assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'working', 'the last paint stays');
      assert.equal(reasonOf(built), '');
      ctl.destroy();
    } },
    { name: 'unreachable, then the next hydrate answers: the line goes and the card paints', run: async () => {
      let t = 1000;
      let up = false;
      const { ctl, built } = card(() => (up ? ok({ state: STATE({ status: 'running' }), live: null, extras: null }) : Promise.reject(new TypeError('Failed to fetch'))), { now: () => t });
      await settle();
      assert.equal(reasonOf(built), UNREACHABLE);
      up = true;
      t += PROGRESS_REHYDRATE_MS;
      ctl.tick();
      await settle();
      assert.equal(reasonOf(built), '');
      assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'working');
      ctl.destroy();
    } },
  ]);
});

test('registerChatRunCard registers the controller\'s builder as the chat `progress` card', () => {
  _resetChatExtensions();
  const ctl = registerChatRunCard({ controls: {}, runStore: fakeStore(), tickMs: 0 });
  assert.equal(chatCardBuilder('progress'), ctl.build);
  _resetChatExtensions();
});

test('controller: the finished run\'s facts are re-read on the `done` frame — run-harness persists status done before results.json', async () => {
  const store = fakeStore();
  store.snaps.set('run-uuid-1', liveSnap());
  const extras = { results: { filesChanged: 1, additions: 2, deletions: 0, checks: 0, topFiles: [{ path: 'a.mjs', additions: 2, deletions: 0, status: 'M' }] }, artifacts: [], moreArtifacts: false, pr: null };
  let ready = false;   // results.json lands between the `state` (status done) frame and the `done` frame
  const { doc, ctx, fetches } = env((u) => (u === '/api/ask/runs/abcd1234' ? ok({ state: STATE({ status: 'done', active: [] }), live: null, extras: ready ? extras : { results: null, artifacts: [], moreArtifacts: false, pr: null } }) : null));
  const ctl = createRunCardController({ controls: { prHost: () => true }, runStore: store, tickMs: 0 });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  store.snaps.set('run-uuid-1', liveSnap({ status: 'done', terminal: true, active: [] }, { status: 'done', active: [] }));
  store.poke('run-uuid-1', 'state');
  await settle();
  assert.equal(fetches.length, 1);
  assert.equal(built.el.querySelector('.chat-rc-file-path'), null, 'no results.json yet');
  ready = true;
  store.poke('run-uuid-1', 'done');
  await settle();
  assert.equal(fetches.length, 2, 'the done frame re-reads the facts');
  assert.equal(built.el.querySelector('.chat-rc-file-path').textContent, 'a.mjs');
  built.dispose();
});

test('controller: a `done` frame that lands while the early read is still in flight reads again once it settles', async () => {
  const store = fakeStore();
  store.snaps.set('run-uuid-1', liveSnap());
  const extras = { results: { filesChanged: 1, additions: 2, deletions: 0, checks: 0, topFiles: [{ path: 'a.mjs', additions: 2, deletions: 0, status: 'M' }] }, artifacts: [], moreArtifacts: false, pr: null };
  let n = 0, release = null;
  const { doc, ctx, fetches } = env(() => {
    n += 1;
    if (n === 1) return new Promise((r) => { release = () => r(ok({ state: STATE({ status: 'running' }), live: null, extras: null })); });
    return ok({ state: STATE({ status: 'done', active: [] }), live: null, extras });
  });
  const ctl = createRunCardController({ controls: { prHost: () => true }, runStore: store, tickMs: 0 });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  store.snaps.set('run-uuid-1', liveSnap({ status: 'done', terminal: true, active: [] }, { status: 'done', active: [] }));
  store.poke('run-uuid-1', 'state');
  await settle();
  store.poke('run-uuid-1', 'done');
  await settle();
  release();
  await settle(6);
  assert.equal(fetches.length, 2);
  assert.equal(built.el.querySelector('.chat-rc-file-path').textContent, 'a.mjs');
  built.dispose();
});

test('controller: a finished run paints from its persisted state once read — the hello stub (no steps) never shows every node skipped', async () => {
  const store = fakeStore();
  // after a reload: this tab's model of a finished run is the hello stub — status done, no steps
  store.snaps.set('run-uuid-1', liveSnap({ status: 'done', terminal: true, active: [] }, { status: 'done', active: [], steps: [], totalActiveMs: 0 }));
  const { doc, ctx } = env((u) => (u === '/api/ask/runs/abcd1234' ? ok({ state: STATE({ status: 'done', active: [], steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1 })] }), live: null, extras: null }) : null));
  const ctl = createRunCardController({ controls: { prHost: () => true }, runStore: store, tickMs: 0 });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  await settle();
  assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'ready', 'the persisted state: a finished run');
  assert.equal(built.el.querySelectorAll('.chat-rc-graph .node.is-skipped').length, 0);
  built.dispose();
});

test('controller: a finished run whose facts were not readable yet is read ONE more time after rehydrateMs — never polled', async () => {
  let t = 1000;
  const { doc, ctx, fetches } = env(() => ok({ state: STATE({ status: 'done', active: [] }), live: null, extras: { results: null, artifacts: [], moreArtifacts: false, pr: null } }));
  const ctl = createRunCardController({ controls: {}, runStore: fakeStore(), tickMs: 0, now: () => t });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  await settle();
  assert.equal(fetches.length, 1);
  ctl.tick();
  assert.equal(fetches.length, 1, 'not before rehydrateMs');
  t += PROGRESS_REHYDRATE_MS;
  ctl.tick();
  await settle();
  assert.equal(fetches.length, 2, 'the one late read');
  t += PROGRESS_REHYDRATE_MS;
  ctl.tick();
  await settle();
  assert.equal(fetches.length, 2, 'and no poll after it');
  ctl.destroy();
});

test('controller: the 1 s tick repaints a live card from the store; a 200 for ANOTHER pipeline never paints', async () => {
  await checkRows([
    { name: 'tick', run: async () => {
      const store = fakeStore();
      store.snaps.set('run-uuid-1', liveSnap({ elapsedMs: 5000 }));
      const { doc, ctx } = env();
      const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0 });
      const built = ctl.build(BLOCK, ctx);
      doc.body.appendChild(built.el);
      assert.equal(built.el.querySelector('.ask-rc-time').textContent, '5s');
      store.snaps.set('run-uuid-1', liveSnap({ elapsedMs: 65000 }));   // the clock moved; no frame
      ctl.tick();
      assert.equal(built.el.querySelector('.ask-rc-time').textContent, '1m 5s');
      ctl.destroy();
    } },
    { name: 'another pipeline\'s state', run: async () => {
      const { doc, ctx } = env(() => ok({ state: STATE({ id: 'ffff0000', title: 'Someone else' }), live: null, extras: null }));
      const ctl = createRunCardController({ controls: {}, runStore: fakeStore(), tickMs: 0 });
      const built = ctl.build(BLOCK, ctx);
      doc.body.appendChild(built.el);
      await settle();
      assert.equal(built.el.querySelector('.ask-rc-title').textContent, 'Fix login');
      assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'starting');
      ctl.destroy();
    } },
  ]);
});

test('controller: a REST read taken before a resume (interrupted) never paints over the new lineage\'s end', async () => {
  const extras = { results: { filesChanged: 1, additions: 2, deletions: 0, checks: 0, topFiles: [{ path: 'a.mjs', additions: 2, deletions: 0, status: 'M' }] }, artifacts: [], moreArtifacts: false, pr: null };
  await checkRows([
    { name: 'the end\'s terminal `state` frame (before `done`) paints the new lineage, and reads its facts', run: async () => {
      const store = fakeStore();
      let rest = { state: STATE({ status: 'interrupted', active: [] }), live: null, extras: null };   // after a server restart
      const { doc, ctx, fetches } = env((u) => (u === '/api/ask/runs/abcd1234' ? ok(rest) : null));
      const ctl = createRunCardController({ controls: { prHost: () => true }, runStore: store, tickMs: 0 });
      const built = ctl.build(BLOCK, ctx);
      doc.body.appendChild(built.el);
      await settle();
      assert.equal(built.el.dataset.runStatus, 'interrupted');
      store.snaps.set('run-new', liveSnap({ runId: 'run-new' }));          // resumed from the card: a new lineage
      store.poke('run-new', 'state');
      await settle();
      store.snaps.set('run-new', liveSnap({ runId: 'run-new', status: 'done', terminal: true, active: [] }, { status: 'done', active: [] }));
      store.poke('run-new', 'state');
      await settle();
      assert.equal(built.el.dataset.runStatus, 'done', 'the new lineage\'s end, not the interrupted read');
      assert.equal(built.el.querySelector('.chat-rc-foot').hidden, true, 'no Resume on a finished run');
      rest = { state: STATE({ status: 'done', active: [] }), live: null, extras };
      store.poke('run-new', 'done');
      await settle();
      assert.equal(built.el.querySelector('.chat-rc-file-path').textContent, 'a.mjs');
      assert.equal(fetches.length, 3, 'build, the terminal status, the done frame');
      ctl.destroy();
    } },
    { name: 'a socket gap: the reconnect hello alone (no `state`/`done` frame) still reads the end', run: async () => {
      const store = fakeStore();
      let rest = { state: STATE({ status: 'interrupted', active: [] }), live: null, extras: null };
      const { doc, ctx, fetches } = env((u) => (u === '/api/ask/runs/abcd1234' ? ok(rest) : null));
      const ctl = createRunCardController({ controls: { prHost: () => true }, runStore: store, tickMs: 0 });
      const built = ctl.build(BLOCK, ctx);
      doc.body.appendChild(built.el);
      await settle();
      store.snaps.set('run-new', liveSnap({ runId: 'run-new' }));
      store.poke('run-new', 'state');
      await settle();
      rest = { state: STATE({ status: 'done', active: [] }), live: null, extras };   // it ended while the socket was down
      store.snaps.set('run-new', liveSnap({ runId: 'run-new', status: 'done', terminal: true, active: [] }, { status: 'done', active: [] }));
      store.poke(null, 'hello');
      await settle();
      assert.equal(built.el.dataset.runStatus, 'done');
      assert.equal(built.el.querySelector('.chat-rc-res-title').textContent, 'Clean: no blocking issues flagged');
      assert.equal(fetches.length, 2);
      ctl.destroy();
    } },
  ]);
});

test('controller: a stopped run whose read raced its results.json gets the ONE late read too (no `done` frame reached the tab)', async () => {
  let t = 1000, ready = false;
  const extras = { results: { filesChanged: 1, additions: 2, deletions: 0, checks: 0, topFiles: [{ path: 'a.mjs', additions: 2, deletions: 0, status: 'M' }] }, artifacts: [], moreArtifacts: false, pr: null };
  const store = fakeStore();
  store.snaps.set('run-uuid-1', liveSnap());
  const { doc, ctx, fetches } = env(() => ok({ state: STATE({ status: ready ? 'stopped' : 'running' }), live: null, extras: ready ? extras : null }));
  const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0, now: () => t });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  store.snaps.set('run-uuid-1', liveSnap({ status: 'stopped', terminal: true, active: [] }, { status: 'stopped', active: [] }));
  store.poke('run-uuid-1', 'state');                                  // the row still reads running: no facts yet
  await settle();
  assert.equal(fetches.length, 1);
  ready = true;
  t += PROGRESS_REHYDRATE_MS;
  ctl.tick();
  await settle();
  assert.equal(fetches.length, 2, 'the one late read');
  assert.equal(built.el.querySelector('.chat-rc-file-path').textContent, 'a.mjs');
  ctl.destroy();
});

test('controller: the tick never reads a run that is live in this tab', async () => {
  let t = 1000;
  const store = fakeStore();
  store.snaps.set('run-uuid-1', liveSnap());
  const { doc, ctx, fetches } = env();
  const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0, now: () => t });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  ctl.tick();
  t += PROGRESS_REHYDRATE_MS;
  ctl.tick();
  await settle();
  assert.deepEqual(fetches, []);
  ctl.destroy();
});

test('controller: a REST read older than the store\'s finished run never repaints it as running', async () => {
  const store = fakeStore();
  store.snaps.set('run-uuid-1', liveSnap({ status: 'done', terminal: true, active: [] }, { status: 'done', active: [] }));
  const { doc, ctx } = env(() => ok({ state: STATE({ status: 'running' }), live: null, extras: null }));
  const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0 });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  await settle();
  assert.equal(built.el.querySelector('.chat-rc-status').dataset.state, 'ready');
  ctl.destroy();
});

test('controller: a `done` frame re-reads only the cards of THAT run; the late read is only for a finished run whose facts are missing (never an interrupted one, never one that has them)', async () => {
  const store = fakeStore();
  store.snaps.set('run-uuid-1', liveSnap({ status: 'done', terminal: true, active: [] }, { status: 'done', active: [] }));
  const one = env((u) => (u === '/api/ask/runs/abcd1234' ? ok({ state: STATE({ status: 'done', active: [] }), live: null, extras: null }) : null));
  const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0 });
  const built = ctl.build(BLOCK, one.ctx);
  one.doc.body.appendChild(built.el);
  await settle();
  assert.equal(one.fetches.length, 1);
  store.poke('run-uuid-OTHER', 'done');
  await settle();
  assert.equal(one.fetches.length, 1, 'another run finishing re-reads nothing here');
  ctl.destroy();
  const FACTS = { results: { filesChanged: 0, additions: 0, deletions: 0, checks: 0, topFiles: [] }, artifacts: [], moreArtifacts: false, pr: null };
  for (const [state, extras] of [[STATE({ status: 'interrupted', active: [] }), null], [STATE({ status: 'done', active: [] }), FACTS]]) {
    let t = 1000;
    const { doc, ctx, fetches } = env(() => ok({ state, live: null, extras }));
    const c2 = createRunCardController({ controls: {}, runStore: fakeStore(), tickMs: 0, now: () => t });
    const b2 = c2.build(BLOCK, ctx);
    doc.body.appendChild(b2.el);
    await settle();
    t += PROGRESS_REHYDRATE_MS;
    c2.tick();
    await settle();
    assert.equal(fetches.length, 1, `${state.status}${extras ? ' with its facts' : ''}: read once`);
    c2.destroy();
  }
});

test('S9: the control the user is in, inside the card, keeps the focus (and its value) when ask-panel rebuilds the transcript — Chrome restores the caret with the focus', async () => {
  _resetChatExtensions();
  const store = fakeStore();
  const ask = { id: 'q-1', kind: 'questions', nodeId: 'n_plan', questions: [{ id: 'q1', question: 'Which database?', options: [] }] };
  store.snaps.set('run-uuid-1', liveSnap({ pendingQuestion: ask }));
  // The run page renderer's stand-in: a free-text field, mounted once per question (chatPaintQuestion's identity rule).
  const controls = { releaseQuestion: () => {}, paintQuestion: (ref, host) => {
    const panel = host.querySelector('.qpanel');
    if (!panel.querySelector('input')) { panel.innerHTML = '<input class="qfree" type="text">'; panel.classList.remove('hidden'); }
    return { id: 'q-1', kind: 'clarify', heading: 'A question from Planner', step: 'Planner' };
  } };
  const ctl = registerChatRunCard({ controls, runStore: store, tickMs: 0 });
  const TID = 'ask_00000001';
  const snap = { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: '', blocks: [BLOCK], status: 'done', createdAt: 't' }],
    attachments: [], runLinks: [], worktrees: [], inFlight: null };
  const ctx = makePanel({ fetchHandler: (url) => ({ ok: true, status: 200, json: async () => (url.startsWith(`/api/ask/threads/${TID}`) ? snap : {}) }) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  for (let i = 0; i < 6; i++) await ctx.tick();
  ctx.flush();
  const card = ctx.doc.querySelector('.chat-rc');
  const field = card.querySelector('.chat-rc-q .qfree');
  assert.ok(field, 'the question field is in the card');
  let seq = 1;
  // A new thread row (a follower notice, a direction row): renderTranscript re-appends the cached card in a new row.
  const newRow = async () => {
    seq += 1;
    ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID,
      message: { id: `askm_0000001${seq}`, threadId: TID, seq, role: 'system', text: `note ${seq}`, blocks: [{ kind: 'notice', text: `note ${seq}` }], status: null, createdAt: 't' } });
    ctx.flush();
    await ctx.tick();
  };
  await checkRows([
    { name: 'a new row: the field keeps the focus, its value and its selection', run: async () => {
      field.focus();
      field.value = 'Postgres 16';
      field.setSelectionRange(3, 5);
      const row = card.parentNode;
      await newRow();
      assert.notEqual(card.parentNode, row, 'the card was re-appended into a new row');
      assert.equal(ctx.doc.activeElement, field);
      assert.deepEqual([field.selectionStart, field.selectionEnd], [3, 5]);
      assert.equal(field.value, 'Postgres 16');
    } },
    { name: 'a blur by code is not undone by an unrelated change; after a press elsewhere a new row leaves the focus alone', run: async () => {
      field.focus();
      field.blur();
      ctx.doc.body.appendChild(ctx.doc.createElement('div'));
      await ctx.tick();
      assert.notEqual(ctx.doc.activeElement, field);
      field.focus();
      ctx.doc.body.dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true }));
      field.blur();
      await newRow();
      assert.notEqual(ctx.doc.activeElement, field);
    } },
    { name: 'a focus the page moved elsewhere while the card was out stays there', run: async () => {
      field.focus();
      const input = ctx.doc.querySelector('textarea.ask-input');
      card.remove();
      input.focus();
      await newRow();
      assert.equal(ctx.doc.activeElement, input);
    } },
    { name: 'a field that cannot take the focus (busy) ends the watch: enabled again, the next row leaves the focus alone', run: async () => {
      ctx.doc.activeElement.blur();
      field.focus();
      field.disabled = true;
      await newRow();
      assert.notEqual(ctx.doc.activeElement, field);
      field.disabled = false;
      await newRow();
      assert.notEqual(ctx.doc.activeElement, field);
    } },
    { name: 'tabbed out to the composer, which then loses the focus by code: a new row leaves the focus alone', run: async () => {
      field.focus();
      const input = ctx.doc.querySelector('textarea.ask-input');
      input.focus();
      input.blur();
      await newRow();
      assert.notEqual(ctx.doc.activeElement, field);
    } },
    { name: 'focused again after a watch ended: the field is kept again', run: async () => {
      ctx.doc.activeElement.blur();
      field.focus();
      await newRow();
      assert.equal(ctx.doc.activeElement, field);
    } },
    { name: 'Chrome\'s blur while ask-panel moves the card (focusout, no relatedTarget, the field still connected) does not end the watch', run: async () => {
      ctx.doc.activeElement.blur();
      field.focus();
      field.dispatchEvent(new ctx.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }));   // jsdom fires none on a move
      await newRow();
      assert.equal(ctx.doc.activeElement, field);
    } },
    { name: 'a press inside the field (moving the caret) keeps the watch', run: async () => {
      ctx.doc.activeElement.blur();
      field.focus();
      field.dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true }));
      await newRow();
      assert.equal(ctx.doc.activeElement, field);
    } },
    { name: 'a press on the card outside the field (its title) ends the watch: the blur that follows is not undone', run: async () => {
      ctx.doc.activeElement.blur();
      field.focus();
      card.querySelector('.ask-rc-title').dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true }));
      field.blur();
      await newRow();
      assert.notEqual(ctx.doc.activeElement, field);
    } },
    { name: 'a focus the page moved elsewhere while the card was out ends the watch: that control losing the focus later leaves the field alone', run: async () => {
      ctx.doc.activeElement.blur();
      field.focus();
      const input = ctx.doc.querySelector('textarea.ask-input');
      card.remove();
      input.focus();
      await newRow();
      assert.equal(ctx.doc.activeElement, input);
      input.blur();
      await newRow();
      assert.notEqual(ctx.doc.activeElement, field);
    } },
    { name: 'the refocus never scrolls the transcript (preventScroll)', run: async () => {
      ctx.doc.activeElement.blur();
      field.focus();
      const seen = [];
      const own = field.focus;
      field.focus = function spy(o) { seen.push(o); return own.call(this, o); };
      try { await newRow(); } finally { delete field.focus; }
      assert.equal(ctx.doc.activeElement, field);
      assert.deepEqual(seen, [{ preventScroll: true }]);
    } },
    { name: 'disposing the card ends the watch', run: async () => {
      field.focus();
      let cut = 0;
      const proto = ctx.window.MutationObserver.prototype;
      const disconnect = proto.disconnect;
      proto.disconnect = function counted() { cut += 1; return disconnect.call(this); };
      ctl.destroy();
      proto.disconnect = disconnect;
      assert.equal(cut, 1);
    } },
  ]);
  ctx.panel.destroy();
  _resetChatExtensions();
});

test('controller: a failed (error) run whose read raced its results.json gets the ONE late read too — run-harness builds the results between the `error` state and `done`', async () => {
  let t = 1000, ready = false;
  const extras = { results: { filesChanged: 1, additions: 2, deletions: 0, checks: 0, topFiles: [{ path: 'a.mjs', additions: 2, deletions: 0, status: 'M' }] }, artifacts: [], moreArtifacts: false, pr: null };
  const store = fakeStore();
  store.snaps.set('run-uuid-1', liveSnap());
  const { doc, ctx, fetches } = env(() => ok({ state: STATE({ status: ready ? 'error' : 'running' }), live: null, extras: ready ? extras : null }));
  const ctl = createRunCardController({ controls: {}, runStore: store, tickMs: 0, now: () => t });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  store.snaps.set('run-uuid-1', liveSnap({ status: 'error', terminal: true, active: [] }, { status: 'error', active: [] }));
  store.poke('run-uuid-1', 'state');                                  // the row still reads running: no facts yet
  await settle();
  assert.equal(fetches.length, 1);
  ready = true;
  t += PROGRESS_REHYDRATE_MS;
  ctl.tick();
  await settle();
  assert.equal(fetches.length, 2, 'the one late read');
  assert.equal(built.el.querySelector('.chat-rc-file-path').textContent, 'a.mjs');
  ctl.destroy();
});

test('controller: a card\'s own Stop / Create PR re-reads EVERY card of that run — a second card of a saved paused run hears no frame', async () => {
  let status = 'paused';
  const { doc, ctx, fetches } = env((u) => (u === '/api/ask/runs/abcd1234' ? ok({ state: STATE({ status, active: [] }), live: null, extras: null }) : null));
  const stops = [];
  const ctl = createRunCardController({ controls: { prHost: () => true, stop: (ref, onStopped) => { stops.push(ref.pipelineId); status = 'stopped'; onStopped(); } }, tickMs: 0 });
  const a = ctl.build(BLOCK, ctx);
  const b = ctl.build({ ...BLOCK, id: 'card_00000002', state: 'started', runId: 'run-uuid-1', card: { type: 'progress', pipelineId: 'abcd1234', title: 'Fix login' } }, ctx);
  const other = ctl.build({ ...BLOCK, id: 'card_00000003', card: { ...BLOCK.card, pipelineId: 'beef0001', runId: 'beef0001' } }, ctx);
  doc.body.append(a.el, b.el, other.el);
  await settle();
  assert.deepEqual([a.el.dataset.runStatus, b.el.dataset.runStatus], ['paused', 'paused']);
  const before = fetches.filter((u) => u === '/api/ask/runs/beef0001').length;
  a.el.querySelector('.chat-rc-stop').click();
  await settle();
  assert.deepEqual(stops, ['abcd1234']);
  assert.deepEqual([a.el.dataset.runStatus, b.el.dataset.runStatus], ['stopped', 'stopped'], 'the other card of the run no longer offers Resume');
  assert.equal(fetches.filter((u) => u === '/api/ask/runs/beef0001').length, before, 'a card of another run is not re-read');
  ctl.destroy();
});

test('controller: a card\'s own Stop that lands while a read is in flight is read again once that read ends (never dropped)', async () => {
  let status = 'paused';
  let hold = null;
  const { doc, ctx, fetches } = env((u) => {
    if (u !== '/api/ask/runs/abcd1234') return null;
    const body = ok({ state: STATE({ status, active: [] }), live: null, extras: null });   // the row as it reads NOW
    return hold ? hold.then(() => body) : body;
  });
  let t = 0;
  const ctl = createRunCardController({ controls: { stop: (ref, onStopped) => { status = 'stopped'; onStopped(); } }, now: () => t, tickMs: 0 });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  await settle();
  assert.equal(built.el.dataset.runStatus, 'paused');
  let release;
  hold = new Promise((r) => { release = r; });
  t += PROGRESS_REHYDRATE_MS;
  ctl.tick();                                          // the 30 s re-read leaves while the row still reads paused
  assert.equal(fetches.length, 2);
  built.el.querySelector('.chat-rc-stop').click();     // stopped on the server while that read is out
  hold = null;
  release();
  await settle(6);
  assert.equal(fetches.length, 3, 'the refresh reads again once the in-flight read ends');
  assert.equal(built.el.dataset.runStatus, 'stopped');
  ctl.destroy();
});

test('controller: a finished run without a project re-reads its facts on the artifact frames its teardown sends after `done`', async () => {
  const store = fakeStore();
  const NP = { projectKey: 'no-project-00000000', projectDir: '/h/.worca-cc/runs/abcd1234/work', workMode: 'none', branch: { workMode: 'none', runRootMode: 'detached' } };
  store.snaps.set('run-uuid-1', liveSnap({ status: 'done', terminal: true, active: [] }, { status: 'done', active: [], ...NP }));
  let harvested = false;
  const extras = () => ({ results: null, moreArtifacts: false, pr: null,
    artifacts: harvested ? [{ kind: 'work', relPath: 'work/deck.html', bytes: 86016, nodeId: null, cycle: null }] : [], artifactsTotal: harvested ? 1 : 0 });
  const { doc, ctx, fetches } = env((u) => (u === '/api/ask/runs/abcd1234' ? ok({ state: STATE({ status: 'done', active: [], ...NP }), live: null, extras: extras() }) : null));
  const ctl = createRunCardController({ controls: { prHost: () => true }, runStore: store, tickMs: 0 });
  const built = ctl.build(BLOCK, ctx);
  doc.body.appendChild(built.el);
  store.poke('run-uuid-1', 'done');
  await settle(6);
  const n = fetches.length;
  assert.equal(built.el.querySelector('.chat-rc-arts-list'), null, 'the teardown has not indexed work/ yet');
  harvested = true;
  store.poke('run-uuid-1', 'artifact');
  await settle(6);
  assert.equal(fetches.length, n + 1, 'the artifact frame re-reads the facts, once');
  assert.equal(built.el.querySelector('.chat-rc-arts-list .cap').textContent, 'Artifacts · 1');
  store.snaps.set('run-uuid-1', liveSnap({ status: 'done', terminal: true, active: [] }, { status: 'done', active: [] }));
  store.poke('run-uuid-1', 'artifact');
  await settle(6);
  built.dispose();
});

test('controller: a fix card\'s outcome patch reaches the same card element (handle.blockChanged), with the pipeline id', async () => {
  const store = fakeStore();
  const { doc, ctx } = env();
  const ctl = createRunCardController({ runStore: store, tickMs: 0 });
  const FIX = { ...BLOCK, card: { ...BLOCK.card, pipelineId: null, fix: { prUrl: 'https://x/pull/7', triggerLabel: 'Failing checks' } } };
  const built = ctl.build(FIX, ctx);
  doc.body.appendChild(built.el);
  assert.equal(typeof built.handle.blockChanged, 'function');
  built.handle.blockChanged({ ...FIX, card: { ...FIX.card, pipelineId: 'abcd1234', fix: { ...FIX.card.fix, outcome: { kind: 'failed', reason: 'fix-failed' } } } });
  assert.equal(built.el.querySelector('.chat-rc-fix-out').textContent, 'Not pushed: the fix run failed');
  assert.ok(built.el.querySelector('.chat-rc-where').title.includes('abcd1234'), 'the pipeline id from the patch, in the tooltip');
  assert.ok(!built.el.textContent.includes('#abcd1234'), 'run 4 D20: never in visible text');
  built.dispose(); ctl.destroy();
});

test('panel: a PR fix-run card on a system row renders as the chat run card; its outcome frame repaints the same element', async () => {
  _resetChatExtensions();
  const store = fakeStore();
  registerChatRunCard({ runStore: store, tickMs: 0 });
  const TID = 'ask_00000002';
  const FIX = { kind: 'card', id: 'card_0000f001', state: 'tracked', card: { type: 'progress', pipelineId: null, runId: 'run-uuid-1', projectKey: 'proj-00000001',
    workspaceId: null, title: 'Fix PR #7 feedback', label: 'proj', status: 'starting', fix: { prUrl: 'https://x/pull/7', triggerLabel: 'Failing checks' } } };
  const row = (blocks) => ({ id: 'askm_0000f001', threadId: TID, seq: 2, role: 'system', text: 'PR watch started a fix run on https://x/pull/7: Failing checks', blocks, status: null, createdAt: 't' });
  const snap = { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [row([FIX])], attachments: [], runLinks: [{ runId: 'run-uuid-1', pipelineId: null, cardId: 'card_0000f001', status: 'starting', phase: null }], worktrees: [], inFlight: null };
  const ctx = makePanel({ fetchHandler: (url) => ({ ok: true, status: 200, json: async () => (url.startsWith(`/api/ask/threads/${TID}`) ? snap : {}) }) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  for (let i = 0; i < 6; i++) await ctx.tick();
  ctx.flush();
  const card = ctx.doc.querySelector('.ask-msg-system .chat-rc');
  assert.ok(card, 'the card renders on the system row');
  assert.equal(card.querySelector('.kind-chip').textContent, 'PR fix run');
  const settled = { ...FIX, card: { ...FIX.card, pipelineId: 'abcd1234', fix: { ...FIX.card.fix, outcome: { kind: 'pushed', sha: 'abc1234', stopped: null, fixRuns: 1 } } } };
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: row([settled]), unread: true });
  ctx.flush();
  const again = ctx.doc.querySelector('.ask-msg-system .chat-rc');
  assert.equal(again, card, 'blockChanged kept the element');
  assert.equal(again.querySelector('.chat-rc-fix-out').textContent, 'Pushed the fix (abc1234)');
});
