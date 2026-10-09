// test/ui-mcp-view.test.mjs — Settings › MCP servers (spec §7): hashes, set list order and warning
// dot, Used by × semantics, Team locks, Delete confirm, the read-only Servers view, Add server →
// Save and test; plus the booted app's deep links.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  parseMcpParam, mcpRoute, createMcpView, collectFieldInputs,
} from '../ui/public/mcp-view.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const NOW = Date.parse('2026-09-29T12:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();

const SETS = [
  { id: 'general', name: 'General', group: 'general', greyed: false, home: null, serverCount: 2, problem: false,
    usedBy: [{ key: 'shop-2b3c4d5e', name: 'shop' }], members: [{ serverId: 'plugin:acme-tools/jira', copy: 'jira', problem: null, test: 'ok' }] },
  { id: 'billing', name: 'Billing', group: 'set', greyed: false, home: null, serverCount: 2, problem: true,
    usedBy: [{ key: 'billing-1a2b3c4d', name: 'billing' }, { key: 'mobile-3c4d5e6f', name: 'mobile' }], members: [] },
  { id: 'shop', name: 'Shop', group: 'set', greyed: false, home: null, serverCount: 0, problem: false, usedBy: [], members: [] },
  { id: 'team-acme-platform-9333', name: 'Team · acme/platform', group: 'team', greyed: false, home: 'acme/platform', serverCount: 2,
    problem: false, usedBy: [{ key: 'billing-1a2b3c4d', name: 'billing' }], members: [] },
  { id: 'team-old-home-1234', name: 'Team · old/home', group: 'team', greyed: true, home: 'old/home', serverCount: 0, problem: false, usedBy: [], members: [] },
];
const field = (key, label, extra = {}) => ({ key, label, secret: false, oauth: false, required: true, ...extra });
const member = (over) => ({ serverId: 'plugin:acme-tools/sentry', base: 'sentry', copy: 'sentry_billing', provisional: false, source: 'plugin',
  sourceLabel: 'acme-tools', type: 'http', description: 'Sentry issues', enabled: true, fields: [], reason: null, problem: null,
  test: null, tooLong: null, ...over });
const SET_VIEWS = {
  general: { set: { id: 'general', name: 'General', group: 'general', greyed: false, home: null, usedBy: SETS[0].usedBy }, members: [] },
  billing: { set: { id: 'billing', name: 'Billing', group: 'set', greyed: false, home: null, usedBy: SETS[1].usedBy }, members: [
    member({ fields: [field('org', 'Organization', { value: 'acme-billing' }),
      field('token', 'Sentry token', { secret: true, oauth: true, state: { set: true, updatedAt: ago(31), old: true } })],
    test: { at: ago(3), ok: true, tools: 18, error: null, stale: false } }),
    member({ serverId: 'plugin:acme-tools/jira', base: 'jira', copy: 'jira_billing', type: 'stdio',
      fields: [field('token', 'API token', { secret: true, state: { set: false } })], reason: 'missing:token', problem: 'API token not set' }),
  ] },
  'team-acme-platform-9333': { set: { id: 'team-acme-platform-9333', name: 'Team · acme/platform', group: 'team', greyed: false, home: 'acme/platform',
    usedBy: SETS[3].usedBy }, members: [
    member({ serverId: 'policy:acme/platform/github', base: 'github', copy: 'github_team-platfor', sourceLabel: 'Team · acme/platform', type: 'stdio',
      fields: [field('host', 'Host', { required: false, value: 'mine.acme.io' }),
        field('token', 'token', { secret: true, state: { set: true, updatedAt: ago(1), env: 'MCP_GH', old: false } })],
      team: { consented: true, suggests: [{ key: 'host', value: 'github.acme.io' }] } }),
    member({ copy: 'sentry_team-platfor', enabled: false, reason: 'needs-consent', team: { consented: false, suggests: [] } }),
  ] },
  'team-old-home-1234': { set: { id: 'team-old-home-1234', name: 'Team · old/home', group: 'team', greyed: true, home: 'old/home', usedBy: [] }, members: [] },
};
const SERVERS = [
  { id: 'manual:postgres-ro', base: 'postgres-ro', provisional: false, source: 'manual', sourceLabel: 'Manual', type: 'stdio', description: 'Replica',
    fields: [field('database', 'Database URL'), field('password', 'Password', { secret: true })], inSets: [{ id: 'billing', name: 'Billing' }], tools: 4,
    pluginDisabled: false, inClaudeConfig: true, retired: null, def: { type: 'stdio', command: 'npx', args: [], env: {}, fields: [], description: 'Replica' } },
  { id: 'plugin:acme-tools/sentry', base: 'sentry', provisional: true, source: 'plugin', sourceLabel: 'acme-tools', type: 'http', description: 'Sentry',
    fields: [field('org', 'Organization', { default: 'acme' }), field('token', 'Sentry token', { secret: true, oauth: true })],
    inSets: [{ id: 'billing', name: 'Billing' }, { id: 'team-acme-platform-9333', name: 'Team · acme/platform' }], tools: null,
    pluginDisabled: true, inClaudeConfig: false, retired: null },
  { id: 'policy:acme/platform/datadog', base: 'datadog', provisional: false, source: 'policy', sourceLabel: 'Team · acme/platform', type: 'http',
    description: 'Datadog', fields: [], inSets: [], tools: null, pluginDisabled: false, inClaudeConfig: false, retired: 'acme/platform' },
];

