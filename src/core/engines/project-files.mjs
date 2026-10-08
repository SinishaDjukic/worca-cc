// src/core/engines/project-files.mjs
// The config files an engine reads from its cwd and worca writes into a run checkout per spawn (Cursor's
// `.cursor/cli.json` and `.cursor/mcp.json`, Gemini CLI's `.gemini/settings.json`): the writer, the ownership ledger
// that says which of those files is worca's, and the info/exclude line that keeps them out of every commit and diff.
// The harness (run-harness.mjs _registerEngineConfig, _injectedFor, _engineConfigState) reads ALL_PROJECT_FILES and
// worcaOwnsProjectFile, so a file an earlier segment of a run wrote on another engine is still cleaned up.
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, appendFileSync, chmodSync, existsSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { worcaHome } from '../projects.mjs';

/** Per engine: the dir its files sit in, the files (relative to the cwd), and its display name. */
const ENGINES = Object.freeze({
  cursor: Object.freeze({ dir: '.cursor', files: Object.freeze(['.cursor/cli.json', '.cursor/mcp.json']), label: 'Cursor' }),
  gemini: Object.freeze({ dir: '.gemini', files: Object.freeze(['.gemini/settings.json']), label: 'Gemini CLI' }),
});

/** The project files each engine reads from its cwd and worca may write there, relative to it. */
export const ENGINE_PROJECT_FILES = Object.freeze(Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.files])));
/** Every engine's project files (the harness cleans any of them up, whatever the run's engine is now). */
export const ALL_PROJECT_FILES = Object.freeze(Object.values(ENGINE_PROJECT_FILES).flat());

const engineOf = (name) => {
  const e = ENGINES[name];
  if (!e) throw new Error(`no project files for engine "${name}"`);
  return e;
};
/** The engine whose project file `rel` is, or null. */
const engineOfFile = (rel) => Object.keys(ENGINES).find((k) => ENGINES[k].files.includes(rel)) ?? null;

const git = (cwd, args) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const excludeNote = (engine) => `# worca: ${engineOf(engine).label} engine config written into run checkouts (engines/project-files.mjs)`;
/** Whether `dir` or a parent holds a `.git` (so a failed `git rev-parse` is a git failure, not "no repository"). */
const gitAbove = (dir) => { for (let d = resolve(dir); ; d = dirname(d)) { if (existsSync(join(d, '.git'))) return true; if (dirname(d) === d) return false; } };
/** The info/exclude line for `rel` under the cwd's work-tree prefix: anchored, with gitignore glob characters escaped. */
export const excludeLine = (prefix, rel) => `/${`${prefix}${rel}`.replace(/[\\[\]*?!#]/g, '\\$&')}`;

// ── ownership: worca touches only an engine file it wrote ───────────────────
// "Untracked" is not "worca's": outside git it is every file (the model test's cwd may be $HOME, holding the user's
// ~/.cursor/mcp.json or ~/.gemini/settings.json), and an agent may write such a file as the task's deliverable. The
// ledger maps a file's absolute path to the sha256 of what worca last wrote there, one folder per engine. Paths are
// compared as `resolve()`d strings: the adapter and the harness both join the same run cwd string.
const sha = (t) => createHash('sha256').update(t).digest('hex');
const ownedDir = (engine) => join(worcaHome(), 'engines', engine, 'owned');
const ownedEntry = (engine, abs) => join(ownedDir(engine), `${sha(resolve(abs)).slice(0, 32)}.json`);
const LEDGER_PRUNE_AGE_MS = 3_600_000;

/** True when `abs` is absent (nothing to protect) or holds exactly what worca last wrote there for `engine`. */
export function projectFileOwned(engine, abs) {
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch (err) { return err?.code === 'ENOENT'; }
  try { return JSON.parse(readFileSync(ownedEntry(engine, abs), 'utf8')).sha256 === sha(text); } catch { return false; }
}

/** projectFileOwned for whichever engine `rel` (a path relative to `cwd`) belongs to; false for any other path. */
export function worcaOwnsProjectFile(cwd, rel) {
  const engine = engineOfFile(rel);
  return engine ? projectFileOwned(engine, join(cwd, rel)) : false;
}

/** Record `text` as worca's content of `abs` (BEFORE the file is written: a crash in between leaves an absent file,
 *  which is writable, never an unowned one). Entries over an hour old whose file is gone are dropped. */
function recordOwned(engine, abs, text) {
  const dir = ownedDir(engine);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const now = Date.now();
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try { if (now - statSync(p).mtimeMs > LEDGER_PRUNE_AGE_MS && !existsSync(JSON.parse(readFileSync(p, 'utf8')).path)) rmSync(p, { force: true }); }
    catch { /* a half-written or vanished entry: leave it to the next prune */ }
  }
  writeFileSync(ownedEntry(engine, abs), JSON.stringify({ path: resolve(abs), sha256: sha(text) }), { mode: 0o600 });
}
const forgetOwned = (engine, abs) => rmSync(ownedEntry(engine, abs), { force: true });

