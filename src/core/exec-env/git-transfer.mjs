// src/core/exec-env/git-transfer.mjs
// Code in/out for the e2b execution environment, without any GitHub credential:
// a bundle of the run branch is cloned in the sandbox; changes come back as binary
// patches of tree diffs and are applied to the local worktree (commits stay local).
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { shq } from './shell.mjs';
import { guardedGitEnv } from '../git-guard.mjs';
import { DEFAULT_SECRET_PATHS, isSecretPath } from '../secret-paths.mjs';

const execFileP = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;
// Every call runs in the run's worktree, so it gets git-guard's env (security G2).
export const git = async (args, cwd) => (await execFileP('git', args, { cwd, maxBuffer: MAX_BUFFER, env: await guardedGitEnv(cwd) })).stdout;

/** Bundle the worktree's branch (or HEAD when detached). */
export async function createSourceBundle({ worktreeDir, outFile }) {
  const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], worktreeDir).catch(() => '')).trim() || null;
  const head = (await git(['rev-parse', 'HEAD'], worktreeDir)).trim();
  await mkdir(dirname(outFile), { recursive: true });
  await git(['bundle', 'create', outFile, branch ? `refs/heads/${branch}` : 'HEAD'], worktreeDir);
  return { branch, head, file: outFile };
}

/** Every regular file under `p`. `p` itself may be a symlink (a skill dir worca linked in, run-context.mjs:547); a
 *  link found below it is followed only while its real path stays inside p's real path, so a link planted in a mount
 *  never pulls a file from elsewhere on the host into an upload. `onSkip(path)` hears about each link it refused. */
export async function walkFiles(p, { onSkip = () => {} } = {}) {
  let root; try { root = await realpath(p); } catch { return []; }
  const out = [];
  const walk = async (q, top) => {
    if (!top) {
      let real; try { real = await realpath(q); } catch { return; }
      if (real !== root && !real.startsWith(root + sep)) { onSkip(q); return; }
    }
    let st; try { st = await stat(q); } catch { return; }
    if (st.isFile()) { out.push(q); return; }
    if (!st.isDirectory()) return;
    for (const e of await readdir(q)) await walk(join(q, e), false);
  };
  await walk(p, true);
  return out;
}

/** What a fresh clone of the branch lacks: dirty + untracked (non-ignored) files (`files`,
 *  sent as they are: a symlink travels as a symlink, never as what it points at), the
 *  injected/extra paths (`mounts`, relative to the worktree, e.g. the memory mount, skills,
 *  graphify-out/ which ignores itself; sent dereferenced), and the deletions to replay.
 *  A file or mount path matching `secretPaths` (secret-paths.mjs) stays on this machine and is listed in `masked`.
 *  A committed one (in HEAD, so in the git bundle already) is listed in `trackedSecrets` to warn about, never masked,
 *  so the sandbox clone still equals git. */
export async function overlayFiles({ worktreeDir, injected = [], onSkip, secretPaths = DEFAULT_SECRET_PATHS }) {
  const z = (s) => s.split('\0').filter(Boolean);
  const deleted = z(await git(['ls-files', '-z', '--deleted'], worktreeDir));
  const gone = new Set(deleted);
  const roots = injected.map((rel) => relative(worktreeDir, resolve(worktreeDir, rel)).split(sep).join('/')).filter((r) => r && !r.startsWith('..'));
  const underMount = (f) => roots.some((r) => f === r || f.startsWith(`${r}/`));
  const secret = (f) => isSecretPath(f, secretPaths);
  const masked = new Set();
  const keep = (f) => { if (!secret(f)) return true; masked.add(f); return false; };
  // A mount (a symlinked skill dir) goes in whole below; its own path must not also arrive as a symlink. A file staged
  // as new is neither in the bundle (HEAD) nor modified against the index: it goes too.
  const head = async (args) => { try { return z(await git(args, worktreeDir)); } catch { return []; } };   // no commit yet
  const stagedNew = await head(['diff', '--cached', '--name-only', '-z', '--diff-filter=A', 'HEAD']);
  const files = [...z(await git(['ls-files', '-z', '--modified', '--others', '--exclude-standard'], worktreeDir)), ...stagedNew]
    .filter((f) => !gone.has(f) && !underMount(f) && keep(f));
  const mounts = new Set();
  for (const rel of injected) {
    for (const abs of await walkFiles(resolve(worktreeDir, rel), { onSkip })) {
      const r = relative(worktreeDir, abs);
      if (r && !r.startsWith('..')) { const p = r.split(sep).join('/'); if (keep(p)) mounts.add(p); }
    }
  }
  // What the bundle carries is HEAD: a secret only staged is not in it (it is masked above), only a committed one.
  const trackedSecrets = (await head(['ls-tree', '-r', '-z', '--name-only', 'HEAD'])).filter(secret);
  return { files: [...new Set(files)].sort(), mounts: [...mounts].sort(), deleted: deleted.sort(),
    masked: [...masked].sort(), trackedSecrets: [...new Set(trackedSecrets)].sort() };
}

