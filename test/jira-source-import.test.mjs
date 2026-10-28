// test/jira-source-import.test.mjs — jira-source's import ops against a fake Jira over real HTTP (plans/requirements-a61-design.md §5, D4,
// D7, D8, D15, D16): Cloud and Data Center, the project list, search by words and by a pasted key or link, 20 a page, the ticket with
// its description as Markdown, the criteria field, comments past the embedded page, restricted and app comments, names only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { fingerprintOf } from '../plugins/jira-source/connector/index.mjs';
import { htmlToMarkdown } from '../plugins/jira-source/connector/markup.mjs';
import { startFakeJira } from './helpers/fake-jira.mjs';

const open = [];
after(async () => { for (const j of open) await j.close(); });
async function site(o = {}) {
  const jira = await startFakeJira(o);
  open.push(jira);
  const cloud = (o.deployment || 'cloud') === 'cloud';
  const map = new Map();
  const ctx = { apiVersion: 5, profile: 'acme', log: () => {}, config: { baseUrl: jira.base, email: cloud ? 'ann@acme.test' : '', token: 'tok', transitionOnComplete: 'Done' },
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
  return { jira, src: createTaskSource(ctx) };
}
const BOTH = ['cloud', 'datacenter'];
const person = (name, id) => ({ displayName: name, accountId: id, accountType: 'atlassian', active: true, name: name.toLowerCase().replace(' ', '.'),
  emailAddress: `${name.toLowerCase().replace(' ', '.')}@example.test`, avatarUrls: { '48x48': 'https://avatars.test/x.png' } });
const ISSUE = (over = {}) => ({
  key: 'SHOP-124', project: 'SHOP', projectName: 'Shop web', summary: 'Partial cancel for multi-item orders',
  description: 'When an order has several items...\n\nh2. Acceptance criteria\n* Unpicked items can be cancelled.',
  rendered: '<p>When an order has several items, customers cannot cancel the rest.</p>'
    + '<p><span class="image-wrap"><img src="/rest/api/2/attachment/content/10041" alt="packing-slip.png" /></span></p>'
    + '<table class="confluenceTable"><tbody><tr><th>Item</th><th>State</th></tr><tr><td>Mug</td><td>Shipped</td></tr></tbody></table>'
    + '<p>Ask <a href="https://acme.test/secure/ViewProfile.jspa?accountId=5b10ac8d82e05b22cc7d4ef5" class="user-hover">Ann Example</a>.</p>'
    + '<h2>Acceptance criteria</h2><ul><li>Unpicked items can be cancelled.</li></ul>',
  type: { id: '10001', name: 'Story' }, status: 'In progress', priority: { id: '3', name: 'Medium' }, updated: '2026-10-25T12:00:00.000+0000',
  comments: [
    { id: '1', author: person('Ann Example', 'acc-ann'), created: '2026-10-21T12:00:00.000+0000', body: 'Picked per parcel.', rendered: '<p>Picked per parcel.</p>' },
    { id: '2', author: { displayName: 'Jira Automation', accountType: 'app', active: true }, created: '2026-10-23T12:00:00.000+0000', body: 'Status changed.',
      rendered: '<p>Status changed.</p>' },
    { id: '3', author: person('Bo Example', 'acc-bo'), created: '2026-10-24T12:00:00.000+0000', body: 'Internal.', rendered: '<p>Internal.</p>',
      visibility: { type: 'group', value: 'jira-staff' } },
    { id: '4', author: { displayName: 'Release Bot', active: false, name: 'releasebot' }, created: '2026-10-25T12:00:00.000+0000', body: 'Built.', rendered: '<p>Built.</p>' },
  ],
  attachments: [{ id: '10041', filename: 'packing-slip.png', mimeType: 'image/png', size: 12, created: '2026-10-21T09:00:00.000+0000' }],
  custom: { customfield_10070: { name: 'Acceptance Criteria', value: '* From the field\n* Second', rendered: '<ul><li>From the field</li><li>Second</li></ul>' } },
  ...over,
});
const OTHERS = [
  ISSUE({ key: 'SHOP-123', summary: 'Cancel an order before it ships', updated: '2026-10-26T12:00:00.000+0000', custom: {} }),
  ISSUE({ key: 'OPS-7', project: 'OPS', projectName: 'Operations', summary: 'Cancel a pick run', updated: '2026-10-20T12:00:00.000+0000', custom: {} }),
];

test("capabilities: import and export are on; write-back still follows the run's input", async () => {
  const { src } = await site();
  assert.deepEqual(src.capabilities({ inputs: { writeBack: 'yes' } }), { writeBack: true, incrementalSync: false, export: true, import: true });
});

test('importOptions: the projects as "SHOP — Shop web" on Cloud and Data Center', async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment });
    assert.deepEqual(await src.importOptions({}), { projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }] }, deployment);
  }
});

