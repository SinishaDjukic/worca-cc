// src/cli/container-mounts.mjs
// The project-scoped box behind `worca container up --project <dir>` (plans/core-5-per-run-container-mount-design.md).
// It decides which host folder the box binds and which secret files in it get an empty read-only file on top, and it
// writes the compose overlay that does it. What counts as a secret is secret-paths.mjs's (maskPlan, secretPathsFor,
// isSecretPath); this module only filters that plan (committed files, worca's own checkouts, links, unmask) and
// renders it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, parse, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { maskPlan, secretPathsFor, isSecretPath, isSecretPathList, HISTORY_ADDED_ARGS, HISTORY_REMEDY } from '../core/secret-paths.mjs';
import { resolveSetting } from '../core/settings-cascade.mjs';
import { guardedGitEnv } from '../core/git-guard.mjs';
import { gitState } from '../core/git-available.mjs';

const execFileP = promisify(execFile);

/** The generated overlay and the one empty file every mask binds. Neither matches initDir's compose-file copy. */
export const MOUNT_FILE = 'project-mount.yml';
export const EMPTY_FILE = 'mask-empty';
/** More masks than this is a project to narrow (secretPathsUnmask) or clean up, not a mount table to build. */
export const MAX_MASKS = 500;
// worca's own run checkouts (legacy layout <project>/.worca-cc/worktrees/<id>): git content plus a paused run's own
// work. Masking a file there would hide the run's own output from it on resume.
const WORCA_DIR = '.worca-cc/';
// Installed packages: their CA bundles and test keys (certifi's cacert.pem in every Python virtualenv) are public, and
// an empty one breaks TLS in the box. maskPlan already skips node_modules for the same reason.
// Composer's composer/ca-bundle (vendor/) and pixi's environments (.pixi/envs/<name>/ssl/cacert.pem) ship one too.
const INSTALLED = /(^|\/)(site-packages|dist-packages|vendor|\.pixi)\//;
const notTheProjects = (rel) => rel.startsWith(WORCA_DIR) || INSTALLED.test(rel);

