// Project kind and run work-mode rules (Projects, any way — CONTRACT §1–§2). A leaf module:
// node:fs, node:path and node:os only; never git.
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const FOLDER_MANIFEST_FILE = 'folder-manifest.json';
export const CHANGES_FILE = 'changes.json';
export const CHANGES_PATCH_FILE = 'changes.patch';
export const FOLDER_SKIPPED_DIR = 'skipped';
export const FOLDER_FILES = Object.freeze({ manifest: FOLDER_MANIFEST_FILE, changes: CHANGES_FILE, patch: CHANGES_PATCH_FILE }); // P5 S2

/** Absolute paths of a member's folder-run files under `dir` (P5's folderMemberFiles shape). */
export function folderFiles(dir) {
  return { dir, manifest: join(dir, FOLDER_MANIFEST_FILE), changes: join(dir, CHANGES_FILE),
    patch: join(dir, CHANGES_PATCH_FILE), skipped: join(dir, FOLDER_SKIPPED_DIR) };
}

/** 'none' stays; anything else, NULL included → 'git'. */
export function normalizeVcs(v) { return v === 'none' ? 'none' : 'git'; }

/** 'git' | 'folder' | 'none'; unknown / missing → 'git'. */
export function normalizeWorkMode(v) { return v === 'folder' || v === 'none' ? v : 'git'; }

/** Add time: <path>/.git exists (dir or file) → 'git', else 'none'. Stat only. */
export function detectVcs(path) {
  if (!path) return 'none';
  return existsSync(join(path, '.git')) ? 'git' : 'none';
}

/** V69 (U12): an existing directory without .git → 'none'; a .git or a missing path → 'git'. */
export function vcsAtUpgrade(path) {
  try {
    if (path && statSync(path).isDirectory() && !existsSync(join(path, '.git'))) return 'none';
  } catch { /* missing → git */ }
  return 'git';
}

/** U3: a Folder project is always a folder run; a Git project is one only while git is missing. */
export function effectiveWorkMode(vcs, gitAvailable) {
  if (normalizeVcs(vcs) === 'none') return 'folder';
  return gitAvailable ? 'git' : 'folder';
}

/** L4: the start decision. An unregistered dir keeps git mode while git is installed. */
export function workModeForStart({ projectDir } = {}, { getProjectByPath, gitAvailable } = {}) {
  const row = projectDir && typeof getProjectByPath === 'function' ? getProjectByPath(projectDir) : null;
  const avail = typeof gitAvailable === 'function' ? gitAvailable() : !!gitAvailable;
  return effectiveWorkMode(row ? row.vcs : 'git', avail);
}

function parseJson(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string' || !v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

/** The recorded mode of a pipelines row: single → branch.workMode; workspace → workspace_meta.workMode. */
export function workModeOfRow(row) {
  if (!row) return 'git';
  const rec = row.target === 'workspace' ? parseJson(row.workspace_meta) : parseJson(row.branch);
  return normalizeWorkMode(rec?.workMode);
}

/** resolve()d strings; case-folded on win32 / darwin. */
export function samePath(a, b, platform = process.platform) {
  if (a == null || b == null) return false;
  let x = resolve(String(a)); let y = resolve(String(b));
  if (platform === 'win32' || platform === 'darwin') { x = x.toLowerCase(); y = y.toLowerCase(); }
  return x === y;
}

/** S22: `~/…` under home on POSIX; absolute on Windows. */
export function displayPath(p, { home = homedir(), platform = process.platform } = {}) {
  if (platform === 'win32' || typeof p !== 'string') return p;
  const h = String(home || '').replace(/\/+$/, '') || '/';
  if (p === h) return '~';
  if (p.startsWith(h + '/')) return '~/' + p.slice(h.length + 1);
  return p;
}
