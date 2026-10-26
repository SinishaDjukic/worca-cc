// test/jira-source-export.test.mjs — jira-source's export ops against a fake Jira over real HTTP (plans/requirements-a6-design.md
// §5, D9–D11, D16): Cloud and Data Center, create metadata as `fields` or `values`, the textarea filter, a required field, a
// refused token, 404 as gone, the property in the create body and its fallback, add-only labels, the fingerprint.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { fingerprintOf, AFTER_KEY_TIMEOUT_MS } from '../plugins/jira-source/connector/index.mjs';
import { markdownToWiki } from '../plugins/jira-source/connector/markup.mjs';
import { startFakeJira } from './helpers/fake-jira.mjs';

const open = [];
after(async () => { for (const j of open) await j.close(); });
async function site(o = {}) {
  const jira = await startFakeJira(o);
  open.push(jira);
  const cloud = (o.deployment || 'cloud') === 'cloud';
  const map = new Map();
  const logs = [];
  const ctx = { apiVersion: 5, profile: 'acme', log: (level, msg) => { logs.push(`${level} ${msg}`); },
    config: { baseUrl: jira.base, email: cloud ? 'ann@acme.test' : '', token: o.token || 'tok', transitionOnComplete: o.done ?? 'Done' },
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
  return { jira, logs, src: createTaskSource(ctx, o.afterKeyTimeoutMs ? { afterKeyTimeoutMs: o.afterKeyTimeoutMs } : {}) };
}
const DESC = '## Goal\n\nCancel before it ships.\n\nMeasure: fewer calls\n\n## Acceptance criteria\n\n- R-po-1 Cancel while unpaid\n\nFrom Worca FEAT-7 · exported 26 Oct 2026\n';
const TICKET = { project: 'SHOP', issueType: '10001', title: 'Cancel an order before it ships', description: DESC, labels: ['worca', 'worca-FEAT-7'],
  priority: '3', criteria: { target: 'description' } };
const BOTH = ['cloud', 'datacenter'];

test('capabilities: export is on; write-back still follows the run\'s input', async () => {
  const { src } = await site();
  assert.deepEqual(src.capabilities({ inputs: { writeBack: 'yes' } }), { writeBack: true, incrementalSync: false, export: true });
  assert.deepEqual(src.capabilities({}), { writeBack: false, incrementalSync: false, export: true });
});

test('exportOptions: projects as "SHOP — Shop web"; issue types without sub-tasks; priorities; only multi-line text fields; doneStatus', async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment });
    const p = await src.exportOptions({});
    assert.deepEqual(p, { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }], doneStatus: 'Done' }, deployment);
    assert.deepEqual((await src.exportOptions({ project: 'SHOP' })).issueTypes,
      [{ value: '10001', label: 'Story' }, { value: '10002', label: 'Task' }, { value: '10003', label: 'Bug' }], deployment);
    const both = await src.exportOptions({ project: 'SHOP', issueType: '10001' });
    assert.deepEqual(both.priorities, [{ value: '1', label: 'Highest' }, { value: '3', label: 'Medium' }], deployment);
    assert.deepEqual(both.criteriaFields, [{ value: 'customfield_10070', label: 'Acceptance Criteria' }], `${deployment}: the one-line field is left out`);
  }
  const { src } = await site({ done: '  ' });
  assert.equal((await src.exportOptions({})).doneStatus, null, 'no transition named: null');
});

test('exportOptions: a Data Center older than 8.4 (serverInfo says so; create metadata 404) answers tooOld', async () => {
  const { src } = await site({ deployment: 'datacenter', oldCreatemeta: true, version: '8.3.4' });
  const r = await src.exportOptions({ project: 'SHOP' });
  assert.deepEqual([r.tooOld, r.issueTypes, r.projects.length], [true, [], 2]);
});