function mount({ assignments = {}, over = {}, answer = async () => true } = {}) {
  const calls = [];
  const nav = [];
  const confirms = [];
  const modal = { opened: null, open(title, body, actions) { this.opened = { title, body, actions }; }, close() { this.opened = null; } };
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    const key = `${method} ${path}`;
    if (Object.hasOwn(over, key)) return over[key];
    if (key === 'GET /api/mcp/sets') return { ok: true, status: 200, data: { newer: false, sets: SETS } };
    if (method === 'GET' && path.startsWith('/api/mcp/sets/')) {
      const v = SET_VIEWS[decodeURIComponent(path.slice(14))];
      return v ? { ok: true, status: 200, data: v } : { ok: false, status: 404, data: { error: 'set not found' } };
    }
    if (key === 'GET /api/mcp/servers') return { ok: true, status: 200, data: { servers: SERVERS } };
    if (method === 'GET' && path.startsWith('/api/mcp/projects/')) return { ok: true, status: 200, data: assignments[decodeURIComponent(path.slice(18))] };
    if (key === 'GET /api/projects') return { ok: true, status: 200, data: { projects: [{ key: 'billing-1a2b3c4d', name: 'billing' }, { key: 'mobile-3c4d5e6f', name: 'mobile' }] } };
    return { ok: true, status: 200, data: { ok: true, id: 'new-set' } };
  };
  const host = doc.createElement('section');
  doc.body.replaceChildren(host);
  const ctl = createMcpView({ host, api, navigate: (h) => nav.push(h), confirm: async (o) => { confirms.push(o); return answer(o); }, modal, doc, now: () => NOW });
  return { host, ctl, calls, nav, confirms, modal, writes: () => calls.filter(([m]) => m !== 'GET') };
}
const click = (el) => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
const change = (el) => el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

test('set list: General first, user sets, Team sets; the warning dot; Used by lines; a greyed Team set', async () => {
  const { host, ctl } = mount();
  await ctl.show('');
  const rows = [...host.querySelectorAll('.mcp-setrow')];
  assert.deepEqual(rows.map((r) => r.dataset.set), SETS.map((s) => s.id));
  assert.deepEqual(rows.map((r) => !!r.querySelector('.mcp-dot')), [false, true, false, false, false]);
  assert.match(rows[0].textContent, /Built in.*2 servers · Ask Worca · 1 project/);
  assert.match(rows[1].textContent, /2 servers · billing/);
  assert.match(rows[4].textContent, /no project here follows old\/home/);
  assert.ok(rows[4].classList.contains('greyed'));
  assert.ok(rows[0].classList.contains('on'));
});