test('searchTickets: no words lists the project newest first; words search its text; Cloud at /search/jql, Data Center at /search; never a saved filter', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, seed: [ISSUE(), ...OTHERS] });
    const recent = await src.searchTickets({ project: 'SHOP' });
    assert.deepEqual(recent.tickets.map((t) => t.key), ['SHOP-123', 'SHOP-124'], deployment);
    assert.deepEqual(recent.tickets[1], { key: 'SHOP-124', title: 'Partial cancel for multi-item orders', url: `${jira.base}/browse/SHOP-124`, type: 'Story',
      status: 'In progress', updatedAt: '2026-10-25T12:00:00.000+0000' });
    assert.deepEqual((await src.searchTickets({ project: 'SHOP', search: 'partial' })).tickets.map((t) => t.key), ['SHOP-124']);
    const q = jira.requests.filter((r) => /\/search/.test(r.path));
    assert.equal(q[0].path, deployment === 'cloud' ? '/rest/api/2/search/jql' : '/rest/api/2/search');
    assert.equal(q[0].query.fields, 'summary,status,issuetype,updated');
    assert.equal(q[0].query.maxResults, '20');
    assert.ok(q.every((r) => !/assignee|currentUser/.test(r.query.jql)), 'the import never uses the JQL filter input');
  }
});

test('searchTickets: a pasted key or link finds the ticket in any project; one that is not there is no result (Data Center 403 too)', async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment, seed: [ISSUE(), ...OTHERS], forbid: ['SHOP-5'] });
    assert.deepEqual((await src.searchTickets({ project: 'SHOP', search: 'ops-7' })).tickets.map((t) => t.key), ['OPS-7'], deployment);
    assert.deepEqual((await src.searchTickets({ search: 'https://acme.test/browse/SHOP-123' })).tickets.map((t) => t.key), ['SHOP-123']);
    assert.deepEqual((await src.searchTickets({ search: 'SHOP-999' })).tickets, []);
    if (deployment === 'datacenter') assert.deepEqual((await src.searchTickets({ search: 'SHOP-5' })).tickets, []);
  }
});

test("searchTickets: 20 a page; the cursor is Cloud's nextPageToken or Data Center's startAt", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ISSUE({ key: `SHOP-${200 + i}`, summary: `Ticket ${i}`,
    updated: `2026-10-${String(1 + i).padStart(2, '0')}T12:00:00.000+0000`, custom: {} }));
  for (const deployment of BOTH) {
    const { src } = await site({ deployment, seed: many });
    const first = await src.searchTickets({ project: 'SHOP' });
    assert.equal(first.tickets.length, 20, deployment);
    assert.ok(first.cursor, deployment);
    const next = await src.searchTickets({ project: 'SHOP', cursor: first.cursor });
    assert.equal(next.tickets.length, 5, deployment);
    assert.equal(next.cursor, undefined, deployment);
  }
});

test('importTicket: the description as Markdown; criteria from the field named "Acceptance Criteria"; comments with names only; attachments; meta; fingerprint', async () => {
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, seed: [ISSUE()] });
    const t = await src.importTicket({ key: 'shop-124' });
    assert.equal(t.key, 'SHOP-124', deployment);
    assert.equal(t.url, `${jira.base}/browse/SHOP-124`);
    assert.equal(t.description, 'When an order has several items, customers cannot cancel the rest.\n\n(image: packing-slip.png)\n\n| Item | State |\n| Mug | Shipped |\n\n'
      + 'Ask Ann Example.\n\n## Acceptance criteria\n\n- Unpicked items can be cancelled.');
    assert.deepEqual(t.criteria, { field: { id: 'customfield_10070', name: 'Acceptance Criteria' }, items: ['From the field', 'Second'] });
    assert.deepEqual(t.comments.map((c) => [c.id, c.author, c.authorKind, c.body]),
      [['1', 'Ann Example', 'person', 'Picked per parcel.'], ['2', 'Jira Automation', 'app', 'Status changed.'], ['4', 'Release Bot', 'app', 'Built.']]);
    assert.deepEqual([t.commentsTotal, t.restrictedComments], [4, 1]);
    assert.deepEqual(t.attachments, [{ id: '10041', name: 'packing-slip.png', mime: 'image/png', bytes: 12, created: '2026-10-21T09:00:00.000+0000' }]);
    assert.deepEqual(t.meta, { project: 'SHOP', projectName: 'Shop web', type: { id: '10001', name: 'Story' }, status: 'In progress', priority: { id: '3', name: 'Medium' } });
    assert.equal(t.fingerprint, fingerprintOf(ISSUE().description));
    const json = JSON.stringify(t);
    for (const secret of ['acc-ann', 'acc-bo', '@example.test', 'avatars.test', '5b10ac8d82e05b22cc7d4ef5', 'tok"']) assert.ok(!json.includes(secret), `${deployment}: no ${secret}`);
    const read = jira.requests.find((r) => r.path === '/rest/api/2/issue/SHOP-124');
    assert.equal(read.query.fields, 'summary,description,issuetype,priority,status,project,attachment,comment,customfield_10070');
    assert.equal(read.query.expand, 'renderedFields,names');
  }
});

