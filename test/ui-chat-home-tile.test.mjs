// test/ui-chat-home-tile.test.mjs — worca Chat P6: one run tile on the Chat home. The Running list's pill, the
// "N/M agents · dur · $cost" line, Answer while the run waits, and the Workflows-style graph mounted through
// run-hosts (look-only, framed on the running step) — repainted in place, torn down on destroy.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createRunTile, tileBag, tileStats, tileSub, decidingText, TILE_GRAPH_MODE, DECIDING_TEXT } from '../ui/public/chat/home-run-tile.mjs';
import { decorFromState } from '../ui/public/graph/run-decor.mjs';

const trackDom = useDomRelease(afterEach);

const MANIFEST = {
  version: 2, template: { id: 'wf_t', name: 'T' },
  graph: {
    nodes: [
      { id: 'n_a', kind: 'agent', key: 'planner', x: 0, y: 0, label: 'Planner', color: 'violet',
        ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'plan', type: 'md', when: 'always' }], await: true } },
      { id: 'n_end', kind: 'end', key: null, x: 400, y: 0, label: 'End', color: '',
        ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } },
    ],
    wires: [{ id: 'w1', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
  },
};
const decorOf = () => decorFromState({ stepper: MANIFEST, status: 'running', steps: [], active: [] }, { live: true, now: 0 });
function snap(over = {}) {
  return {
    source: 'live', key: 'live:r1', runId: 'r1', pipelineId: 'p1', projectKey: null, workspaceId: null,
    title: 'Fix the upload test', project: 'worca-cc', workflow: 'T', status: 'running', pauseReason: null,
    pendingQuestion: null, live: true, terminal: false, elapsedMs: 252000, costUsd: 1.2, progress: { done: 2, total: 5 },
    active: [], stepper: MANIFEST, decor: decorOf(), ...over,
  };
}
function mount(s) {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = dom.window.document;
  const seen = [];
  const tile = createRunTile({ doc, snap: s, onOpen: (x) => seen.push(['open', x.key]), onAnswer: (x) => seen.push(['answer', x.key]) });
  doc.body.appendChild(tile.el);
  return { doc, tile, seen };
}

test('a tile: title, project · workflow, the Running list pill, the stats line and a look-only graph in its dotted well', () => {
  const { tile } = mount(snap());
  const el = tile.el;
  assert.equal(el.tagName, 'ARTICLE');
  assert.equal(el.dataset.tileKey, 'live:r1');
  assert.equal(el.querySelector('button.chat-run-tile-open').textContent, 'Fix the upload test');
  assert.equal(el.querySelector('.chat-run-tile-sub').textContent, 'worca-cc · T');
  const pill = el.querySelector('.chat-run-tile-pill');
  assert.ok(pill.classList.contains('st-peach'));
  assert.equal(pill.querySelector('.chat-run-tile-pt').textContent, 'Running');
  assert.equal(el.querySelector('.chat-run-tile-stats').textContent, '2/5 agents · 4m 12s · $1.20');
  assert.equal(el.querySelector('.chat-run-tile-answer').hidden, true);
  const well = el.querySelector('.run-flow-wrap.chat-run-tile-well');
  assert.equal(well.getAttribute('role'), 'img');
  assert.equal(well.getAttribute('aria-label'), 'Workflow graph');
  assert.equal(TILE_GRAPH_MODE, 'focus');
  assert.ok(well.classList.contains('gv-wrap-focus'), 'mounted through run-hosts in focus mode');
  assert.equal(well.querySelector('.run-flow').hasAttribute('inert'), true, 'look-only: no tab stop on the stage or its cards');
  assert.ok(well.querySelector('.run-flow.gv-host .gv-stage'), 'the shared renderer drew the graph');
  assert.ok(el.querySelector('.gv-world [data-node-id="n_a"]'), 'the agent card is in the world');
  assert.equal(el.classList.contains('is-need'), false);
});

