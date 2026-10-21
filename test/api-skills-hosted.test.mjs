// test/api-skills-hosted.test.mjs — a hosted Worca (remote access on) imports skills only from a git URL or a pasted
// SKILL.md: the server's folders and its user's ~/.claude/skills are not the viewer's. A separate file because REMOTE_MODE
// is fixed when ui/server.mjs is imported; remote access is on as in api-actions-remote.test.mjs (a local JWKS).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';

const PUBLIC = 'worca-01.example.com';
const accessKey = makeAccessKey();
const fakeCerts = certsFetch({ keys: [accessKey] });
const realFetch = globalThis.fetch;
const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN', 'WORCA_CF_ACCESS_AUD'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homeDir, srv, port;

/** A request through the public Host with a valid Access token (a signed-in person). */
function remote(method, path, body) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(accessKey),
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (resp) => {
      let text = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { text += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: text ? JSON.parse(text) : null }));
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-skills-hosted-'));
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE']) process.env[k] = homeDir;
  process.env.WORCA_ALLOWED_HOSTS = PUBLIC;
  process.env.WORCA_CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.WORCA_CF_ACCESS_AUD = AUD;
  _resetForTests();
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));
  await mkdir(join(homeDir, '.claude', 'skills', 'graphify'), { recursive: true });
  await writeFile(join(homeDir, '.claude', 'skills', 'graphify', 'SKILL.md'), '---\nname: graphify\ndescription: Graphs\n---\nGo.\n');
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  _resetForTests();
  await rm(homeDir, { recursive: true, force: true });
});

