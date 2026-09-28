// test/clone-project.test.mjs — src/core/clone-project.mjs: validation, the allowlist, the clone
// (fake spawn), cleanup on failure, and the shared plan -> clone -> register path. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planClone, parseCloneAllow, cloneAllowed, runClone, cloneProject, CloneError } from '../src/core/clone-project.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'worca-clone-root-'));
const plan = (req, env = {}) => planClone(req, { projectsRoot: ROOT, env });
const code = (fn) => { try { fn(); } catch (e) { return e instanceof CloneError ? e.code : `other:${e.message}`; } return 'ok'; };

test('planClone: a normal GitHub URL, with and without .git, a branch and a folder name', () => {
  assert.deepEqual(plan({ url: 'https://github.com/acme/api' }), {
    url: 'https://github.com/acme/api.git', host: 'github.com', owner: 'acme', repo: 'api', name: 'api', dir: join(ROOT, 'api'), branch: null,
  });
  const p = plan({ url: 'https://GitHub.com/acme/api.git/', branch: 'feature/x', name: 'api-2' });
  assert.equal(p.host, 'github.com');
  assert.equal(p.branch, 'feature/x');
  assert.equal(p.dir, join(ROOT, 'api-2'));
});

test('planClone refuses what it must, with a code per kind', () => {
  const cases = {
    'git@github.com:acme/api.git': 'invalid', 'http://github.com/acme/api': 'invalid', 'ssh://github.com/acme/api': 'invalid',
    'https://user:ghp_x@github.com/acme/api': 'invalid', 'https://ghp_x@github.com/acme/api': 'invalid',
    'https://github.com/acme': 'invalid', 'https://github.com/acme/api/tree/main': 'invalid', 'https://github.com/acme/api?x=1': 'invalid',
    'https://github.com:8443/acme/api': 'invalid', 'https://github.com/../etc': 'invalid', 'not a url': 'invalid', '': 'invalid',
  };
  for (const [url, want] of Object.entries(cases)) assert.equal(code(() => plan({ url })), want, url);
  assert.equal(code(() => plan({ url: 'https://github.com/acme/api', branch: '--upload-pack=x' })), 'invalid');
  assert.equal(code(() => plan({ url: 'https://github.com/acme/api', branch: 'a..b' })), 'invalid');
  for (const name of ['../x', '.hidden', 'a/b', 'x'.repeat(101), '..']) assert.equal(code(() => plan({ url: 'https://github.com/acme/api', name })), 'invalid', name);
  mkdirSync(join(ROOT, 'taken'), { recursive: true });
  assert.equal(code(() => plan({ url: 'https://github.com/acme/taken' })), 'exists', 'never overwritten');
  assert.match(String((() => { try { plan({ url: 'https://u:p@github.com/a/b' }); } catch (e) { return e.message; } })()), /set the GitHub token or App variables/);
});

test('WORCA_CLONE_ALLOW: owner wildcards and exact repos; unset allows any', () => {
  assert.deepEqual(parseCloneAllow(' github.com/Acme/* , github.com/you/app/ ,'), ['github.com/acme/*', 'github.com/you/app']);
  const allow = parseCloneAllow('github.com/acme/*,github.com/you/app');
  assert.equal(cloneAllowed(allow, { host: 'github.com', owner: 'ACME', repo: 'api' }), true);
  assert.equal(cloneAllowed(allow, { host: 'github.com', owner: 'you', repo: 'app' }), true);
  assert.equal(cloneAllowed(allow, { host: 'github.com', owner: 'you', repo: 'other' }), false);
  assert.equal(cloneAllowed(allow, { host: 'github.com', owner: 'acmecorp', repo: 'api' }), false, 'a prefix is not a match');
  assert.equal(cloneAllowed([], { host: 'gitlab.com', owner: 'x', repo: 'y' }), true);
  assert.equal(code(() => plan({ url: 'https://github.com/evil/x' }, { WORCA_CLONE_ALLOW: 'github.com/acme/*' })), 'not-allowed');
});

/** A fake git: records the call, writes the folder like a clone would, exits with `exit`. */
function fakeGit({ exit = 0, stderr = '', hang = false } = {}) {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null));
    mkdirSync(args[args.length - 1], { recursive: true });   // a partial clone left behind
    if (!hang) setImmediate(() => { if (stderr) child.stderr.emit('data', Buffer.from(stderr)); child.emit('close', exit); });
    return child;
  };
  spawnImpl.calls = calls;
  return spawnImpl;
}
const cred = (calls = []) => async (role, opts) => { calls.push({ role, ...opts }); return { env: { PATH: '/bin', GH_TOKEN: 'ghs_minted' }, error: null }; };