test('a waiting run wears the amber wash and an Answer button; Answer and the title route separately', () => {
  const { tile, seen } = mount(snap({ pendingQuestion: { kind: 'clarify', questions: [{ id: 'q1' }] } }));
  const pill = tile.el.querySelector('.chat-run-tile-pill');
  assert.ok(pill.classList.contains('st-amber'));
  assert.equal(pill.textContent, 'Waiting for your answer');
  assert.ok(tile.el.classList.contains('is-need'));
  const answer = tile.el.querySelector('.chat-run-tile-answer');
  assert.equal(answer.hidden, false);
  assert.equal(answer.textContent, 'Answer');
  answer.click();
  tile.el.querySelector('.chat-run-tile-open').click();
  assert.deepEqual(seen, [['answer', 'live:r1'], ['open', 'live:r1']]);
  tile.setBusy(true);
  assert.equal(tile.el.getAttribute('aria-busy'), 'true');
  assert.equal(answer.getAttribute('aria-disabled'), 'true');
  assert.equal(answer.disabled, false, 'never `disabled`: the focus stays on the button while the route looks up a chat');
  answer.click();
  tile.el.querySelector('.chat-run-tile-open').click();
  assert.equal(seen.length, 2, 'a busy tile routes nothing');
  tile.setBusy(false);
  assert.equal(answer.hasAttribute('aria-disabled'), false);
  answer.click();
  assert.deepEqual(seen.at(-1), ['answer', 'live:r1'], 'routes again once the lookup is over');
});

test('update() repaints in place: same element, same graph mount; a paused run gets the wash without Answer', () => {
  const s = snap();
  const { tile } = mount(s);
  const el = tile.el;
  const stage = el.querySelector('.gv-stage');
  tile.update(snap({ title: 'Renamed', decor: s.decor, elapsedMs: 0, costUsd: null }));
  assert.equal(tile.el, el);
  assert.equal(el.querySelector('.gv-stage'), stage, 'no remount for the same node set');
  assert.equal(el.querySelector('.chat-run-tile-open').textContent, 'Renamed');
  assert.equal(el.querySelector('.chat-run-tile-stats').textContent, '2/5 agents');
  tile.update(snap({ status: 'paused', pauseReason: 'cost_pipeline', decor: s.decor }));
  assert.equal(el.querySelector('.chat-run-tile-pill').textContent, 'Paused · cost limit');
  assert.ok(el.classList.contains('is-need'));
  assert.equal(el.querySelector('.chat-run-tile-answer').hidden, true);
  assert.equal(tile.snapshot.status, 'paused');
});

test('no manifest hides the well; Auto deciding says so; destroy tears the mount down', () => {
  const bare = mount(snap({ stepper: null, decor: null }));
  assert.ok(bare.tile.el.classList.contains('is-nograph'));
  assert.equal(bare.tile.el.querySelector('.gv-host'), null);
  const deciding = mount(snap({ stepper: { ...MANIFEST, auto: { status: 'deciding' } } }));
  const note = deciding.tile.el.querySelector('.chat-run-tile-note');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, DECIDING_TEXT);
  assert.equal(DECIDING_TEXT, 'Auto is deciding the workflow…');
  assert.equal(deciding.tile.el.classList.contains('is-nograph'), false, 'the well stays for the deciding line');
  assert.equal(deciding.tile.el.querySelector('.gv-host'), null);
  const live = mount(snap());
  assert.ok(live.tile.el.querySelector('.gv-host'));
  live.tile.destroy();
  assert.equal(live.tile.el.querySelector('.gv-host'), null);
  assert.equal(live.tile.el.querySelector('.gv-stage'), null);
});

test('helpers: the stats line drops what is unknown; the bag drops expert detail and is memoised per decor generation', () => {
  assert.equal(tileStats({ progress: null, elapsedMs: 0, costUsd: null }), '');
  assert.equal(tileStats({ progress: { done: 0, total: 3 }, elapsedMs: 5000, costUsd: null }), '0/3 agents · 5s');
  assert.equal(tileStats({ progress: { done: 1, total: 1 }, elapsedMs: 0, costUsd: 0.004 }), '1/1 agents · <$0.01');
  assert.equal(tileSub({ project: 'worca-cc', workflow: '' }), 'worca-cc');
  const d = decorOf();
  const b = tileBag(d);
  assert.equal(tileBag(d), b, 'one bag per decor generation (run-hosts skips an identical bag)');
  assert.equal(b.detail, false);
  assert.equal(b.expanded, null);
  assert.equal(d.detail, undefined, 'the shared bag is never mutated');
  assert.equal(tileBag(null), null);
});

