// ui/public/run-glance.mjs — the Running detail's glance: the status glyph, the one-line
// status copy and the trail. Pure: every function takes plain data (the run model's own
// fields) and a `doc` for the DOM builders, so jsdom tests drive it without app.js.
//
// The trail shows what RAN, never what is left: one dot per step execution in start order
// (a loop re-fire adds a dot), executions that overlap in time stack in one column (parallel
// branches, fan-out slices), and nothing is drawn for steps that have not started. A workflow
// that loops or branches has no honest "n of m", so the glance never claims one.
import { ledgerRows } from './graph/run-decor.mjs';
import { BOOKEND_EXECUTION_IDS } from '../../src/shared/graph/constants.mjs';
import { folderDoneWords } from './folder-changes.mjs';

/** Dots per stacked column before the rest collapse into "+N". */
export const TRAIL_STACK_CAP = 3;

/** Node kinds that do work. Flow nodes (and/or/combine/end/task) are free and instant. */
const WORK_KINDS = new Set(['agent', 'script']);

function nodesById(stepper) {
  const map = new Map();
  const nodes = stepper && stepper.graph && Array.isArray(stepper.graph.nodes) ? stepper.graph.nodes : [];
  for (const n of nodes) if (n && n.id) map.set(n.id, n);
  return map;
}

/** The node's display label: its manifest label, else its key, else the id. */
export function nodeLabel(stepper, nodeId) {
  const n = nodesById(stepper).get(nodeId);
  return String((n && (n.label || n.key)) || nodeId || '');
}

const ts = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/**
 * Dot state for one ledger row. `waitingNodes` are node ids parked on a pending question.
 * @returns {'act'|'ask'|'done'|'fail'|'stop'}
 */
export function dotState(row, waitingNodes) {
  const s = String(row && row.status || '');
  if (s === 'start') return waitingNodes && waitingNodes.has(row.nodeId) ? 'ask' : 'act';
  if (s === 'error') return 'fail';
  if (s === 'stopped' || s === 'paused') return 'stop';
  return 'done';
}

/**
 * The trail: columns of executions. A row joins the current column when it started before
 * every execution already in that column ended (they ran at the same time); otherwise it
 * opens a new column. A column holds at most `cap` dots; `more` counts the rest.
 * @param {{steps?:Array, stepper?:object, pendingQuestion?:object|null, active?:Array}} run
 * @returns {{columns:Array<{dots:Array<{executionId:string,nodeId:string,label:string,state:string}>,more:number}>, count:number}}
 */
export function trailColumns(run, { cap = TRAIL_STACK_CAP } = {}) {
  const nodes = nodesById(run && run.stepper);
  const waiting = new Set();
  const pq = run && run.pendingQuestion;
  if (pq) {
    if (pq.nodeId) waiting.add(pq.nodeId);
    // A question without a node id (the clarify step asks through the run) parks every
    // in-flight execution.
    else for (const a of Array.isArray(run.active) ? run.active : []) if (a && a.nodeId) waiting.add(a.nodeId);
  }
  const rows = ledgerRows(run || {})
    .filter((r) => {
      const n = nodes.get(r.nodeId);
      return !n || WORK_KINDS.has(n.kind || 'agent');
    })
    .map((r, i) => ({ r, i, start: ts(r.startedAt) }))
    .sort((a, b) => ((a.start - b.start) || 0) || a.i - b.i);
  const columns = [];
  let col = null;
  let colEnd = -Infinity;       // the earliest end among the column's executions
  let count = 0;
  for (const { r, start } of rows) {
    const node = nodes.get(r.nodeId);
    const cycle = Number(r.ordinal || r.cycle) || 1;
    const title = r.kind === 'task' && r.title ? String(r.title) : '';
    const label = [node ? String(node.label || node.key || r.nodeId) : String(r.nodeId || ''),
      title || (cycle > 1 ? `cycle ${cycle}` : '')].filter(Boolean).join(' · ');
    const dot = { executionId: String(r.executionId), nodeId: String(r.nodeId || ''), label, state: dotState(r, waiting) };
    const end = r.status === 'start' || !r.endedAt ? Infinity : ts(r.endedAt);
    const overlaps = col && Number.isFinite(start) && start < colEnd;
    if (overlaps) {
      if (col.dots.length < cap) col.dots.push(dot);
      else col.more += 1;
      colEnd = Math.min(colEnd, end);
    } else {
      col = { dots: [dot], more: 0 };
      columns.push(col);
      colEnd = end;
    }
    count += 1;
  }
  return { columns, count };
}