/**
 * Make `cwd`'s project files of `engine` (ENGINE_PROJECT_FILES) match `files` ({'.cursor/cli.json': text, …}).
 * - Each file given is written. A path the checkout TRACKS is never written (throws: the file would change in the
 *   deliverable). A path holding a file worca did not write (projectFileOwned false) is never overwritten (throws).
 * - Each file not given is removed when worca wrote it (an earlier spawn's rules or servers must not reach a later
 *   node). A file worca did not write is left alone.
 * - Inside a git work tree each written path gets an info/exclude line, so neither an agent's own `git add -A` nor
 *   worca's commit and diffs stage it (run-harness.mjs _engineConfigState also unstages it). The harness's §8.8 entry
 *   (_registerEngineConfig, filtered by worcaOwnsProjectFile in _injectedFor) removes it at teardown.
 * - Mode 0644 (and 0755 for an engine dir worca creates): the files hold only env references, never a secret value,
 *   and an agent-user spawn (asAgent) runs under another uid that must read them.
 * - An engine dir that is a symlink is never written or removed through: the link may point anywhere, the user's
 *   home config included, and every check above would pass on the far side of it (throws when files are given).
 * - Atomic per file, idempotent. A failed write leaves the ledger on the file's previous content and no temp file.
 * The exclude line is `/<cwd's prefix in the work tree><rel>`, from `git rev-parse --show-prefix`: never computed from
 * absolute paths, which differ by realpath on macOS (/var → /private/var).
 */
export function writeProjectFiles(engine, cwd, files) {
  const { dir, files: known, label } = engineOf(engine);
  const entries = Object.entries(files);
  for (const [rel] of entries) if (!known.includes(rel)) throw new Error(`${rel} is not a ${label} project file`);
  let linked = false;
  try { linked = lstatSync(join(cwd, dir)).isSymbolicLink(); } catch { /* absent */ }
  const stale = linked ? [] : known.filter((rel) => !(rel in files) && existsSync(join(cwd, rel)));
  for (const rel of stale) {
    const abs = join(cwd, rel);
    if (projectFileOwned(engine, abs)) { rmSync(abs, { force: true }); forgetOwned(engine, abs); }
  }
  if (!entries.length) return;
  if (linked) throw new Error(`${join(cwd, dir)} is a symlink — worca will not write ${label}'s config through it (it may point outside the checkout)`);
  const inside = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside === null && gitAbove(cwd)) throw new Error(`git cannot read the repository around ${cwd} — worca will not write ${label}'s config blind`);
  const inTree = inside === 'true';
  if (inTree) {
    const tracked = git(cwd, ['ls-files', '--', ...entries.map(([rel]) => `:(icase)${rel}`)]);
    if (tracked === null) throw new Error(`cannot tell whether the checkout tracks ${entries.map(([rel]) => rel).join(' or ')} — worca will not write ${label}'s config blind`);
    if (tracked) throw new Error(`the checkout tracks ${tracked.split('\n')[0]} — worca cannot add its ${label} config without changing your file`);
  }
  const foreign = entries.map(([rel]) => rel).filter((rel) => !projectFileOwned(engine, join(cwd, rel)));
  if (foreign.length) throw new Error(`${foreign.join(' and ')} already exists in ${cwd} and worca did not write it — worca will not overwrite it (move it away to run this on ${label})`);
  if (inTree) {
    const prefix = git(cwd, ['rev-parse', '--show-prefix']) ?? '';
    const exclude = git(cwd, ['rev-parse', '--git-path', 'info/exclude']);
    // The exclude line is what keeps these files out of every `git add -A` (the harness's commit included: it uses no
    // exclude pathspec for them, because git refuses one that names an ignored path). No line, no write.
    if (!exclude) throw new Error(`cannot find the repository's info/exclude around ${cwd} — worca will not write ${label}'s config where git would stage it`);
    const path = isAbsolute(exclude) ? exclude : join(cwd, exclude);
    let cur = '';
    try { cur = readFileSync(path, 'utf8'); } catch { /* none yet */ }
    const have = new Set(cur.split('\n'));
    const want = entries.map(([rel]) => excludeLine(prefix, rel)).filter((l) => !have.has(l));
    if (want.length) {
      const note = excludeNote(engine);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${cur && !cur.endsWith('\n') ? '\n' : ''}${have.has(note) ? '' : `${note}\n`}${want.join('\n')}\n`);
    }
  }
  for (const [rel, text] of entries) {
    const file = join(cwd, rel);
    let cur = null;
    try { cur = readFileSync(file, 'utf8'); } catch { /* new */ }
    if (cur === text) continue;                // owned and unchanged (projectFileOwned passed above)
    if (mkdirSync(dirname(file), { recursive: true })) chmodSync(dirname(file), 0o755);   // only a dir worca created
    recordOwned(engine, file, text);
    const tmp = `${file}.worca-${process.pid}-${Date.now().toString(36)}`;
    try {
      writeFileSync(tmp, text, { mode: 0o644 });
      chmodSync(tmp, 0o644);                   // the umask may have narrowed it
      renameSync(tmp, file);
    } catch (err) {
      rmSync(tmp, { force: true });
      if (cur === null) forgetOwned(engine, file); else recordOwned(engine, file, cur);   // the file still holds worca's old content
      throw err;
    }
  }
}