test("importTicket: the export setup's criteria field is read when given; without any criteria field, criteria are null", async () => {
  const { jira, src } = await site({ seed: [ISSUE({ custom: { customfield_10071: { name: 'Definition of Done', value: '* Done when shipped',
    rendered: '<ul><li>Done when shipped</li></ul>' } } })] });
  const t = await src.importTicket({ key: 'SHOP-124', criteriaField: 'customfield_10071' });
  assert.deepEqual(t.criteria, { field: { id: 'customfield_10071', name: 'Definition of Done' }, items: ['Done when shipped'] });
  assert.ok(!jira.requests.some((r) => r.path === '/rest/api/2/field'), 'a named field needs no field list');
  const bare = await site({ seed: [ISSUE({ custom: {} })] });
  assert.equal((await bare.src.importTicket({ key: 'SHOP-124' })).criteria, null);
});

test('importTicket: comments past the embedded page are read newest 50 first and answered oldest first', async () => {
  const comments = Array.from({ length: 60 }, (_, i) => ({ id: String(i + 1), author: person('Cy Example', 'acc-cy'),
    created: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T12:00:00.000+0000`, body: `Comment ${i + 1}`, rendered: `<p>Comment ${i + 1}</p>` }));
  for (const deployment of BOTH) {
    const { jira, src } = await site({ deployment, seed: [ISSUE({ comments, embedded: 5 })] });
    const t = await src.importTicket({ key: 'SHOP-124' });
    assert.equal(t.comments.length, 50, deployment);
    assert.deepEqual([t.comments[0].id, t.comments.at(-1).id, t.commentsTotal], ['11', '60', 60]);
    const page = jira.requests.find((r) => r.path === '/rest/api/2/issue/SHOP-124/comment');
    assert.deepEqual([page.query.orderBy, page.query.maxResults, page.query.expand], ['-created', '50', 'renderedBody']);
  }
});

test('importTicket (D8, D15): a site that renders nothing gives the wiki text as plain text; a mention is "someone", never its account id', async () => {
  for (const deployment of BOTH) {
    const wiki = ISSUE({ rendered: null, custom: {},
      description: 'Ask [~accountid:acc-ann] or [~bo.example]; see [the flow|https://docs.acme.test/flow] and [Cy|~accountid:acc-cy].',
      comments: [{ id: '1', author: person('Ann Example', 'acc-ann'), created: '2026-10-21T12:00:00.000+0000', body: 'Thanks [~accountid:acc-ann], done.' }] });
    const { src } = await site({ deployment, seed: [wiki] });
    const t = await src.importTicket({ key: 'SHOP-124' });
    assert.equal(t.description, 'Ask someone or someone; see the flow (https://docs.acme.test/flow) and Cy.', deployment);
    assert.equal(t.comments[0].body, 'Thanks someone, done.', 'a comment without renderedBody falls back to its wiki text');
    const json = JSON.stringify(t);
    for (const secret of ['acc-ann', 'acc-cy', 'bo.example']) assert.ok(!json.includes(secret), `${deployment}: no ${secret}`);
  }
});

test("importTicket: a missing ticket is gone on both; Data Center's 403 is gone too; a Cloud 403 throws Jira's words, never a status or path", async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment, seed: [ISSUE()] });
    assert.deepEqual(await src.importTicket({ key: 'SHOP-999' }), { gone: true }, deployment);
  }
  const dc = await site({ deployment: 'datacenter', seed: [ISSUE()], forbid: ['SHOP-124'] });
  assert.deepEqual(await dc.src.importTicket({ key: 'SHOP-124' }), { gone: true });
  const cloud = await site({ deployment: 'cloud', seed: [ISSUE()], forbid: ['SHOP-124'] });
  await assert.rejects(cloud.src.importTicket({ key: 'SHOP-124' }), (e) => e.kind === 'plugin' && /^Jira refused the request: /.test(e.message) && !/403|\/rest\//.test(e.message));
});

test('htmlToMarkdown (§5): a picture by its alt text, table rows as "| a | b |", people by name only, other links kept', () => {
  assert.equal(htmlToMarkdown('<p><span class="image-wrap"><img src="/rest/api/2/attachment/content/10041" alt="packing-slip.png" /></span></p>'), '(image: packing-slip.png)');
  assert.equal(htmlToMarkdown('<p>Before<img src="x.png"></p>'), 'Before');
  assert.equal(htmlToMarkdown('<table><tbody><tr><th>Item</th><th>State</th></tr><tr><td>Mug</td><td><b>Shipped</b></td></tr></tbody></table>'),
    '| Item | State |\n| Mug | Shipped |');
  assert.equal(htmlToMarkdown('<p>Ask <a href="https://acme.test/secure/ViewProfile.jspa?accountId=5b10" class="user-hover">Ann Example</a>, '
    + '<a href="/jira/people/5b11">Bo Example</a> or <a href="https://acme.test/people/5b12">Cy Example</a>.</p>'), 'Ask Ann Example, Bo Example or Cy Example.');
  assert.equal(htmlToMarkdown('<p>See <a href="https://docs.acme.test/refunds">refunds</a>.</p>'), 'See [refunds](https://docs.acme.test/refunds).');
});
