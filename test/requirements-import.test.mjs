// test/requirements-import.test.mjs — the import service (plans/requirements-a61-design.md D2–D9, D12, D16) in mock mode: the real callSource
// with the shim's canned answers, jira-source linked with two connections. No tracker, no model, nothing written by a preview.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile } from '../src/core/plugin-config.mjs';
import { callSource, setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { createFeature, saveExportLink, listFeatures } from '../src/core/requirements/store.mjs';
import { saveSetup, _resetExportCaches } from '../src/core/requirements/export.mjs';
import { IMPORT_TIMEOUT_MS, importView, importOptions, searchTickets, previewImport } from '../src/core/requirements/import.mjs';

useTempHome(after, 'worca-req-import-');
const prevMock = process.env.WORCA_MOCK;
process.env.WORCA_MOCK = '1';
after(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; setMockSourceResponses(null); });

const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const ACME = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const seen = [];
const d = { callSource: (o) => { seen.push(o); return callSource(o); } };
const reset = () => { seen.length = 0; setMockSourceResponses(null); };

before(async () => {
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  createProfile('jira-source', 'beta', 'jira.beta.test (Data Center)');
  _resetExportCaches();
});

test("importView (D2, D3): the sources that can import; defaults from an export setup on an importing connection, else A6's default and All projects", async () => {
  reset();
  assert.equal(IMPORT_TIMEOUT_MS, 60_000);
  const v0 = await importView(SCOPE, {}, d);
  assert.deepEqual(v0.sources, [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira',
    profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }, { id: 'beta', label: 'jira.beta.test (Data Center)' }] }]);
  assert.deepEqual([v0.defaultConnection, v0.defaultProject], [ACME, null]);
  await saveSetup(SCOPE, { ...ACME, profile: 'beta', project: 'OPS', projectName: 'OPS — Operations', issueType: '10001', issueTypeName: 'Story' }, { by: 'po' }, d);
  const v1 = await importView(SCOPE, {}, d);
  assert.deepEqual([v1.defaultConnection, v1.defaultProject], [{ ...ACME, profile: 'beta' }, 'OPS']);
  assert.equal(seen.filter((c) => c.op !== 'capabilities').length, 0, 'no tracker call but the probe');
});

test('importView: a source whose capabilities do not say import is not offered', async () => {
  reset();
  _resetExportCaches();
  setMockSourceResponses({ capabilities: { writeBack: true, export: true } });
  assert.deepEqual((await importView(SCOPE, {}, d)).sources, []);
  setMockSourceResponses(null);
  _resetExportCaches();
});

test("importOptions and searchTickets (D4, D12): the connection's projects; the search through it within a minute, each ticket with the feature it follows", async () => {
  reset();
  const f = createFeature({ ...SCOPE, title: 'Cancel an order before it ships', description: 'x' });
  saveExportLink(f.seq, { ...ACME, trackerProject: 'SHOP', key: 'SHOP-123', url: 'https://mock.test/browse/SHOP-123' });
  assert.deepEqual((await importOptions(SCOPE, ACME, d)).projects.map((p) => p.value), ['SHOP', 'OPS']);
  const r = await searchTickets(SCOPE, { ...ACME, project: 'SHOP', search: 'cancel' }, d);
  assert.deepEqual(r.tickets.map((t) => [t.key, t.updatedOn, t.linkedTo && t.linkedTo.id]),
    [['SHOP-123', '26 Oct', f.id], ['SHOP-124', '25 Oct', null], ['SHOP-131', '24 Oct', null], ['SHOP-98', '12 Oct', null]]);
  assert.deepEqual(r.tickets[1], { key: 'SHOP-124', title: 'Partial cancel for multi-item orders', url: 'https://mock.test/browse/SHOP-124', type: 'Story',
    status: 'In progress', updatedOn: '25 Oct', linkedTo: null });
  const call = seen.find((c) => c.op === 'searchTickets');
  assert.deepEqual([call.profile, call.timeoutMs, call.args], ['acme', 60_000, { project: 'SHOP', search: 'cancel' }]);
  assert.equal((await searchTickets(SCOPE, { ...ACME, profile: 'beta' }, d)).tickets[0].linkedTo, null, 'linked through another connection is no link');
  await assert.rejects(searchTickets(SCOPE, { ...ACME, profile: 'gamma' }, d), (e) => e.code === 'BAD_REQUEST' && e.message === 'Choose a connection from the list.');
});