test('hosted: folder and Claude Code imports are refused and ~/.claude/skills is not listed; a pasted SKILL.md still stages', async () => {
  for (const source of [{ kind: 'dir', path: join(homeDir, '.claude', 'skills', 'graphify') }, { kind: 'home', name: 'graphify' }]) {
    const r = await remote('POST', '/api/skills/import/preview', { source });
    assert.equal(r.status, 400, source.kind);
    assert.equal(r.body.error, 'folder imports need a local Worca: use a git URL or paste the SKILL.md');
  }
  assert.deepEqual((await remote('GET', '/api/skills/home')).body, { skills: [], folderImports: false });
  assert.equal((await remote('GET', '/api/skills')).body.folderImports, false, 'the Import modal hides Folder and Claude Code');
  const p = await remote('POST', '/api/skills/import/preview', { source: { kind: 'paste', content: '---\nname: notes\ndescription: Notes\n---\nWrite.\n' } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.name, 'notes', 'a pasted SKILL.md names itself; the Name field is optional');
});

test("hosted: a git source is https:// only and inside WORCA_CLONE_ALLOW — file:// would read the server's own repositories; an update re-reads no folder", async () => {
  for (const url of ['file:///etc', 'file://localhost/srv/repo', 'FILE:///x', 'ssh://git@github.com/a/b', 'git://example.com/a/b',
    'http://example.com/a/b', 'git@github.com:a/b']) {
    const r = await remote('POST', '/api/skills/import/preview', { source: { kind: 'git', url } });
    assert.equal(r.status, 400, url);
    assert.equal(r.body.error, 'a hosted Worca imports skills from an https:// git URL only', url);
  }
  // As typed, as git fetches it: one repository, no port, credentials, query or encoded characters (planClone's rules).
  for (const url of ['https://github.com:8443/acme/r', 'https://127.0.0.1:7777/a/b', 'https://bob@github.com/acme/r',
    'https://github.com/evil/%2e%2e/acme/r', 'https://github.com/acme/x%2F..%2F..%2Fevil%2Fr', 'https://github.com/acme/r?x=1',
    'https://github.com/acme', 'https://github.com/a/b/c', 'https:///github.com/a/b', 'https://github.com\\@evil.example/a/b',
    'https://gíthub.com/a/b']) {
    const r = await remote('POST', '/api/skills/import/preview', { source: { kind: 'git', url } });
    assert.equal(r.status, 400, url);
    assert.equal(r.body.error, 'a hosted Worca imports skills from a URL naming one repository, like https://github.com/owner/repo (no port, credentials, query or encoded characters)', url);
  }
  // The deployment's clone allowlist covers skill imports too (no fetch happens: refused before git runs).
  const prevAllow = process.env.WORCA_CLONE_ALLOW;
  process.env.WORCA_CLONE_ALLOW = 'github.com/acme/*';
  try {
    const r = await remote('POST', '/api/skills/import/preview', { source: { kind: 'git', url: 'https://git.internal.example/ops/skills.git' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'git.internal.example/ops/skills is not in WORCA_CLONE_ALLOW');
    const typed = await remote('POST', '/api/skills/import/preview', { source: { kind: 'git', url: 'https://GIT.internal.example/ops/skills.git/' } });
    assert.equal(typed.body.error, 'git.internal.example/ops/skills is not in WORCA_CLONE_ALLOW', 'a well-formed repository URL reaches the allowlist');
    const dots = await remote('POST', '/api/skills/import/preview', { source: { kind: 'git', url: 'https://github.com/evil/%2e%2e/acme/skills' } });
    assert.equal(dots.status, 400);
    assert.match(dots.body.error, /naming one repository/, 'git fetches /evil/%2e%2e/acme/skills as typed: it is never matched against acme/*');
  } finally {
    if (prevAllow === undefined) delete process.env.WORCA_CLONE_ALLOW; else process.env.WORCA_CLONE_ALLOW = prevAllow;
  }
  // A library skill from a folder (imported while this Worca was local) is not re-read from the server's disk once hosted.
  const { stageImport } = await import('../src/core/skills-registry/import.mjs');
  const { commitImport, stageDirOf, skillsDir } = await import('../src/core/skills-registry/library.mjs');
  const staged = await stageImport({ kind: 'dir', path: join(homeDir, '.claude', 'skills', 'graphify') });
  await commitImport(stageDirOf(staged.stage), 'graphify');
  const r = await remote('POST', `/api/skills/${encodeURIComponent('skill:library:graphify')}/update/preview`);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "this skill's origin cannot be fetched here: a hosted Worca imports skills from an https:// git URL only");
  // …nor a git origin that is not an https:// one (written while this Worca was local): git never runs for it.
  const libFile = join(skillsDir(), 'library.json');
  const lib = JSON.parse(await readFile(libFile, 'utf8'));
  lib.skills.graphify.origin = { kind: 'git', url: 'file:///etc/skills', ref: null, subdir: null, sha: 'a'.repeat(40) };
  await writeFile(libFile, JSON.stringify(lib));
  const g = await remote('POST', `/api/skills/${encodeURIComponent('skill:library:graphify')}/update/preview`);
  assert.equal(g.status, 409, JSON.stringify(g.body));
  assert.equal(g.body.error, r.body.error);
  // …and an https:// git origin is checked like an import: the deployment's allowlist answers, never git.
  lib.skills.graphify.origin = { kind: 'git', url: 'https://git.internal.example/ops/skills', ref: null, subdir: null, sha: 'a'.repeat(40) };
  await writeFile(libFile, JSON.stringify(lib));
  const prevAllow2 = process.env.WORCA_CLONE_ALLOW;
  process.env.WORCA_CLONE_ALLOW = 'github.com/acme/*';
  try {
    const h = await remote('POST', `/api/skills/${encodeURIComponent('skill:library:graphify')}/update/preview`);
    assert.equal(h.status, 409, JSON.stringify(h.body));
    assert.equal(h.body.error, "this skill's origin cannot be fetched here: git.internal.example/ops/skills is not in WORCA_CLONE_ALLOW");
  } finally {
    if (prevAllow2 === undefined) delete process.env.WORCA_CLONE_ALLOW; else process.env.WORCA_CLONE_ALLOW = prevAllow2;
  }
});