/** The run-log lines for overlayFiles' `masked` and `trackedSecrets`: each list named once, paths only. */
export function overlaySecretLines({ masked = [], trackedSecrets = [] }) {
  const lines = [];
  if (masked.length) {
    lines.push({ level: 'warn', text: `sandbox upload: ${masked.length} secret file${masked.length === 1 ? '' : 's'} kept on this machine: ${masked.join(', ')}` });
  }
  if (trackedSecrets.length) {
    const one = trackedSecrets.length === 1;
    lines.push({ level: 'warn', text: `sandbox upload: ${trackedSecrets.length} committed file${one ? ' looks' : 's look'} like ${one ? 'a secret' : 'secrets'} and `
      + `reach${one ? 'es' : ''} the sandbox with the git history: ${trackedSecrets.join(', ')}. Remove ${one ? 'it' : 'them'} from the repository to keep ${one ? 'it' : 'them'} out.` });
  }
  return lines;
}

/** tar.gz of `files` (relative to `cwd`). `dereference` (-h) copies a symlinked skill's content;
 *  without it a symlink is archived as a symlink. COPYFILE_DISABLE: macOS tar would otherwise add an
 *  AppleDouble `._<name>` member for every file with extended attributes, which GNU tar in the
 *  sandbox extracts as real files. */
export async function makeTarGz({ cwd, files, outFile, dereference = true }) {
  const list = `${outFile}.list`;
  await writeFile(list, files.join('\0'));
  try {
    await execFileP('tar', [dereference ? '-czhf' : '-czf', outFile, '-C', cwd, '--null', '-T', list],
      { maxBuffer: MAX_BUFFER, env: { ...process.env, COPYFILE_DISABLE: '1' } });
  } finally { await rm(list, { force: true }); }
}

/** Apply a sandbox patch to the host worktree; --check first so a failure changes nothing.
 *  git apply refuses `..`, `.git/` and beyond-symlink paths (the sandbox is untrusted). */
