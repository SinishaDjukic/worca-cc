// src/core/skills-registry/import.mjs
// Import into the skill library (skills registry design §2b-8, §5 import consent, §7 import routes). A source — a
// folder, a pasted SKILL.md, one of ~/.claude/skills, a git URL pinned to a commit — is staged in
// <WORCA_HOME>/tmp/skills/<stage>/ with its origin in <stage>.json, inspected, and then committed
// (library.mjs commitImport) or discarded. Worca never runs anything it stages. An update preview re-stages a
// library skill from its origin and lists what changed (library.mjs applyUpdate swaps it in).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, lstatSync, writeFileSync, cpSync, chmodSync, readlinkSync, symlinkSync } from 'node:fs';
import { join, basename, dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { writeJsonAtomic } from '../json-atomic.mjs';
import { isValidSkillName } from '../skills.mjs';
import { githubEnv } from '../github-credentials.mjs';
import { hasTokenShape } from '../mcp-secrets.mjs';
import { SKILL_LIMITS, SKILL_LINKS_AND_FOLDERS_MAX, inspectSkillDir, isValidSkillFolderName, readSkillMd, skillFileDigests, skillNameProblem } from './inspect.mjs';
import { SkillLibraryError, stagesDir, stageDirOf, skillsDir, readSkillLibrary } from './library.mjs';
import { gitAvailable } from '../git-available.mjs';
import { isRepoFolder, pickSkillFolder, skillTreeProblems } from './git-tree.mjs';
import { fetchGitHttps } from '../git-free/skills.mjs';

const fail = (status, message, extra) => { throw new SkillLibraryError(status, message, extra); };

/** A stage nobody committed or discarded is removed by the first stageImport a day later. */
export const STAGE_TTL_MS = 24 * 60 * 60 * 1000;

function sweepStages(now = Date.now()) {
  let names;
  try { names = readdirSync(stagesDir()); } catch { return; }
  for (const n of names) {
    if (!/^[0-9a-f]{16}(?:\.json|\.git)?$/.test(n)) continue;
    const p = join(stagesDir(), n);
    try { if (now - lstatSync(p).mtimeMs > STAGE_TTL_MS) rmSync(p, { recursive: true, force: true }); } catch { /* raced */ }
  }
}

function dropStage(dir) {
  rmSync(dir, { recursive: true, force: true });
  rmSync(`${dir}.json`, { force: true });
  rmSync(`${dir}.git`, { recursive: true, force: true });
}

/** A skill name a folder suggests: lower case, other characters → '-', at most 64 ('skill' when nothing is left). */
function suggestName(s) {
  const n = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 64).replace(/-+$/, '');
  return n || 'skill';
}

// §2b-8: a SKILL.md that names itself gives the name (the folder is renamed with the user's confirmation in the
// preview); else the folder's name, made valid.
function proposedName(dir, folder) {
  const fm = readSkillMd(dir)?.name;
  return fm && isValidSkillFolderName(fm) ? fm : suggestName(folder);
}

function realSkillDir(p, notFound) {
  let real = null;
  try { real = realpathSync(p); } catch { fail(404, notFound); }
  if (!statSync(real).isDirectory() || !existsSync(join(real, 'SKILL.md'))) fail(400, `no SKILL.md in ${p}`);
  return real;
}

function localSource(source) {
  if (source.kind === 'dir') {
    if (typeof source.path !== 'string' || !isAbsolute(source.path)) fail(400, 'folder: give an absolute path');
    const src = realSkillDir(source.path, `folder not found: ${source.path}`);
    return { src, folder: basename(src), origin: { kind: 'dir', path: resolve(source.path) } };
  }
  if (!isValidSkillName(source.name)) fail(400, `not a skill folder name: ${JSON.stringify(source.name)}`);
  const src = realSkillDir(join(homedir(), '.claude', 'skills', source.name), `no skill named "${source.name}" in ~/.claude/skills`);
  return { src, folder: source.name, origin: { kind: 'home', name: source.name } };
}

