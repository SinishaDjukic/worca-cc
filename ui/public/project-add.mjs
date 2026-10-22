// ui/public/project-add.mjs — the Add project dialog's pure helpers: New (a name) · Folder · Clone from URL.
// No DOM work at import (test/ui-project-add.test.mjs imports it bare).

/** The live checks (the New dry run, the folder probe) wait this long after the last keystroke. */
export const PROBE_DEBOUNCE_MS = 150;

/**
 * The segment the dialog opens on (canvas AddNew, SEAMS S61): asked `new`/`folder` wins; asked `clone` only with git;
 * a path handed in opens on Folder; else New. Never Clone by default, with or without a folder picker.
 */
export function defaultAddMode({ asked = null, path = '', git = true } = {}) {
  if (asked === 'new' || asked === 'folder') return asked;
  if (asked === 'clone') return git ? 'clone' : 'new';
  return path ? 'folder' : 'new';
}

/** '1 file' · '214 files' · '5000+ files' (capped); '' when the count is unknown. */
export function filesLabel(n, capped) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (capped) return `${n}+ files`;
  return n === 1 ? '1 file' : `${n} files`;
}

/** The last path segment ("/x/loose/" → "loose"; a Windows path too), for "Add <root>". */
const lastSegment = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p);

/** #693: what the Folder pane offers instead of a nested folder — the registered root's page, or adding the root. */
function rootAction(probe) {
  if (probe.partOf) return { kind: 'open', name: probe.partOf, label: `Open ${probe.partOf}` };
  if (probe.repoRoot) return { kind: 'add-root', path: probe.repoRoot, label: `Add ${lastSegment(probe.repoRoot)}` };
  return null;
}
const withAction = (m, a) => (a ? { ...m, action: a } : m);

/**
 * The detect row under the Folder field, from GET /api/projects/probe's answer.
 * chips: [{ kind?: 'git'|'folder', text, tone: ''|'warn'|'files' }]; refused blocks Add; useGit shows the switch.
 * action (#693, only when set): the Add <root> / Open <name> button; note (only when set): the worca-made nested repo's fix.
 * No `No git` word on a machine without git (S61). An answer without a boolean `exists` is unknown, never a refusal.
 */
export function detectModel(probe, { git = true } = {}) {
  if (!probe || typeof probe !== 'object' || typeof probe.exists !== 'boolean') return { chips: [], refused: false, useGit: false };
  if (!probe.exists) return { chips: [{ text: 'Not found', tone: 'warn' }], refused: true, useGit: false };
  if (!probe.isDir) return { chips: [{ text: 'Not a folder', tone: 'warn' }], refused: true, useGit: false };
  if (probe.insideRepo) {
    const why = probe.partOf ? `Part of ${probe.partOf}` : 'Inside a git repository';
    return withAction({ chips: [{ kind: 'git', text: 'Git', tone: '' }, { text: why, tone: 'warn' }], refused: true, useGit: false }, rootAction(probe));
  }
  if (probe.nestedHint) {
    return withAction({ chips: [{ kind: 'git', text: 'Git', tone: '' }, { text: 'Nested repository', tone: 'warn' }],
      refused: false, useGit: false, note: probe.nestedHint }, rootAction(probe));
  }
  if (probe.vcs === 'git') return { chips: [{ kind: 'git', text: 'Git', tone: '' }], refused: false, useGit: false };
  const chips = [{ kind: 'folder', text: 'Folder', tone: '' }];
  if (git) chips.push({ text: 'No git', tone: '' });
  const files = filesLabel(probe.files, probe.filesCapped);
  if (files) chips.push({ text: files, tone: 'files' });
  return { chips, refused: false, useGit: !!git };
}