test('a user set: fields, secrets as set-ness with OAuth age, the problem line; edits PUT the membership', async () => {
  const { host, ctl, writes } = mount();
  await ctl.show('sets/billing');
  const [sentry, jira] = host.querySelectorAll('.mcp-member');
  assert.match(sentry.textContent, /sentry_billing.*acme-tools.*http/);
  assert.equal(sentry.querySelector('.badge.amber').textContent, 'set · updated 2026-08-29', 'an OAuth token ≥30 days old is amber');
  assert.equal(sentry.querySelector('.mcp-state').textContent, '18 tools · tested 3d ago');
  assert.equal(jira.querySelector('.mcp-state').textContent, 'API token not set · skipped until set');
  assert.ok(jira.querySelector('.mcp-state').classList.contains('err'));
  const inp = sentry.querySelector('[data-field="org"]');
  inp.value = 'acme-eu';
  change(inp);
  const sw = sentry.querySelector('[data-toggle]');
  sw.checked = false;
  change(sw);
  await settle();
  assert.deepEqual(writes(), [
    ['PUT', '/api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fsentry', { values: { org: 'acme-eu' } }],
    ['PUT', '/api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fsentry', { enabled: false }],
  ]);
  assert.ok(host.querySelector('[data-act="rename"]') && host.querySelector('[data-act="delete"]') && host.querySelector('[data-remove]'));
});

test('Used by ×: on a user set it removes the set from that project; on General it turns Include General off', async () => {
  const assignments = { 'billing-1a2b3c4d': { sets: [{ id: 'billing', name: 'Billing' }, { id: 'shop', name: 'Shop' }], includeGeneral: true, team: null },
    'shop-2b3c4d5e': { sets: [{ id: 'shop', name: 'Shop' }], includeGeneral: true, team: null } };
  let m = mount({ assignments });
  await m.ctl.show('sets/billing');
  click(m.host.querySelector('[data-unassign="billing-1a2b3c4d"]'));
  await settle();
  assert.deepEqual(m.writes(), [['PUT', '/api/mcp/projects/billing-1a2b3c4d', { sets: ['shop'], includeGeneral: true }]]);
  m = mount({ assignments });
  await m.ctl.show('');
  assert.equal(m.host.querySelector('[data-unassign="shop-2b3c4d5e"]').title, 'Turn Include General off for shop');
  click(m.host.querySelector('[data-unassign="shop-2b3c4d5e"]'));
  await settle();
  assert.deepEqual(m.writes(), [['PUT', '/api/mcp/projects/shop-2b3c4d5e', { sets: ['shop'], includeGeneral: false }]]);
});

test('Team sets are read-only (no rename/delete/add/remove, disabled never-consented switch, Use team value); a greyed Team set offers only Forget via the team route', async () => {
  await checkRows([
    { name: 'a Team set: read-only Used by, no rename/delete/add/remove; never-consented switch disabled; "Use team value"', run: async () => {
      const { host, ctl, writes, modal, nav } = mount();
      await ctl.show('sets/team-acme-platform-9333');
      assert.equal(host.querySelector('[data-unassign]'), null, 'Team chips are read-only');
      for (const sel of ['[data-act="rename"]', '[data-act="delete"]', '[data-act="add-project"]', '[data-act="add-member"]', '[data-remove]']) {
        assert.equal(host.querySelector(sel), null, sel);
      }
      assert.ok(host.querySelector('[data-act="duplicate"]'), 'a Team set can be duplicated into a user set');
      const [gh, sentry] = host.querySelectorAll('.mcp-member');
      assert.equal(sentry.querySelector('[data-toggle]').disabled, true);
      assert.equal(sentry.querySelector('[data-test]').disabled, true, 'nothing runs before consent, not even Test');
      assert.match(sentry.textContent, /Turn on in the team checklist/);
      assert.equal(gh.querySelector('[data-toggle]').disabled, false);
      assert.match(gh.querySelector('.mcp-secret').textContent, /^\$MCP_GH/, 'an $env secret shows its variable');
      assert.equal(gh.querySelector('.mcp-secret .badge.amber'), null, 'a secret updated a day ago is not amber');
      assert.match(gh.querySelector('.mcp-suggest').textContent, /Team suggests github\.acme\.io · Use team value/);
      click(gh.querySelector('[data-use-team="host"]'));
      await settle();
      assert.deepEqual(writes(), [['PUT', '/api/mcp/sets/team-acme-platform-9333/members/policy%3Aacme%2Fplatform%2Fgithub', { values: { host: 'github.acme.io' } }]]);
      click(host.querySelector('[data-act="duplicate"]'));
      await settle();
      assert.equal(modal.opened.body.querySelector('input').value, 'acme/platform copy', 'P1 reserves "Team · " names: the copy is named after the home');
      modal.opened.actions.find(([label]) => label === 'Save')[2]();
      await settle();
      assert.deepEqual(writes().at(-1), ['POST', '/api/mcp/sets/team-acme-platform-9333/duplicate', { name: 'acme/platform copy' }]);
      assert.equal(nav.at(-1), 'connectors/sets/new-set');
    } },
    { name: 'a greyed Team set offers only Forget, which calls the team forget route', run: async () => {
      const { host, ctl, writes, nav } = mount();
      await ctl.show('sets/team-old-home-1234');
      assert.deepEqual([...host.querySelectorAll('.mcp-set [data-act]')].map((b) => b.dataset.act), ['forget']);
      click(host.querySelector('[data-act="forget"]'));
      await settle();
      assert.deepEqual(writes(), [['POST', '/api/mcp/teams/old%2Fhome/forget', {}]]);
      assert.deepEqual(nav, ['connectors']);
    } },
  ]);
});

