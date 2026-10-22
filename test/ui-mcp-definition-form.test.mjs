// test/ui-mcp-definition-form.test.mjs — the manual definition form (spec §7.2): form ↔ §4.1 shape,
// {name} placeholders, one Bearer tick, per set / secret rows, Name read-only in Edit, live checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import {
  compileDefinition, formFromDefinition, blankDefinitionForm, placeholderStartsSecret, createDefinitionForm,
} from '../ui/public/mcp-definition-form.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const form = (over) => ({ ...blankDefinitionForm(), ...over });

test('stdio: {name} in Arguments is a required field (prefix/suffix kept); rows become literals, defaults or secrets', () => {
  const { name, def, errors } = compileDefinition(form({
    name: ' postgres-ro ', command: 'npx', args: '-y\n@modelcontextprotocol/server-postgres\n--db={database}/ro',
    rows: [
      { key: 'PGSSLMODE', value: 'require', perSet: false, secret: false },
      { key: 'PGPASSWORD', value: '', perSet: true, secret: true },
      { key: 'PG-APP', value: 'worca', perSet: true, secret: false },
    ],
    description: 'Read-only replica',
  }));
  assert.equal(name, 'postgres-ro');
  assert.deepEqual(errors, []);
  assert.deepEqual(def, {
    type: 'stdio', command: 'npx', description: 'Read-only replica',
    args: ['-y', '@modelcontextprotocol/server-postgres', { field: 'database', prefix: '--db=', suffix: '/ro' }],
    env: { PGSSLMODE: 'require', PGPASSWORD: { field: 'PGPASSWORD' }, 'PG-APP': { field: 'PG_APP' } },
    fields: [
      { key: 'database', label: 'database', required: true },
      { key: 'PGPASSWORD', label: 'PGPASSWORD', secret: true, required: true },
      { key: 'PG_APP', label: 'PG-APP', required: false, default: 'worca' },
    ],
  });
  assert.deepEqual(compileDefinition(form({ args: '{a}{b}' })).errors, ['one {placeholder} per argument: {a}{b}']);
  const clash = compileDefinition(form({ rows: [{ key: 'X-Team', value: '', perSet: true, secret: false }, { key: 'X_Team', value: '', perSet: true, secret: false }] }));
  assert.deepEqual(clash.errors, ['X_Team: its field "X_Team" is already declared. Rename the row'], 'two rows never share a field');
  const nocase = compileDefinition(form({ rows: [{ key: 'X-Team', value: '', perSet: true, secret: false }, { key: 'x_team', value: '', perSet: true, secret: false }] }));
  assert.deepEqual(nocase.errors, ['x_team: its field "x_team" is already declared. Rename the row'], 'field keys compare ignoring case');
});

test('http: one Bearer tick = a secret OAuth token behind Authorization: Bearer; URL placeholders; secret query placeholders', () => {
  const { def } = compileDefinition(form({
    name: 'linear', type: 'http', url: 'https://mcp.example.com/{team}/mcp?api_key={key}', bearer: true,
    rows: [{ key: 'X-Linear-Team', value: 'platform', perSet: true, secret: false }],
  }));
  assert.deepEqual(def.url, ['https://mcp.example.com/', { field: 'team' }, '/mcp?api_key=', { field: 'key' }]);
  assert.deepEqual(def.headers, { 'X-Linear-Team': { field: 'X_Linear_Team' }, Authorization: { field: 'token', prefix: 'Bearer ' } });
  assert.deepEqual(def.fields, [
    { key: 'team', label: 'team', required: true },
    { key: 'key', label: 'key', required: true, secret: true },
    { key: 'X_Linear_Team', label: 'X-Linear-Team', required: false, default: 'platform' },
    { key: 'token', label: 'Bearer token', secret: true, oauth: true, required: true },
  ]);
  assert.equal(placeholderStartsSecret('https://x/{team}', 'team'), false);
  const token = (over) => compileDefinition(form({ name: 'x', type: 'http', url: 'https://x/mcp', bearer: true, ...over })).errors;
  assert.deepEqual(token({ rows: [{ key: 'token', value: '', perSet: true, secret: true }] }),
    ['Bearer token: its field "token" is already declared. Rename the row or the placeholder'], 'the Bearer field never shares');
  assert.deepEqual(token({ url: 'https://x/{Token}/mcp' }), ['Bearer token: its field "token" is already declared. Rename the row or the placeholder']);
  assert.deepEqual(token({ rows: [{ key: 'Authorization', value: 'Basic x', perSet: false, secret: false }] }),
    ['Authorization: the Bearer token tick sets this header. Remove the row']);
  const off = compileDefinition(form({ type: 'http', url: 'https://x/?token={t}', placeholders: { t: { secret: false } } }));
  assert.equal(off.def.fields[0].secret, undefined, 'a starting-secret placeholder can be unticked');
  assert.equal(compileDefinition(form({ type: 'sse', url: 'https://x/sse' })).def.url, 'https://x/sse');
});