test("a tracker failure (D16, U1): A6's reach sentence — fixed phrases for auth and timeout, the connector's own sentence when it is product copy, else \"the Jira plugin stopped unexpectedly\"; the log keeps the first line only; an op the connector lost says it cannot import", async () => {
  reset();
  const logged = [];
  const was = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    for (const [kind, message, reason] of [
      ['auth', 'Jira token invalid or expired', 'the API token was refused'],
      ['timeout', 'plugin "jira-source" op "searchTickets" exceeded 60000ms', 'it did not answer within a minute'],
      ['network', 'Jira unreachable: fetch failed.', 'Jira unreachable: fetch failed'],
      ['plugin', 'Jira refused the request: The value \'SHOP\' does not exist for the field \'project\'.',
        "Jira refused the request: The value 'SHOP' does not exist for the field 'project'"],
      ['plugin', 'Jira 500: secret detail (GET /rest/api/2/search)', 'the Jira plugin stopped unexpectedly'],
      ['plugin', 'TypeError: x is not a function\n    at run (file:///plugin/index.mjs:1:1)\nTOKEN=abc123', 'the Jira plugin stopped unexpectedly']]) {
      setMockSourceResponses({ searchTickets: () => { throw new PluginOpError(kind, message); } });
      await assert.rejects(searchTickets(SCOPE, ACME, d), (e) => e.code === 'TRACKER' && e.message === `Worca could not reach Jira: ${reason}.`
        && e.data.kind === kind && !/secret|rest\/|TOKEN/.test(e.message), `${kind}: ${reason}`);
    }
    assert.ok(logged.some((l) => /secret detail/.test(l)), 'the raw first line goes to the log');
    assert.ok(logged.some((l) => /TypeError: x is not a function/.test(l)), 'the first line of a multi-line message is logged');
    assert.ok(!logged.some((l) => /TOKEN=|file:\/\/\/plugin/.test(l)), 'never the lines after it (M3: no plugin stderr in the log)');
    setMockSourceResponses({ searchTickets: undefined });
    await assert.rejects(searchTickets(SCOPE, ACME, d), (e) => e.code === 'TRACKER' && e.message === 'Jira cannot import any more.');
  } finally { console.error = was; setMockSourceResponses(null); }
});

test("previewImport (D5–D9): the ticket as the preview shows it, its default ticks, the connection, a setup's criteria field on the same connection; nothing written", async () => {
  reset();
  const before = listFeatures({ archived: true }).length;
  await saveSetup(SCOPE, { ...ACME, project: 'SHOP', projectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story',
    criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } }, { by: 'po' }, d);
  const p = await previewImport(SCOPE, { ...ACME, key: 'shop-124' }, d);
  assert.deepEqual(seen.find((c) => c.op === 'importTicket').args, { key: 'SHOP-124', criteriaField: 'customfield_10070' });
  assert.deepEqual([p.key, p.tracker, p.connection, p.title], ['SHOP-124', 'Jira', 'acme.atlassian.net (Cloud)', 'Partial cancel for multi-item orders']);
  assert.ok(!/Acceptance criteria/.test(p.description), 'the criteria section is out of the description');
  assert.deepEqual([p.criteria.from, p.criteria.items.length, p.criteria.picked], ['section', 3, [true, true, true]]);
  assert.deepEqual(p.comments.map((c) => c.picked), [true, true, true, false, true, true], 'every comment by a person; the app one unticked');
  assert.equal(p.redacted, 1);
  assert.ok(p.comments.at(-1).body.includes('ghp_<redacted>'));
  assert.deepEqual(p.attachments.map((a) => [a.name, a.picked, a.refused]), [['packing-slip.png', true, null], ['partial-cancel-flow.pdf', true, null],
    ['support-macro.txt', true, null], ['refund-matrix.xlsx', false, 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.'],
    ['pick-route-scan.pdf', false, 'Not offered: it is over 25 MB.']]);
  assert.deepEqual([p.commentsTotal, p.restrictedComments, p.olderComments, p.linkedTo, p.descriptionFile, 'fingerprint' in p], [7, 1, 0, null, null, false]);
  const other = await previewImport(SCOPE, { ...ACME, profile: 'beta', key: 'SHOP-124' }, d);
  assert.deepEqual(seen.filter((c) => c.op === 'importTicket').at(-1).args, { key: 'SHOP-124' }, 'a setup on another connection names no field');
  assert.equal(other.connection, 'jira.beta.test (Data Center)');
  assert.equal(listFeatures({ archived: true }).length, before, 'nothing created');
});

test("previewImport: the caps count the form's own files (D9); a ticket another feature follows says so (D12); a gone key and a bad key", async () => {
  reset();
  const full = await previewImport(SCOPE, { ...ACME, key: 'SHOP-124', formFiles: { count: 8, bytes: 0 } }, d);
  assert.deepEqual(full.attachments.slice(0, 3).map((a) => [a.picked, a.capped]), [[true, null], [false, 'files'], [false, 'files']]);
  const linked = await previewImport(SCOPE, { ...ACME, key: 'SHOP-123' }, d);
  assert.equal(linked.linkedTo.title, 'Cancel an order before it ships');
  await assert.rejects(previewImport(SCOPE, { ...ACME, key: 'SHOP-999' }, d), (e) => e.code === 'NOT_FOUND' && e.data.gone === true
    && e.message === 'SHOP-999 was not found in Jira, or this connection cannot see it.');
  await assert.rejects(previewImport(SCOPE, { ...ACME, key: 'not a key' }, d), (e) => e.code === 'BAD_REQUEST' && e.message === 'key must be a ticket key such as SHOP-124');
});
