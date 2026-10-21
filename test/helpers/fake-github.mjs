// test/helpers/fake-github.mjs — a fake api.github.com for P6's git-free transports. Each repository is a real bare repo
// under a temp root, built and answered with the test machine's git, so archives are `git archive` output (what GitHub
// serves, .gitattributes export rules included). "No git" in P6 tests is P0's test/helpers/git-off.mjs withNoGit(t).
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ID = ['-c', 'user.name=fake', '-c', 'user.email=fake@github', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
const STATUS = { A: 'added', M: 'modified', D: 'removed', R: 'renamed' };

export async function fakeGithub() {
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-fakegh-'));
  const repos = new Map();                 // lower-cased 'owner/repo' → { full, bare, protect: Set<branch> }
  const calls = [];
  const once = { rate: null, fail: null, beforeRef: null };
  const overrides = new Map();             // `${slug}@${sha}` → tar.gz Buffer
  let offline = false;
  let truncated = false;
  let bigContents = false;                 // the contents API's answer for files of 1–100 MB: encoding "none", no content

  // ---- git plumbing on a bare repo (GIT_WORK_TREE = the empty root: index commands need one, none touches it) ----
  const run = (bare, args, { env, raw = false } = {}) => {
    const out = execFileSync('git', [...ID, '--git-dir', bare, ...args], { env: { ...process.env, ...env }, maxBuffer: 512 * 2 ** 20, stdio: 'pipe' });
    return raw ? out : out.toString('utf8').trim();
  };
  const tryRun = (bare, args, opts) => { try { return run(bare, args, opts); } catch { return null; } };
  function writeTree(bare, base, entries) {          // base: a tree-ish or null; entries: [{ path, mode, content }]
    const env = { GIT_INDEX_FILE: join(root, `idx-${randomBytes(4).toString('hex')}`), GIT_WORK_TREE: root };
    run(bare, base ? ['read-tree', base] : ['read-tree', '--empty'], { env });
    for (const e of entries) {
      if (e.remove) { run(bare, ['update-index', '--force-remove', e.path], { env }); continue; }
      // From a file, not --stdin: on macOS a synchronous spawn's `input` to git sometimes never reaches its end under
      // parallel load, and git waits on stdin for good.
      const file = join(root, `blob-${randomBytes(4).toString('hex')}`);
      writeFileSync(file, e.content);
      const blob = run(bare, ['hash-object', '-w', '--no-filters', '--', file]);
      rmSync(file, { force: true });
      run(bare, ['update-index', '--add', '--cacheinfo', `${e.mode},${blob},${e.path}`], { env });
    }
    const tree = run(bare, ['write-tree'], { env });
    rmSync(env.GIT_INDEX_FILE, { force: true });
    return tree;
  }
  const commitTree = (bare, tree, parents, message, author = { name: 'fake', email: 'fake@github', date: '2026-10-01T00:00:00Z' }) =>
    run(bare, ['commit-tree', tree, ...parents.flatMap((x) => ['-p', x]), '-m', message],
      { env: { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: author.date } });
  // files: path → text | { exec } | { link } | null (null removes the path)
  const entriesOf = (files) => Object.entries(files).map(([path, v]) => (v === null ? { path, remove: true } : typeof v === 'string' ? { path, mode: '100644', content: v }
    : v.exec !== undefined ? { path, mode: '100755', content: v.exec } : { path, mode: '120000', content: v.link }));
  const repoOf = (slug) => { const r = repos.get(String(slug).toLowerCase()); if (!r) throw new Error(`fake: no repo ${slug}`); return r; };
  function commit(slug, { branch = 'main', from = null, orphan = false, files = {}, message = 'c' } = {}) {
    const r = repoOf(slug);
    const cur = tryRun(r.bare, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
    if (!orphan && !cur && !from) throw new Error(`fake: new branch ${branch} needs from or orphan`);
    const parent = orphan ? null : cur || run(r.bare, ['rev-parse', from]);
    const sha = commitTree(r.bare, writeTree(r.bare, parent, entriesOf(files)), parent ? [parent] : [], message);
    run(r.bare, ['update-ref', `refs/heads/${branch}`, sha]);
    return sha;
  }

  // ---- routes (path below /repos/:owner/:repo) ----
  const reply = (status, body, type = 'application/json') => ({ status, type, body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
  const notFound = () => reply(404, { message: 'Not Found' });
  const row = (line) => {
    const tab = line.indexOf('\t');
    const [mode, type, sha, size] = line.slice(0, tab).trim().split(/\s+/);
    return { path: line.slice(tab + 1), mode, type, sha, ...(type === 'blob' ? { size: Number(size) } : {}) };
  };
  function contents(r, path, ref) {
    const ls = tryRun(r.bare, ['ls-tree', ref, '--', path]);
    if (!ls) return notFound();
    const [mode, , sha] = ls.split('\t')[0].split(' ');
    const bytes = run(r.bare, ['cat-file', 'blob', sha], { raw: true });
    if (mode !== '120000' && bigContents) return reply(200, { type: 'file', path, encoding: 'none', content: '', sha, size: bytes.length });
    return reply(200, mode === '120000' ? { type: 'symlink', path, target: bytes.toString('utf8') } : { type: 'file', path, encoding: 'base64', content: bytes.toString('base64') });
  }
  function compare(r, a, b) {
    if (tryRun(r.bare, ['merge-base', a, b]) === null) return reply(404, { message: `No common ancestor between ${a} and ${b}.` });
    const status = a === b ? 'identical' : tryRun(r.bare, ['merge-base', '--is-ancestor', a, b]) !== null ? 'ahead' : 'diverged';
    const commits = run(r.bare, ['log', '--reverse', '--format=%H%x00%B%x1e', `${a}..${b}`]).split('\x1e').map((x) => x.trim()).filter(Boolean)
      .map((x) => { const [sha, message] = x.split('\0'); return { sha, commit: { message: message.trim() } }; });
    const nums = run(r.bare, ['diff', '-M', '--numstat', a, b]).split('\n').filter(Boolean);
    const files = run(r.bare, ['diff', '-M', '--name-status', a, b]).split('\n').filter(Boolean).map((line, i) => {
      const parts = line.split('\t');
      const filename = parts.at(-1);
      const [add, del] = nums[i].split('\t').map((n) => Number(n) || 0);
      const patch = run(r.bare, ['diff', a, b, '--', filename]).replace(/^[\s\S]*?(?=^@@)/m, '');
      return { filename, status: STATUS[parts[0][0]], additions: add, deletions: del, changes: add + del, patch,
        ...(parts[0][0] === 'R' ? { previous_filename: parts[1] } : {}) };
    });
    return reply(200, { status, commits, files });
  }
  // GET /repos/:o/:r/commits?sha=&path=&per_page=&page= — git log <sha> [-- <path>], newest first, paged like GitHub.
  function commitList(r, q) {
    const per = Math.min(Number(q.get('per_page')) || 30, 100);
    const page = Math.max(Number(q.get('page')) || 1, 1);
    const path = q.get('path');
    const log = tryRun(r.bare, ['log', '--format=%H%x00%B%x1e', q.get('sha') || 'HEAD', ...(path ? ['--', path] : [])]);
    if (log === null) return notFound();
    const all = log.split('\x1e').map((x) => x.trim()).filter(Boolean)
      .map((x) => { const [sha, message] = x.split('\0'); return { sha, commit: { message: message.trim() } }; });
    return reply(200, all.slice((page - 1) * per, page * per));
  }
  function refUpdate(r, branch, sha, { create = false, force = false } = {}) {
    if (once.beforeRef) { const fn = once.beforeRef; once.beforeRef = null; fn(); }
    const cur = tryRun(r.bare, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
    if (create && cur) return reply(422, { message: 'Reference already exists' });
    if (!create && r.protect.has(branch)) return reply(422, { message: `Protected branch update failed for refs/heads/${branch}.` });
    if (!create && cur && !force && tryRun(r.bare, ['merge-base', '--is-ancestor', cur, sha]) === null) return reply(422, { message: 'Update is not a fast forward' });
    run(r.bare, ['update-ref', `refs/heads/${branch}`, sha, ...(cur ? [cur] : [])]);
    return reply(create ? 201 : 200, { ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } });
  }
  const ROUTES = [
    ['GET', /^\/commits$/, (r, _m, q) => commitList(r, q)],
    ['GET', /^$/, (r) => reply(200, { full_name: r.full, default_branch: run(r.bare, ['symbolic-ref', '--short', 'HEAD']), private: false })],
    ['GET', /^\/commits\/(.+)$/, (r, [ref]) => {
      const sha = tryRun(r.bare, ['rev-parse', '--verify', `${decodeURIComponent(ref)}^{commit}`]);
      return sha ? reply(200, sha, 'text/plain') : reply(422, { message: `No commit found for SHA: ${decodeURIComponent(ref)}` });
    }],
    ['GET', /^\/git\/ref\/heads\/(.+)$/, (r, [ref]) => {
      const b = decodeURIComponent(ref);
      const sha = tryRun(r.bare, ['rev-parse', '--verify', '-q', `refs/heads/${b}`]);
      return sha ? reply(200, { ref: `refs/heads/${b}`, object: { sha, type: 'commit' } }) : notFound();
    }],
    ['GET', /^\/git\/commits\/([0-9a-f]{40})$/, (r, [sha]) => reply(200, { sha, tree: { sha: run(r.bare, ['rev-parse', `${sha}^{tree}`]) },
      parents: run(r.bare, ['rev-list', '--parents', '-n1', sha]).split(' ').slice(1).map((x) => ({ sha: x })) })],
    ['GET', /^\/git\/trees\/([0-9a-f]{40})$/, (r, [sha]) => reply(200, { sha, truncated,
      tree: run(r.bare, ['ls-tree', '-r', '-t', '-l', '-z', sha]).split('\0').filter(Boolean).map(row) })],
    ['GET', /^\/git\/blobs\/([0-9a-f]{40})$/, (r, [sha]) => {
      const bytes = tryRun(r.bare, ['cat-file', 'blob', sha], { raw: true });
      return bytes ? reply(200, { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }) : notFound();
    }],
    ['GET', /^\/contents\/(.+)$/, (r, [path], q) => contents(r, decodeURIComponent(path), q.get('ref'))],
    ['GET', /^\/tarball\/(.+)$/, (r, [ref]) => {
      const sha = run(r.bare, ['rev-parse', `${decodeURIComponent(ref)}^{commit}`]);
      const body = overrides.get(`${r.full.toLowerCase()}@${sha}`)
        ?? run(r.bare, ['archive', '--format=tar.gz', `--prefix=${r.full.replace('/', '-')}-${sha.slice(0, 7)}/`, sha], { raw: true });
      return { status: 200, type: 'application/x-gzip', body };
    }],
    ['GET', /^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/, (r, [a, b]) => compare(r, a, b)],
    ['POST', /^\/git\/trees$/, (r, _m, _q, body) => reply(201, { sha: writeTree(r.bare, body.base_tree ?? null, body.tree) })],
    ['POST', /^\/git\/commits$/, (r, _m, _q, body) => reply(201, { sha: commitTree(r.bare, body.tree, body.parents, body.message, body.author) })],
    ['POST', /^\/git\/refs$/, (r, _m, _q, body) => refUpdate(r, body.ref.replace(/^refs\/heads\//, ''), body.sha, { create: true })],
    ['PATCH', /^\/git\/refs\/heads\/(.+)$/, (r, [b], _q, body) => refUpdate(r, decodeURIComponent(b), body.sha, { force: body.force === true })],
  ];
  function answer(method, u, headers, body) {
    if (once.rate) {
      const reset = once.rate; once.rate = null;
      return { ...reply(403, { message: 'API rate limit exceeded' }), headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } };
    }
    const f = once.fail;
    if (f && (!f.method || f.method === method) && (!f.match || u.pathname.includes(f.match))) { once.fail = null; return reply(f.status, f.message ? { message: f.message } : {}); }
    const m = /^\/repos\/([^/]+)\/([^/]+)(.*)$/.exec(u.pathname);
    const r = m && repos.get(`${m[1]}/${m[2]}`.toLowerCase());
    if (!r) return notFound();
    for (const [verb, re, fn] of ROUTES) {
      const hit = verb === method && re.exec(m[3]);
      if (!hit) continue;
      const a = fn(r, hit.slice(1), u.searchParams, body);
      if (method !== 'GET' || a.status !== 200) return a;
      const etag = `"${createHash('sha1').update(a.body).digest('hex')}"`;
      return headers['if-none-match'] === etag ? { status: 304, type: a.type, body: null } : { ...a, headers: { etag } };
    }
    return notFound();
  }
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const call = { method, path: u.pathname, query: u.search, auth: headers.authorization ?? null, headers, status: 0 };
    calls.push(call);
    if (offline) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' }) });
    const a = answer(method, u, headers, typeof init.body === 'string' ? JSON.parse(init.body) : null);
    call.status = a.status;
    return new Response(a.body, { status: a.status, headers: { 'content-type': a.type, ...(a.headers || {}) } });
  }

  return {
    fetch: fetchImpl,
    calls,
    repo(slug, { files = {}, branch = 'main', message = 'c1' } = {}) {
      const [owner, name] = slug.split('/');
      const bare = join(root, owner, `${name}.git`);
      execFileSync('git', ['init', '-q', '--bare', `--initial-branch=${branch}`, bare]);
      repos.set(slug.toLowerCase(), { full: slug, bare, protect: new Set() });
      return { bare, sha: commit(slug, { branch, orphan: true, files, message }) };
    },
    commit,
    tag: (slug, name, sha) => run(repoOf(slug).bare, ['update-ref', `refs/tags/${name}`, sha]),
    git: (slug, ...args) => run(repoOf(slug).bare, args),
    sha: (slug, ref) => run(repoOf(slug).bare, ['rev-parse', ref]),
    show: (slug, ref, path) => tryRun(repoOf(slug).bare, ['show', `${ref}:${path}`], { raw: true })?.toString('utf8') ?? null,
    protect: (slug, b) => { repoOf(slug).protect.add(b); },
    unprotect: (slug, b) => { repoOf(slug).protect.delete(b); },
    rateLimitOnce: (resetEpochSec) => { once.rate = resetEpochSec; },
    failOnce: (status, message, { method, match } = {}) => { once.fail = { status, message, method, match }; },
    offline: (on) => { offline = on; },
    beforeRefUpdate: (fn) => { once.beforeRef = fn; },
    tarballOverride: (slug, sha, buf) => { overrides.set(`${slug.toLowerCase()}@${sha}`, buf); },
    truncateTrees: (on) => { truncated = on; },
    bigContents: (on) => { bigContents = on; },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