test('a graph that goes away (Auto deciding again, no manifest) takes its mount with it', () => {
  const s = snap();
  const { tile } = mount(s);
  assert.ok(tile.el.querySelector('.gv-host'));
  tile.update(snap({ stepper: { ...MANIFEST, auto: { status: 'deciding' } }, decor: s.decor }));
  assert.equal(tile.el.querySelector('.gv-host'), null);
  assert.equal(tile.el.querySelector('.chat-run-tile-note').hidden, false);
  assert.equal(tileStats({ progress: { done: 0, total: 0 }, elapsedMs: 0, costUsd: null }), '', 'no "0/0 agents"');
});

test('the deciding line uses the run page\'s words: waiting on its proposal, parked, or over never reads "deciding"', () => {
  const auto = { ...MANIFEST, auto: { status: 'deciding' } };
  const { tile } = mount(snap({ stepper: auto, pendingQuestion: { kind: 'workflow' } }));
  assert.equal(tile.el.querySelector('.chat-run-tile-note').textContent, 'Waiting for your decision');
  assert.equal(tile.el.querySelector('.chat-run-tile-well').getAttribute('aria-label'), 'Waiting for your decision',
    'role="img" hides the note from screen readers: the well is named by it');
  tile.update(snap({ stepper: auto, status: 'paused' }));
  assert.equal(tile.el.querySelector('.chat-run-tile-note').textContent, 'Paused before deciding');
  assert.equal(tile.el.querySelector('.chat-run-tile-well').getAttribute('aria-label'), 'Paused before deciding');
  tile.update(snap());
  assert.equal(tile.el.querySelector('.chat-run-tile-well').getAttribute('aria-label'), 'Workflow graph', 'decided: the graph again');
  assert.equal(decidingText({ status: 'interrupted' }), 'Paused before deciding');
  assert.equal(decidingText({ status: 'stopped' }), 'Auto did not decide a workflow');
  assert.equal(decidingText({ status: 'done' }), 'Auto did not decide a workflow');
  assert.equal(decidingText({ status: 'running' }), DECIDING_TEXT);
});

test('a decided Auto run draws its graph; a pausing run is "paused before deciding"; a busy tile marks its title aria-disabled too', () => {
  const { tile } = mount(snap({ stepper: { ...MANIFEST, auto: { status: 'decided' } } }));
  assert.ok(tile.el.querySelector('.gv-host'), 'only a stepper that is still deciding hides the graph');
  assert.equal(tile.el.querySelector('.chat-run-tile-note').hidden, true);
  assert.equal(decidingText({ status: 'pausing' }), 'Paused before deciding');
  tile.setBusy(true);
  assert.equal(tile.el.querySelector('.chat-run-tile-open').getAttribute('aria-disabled'), 'true');
});

test('D16: a slice snapshot titles the tile "Slice 2 of 3 · Run tags"; without `slice` the title is unchanged', () => {
  const { tile } = mount(snap({ slice: { index: 2, total: 3, title: 'Run tags' } }));
  assert.equal(tile.el.querySelector('button.chat-run-tile-open').textContent, 'Slice 2 of 3 · Run tags');
  tile.update(snap());
  assert.equal(tile.el.querySelector('button.chat-run-tile-open').textContent, 'Fix the upload test');
});

