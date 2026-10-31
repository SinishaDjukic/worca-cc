// test/requirements-export.test.mjs — the export job (plans/requirements-a6-design.md D4–D14) in mock mode: the real callSource
// with the shim's canned answers (setMockSourceResponses for gone, edited, refused, reach failures), jira-source linked with
// two connections. No tracker, no model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile } from '../src/core/plugin-config.mjs';
import { callSource, setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import {
  createFeature, getFeature, updateFeature, appendTurn, listTurns, getExportLink, getExportSetup, upsertExportSetup, setPendingExport,
} from '../src/core/requirements/store.mjs';
import { startOrientation, settled, isBusy } from '../src/core/requirements/interview.mjs';
import { markStarting, unmarkStarting } from '../src/core/requirements/starting.mjs';
import {
  saveSetup, exportOptions, exportSetupView, previewExport, runExport, forgetLink, exportView, isExporting, _resetExportCaches,
} from '../src/core/requirements/export.mjs';

useTempHome(after, 'worca-req-export-');
const prevMock = process.env.WORCA_MOCK;
process.env.WORCA_MOCK = '1';
after(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; setMockSourceResponses(null); });

const TARGET = { ok: true, label: 'Project shop is registered' };
const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const seen = [];
const d = { callSource: (o) => { seen.push(o); return callSource(o); } };
const reset = () => { seen.length = 0; setMockSourceResponses(null); };
const fp = (text) => createHash('sha256').update(text).digest('hex');   // the mock shim's fingerprint
const waitFor = async (pred) => { for (let i = 0; i < 200 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5)); };

before(async () => {
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  createProfile('jira-source', 'beta', 'jira.beta.test (Data Center)');
  _resetExportCaches();
  await saveSetup(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', project: 'SHOP', projectName: 'SHOP — Shop web',
    issueType: '10001', issueTypeName: 'Story', labels: ['worca'] }, { by: 'po' }, d);
});

const readySpec = () => ({ ...emptySpec(), goal: { text: 'Customers cancel', measure: 'fewer calls' },
  criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }, { id: 'R-po-2', text: 'Refund in 3 days' }],
  assumptions: [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }] });
