// src/core/run-bulk.mjs — POST /api/runs/bulk (runs redesign §3.2). Pure over injected deps (ui/server.mjs wires them),
// so the expansion and ordering are unit-tested without a server. Feature / user groups are expanded here by id; a
// plain Run-after chain has no server id, so it arrives with its member refs inline ({kind:'chain', members}).
import { planBulk } from '../shared/run-bulk.mjs';

const MAX_MEMBERS = 200;

export async function runBulk({ action, targets = [], groups = [] }, deps) {
  const resolved = targets.map((t) => deps.resolve(t)).filter(Boolean);
  const grouped = groups.map((g) => {
    const refs = g.kind === 'chain' ? (Array.isArray(g.members) ? g.members.slice(0, MAX_MEMBERS) : []) : deps.expandGroup(g);
    return { id: g.id, kind: g.kind, title: g.title || g.id, members: refs.map((m) => deps.resolve(m)).filter(Boolean) };
  });
  const plan = planBulk(action, [...grouped.map((g) => ({ id: `group:${g.id}`, title: g.title, members: g.members })), ...resolved]);
  const out = { ok: true, action, done: [], cancelled: [], skipped: plan.skip.map(({ id, title, reason }) => ({ id, title, reason })) };
  const fail = (t, e) => out.skipped.push({ id: t.id, title: t.title, reason: String(e && e.message ? e.message : e) });
  // Waiting members first (D17): a Run-after ticket can never fire off a member stopped a moment earlier.
  for (const t of plan.cancel) {
    try { if (deps.cancel(t)) out.cancelled.push({ id: t.id, title: t.title }); else fail(t, 'could not cancel: it is starting'); } catch (e) { fail(t, e); }
  }
  for (const t of plan.apply) {
    try { await deps[action](t); out.done.push({ id: t.id, title: t.title }); } catch (e) { fail(t, e); }
  }
  // The runs are already stopped and cancelled: a failure here must not turn the answer into a 500.
  if (action === 'stop') for (const g of grouped) if (g.kind === 'feature') { try { deps.afterGroupStop?.(g); } catch { /* the feature row catches up on its next read */ } }
  return out;
}
