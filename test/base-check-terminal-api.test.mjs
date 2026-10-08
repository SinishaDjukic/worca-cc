// Base conflicts (#620, D4): POST /api/runs/:id/resolve-terminal checks the run out, starts
// `git merge --no-ff --no-commit <base>` there (conflicts left in place), opens the run terminal in that
// checkout and marks the member. Same gates as every run terminal (raw fields, same origin). Pipes mode
// (WORCA_TERMINAL_PTY=0) so it runs anywhere bash does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { writeStoreMeta, findPipelineRowById } from '../src/core/artifacts.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { g, GITCONFIG, world as makeWorld, teammatePush, commitOnFeat } from './helpers/base-world.mjs';

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_TERMINAL_PTY', 'SHELL', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'WORCA_RUN_ROOT'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let root, srv, port, base, id, key;

/** fetch() drops a caller-set Host and Origin; this sends them as given. */
function req(method, p, body, headers = { host: `127.0.0.1:${port}` }) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { ...headers,
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'base-check-term-'));
  await writeFile(join(root, 'gitconfig'), GITCONFIG);
  Object.assign(process.env, { WORCA_HOME: join(root, 'home'), HOME: root, USERPROFILE: root, WORCA_TERMINAL_PTY: '0',
    SHELL: '/bin/bash', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', WORCA_RUN_ROOT: 'legacy' });
  _resetForTests();
  const w = makeWorld(root); commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'f.txt', 'upstream\n');
  ({ id, key } = await seedPipeline(w.a, { title: 'My feature', status: 'done',
    branch: { source: 'dev', feature: 'feat', branchKept: true } }));
  writeStoreMeta(key, 'project', { key, name: 'a', path: w.a });
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  const { sessions } = await (await fetch(`${base}/api/terminal`)).json();
  for (const s of sessions.filter((x) => x.status === 'running')) await (await fetch(`${base}/api/terminal/sessions/${s.id}`, { method: 'DELETE' })).json();
  await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
  _resetForTests();
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

test('resolve-terminal refuses raw fields like the terminal route (400 RAW_FIELD)', async () => {
  const r = await req('POST', `/api/runs/${id}/resolve-terminal?projectKey=${key}`, { command: 'rm -rf /' });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'RAW_FIELD');
});

test('resolve-terminal cross-origin is 403 like every terminal route', async () => {
  const r = await req('POST', `/api/runs/${id}/resolve-terminal?projectKey=${key}`, {},
    { host: `127.0.0.1:${port}`, origin: 'http://127.0.0.1:4401' });
  assert.equal(r.status, 403); assert.equal(r.json.code, 'TERMINAL_CROSS_ORIGIN');
  assert.equal(JSON.parse(findPipelineRowById(id).branch).baseResolve, undefined);
});

test('POST resolve-terminal checks out, starts the merge, opens a run shell and types git status', async () => {
  const replies = await Promise.all([
    req('POST', `/api/runs/${id}/resolve-terminal?projectKey=${key}`, { cols: 80, rows: 24 }),
    req('POST', `/api/runs/${id}/resolve-terminal?projectKey=${key}`, {}),
  ]);
  for (const r of replies) assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(replies.map((r) => r.json.started).sort(), [false, true]);
  for (const r of replies) assert.deepEqual(r.json.conflicts, ['f.txt']);
  const { session, worktreeDir } = replies[0].json;
  assert.equal(replies[1].json.worktreeDir, worktreeDir);
  assert.ok(existsSync(join(worktreeDir, '.git')), 'the checkout exists');
  assert.ok(g(worktreeDir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'), 'merge in progress');
  assert.equal(session.cwd, worktreeDir);
  assert.equal(session.runId, id);
  const br = JSON.parse(findPipelineRowById(id).branch);
  assert.equal(br.baseResolve.via, 'terminal');
  assert.deepEqual(br.baseResolve.files, ['f.txt']);
});