export async function applyPatch({ worktreeDir, patchFile }) {
  const args = ['apply', '--binary', '--whitespace=nowarn'];
  await git([...args, '--check', patchFile], worktreeDir);
  await git([...args, patchFile], worktreeDir);
}
// ── files the host runs or loads later (the sandbox is untrusted; plans/security-evaluation E2) ──
// Paths compare case-folded and NFC: on a case-insensitive or normalising file system `.Husky/pre-commit` lands in
// `.husky/`. A patch never reaches `.git/` (git apply refuses it), so git config, and with it every filter, diff and
// merge driver a `.gitattributes` line can name, stays the host's own.
const fold = (s) => String(s).normalize('NFC').toLowerCase().replace(/^\.\//, '');
/** Where repositories keep git hooks that tools install and run (husky, lefthook, pre-commit, plain hook dirs). */
const HOOK_DIRS = new Set(['.husky', '.githooks', '.git-hooks', 'githooks', '.hooks', '.lefthook']);
const HOOK_ROOT_FILES = /^(?:\.?lefthook(?:-local)?\.(?:ya?ml|toml|json)|\.pre-commit-(?:config|hooks)\.ya?ml|\.huskyrc(?:\.(?:json|c?js|ya?ml))?|husky\.config\.c?js|\.?simple-git-hooks\.(?:json|c?js))$/;
/** package.json keys a hook manager reads at commit time (husky 4, simple-git-hooks, pre-commit). */
const PACKAGE_HOOK_KEYS = ['husky', 'simple-git-hooks', 'pre-commit'];
/** True for a repo-relative path that configures or holds git hooks: a hook directory, a root hook config, or anything
 *  under the repo's own `core.hooksPath` (`hooksPath`, repo-relative, '' when unset). */
export function isHookPath(rel, hooksPath = '') {
  const p = fold(rel); const h = fold(hooksPath);
  if (HOOK_DIRS.has(p.split('/')[0])) return true;
  if (!p.includes('/') && HOOK_ROOT_FILES.test(p)) return true;
  return !!h && (p === h || p.startsWith(`${h}/`));
}
/** Agent CLI config folders, at any depth: Claude Code's settings (hooks, statusLine, apiKeyHelper, env, plugins, the
 *  local MCP approvals), agents, commands and skills (their frontmatter can carry hooks); Cursor's, Codex's and
 *  Gemini's hooks, MCP servers and permissions. A local step, a resume on Local or the user's own CLI loads them. */
const AGENT_CONFIG_DIRS = new Set(['.claude', '.cursor', '.codex', '.gemini', '.qwen']);
/** True for a path an agent CLI on this machine loads as config: under an AGENT_CONFIG_DIRS folder, or the repository's
 *  Copilot CLI hooks (`.github/hooks/`). */
export function agentConfigPath(rel) {
  const segs = fold(rel).split('/');
  return segs.slice(0, -1).some((s) => AGENT_CONFIG_DIRS.has(s)) || (segs[0] === '.github' && segs[1] === 'hooks' && segs.length > 2);
}
/** Files only a person runs later (worca never does): they come home, with a line to review them first. */
const REVIEW_RULES = [
  [(segs) => segs[0] === '.vscode' && segs.length > 1, 'VS Code workspace config: its tasks and settings can run commands once the folder is opened'],
  [(segs) => segs[0] === '.devcontainer' && segs.length > 1, 'dev container config: its commands run when the folder is opened in a container'],
  [(segs) => segs[0] === '.github' && segs[1] === 'workflows' && segs.length > 2, 'a GitHub Actions workflow: it runs on GitHub once the branch is pushed'],
  [(segs) => segs.at(-1) === '.envrc', 'direnv runs it in a shell that enters the folder (after `direnv allow`)'],
  [(segs) => segs.at(-1) === '.npmrc', 'npm reads it on every npm command (script-shell, node-options)'],
  [(segs) => ['mise.toml', '.mise.toml', 'mise.local.toml', '.mise.local.toml'].includes(segs.at(-1)), 'mise runs its hooks and tasks in a shell that enters the folder'],
];
const reviewReason = (rel) => { const segs = fold(rel).split('/'); return REVIEW_RULES.find(([t]) => t(segs))?.[1] || null; };

/** Every path a patch touches, as git apply itself reads it (`--numstat -z`; renames give both sides). */
export async function patchPaths({ worktreeDir, patchFile }) {
  const out = await git(['apply', '--numstat', '-z', patchFile], worktreeDir);
  return [...new Set(out.split('\0').map((t) => t.replace(/^[\d-]+\t[\d-]+\t/, '')).filter(Boolean))];
}
/** The touched `paths` that are git hooks (isHookPath). Hooks run on this machine at the next commit or push, so a
 *  sandbox may never change them. */
export async function hookPaths({ worktreeDir, paths }) {
  // The guard's own core.hooksPath is command scope; the repository's value is the one a later commit uses.
  const scoped = (await git(['config', '--show-scope', '--get-all', 'core.hooksPath'], worktreeDir).catch(() => '')).split('\n');
  let hooksPath = (scoped.filter((l) => l && !l.startsWith('command\t')).pop() || '').replace(/^[^\t]*\t/, '').trim();
  if (hooksPath.startsWith('/')) { const r = relative(worktreeDir, hooksPath); hooksPath = r.startsWith('..') ? '' : r; }
  hooksPath = hooksPath.replace(/^\.\//, '').replace(/\/+$/, '');
  return paths.filter((p) => isHookPath(p, hooksPath));
}
const parseJson = (text) => {
  if (text == null) return null;
  try { const v = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  catch { return null; }
};
/** The names of `now` (an object, or nothing) that `was` lacks or holds differently. Removals are not changes. */
const changedNames = (was, now) => (now && typeof now === 'object' ? Object.keys(now) : [])
  .filter((n) => !was || typeof was !== 'object' || !Object.hasOwn(was, n) || !isDeepStrictEqual(was[n], now[n]));
/** `rel` as the patch leaves it: the host's copy patched alone in a scratch folder (`git apply --include`, no
 *  repository), so the host worktree is never touched before the checks pass. null when the patch deletes it. */
async function patchedText({ worktreeDir, patchFile, rel }) {
  const dir = await mkdtemp(join(tmpdir(), 'worca-patched-'));
  try {
    const dst = join(dir, rel);
    await mkdir(dirname(dst), { recursive: true });
    try { if ((await lstat(join(worktreeDir, rel))).isFile()) await copyFile(join(worktreeDir, rel), dst); } catch { /* added by the patch */ }
    await execFileP('git', ['apply', '--binary', '--whitespace=nowarn', `--include=${rel.replace(/[\\*?[\]]/g, '\\$&')}`, patchFile],
      { cwd: dir, maxBuffer: MAX_BUFFER, env: await guardedGitEnv(dir, { env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) } }) });
    try { return await readFile(dst, 'utf8'); } catch { return null; }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const hostText = async (worktreeDir, rel) => { try { return await readFile(join(worktreeDir, rel), 'utf8'); } catch { return null; } };

/**
 * What of a sandbox patch would run on this machine later. `paths`: patchPaths. `mcpVerdict()` resolves to the host's
 * approval check for the project's committed `.mcp.json` servers (run-context mcpjsonApproval).
 * - `hooks`: git hook files and hook manager config (also a package.json `husky` / `simple-git-hooks` / `pre-commit`
 *   key): worca's own end-of-run commit runs them. Refused.
 * - `config`: agent CLI config (agentConfigPath), and root `.mcp.json` servers added or changed that Claude Code would
 *   start without asking (approved by name, or every project server is). Refused: a local step, a resume on Local
 *   or the user's own CLI loads them.
 * - `review`: [{ path, why }] files only a person runs (REVIEW_RULES), changed npm scripts, and `.mcp.json` servers that
 *   wait for an approval. They come home; the caller says so.
 */
export async function hostRunChanges({ worktreeDir, patchFile, paths, mcpVerdict }) {
  const hooks = await hookPaths({ worktreeDir, paths });
  const config = paths.filter(agentConfigPath);
  const review = [];
  for (const p of paths) { const why = reviewReason(p); if (why && !hooks.includes(p) && !config.includes(p)) review.push({ path: p, why }); }
  for (const p of paths) {
    const base = fold(p).split('/').at(-1);
    if (base !== 'package.json' && !(base === '.mcp.json' && !fold(p).includes('/'))) continue;
    const was = parseJson(await hostText(worktreeDir, p));
    const now = parseJson(await patchedText({ worktreeDir, patchFile, rel: p }));
    if (base === 'package.json') {
      const keys = PACKAGE_HOOK_KEYS.filter((k) => now && Object.hasOwn(now, k) && !isDeepStrictEqual(was?.[k], now[k]));
      if (keys.length) hooks.push(`${p} (${keys.join(', ')})`);
      const scripts = changedNames(was?.scripts, now?.scripts);
      if (scripts.length) review.push({ path: p, why: `npm scripts ${scripts.join(', ')} added or changed: npm runs them on this machine, install scripts included` });
      continue;
    }
    const names = changedNames(was?.mcpServers, now?.mcpServers);
    if (!names.length) continue;
    const verdict = await mcpVerdict();
    const live = names.filter((n) => verdict(n) === 'approved');
    const held = names.filter((n) => verdict(n) === 'unapproved');
    if (live.length) config.push(`${p} (${live.join(', ')})`);
    if (held.length) review.push({ path: p, why: `MCP servers ${held.join(', ')} added or changed: they start only once approved, so review them before approving` });
  }
  return { hooks, config, review };
}
/** The touched `paths` at or under an injected path (`roots`, worktree-relative). Those are host-owned (the memory
 *  mount, skills): the sandbox tree leaves them out, so only a forged patch carries one, e.g. a symlink planted in
 *  the memory mount that a later upload would follow to a host file. Compared case-folded and NFC: on a
 *  case-insensitive or normalising file system `.Claude/Rules/worca/x` lands in the same directory. */
export function injectedPaths({ worktreeDir, paths, roots }) {
  const fold = (s) => s.normalize('NFC').toLowerCase();
  const rels = roots.map((r) => fold(relative(worktreeDir, resolve(worktreeDir, r)).split(sep).join('/'))).filter((r) => r && !r.startsWith('..'));
  return paths.filter((p) => { const q = fold(p.replace(/^\.\//, '')); return rels.some((r) => q === r || q.startsWith(`${r}/`)); });
}
/** True when the host worktree already holds the whole patch (a reverse apply would succeed). */
export async function patchAlreadyApplied({ worktreeDir, patchFile }) {
  try { await git(['apply', '--binary', '--whitespace=nowarn', '-R', '--check', patchFile], worktreeDir); return true; }
  catch { return false; }
}

// ── scripts run INSIDE the sandbox (bash -l -c) ──
export const cloneScript = ({ bundle, dir, branch, head }) =>
  `set -e; git clone -q --no-checkout ${shq(bundle)} ${shq(dir)}; cd ${shq(dir)}; `
  + (branch ? `git checkout -q -B ${shq(branch)} ${head}; ` : `git checkout -q --detach ${head}; `)
  + 'git remote remove origin';
/** The working tree as a tree object, via a private index (the agent's own index is untouched).
 *  `excludes` (worktree-relative §8.8 injected paths: skills, memory mount) are dropped from the
 *  index after the add — never passed as `:(exclude)` pathspecs, which make `git add` exit 1 for a
 *  literal path an ignore rule matches. Injected files are host-owned and never travel back. */
export const treeScript = ({ dir, index, excludes = [] }) =>
  `set -e; cd ${shq(dir)}; export GIT_INDEX_FILE=${shq(index)}; [ -f "$GIT_INDEX_FILE" ] || git read-tree HEAD; git add -A >/dev/null 2>&1; `
  + (excludes.length ? `git rm -r -q --cached --ignore-unmatch -- ${excludes.map(shq).join(' ')} >/dev/null; ` : '')
  + 'git write-tree';
/** The first merge commit the agent made since the bundled head (empty when none). */
export const mergesScript = ({ dir, since }) => {
  if (!/^[0-9a-f]{40,64}$/.test(String(since))) throw new Error(`not a commit id: ${since}`);
  return `cd ${shq(dir)} && git rev-list --merges -n 1 ${since}..HEAD`;
};
export const diffScript = ({ dir, from, to, out }) =>
  `set -e; cd ${shq(dir)}; git diff --binary --full-index --no-ext-diff --no-textconv ${from} ${to} > ${shq(out)}; wc -c < ${shq(out)}`;
/** path -> "size:mtimeMs" for every regular file under the roots (node is in the template). */
export const SNAPSHOT_JS = "const fs=require('fs'),p=require('path');const o={};const w=(d)=>{let es;try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return}for(const e of es){const f=p.join(d,e.name);if(e.isDirectory()){if(e.name!=='.git')w(f)}else if(e.isFile()){const s=fs.statSync(f);o[f]=s.size+':'+s.mtimeMs}}};for(const r of process.argv.slice(1))w(r);process.stdout.write(JSON.stringify(o))";