test('Delete: the confirm lists the projects using the set and flags those left with no sets (a Team set counts)', async () => {
  const assignments = { 'billing-1a2b3c4d': { sets: [{ id: 'billing', name: 'Billing' }], includeGeneral: false, team: null },
    'mobile-3c4d5e6f': { sets: [{ id: 'billing', name: 'Billing' }], includeGeneral: false, team: { home: 'acme/platform' } } };
  const { host, ctl, confirms, writes } = mount({ assignments });
  await ctl.show('sets/billing');
  click(host.querySelector('[data-act="delete"]'));
  await settle();
  assert.match(confirms[0].message, /Used by billing, mobile\./);
  assert.match(confirms[0].message, /billing will have no MCP servers in runs\./);
  assert.deepEqual(writes(), [['DELETE', '/api/mcp/sets/billing', undefined]]);
});

test('Test runs the membership and repaints; Add server disables members already in the set, then Save and test', async () => {
  const { host, ctl, calls, modal } = mount({ over: {
    'POST /api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fjira/test': { ok: false, status: 409, data: { error: 'plugin disabled' } } } });
  await ctl.show('sets/billing');
  click(host.querySelector('[data-test="plugin:acme-tools/jira"]'));
  assert.equal(host.querySelector('[data-server="plugin:acme-tools/jira"] .mcp-state').textContent, 'testing…');
  const at = calls.length;
  await settle();
  assert.ok(calls.some(([m, p]) => m === 'POST' && p === '/api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fjira/test'));
  assert.ok(calls.slice(at).some(([m, p]) => m === 'GET' && p === '/api/mcp/sets/billing'), 'repaints from the server after the Test');
  assert.equal(host.querySelector('.form-msg.err').textContent, 'plugin disabled', 'a refused Test says why');
  click(host.querySelector('[data-act="add-member"]'));
  await settle();
  const sel = modal.opened.body.querySelector('select');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.disabled]),
    [['manual:postgres-ro', false], ['plugin:acme-tools/sentry', true], ['policy:acme/platform/datadog', false]]);
  modal.opened.body.querySelector('[data-input="database"]').value = 'postgresql://ro@db/b';
  modal.opened.body.querySelector('[data-input="password"]').value = 'pw-12345678';
  modal.opened.actions.find(([label]) => label === 'Save and test')[2]();
  await settle();
  const w = calls.filter(([m]) => m !== 'GET').slice(-2);
  assert.deepEqual(w, [
    ['PUT', '/api/mcp/sets/billing/members/manual%3Apostgres-ro', { enabled: true, values: { database: 'postgresql://ro@db/b' }, secrets: { password: 'pw-12345678' } }],
    ['POST', '/api/mcp/sets/billing/members/manual%3Apostgres-ro/test', undefined],
  ]);
});

test('a server that vanished meanwhile: the members PUT 404 "server not found" shows — on the page for a card, inside the modal for Add server', async () => {
  const gone = { ok: false, status: 404, data: { error: 'server not found' } };
  const { host, ctl, modal } = mount({ over: {
    'PUT /api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fsentry': gone,
    'PUT /api/mcp/sets/billing/members/manual%3Apostgres-ro': gone } });
  await ctl.show('sets/billing');
  const sw = host.querySelector('[data-toggle="plugin:acme-tools/sentry"]');
  sw.checked = false;
  change(sw);
  await settle();
  assert.equal(host.querySelector('.form-msg').textContent, 'server not found');
  assert.ok(host.querySelector('.form-msg').classList.contains('err'));
  assert.equal(sw.checked, true, 'the switch goes back');
  click(host.querySelector('[data-act="add-member"]'));
  await settle();
  await modal.opened.actions.find(([label]) => label === 'Save and test')[2]();
  await settle();
  assert.ok(modal.opened, 'the modal stays open');
  assert.equal(modal.opened.body.querySelector('.form-msg.err').textContent, 'server not found');
});

