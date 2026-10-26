// test/requirements-export-api.test.mjs — the export routes (plans/requirements-a6-design.md §6) on a bare express app with the
// requirements routes, in mock mode with jira-source linked; frames, statuses, the feature's `export`, no config value out, and
// an export turn never hiding the error line or changing what Try again runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile, writePluginConfig } from '../src/core/plugin-config.mjs';
import { setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { createFeature, updateFeature, appendTurn, setPendingExport } from '../src/core/requirements/store.mjs';
import { settled } from '../src/core/requirements/interview.mjs';
import { registerRequirementsRoutes, REQUIREMENTS_ROUTES } from '../src/core/requirements/routes.mjs';
import { _resetExportCaches } from '../src/core/requirements/export.mjs';

useTempHome(after, 'worca-req-export-api-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'requirements';
process.env.WORCA_MOCK = '1';
const SECRET = 'tok-SECRET-1234';
const frames = [];
let srv; let base; let projKey; let projDir;

before(async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = mkdtempSync(join(tmpdir(), 'req-export-api-shop-'));
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  writePluginConfig('jira-source', [{ key: 'baseUrl', type: 'text' }, { key: 'email', type: 'text' }, { key: 'token', type: 'text', secret: true }],
    { baseUrl: 'https://acme.atlassian.net', email: 'ann@acme.test', token: SECRET }, 'acme');
  _resetExportCaches();
  const app = express();
  app.use(express.json());
  registerRequirementsRoutes(app, { broadcast: (f) => frames.push(f), deps: { startRun: async () => ({ status: 200, body: {} }) } });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setMockSourceResponses(null);
  rmSync(projDir, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const P = '/api/requirements';
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const setupPath = () => `${P}/export-setup/project/${projKey}`;
const readySpec = () => ({ ...emptySpec(), goal: { text: 'Customers cancel', measure: 'fewer calls' }, criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }],
  assumptions: [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }] });
function readyFeature() {
  const f = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel order', description: 'Before it ships' });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  return updateFeature(f.seq, { status: 'done', criteriaSeq: 1, assumptionSeq: 1, spec: readySpec() });
}
const saveSetup = () => call('PUT', setupPath(), { ...CONN, project: 'SHOP', projectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story', labels: ['worca'] });

test('the route table: the export routes, the setup ones before GET /api/requirements', () => {
  const keys = REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`);
  for (const k of [`GET ${P}/export-setup/:scopeType/:scopeKey`, `PUT ${P}/export-setup/:scopeType/:scopeKey`, `POST ${P}/export-setup/:scopeType/:scopeKey/options`,
    `POST ${P}/:seq/export/preview`, `POST ${P}/:seq/export`, `DELETE ${P}/:seq/export/link`]) assert.ok(keys.includes(k), k);
  assert.ok(keys.indexOf(`GET ${P}/export-setup/:scopeType/:scopeKey`) < keys.indexOf(`GET ${P}`));
});

test('GET export-setup: the trackers, no setup yet, the default connection; never a config value', async () => {
  const r = await call('GET', setupPath());
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.setup, r.json.trackers.map((t) => [t.plugin, t.name, t.profiles]), r.json.defaultProfile],
    [null, [['jira-source', 'Jira', [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }]]], CONN]);
  assert.doesNotMatch(JSON.stringify(r.json), new RegExp(`${SECRET}|acme\\.atlassian\\.net"|ann@acme`), 'no token, URL or email');
  assert.equal((await call('GET', `${P}/export-setup/project/nope`)).status, 400, 'an unknown project');
});

test("POST options: the tracker's answer; an unknown connection is 400; a reach failure is 502 with the sentence and its kind", async () => {
  const r = await call('POST', `${setupPath()}/options`, { ...CONN, project: 'SHOP', issueType: '10001' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.projects.length, r.json.issueTypes.length, r.json.priorities.length, r.json.criteriaFields.length, r.json.doneStatus], [2, 3, 4, 2, 'Done']);
  assert.equal((await call('POST', `${setupPath()}/options`, { ...CONN, profile: 'nope' })).status, 400);
  setMockSourceResponses({ exportOptions: () => { throw new PluginOpError('auth', 'Jira token invalid'); } });
  try {
    const bad = await call('POST', `${setupPath()}/options`, CONN);
    assert.deepEqual([bad.status, bad.json], [502, { kind: 'auth', error: 'Worca could not reach Jira: the API token was refused.' }]);
  } finally { setMockSourceResponses(null); }
});

test('PUT setup, preview, export: 200 with the feature (chip data), a frame, the export turn; Forget the link', async () => {
  assert.equal((await saveSetup()).status, 200);
  const f = readyFeature();
  frames.length = 0;
  assert.equal((await saveSetup()).status, 200);
  assert.ok(frames.some((x) => x.type === 'requirements-changed' && x.seq === f.seq), "a saved setup tells the scope's open features");
  let v = (await call('GET', `${P}/${f.seq}`)).json.feature.export;
  assert.deepEqual([v.tracker, v.canExport, v.hasSetup, v.link], [{ name: 'Jira' }, true, true, null]);
  const p = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'create' });
  assert.equal(p.status, 200);
  assert.match(p.json.previewHash, /^[0-9a-f]{64}$/);
  frames.length = 0;
  const x = await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: p.json.previewHash });
  assert.equal(x.status, 200, JSON.stringify(x.json));
  assert.deepEqual([x.json.action, x.json.key, x.json.url], ['created', 'SHOP-123', 'https://mock.test/browse/SHOP-123']);
  assert.deepEqual([x.json.feature.export.link.key, x.json.turns.at(-1).kind], ['SHOP-123', 'export']);
  assert.deepEqual(frames, [{ type: 'requirements-changed', seq: f.seq }]);
  assert.doesNotMatch(JSON.stringify(x.json), new RegExp(SECRET));
  frames.length = 0;
  const g = await call('DELETE', `${P}/${f.seq}/export/link`);
  assert.equal(g.status, 200);
  assert.deepEqual([g.json.feature.export.link, g.json.feature.export.history.map((h) => h.action)], [null, ['forgot', 'created']]);
  assert.deepEqual(frames, [{ type: 'requirements-changed', seq: f.seq }]);
  assert.equal((await call('DELETE', `${P}/${f.seq}/export/link`)).status, 409);
});