test('exportOptions: a create-metadata 404 on a Data Center 8.4 or later is a missing project, not tooOld', async () => {
  for (const version of ['8.4.0', '9.12.0']) {
    const { src } = await site({ deployment: 'datacenter', oldCreatemeta: true, version });
    await assert.rejects(src.exportOptions({ project: 'GONE' }), (e) => e.kind === 'plugin' && !('tooOld' in e) && !/404|\/rest\//.test(e.message), version);
  }
});

test('exportOptions: on Cloud a create-metadata 404 means the project is gone or hidden, not "too old": it throws', async () => {
  const { src } = await site({ deployment: 'cloud', oldCreatemeta: true });
  await assert.rejects(src.exportOptions({ project: 'SHOP' }), (e) => e.kind === 'plugin' && !('tooOld' in e) && !/404|\/rest\//.test(e.message));
});

test('createTicket: wiki markup, labels, priority, the marker as the worca.export property, the URL and the fingerprint of what Jira stores', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, storeCrlf: deployment === 'cloud' });
    const r = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
    assert.deepEqual([r.key, r.url], ['SHOP-101', `${jira.base}/browse/SHOP-101`], deployment);
    const i = jira.issues.get('SHOP-101');
    assert.equal(i.fields.summary, 'Cancel an order before it ships');
    assert.equal(i.fields.description.replace(/ *\r\n/g, '\n').trimEnd(), markdownToWiki(DESC));
    assert.match(i.fields.description, /^h2\. Goal/);
    assert.deepEqual([i.fields.labels, i.fields.priority, i.fields.issuetype, i.fields.project], [['worca', 'worca-FEAT-7'], { id: '3' }, { id: '10001' }, { key: 'SHOP' }]);
    assert.deepEqual(i.properties['worca.export'], { marker: 'rexp_0123456789ab' });
    assert.equal(r.fingerprint, fingerprintOf(i.fields.description));
    assert.equal(r.fingerprint, fingerprintOf(markdownToWiki(DESC)), `${deployment}: CRLF and trailing spaces do not count`);
    const back = jira.requests.at(-1);
    assert.deepEqual([back.method, back.path, back.query.fields], ['GET', '/rest/api/2/issue/SHOP-101', 'description'], 'one read back');
  }
});

test('createTicket: criteria to a field go as a wiki list there; no priority means none sent', async () => {
  const { jira, src } = await site();
  await src.createTicket({ ticket: { ...TICKET, priority: null, criteria: { target: 'field', field: 'customfield_10070', items: ['R-po-1 Cancel while unpaid', 'R-po-2 Refund'] } } });
  const i = jira.issues.get('SHOP-101');
  assert.equal(i.fields.customfield_10070, '* R-po-1 Cancel while unpaid\n* R-po-2 Refund');
  assert.equal('priority' in i.fields, false);
});

test('createTicket: a site that refuses properties in the create gets the property in its own call', async () => {
  const { jira, src } = await site({ deployment: 'datacenter', refuseProperties: true });
  const r = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
  assert.equal(r.key, 'SHOP-101');
  assert.deepEqual(jira.issues.get('SHOP-101').properties['worca.export'], { marker: 'rexp_0123456789ab' });
  assert.deepEqual(jira.requests.filter((q) => q.method !== 'GET').map((q) => [q.method, q.path]), [
    ['POST', '/rest/api/2/issue'], ['POST', '/rest/api/2/issue'], ['PUT', '/rest/api/2/issue/SHOP-101/properties/worca.export']]);
  assert.equal(jira.issues.size, 1, 'one ticket');
});

test('once Jira made the issue or took the edit nothing throws (D10): a refused property PUT and a failed read-back still answer the key', async () => {
  const { jira, src } = await site({ deployment: 'datacenter', refuseProperties: true, refusePropertyPut: true });
  const r = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
  assert.deepEqual([r.key, r.url, jira.issues.size], ['SHOP-101', `${jira.base}/browse/SHOP-101`, 1], 'one issue and its key');
  assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal('worca.export' in jira.issues.get('SHOP-101').properties, false, 'the marker could not be stored; the host links the key anyway');
  const other = await site({ failReadBack: true });
  const made = await other.src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
  assert.deepEqual([made.key, made.fingerprint, other.jira.issues.size], ['SHOP-101', null, 1]);
  const upd = await other.src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, title: 'Cancel an order' } });
  assert.deepEqual([upd.key, upd.fingerprint, other.jira.issues.get('SHOP-101').fields.summary], ['SHOP-101', null, 'Cancel an order'],
    'a completed edit is not reported as a failure');
});

test('createTicket: a required custom field is a refusal naming it from create metadata; nothing is created', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, requiredField: { id: 'customfield_10050', name: 'Team' } });
    assert.deepEqual(await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } }),
      { refused: { field: 'Team', message: 'Jira needs a value for “Team” in SHOP.' } }, deployment);
    assert.equal(jira.issues.size, 0);
  }
});