test('switching sets: the cards on screen write to their own set until the next set paints; a slower earlier load never paints', async () => {
  let release;
  const shop = { ok: true, status: 200, data: { set: { id: 'shop', name: 'Shop', group: 'set', greyed: false, home: null, usedBy: [] }, members: [] } };
  const m = mount({ over: { 'GET /api/mcp/sets/shop': new Promise((r) => { release = r; }) } });
  await m.ctl.show('sets/billing');
  const next = m.ctl.show('sets/shop');
  await settle();
  const sw = m.host.querySelector('[data-toggle="plugin:acme-tools/sentry"]');
  sw.checked = false;
  change(sw);
  await settle();
  assert.deepEqual(m.writes(), [['PUT', '/api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fsentry', { enabled: false }]]);
  release(shop);
  await next;
  await settle();
  assert.equal(m.host.querySelector('.mcp-set h2').textContent, 'Shop');
  let late;
  const n = mount({ over: { 'GET /api/mcp/sets/billing': new Promise((r) => { late = r; }) } });
  const first = n.ctl.show('sets/billing');
  await n.ctl.show('');
  late({ ok: true, status: 200, data: SET_VIEWS.billing });
  await first;
  assert.equal(n.host.querySelector('.mcp-set h2').textContent, 'General');
});

test('a prompt or confirm answered after Back/Forward moved the page to another set still acts on the set it was opened on', async () => {
  let answer;
  let assignment;
  const m = mount({ answer: () => new Promise((r) => { answer = r; }),
    over: { 'GET /api/mcp/projects/billing-1a2b3c4d': new Promise((r) => { assignment = r; }) } });
  await m.ctl.show('sets/billing');
  click(m.host.querySelector('[data-remove="plugin:acme-tools/sentry"]'));
  await settle();
  await m.ctl.show('');                                  // General paints while the confirm is up
  answer(true);
  await settle();
  await m.ctl.show('sets/billing');
  click(m.host.querySelector('[data-act="rename"]'));
  await settle();
  await m.ctl.show('');
  m.modal.opened.body.querySelector('input').value = 'Invoices';
  m.modal.opened.actions.find(([label]) => label === 'Save')[2]();
  await settle();
  await m.ctl.show('sets/billing');
  click(m.host.querySelector('[data-unassign="billing-1a2b3c4d"]'));
  await settle();
  await m.ctl.show('');
  assignment({ ok: true, status: 200, data: { sets: [{ id: 'billing', name: 'Billing' }, { id: 'shop', name: 'Shop' }], includeGeneral: true, team: null } });
  await settle();
  assert.deepEqual(m.writes(), [
    ['DELETE', '/api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fsentry', undefined],
    ['PUT', '/api/mcp/sets/billing', { name: 'Invoices' }],
    ['PUT', '/api/mcp/projects/billing-1a2b3c4d', { sets: ['shop'], includeGeneral: true }],
  ]);
});

test('a save repaints under the user: the input being typed in keeps its text, caret and focus', async () => {
  const { host, ctl } = mount();
  await ctl.show('sets/billing');
  const org = host.querySelector('[data-field="org"]');
  org.focus();
  org.value = 'acme-eu';
  change(org);                                  // Enter: saved, and the focus stays in the field
  org.value = 'acme-eu-2';                      // the user types on while the save lands
  await settle();
  const now = host.querySelector('[data-field="org"]');
  assert.notEqual(now, org, 'the pane was repainted');
  assert.equal(doc.activeElement, now);
  assert.equal(now.value, 'acme-eu-2');
});

test('secret inputs: an empty value keeps the stored secret; an MCP_ variable wins over a typed value', () => {
  const root = doc.createElement('div');
  root.innerHTML = '<input data-input="a" data-secret="1" value=""><input data-env="a" value="">'
    + '<input data-input="b" data-secret="1" value="typed"><input data-env="b" value="MCP_B">'
    + '<input data-input="c" data-secret="" value=" v ">';
  assert.deepEqual(collectFieldInputs(root), { values: { c: 'v' }, secrets: { b: { $env: 'MCP_B' } } });
});