const real = (p) => { try { return realpathSync.native(p); } catch { return null; } };
/** Is `child` the folder `parent` or inside it? */
const within = (parent, child) => {
  const r = relative(parent, child);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/**
 * The one folder a project-scoped box binds, as its real path (the path the box sees). Refuses what is not one
 * project: a missing path, a file, the filesystem root, the home folder or a folder holding it, and a folder holding
 * the Worca home (its database and settings would be readable in the box).
 * @returns {{ dir: string } | { error: string }}
 */
export function resolveProjectDir(input, { home = homedir(), worcaHomeDir = null } = {}) {
  if (typeof input !== 'string' || !input.trim()) return { error: '--project needs a folder: --project <dir>' };
  const dir = real(resolve(input.trim()));
  if (!dir) return { error: `--project: ${input.trim()} does not exist` };
  if (!lstatSync(dir).isDirectory()) return { error: `--project: ${dir} is not a folder` };
  const myHome = real(home) || resolve(home);
  if (dir === parse(dir).root || within(dir, myHome)) return { error: `--project: ${dir} is too wide to mount; name one project folder` };
  const wh = worcaHomeDir ? (real(worcaHomeDir) || resolve(worcaHomeDir)) : null;
  if (wh && within(dir, wh)) return { error: `--project: ${dir} holds the Worca home ${wh}; name one project folder` };
  return { dir };
}

/** The patterns to mask and to leave unmasked, from THIS machine's settings for the folder (project layer, then
 *  ~/.worca-cc/settings.json). The box's own Settings live in its volume and cannot change its own mounts. */
export function maskSettingsFor(projectDir) {
  const value = (id) => { try { return resolveSetting(id, { projectDir }).value; } catch { return undefined; } };
  const unmask = value('secretPathsUnmask');
  return { patterns: secretPathsFor({ secretPaths: value('secretPaths') }), unmask: isSecretPathList(unmask) ? unmask.map((p) => p.trim()) : [] };
}

/** The files git tracks under `projectDir` (submodules included), relative to it; `tracked: null` + why when that
 *  cannot be known. A folder that is not a git work tree has nothing committed. `everAdded`: every path any commit of
 *  the repository added (all refs), which the box can read through `.git` (audit 2.9); empty when unknown. */
async function trackedFiles(projectDir) {
  if (!(await gitState()).available) return { tracked: null, everAdded: [], why: 'git is not installed here' };
  let env;
  try { env = await guardedGitEnv(projectDir); } catch { return { tracked: null, everAdded: [], why: 'its git config was refused' }; }
  const git = (args) => execFileP('git', args, { cwd: projectDir, env, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  try { await git(['rev-parse', '--is-inside-work-tree']); } catch { return { tracked: new Set(), everAdded: [], why: null }; }
  const list = (stdout) => stdout.split('\0').map((f) => f.replace(/^\n+/, '')).filter(Boolean);
  let everAdded = [];
  try { everAdded = list((await git([...HISTORY_ADDED_ARGS, '--all'])).stdout); } catch { /* no commit yet */ }
  try {
    const { stdout } = await git(['ls-files', '-z', '--recurse-submodules']);
    return { tracked: new Set(list(stdout)), everAdded, why: null };
  } catch { return { tracked: null, everAdded, why: 'git ls-files failed' }; }
}

/**
 * The secret files the box covers: maskPlan(projectDir, patterns) minus files under worca's own checkouts and under
 * installed packages, files an `unmask` pattern names (secretPathsUnmask), and committed files. Committed ones are
 * returned in `committed` to warn about: a mask would show them as modified, and an agent's `git add -A` could commit
 * them empty. Docker resolves a mount target through links, so a link is masked at its target when that is a file
 * inside the project; a link that leads out of the project or nowhere is returned in `skippedLinks`. When git cannot
 * say what is committed, every match is masked and `trackedUnknown` says why. `history`: secret paths only older commits
 * hold (deleted since), readable in the box through `.git`, to warn about.
 * @returns {Promise<{ masks: string[], committed: string[], history: string[], skippedLinks: string[], trackedUnknown: string|null }>}
 */
export async function planProjectMasks(projectDir, { patterns, unmask = [] } = {}) {
  const [found, { tracked, everAdded, why }] = await Promise.all([maskPlan(projectDir, patterns), trackedFiles(projectDir)]);
  const masks = new Set();
  const committed = new Set();
  const skippedLinks = [];
  for (const rel of found) {
    if (notTheProjects(rel) || (unmask.length && isSecretPath(rel, unmask))) continue;
    let st;
    try { st = lstatSync(join(projectDir, rel)); } catch { continue; }      // gone since the walk
    let target = rel;
    if (st.isSymbolicLink()) {
      const to = real(join(projectDir, rel));
      let file = false;
      try { file = !!to && lstatSync(to).isFile(); } catch {}
      if (!file || !within(projectDir, to)) { skippedLinks.push(rel); continue; }
      target = relative(projectDir, to).split(sep).join('/');
      if (notTheProjects(target)) continue;
    } else if (!st.isFile()) continue;                                      // a socket or a fifo: nothing to read
    if (tracked?.has(target)) committed.add(target); else masks.add(target);
  }
  // In the history but not in the work tree: nothing to mask, but `.git` in the box holds it.
  const history = [...new Set(everAdded.filter((f) => !tracked?.has(f) && !notTheProjects(f) && isSecretPath(f, patterns)
    && !(unmask.length && isSecretPath(f, unmask))))].sort();
  return { masks: [...masks].sort(), committed: [...committed].sort(), history, skippedLinks: skippedLinks.sort(), trackedUnknown: tracked ? null : why };
}

const swapCase = (s) => [...s].map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase())).join('');

/**
 * Masks the box can read past (audit 2.2): a mask is one bind on the exact name, and Docker Desktop resolves a lookup
 * on the host. On a case-insensitive or normalisation-insensitive filesystem (macOS APFS by default) `.ENV`, or the
 * other Unicode form of a name, opens the same host file through a path no mount covers. Probed on this filesystem:
 * a mask whose case-swapped or NFC/NFD spelling is the same file is returned with that spelling.
 * @returns {Array<{ rel: string, alias: string }>}
 */
export function maskAliases(projectDir, masks) {
  const out = [];
  for (const rel of masks) {
    let st; try { st = statSync(join(projectDir, rel)); } catch { continue; }
    for (const alias of new Set([swapCase(rel), rel.normalize('NFD'), rel.normalize('NFC')])) {
      if (alias === rel) continue;
      let as; try { as = lstatSync(join(projectDir, alias)); } catch { continue; }
      if (as.ino === st.ino && as.dev === st.dev) { out.push({ rel, alias }); break; }
    }
  }
  return out;
}

/** Why `up` refuses masks the box could read past (maskAliases), with the ways out. */
export function maskAliasRefusal(projectDir, aliased) {
  const shown = aliased.slice(0, 3).map((a) => `${a.alias} opens ${a.rel}`).join(', ');
  return `--project: ${projectDir} is on a filesystem that opens one file under other spellings (${shown}${aliased.length > 3 ? ', …' : ''}), `
    + 'and the box resolves a name on this machine, so its masks could be read past. Move the secret files out of the project, '
    + 'keep the project on a case-sensitive volume, or leave files that are not secret unmasked with the project\'s secretPathsUnmask setting';
}

// compose interpolates `$` in every string, so a literal one is written `$$`.
const composeValue = (value) => JSON.stringify(value).replaceAll('$', () => '$$');

/**
 * The compose project (`-p`) of a project-scoped box. Its own name gives it its own containers and volumes
 * (worca-home, claude-config): a box that ran other projects keeps their run checkouts, store and database in its
 * worca-home volume, and every agent can read that volume. Stable per real path, and a valid compose project name.
 */
export function boxName(projectDir) {
  const slug = basename(projectDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '') || 'project';
  return `worca-${slug}-${createHash('sha1').update(projectDir).digest('hex').slice(0, 8)}`;
}

/** The compose overlay: the box's projects root, then one long-syntax read-only bind of the empty file per mask.
 *  JSON flow maps and strings are valid YAML. */
export function renderMaskOverlay({ projectDir, masks, emptyFile }) {
  const base = projectDir.split(sep).join('/');
  const lines = ['# Generated by `worca container up --project` (docs/docker.md, "Project-scoped box").',
    '# Rewritten on every up and removed by --no-project; do not edit.', 'services:', '  worca:',
    // The project's parent, not the project: in the box it holds only the project and is not writable, so New and
    // Clone there fail instead of writing a new repository into the mounted project.
    '    environment:', `      WORCA_PROJECTS_ROOT: ${composeValue(posix.dirname(base))}`];
  if (masks.length) {
    lines.push('    volumes:', ...masks.map((rel) => `      - ${composeValue({ type: 'bind', source: emptyFile, target: `${base}/${rel}`, read_only: true })}`));
  }
  return [...lines, ''].join('\n');
}

/** Write the empty file (0 bytes, 0444, recreated so nothing written into it survives) and the overlay into `dir`. */
export function writeProjectMount(dir, { projectDir, masks }) {
  const empty = join(dir, EMPTY_FILE);
  rmSync(empty, { force: true });
  writeFileSync(empty, '', { mode: 0o444 });
  chmodSync(empty, 0o444);                                                   // the umask never widens it
  writeFileSync(join(dir, MOUNT_FILE), renderMaskOverlay({ projectDir, masks, emptyFile: empty }));
}

/** Back to the whole-tree bind: no overlay, no empty file. */
export function removeProjectMount(dir) {
  rmSync(join(dir, MOUNT_FILE), { force: true });
  rmSync(join(dir, EMPTY_FILE), { force: true });
}

const names = (list, max = 10) => (list.length > max ? `${list.slice(0, max).join(', ')} and ${list.length - max} more` : list.join(', '));
const plural = (n, one, many) => (n === 1 ? one : many);
/** The lines `up` prints for a project-scoped box: what is mounted and masked, and each secret it cannot mask. */
export function maskLines({ projectDir, masks, committed, history = [], skippedLinks, trackedUnknown }) {
  const lines = [{ level: 'info', text: `project  ${projectDir}   only this folder is mounted; ${masks.length} secret ${plural(masks.length, 'file', 'files')} masked${masks.length ? `: ${names(masks)}` : ''}` }];
  if (trackedUnknown) lines.push({ level: 'warn', text: `container mount: ${trackedUnknown}, so committed files could not be told apart; every matching file is masked` });
  if (committed.length) {
    const one = committed.length === 1;
    lines.push({ level: 'warn', text: `container mount: ${committed.length} committed ${one ? 'file looks' : 'files look'} like ${one ? 'a secret' : 'secrets'} and ${one ? 'is' : 'are'} `
      + `readable in the box with the git history: ${names(committed)}. ${HISTORY_REMEDY}` });
  }
  if (history.length) {
    const one = history.length === 1;
    lines.push({ level: 'warn', text: `container mount: ${history.length} ${one ? 'file that looks like a secret was' : 'files that look like secrets were'} deleted `
      + `but ${one ? 'is' : 'are'} still in older commits, readable in the box through .git: ${names(history)}. ${HISTORY_REMEDY}` });
  }
  if (skippedLinks.length) {
    const one = skippedLinks.length === 1;
    lines.push({ level: 'warn', text: `container mount: ${skippedLinks.length} ${one ? 'link named like a secret leads' : 'links named like secrets lead'} `
      + `out of the project or nowhere, so ${one ? 'it is' : 'they are'} not masked: ${names(skippedLinks)}` });
  }
  lines.push({ level: 'info', text: 'container mount: masks are set at up; a secret file added, or saved by an editor, while the box runs shows until the next `worca container up`' });
  return lines;
}