test('a refused token throws kind auth (the host says "the API token was refused")', async () => {
  const { src } = await site({ refuseToken: true });
  await assert.rejects(src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } }), (e) => e.kind === 'auth');
  await assert.rejects(src.exportOptions({}), (e) => e.kind === 'auth');
});

test('a request Jira refuses without naming a field: "Jira refused the request: <its words>", never the HTTP status or the REST path (D11)', async () => {
  const { src } = await site({ fail: { method: 'POST', path: '/rest/api/2/issue/SHOP-101/comment', status: 403,
    body: { errorMessages: ['You do not have permission to comment on this issue.'], errors: {} } } });
  await src.createTicket({ ticket: TICKET });
  await assert.rejects(src.commentTicket({ key: 'SHOP-101', body: 'x' }),
    (e) => e.kind === 'plugin' && e.message === 'Jira refused the request: You do not have permission to comment on this issue.');
  const other = await site({ fail: { method: 'GET', path: '/rest/api/2/issue/createmeta/SHOP/issuetypes', status: 500, body: {} } });
  await assert.rejects(other.src.exportOptions({ project: 'SHOP' }),
    (e) => e.kind === 'plugin' && e.message === 'Jira refused the request: no reason given');
});

test('updateTicket: summary, description and fields rewritten, labels only added; a refused field; a deleted ticket is gone', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, refuseOnUpdate: null });
    const made = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
    jira.issues.get('SHOP-101').fields.labels.push('sprint-12');   // the team added a label in Jira
    const r = await src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, title: 'Cancel an order', description: `${DESC}\nMore.\n`, labels: ['web', 'worca-FEAT-7'] } });
    const i = jira.issues.get('SHOP-101');
    assert.deepEqual([r.key, i.fields.summary, i.fields.labels], ['SHOP-101', 'Cancel an order', ['worca', 'worca-FEAT-7', 'sprint-12', 'web']], deployment);
    const put = jira.requests.find((q) => q.method === 'PUT' && q.path === '/rest/api/2/issue/SHOP-101');
    assert.equal('labels' in put.body.fields, false, 'labels go in update.add, never in fields');
    assert.equal('project' in put.body.fields, false);
    assert.notEqual(r.fingerprint, made.fingerprint);
    assert.equal(r.fingerprint, fingerprintOf(i.fields.description));
    assert.deepEqual(await src.updateTicket({ key: 'SHOP-999', ticket: TICKET }), { gone: true });
  }
  const { src } = await site({ refuseOnUpdate: { id: 'customfield_10080', message: 'Sprint goal is too long.' } });
  await src.createTicket({ ticket: TICKET });
  assert.deepEqual(await src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, criteria: { target: 'field', field: 'customfield_10080', items: ['x'] } } }),
    { refused: { field: 'Sprint goal', message: 'Jira refused “Sprint goal”: Sprint goal is too long.' } });
});

test('updateTicket sends issuetype only when it changes: a site that refuses it in an edit still takes the update', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, refuseIssuetypeEdit: true });
    await src.createTicket({ ticket: TICKET });
    const r = await src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, title: 'Cancel an order' } });
    assert.deepEqual([r.key, jira.issues.get('SHOP-101').fields.summary], ['SHOP-101', 'Cancel an order'], deployment);
    const put = jira.requests.find((q) => q.method === 'PUT' && q.path === '/rest/api/2/issue/SHOP-101');
    assert.equal('issuetype' in put.body.fields, false, `${deployment}: the type did not change, so it is not sent`);
    assert.deepEqual((await src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, issueType: '10002' } })).refused.field, 'Issue Type',
      `${deployment}: a real change is still sent (and refused here)`);
  }
});

test('commentTicket: the comment as wiki markup; a deleted ticket is gone', async () => {
  const { jira, src } = await site();
  await src.createTicket({ ticket: TICKET });
  assert.deepEqual(await src.commentTicket({ key: 'SHOP-101', body: 'Updated in Worca since the last export (26 Oct)\n\nAdded R-po-6 Cancel [part] of it\n\nFrom Worca FEAT-7\n' }), { ok: true });
  assert.equal(jira.issues.get('SHOP-101').comments[0], 'Updated in Worca since the last export (26 Oct)\n\nAdded R-po-6 Cancel \\[part\\] of it\n\nFrom Worca FEAT-7');
  assert.deepEqual(await src.commentTicket({ key: 'SHOP-999', body: 'x' }), { gone: true });
});