test('Servers view is read-only with badges/In sets/Add to set; Remove on a manual server names the sets it leaves', async () => {
  await checkRows([
    { name: 'the Servers view is read-only: badges, In sets links, Add to set everywhere, Edit/Remove on manual rows, Remove on retired ones', run: async () => {
      const { host, ctl } = mount();
      await ctl.show('servers');
      assert.equal(host.querySelector('.mcp-servers input, .mcp-servers [data-test]'), null, 'no switches, values or Test');
      const rows = [...host.querySelectorAll('.mcp-server-row')];
      const acts = rows.map((r) => [...r.querySelectorAll('.pl-actions button')].map((b) => b.textContent));
      assert.deepEqual(acts, [['Add to set', 'Edit definition', 'Remove'], ['Add to set'], ['Add to set', 'Remove']]);
      assert.match(rows[0].textContent, /also in your Claude Code config/);
      assert.match(rows[1].textContent, /name provisional.*plugin disabled/);
      assert.match(rows[2].textContent, /no longer required by acme\/platform/);
      assert.deepEqual([...rows[1].querySelectorAll('a.chip')].map((a) => a.getAttribute('href')),
        ['#connectors/sets/billing', '#connectors/sets/team-acme-platform-9333']);
      assert.equal(host.querySelector('[data-act="add-server"]').textContent, 'Add MCP server');
    } },
    { name: 'Remove on a manual server names the sets it leaves', run: async () => {
      const { host, ctl, confirms, writes } = mount();
      await ctl.show('servers');
      click(host.querySelector('[data-remove-server="manual:postgres-ro"]'));
      await settle();
      assert.match(confirms[0].message, /It leaves Billing\./);
      assert.deepEqual(writes(), [['DELETE', '/api/mcp/servers/manual%3Apostgres-ro', undefined]]);
    } },
  ]);
});

test('Add MCP server posts the name with the definition, then offers Add to set; Edit definition PUTs it; a refusal shows in the modal', async () => {
  const m = mount({ over: { 'PUT /api/mcp/servers/manual%3Apostgres-ro': { ok: false, status: 400, data: { error: 'command is required' } } } });
  const sent = () => m.calls.filter(([method, p]) => method !== 'GET' && !p.startsWith('/api/mcp/servers/validate'));
  await m.ctl.show('servers');
  click(m.host.querySelector('[data-act="add-server"]'));
  const type = (sel, v) => { const i = m.modal.opened.body.querySelector(sel); i.value = v; i.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); };
  type('[data-def="name"]', 'pg');
  type('[data-def="command"]', 'npx');
  await m.modal.opened.actions.find(([label]) => label === 'Save and add to set')[2]();
  await settle();
  assert.deepEqual(sent(), [['POST', '/api/mcp/servers', { name: 'pg', type: 'stdio', fields: [], description: '', command: 'npx', args: [], env: {} }]]);
  assert.equal(m.modal.opened.title, 'Add server to a set', 'Save and add to set opens the set picker');
  click(m.host.querySelector('[data-edit="manual:postgres-ro"]'));
  await m.modal.opened.actions.find(([label]) => label === 'Save')[2]();
  await settle();
  assert.deepEqual(sent().at(-1), ['PUT', '/api/mcp/servers/manual%3Apostgres-ro', SERVERS[0].def]);
  assert.equal(m.modal.opened.body.querySelector('.form-msg.err').textContent, 'command is required', 'the refusal shows inside the modal');
  click(m.host.querySelector('[data-add-to="plugin:acme-tools/sentry"]'));
  await settle();
  assert.deepEqual([...m.modal.opened.body.querySelectorAll('option')].map((o) => [o.value, o.disabled]),
    [['general', false], ['billing', true], ['shop', false]], 'Add to set: General and user sets, never a Team set; a set it is in is disabled');
});