/** The executions in flight right now, oldest first, with their labels. */
export function nowRows(run) {
  const nodes = nodesById(run && run.stepper);
  return ledgerRows(run || {})
    .filter((r) => r.status === 'start')
    .filter((r) => { const n = nodes.get(r.nodeId); return !n || WORK_KINDS.has(n.kind || 'agent'); })
    .map((r) => {
      const n = nodes.get(r.nodeId);
      const base = n ? String(n.label || n.key || r.nodeId) : String(r.nodeId || '');
      const cycle = Number(r.ordinal || r.cycle) || 1;
      return {
        executionId: String(r.executionId),
        nodeId: String(r.nodeId || ''),
        label: base,
        detail: r.kind === 'task' && r.title ? String(r.title) : (cycle > 1 ? `cycle ${cycle}` : ''),
        runningSince: r.runningSince || r.startedAt || null,
        model: n && n.model ? String(n.model) : '',
      };
    });
}

const PREFLIGHT_EXEC = BOOKEND_EXECUTION_IDS[0];   // 'x:preflight:1'

/** True while the preflight bookend is open: the run is setting itself up (checkpoint,
 *  worktree, knowledge graph, agent context) and no workflow step has started. The
 *  bookend is not a step (ledgerRows drops it), so it gets no dot and no Now row. */
export function preflightOpen(run) {
  const steps = Array.isArray(run && run.steps) ? run.steps : [];
  return steps.some((s) => s && s.executionId === PREFLIGHT_EXEC && s.status === 'start');
}

/** Completed executions folded per node, in first-run order: [{nodeId,label,times}].
 *  Only `done` rows: a paused, stopped or failed execution did not complete. */
export function earlierRows(run) {
  const nodes = nodesById(run && run.stepper);
  const seen = new Map();
  for (const r of ledgerRows(run || {})) {
    if (r.status !== 'done') continue;
    const n = nodes.get(r.nodeId);
    if (n && !WORK_KINDS.has(n.kind || 'agent')) continue;
    const k = String(r.nodeId || '');
    if (!seen.has(k)) seen.set(k, { nodeId: k, label: n ? String(n.label || n.key || k) : k, times: 0 });
    seen.get(k).times += 1;
  }
  return [...seen.values()];
}

/**
 * The glance state. One of: run | ask | paused | done | fail | stop | start.
 * `terminal` is the detail's own RD_TERMINAL set (done/stopped/error).
 */
export function glanceState(run) {
  const s = String(run && run.status || '');
  if (s === 'done') return 'done';
  if (s === 'error') return 'fail';
  if (s === 'stopped') return 'stop';
  if (run && run.pendingQuestion) return 'ask';
  if (s === 'paused' || s === 'pausing' || s === 'interrupted') return 'paused';
  if (s === 'starting' || !s) return 'start';
  return 'run';
}