test('Edit round trip: a form-made definition and any server-accepted stored definition save back unchanged', async () => {
  await checkRows([
    { name: 'Edit round trip: a definition the form made reads back into the same definition', run: () => {
      for (const f of [
        form({ name: 'pg', command: '/usr/bin/pg-mcp', args: '--db\n{database}', rows: [{ key: 'PGPASSWORD', value: '', perSet: true, secret: true }], description: 'd' }),
        form({ name: 'lin', type: 'http', url: 'https://x/{org}/mcp', bearer: true, rows: [{ key: 'X-Team', value: 'a', perSet: true, secret: false }, { key: 'X-Fixed', value: 'b', perSet: false, secret: false }] }),
      ]) {
        const { def } = compileDefinition(f);
        assert.deepEqual(compileDefinition(formFromDefinition(f.name, def)).def, def);
      }
    } },
    { name: 'Edit round trip: any stored definition the server accepts saves back unchanged (labels, required, oauth, affixes, shared fields)', run: async () => {
      const { validateMcpDefinition } = await import('../src/core/mcp/definitions.mjs');
      const norm = (def) => validateMcpDefinition(JSON.parse(JSON.stringify(def)), { name: 'srv', source: 'manual' });
      const F = (key, extra = {}) => ({ key, label: key, required: true, ...extra });
      for (const raw of [
        // spec §4.1's manual example: labels the form has no column for
        { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', { field: 'database' }], env: { PGPASSWORD: { field: 'password' } },
          fields: [F('database', { label: 'Database URL' }), F('password', { label: 'Password', secret: true })], description: 'Read-only replica' },
        // spec §4.1's sentry shape: token declared first, labelled
        { type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: { field: 'token', prefix: 'Bearer ' }, 'X-Sentry-Org': { field: 'org' } },
          fields: [F('token', { label: 'Sentry token', secret: true, oauth: true }), F('org', { label: 'Organization' })], description: '' },
        { type: 'stdio', command: 'pg-mcp', args: [], env: { DATABASE_URL: { field: 'pw', prefix: 'postgres://app:', suffix: '@db/app' } }, fields: [F('pw', { secret: true })], description: '' },
        { type: 'http', url: 'https://x.example.com/mcp', headers: { Authorization: { field: 'token', prefix: 'Bearer ' } }, fields: [F('token', { secret: true })], description: '' },
        { type: 'http', url: 'https://x.example.com/mcp', headers: { Authorization: { field: 'key', prefix: 'Token ' } }, fields: [F('key', { secret: true })], description: '' },
        { type: 'stdio', command: 'x', args: [], env: { API_KEY: { field: 'API_KEY' }, REGION: { field: 'REGION' }, ZONE: { field: 'ZONE' } },
          fields: [F('API_KEY', { secret: true, required: false }), F('REGION', { default: 'eu' }), F('ZONE', { required: false })], description: '' },
        { type: 'stdio', command: 'x', args: [{ field: 'db', prefix: '--db=' }], env: {}, fields: [F('db', { required: false, default: 'main' })], description: '' },
        { type: 'stdio', command: 'x', args: [{ field: 'db', prefix: '--db=' }], env: { DB: { field: 'db' } }, fields: [F('db')], description: '' },
        { type: 'http', url: ['https://x.example.com/', { field: 'team' }, '/mcp'], headers: { 'X-Team': { field: 'team' } }, fields: [F('team')], description: '' },
        // a url that starts with a field (the field supplies scheme and host) keeps its affixes on that leading ref
        { type: 'http', url: [{ field: 'host', prefix: 'https://' }, '/mcp'], headers: {}, fields: [F('host')], description: '' },
        { type: 'http', url: [{ field: 'host', prefix: 'https://', suffix: ':8443' }, '/', { field: 'team' }, '/mcp'], headers: {}, fields: [F('host'), F('team')], description: '' },
        { type: 'sse', url: { field: 'host', prefix: 'https://', suffix: '/sse' }, headers: {}, fields: [F('host')], description: '' },
      ]) {
        const before = norm(raw);
        assert.ok(before.def, before.errors.join('; '));
        const out = compileDefinition(formFromDefinition('srv', JSON.parse(JSON.stringify(before.def))));
        assert.deepEqual(out.errors, [], JSON.stringify(raw));
        assert.deepEqual(norm(out.def).def, before.def, JSON.stringify(raw));
      }
      // …so a host:port value still resolves to the same URL after a no-op Edit (a field moved off index 0 is percent-encoded).
      const { materializeCopy } = await import('../src/core/mcp/registry.mjs');
      const resolved = (def) => {
        const r = materializeCopy({ entry: { id: 'manual:srv', source: 'manual', name: 'srv', dir: null, def }, values: { host: 'mcp.acme.io:8443' }, copy: 'srv', name: 'srv' },
          { platform: 'linux', execPath: '/usr/bin/node', worcaRoot: '/opt/worca' });
        return r.reason || r.server.url;
      };
      const stored = norm({ type: 'http', url: [{ field: 'host', prefix: 'https://' }, '/mcp'], fields: [F('host')], description: '' }).def;
      assert.equal(resolved(stored), 'https://mcp.acme.io:8443/mcp');
      assert.equal(resolved(norm(compileDefinition(formFromDefinition('srv', JSON.parse(JSON.stringify(stored)))).def).def), 'https://mcp.acme.io:8443/mcp');
      // Edited so it no longer starts with the stored ref's text, the URL is read afresh.
      const edited = formFromDefinition('srv', JSON.parse(JSON.stringify(stored)));
      edited.url = 'https://mcp.acme.io/{host}/mcp';
      assert.deepEqual(compileDefinition(edited).def.url, ['https://mcp.acme.io/', { field: 'host' }, '/mcp']);
      // A URL ref's prefix/suffix reads back as URL text (never dropped).
      assert.equal(formFromDefinition('srv', { type: 'http', url: ['https://x.example.com/', { field: 'team', suffix: '/mcp' }], fields: [F('team')] }).url,
        'https://x.example.com/{team}/mcp');
    } },
  ]);
});

