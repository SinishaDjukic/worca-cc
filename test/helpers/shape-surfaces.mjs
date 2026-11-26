// test/helpers/shape-surfaces.mjs — Shaper small runs s5 (R-qa-6, R-arch-1): the four surfaces that show a run's word
// and mark, each read from its real builder over one server state: the Chat card rows, the feature page's Runs tab, the
// Runs list member rows and the run page head. The card takes its slices from featureView; the other three take the
// members of listRunGroups, mapped as app.js runsGroupItem maps them. Each live run has ONE snapshot, fed to all four.
// A reader answers Map run → {word, dot, mark, text}: `dot` is the painted dot's signature and `mark` the row's
// data-mark (the run page head carries none). Nothing here calls runStatus or derives a mark from a dot class.
import { groupModel } from '../../src/shared/run-model.mjs';
import { careRunPlan } from '../../src/shared/shape/feature-record.mjs';
import * as runStatusModule from '../../src/shared/shape/run-status.mjs';
import { featureView, liveSliceFrom } from '../../src/core/shape/features.mjs';
import { listRunGroups } from '../../src/core/run-groups.mjs';
import { snapshotFromState, PROGRESS_CARD_TYPE } from '../../ui/public/ask-run-card.mjs';
import { createRunCardController } from '../../ui/public/chat/run-card.mjs';
import { buildGroupPage, paintGroupPage } from '../../ui/public/group-page.mjs';
import { buildRunsModel, groupRow, renderRunsList } from '../../ui/public/runs-list.mjs';
import * as runStatusCard from '../../ui/public/run-status-card.mjs';
import { applyFlags } from '../../ui/public/flags.mjs';
import { world, SIXTEEN_RUN_STATES } from './shape-sixteen-runs.mjs';

export const NOW = Date.parse('2026-11-21T12:00:00Z');

/** The six walked states. `at` names the node a building run is at (else the Implementer). */
export const WALKED = Object.freeze([
  { name: 'none-done', spec: { done: [], states: { 1: { pipe: 'running' } } }, at: { 1: 'n_review' } },   // run 1 reviewing
  { name: 'some-done', spec: { done: [1, 3, 11] } },
  { name: 'going', spec: { done: [1, 11], states: { 3: { pipe: 'running' } } } },
  { name: 'stop-open', spec: 'base' },
  { name: 'failed', spec: 'busy', at: { 6: 'n_review' } },     // "run 6 reviewing, run 2 waiting for you"
  { name: 'held', spec: { done: [1], states: { 2: { stop: 'requirement', held: true, after: 3 }, 3: { pipe: 'running' } } } },
]);
export const walked = (name) => WALKED.find((w) => w.name === name);

const CARE = careRunPlan('balanced', { runRoles: ['product', 'architect'] });
const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, ports: { inputs: [], outputs: [] } });
const FLOW = ['n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review'];
const MANIFEST = { version: 2, template: { id: 'wf_shape_slice_req' }, careRun: CARE,
  graph: { nodes: [['n_plan', 'planner'], ['n_refine', 'refiner'], ['n_roles', 'planReviewer'], ['n_tests', 'testWriter'],
    ['n_impl', 'implementer'], ['n_review', 'reviewer']].map(([id, key]) => agent(id, key)), wires: [] } };
const row = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1,
  status, startedAt: '2026-11-21T10:00:00Z' });

/** A live member run's store snapshot, with its pending question when it asks one. */
function liveSnap(pid, { at = 'n_impl', pendingQuestion = null } = {}) {
  const done = FLOW.slice(0, FLOW.indexOf(at));
  return { ...snapshotFromState({ id: pid, status: 'running', stepper: MANIFEST,
    steps: [...done.map((id) => row(id)), row(at, pendingQuestion ? 'done' : 'start')],
    active: pendingQuestion ? [] : [{ nodeId: at, executionId: `x:${at}:1` }] }),
  source: 'live', runId: `run-${pid}`, pendingQuestion };
}