test('ticketState: the same fingerprint as the create; another after an edit in Jira; a deleted ticket does not exist', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, storeCrlf: true });
    const made = await src.createTicket({ ticket: TICKET });
    assert.deepEqual(await src.ticketState({ key: 'SHOP-101' }), { exists: true, url: `${jira.base}/browse/SHOP-101`, fingerprint: made.fingerprint }, deployment);
    jira.issues.get('SHOP-101').fields.description += 'Edited in Jira.';
    assert.notEqual((await src.ticketState({ key: 'SHOP-101' })).fingerprint, made.fingerprint);
    assert.deepEqual(await src.ticketState({ key: 'SHOP-999' }), { exists: false });
  }
});

test('findTicket: by project and label, then the property; another install\'s marker is no match; the last line and labels come back', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment });
    await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_aaaaaaaaaaaa' } });   // another install, same label
    await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_bbbbbbbbbbbb' } });
    const hit = await src.findTicket({ project: 'SHOP', label: 'worca-FEAT-7', marker: 'rexp_bbbbbbbbbbbb' });
    assert.deepEqual([hit.key, hit.url, hit.marker, hit.labels, hit.lastLine], ['SHOP-102', `${jira.base}/browse/SHOP-102`, 'rexp_bbbbbbbbbbbb',
      ['worca', 'worca-FEAT-7'], 'From Worca FEAT-7 · exported 26 Oct 2026'], deployment);
    assert.equal(hit.fingerprint, fingerprintOf(jira.issues.get('SHOP-102').fields.description));
    assert.equal(await src.findTicket({ project: 'SHOP', label: 'worca-FEAT-7', marker: 'rexp_cccccccccccc' }), null);
    assert.equal(await src.findTicket({ project: 'OPS', label: 'worca-FEAT-7', marker: 'rexp_bbbbbbbbbbbb' }), null);
    const search = jira.requests.find((q) => q.path.startsWith('/rest/api/2/search'));
    assert.equal(search.path, deployment === 'cloud' ? '/rest/api/2/search/jql' : '/rest/api/2/search');
    assert.equal(search.query.jql, 'project = "SHOP" AND (labels = "worca-FEAT-7") ORDER BY created DESC');
    assert.equal(search.query.maxResults, '10');
  }
});

test('findTicket: the fingerprint and last line come from the issue itself, not from the search answer', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, staleSearch: true, storeCrlf: deployment === 'cloud' });
    const made = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_bbbbbbbbbbbb' } });
    const hit = await src.findTicket({ project: 'SHOP', label: 'worca-FEAT-7', marker: 'rexp_bbbbbbbbbbbb' });
    assert.equal(hit.fingerprint, made.fingerprint, `${deployment}: no false "edited in Jira" on the next Update`);
    assert.equal(hit.lastLine, 'From Worca FEAT-7 · exported 26 Oct 2026');
    const read = jira.requests.at(-1);
    assert.deepEqual([read.method, read.path, read.query.fields], ['GET', '/rest/api/2/issue/SHOP-101', 'description'], deployment);
  }
});

test('after the key is known a request that never answers times out: the key still comes back, the hang is logged (D10)', async () => {
  assert.equal(AFTER_KEY_TIMEOUT_MS, 15_000);
  const t0 = Date.now();
  const { jira, logs, src } = await site({ deployment: 'datacenter', refuseProperties: true, hangPropertyPut: true, afterKeyTimeoutMs: 150 });
  const r = await src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
  assert.deepEqual([r.key, r.url, jira.issues.size], ['SHOP-101', `${jira.base}/browse/SHOP-101`, 1], 'the host can save the link');
  assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(logs.some((l) => /^warn SHOP-101: could not store Worca's marker/.test(l)), logs.join('\n'));
  const slow = await site({ hangReadBack: true, afterKeyTimeoutMs: 150 });
  const made = await slow.src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } });
  assert.deepEqual([made.key, made.fingerprint], ['SHOP-101', null]);
  const upd = await slow.src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, title: 'Cancel an order' } });
  assert.deepEqual([upd.key, upd.fingerprint, slow.jira.issues.get('SHOP-101').fields.summary], ['SHOP-101', null, 'Cancel an order']);
  assert.ok(Date.now() - t0 < 10_000, 'well inside the host 60 s limit');
});

