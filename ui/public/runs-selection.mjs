// ui/public/runs-selection.mjs — Runs list selection (runs redesign §3.2, §5a.4): the ticked keys, the keys that drive
// them, and the action bar's counts from the shared eligibility table (src/shared/run-bulk.mjs), so the bar counts
// what the server will do.
import { planBulk, skipText } from '../../src/shared/run-bulk.mjs';
import { listKeyAction } from './list-keys.mjs';

export function createRunsSelection() {
  const set = new Set();
  return {
    has: (k) => set.has(k),
    toggle(k) { if (set.has(k)) set.delete(k); else set.add(k); },
    selectAll(keys) { for (const k of keys) set.add(k); },
    prune(present) { for (const k of [...set]) if (!present.has(k)) set.delete(k); },
    clear() { set.clear(); },
    keys: () => set.values(),
    get size() { return set.size; },
  };
}

/** Shift-click (spec §3.2): every visible key between `anchor` and `key`, inclusive, in list order. A missing anchor
 *  selects just `key`; a key outside `visible` selects nothing (the caller falls back to a toggle). */
export function rangeKeys(visible, anchor, key) {
  const a = visible.indexOf(anchor);
  const b = visible.indexOf(key);
  if (b < 0) return [];
  if (a < 0) return [key];
  return visible.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** 'toggle' | 'all' | 'clear' | null — the selection keys only (list-keys.mjs has the whole table). */
export function runsKeyAction(e, { size = 0 } = {}) {
  const a = listKeyAction(e, { size, list: 'runs' });
  return a === 'toggle' || a === 'all' || a === 'clear' ? a : null;
}

/** A list row as a bulk target (members for a group row). */
export function rowTarget(r) {
  const one = (x) => ({ id: x.pipelineId || x.ticketId || x.runId || x.key, title: x.title, state: x.model.state, prNeeds: !!x.model.prNeeds,
    status: x.run ? x.run.status : x.status, resumable: x.resumable !== false, pipelineId: x.pipelineId || null, runId: x.runId || null,
    ticketId: x.ticketId || (x.kind === 'sched' ? x.key.slice('sched:'.length) : null),
    labels: Array.isArray(x.labels) ? x.labels : [] });
  if (r.kind !== 'chain') return one(r);
  return { id: r.key, title: r.title, state: r.model.state, groupId: r.groupId, groupKind: r.groupKind, members: r.members.map(one) };
}

/** The Label action's runs: every selected pipeline (a chain's members), deduped; rows without a pipeline id are skipped. */
export function labelTargets(targets) {
  const out = new Map();
  for (const t of targets) for (const x of (t.members || [t])) if (x.pipelineId && !out.has(x.pipelineId)) out.set(x.pipelineId, { pipelineId: x.pipelineId, labels: x.labels || [] });
  return [...out.values()];
}

/** The bar: label and, per action, how many it applies to, the title naming what it skips, and the plan. */
export function barModel(targets) {
  const act = (a) => {
    const plan = planBulk(a, targets);
    return { count: plan.apply.length + plan.cancel.length, title: skipText(plan), plan };
  };
  return { label: `${targets.length} selected`, stop: act('stop'), archive: act('archive'), delete: act('delete') };
}

/** The request body (D15): every group in `groups`, so the server treats its members as group members — feature /
 *  user groups by id (the server expands them), a plain chain with its member refs (it has no server id). */
const ref = ({ pipelineId = null, runId = null, ticketId = null }) => ({ pipelineId, runId, ticketId });
export function bulkBody(action, targets) {
  const groups = targets.filter((t) => t.members).map((t) => (t.groupKind === 'chain'
    ? { id: t.groupId, kind: 'chain', title: t.title, members: t.members.map(ref) }
    : { id: t.groupId, kind: t.groupKind, title: t.title }));
  return { action, targets: targets.filter((t) => !t.members).map(ref), groups };
}