const STOP_KIND = { requirement: 'plan', check: 'gate', objection: 'gate' };
/** pipelineId → the one snapshot of each live run of the world (a failed or finished run has none). Run 1 runs in the
 *  planning run's own pipeline, so its snapshot carries `shaping`, as the real store's does. */
function snapshots(fx, states = {}, at = {}) {
  const out = new Map();
  for (const [key, how] of Object.entries(states)) {
    const run = Number(key);
    if ((how.pipe || 'running') !== 'running') continue;
    const pid = fx.pipelineOf(run);
    const pendingQuestion = how.stop ? { id: `q${run}`, kind: STOP_KIND[how.stop], stop: { reason: how.stop, run } } : null;
    const snap = liveSnap(pid, { at: how.stop ? 'n_refine' : at[run] || 'n_impl', pendingQuestion });
    out.set(pid, pid === fx.originPipelineId ? { ...snap, shaping: { perspectives: [], rounds: [] } } : snap);
  }
  return out;
}

/** One listRunGroups group as app.js runsGroupItem hands it to the Runs list: `flag` is shaperSmallRuns. */
export function groupItem(g, { flag = true, snaps = new Map() } = {}) {
  const words = !!g.smallRuns && flag;
  const members = g.members.map((m) => {
    const snap = m.pipelineId ? snaps.get(m.pipelineId) || null : null;
    const stopped = !!(snap && snap.pendingQuestion && snap.pendingQuestion.stop);
    const run = m.pipelineId
      ? { status: m.status, ...(snap && snap.pendingQuestion ? { pendingQuestion: snap.pendingQuestion } : {}) }
      : { ticket: { status: m.ticket ? m.ticket.status : 'scheduled', runAt: m.ticket && !m.ticket.after ? m.ticket.runAt : null,
        after: m.after ? { index: m.after } : null, held: !!(m.ticket && m.ticket.held) } };
    return { position: m.position, title: m.title, adhoc: !!m.adhoc, pipelineId: m.pipelineId, ticketId: m.ticketId,
      href: m.pipelineId ? `#history/k/${m.pipelineId}` : `#feature/${g.id}`, kind: m.pipelineId ? (snap ? 'live' : 'hist') : 'sched',
      run, ...(snap ? { snap } : {}),
      ...(words && m.slice ? { slice: snap && !stopped && m.slice.stop ? { ...m.slice, stop: undefined } : m.slice } : {}) };
  });
  return { id: g.id, groupKind: g.kind, title: g.title, cost: g.cost || null, members, ...(g.smallRuns ? { smallRuns: true } : {}) };
}

/** Builds one walked world (call it with the flag on in the environment) and its payloads: featureView's slices for the
 *  card (with the whole view and `own`, the card's pipeline: run 1's), the listRunGroups group and its members for the
 *  other surfaces, and the live runs' snapshots. As on the server, every live run has a live entry, so a building
 *  run's slice reads `running` (the fixture alone keeps only the asking runs there). */
export function walkWorld(projectDir, { name, spec, at }) {
  const built = world(projectDir, spec);
  const snaps = snapshots(built, (typeof spec === 'string' ? SIXTEEN_RUN_STATES[spec] : spec).states, at);
  const live = (pid) => built.live(pid) || (snaps.has(pid) ? liveSliceFrom({ runId: `run-${pid}`, status: 'running', approved: true }) : null);
  const fx = { ...built, live };
  const view = featureView(fx.featureId, { live: fx.live });
  const raw = listRunGroups({ live: fx.live }).find((g) => g.id === fx.featureId);
  const group = groupItem(raw, { snaps });
  const members = groupRow(group, { now: NOW }).members;
  return { name, fx, snaps, view, own: fx.originPipelineId, slices: view.slices, raw, group, members };
}

