// src/core/ticket-updates.mjs — what Worca does to a ticket when a run finishes (plans/ticket-updates-design.md §6).
// Pure but for the record read: the move write-back passes to a plugin (D7), the checks a save must pass (§4), the projects
// filter (D9) and the words Report back uses (D14). Provider-neutral: it knows no tracker's id format or status names; each
// plugin translates a move into its tracker's terms (D1, D5).
import { flagEnabled } from './flags.mjs';
import { readTicketUpdates, DEFAULT_PROFILE } from './plugin-config.mjs';

export const TU_CATEGORIES = Object.freeze(['todo', 'in_progress', 'done', 'cancelled']);
export const TU_MOMENTS = Object.freeze(['finished']);
export const TU_LIMITS = Object.freeze({ projects: 200, rules: 200, text: 200 });

/** A project key as a tracker names it: no backslash, "?", "#", "%" or control character, and at most one "/" between two parts
 *  of 1 to 100 characters, neither "." nor ".." (it lands in a URL path in the plugin, where "%2e%2e" or ".%2e" reads as "..").
 *  The whole key stays within 200 characters (text() caps it first). Jira keys are [A-Z][A-Z0-9_]*; GitHub keys a repository as
 *  owner/repo (plans/ticket-updates-pr2-plan.md decision 1). Each plugin checks its own shape too: jira-source and
 *  azure-boards-source refuse any slash, github-source wants owner/repo. */
export const isProjectKey = (v) => typeof v === 'string' && !/[\\?#%\u0000-\u001f\u007f]/.test(v)
  && v.split('/').length <= 2 && v.split('/').every((part) => part.length > 0 && part.length <= 100 && !/^\.+$/.test(part));

/** A save §4 refuses; the route answers 400 with its message. */
export class TicketUpdatesError extends Error {
  constructor(message) { super(message); this.name = 'TicketUpdatesError'; this.code = 'BAD_REQUEST'; }
}

const isBag = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** The saved record, or null (nothing saved, or a file Worca cannot read). */
function recordOf(plugin, sourceId, profile) {
  try {
    const rec = readTicketUpdates(plugin, profile || DEFAULT_PROFILE, sourceId);
    return rec && Array.isArray(rec.rules) ? rec : null;
  } catch { return null; }
}

/** A stored target as the move a plugin hears (§3): none → { none }, category → Any Done status, status → its id and name,
 *  typed (a carried-over Jira setting) → its text without a name. */
export function toMove(target) {
  const t = isBag(target) ? target : { kind: 'none' };
  if (t.kind === 'category') return { category: 'done' };
  if (t.kind === 'status') return { status: String(t.value), ...(t.label ? { name: String(t.label) } : {}) };
  if (t.kind === 'typed') return { status: String(t.value) };
  return { none: true };
}

/**
 * The move for one write-back (D7, §6): undefined with the flag off or nothing saved (the plugin's old setting applies, D4);
 * { none: true } for a run that did not finish successfully once rules exist; else the ticket's project rule, else All projects.
 * @param {{plugin:string, sourceId:string, profile?:string|null, project?:string|null, status:string}} o
 */
export function moveFor({ plugin, sourceId, profile, project, status } = {}) {
  if (!flagEnabled('ticketUpdates')) return undefined;
  const rec = recordOf(plugin, sourceId, profile);
  if (!rec) return undefined;
  if (status !== 'completed') return { none: true };   // only `finished` exists (D2)
  const finished = rec.rules.filter((r) => isBag(r) && r.moment === 'finished');
  const rule = (project && finished.find((r) => r.project === project)) || finished.find((r) => r.project === '');
  return toMove(rule && rule.target);
}

function text(v, what) {
  const s = typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : '');
  if (s.length > TU_LIMITS.text) throw new TicketUpdatesError(`${what} is longer than ${TU_LIMITS.text} characters.`);
  return s;
}

function targetOf(t, allProjects) {
  if (!isBag(t)) throw new TicketUpdatesError('Each rule needs a move.');
  if (t.kind === 'none') return { kind: 'none' };
  if (t.kind === 'category') {
    if (t.value !== 'done') throw new TicketUpdatesError('A category move can only be Any Done status.');
    return { kind: 'category', value: 'done' };
  }
  if (t.kind === 'typed') {
    if (!allProjects) throw new TicketUpdatesError('Only All projects can keep the old setting.');
    const value = text(t.value, 'A status');
    if (!value) throw new TicketUpdatesError('A status needs a name.');
    return { kind: 'typed', value };
  }
  if (t.kind === 'status') {
    if (allProjects) throw new TicketUpdatesError("All projects can only be Don't move or Any Done status.");
    const value = text(t.value, 'A status id');
    const label = text(t.label, 'A status name');
    if (!value || !label) throw new TicketUpdatesError('A status needs its id and name.');
    if (!TU_CATEGORIES.includes(t.category)) throw new TicketUpdatesError('A status needs its category.');
    return { kind: 'status', value, label, category: t.category };
  }
  throw new TicketUpdatesError('Each rule needs a move.');
}