test('Replace and Add project write from their modal: a refusal shows there; Add project adds this set to the picked project', async () => {
  const refused = { ok: false, status: 400, data: { error: 'refused here' } };
  const m = mount({ assignments: { 'shop-2b3c4d5e': { sets: [{ id: 'shop', name: 'Shop' }], includeGeneral: true, team: null } }, over: {
    'PUT /api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fsentry': refused, 'PUT /api/mcp/projects/shop-2b3c4d5e': refused,
    'GET /api/projects': { ok: true, status: 200, data: { projects: [{ key: 'billing-1a2b3c4d', name: 'billing' }, { key: 'shop-2b3c4d5e', name: 'shop' }] } } } });
  await m.ctl.show('sets/billing');
  click(m.host.querySelector('.mcp-member [data-secret="token"][data-server="plugin:acme-tools/sentry"]'));
  m.modal.opened.body.querySelector('[data-input="token"]').value = 'tok-12345678';
  await m.modal.opened.actions.find(([label]) => label === 'Save')[2]();
  assert.equal(m.modal.opened.body.querySelector('.form-msg.err').textContent, 'refused here');
  click(m.host.querySelector('[data-act="add-project"]'));
  await settle();
  assert.deepEqual([...m.modal.opened.body.querySelectorAll('option')].map((o) => o.value), ['shop-2b3c4d5e'], 'a project already using the set is not offered');
  await m.modal.opened.actions.find(([label]) => label === 'Add')[2]();
  assert.equal(m.modal.opened.body.querySelector('.form-msg.err').textContent, 'refused here');
  assert.deepEqual(m.writes().at(-1), ['PUT', '/api/mcp/projects/shop-2b3c4d5e', { sets: ['shop', 'billing'], includeGeneral: true }]);
});

test('a malformed %-escape in the set hash never throws out of show(): it reads as typed and the set GET refuses it', async () => {
  assert.deepEqual(parseMcpParam('sets/%E0%A4%A'), { view: 'sets', setId: '%E0%A4%A' });
  const { host, ctl, calls } = mount();
  await ctl.show('sets/%E0%A4%A');
  assert.ok(calls.some(([m, p]) => m === 'GET' && p === '/api/mcp/sets/%25E0%25A4%25A'));
  assert.equal(host.querySelector('.form-msg.err').textContent, 'set not found');
});

test('a value a repaint restored still saves when the user leaves the field; a change and its focusout save once', async () => {
  const { host, ctl, writes } = mount();
  await ctl.show('sets/billing');
  const org = host.querySelector('[data-field="org"]');
  org.dispatchEvent(new doc.defaultView.FocusEvent('focusout', { bubbles: true }));
  await settle();
  assert.deepEqual(writes(), [], 'leaving a field that holds what the set holds saves nothing');
  org.focus();
  org.value = 'acme-eu';                        // typed while another save's repaint was on its way
  await ctl.show('sets/billing');               // that repaint keeps the text: to the browser it is no change any more
  const again = host.querySelector('[data-field="org"]');
  assert.notEqual(again, org, 'the pane was repainted');
  assert.deepEqual([again.value, doc.activeElement === again], ['acme-eu', true]);
  again.dispatchEvent(new doc.defaultView.FocusEvent('focusout', { bubbles: true }));
  await settle();
  const put = (org) => ['PUT', '/api/mcp/sets/billing/members/plugin%3Aacme-tools%2Fsentry', { values: { org } }];
  assert.deepEqual(writes(), [put('acme-eu')], 'leaving the field saves the restored text');
  const f = host.querySelector('[data-field="org"]');
  f.value = 'acme-us';
  change(f);
  f.dispatchEvent(new doc.defaultView.FocusEvent('focusout', { bubbles: true }));
  await settle();
  assert.deepEqual(writes(), [put('acme-eu'), put('acme-us')], 'a change and the focusout after it save once');
  const bad = mount({ over: { [`PUT ${put('').at(1)}`]: { ok: false, status: 404, data: { error: 'server not found' } } } });
  await bad.ctl.show('sets/billing');
  const g = bad.host.querySelector('[data-field="org"]');
  g.value = 'acme-x';
  change(g);
  await settle();
  g.dispatchEvent(new doc.defaultView.FocusEvent('focusout', { bubbles: true }));
  await settle();
  assert.equal(bad.writes().length, 2, 'a refused save is tried again when the user leaves the field');
});