/** The painted dot's signature: its `is-…` classes (the pulse included) and its symbol. */
export function dotSig(dot) {
  if (!dot) return null;
  const classes = [...dot.classList].filter((c) => c.startsWith('is-')).sort().join(' ');
  return dot.dataset.symbol ? `${classes} symbol:${dot.dataset.symbol}` : classes;
}

const CARD_MEMBER = (sl) => (sl.state === 'done' ? { status: 'done', endReached: true }
  : ['planned', 'held', 'canceled'].includes(sl.state) ? { ticket: { status: 'scheduled' } }
    : sl.state === 'error' ? { status: 'error' } : { status: 'running' });

/** The Chat card (createRunCardController) over featureView's slices, left live in `doc.body`: `flag` is the browser's
 *  shaperSmallRuns, `marked` the card's smallRuns marker. `own` is the card's pipeline (the planning run's, which is
 *  run 1's) and `view` the featureView payload the card reads as its feature (else a bare feature over `slices`). The
 *  run store answers a live snapshot first, then a finished REST stub for `own`. `update()` repaints it from the same
 *  snapshot, `destroy()` is the card's own teardown, `dispose()` also removes it. */
export function cardHost(doc, slices, snaps, { flag = true, marked = true, own = 'p0', view = null } = {}) {
  applyFlags({ shaperSmallRuns: flag }, doc);
  const members = slices.map(CARD_MEMBER);
  const feature = view || { id: 'feat-1', title: 'Charts', status: 'active', total: slices.length, done: slices.filter((s) => s.state === 'done').length,
    halted: null, slices, ask: null, log: [], originPipelineId: own, ship: { ready: false, mode: null } };
  const cardJson = { pipelineId: own, feature, log: [], ...(marked ? { smallRuns: true } : {}) };
  const rest = { source: 'rest', terminal: true, status: 'done', pipelineId: own };
  const runStore = { subscribe: () => () => {}, byPipeline: (pid) => snaps.get(pid) || (pid === own ? rest : null), get: () => null };
  const gm = groupModel({ kind: 'feature', title: 'Charts', planning: { status: 'done', endReached: true }, members }, { now: NOW });
  const listRow = { kind: 'chain', groupKind: 'feature', groupId: 'feat-1', title: 'Charts', model: gm, count: gm.count.text,
    planning: { title: 'Planning', href: '#running/r0', model: gm.planning },
    members: gm.members.map((m, i) => ({ position: slices[i].index, title: `Run ${slices[i].index}`, href: '#runs', model: m,
      pipelineId: slices[i].pipelineId, ticketId: slices[i].ticketId, run: members[i] })) };
  const controls = { paintQuestion: () => null, releaseQuestion() {}, groupOf: () => listRow, memoFor: () => ({}) };
  const ctl = createRunCardController({ controls, runStore, tickMs: 0 });
  const block = { id: 'card_s5', card: { type: PROGRESS_CARD_TYPE, pipelineId: own, runId: `run-${own}`, title: 'Charts' } };
  const built = ctl.build(block, { doc, win: doc.defaultView, shaperCard: () => cardJson });
  doc.body.appendChild(built.el);
  return { root: built.el, update: () => built.handle.blockChanged(block), destroy: () => built.dispose(),
    dispose() { built.dispose(); ctl.destroy(); built.el.remove(); } };
}

/** The Chat card's run rows, the marked feature card with the flag on (`opts`: cardHost's). The Map also carries
 *  `line`: the card status block's detail (the state line), null when absent. */
export function cardStatus(doc, slices, snaps, opts = {}) {
  const host = cardHost(doc, slices, snaps, opts);
  const out = rowsRead([...host.root.querySelectorAll('.run-member:not([data-key="planning"])')]);
  out.line = host.root.querySelector('.chat-rc-status .run-status-detail')?.textContent ?? null;
  host.dispose();
  return out;
}

/** Map run → {word, dot, mark, text} of `.run-member` rows (the card and the feature page). */
function rowsRead(items) {
  return new Map(items.map((li) => {
    const state = li.querySelector('.run-member-state');
    const word = state ? state.textContent : null;
    return [Number(li.querySelector('.run-member-num').textContent), { word, dot: dotSig(li.querySelector('.status-dot')), mark: li.dataset.mark || null, text: word }];
  }));
}

