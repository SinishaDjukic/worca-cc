// test/automations-api.test.mjs — Git event automations over HTTP (#711): the flag gate, the rule and Auto-handle
// routes, the signed GitHub webhook (404 for anything unsigned), and an issue event starting a real mock run whose
// row carries the issue as its source.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';

useTempHome(after, 'automations-api-');
process.env.WORCA_MOCK = '1';
process.env.WORCA_AUTOMATIONS_POLL = '0';

const SECRET = 'hook-secret-1';
const JSONH = { 'Content-Type': 'application/json' };
let srv, base, repo, adoRepo, server, gitInfo, db, addProject;
const prevFlags = process.env.WORCA_FLAGS;

const call = (method, p, body) => fetch(`${base}${p}`, { method, headers: JSONH, ...(body ? { body: JSON.stringify(body) } : {}) });
const sign = (raw, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const hook = (event, payload, { delivery = `d-${Math.random()}`, sig } = {}) => {
  const raw = JSON.stringify(payload);
  return fetch(`${base}/api/ingress/github`, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json',
    'X-GitHub-Event': event, 'X-GitHub-Delivery': delivery, ...(sig !== null ? { 'X-Hub-Signature-256': sig ?? sign(raw) } : {}) } });
};

before(async () => {
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-aut-repo-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  ({ addProject } = await import('../src/core/projects.mjs'));
  await addProject({ name: 'aut-repo', path: repo });
  adoRepo = await mkdtemp(join(tmpdir(), 'worca-cc-aut-ado-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: adoRepo, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'https://acme@dev.azure.com/acme/Shop/_git/web'], { cwd: adoRepo, stdio: 'ignore' });
  await addProject({ name: 'aut-ado', path: adoRepo });
  // The remote is not reachable here: the run starts without its sync-before-run fetch (the project's own setting).
  const { writeSyncPrefs } = await import('../src/core/config.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  writeSyncPrefs(projectKey(repo), { beforeRun: false });
  server = await import('../ui/server.mjs');
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  db = await import('../src/core/db.mjs');
  srv = http.createServer(server.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  await stopAndSettle(server.runs, () => true).catch(() => {});
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset();
  if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  delete process.env.WORCA_GH_WEBHOOK_SECRET;
  delete process.env.WORCA_ADO_WEBHOOK_SECRET;
  await rm(repo, { recursive: true, force: true });
  await rm(adoRepo, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.WORCA_FLAGS = 'gitAutomations';
  process.env.WORCA_GH_WEBHOOK_SECRET = SECRET;
  process.env.WORCA_ADO_WEBHOOK_SECRET = 'ado-secret';
  db.getDb().exec('DELETE FROM automation_rules; DELETE FROM automation_events; DELETE FROM automation_cursors; DELETE FROM automation_deliveries');
  // No real GitHub: every gh call fails (the /user lookup included), every git call runs for real.
  gitInfo.setRunner((cmd, args, o) => (cmd === 'gh' ? Promise.resolve({ ok: false, stdout: '', stderr: 'offline', code: 1 }) : gitInfo.defaultRun(cmd, args, o)));
});

test('with the flag off every route and the webhook answer 404', async () => {
  delete process.env.WORCA_FLAGS;
  assert.equal((await call('GET', '/api/automations')).status, 404);
  assert.equal((await call('POST', '/api/automations/rules', {})).status, 404);
  assert.equal((await hook('issues', { action: 'opened' })).status, 404);
});

test('rules: create needs a registered project with a GitHub remote; list, patch, delete', async () => {
  assert.equal((await call('POST', '/api/automations/rules', { projectDir: '/nope', event: 'issue.opened', action: 'fix' })).status, 400);
  assert.equal((await call('POST', '/api/automations/rules', { projectDir: repo, event: 'issue.opened', action: 'review' })).status, 400);
  assert.equal((await call('POST', '/api/automations/rules', { projectDir: repo, event: 'issue.opened', action: 'run', workflowId: 'wf_missing' })).status, 400);
  const c = await call('POST', '/api/automations/rules', { projectDir: repo, event: 'issue.opened', action: 'run', workflowId: 'wf_default',
    filter: { labels: ['bug'] }, limits: { dailyRuns: 3 } });
  assert.equal(c.status, 201);
  const { rule } = await c.json();
  assert.equal(rule.repo, 'o/r');
  assert.equal(rule.guardrailsId, 'secure');
  assert.deepEqual(rule.filter.labels, ['bug']);
  const list = await (await call('GET', `/api/automations?projectDir=${encodeURIComponent(repo)}`)).json();
  assert.equal(list.rules.length, 1);
  assert.equal(list.repo, 'o/r');
  assert.deepEqual(list.autoHandle, { propose: false, fix: false, review: false });
  assert.equal(list.webhook.configured, true);
  const p = await call('PATCH', `/api/automations/rules/${rule.id}`, { enabled: false, limits: { maxCostUsd: 2 } });
  assert.equal(p.status, 200);
  const patched = (await p.json()).rule;
  assert.equal(patched.enabled, false);
  assert.equal(patched.limits.maxCostUsd, 2);
  assert.equal((await call('PATCH', `/api/automations/rules/${rule.id}`, { enabled: 'yes' })).status, 400);
  assert.equal((await call('DELETE', `/api/automations/rules/${rule.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/automations/rules/${rule.id}`)).status, 404);
});

test('Auto-handle: one switch per call, propose and full fix exclusive', async () => {
  const put = (key, on) => call('PUT', '/api/automations/auto-handle', { projectDir: repo, key, on });
  assert.equal((await put('merge', true)).status, 400);
  assert.deepEqual((await (await put('propose', true)).json()).autoHandle, { propose: true, fix: false, review: false });
  assert.deepEqual((await (await put('fix', true)).json()).autoHandle, { propose: false, fix: true, review: false });
});

test('webhook: missing or bad signature, no secret: 404; a repeat delivery is dropped', async () => {
  const payload = { action: 'opened', repository: { full_name: 'o/r' }, issue: { number: 1 } };
  assert.equal((await hook('issues', payload, { sig: null })).status, 404);
  assert.equal((await hook('issues', payload, { sig: sign('{}', SECRET) })).status, 404);
  assert.equal((await hook('issues', payload, { sig: sign(JSON.stringify(payload), 'wrong') })).status, 404);
  assert.equal((await hook('ping', { zen: 'x' })).status, 200);
  assert.equal((await hook('issues', payload, { delivery: 'same' })).status, 202);
  const again = await hook('issues', payload, { delivery: 'same' });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  delete process.env.WORCA_GH_WEBHOOK_SECRET;
  assert.equal((await hook('issues', payload)).status, 404);
});

test('an opened issue from a collaborator starts one run whose source is the issue; an outsider\'s starts none', async () => {
  const c = await call('POST', '/api/automations/rules', { projectDir: repo, event: 'issue.opened', action: 'run', workflowId: 'wf_default' });
  assert.equal(c.status, 201);
  const at = new Date(Date.now() + 1000).toISOString();
  const issue = (n, assoc) => ({ number: n, html_url: `https://github.com/o/r/issues/${n}`, title: `Crash ${n}`, body: 'Steps…', state: 'open',
    user: { login: 'alice' }, author_association: assoc, labels: [], created_at: at, updated_at: at });
  const { automations } = server._testing;
  const { runs } = server;
  await automations.handleWebhook('issues', { action: 'opened', repository: { full_name: 'o/r' }, issue: issue(9, 'NONE') });
  await automations.handleWebhook('issues', { action: 'opened', repository: { full_name: 'o/r' }, issue: issue(7, 'COLLABORATOR') });
  const events = (await (await call('GET', '/api/automations')).json()).events;
  const started = events.find((e) => e.number === 7);
  const skipped = events.find((e) => e.number === 9);
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.reason, 'untrusted-author');
  assert.equal(skipped.runId, null);
  assert.equal(started.status, 'starting', JSON.stringify(started));
  const entry = runs.get(started.runId);
  assert.ok(entry, 'the run is live');
  assert.equal(entry.startedBy, 'github:alice');
  // The run row carries the issue as its source once the pipeline exists.
  const t0 = Date.now();
  while (!entry.pipelineId && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 50));
  let row = null;
  while (Date.now() - t0 < 20_000) {
    row = db.getDb().prepare('SELECT source_type, source_ref, guardrails_id FROM pipelines WHERE id = ?').get(entry.pipelineId);
    if (row) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(row.source_type, 'github');
  assert.equal(JSON.parse(row.source_ref).url, 'https://github.com/o/r/issues/7');
  assert.equal(row.guardrails_id, 'secure');
  await stopAndSettle(runs, (e) => e === entry);
});

test('Azure DevOps: a rule on an Azure remote keys on dev.azure.com/org/project/repo; the service hook needs its Basic password', async () => {
  const c = await call('POST', '/api/automations/rules', { projectDir: adoRepo, event: 'issue.opened', action: 'fix' });
  assert.equal(c.status, 201);
  assert.equal((await c.json()).rule.repo, 'dev.azure.com/acme/Shop/web');
  const list = await (await call('GET', `/api/automations?projectDir=${encodeURIComponent(adoRepo)}`)).json();
  assert.deepEqual([list.repo, list.forge, list.azureWebhook.configured], ['dev.azure.com/acme/Shop/web', 'azure', true]);
  const ado = (payload, password) => fetch(`${base}/api/ingress/azure`, { method: 'POST', body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Basic ${Buffer.from(`hook:${password}`).toString('base64')}` } : {}) } });
  const payload = { id: 'n-1', eventType: 'build.complete', resource: {} };
  assert.equal((await ado(payload)).status, 404);
  assert.equal((await ado(payload, 'wrong')).status, 404);
  assert.equal((await ado(payload, 'ado-secret')).status, 202);
  const again = await ado(payload, 'ado-secret');
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  delete process.env.WORCA_ADO_WEBHOOK_SECRET;
  assert.equal((await ado({ id: 'n-2' }, 'ado-secret')).status, 404);
});