// The limits are checked on the source before anything is copied: a wrong folder (a home directory, a repo
// root) is refused without copying it. So is a source holding something that cannot be read (the copy would fail on
// it with a raw fs error). Each refusal names only its own problems.
const LIMIT_PROBLEM_RE = /^(?:more than \d+ files|more than \d+ links and folders|larger than 8 MB in total)$/;
function precheck(src) {
  const pre = inspectSkillDir(src);
  const limits = pre.problems.filter((p) => LIMIT_PROBLEM_RE.test(p));
  if (limits.length) {
    fail(400, `too large for a skill (at most ${SKILL_LIMITS.files} files, ${SKILL_LINKS_AND_FOLDERS_MAX} links and folders and 8 MB): ${limits.join('; ')}`, { problems: limits });
  }
  const unreadable = pre.problems.filter((p) => /: cannot be read \([A-Za-z]+\)$/.test(p));
  if (unreadable.length) fail(400, `some files cannot be read: ${unreadable.join('; ')}`, { problems: unreadable });
}

// Every folder of a stage 0700 (POSIX), so the stage can always be removed: cpSync keeps a read-only source's 0555
// folders (a Nix store, a Go module cache), and a copy can stop half-way. Never follows a link; a folder gone is skipped.
function openTree(dir) {
  if (process.platform === 'win32') return;
  let entries;
  try {
    if (!lstatSync(dir).isDirectory()) return;
    chmodSync(dir, 0o700);
    entries = readdirSync(dir, { withFileTypes: true });
  } catch { return; }
  for (const e of entries) if (e.isDirectory()) openTree(join(dir, e.name));
}

// Files, folders and links only (links verbatim: the stage's inspection judges them); `.git` never. A `.claude-plugin/`
// folder is staged empty: the limits never counted what it holds, and the inspection refuses the folder anyway. The
// copy counts what it copies as the walk counts it and stops past the limits, so a folder that gains entries after the
// checks (a build writing into it) stops at them; a file that grows after it was counted is copied whole, and the
// stage's inspection then refuses it. A copy that fails after the checks (a file over 1 MB, which the walk never
// reads, that cannot be read) is a 400. A link kept verbatim keeps its text, so one written absolute or through the
// folder's own name (`../my-skill/docs/x.md`) would point into the source, not the stage, and the stage would refuse
// it: each link whose target lies inside the source is re-pointed, relatively, at the same file in the stage.
function copyTree(src, dest) {
  let files = 0;
  let others = 0;
  let bytes = 0;
  let over = false;
  let error = null;
  const links = [];
  try {
    cpSync(src, dest, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (p) => {
        if (p === src) return true;
        if (basename(p) === '.git' || basename(dirname(p)) === '.claude-plugin') return false;
        const st = lstatSync(p);
        if (st.isFile()) { files++; bytes += st.size; } else if (st.isDirectory() || st.isSymbolicLink()) others++;
        if (files > SKILL_LIMITS.files || others > SKILL_LINKS_AND_FOLDERS_MAX || bytes > SKILL_LIMITS.totalBytes) {
          over = true;
          throw new Error('over the limits');
        }
        if (st.isSymbolicLink()) links.push(p);
        return st.isFile() || st.isDirectory() || st.isSymbolicLink();
      },
    });
    openTree(dest); // a read-only source's folders are copied 0555: a link is re-pointed inside them
    for (const p of links) {
      let real = null;
      try { real = realpathSync(p); } catch { continue; } // dangling: the stage's inspection names it
      if (!real.startsWith(src + sep)) continue; // out of the folder: the stage's inspection refuses it
      const to = join(dest, relative(src, p));
      const target = relative(dirname(to), join(dest, relative(src, real)));
      if (readlinkSync(to) !== target) { rmSync(to); symlinkSync(target, to); }
    }
  } catch (e) { error = e; }
  openTree(dest);
  if (over) fail(400, `folder: it grew past the limits while it was copied (at most ${SKILL_LIMITS.files} files, ${SKILL_LINKS_AND_FOLDERS_MAX} links and folders and 8 MB)`);
  if (error) fail(400, `folder: could not copy it (${typeof error?.code === 'string' ? error.code : 'error'})`);
}