test('runClone: partial clone with the read credential for this repo only; the URL carries no token', async () => {
  const seen = [];
  const git = fakeGit();
  const p = plan({ url: 'https://github.com/acme/ok1', branch: 'dev' });
  await runClone(p, { spawnImpl: git, credential: cred(seen) });
  assert.deepEqual(seen, [{ role: 'read', repo: 'acme/ok1' }]);
  assert.deepEqual(git.calls[0].args, ['clone', '--filter=blob:none', '--branch', 'dev', '--', 'https://github.com/acme/ok1.git', p.dir]);
  assert.equal(git.calls[0].env.GH_TOKEN, 'ghs_minted');
  assert.equal(git.calls[0].env.GIT_TERMINAL_PROMPT, '0');
});

test('runClone: a non-GitHub host gets no GitHub credential at all', async () => {
  const seen = [];
  const git = fakeGit();
  const prev = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'ghp_should_not_leak';
  try { await runClone(plan({ url: 'https://gitlab.com/acme/ok2' }), { spawnImpl: git, credential: cred(seen) }); }
  finally { if (prev === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = prev; }
  assert.equal(seen.length, 0);
  assert.equal(git.calls[0].env.GH_TOKEN, undefined);
});

test('runClone: failures map to codes and always remove the folder', async () => {
  const cases = [
    ['fatal: Authentication failed for ...', 'auth-failed'],
    ['remote: Repository not found.\nfatal: repository ... not found', 'not-found'],
    ['warning: Could not find remote branch x to clone.\nfatal: Remote branch x not found in upstream origin', 'not-found'],
    ['fatal: unable to access https://x-access-token:ghs_secret@github.com/: Could not resolve host', 'failed'],
  ];
  for (const [stderr, want] of cases) {
    const p = plan({ url: `https://github.com/acme/f${want}${cases.indexOf(cases.find((c) => c[0] === stderr))}` });
    const err = await runClone(p, { spawnImpl: fakeGit({ exit: 128, stderr }), credential: cred() }).catch((e) => e);
    assert.equal(err.code, want, stderr);
    assert.equal(existsSync(p.dir), false, 'the partial clone is removed');
    assert.ok(!err.message.includes('ghs_secret'), 'a token in git output never reaches the message');
  }
  const p = plan({ url: 'https://github.com/acme/slow' });
  const err = await runClone(p, { spawnImpl: fakeGit({ hang: true }), credential: cred(), timeoutMs: 30 }).catch((e) => e);
  assert.equal(err.code, 'timeout');
  assert.equal(existsSync(p.dir), false);
  const mint = await runClone(plan({ url: 'https://github.com/acme/nomint' }), { spawnImpl: fakeGit(), credential: async () => ({ env: {}, error: 'the GitHub App is not installed on acme/nomint' }) }).catch((e) => e);
  assert.equal(mint.code, 'auth-failed');
  assert.match(mint.message, /not installed on acme\/nomint/);
});

test('cloneProject: a registered name is refused before cloning; a failed registration removes the folder', async () => {
  let ran = 0;
  const run = async (p) => { ran += 1; mkdirSync(p.dir, { recursive: true }); return p; };
  const listProjects = async () => [{ name: 'API', path: '/elsewhere' }];
  const clash = await cloneProject({ url: 'https://github.com/acme/api' }, { projectsRoot: ROOT, listProjects, addProject: async () => [], run }).catch((e) => e);
  assert.equal(clash.code, 'exists');
  assert.equal(ran, 0, 'nothing cloned');
  const ok = await cloneProject({ url: 'https://github.com/acme/newone' }, { projectsRoot: ROOT, listProjects: async () => [], run,
    addProject: async ({ name, path }) => [{ name, path, key: 'k' }] });
  assert.deepEqual(ok.project, { name: 'newone', path: join(ROOT, 'newone'), key: 'k' });
  const bad = await cloneProject({ url: 'https://github.com/acme/regfail' }, { projectsRoot: ROOT, listProjects: async () => [], run,
    addProject: async () => { throw new Error('this project path is already registered'); } }).catch((e) => e);
  assert.equal(bad.code, 'failed');
  assert.equal(existsSync(join(ROOT, 'regfail')), false);
});