/**
 * The status line under the run's name: { state, lead, rest, title, sub, icon? }.
 * `lead` is the state word ("Running", "Waiting for you", "Paused", "Failed") and `rest`
 * what it concerns ("2 questions", "cost limit"); `title` is the two joined with " · ".
 * While running, the state word stands alone and `sub` names the step ("Step: Visual
 * System"). A step is one run of a workflow node (an agent or a script).
 *
 * `pill` is statusPill's `{text}` (the paused reason lives there); `checks` is the number
 * of things to check once results are loaded (null while unknown). `lastLine` (the newest
 * log message) is accepted but no longer shown.
 * A finished run's headline is where the work stands NOW: `pr` is the pull request's
 * state ('OPEN' | 'MERGED' | 'CLOSED') and outranks the review, or what is known about
 * it: 'PENDING' (the lookup has not answered), 'UNAVAILABLE' (worca cannot tell or cannot
 * open one: no gh, a workspace run, the branch is gone), 'NONE' / null (none yet, one can
 * be opened). `files` is how many files the run changed (null while unknown).
 * A finished run also names its own glyph in `icon` (renderOrb), one per headline.
 * `limitNote` ("resets 18:00") replaces "resume to continue" on a usage-limit pause.
 * `progress` is runProgress's result: while the run runs or waits for you, its `text` ("Build · task 2 of 4")
 * is line 2, in place of the step names. An open preflight with nothing running still names itself.
 */
