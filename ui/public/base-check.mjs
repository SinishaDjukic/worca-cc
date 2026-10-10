// ui/public/base-check.mjs
// Base conflicts (#620): pure models for the History detail block, the runs list note and the Ship-it line.
import { ago } from './branch-sync.mjs';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** { tone, label, when, files, more, canUpdate, canResolve, status } for one stored check (or null). */
export function baseCheckModel(c, { now = Date.now() } = {}) {
  if (!c || typeof c !== 'object' || !c.status) {
    return { status: 'none', tone: 'grey', label: 'Not checked against the base yet', when: '', files: [], more: 0, canUpdate: false, canResolve: false };
  }
  const base = c.base || 'the base';
  const when = c.at ? `checked ${ago(c.at, now)}${c.stale ? ' (offline: against the last fetch)' : ''}` : '';
  const files = Array.isArray(c.files) ? c.files : [];
  const n = Number.isFinite(c.fileCount) ? c.fileCount : files.length;
  const out = { status: c.status, when, files: [], more: 0, canUpdate: false, canResolve: false };
  switch (c.status) {
    case 'up-to-date': return { ...out, tone: 'green', label: `Up to date with ${base}` };
    case 'clean': return { ...out, tone: 'blue', label: `${base} is ${plural(c.behind | 0, 'commit')} ahead, merges cleanly`, canUpdate: true };
    case 'conflicts': return { ...out, tone: 'red', files, more: Math.max(0, n - files.length), canResolve: true,
      label: c.kind === 'markers' ? `Conflict markers left in ${plural(n, 'file')}` : `Conflicts in ${plural(n, 'file')}` };
    case 'no-branch': return { ...out, tone: 'grey', label: 'The branch is no longer in the repository' };
    default: return { ...out, tone: 'amber', label: `Could not check against ${base}${c.error ? `: ${c.error}` : ''}` };
  }
}

/** The History list's short note: only states that need attention. */
export function baseRowNote(c) {
  if (!c || !c.status) return '';
  if (c.status === 'conflicts') return `conflicts with ${c.base || 'base'}`;
  if (c.status === 'clean') return `${c.base || 'base'} moved`;
  return '';
}
