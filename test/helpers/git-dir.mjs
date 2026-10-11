// test/helpers/git-dir.mjs
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

/** A throwaway git repo with one empty commit — the shape every orchestrator
 *  suite needs (a checkpoint ref must be resolvable). Same one-liner the
 *  orchestrator-* suites inline today. */
export function gitDir(tag = 'graph') {
  const dir = mkdtempSync(join(tmpdir(), `worca-cc-${tag}-`));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

// ── Templates: built once per test process, copied per caller ─────────────────────────────
const _templates = new Map(); // key → template dir (never handed out; callers get copies)
process.on('exit', () => {
  for (const d of _templates.values()) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
  }
});

/** Run a synchronous template build with git's auto-maintenance off. A commit, fetch or merge
 *  otherwise starts `git maintenance run --auto --detach`, which takes `.git/objects/maintenance.lock`
 *  in the background while copyOf is still copying the template: cpSync then fails with ENOENT on a
 *  file that vanished mid-copy. Set through the environment so a build's own git calls inherit it. */
function withoutAutoMaintenance(build) {
  const keys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const n = Number.parseInt(process.env.GIT_CONFIG_COUNT || '0', 10) || 0;
  process.env[`GIT_CONFIG_KEY_${n}`] = 'maintenance.auto';
  process.env[`GIT_CONFIG_VALUE_${n}`] = 'false';
  process.env.GIT_CONFIG_COUNT = String(n + 1);
  try { return build(); } finally {
    delete process.env[`GIT_CONFIG_KEY_${n}`]; delete process.env[`GIT_CONFIG_VALUE_${n}`];
    for (const k of keys) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
  }
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (${cwd}): ${r.stderr}`);
  return r.stdout.trim();
}

function copyOf(src, { tag, prefix = `worca-cc-${tag}-`, into = null }) {
  const dir = into ? (mkdirSync(into, { recursive: true }), into) : mkdtempSync(join(tmpdir(), prefix));
  // verbatimSymlinks: the default rewrites a relative symlink to an absolute path INTO the template.
  cpSync(src, dir, { recursive: true, verbatimSymlinks: true });
  return dir;
}

/** A repo copied from a per-process template: 0 git spawns per fixture instead of 2–7.
 *  Defaults reproduce gitDir() (host default branch, identity only via -c, one empty commit).
 *  The private freshRepo() copies need
 *    templateRepo(tag, { branch: 'main', user: true, files: { 'README.md': '# hi\n' } })
 *  (init -b main, user.email/name stored in .git/config, the files committed as "init").
 *  { commit: false } = `git init` only. `prefix` replaces the default `worca-cc-<tag>-` mkdtemp prefix
 *  (a freshRepo's own prefix: the project slug derives from the basename); `into` copies into that
 *  directory instead (a member dir under a workspace root, e.g. makeWorkspace's join(root, name)).
 *  Copies are the CALLER's to remove (push them onto the file's cleanup list). */
export function templateRepo(tag = 'repo', { commit = true, branch = null, user = false, files = null, prefix, into } = {}) {
  const key = `repo:${JSON.stringify({ commit, branch, user, files })}`;
  if (!_templates.has(key)) {
    const t = mkdtempSync(join(tmpdir(), 'worca-cc-tpl-'));
    withoutAutoMaintenance(() => buildRepo(t, { commit, branch, user, files }));
    _templates.set(key, t);
  }
  return copyOf(_templates.get(key), { tag, prefix, into });
}

/** The template repo templateRepo copies: init, optional stored identity and files, optional first commit. */
function buildRepo(t, { commit, branch, user, files }) {
  git(t, branch ? ['init', '-q', '-b', branch] : ['init', '-q']);
  if (user) { git(t, ['config', 'user.email', 't@t']); git(t, ['config', 'user.name', 't']); }
  for (const [rel, text] of Object.entries(files || {})) {
    const abs = join(t, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  if (commit) {
    if (files) git(t, ['add', '-A']);
    git(t, ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false',
      'commit', '-q', '--no-verify', ...(files ? [] : ['--allow-empty']), '-m', 'init']);
  }
}

/** [templateSpelling, copySpelling] pairs: git records a path as given OR realpath'd (a relative
 *  `git clone origin.git b` stores /private/var/… on macOS while tmpdir() is /var/…), and on
 *  Windows possibly with forward slashes. Longest first, so a prefix never splits a longer form. */
function spellingPairs(src, dir) {
  const pairs = new Map();
  for (const [s, d] of [[src, dir], [realpathSync(src), realpathSync(dir)]]) {
    pairs.set(s, d);
    pairs.set(s.replaceAll('\\', '/'), d.replaceAll('\\', '/'));
  }
  return [...pairs].sort((x, y) => y[0].length - x[0].length);
}

/** Git metadata files that can hold an absolute path: config (remote URLs), gitfiles (.git of a
 *  linked worktree), worktrees/<id>/gitdir, objects/info/alternates, and FETCH_HEAD (its lines
 *  name the fetched URL; git-sync's lastFetchedAt matches them against remote.origin.url). */
const META = new Set(['config', '.git', 'gitdir', 'alternates', 'FETCH_HEAD']);
function metaFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) metaFiles(p, out);
    else if (e.isFile() && META.has(e.name)) out.push(p);
  }
  return out;
}

/** A multi-repo world (bare origin + clones, in whatever layout `build` makes under its root),
 *  built ONCE per process per `key`, then copied per caller. Absolute template paths in git
 *  metadata are rewritten to the copy; a leftover throws (a copy that fetched from or pushed
 *  into the template would corrupt every later copy silently). `key` is required: anonymous
 *  builds have no name, so keying on build.name hands two different worlds the same copy. */
export function templateWorld(key, build /* (root) => void, runs once */, tag = 'world') {
  if (typeof key !== 'string' || !key) throw new TypeError('templateWorld(key, build): key must be a non-empty string');
  const k = `world:${key}`;
  if (!_templates.has(k)) {
    const t = mkdtempSync(join(tmpdir(), 'worca-cc-tplw-'));
    const built = withoutAutoMaintenance(() => build(t));
    if (built && typeof built.then === 'function') throw new TypeError('templateWorld: build must be synchronous (an async build caches a half-built template)');
    _templates.set(k, t);
  }
  const src = _templates.get(k);
  const dir = copyOf(src, { tag });
  const pairs = spellingPairs(src, dir);
  for (const file of metaFiles(dir)) {
    const before = readFileSync(file, 'utf8');
    let text = before;
    for (const [s, d] of pairs) text = text.split(s).join(d);
    if (text !== before) writeFileSync(file, text);
    for (const [s] of pairs) {
      if (!text.includes(s)) continue;
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      throw new Error(`templateWorld: ${file} still names the template (${s})`);
    }
  }
  return dir;
}