// ── the booted app ───────────────────────────────────────────────────────────
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
class WSStub { constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; } send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); } _open() { (this._l.open || []).forEach((fn) => fn({})); } }
async function boot(url) {
  const dom = trackDom(new JSDOM(html, { url }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  const calls = [];
  window.fetch = (u, opts = {}) => {
    const s = String(u);
    calls.push(`${opts.method || 'GET'} ${s}`);
    if (s.startsWith('/api/mcp/sets/')) return Promise.resolve({ ok: true, status: 200, json: async () => SET_VIEWS[decodeURIComponent(s.slice(14))] || SET_VIEWS.general });
    if (s === '/api/mcp/sets') return Promise.resolve({ ok: true, status: 200, json: async () => ({ newer: false, sets: SETS }) });
    if (s === '/api/mcp/servers') return Promise.resolve({ ok: true, status: 200, json: async () => ({ servers: SERVERS }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: 0, pipelines: 0, workspaces: 0, projects_list: [], guardrails: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  if (WSStub.last) WSStub.last._open();
  return { window, calls };
}
const go = async (window, hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };

test('the Connectors page: its hashes (#connectors General, /sets/<id>, /servers), deep links, the old #settings/mcp addresses and its leave-guard', async () => {
  await checkRows([
    { name: 'hashes: #connectors = General, #connectors/sets/<id>, #connectors/servers', run: () => {
      assert.deepEqual(parseMcpParam(''), { view: 'sets', setId: 'general' });
      assert.deepEqual(parseMcpParam('sets/billing'), { view: 'sets', setId: 'billing' });
      assert.deepEqual(parseMcpParam('servers'), { view: 'servers', setId: null });
      assert.equal(mcpRoute('general'), 'connectors');
      assert.equal(mcpRoute('billing'), 'connectors/sets/billing');
      assert.equal(mcpRoute(null), 'connectors/servers');
    } },
    { name: 'deep links land on the Connectors page: a set, then the Servers view; the page is titled Connectors, its views keep their names', run: async () => {
      const { window, calls } = await boot('http://localhost:4319/');
      await go(window, 'connectors/sets/billing');
      const page = window.document.querySelector('.view[data-view="connectors"]');
      assert.equal(page.classList.contains('hidden'), false);
      assert.equal(window.document.querySelector('.view[data-view="settings"]').classList.contains('hidden'), true);
      assert.ok(calls.includes('GET /api/mcp/sets/billing'));
      assert.equal(window.location.hash, '#connectors/sets/billing');
      assert.ok(page.querySelector('.mcp-setrow[data-set="billing"].on'));
      assert.equal(page.querySelector('.topbar h1'), null, 'the top bar names the page');
      assert.equal(window.document.getElementById('topnav-title').textContent, 'Connectors');
      assert.deepEqual([...page.querySelectorAll('.topbar .seg button')].map((b) => b.textContent), ['Sets', 'Servers', 'Skills']);
      assert.equal(window.document.querySelector('#settings-tabs button[data-tab="mcp"]'), null, 'Settings has no Sets tab');
      await go(window, 'connectors/servers');
      assert.ok(calls.includes('GET /api/mcp/servers'));
      assert.equal(page.querySelectorAll('.mcp-server-row').length, 3);
      assert.equal(page.querySelector('.topbar h1'), null, 'a repaint brings no title back');
      assert.ok(page.querySelector('.topbar .sub') && page.querySelector('.topbar .seg'), 'and no empty bar: the sub line and the segments stay');
    } },
    { name: 'an old #settings/mcp/sets/<id> link opens that set on the Connectors page, replacing the entry', run: async () => {
      const { window, calls } = await boot('http://localhost:4319/');
      const entries = window.history.length;
      await go(window, 'settings/mcp/sets/billing');
      assert.equal(window.location.hash, '#connectors/sets/billing');
      assert.equal(window.history.length, entries + 1);
      assert.ok(calls.includes('GET /api/mcp/sets/billing'));
      assert.ok(window.document.querySelector('.view[data-view="connectors"] .mcp-setrow[data-set="billing"].on'));
    } },
    { name: 'leaving Connectors closes a dialog it opened (#plugin-modal lives outside the page)', run: async () => {
      const { window } = await boot('http://localhost:4319/');
      await go(window, 'connectors');
      window.document.querySelector('.view[data-view="connectors"] [data-act="new-set"]').click();
      await settle();
      const modal = window.document.getElementById('plugin-modal');
      assert.equal(modal.classList.contains('hidden'), false, 'New set opened its dialog');
      await go(window, 'runs');
      assert.equal(modal.classList.contains('hidden'), true);
    } },
  ]);
});