/**
 * §4's checks on a PUT body: at most 200 projects and 200 project rules, values and labels at most 200 characters, one rule
 * per (project, moment), exactly one All projects rule (project ''), All projects only none / category / typed, moments only
 * `finished`. Answers the clean record (All projects first; a missing label is the key); throws TicketUpdatesError.
 * @returns {{projects:Array<{value:string,label:string}>, rules:Array<{project:string,label?:string,moment:string,target:object}>}}
 */
export function validateTicketUpdates(body) {
  const b = isBag(body) ? body : {};
  if (!Array.isArray(b.projects)) throw new TicketUpdatesError('projects must be a list.');
  if (!Array.isArray(b.rules)) throw new TicketUpdatesError('rules must be a list.');
  if (b.projects.length > TU_LIMITS.projects) throw new TicketUpdatesError(`Pick at most ${TU_LIMITS.projects} projects.`);
  // Before the loop: the server accepts bodies up to 8 MB, so a huge list is refused without walking it. The All projects
  // rule is the one extra; the exact count of project rules is checked again after the loop.
  if (b.rules.length > TU_LIMITS.rules + 1) throw new TicketUpdatesError(`Keep at most ${TU_LIMITS.rules} project rules.`);
  const projects = [];
  const seen = new Set();
  for (const p of b.projects) {
    const value = text(isBag(p) ? p.value : '', 'A project key');
    const label = text(isBag(p) ? p.label : '', 'A project name');
    if (!value) throw new TicketUpdatesError('Each project needs its key.');
    if (!isProjectKey(value)) throw new TicketUpdatesError(`${value} is not a project key.`);
    if (seen.has(value)) continue;
    seen.add(value);
    projects.push({ value, label: label || value });
  }
  const all = [];
  const own = [];
  const keys = new Set();
  for (const r of b.rules) {
    if (!isBag(r)) throw new TicketUpdatesError('Each rule needs a project and a move.');
    if (!TU_MOMENTS.includes(r.moment)) throw new TicketUpdatesError('A rule can only apply when a run finishes.');
    if (r.project !== undefined && typeof r.project !== 'string' && typeof r.project !== 'number') throw new TicketUpdatesError('A rule\'s project must be a project key.');
    const project = text(r.project, 'A project key');
    if (project && !isProjectKey(project)) throw new TicketUpdatesError(`${project} is not a project key.`);
    const key = `${project}\u0000${r.moment}`;
    if (keys.has(key)) throw new TicketUpdatesError(`${project || 'All projects'} has more than one rule.`);
    keys.add(key);
    if (!project) { all.push({ project: '', moment: r.moment, target: targetOf(r.target, true) }); continue; }
    const label = text(r.label, 'A project name');
    own.push({ project, label: label || project, moment: r.moment, target: targetOf(r.target, false) });
  }
  if (all.length !== 1) throw new TicketUpdatesError('All projects needs exactly one rule.');
  if (own.length > TU_LIMITS.rules) throw new TicketUpdatesError(`Keep at most ${TU_LIMITS.rules} project rules.`);
  return { projects, rules: [...all, ...own] };
}

/** The projects a connection's lists keep (D9): a Set of project values, or null (flag off, nothing saved, none picked). */
export function projectFilter(plugin, sourceId, profile) {
  if (!flagEnabled('ticketUpdates')) return null;
  const rec = recordOf(plugin, sourceId, profile);
  const values = rec && Array.isArray(rec.projects) ? rec.projects.map((p) => (isBag(p) ? String(p.value ?? '') : '')).filter(Boolean) : [];
  return values.length ? new Set(values) : null;
}

/** A list of `{ value, … }` options shortened to the filter; `keep` (a saved choice) stays listed (D9). */
export function filterProjects(options, filter, keep = []) {
  if (!filter || !Array.isArray(options)) return options;
  const kept = new Set((keep || []).filter(Boolean).map(String));
  return options.filter((o) => isBag(o) && (filter.has(String(o.value)) || kept.has(String(o.value))));
}

/** Report back's words for a move (D14): { kind, label }, where label is what the hint names (the status, "a Done status",
 *  or for Don't move the project whose tickets stay); null for no move (the old two lines). A status without a name is a
 *  carried-over typed value and reads "<text> (as typed)", as the sheet shows it (decided 2026-10-30). */
export function describeMove(move, { project = '' } = {}) {
  if (!isBag(move)) return null;
  if (move.none === true) return { kind: 'none', label: String(project || '') };
  if (move.category === 'done') return { kind: 'category', label: 'a Done status' };
  if (typeof move.status === 'string' && move.status) {
    return { kind: 'status', label: move.name ? String(move.name) : `${move.status} (as typed)` };
  }
  return null;
}