export function glanceCopy(run, { pill = null, checks = null, lastLine = '', pr = null, files = null, limitNote = '', progress = null, changes = null, gitChrome = true, workMode = 'git' } = {}) {
  const state = glanceState(run);
  const now = nowRows(run);
  const names = now.map((x) => x.label);
  const join = (a) => (a.length <= 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const line = (lead, rest, sub, more = {}) => ({ state, lead, rest, title: rest ? `${lead} · ${rest}` : lead, sub, ...more });
  // Line 1 is the state word alone; line 2 starts with the step, then the detail.
  const cap = (s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s);
  const oneLine = (s, max = 140) => {
    const first = String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
    return first.length > max ? `${first.slice(0, max - 1)}…` : first;
  };
  const stepLine = (who, detail) => (who ? `Step: ${who} · ${detail}` : cap(detail));
  switch (state) {
    case 'ask': {
      const pq = run.pendingQuestion;
      const who = pq.nodeId ? nodeLabel(run.stepper, pq.nodeId) : (names[0] || '');
      const wait = 'Waiting for you';
      // The step alone: the panel right below says what it asks and why.
      if (progress && progress.text) return line(wait, '', progress.text);
      if (pq.kind === 'workflow') return line(wait, '', 'Review the workflow');
      if (who) return line(wait, '', `Step: ${who}`);
      const what = { form: 'Input needed', gate: 'A decision', recovery: 'A step failed' };
      return line(wait, '', what[pq.kind] || 'Questions to answer');
    }
    case 'paused': {
      if (run.status === 'pausing') return line('Pausing', '', 'Steps in flight finish first');
      if (run.status === 'interrupted') return line('Interrupted', '', 'Stopped mid-step · resume to continue');
      // statusPill says "Paused · cost limit": the reason is the part after the dot. A
      // pause is not one step's, so line 2 carries the reason.
      const text = pill && pill.text ? String(pill.text) : '';
      const reason = text.replace(/^Paused\s*·\s*/, '');
      const why = reason && reason !== text ? reason : '';
      return line('Paused', '', why ? `${cap(why)} · ${limitNote || 'resume to continue'}` : 'Resume to continue where it left off');
    }
    case 'done': {
      const p = String(pr || '').toUpperCase();
      const nFiles = (n) => `${n} file${n === 1 ? '' : 's'} changed`;
      const fin = (icon, lead, sub) => line(lead, '', sub, { icon });
      if (changes) { const w = folderDoneWords(changes.state, files); return fin('finished', w.lead, w.sub); }
      if (p === 'MERGED') return fin('merged', 'Merged', 'The pull request was merged');
      if (p === 'IN_BASE') return fin('merged', 'Merged', 'Its work is already in the base branch');
      if (p === 'OPEN') return fin('pr-open', 'In review', 'The pull request is open');
      if (p === 'CLOSED') return fin('pr-closed', 'PR closed', 'Closed without merging');
      if (gitChrome === false) return fin('finished', 'Finished', files === 0 ? 'No files changed' : files ? nFiles(files) : '');
      if (files === 0) return fin('finished', 'Finished', 'No files changed');
      if (p === 'PENDING') return fin('finished', 'Finished', 'Checking for a pull request…');
      if (p === 'UNAVAILABLE') return fin('finished', 'Finished', files ? nFiles(files) : 'Review the changes in Diff');
      if (checks == null) return fin('finished', 'Finished', 'Review the changes before you open a pull request');
      if (checks === 0) return fin('ship', 'Ready to ship', 'The review flagged nothing');
      return fin('review', 'Ready to review', `${checks} thing${checks === 1 ? '' : 's'} to check before you open a pull request`);
    }
    case 'fail': {
      const failed = ledgerRows(run || {}).filter((r) => r.status === 'error').pop();
      const where = failed && failed.nodeId ? nodeLabel(run.stepper, failed.nodeId) : '';
      // One line of the error; the whole of it is in Logs.
      return line('Failed', '', stepLine(where, run.pauseDetail ? oneLine(run.pauseDetail) : 'see Logs for the error'));
    }
    case 'stop':
      return line('Stopped', '', 'Stopped before it finished');
    case 'start':
      return line('Starting', '', workMode === 'folder' ? 'Copying the folder' : workMode === 'none' ? '' : 'Setting up the worktree');
    default:
      // The state word alone; the line under it names what runs (no time: the facts
      // row carries the run's time, and a second, unlabelled one read as a contradiction).
      if (progress && progress.text && (now.length || !preflightOpen(run))) return line('Running', '', progress.text);
      if (now.length > 1) return line('Running', '', `Steps: ${join(names)}`);
      if (now.length === 1) return line('Running', '', `Step: ${names[0]}`);
      // Nothing of the workflow runs yet: the preflight, and what it is doing.
      if (preflightOpen(run)) return line('Running', '', run.setupStage ? `Preflight · ${run.setupStage}` : 'Preflight');
      return line('Running', '', 'Between steps');
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(doc, tag, attrs) {
  const n = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

// A finished run's glyphs, one per headline (glanceCopy's `icon`), drawn in one thinner
// stroke than the single-mark states because each has several parts. The circles are
// outlines: every shape here is stroked, never filled.
const DONE_GLYPHS = {
  // Ready to ship: an upright rocket — body, window, two fins, exhaust.
  ship: [
    ['path', { d: 'M22 10.5c3.6 2.7 5.2 6.5 5.2 10.9V27h-10.4v-5.6c0-4.4 1.6-8.2 5.2-10.9z' }],
    ['circle', { cx: 22, cy: 19.5, r: 2 }],
    ['path', { d: 'M16.8 23.5 13.5 27v3h3.3M27.2 23.5l3.3 3.5v3h-3.3' }],
    ['path', { d: 'M20 30.5v3M24 30.5v3' }],
  ],
  // Ready to review: a magnifying glass.
  review: [
    ['circle', { cx: 20, cy: 20, r: 7 }],
    ['path', { d: 'M25.2 25.2 31.5 31.5' }],
  ],
  // In review: a pull request — the base line, and the branch line arrowing into it.
  'pr-open': [
    ['circle', { cx: 15, cy: 13.5, r: 2.4 }],
    ['circle', { cx: 15, cy: 30.5, r: 2.4 }],
    ['path', { d: 'M15 15.9v12.2' }],
    ['circle', { cx: 29, cy: 30.5, r: 2.4 }],
    ['path', { d: 'M29 28.1V19a5 5 0 0 0-5-5h-4.5M22.3 11l-3 3 3 3' }],
  ],
  // Merged: two lines joining into one.
  merged: [
    ['circle', { cx: 15, cy: 13, r: 2.4 }],
    ['circle', { cx: 15, cy: 31, r: 2.4 }],
    ['path', { d: 'M15 15.4v13.2' }],
    ['circle', { cx: 29, cy: 24, r: 2.4 }],
    ['path', { d: 'M15 15.8c0 5 3.6 8.2 8.5 8.2h3.1' }],
  ],
  // PR closed: the pull request with a cross where the arrow was.
  'pr-closed': [
    ['circle', { cx: 15, cy: 13.5, r: 2.4 }],
    ['circle', { cx: 15, cy: 30.5, r: 2.4 }],
    ['path', { d: 'M15 15.9v12.2' }],
    ['circle', { cx: 29, cy: 30.5, r: 2.4 }],
    ['path', { d: 'M29 28.1v-6.6M26 12l6 6M32 12l-6 6' }],
  ],
};

/**
 * The leading glyph: a glance state ('run', 'ask', …) or, for a finished run, the
 * headline's own icon (glanceCopy's `icon`). Colours come from classes (style.css tokens).
 */
export function renderOrb(doc, state, size = 44) {
  const s = svg(doc, 'svg', { viewBox: '0 0 44 44', width: size, height: size, class: `rg-orb rg-orb-${state}`, 'aria-hidden': 'true' });
  s.appendChild(svg(doc, 'circle', { cx: 22, cy: 22, r: 20, class: 'rg-orb-bg' }));
  if (DONE_GLYPHS[state]) {
    for (const [tag, attrs] of DONE_GLYPHS[state]) s.appendChild(svg(doc, tag, { ...attrs, class: 'rg-orb-line', fill: 'none' }));
  } else if (state === 'done' || state === 'finished') {
    s.appendChild(svg(doc, 'path', { d: 'M13 22.5l6 6 12-12', class: 'rg-orb-mark', fill: 'none' }));
  } else if (state === 'ask') {
    // A drawn question mark in the check mark's stroke, not a font glyph: an open hook
    // and a separate round dot.
    s.appendChild(svg(doc, 'path', { d: 'M17 17.2a5 5 0 1 1 7.4 4.4c-1.5.8-2.4 1.9-2.4 3.6v.6', class: 'rg-orb-mark', fill: 'none' }));
    s.appendChild(svg(doc, 'circle', { cx: 22, cy: 30.6, r: 1.9, class: 'rg-orb-dot' }));
  } else if (state === 'paused') {
    s.appendChild(svg(doc, 'rect', { x: 15, y: 13, width: 5, height: 18, rx: 1.5, class: 'rg-orb-fill' }));
    s.appendChild(svg(doc, 'rect', { x: 24, y: 13, width: 5, height: 18, rx: 1.5, class: 'rg-orb-fill' }));
  } else if (state === 'fail' || state === 'stop') {
    s.appendChild(svg(doc, 'path', { d: state === 'fail' ? 'M22 12v12M22 30v1' : 'M15 15h14v14H15z', class: 'rg-orb-mark', fill: state === 'stop' ? 'currentColor' : 'none' }));
  } else {
    s.appendChild(svg(doc, 'circle', { cx: 22, cy: 22, r: 10, class: 'rg-orb-core' }));
  }
  return s;
}

/** The trail as DOM: `.rg-trail` > (`.rg-td` | `.rg-tstack` > `.rg-td`*, `.rg-tmore`). */
export function renderTrail(doc, trail) {
  const wrap = doc.createElement('span');
  wrap.className = 'rg-trail';
  const dot = (d) => {
    const s = doc.createElement('span');
    s.className = `rg-td rg-td-${d.state}`;
    s.title = d.label;
    s.dataset.exec = d.executionId;
    return s;
  };
  for (const c of trail.columns) {
    if (c.dots.length === 1 && !c.more) { wrap.appendChild(dot(c.dots[0])); continue; }
    const st = doc.createElement('span');
    st.className = 'rg-tstack';
    for (const d of c.dots) st.appendChild(dot(d));
    if (c.more) {
      const m = doc.createElement('span');
      m.className = 'rg-tmore';
      m.textContent = `+${c.more}`;
      st.appendChild(m);
    }
    wrap.appendChild(st);
  }
  return wrap;
}