/** A feature that passes all six checks with TARGET. */
function readyFeature(title = 'Cancel order') {
  const f = createFeature({ ...SCOPE, title, description: 'Before it ships' });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  return updateFeature(f.seq, { status: 'done', criteriaSeq: 2, assumptionSeq: 1, spec: readySpec() });
}
async function exportNow(seq, body = { mode: 'create' }) {
  const p = await previewExport(seq, body, { target: TARGET }, d);
  return runExport(seq, { ...body, previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
}
const exportTurns = (seq) => listTurns(seq).filter((t) => t.kind === 'export');

test("create: the setup's connection, a marker, exactly the previewed ticket; the link and the turn are stored", async () => {
  reset();
  const f = readyFeature();
  const p = await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d);
  assert.deepEqual([p.mode, p.key, p.tracker, p.comment, p.edited, p.gone, p.link], ['create', null, 'Jira', null, false, false, null]);
  assert.deepEqual(p.ticket.labels, ['worca', `worca-${f.id}`]);
  assert.match(p.ticket.description, new RegExp(`\\nFrom Worca ${f.id} · exported \\d{1,2} [A-Z][a-z]{2} \\d{4}\\n$`));
  assert.deepEqual([p.fields.project, p.fields.issueType, p.fields.connection, p.fields.conn, p.fields.fixedLabel, p.fields.criteria, p.fields.summary],
    [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: '10001', label: 'Story' }, 'acme.atlassian.net (Cloud)',
      { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' }, `worca-${f.id}`, { target: 'description' }, 'Cancel order']);
  assert.equal(seen.filter((c) => c.op !== 'capabilities').length, 0, 'a create preview calls no tracker');
  const r = await runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
  assert.deepEqual(r, { action: 'created', key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123' });
  const call = seen.find((c) => c.op === 'createTicket');
  assert.deepEqual([call.plugin, call.sourceId, call.profile, call.timeoutMs], ['jira-source', 'jira', 'acme', 60_000]);
  const { marker, ...sent } = call.args.ticket;
  assert.match(marker, /^rexp_[0-9a-f]{12}$/);
  assert.deepEqual(sent, p.ticket, 'only what the preview showed');
  const l = getExportLink(f.seq);
  assert.deepEqual([l.key, l.url, l.profile, l.trackerProject, l.pendingMarker, l.fingerprint, l.spec.goal.text, l.fields.issueTypeName, l.fields.labels],
    ['SHOP-123', 'https://mock.test/browse/SHOP-123', 'acme', 'SHOP', null, fp(p.ticket.description), 'Customers cancel', 'Story', ['worca']]);
  const t = exportTurns(f.seq).at(-1);
  assert.deepEqual([t.payload.action, t.payload.tracker, t.payload.key, t.payload.url, t.by, 'reason' in t.payload],
    ['created', 'Jira', 'SHOP-123', 'https://mock.test/browse/SHOP-123', 'po', false]);
  assert.equal(isExporting(f.seq), false);
});

test('only what the preview shows (D6): an edit after the preview is refused and nothing is sent; overrides go into the ticket, not the setup', async () => {
  reset();
  const f = readyFeature();
  const body = { mode: 'create', issueType: '10002', issueTypeName: 'Task', labels: ['needs review', 'worca'], priority: '3', priorityName: 'Medium' };
  const p = await previewExport(f.seq, body, { target: TARGET }, d);
  assert.deepEqual([p.ticket.issueType, p.ticket.labels, p.ticket.priority, p.fields.priority],
    ['10002', ['needs-review', 'worca', `worca-${f.id}`], '3', { value: '3', label: 'Medium' }]);
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A new rule'] } });
  await assert.rejects(runExport(f.seq, { ...body, previewHash: p.previewHash }, { by: 'po', target: TARGET }, d),
    (e) => e.code === 'CONFLICT' && e.data.stale === true && e.message === 'The spec changed since the preview. Look at the preview again.');
  await assert.rejects(runExport(f.seq, body, { target: TARGET }, d), (e) => e.data && e.data.stale === true, 'no hash: refused');
  assert.equal(seen.filter((c) => c.op === 'createTicket').length, 0);
  assert.equal(getExportLink(f.seq), null);
  assert.equal((await exportNow(f.seq, body)).action, 'created');
  assert.deepEqual(getExportLink(f.seq).fields, { projectName: 'SHOP — Shop web', issueType: '10002', issueTypeName: 'Task',
    labels: ['needs-review', 'worca'], priority: '3', priorityName: 'Medium', criteria: { target: 'description' } });
  assert.deepEqual(getExportSetup('project', 'shop-1').labels, ['worca'], 'the setup keeps its values');
});

test('not Ready (D5): NOT_READY with the failing keys; a reason leads the description and is recorded; over 500 is refused', async () => {
  reset();
  const f = createFeature({ ...SCOPE, title: 'Half', description: 'd' });
  updateFeature(f.seq, { status: 'done', spec: { ...readySpec(), openQuestions: ['Who pays?'] } });
  await assert.rejects(previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d),
    (e) => e.code === 'NOT_READY' && e.data.failing.includes('interview') && e.data.failing.includes('openQuestions'));
  await assert.rejects(previewExport(f.seq, { mode: 'create', reason: 'x'.repeat(501) }, { target: TARGET }, d), (e) => e.code === 'BAD_REQUEST');
  const why = 'The team estimates in Jira tomorrow.';
  const noFolder = { ok: false, hint: 'the folder of project shop is missing' };
  const p = await previewExport(f.seq, { mode: 'create', reason: why }, { target: noFolder }, d);
  assert.ok(p.ticket.description.startsWith(`Exported before Ready: ${why}\n\n## Goal`), 'every check can be overridden, the target too');
  await runExport(f.seq, { mode: 'create', reason: why, previewHash: p.previewHash }, { by: 'po', target: noFolder }, d);
  assert.equal(exportTurns(f.seq).at(-1).payload.reason, why);
  const ready = readyFeature();
  const q = await previewExport(ready.seq, { mode: 'create', reason: 'ignored' }, { target: TARGET }, d);
  assert.doesNotMatch(q.ticket.description, /Exported before Ready/, 'a Ready feature ignores a reason');
});

test("update (D7, D9): the link's own connection, no marker; edited is refused until forced; gone writes nothing", async () => {
  reset();
  const f = readyFeature();
  await exportNow(f.seq);
  upsertExportSetup({ ...SCOPE, ...getExportSetup('project', 'shop-1'), profile: 'beta' });   // the setup moves on; the ticket stays pinned
  try {
    updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Refunds go back the way they came.'] } });
    seen.length = 0;
    const p = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
    assert.deepEqual([p.key, p.edited, p.gone, p.link.key, p.changes], ['SHOP-123', false, false, 'SHOP-123', [{ line: 'Business rules: 1 line added', id: null }]]);
    assert.deepEqual(seen.map((c) => [c.op, c.profile]), [['ticketState', 'acme']]);
    const r = await runExport(f.seq, { mode: 'update', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
    assert.deepEqual(r, { action: 'updated', key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123' });
    const upd = seen.find((c) => c.op === 'updateTicket');
    assert.deepEqual([upd.profile, upd.args.key, 'marker' in upd.args.ticket], ['acme', 'SHOP-123', false]);
    assert.equal(getExportLink(f.seq).fingerprint, fp(p.ticket.description));
    assert.equal(exportTurns(f.seq).at(-1).payload.action, 'updated');
  } finally { upsertExportSetup({ ...SCOPE, ...getExportSetup('project', 'shop-1'), profile: 'acme' }); }
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Rule two'] } });
  setMockSourceResponses({ ticketState: { exists: true, url: 'https://mock.test/browse/SHOP-123', fingerprint: 'edited-in-jira' } });
  const q = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.equal(q.edited, true);
  const n = listTurns(f.seq).length;
  await assert.rejects(runExport(f.seq, { mode: 'update', previewHash: q.previewHash }, { by: 'po', target: TARGET }, d),
    (e) => e.code === 'CONFLICT' && e.data.edited === true && e.message === 'SHOP-123 was edited in Jira since your last export. Updating replaces its description.');
  assert.equal(listTurns(f.seq).length, n, 'nothing recorded');
  assert.equal((await runExport(f.seq, { mode: 'update', previewHash: q.previewHash, force: true }, { by: 'po', target: TARGET }, d)).action, 'updated');
  setMockSourceResponses({ ticketState: { exists: false }, updateTicket: { gone: true } });
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Rule three'] } });
  const g = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.equal(g.gone, true);
  const was = getExportLink(f.seq);
  await assert.rejects(runExport(f.seq, { mode: 'update', previewHash: g.previewHash, force: true }, { by: 'po', target: TARGET }, d),
    (e) => e.data.gone === true && e.message === 'SHOP-123 no longer exists in Jira.');
  assert.deepEqual(getExportLink(f.seq), was);
  // the plugin made the edit but could not read the description back: no fingerprint, never the old one (it changed)
  setMockSourceResponses({ updateTicket: { key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123', fingerprint: null } });
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Rule four'] } });
  const nf = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.equal(nf.edited, false);
  assert.equal((await runExport(f.seq, { mode: 'update', previewHash: nf.previewHash }, { by: 'po', target: TARGET }, d)).action, 'updated');
  assert.equal(getExportLink(f.seq).fingerprint, null);
});

test('comment (D7, D8): what changed since the last export; nothing changed is refused; the spec moves on, the fingerprint stays', async () => {
  reset();
  const f = readyFeature();
  await exportNow(f.seq);
  await assert.rejects(previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d), (e) => e.message === 'Nothing changed since the last export.');
  updateFeature(f.seq, { spec: { ...readySpec(), criteria: [...readySpec().criteria, { id: 'R-po-3', text: 'Support sees who cancelled' }] } });
  const p = await previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d);
  assert.equal(p.ticket, null);
  assert.match(p.comment, /^Updated in Worca since the last export \(\d{1,2} [A-Z][a-z]{2}\)\n\nAdded R-po-3 Support sees who cancelled\n\nFrom Worca FEAT-\d+\n$/);
  const fp0 = getExportLink(f.seq).fingerprint;
  assert.equal((await runExport(f.seq, { mode: 'comment', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d)).action, 'commented');
  assert.equal(seen.find((c) => c.op === 'commentTicket').args.body, p.comment);
  const l = getExportLink(f.seq);
  assert.deepEqual([l.fingerprint, l.spec.criteria.length], [fp0, 3]);
  await assert.rejects(previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d), (e) => e.message === 'Nothing changed since the last export.');
  setMockSourceResponses({ commentTicket: { gone: true } });
  updateFeature(f.seq, { spec: readySpec() });
  const q = await previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d);
  await assert.rejects(runExport(f.seq, { mode: 'comment', previewHash: q.previewHash }, { by: 'po', target: TARGET }, d), (e) => e.data.gone === true);
});

test('modes: create only without a ticket, the others only with one; a new ticket moves the link, the old key stays in the history', async () => {
  reset();
  const f = readyFeature();
  for (const mode of ['update', 'comment', 'new']) {
    await assert.rejects(previewExport(f.seq, { mode }, { target: TARGET }, d), (e) => e.message === 'This feature has no ticket yet.', mode);
  }
  await assert.rejects(previewExport(f.seq, { mode: 'split' }, { target: TARGET }, d), (e) => e.code === 'BAD_REQUEST');
  await exportNow(f.seq);
  await assert.rejects(previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d), (e) => e.message === 'This feature has a ticket already. Export it again instead.');
  const r = await exportNow(f.seq, { mode: 'new' });
  assert.deepEqual([r.action, r.key, getExportLink(f.seq).key], ['new', 'SHOP-124', 'SHOP-124']);
  const v = await exportView(getFeature(f.seq), listTurns(f.seq), d);
  assert.deepEqual(v.history.map((x) => [x.action, x.key]), [['new', 'SHOP-124'], ['created', 'SHOP-123']]);
});

test("refused (D11): the plugin's sentence, nothing created, the pending marker cleared", async () => {
  reset();
  setMockSourceResponses({ createTicket: { refused: { field: 'Team', message: 'Jira needs a value for “Team” in SHOP.' } } });
  const f = readyFeature();
  await assert.rejects(exportNow(f.seq), (e) => e.code === 'CONFLICT' && e.data.refused === true && e.data.field === 'Team'
    && e.message === 'Jira needs a value for “Team” in SHOP.');
  assert.equal(getExportLink(f.seq), null);
  assert.equal(exportTurns(f.seq).length, 0);
});

test('a refused update is fixed by Change the export setup: a setup on the link\'s connection and project gives the criteria, issue type and priority', async () => {
  reset();
  const was = getExportSetup('project', 'shop-1');
  try {
    upsertExportSetup({ ...SCOPE, ...was, criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } });
    const f = readyFeature();
    await exportNow(f.seq);
    updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A new rule'] } });
    setMockSourceResponses({ updateTicket: { refused: { field: 'Acceptance Criteria',
      message: 'Jira refused “Acceptance Criteria”: Field cannot be set. It is not on the appropriate screen, or unknown.' } } });
    const p = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
    assert.equal(p.ticket.criteria.target, 'field');
    await assert.rejects(runExport(f.seq, { mode: 'update', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d), (e) => e.data.refused === true);
    setMockSourceResponses(null);
    await saveSetup(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', project: 'SHOP', projectName: 'SHOP — Shop web', issueType: '10002',
      issueTypeName: 'Task', labels: ['worca'], priority: '3', priorityName: 'Medium', criteria: { target: 'description' } }, { by: 'po' }, d);
    const q = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
    assert.deepEqual([q.ticket.criteria, q.fields.criteria, q.ticket.issueType, q.ticket.priority], [{ target: 'description' }, { target: 'description' }, '10002', '3'],
      'the fresh preview has no criteria field');
    assert.match(q.ticket.description, /## Acceptance criteria/);
    assert.equal((await runExport(f.seq, { mode: 'update', previewHash: q.previewHash }, { by: 'po', target: TARGET }, d)).action, 'updated');
  } finally { upsertExportSetup({ ...SCOPE, ...was }); }
});

test('reach failures (D11): the sentence by kind, nothing recorded but the pending marker (D10, D14), no chip', async () => {
  for (const [kind, msg, want] of [['auth', 'Jira token invalid', 'Worca could not reach Jira: the API token was refused.'],
    ['timeout', 'op exceeded', 'Worca could not reach Jira: it did not answer within a minute.'],
    ['network', 'Jira unreachable: fetch failed.', 'Worca could not reach Jira: Jira unreachable: fetch failed.'],
    ['unimplemented', 'connector does not implement op "createTicket"', 'Jira cannot export any more.']]) {   // a downgraded connector
    reset();
    setMockSourceResponses({ createTicket: () => { throw new PluginOpError(kind, msg); } });
    const f = readyFeature();
    await assert.rejects(exportNow(f.seq), (e) => e.code === 'TRACKER' && e.data.kind === kind && e.message === want, kind);
    const l = getExportLink(f.seq);
    assert.deepEqual([l.key, /^rexp_[0-9a-f]{12}$/.test(l.pendingMarker)], [null, true], `${kind}: only the pending marker`);
    assert.equal(exportTurns(f.seq).length, 0);
    assert.equal((await exportView(getFeature(f.seq), listTurns(f.seq), d)).link, null, 'no chip');
  }
});

test("reach failures that are not product copy (a crash, garbage, the shim's own words): a fixed phrase in the 502, the raw first line in the server log", async () => {
  const STOPPED = 'Worca could not reach Jira: the Jira plugin stopped unexpectedly.';
  const UNREADABLE = 'Worca could not reach Jira: the Jira plugin gave an answer Worca could not read.';
  const cases = [
    ['protocol', 'plugin "jira-source" op "createTicket": child exited 1 — Error: boom\n    at file:///x/index.mjs:1:7', UNREADABLE],
    ['protocol', 'plugin "jira-source" op "createTicket": non-JSON on stdout (stdout is protocol-reserved; use ctx.log) — got: {"token":"s3"}', UNREADABLE],
    ['plugin', "Cannot read properties of undefined (reading 'fields')", STOPPED],
    ['plugin', 'plugin "jira-source": cannot read manifest — ENOENT: no such file, open \'C:\\x\\worca-cc-plugin.json\'', STOPPED],
    ['plugin', 'boom\n    at createTicket (/home/x/index.mjs:9:3)', STOPPED],
    ['plugin', 'EACCES: permission denied, open C:\\x\\jira.json', STOPPED],
    ['network', 'connect ECONNREFUSED via /x/proxy/sock', STOPPED],
    ['weird', 'Error: odd at file:///x/y.mjs', STOPPED],   // a kind the host does not know (an injected callSource)
    ['plugin', `stderr: ${'x'.repeat(400)}`, STOPPED],       // a long dump: only its first 200 characters reach the log
  ];
  const logged = [];
  const prevError = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    for (const [kind, msg, want] of cases) {
      reset();
      const f = readyFeature(`Garbage ${kind}`);
      const p = await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d);
      const dd = { callSource: (o) => (o.op === 'createTicket' ? Promise.reject(Object.assign(new Error(msg), { kind })) : d.callSource(o)) };
      await assert.rejects(runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { by: 'po', target: TARGET }, dd), (e) => {
        assert.equal(e.code, 'TRACKER');
        assert.equal(e.message, want, msg);
        assert.doesNotMatch(e.message, /file:|exited|stdout|manifest|\bat\s|[\\/]x[\\/]|Cannot read|odd/);
        return true;
      });
      const [head, ...rest] = msg.split(/\r?\n/);
      const line = logged.at(-1);
      assert.ok(line.includes(`(${kind})`) && line.includes(head.slice(0, 200)), `the kind and the raw first line are logged: ${msg}`);
      assert.doesNotMatch(line, /[\r\n]/, 'one log line');
      assert.ok(!line.includes(head.slice(0, 201)) || head.length <= 200, 'capped at 200 characters');
      for (const r of rest) assert.ok(!line.includes(r.trim()), 'the rest of the dump is not logged');
    }
  } finally { console.error = prevError; }
  reset();
  setMockSourceResponses({ createTicket: () => { throw new PluginOpError('plugin', 'Jira refused the request: Project SHOP is archived'); } });
  await assert.rejects(exportNow(readyFeature('Plain plugin').seq),
    (e) => e.message === 'Worca could not reach Jira: Jira refused the request: Project SHOP is archived.', "a connector's plain sentence stays");
});

test("a ticket URL is a link only when it is http(s): a connector's javascript: or data: URL is stored, answered and shown as none", async () => {
  reset();
  const f = readyFeature('Odd URL');
  setMockSourceResponses({ createTicket: () => ({ key: 'SHOP-50', url: 'javascript:alert(1)', fingerprint: 'f50' }),
    ticketState: () => ({ exists: true, url: 'data:text/html,x', fingerprint: 'f50' }),
    updateTicket: () => ({ key: 'SHOP-50', url: ' JavaScript:alert(2)', fingerprint: 'f51' }) });
  const c = await exportNow(f.seq);
  assert.deepEqual([c.action, c.key, c.url], ['created', 'SHOP-50', null]);
  assert.equal(getExportLink(f.seq).url, null);
  assert.equal(exportTurns(f.seq).at(-1).payload.url, null);
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A rule'] } });
  const u = await exportNow(f.seq, { mode: 'update' });
  assert.deepEqual([u.action, u.url, getExportLink(f.seq).url], ['updated', null, null]);
  setMockSourceResponses({ updateTicket: () => ({ key: 'SHOP-50', url: 'HTTPS://acme.test/browse/SHOP-50', fingerprint: 'f52' }),
    ticketState: () => ({ exists: true, fingerprint: 'f51' }) });
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['Another rule'] } });
  assert.equal((await exportNow(f.seq, { mode: 'update' })).url, 'HTTPS://acme.test/browse/SHOP-50', 'an http(s) URL in any case stays');
  const v = await exportView(getFeature(f.seq), listTurns(f.seq), d);
  assert.equal(v.link.url, 'HTTPS://acme.test/browse/SHOP-50');
  assert.deepEqual(v.history.map((h) => h.url), ['HTTPS://acme.test/browse/SHOP-50', null, null]);
  reset();
});

test('a lost answer (D10): the next export finds the ticket by label, marker and footer, links it and updates it; no duplicate', async () => {
  reset();
  const f = readyFeature();
  setMockSourceResponses({ createTicket: () => { throw new PluginOpError('timeout', 'exceeded'); } });
  await assert.rejects(exportNow(f.seq), (e) => e.data.kind === 'timeout');
  const marker = getExportLink(f.seq).pendingMarker;
  const label = `worca-${f.id}`;
  setMockSourceResponses({ findTicket: (a) => (a.marker === marker && a.label === label && a.project === 'SHOP'
    ? { key: 'SHOP-777', url: 'https://mock.test/browse/SHOP-777', fingerprint: 'f777', lastLine: `From Worca ${f.id} · exported 26 Oct 2026`, marker,
      labels: ['worca', label] } : null) });
  seen.length = 0;
  const r = await exportNow(f.seq);
  assert.deepEqual([r.action, r.key], ['updated', 'SHOP-777']);
  assert.deepEqual(seen.map((c) => c.op), ['findTicket', 'updateTicket'], 'no create, no state check');
  assert.deepEqual(exportTurns(f.seq).map((t) => [t.payload.action, t.payload.key]), [['linked', 'SHOP-777'], ['updated', 'SHOP-777']]);
  assert.deepEqual([getExportLink(f.seq).key, getExportLink(f.seq).pendingMarker], ['SHOP-777', null]);
});

test("findTicket's checks (D10): another install's marker, a wrong footer or a missing label is no match: the marker goes, a ticket is made", async () => {
  for (const wrong of [{ marker: 'rexp_ffffffffffff' }, { lastLine: 'From Worca FEAT-0 · exported 26 Oct 2026' }, { labels: ['worca'] }]) {
    reset();
    const f = readyFeature();
    setPendingExport(f.seq, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', trackerProject: 'SHOP', marker: 'rexp_000000000001' });
    setMockSourceResponses({ findTicket: () => ({ key: 'SHOP-777', url: 'u', fingerprint: 'f', lastLine: `From Worca ${f.id} · exported 26 Oct 2026`,
      marker: 'rexp_000000000001', labels: ['worca', `worca-${f.id}`], ...wrong }) });
    const r = await exportNow(f.seq);
    assert.deepEqual([r.action, r.key], ['created', 'SHOP-123'], JSON.stringify(wrong));
    assert.equal(exportTurns(f.seq).filter((t) => t.payload.action === 'linked').length, 0);
  }
  reset();
  const g = readyFeature();
  await exportNow(g.seq);
  seen.length = 0;
  await exportNow(g.seq, { mode: 'new' });
  assert.equal(seen.some((c) => c.op === 'findTicket'), false, 'no pending marker: no search');
});

test('one export at a time (D13); a start in flight, a round running and an archived feature are refused; a preview takes no lock', async () => {
  reset();
  const f = readyFeature();
  let release = null;
  setMockSourceResponses({ createTicket: () => new Promise((r) => { release = () => r({ key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123', fingerprint: 'x' }); }) });
  const p = await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d);
  const first = runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
  assert.equal(isExporting(f.seq), true, 'taken before the first await');
  await assert.rejects(runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { target: TARGET }, d),
    (e) => e.code === 'BUSY' && e.message === 'Worca is already exporting this feature.');
  assert.equal((await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d)).previewHash, p.previewHash, 'a preview still answers');
  assert.throws(() => forgetLink(f.seq), (e) => e.code === 'BUSY');
  await waitFor(() => typeof release === 'function');
  release();
  await first;
  assert.equal(isExporting(f.seq), false);
  const g = readyFeature();
  markStarting(g.seq);
  try { await assert.rejects(exportNow(g.seq), (e) => e.code === 'BUSY' && e.message === 'this feature is starting a run. Try again in a moment.'); }
  finally { unmarkStarting(g.seq); }
  // a look that cannot finish until the gate opens (the pattern of requirements-start.test.mjs), so BUSY never races it
  const h = readyFeature();
  const ph = await previewExport(h.seq, { mode: 'create' }, { target: TARGET }, d);
  let open;
  const gate = new Promise((r) => { open = r; });
  const look = { runClaudeImpl: async () => { await gate; return { text: '{"spec":{},"questions":[],"done":true}' }; },
    listModels: async () => [], listProjects: async () => [], workspaceTarget: async () => null,
    openLook: async () => null, openWorkspaceLook: async () => null, onChange: () => {} };
  const job = startOrientation(h.seq, { thenRound: false }, look);
  try {
    assert.equal(isBusy(h.seq), true);
    await assert.rejects(runExport(h.seq, { mode: 'create', previewHash: ph.previewHash }, { by: 'po', target: TARGET }, d),
      (e) => e.code === 'BUSY' && e.message === 'Worca is still working on this feature. Try again in a moment.');
  } finally {
    open();
    await job;
    await settled(h.seq);
  }
  const a = readyFeature();
  const pa = await previewExport(a.seq, { mode: 'create' }, { target: TARGET }, d);
  updateFeature(a.seq, { status: 'archived' });
  await assert.rejects(runExport(a.seq, { mode: 'create', previewHash: pa.previewHash }, { target: TARGET }, d),
    (e) => e.code === 'CONFLICT' && e.message === 'this feature is archived; restore it first');
  await assert.rejects(previewExport(a.seq, { mode: 'create' }, { target: TARGET }, d), (e) => e.code === 'CONFLICT');
});

test('Forget the link (D12): the row goes, a forgot turn, nothing sent; the next export is a first export', async () => {
  reset();
  const f = readyFeature();
  assert.throws(() => forgetLink(f.seq), (e) => e.message === 'This feature has no ticket yet.');
  await exportNow(f.seq);
  seen.length = 0;
  forgetLink(f.seq, { by: 'po' });
  assert.deepEqual([seen.length, getExportLink(f.seq)], [0, null], 'nothing sent; the link is gone');
  const t = exportTurns(f.seq).at(-1);
  assert.deepEqual([t.payload.action, t.payload.key, t.by], ['forgot', 'SHOP-123', 'po']);
  assert.equal((await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d)).key, null);
  const v = await exportView(getFeature(f.seq), listTurns(f.seq), d);
  assert.deepEqual([v.link, v.history.map((x) => x.action)], [null, ['forgot', 'created']]);
});

test("exportView: the tracker's name, hasSetup, the link and its dates, doneStatus of the link's connection, history newest first", async () => {
  reset();
  const f = readyFeature();
  let v = await exportView(f, listTurns(f.seq), d);
  assert.deepEqual([v.tracker, v.canExport, v.hasSetup, v.link, v.exporting, v.history], [{ name: 'Jira' }, true, true, null, false, []]);
  await exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', project: 'SHOP', issueType: '10001' }, d);
  assert.equal(getExportSetup('project', 'shop-1').doneStatus, 'Done', "options refresh the setup's done status");
  await exportNow(f.seq);
  v = await exportView(getFeature(f.seq), listTurns(f.seq), d);
  assert.deepEqual([v.link.key, v.link.url, v.link.tracker, v.doneStatus], ['SHOP-123', 'https://mock.test/browse/SHOP-123', 'Jira', 'Done']);
  assert.match(v.link.madeOn, /^\d{1,2} [A-Z][a-z]{2}$/);
  assert.match(v.history[0].when, /^\d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/);
  assert.deepEqual([v.history[0].action, v.history[0].by, v.history[0].tracker], ['created', 'po', 'Jira']);
  appendTurn(f.seq, { kind: 'export', payload: { action: 'updated', tracker: 'Jira', key: 'SHOP-123', url: null, at: new Date().toISOString() } }, { by: 'local' });
  assert.equal((await exportView(getFeature(f.seq), listTurns(f.seq), d)).history[0].by, null, "a single-user install's 'local' names nobody");
  const archived = await exportView({ ...getFeature(f.seq), status: 'archived' }, [], d);
  assert.deepEqual([archived.tracker, archived.canExport], [{ name: 'Jira' }, false]);
  const other = await exportView({ ...f, scopeKey: 'no-setup' }, [], d);
  assert.deepEqual([other.hasSetup, other.tracker], [false, { name: 'Jira' }], 'one tracker: its name, before any setup');
});

test('saveSetup and exportOptions: the connection must be a listed tracker; a reach failure; the setup holds no config value', async () => {
  reset();
  await assert.rejects(exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'nope' }, d),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'Choose a connection from the list.');
  await assert.rejects(saveSetup(SCOPE, { plugin: 'other', sourceId: 'x', project: 'SHOP', issueType: '1' }, {}, d), (e) => e.message === 'Choose a connection from the list.');
  await assert.rejects(saveSetup(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', issueType: '1' }, {}, d), (e) => e.message === 'project is required');
  const o = await exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'beta', project: 'SHOP' }, d);
  assert.deepEqual(o.issueTypes.map((x) => x.label), ['Story', 'Task', 'Bug']);
  setMockSourceResponses({ exportOptions: () => { throw new PluginOpError('auth', 'x'); } });
  await assert.rejects(exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' }, d), (e) => e.code === 'TRACKER' && e.data.kind === 'auth');
  reset();
  const ws = { scopeType: 'workspace', scopeKey: 'ws-1' };
  const s = await saveSetup(ws, { plugin: 'jira-source', sourceId: 'jira', profile: 'beta', project: 'OPS', projectName: 'OPS — Operations', issueType: '10002',
    issueTypeName: 'Task', labels: ['a b', 'worca'], priority: '', criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } }, { by: 'po' }, d);
  assert.deepEqual([s.profile, s.labels, s.priority, s.criteria, s.doneStatus],
    ['beta', ['a-b', 'worca'], null, { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' }, 'Done'], "beta's last options named Done");
  const v = await exportSetupView(ws, {}, d);
  assert.deepEqual([v.setup.trackerProject, v.trackers.length, v.defaultProfile], ['OPS', 1, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' }]);
  assert.doesNotMatch(JSON.stringify(v), /token|baseUrl|email/);
});

// ---- the export date, a one-line reason, a keyless pending row from elsewhere ----

const STALE = 'The spec changed since the preview. Look at the preview again.';
/** Deps whose clock runs `ms` ahead (default: past the two minutes a lost create's marker waits for the tracker's search). */
const later = (ms = 121_000) => ({ ...d, now: () => new Date(Date.now() + ms) });
async function exportVia(seq, body, deps) {
  const p = await previewExport(seq, body, { target: TARGET }, deps);
  return runExport(seq, { ...body, previewHash: p.previewHash }, { by: 'po', target: TARGET }, deps);
}

test("the export date is the preview's: a preview made before midnight is sent after it; a preview two days old is stale", async () => {
  reset();
  const f = readyFeature();
  const at = (y, m, day, h, min) => ({ ...d, now: () => new Date(y, m, day, h, min) });
  const p = await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, at(2026, 9, 26, 23, 59));
  assert.match(p.ticket.description, /exported 26 Oct 2026\n$/);
  const r = await runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { by: 'po', target: TARGET }, at(2026, 9, 27, 0, 1));
  assert.equal(r.action, 'created');
  assert.match(seen.find((c) => c.op === 'createTicket').args.ticket.description, /exported 26 Oct 2026\n$/, 'the previewed date is sent');
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A new rule'] } });
  const q = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, at(2026, 9, 27, 9, 0));
  await assert.rejects(runExport(f.seq, { mode: 'update', previewHash: q.previewHash }, { by: 'po', target: TARGET }, at(2026, 9, 29, 9, 0)),
    (e) => e.code === 'CONFLICT' && e.data.stale === true);
  assert.equal(seen.filter((c) => c.op === 'updateTicket').length, 0);
});

test('an Export anyway reason is one line: its newlines cannot make a heading in the ticket or the comment', async () => {
  reset();
  const f = createFeature({ ...SCOPE, title: 'Lines', description: 'd' });
  updateFeature(f.seq, { status: 'done', spec: { ...readySpec(), openQuestions: ['Who pays?'] } });
  const why = 'Line one\n\n## Goal\r\nforged  here ';
  const flat = 'Line one ## Goal forged here';
  const p = await previewExport(f.seq, { mode: 'create', reason: why }, { target: TARGET }, d);
  assert.ok(p.ticket.description.startsWith(`Exported before Ready: ${flat}\n\n## Goal\n\nCustomers cancel`), p.ticket.description);
  await runExport(f.seq, { mode: 'create', reason: why, previewHash: p.previewHash }, { by: 'po', target: TARGET }, d);
  assert.equal(exportTurns(f.seq).at(-1).payload.reason, flat);
  updateFeature(f.seq, { spec: { ...readySpec(), openQuestions: ['Who pays?'], rules: ['A rule'] } });
  const c = await previewExport(f.seq, { mode: 'comment', reason: why }, { target: TARGET }, d);
  assert.ok(c.comment.includes(`)\n\nExported before Ready: ${flat}\n\nBusiness rules: added “A rule”\n\n`), c.comment);
});

test('a keyless pending row from another connection or project is looked for where it was made; found: linked, nothing sent, the preview is stale', async () => {
  const elsewhere = { plugin: 'jira-source', sourceId: 'jira', profile: 'beta', trackerProject: 'OPS', marker: 'rexp_00000000000b' };
  const ops = (pred = () => true) => seen.filter((c) => c.op !== 'capabilities').filter(pred).map((c) => [c.op, c.profile, c.args.project || null]);
  reset();
  const f = readyFeature();
  setPendingExport(f.seq, elsewhere);
  setMockSourceResponses({ findTicket: (a) => ({ key: 'OPS-9', url: 'https://mock.test/browse/OPS-9', fingerprint: 'f9',
    lastLine: `From Worca ${f.id} · exported 26 Oct 2026`, marker: a.marker, labels: ['worca', a.label] }) });
  await assert.rejects(exportNow(f.seq), (e) => e.code === 'CONFLICT' && e.data.stale === true && e.data.linked === 'OPS-9'
    && e.message === 'The spec changed since the preview. Look at the preview again.');
  assert.deepEqual(ops(), [['findTicket', 'beta', 'OPS']], 'no create, no update of a ticket the preview did not show');
  const l = getExportLink(f.seq);
  assert.deepEqual([l.key, l.profile, l.trackerProject, l.pendingMarker, l.fields, l.spec], ['OPS-9', 'beta', 'OPS', null, null, null]);
  assert.deepEqual(exportTurns(f.seq).map((t) => [t.payload.action, t.payload.key]), [['linked', 'OPS-9']]);
  assert.equal(isExporting(f.seq), false);
  updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A rule'] } });
  const u = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
  assert.deepEqual([u.key, u.fields.project.value, u.fields.conn.profile], ['OPS-9', 'OPS', 'beta'], 'the next preview is of the linked ticket');
  reset();
  const g = readyFeature();
  setPendingExport(g.seq, elsewhere);
  const r = await exportVia(g.seq, { mode: 'create' }, later());   // past the search lag's two minutes
  assert.deepEqual([r.action, r.key], ['created', 'SHOP-123']);
  assert.deepEqual(ops(), [['findTicket', 'beta', 'OPS'], ['createTicket', 'acme', null]], 'not there: the setup makes the ticket');
});

// ---- never a ticket the preview did not name; the hash covers the connection; a link with no spec copy;
// the tracker's search lag after a lost create ----

test('a lost New ticket never takes over a later Update or Comment of the old ticket: linked, nothing sent, the preview is stale', async () => {
  for (const mode of ['update', 'comment']) {
    reset();
    const f = readyFeature();
    await exportNow(f.seq);
    setMockSourceResponses({ createTicket: () => { throw new PluginOpError('timeout', 'exceeded'); } });
    await assert.rejects(exportNow(f.seq, { mode: 'new' }), (e) => e.data.kind === 'timeout');
    const marker = getExportLink(f.seq).pendingMarker;
    assert.deepEqual([getExportLink(f.seq).key, /^rexp_/.test(marker)], ['SHOP-123', true]);
    updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A new rule'] } });
    setMockSourceResponses({ findTicket: (a) => (a.marker === marker ? { key: 'SHOP-124', url: 'https://mock.test/browse/SHOP-124', fingerprint: 'f124',
      lastLine: `From Worca ${f.id} · exported 26 Oct 2026`, marker, labels: ['worca', a.label] } : null) });
    const p = await previewExport(f.seq, { mode }, { target: TARGET }, d);
    assert.equal(p.key, 'SHOP-123', mode);
    seen.length = 0;
    await assert.rejects(runExport(f.seq, { mode, previewHash: p.previewHash }, { by: 'po', target: TARGET }, d),
      (e) => e.code === 'CONFLICT' && e.data.stale === true && e.data.linked === 'SHOP-124' && e.message === STALE, mode);
    assert.deepEqual(seen.map((c) => c.op), ['findTicket'], `${mode}: nothing sent to a ticket the preview did not name`);
    assert.deepEqual([getExportLink(f.seq).key, getExportLink(f.seq).pendingMarker], ['SHOP-124', null]);
    assert.deepEqual(exportTurns(f.seq).map((t) => t.payload.action), ['created', 'linked']);
    assert.equal(isExporting(f.seq), false);
  }
});

test('the preview hash covers the connection: a setup switched to another site between preview and send is stale', async () => {
  reset();
  const was = getExportSetup('project', 'shop-1');
  const f = readyFeature();
  const p = await previewExport(f.seq, { mode: 'create' }, { target: TARGET }, d);
  try {
    upsertExportSetup({ ...SCOPE, ...was, profile: 'beta' });
    await assert.rejects(runExport(f.seq, { mode: 'create', previewHash: p.previewHash }, { by: 'po', target: TARGET }, d),
      (e) => e.code === 'CONFLICT' && e.data.stale === true);
    assert.equal(seen.filter((c) => c.op === 'createTicket').length, 0);
    assert.equal(getExportLink(f.seq), null);
  } finally { upsertExportSetup({ ...SCOPE, ...was }); }
});

test('a link with no spec copy (linked from another site): no comment until one update; its update keeps the criteria in the description', async () => {
  reset();
  const was = getExportSetup('project', 'shop-1');
  try {
    upsertExportSetup({ ...SCOPE, ...was, criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } });
    const f = readyFeature();
    setPendingExport(f.seq, { plugin: 'jira-source', sourceId: 'jira', profile: 'beta', trackerProject: 'OPS', marker: 'rexp_00000000000c' });
    setMockSourceResponses({ findTicket: (a) => ({ key: 'OPS-9', url: 'https://mock.test/browse/OPS-9', fingerprint: null,
      lastLine: `From Worca ${f.id} · exported 26 Oct 2026`, marker: a.marker, labels: ['worca', a.label] }) });
    await assert.rejects(exportNow(f.seq), (e) => e.data.linked === 'OPS-9');
    assert.equal(getExportLink(f.seq).spec, null);
    await assert.rejects(previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d),
      (e) => e.code === 'CONFLICT' && e.message === 'Update OPS-9 once to give Worca a starting point for comments.');
    setMockSourceResponses(null);
    const u = await previewExport(f.seq, { mode: 'update' }, { target: TARGET }, d);
    assert.deepEqual([u.ticket.criteria, u.fields.criteria], [{ target: 'description' }, { target: 'description' }],
      "no custom field id from the setup's other site");
    assert.match(u.ticket.description, /## Acceptance criteria/);
    assert.equal((await runExport(f.seq, { mode: 'update', previewHash: u.previewHash }, { by: 'po', target: TARGET }, d)).action, 'updated');
    updateFeature(f.seq, { spec: { ...readySpec(), rules: ['A rule'] } });
    assert.ok((await previewExport(f.seq, { mode: 'comment' }, { target: TARGET }, d)).comment.includes('Business rules: added “A rule”'),
      'after one update a comment lists what changed');
  } finally { upsertExportSetup({ ...SCOPE, ...was }); }
});

test("the tracker's search lag: a lost create's marker younger than two minutes that finds nothing is kept (BUSY); older, a ticket is made", async () => {
  reset();
  const f = readyFeature();
  setMockSourceResponses({ createTicket: () => { throw new PluginOpError('timeout', 'exceeded'); } });
  await assert.rejects(exportNow(f.seq), (e) => e.data.kind === 'timeout');
  const marker = getExportLink(f.seq).pendingMarker;
  setMockSourceResponses(null);
  seen.length = 0;
  await assert.rejects(exportNow(f.seq), (e) => e.code === 'BUSY'
    && e.message === 'Worca is still checking whether Jira made the ticket. Try again in a moment.');
  assert.deepEqual(seen.filter((c) => c.op !== 'capabilities').map((c) => c.op), ['findTicket']);
  assert.deepEqual([getExportLink(f.seq).key, getExportLink(f.seq).pendingMarker], [null, marker], 'the marker stays');
  assert.equal(isExporting(f.seq), false);
  seen.length = 0;
  const r = await exportVia(f.seq, { mode: 'create' }, later());
  assert.deepEqual([r.action, r.key], ['created', 'SHOP-123']);
  assert.deepEqual(seen.filter((c) => c.op !== 'capabilities').map((c) => c.op), ['findTicket', 'createTicket']);
});

test('the search grace follows the failure: after a refused token or the rate limit Try again makes the ticket at once; after a timeout, a protocol failure or a network failure it waits', async () => {
  const soon = (ms = 5_000) => ({ ...d, now: () => new Date(Date.now() + ms) });   // well inside the two minutes
  for (const kind of ['auth', 'rate-limit']) {
    reset();
    const f = readyFeature(`Certain ${kind}`);
    setMockSourceResponses({ createTicket: () => { throw new PluginOpError(kind, 'refused'); } });
    await assert.rejects(exportNow(f.seq), (e) => e.code === 'TRACKER' && e.data.kind === kind);
    assert.ok(getExportLink(f.seq).pendingMarker, 'the marker is kept, as after any thrown failure');
    setMockSourceResponses(null);
    seen.length = 0;
    const r = await exportVia(f.seq, { mode: 'create' }, soon());
    assert.equal(r.action, 'created', `${kind}: no ticket was made, so no wait`);
    assert.deepEqual(seen.filter((c) => c.op !== 'capabilities').map((c) => c.op), ['findTicket', 'createTicket'], `${kind}: the marker is still looked for`);
    assert.equal(getExportLink(f.seq).pendingMarker, null);
  }
  for (const [kind, fail] of [['timeout', () => { throw new PluginOpError('timeout', 'exceeded'); }],
    ['network', () => { throw new PluginOpError('network', 'Jira unreachable: socket hang up'); }],
    ['protocol', () => ({ url: 'https://mock.test/browse/SHOP-1' })]]) {   // an answer without the key it made
    reset();
    const f = readyFeature(`Unknown ${kind}`);
    setMockSourceResponses({ createTicket: fail });
    await assert.rejects(exportNow(f.seq), (e) => e.code === 'TRACKER' && e.data.kind === kind);
    setMockSourceResponses(null);
    await assert.rejects(exportVia(f.seq, { mode: 'create' }, soon()),
      (e) => e.code === 'BUSY' && e.message === 'Worca is still checking whether Jira made the ticket. Try again in a moment.', `${kind}: the outcome is unknown`);
    assert.equal((await exportVia(f.seq, { mode: 'create' }, later())).action, 'created', `${kind}: past the grace a ticket is made`);
  }
});

test('the search grace after a restart: a refused create this process did not see is treated as unknown (the grace applies)', async () => {
  reset();
  const f = readyFeature('Certain, then a restart');
  setMockSourceResponses({ createTicket: () => { throw new PluginOpError('auth', 'refused'); } });
  await assert.rejects(exportNow(f.seq), (e) => e.data.kind === 'auth');
  setMockSourceResponses(null);
  _resetExportCaches();   // what a restart forgets
  await assert.rejects(exportVia(f.seq, { mode: 'create' }, { ...d, now: () => new Date(Date.now() + 5_000) }), (e) => e.code === 'BUSY');
  assert.equal((await exportVia(f.seq, { mode: 'create' }, later())).action, 'created');
});