const PR = (o = {}) => ({ url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN', ...o });
const FAILING = { state: 'failing', total: 12, failed: 3, pending: 0 };
// A History row's stand-in as app.js chatHomeHistTile builds it: done, not live, no graph.
const histSnap = (over = {}) => snap({ source: 'history', key: 'hist:k1/aaaa0001', runId: null, status: 'done', live: false,
  terminal: false, stepper: null, decor: null, progress: null, ...over });

test('bundle QA 2: a run in Needs you through its PR shows a plain amber dot and the reason word, never Done', () => {
  for (const [pr, word] of [[PR({ checks: FAILING }), 'Checks failing'], [PR({ mergeable: 'CONFLICTING' }), 'Conflicts']]) {
    const { tile } = mount(histSnap({ pr }));
    const pill = tile.el.querySelector('.chat-run-tile-pill');
    assert.ok(pill.classList.contains('st-amber'), word);
    assert.equal(pill.querySelector('.chat-run-tile-pt').textContent, word);
    assert.doesNotMatch(pill.textContent, /Done/);
    const dot = pill.querySelector('.status-dot');
    assert.equal(dot.dataset.state, 'needs-you');
    assert.ok(dot.classList.contains('is-amber'));
    assert.equal(dot.querySelector('svg.status-sym'), null, 'QA 6: "?" only while Worca asks');
    assert.equal(dot.getAttribute('aria-label'), 'Needs you');
    assert.equal(pill.querySelector('.chat-run-tile-dot'), null, 'one dot in the pill');
  }
});

test('bundle QA 2: a workspace run names its most urgent member PR with the count', () => {
  const { tile } = mount(histSnap({ kind: 'workspace-run', memberPrs: [PR({ mergeable: 'CONFLICTING' }), PR({ number: 782, url: 'https://github.com/o/r/pull/782' })] }));
  assert.equal(tile.el.querySelector('.chat-run-tile-pt').textContent, 'Conflicts · 2 PRs');
});

test('bundle QA 2: a stopped Watch PR on an open PR says "Watch stopped", not the Runs list\'s whole line', () => {
  const { tile } = mount(histSnap({ pr: PR(), watch: { status: 'needs-person', reason: 'fix-failed', fixRuns: 1 } }));
  const pill = tile.el.querySelector('.chat-run-tile-pill');
  assert.equal(pill.querySelector('.chat-run-tile-pt').textContent, 'Watch stopped');
  assert.ok(pill.classList.contains('st-amber'));
  assert.equal(pill.querySelector('.status-dot[data-state="needs-you"] svg.status-sym'), null);
});

test('bundle QA 2: a run waiting on an answer shows the amber "?" in its pill', () => {
  const { tile } = mount(snap({ pendingQuestion: { kind: 'clarify', questions: [{ id: 'q1' }] } }));
  const dot = tile.el.querySelector('.chat-run-tile-pill .status-dot');
  assert.ok(dot.classList.contains('has-sym'));
  assert.ok(dot.querySelector('svg.status-sym'));
  assert.equal(dot.getAttribute('aria-label'), 'Needs you');
  assert.equal(tile.el.querySelector('.chat-run-tile-pt').textContent, 'Waiting for your answer');
});

test('bundle QA 2: outside Needs you the pill is unchanged: a working run keeps its plain dot, a merged-ready PR keeps Done', () => {
  const live = mount(snap());
  assert.ok(live.tile.el.querySelector('.chat-run-tile-pill > .chat-run-tile-dot'));
  assert.equal(live.tile.el.querySelector('.chat-run-tile-pill .status-dot'), null);
  const ready = mount(histSnap({ pr: PR() }));
  assert.equal(ready.tile.el.querySelector('.chat-run-tile-pt').textContent, 'Done');
  assert.ok(ready.tile.el.querySelector('.chat-run-tile-pill').classList.contains('st-green'));
  // update() swaps the dot back and forth in place
  ready.tile.update(histSnap({ pr: PR({ mergeable: 'CONFLICTING' }) }));
  assert.ok(ready.tile.el.querySelector('.chat-run-tile-pill .status-dot[data-state="needs-you"]'));
  ready.tile.update(histSnap({ pr: PR() }));
  assert.ok(ready.tile.el.querySelector('.chat-run-tile-pill > .chat-run-tile-dot'));
});