test('the client copy of QUERY_SECRET_RE matches src/core/mcp-secrets.mjs', () => {
  const core = readFileSync(new URL('../src/core/mcp-secrets.mjs', import.meta.url), 'utf8').match(/const QUERY_SECRET_RE = (\/.*\/i);/)[1];
  const ui = readFileSync(new URL('../ui/public/mcp-definition-form.mjs', import.meta.url), 'utf8').match(/const QUERY_SECRET_RE = (\/.*\/i);/)[1];
  assert.equal(ui, core);
});

function mount(f, { edit = false, errors = [] } = {}) {
  const calls = [];
  const api = async (method, path, body) => { calls.push([method, path, body]); return { ok: true, status: 200, data: { errors } }; };
  const el = createDefinitionForm(doc, api, f, { edit });
  doc.body.replaceChildren(el);
  return { el, calls };
}

test('the form: an Arguments placeholder "cannot be secret"; a secret row takes no value', () => {
  const { el } = mount(form({ name: 'pg', command: 'npx', args: '{database}', rows: [{ key: 'PGPASSWORD', value: 'x', perSet: false, secret: true }] }));
  const fills = [...el.querySelectorAll('.mcp-def-fill')].map((r) => r.textContent.trim());
  assert.deepEqual(fills, ['database · from arguments · cannot be secret', 'PGPASSWORD · secret']);
  assert.equal(el.querySelector('[data-placeholder="database"]'), null);
  const value = el.querySelector('[data-row="0"][data-col="value"]');
  assert.equal(value.disabled, true);
  assert.equal(el.querySelector('[data-row="0"][data-col="perSet"]').disabled, true, 'secret implies per set');
});

test('live checks: the server\'s errors show, and check() answers from them', async () => {
  const bad = mount(form({ name: 'pg', command: 'npx', rows: [{ key: 'PGAPPNAME', value: 'sk-live-x', perSet: false, secret: false }] }),
    { errors: ['env PGAPPNAME looks like a secret · make it a secret field'] });
  assert.equal(await bad.el.check(), false);
  assert.match(bad.el.querySelector('.mcp-def-errors').textContent, /looks like a secret/);
  const [method, path, body] = bad.calls.at(-1);
  assert.deepEqual([method, path, body.name, body.env], ['POST', '/api/mcp/servers/validate', 'pg', { PGAPPNAME: 'sk-live-x' }]);
  const good = mount(form({ name: 'pg', command: 'npx' }), { edit: true });
  assert.equal(good.el.querySelector('[data-def="name"]').readOnly, true, 'Name is read-only in Edit: a rename-save never creates a second definition');
  assert.equal(await good.el.check(), true);
  assert.equal(good.calls.at(-1)[1], '/api/mcp/servers/validate?edit=1');
  assert.equal(await mount(form({ command: 'npx' })).el.check(), false, 'a name is required');
});