test('no token and no Authorization value in a log, a thrown message or an answer, on success and failure paths', async () => {
  const token = 'S3cr3t-T0ken-9f8e7d6c';
  const seen = [];
  const keep = async (p) => { try { seen.push(JSON.stringify(await p) ?? 'undefined'); } catch (e) { seen.push(`${e?.kind} ${e?.message} ${e?.stack}`); } };
  for (const deployment of BOTH) {
    const runs = [
      await site({ deployment, token }),
      await site({ deployment, token, refuseProperties: true, refusePropertyPut: true, failReadBack: true }),
      await site({ deployment, token, refuseToken: true }),
      await site({ deployment, token, requiredField: { id: 'customfield_10050', name: 'Team' } }),
      await site({ deployment, token, refuseOnUpdate: { id: 'summary', message: 'Summary is too long.' } }),
      await site({ deployment, token, fail: { method: 'POST', path: '/rest/api/2/issue/SHOP-101/comment', status: 403, body: { errorMessages: ['No.'] } } }),
      await site({ deployment, token, fail: { method: 'GET', path: '/rest/api/2/issue/createmeta/SHOP/issuetypes', status: 500, body: {} } }),
      await site({ deployment, token, refuseProperties: true, hangPropertyPut: true, afterKeyTimeoutMs: 100 }),
    ];
    for (const { src } of runs) {
      await keep(src.exportOptions({}));
      await keep(src.exportOptions({ project: 'SHOP', issueType: '10001' }));
      await keep(src.createTicket({ ticket: { ...TICKET, marker: 'rexp_0123456789ab' } }));
      await keep(src.updateTicket({ key: 'SHOP-101', ticket: { ...TICKET, title: 'Cancel an order' } }));
      await keep(src.updateTicket({ key: 'SHOP-999', ticket: TICKET }));
      await keep(src.commentTicket({ key: 'SHOP-101', body: 'x' }));
      await keep(src.ticketState({ key: 'SHOP-101' }));
      await keep(src.findTicket({ project: 'SHOP', label: 'worca-FEAT-7', marker: 'rexp_0123456789ab' }));
    }
    for (const { logs } of runs) seen.push(...logs);
    const header = runs[0].jira.requests.find((q) => q.path !== '/rest/api/2/serverInfo').auth;
    assert.ok(header && header.length > 12, `${deployment}: the requests did carry the token`);
    const text = seen.join('\n');
    for (const secret of [token, header, header.split(' ')[1]]) assert.equal(text.includes(secret), false, `${deployment}: a secret leaked`);
  }
  assert.ok(seen.some((x) => /^warn /.test(x)) && seen.some((x) => /^auth /.test(x)) && seen.some((x) => /Jira refused the request/.test(x)), 'the failure paths ran');
});

test('a rate limit and an unreachable site keep their kind through the export ops', async () => {
  const { src } = await site({ fail: { method: 'POST', path: '/rest/api/2/issue', status: 429, body: { errorMessages: ['Rate limit exceeded.'] } } });
  await assert.rejects(src.createTicket({ ticket: TICKET }), (e) => e.kind === 'rate-limit');
  const down = await site({ deployment: 'datacenter' });
  await down.jira.close();   // nothing listens there any more
  await assert.rejects(down.src.exportOptions({}), (e) => e.kind === 'network');
  await assert.rejects(down.src.createTicket({ ticket: TICKET }), (e) => e.kind === 'network');
  await assert.rejects(down.src.findTicket({ project: 'SHOP', label: 'worca-FEAT-7', marker: 'rexp_0123456789ab' }), (e) => e.kind === 'network');
});

test('fingerprintOf: CRLF, trailing spaces and outer blank lines never count; any other change does', () => {
  assert.equal(fingerprintOf('a  \r\nb\t\r\n\r\n'), fingerprintOf('a\nb'));
  assert.notEqual(fingerprintOf('a\nb'), fingerprintOf('a\nc'));
  assert.match(fingerprintOf(''), /^[0-9a-f]{64}$/);
});