/** The feature page (buildGroupPage, paintGroupPage) on its Runs tab, left live in `doc.body`. As app.js does, the
 *  status (memberStatusOf(members)) is passed only for a marked feature with the flag on. `repaint({groupId, rename})`
 *  paints it again, with another feature's id or with run titles changed (rename: {run: title}). `order` (featureView
 *  slices, s10) is the page's Show order field; absent by default. */
export function pageHost(doc, members, { flag = true, marked = true, order = null } = {}) {
  applyFlags({ shaperSmallRuns: flag }, doc);
  const model = groupModel({ kind: 'feature', title: 'Charts', members: members.map((m) => m.run) }, { now: NOW });
  const root = buildGroupPage(doc);
  const repaint = ({ groupId = 'feat_1', rename = {} } = {}) => {
    const listRow = { kind: 'chain', groupKind: 'feature', groupId, title: 'Charts', model, costUsd: 0, planning: null,
      members: members.map((m) => ({ ...m, ...(rename[m.position] ? { title: rename[m.position] } : {}), cost: 0 })) };
    paintGroupPage(root, { row: listRow, project: 'acme', tab: 'runs', overview: true, requirements: flag && marked,
      ...(flag && marked ? { status: runStatusModule.memberStatusOf(listRow.members) } : {}), ...(order ? { order } : {}) },
    { onAction: () => {}, onTab: () => {}, mountQuestion: () => {}, mountOverview: () => {}, mountDecisions: () => {}, mountRequirements: () => null,
      logsHref: (mb) => `${mb.href}/details/logs` });
  };
  repaint();
  doc.body.appendChild(root);
  return { root, repaint, dispose: () => root.remove() };
}

/** The feature page's Runs tab rows. */
export function pageStatus(doc, members) {
  const host = pageHost(doc, members);
  const out = rowsRead([...host.root.querySelectorAll('.gpage-runs .run-member:not([data-key="planning"])')]);
  host.dispose();
  return out;
}

/** The Runs list's member rows, the group open (buildRunsModel, renderRunsList). */
export function sidebarStatus(doc, group) {
  const history = group.members.filter((m) => m.pipelineId)
    .map((m) => ({ id: m.pipelineId, projectKey: 'k', title: m.pipelineId, status: m.run.status, run: { status: m.run.status } }));
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ history, groups: [group], toggled: new Map([[`chain:${group.id}`, true]]), now: NOW })));
  const items = [...host.querySelectorAll(`.runs-item[data-row-key="chain:${group.id}"] > .runs-members > .runs-item[data-level="member"]`)];
  return new Map(items.map((item) => {
    const run = Number.parseInt(item.querySelector(':scope > a.runs-row > .runs-row-title').textContent, 10);
    const sub = item.querySelector(':scope > a.runs-row > .runs-row-sub');
    const word = sub ? sub.textContent : null;
    return [run, { word, dot: dotSig(item.querySelector(':scope > .runs-pick > .status-dot')), mark: item.dataset.mark || null, text: word }];
  }));
}

/** One run's page head: `m` painted by paintRunStatus. */
export function headRead(doc, m) {
  const host = doc.createElement('div');
  runStatusCard.paintRunStatus(host, m);
  const word = host.querySelector('.run-status-word').textContent;
  const detail = host.querySelector('.run-status-detail').textContent;
  return { word, dot: dotSig(host.querySelector('.run-status-head .status-dot')), mark: null, text: detail ? `${word} · ${detail}` : word };
}

/** One member's run page head, built as app.js paintRunHead builds it: sliceHeadModel over the member's shared status. */
export function runPageStatus(doc, member, members) {
  return headRead(doc, runStatusCard.sliceHeadModel(member.model, runStatusModule.memberStatusOf(members)(member)));
}