test('statuses: NOT_READY with the failing keys, stale, refused, gone; nothing written on any', async () => {
  await saveSetup();
  const half = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Half', description: 'd' });
  const nr = await call('POST', `${P}/${half.seq}/export/preview`, { mode: 'create' });
  assert.deepEqual([nr.status, nr.json.failing.includes('interview')], [409, true]);
  const f = readyFeature();
  const p = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'create' });
  const stale = await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: 'nope' });
  assert.deepEqual([stale.status, stale.json.stale, stale.json.error], [409, true, 'The spec changed since the preview. Look at the preview again.']);
  setMockSourceResponses({ createTicket: { refused: { field: 'Team', message: 'Jira needs a value for “Team” in SHOP.' } } });
  const ref = await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: p.json.previewHash });
  assert.deepEqual([ref.status, ref.json.refused, ref.json.field, ref.json.error], [409, true, 'Team', 'Jira needs a value for “Team” in SHOP.']);
  setMockSourceResponses(null);
  await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: p.json.previewHash });
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['New rule'] } });
  setMockSourceResponses({ ticketState: { exists: false }, updateTicket: { gone: true } });
  try {
    const u = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'update' });
    assert.deepEqual([u.status, u.json.gone], [200, true]);
    const gone = await call('POST', `${P}/${f.seq}/export`, { mode: 'update', previewHash: u.json.previewHash, force: true });
    assert.deepEqual([gone.status, gone.json.gone, gone.json.error], [409, true, 'SHOP-123 no longer exists in Jira.']);
  } finally { setMockSourceResponses(null); }
});

test('an export turn never hides the error line, and Try again still re-runs the job the error names (§3)', async () => {
  const f = readyFeature();
  appendTurn(f.seq, { kind: 'error', payload: { code: 'TIMEOUT', message: 'The round took too long. Try again.', job: 'round' } });
  appendTurn(f.seq, { kind: 'export', payload: { action: 'created', tracker: 'Jira', key: 'SHOP-9', url: 'u', at: new Date().toISOString() } });
  const v = (await call('GET', `${P}/${f.seq}`)).json;
  assert.equal(v.feature.lastError, 'The round took too long. Try again.');
  const r = await call('POST', `${P}/${f.seq}/retry`, {});
  assert.equal(r.status, 202, JSON.stringify(r.json));
  await settled(f.seq);
});

test('every error data field reaches the client unchanged: linked on a stale find, then the comment starting point', async () => {
  await saveSetup();
  const f = readyFeature();
  setPendingExport(f.seq, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', trackerProject: 'OPS', marker: 'rexp_00000000000b' });
  const p = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'create' });
  setMockSourceResponses({ findTicket: (a) => ({ key: 'OPS-9', url: 'https://mock.test/browse/OPS-9', fingerprint: 'f9',
    lastLine: `From Worca ${f.id} · exported 26 Oct 2026`, marker: a.marker, labels: ['worca', a.label] }) });
  try {
    const r = await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: p.json.previewHash });
    assert.deepEqual([r.status, r.json.stale, r.json.linked, r.json.error], [409, true, 'OPS-9', 'The spec changed since the preview. Look at the preview again.']);
  } finally { setMockSourceResponses(null); }
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A rule'] } });
  const c = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'comment' });
  assert.deepEqual([c.status, c.json.error], [409, 'Update OPS-9 once to give Worca a starting point for comments.']);
});

test('an Update raced by an edit in Jira is 409 with edited and its sentence; nothing written; an op Jira no longer has is 502 with its kind', async () => {
  await saveSetup();
  const f = readyFeature();
  const p = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'create' });
  const x = await call('POST', `${P}/${f.seq}/export`, { mode: 'create', previewHash: p.json.previewHash });
  assert.equal(x.status, 200, JSON.stringify(x.json));
  const key = x.json.key;
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['New rule'] } });
  const u = await call('POST', `${P}/${f.seq}/export/preview`, { mode: 'update' });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  const before = (await call('GET', `${P}/${f.seq}`)).json;
  // the ticket changes in Jira between the preview and the Update: its fingerprint is no longer the stored one
  setMockSourceResponses({ ticketState: (a) => ({ exists: true, url: `https://mock.test/browse/${a.key}`, fingerprint: 'edited-in-jira' }) });
  try {
    const e = await call('POST', `${P}/${f.seq}/export`, { mode: 'update', previewHash: u.json.previewHash });
    assert.deepEqual([e.status, e.json.edited, e.json.error],
      [409, true, `${key} was edited in Jira since your last export. Updating replaces its description.`]);
  } finally { setMockSourceResponses(null); }
  const after = (await call('GET', `${P}/${f.seq}`)).json;
  assert.deepEqual([after.turns.length, after.feature.export.link], [before.turns.length, before.feature.export.link], 'nothing written');
  setMockSourceResponses({ exportOptions: () => { throw new PluginOpError('unimplemented', 'connector does not implement op "exportOptions"'); } });
  try {
    const bad = await call('POST', `${setupPath()}/options`, CONN);
    assert.deepEqual([bad.status, bad.json], [502, { kind: 'unimplemented', error: 'Jira cannot export any more.' }]);
  } finally { setMockSourceResponses(null); }
});