// Git sources (§5): the URL, ref and folder are checked before git runs. The URL is stored in library.json as the
// origin, so it may carry no credential: an http(s) URL no user name, password, query or fragment (clone-project.mjs
// planClone's rule, plus the fragment), any URL — file:// included — no password, and no URL token-shaped text where
// a credential sits (its user, query or fragment). Fetches are shallow, with the plugin installs' posture.
const GIT_URL_RE = /^(?:(?:https?|ssh|git|file):\/\/|(?!-)[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)/;
const GIT_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
const CREDENTIAL_IN_URL = 'git URL: a user name, query, password or token in the URL would be stored with the skill — use a credential helper or the GitHub App';
const GIT_URL_SHAPE = 'git URL: use https://…, ssh://…, git@host:path or file://…';
const GIT_URL_ESCAPED = 'git URL: no %-escape in the user name or host — git decodes it, so the URL would reach another host or carry a password';
const GIT_URL_BRACKETS = 'git URL: a [ or ] only around an IPv6 address as the host — git reads a bracketed user name as the host';
const GIT_URL_FILE_HOST = "git URL: a file:// URL names no host (file:///path) — git reads this machine's disk whatever host it names";
const GIT_URL_ASCII = 'git URL: the user name and host must be plain ASCII — type an international host name in its xn-- form';
const IPV6_HOST_RE = /^\[[0-9A-Fa-f:.]+\](?::\d*)?$/;
const decoded = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
// A URL and a typed folder are capped before any pattern runs on them (a request body may hold 8 MB of either).
const GIT_URL_MAX = 4096;
const GIT_FOLDER_MAX = 1024;

function checkGitSource({ url, ref, subdir }) {
  if (typeof url === 'string' && url.length > GIT_URL_MAX) fail(400, `git URL: at most ${GIT_URL_MAX} characters`);
  // No whitespace, no control character and no backslash: a WHATWG URL ends an http(s) host at a `\` and git does not,
  // so `https://CORP\jdoe:pw@host/r` would hide its password from the check below and reach git and library.json; a
  // control character — C1 ones (U+0080–U+009F: NEL, the 8-bit CSI) included — reaches ssh's arguments, library.json
  // and every message that quotes the URL.
  if (typeof url !== 'string' || !GIT_URL_RE.test(url) || /[\s\\\x00-\x1f\x7f-\x9f]/.test(url)) fail(400, GIT_URL_SHAPE);
  // Token-shaped text is looked for where a credential sits only: a repository named `sk-…` holds no API key.
  let parts;
  if (/^[a-z]+:\/\//i.test(url)) {
    let u = null;
    try { u = new URL(url); } catch { fail(400, 'git URL: not a valid URL'); }
    // No URL carries a query or a fragment: git reads an ssh:// or git:// host up to the first `/`, so
    // `ssh://h?u:pw@x/r` would reach host x while the check saw h. A user name that decodes to `user:password` is one.
    if (u.password || u.search || u.hash || decoded(u.username).includes(':') || (/^https?:/i.test(url) && u.username)) fail(400, CREDENTIAL_IN_URL);
    // git percent-decodes an ssh://, git:// or file:// URL before it splits off the user and the host (connect.c),
    // while WHATWG URL leaves both encoded: `ssh://evil%2F@github.com/r` reaches evil while the check saw github.com,
    // `ssh://u%3Apw%40h/r` hands ssh `u:pw@h` and stores the password, `%0A` puts a line break in ssh's arguments.
    const authority = url.slice(url.indexOf('://') + 3).split('/')[0];
    if (authority.includes('%')) fail(400, GIT_URL_ESCAPED);
    // git takes a bracketed part of an ssh:// or git:// authority as the host (connect.c host_end), where WHATWG URL
    // reads it as the user name: `ssh://[evil]@github.com/r` reaches evil while the check saw github.com. Brackets
    // only around an IPv6 host, after the last `@`.
    const at = authority.lastIndexOf('@');
    const host = authority.slice(at + 1);
    if (/[[\]]/.test(authority.slice(0, at + 1)) || (/[[\]]/.test(host) && !IPV6_HOST_RE.test(host))) fail(400, GIT_URL_BRACKETS);
    // So that `new URL(url).hostname` is the host git contacts (a hosted allowlist compares it): git ignores a file://
    // host and reads the local disk; `https:///h/r` hides its host from the checks above; WHATWG URL maps a host outside
    // printable ASCII (`ｇｉｔｈｕｂ.com` reads github.com, `faß.de` xn--fa-hia.de) while git and curl send it as typed;
    // and a git:// URL has no user, so git hands `user@host` whole to the resolver or GIT_PROXY_COMMAND.
    if (/^file:/i.test(url) ? u.hostname !== '' : authority === '') fail(400, /^file:/i.test(url) ? GIT_URL_FILE_HOST : GIT_URL_SHAPE);
    if (/[^\x21-\x7e]/.test(authority)) fail(400, GIT_URL_ASCII);
    if (/^git:/i.test(url) && at >= 0) fail(400, CREDENTIAL_IN_URL);
    parts = [u.username];
  } else {
    // git reads `@[host]` anywhere in an scp-like URL: `x@h:p@[10.0.0.1]:r` would reach 10.0.0.1 while the check saw h.
    if (/[[\]]/.test(url) || url.indexOf('@') !== url.lastIndexOf('@')) fail(400, GIT_URL_SHAPE);
    parts = [url.slice(0, url.indexOf('@'))];
  }
  if (parts.some((p) => hasTokenShape(p) || hasTokenShape(decoded(p)))) fail(400, CREDENTIAL_IN_URL);
  if (ref != null && ref !== '' && (typeof ref !== 'string' || !GIT_REF_RE.test(ref))) fail(400, `ref: not a branch, tag or commit: ${JSON.stringify(ref)}`);
  if (subdir != null && subdir !== '' && (typeof subdir !== 'string' || !isRepoFolder(subdir))) {
    fail(400, `folder: not a path inside the repository: ${JSON.stringify(subdir)}`);
  }
}

const execFileP = promisify(execFile);
// plugin-repo.mjs defaultExec's posture: the read credential, no terminal prompt, a hard timeout.
async function git(args, encoding = 'utf8') {
  const { env } = await githubEnv('read');
  return execFileP('git', args, { encoding, maxBuffer: 16 * 1024 * 1024, timeout: 120_000, killSignal: 'SIGKILL', env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
}

/**
 * The default fetchGit: shallow-fetch `ref` (default: the remote's HEAD) into the bare repo `scratch`, list the
 * folders holding a SKILL.md, check the chosen one against the limits from the tree's own sizes, export it into
 * `dest` (git archive + tar, plugin-repo.mjs exportVersion's Windows-safe form). `subdir` null picks the root when it
 * holds a SKILL.md, else the only candidate. Only a folder a user could also type is offered or picked, since a
 * picker's next call and an update fetch the folder through checkGitSource.
 * @returns {Promise<{ sha: string, subdir: string|null, candidates: string[] }>} subdir null: nothing exported
 */
async function gitFetch({ url, ref, subdir, dest, scratch }) {
  await git(['init', '--quiet', '--bare', scratch]);
  // git init on macOS turns on core.precomposeunicode, and git then reads a decomposed (NFD) folder name given as a path
  // below as its composed (NFC) twin: the listing would count, and git archive extract, another folder than the pick.
  await git(['--git-dir', scratch, 'config', 'core.precomposeunicode', 'false']);
  // The fetched tree's .gitattributes must not change what git archive writes: export-subst, ident and eol
  // conversion grow files past the sizes counted below (42 KB of `$Format:%<(16000)%H$` exported as 32 MB),
  // export-ignore hides files, a filter runs a configured smudge program. info/attributes overrides the tree's.
  mkdirSync(join(scratch, 'info'), { recursive: true });
  writeFileSync(join(scratch, 'info', 'attributes'), '* -export-subst -export-ignore -ident -text -eol -filter -working-tree-encoding\n');
  await git(['--git-dir', scratch, 'fetch', '--quiet', '--depth', '1', '--no-tags', '--', url, ref || 'HEAD']);
  const sha = (await git(['--git-dir', scratch, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).stdout.trim();
  const { offered, pick } = pickSkillFolder((await git(['--git-dir', scratch, 'ls-tree', '-r', '-z', '--name-only', sha])).stdout.split('\0'), subdir);
  if (pick === null) return { sha, subdir: null, candidates: offered };
  // The limits before anything is extracted (git-tree.mjs skillTreeProblems), from `<mode> <type> <object> <size>\t<path>`
  // per entry of the folder. Paths are compared as bytes (latin1, one
  // character per byte): decoded as UTF-8, distinct names that are not UTF-8 would all read U+FFFD and count once.
  // Every entry must lie under the pick's own bytes, whatever folder git matched the path to, or nothing is extracted.
  const prefix = pick ? `${Buffer.from(pick).toString('latin1')}/` : '';
  const rows = (await git(['--git-dir', scratch, 'ls-tree', '-r', '-l', '-z', sha, ...(pick ? ['--', pick] : [])], 'latin1')).stdout
    .split('\0').filter(Boolean).map((row) => {
      const tab = row.indexOf('\t');
      if (!row.startsWith(prefix, tab + 1)) fail(400, `git: folder "${pick}" lists files of another folder — git read its name as another spelling`);
      const [mode, type, , size] = row.slice(0, tab).trim().split(/\s+/);
      return { mode, type, size: Number(size), path: row.slice(tab + 1 + prefix.length) };
    });
  const problems = skillTreeProblems(rows);
  if (problems.length) {
    fail(400, `too large for a skill (at most ${SKILL_LIMITS.files} files, ${SKILL_LINKS_AND_FOLDERS_MAX} links and folders and 8 MB): ${problems.join('; ')}`, { problems });
  }
  await git(['--git-dir', scratch, '-c', 'core.autocrlf=false', 'archive', '--format=tar', '-o', join(scratch, 'export.tar'), ...(pick ? [sha, '--', pick] : [sha])]);
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const strip = pick ? ['--strip-components', String(pick.split('/').length)] : [];
  await execFileP('tar', ['-xf', 'export.tar', '-C', dest.replace(/\\/g, '/'), ...strip], { cwd: scratch, timeout: 120_000, killSignal: 'SIGKILL' });
  return { sha, subdir: pick, candidates: offered };
}

/** The fetchGit seam's default: git when it is installed, else GitHub over HTTPS (git-free/skills.mjs; other hosts 409). */
const defaultFetchGit = (a) => (gitAvailable() ? gitFetch(a) : fetchGitHttps(a));

const lastLine = (e) => String(e?.stderr || e?.message || e).trim().split('\n').filter(Boolean).pop()?.slice(0, 300) ?? '';

// `exact` (updates): the origin's folder as recorded ('' = the root), never a fresh pick.
async function stageGit(source, dir, fetchGit, exact) {
  const ref = source.ref || null;
  const subdir = exact ? (source.subdir ?? '') : (source.subdir || null);
  let got;
  try {
    got = await fetchGit({ url: source.url, ref, subdir, dest: dir, scratch: `${dir}.git` });
  } catch (e) {
    if (e instanceof SkillLibraryError) throw e;
    fail(400, `git: could not fetch ${ref ?? 'the default branch'} from ${source.url}: ${lastLine(e)}`);
  } finally {
    rmSync(`${dir}.git`, { recursive: true, force: true });
  }
  if (got.subdir === null) {
    const where = `${source.url} at ${got.sha.slice(0, 7)}`;
    fail(400, subdir === '' ? `no SKILL.md at the root of ${where}`
      : subdir !== null ? `no SKILL.md in folder "${subdir}" of ${where}`
      : got.candidates.length ? `pick the skill's folder in ${where}: ${got.candidates.join(', ')}`
      : `no SKILL.md in a folder Worca can import in ${where}`,
    { candidates: got.candidates });
  }
  const folder = got.subdir ? basename(got.subdir) : source.url.replace(/(?<!\/)\/+$/, '').split(/[/:]/).pop().replace(/\.git$/i, '');
  return { folder, origin: { kind: 'git', url: source.url, ref, subdir: got.subdir, sha: got.sha } };
}

function checkPaste(source) {
  if (typeof source.content !== 'string' || !source.content.trim()) fail(400, 'paste: the SKILL.md text is required');
  if (Buffer.byteLength(source.content) > SKILL_LIMITS.fileBytes) fail(400, 'SKILL.md: larger than 1 MB');
  if (source.name != null && typeof source.name !== 'string') fail(400, 'paste: the name must be text');
}

async function stage(source, { fetchGit, update = null }) {
  const kind = source?.kind;
  if (!['dir', 'paste', 'home', 'git'].includes(kind)) fail(400, 'source.kind must be dir, paste, home or git');
  let local = null;
  if (kind === 'dir' || kind === 'home') {
    local = localSource(source);
    precheck(local.src);
  } else if (kind === 'paste') {
    checkPaste(source);
  } else {
    // A typed folder may carry a leading ./ or / and a trailing / (copied from a repository page); an update's
    // recorded folder is used exactly.
    // `(?<!\/)` keeps the trailing-slash pattern linear on a long run of slashes.
    if (typeof source.subdir === 'string' && source.subdir.length > GIT_FOLDER_MAX) fail(400, `folder: at most ${GIT_FOLDER_MAX} characters`);
    if (update === null && typeof source.subdir === 'string') source = { ...source, subdir: source.subdir.replace(/^(?:\.?\/)+/, '').replace(/(?<!\/)\/+$/, '') };
    checkGitSource(source);
  }
  sweepStages();
  mkdirSync(stagesDir(), { recursive: true, mode: 0o700 });
  // A folder holding Worca's own stages would be copied into itself (cpSync compares the paths as written). Both paths
  // are compared as the disk spells them (the native realpath): on a case-insensitive disk `/Users/x` and `/users/x`
  // are one folder, and so are the NFC and NFD spellings of a name.
  const spelled = (p) => { try { return realpathSync.native(p); } catch { return p; } };
  const stagesReal = spelled(stagesDir());
  const srcReal = local && spelled(local.src);
  if (local && (stagesReal === srcReal || stagesReal.startsWith(srcReal + sep))) fail(400, "folder: it holds Worca's own import folder");
  const id = randomBytes(8).toString('hex');
  const dir = join(stagesDir(), id);
  try {
    let folder;
    let origin;
    if (local) {
      copyTree(local.src, dir);
      ({ folder, origin } = local);
    } else if (kind === 'paste') {
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(join(dir, 'SKILL.md'), source.content, { mode: 0o600 });
      folder = source.name;
      origin = null; // §3.2: a pasted skill has no origin, so no Update
    } else {
      ({ folder, origin } = await stageGit(source, dir, fetchGit, update !== null));
    }
    writeJsonAtomic(`${dir}.json`, update ? { origin, update } : { origin }, { mode: 0o600 });
    const name = update ?? proposedName(dir, folder);
    return { stage: id, dir, name, inspection: inspectSkillDir(dir, { name }) };
  } catch (e) {
    dropStage(dir);
    throw e;
  }
}

/**
 * Stage a source for import → { stage, dir, name, inspection }. `name` is the proposed library name (the SKILL.md
 * frontmatter name when valid, else the folder's); the caller commits with commitImport(dir, name) or discards.
 * source: { kind:'dir', path } (absolute) | { kind:'paste', name, content } | { kind:'home', name } (a folder of
 * ~/.claude/skills) | { kind:'git', url, ref?, subdir? }. 400 bad source / too large, 404 not found.
 * `fetchGit({ url, ref, subdir, dest, scratch }) → { sha, subdir, candidates }` is the git seam (default: git, or GitHub over HTTPS without it).
 */
export async function stageImport(source, { fetchGit = defaultFetchGit } = {}) {
  return stage(source, { fetchGit });
}

/** Remove a stage (its files, its origin, a git scratch). Unknown stage: nothing to do. 400 on a malformed id. */
export function discardStage(stage) {
  dropStage(stageDirOf(stage));
}

/** The skills under ~/.claude/skills (folders, or links to folders, holding a SKILL.md), sorted by name. */
export function listHomeSkills() {
  const root = join(homedir(), '.claude', 'skills');
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && isValidSkillName(e.name) && existsSync(join(root, e.name, 'SKILL.md')))
    .map((e) => ({ name: e.name, description: readSkillMd(join(root, e.name))?.description ?? '' }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Re-stage library skill `name` from its origin (folder, ~/.claude/skills, git ref or the remote's HEAD) and diff it
 * against the library copy → { stage, added, removed, changed, inspection } (paths, sorted). Nothing changes until
 * applyUpdate(name, stageDirOf(stage)). 400 pasted (no origin) / bad name, 404 unknown, 409 a newer or damaged library.
 */
export async function updatePreview(name, { fetchGit = defaultFetchGit } = {}) {
  const nameProblem = skillNameProblem(name);
  if (nameProblem) fail(400, nameProblem);
  const lib = readSkillLibrary();
  if (lib.newer) fail(409, 'the skill library needs a newer Worca');
  if (lib.damaged) fail(409, 'the skill library file skills/library.json is damaged — fix it or remove it');
  if (!Object.hasOwn(lib.skills, name)) fail(404, `no skill named "${name}" in the library`);
  const o = lib.skills[name].origin;
  const source = o?.kind === 'dir' ? { kind: 'dir', path: o.path }
    : o?.kind === 'home' ? { kind: 'home', name: o.name }
    : o?.kind === 'git' ? { kind: 'git', url: o.url, ref: o.ref, subdir: o.subdir }
    : fail(400, 'this skill was pasted: it has no origin to update from');
  const s = await stage(source, { fetchGit, update: name });
  const now = skillFileDigests(s.dir);
  const was = skillFileDigests(join(skillsDir(), name));
  return {
    stage: s.stage,
    added: Object.keys(now).filter((p) => !Object.hasOwn(was, p)),
    removed: Object.keys(was).filter((p) => !Object.hasOwn(now, p)),
    changed: Object.keys(now).filter((p) => Object.hasOwn(was, p) && was[p] !== now[p]),
    inspection: s.inspection,
  };
}
