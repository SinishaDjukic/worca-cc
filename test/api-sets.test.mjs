// test/api-sets.test.mjs — /api/sets (skills registry §7): the canonical name of the Sets API — every /api/mcp route answers
// under it with the same handler — and a set's skills (PUT/DELETE /api/sets/:id/skills/:skillId). Boots the real express
// app (imported ⇒ no port bind) against a sandboxed WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { put } from './helpers/mcp-store-fixtures.mjs';
import { writeMcpPlugin } from './helpers/mcp-plugin-fixture.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { readMcpStore, setTeamSkillState } from '../src/core/mcp/store.mjs';

useTempHome(after);

let srv, base;
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, ...(b !== undefined ? { headers: JSONH, body: JSON.stringify(b) } : {}) });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* express's own 404 page */ }
  return { status: r.status, text, body };
};
const enc = encodeURIComponent;
const DEPLOY = 'skill:plugin:acme-tools/deploy-checklist';

before(async () => {
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });

test('/api/sets answers every /api/mcp route with its handler: sets, a set by id, servers, projects, teams, preview', async () => {
  let r = await call('POST', '/api/sets', { name: 'Billing' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.id, 'billing');
  for (const p of ['/api/sets', '/api/sets/']) assert.deepEqual((await call('GET', p)).body, (await call('GET', '/api/mcp/sets')).body, p);
  r = await call('GET', '/api/sets/billing');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, (await call('GET', '/api/mcp/sets/billing')).body);
  assert.deepEqual([r.body.set.pluginName, r.body.set.renamedPlugin, r.body.skills], ['billing', false, []]);
  assert.equal((await call('PUT', '/api/sets/billing', { name: 'Billing EU' })).status, 200);
  assert.equal((await call('GET', '/api/mcp/sets/billing')).body.set.name, 'Billing EU');
  r = await call('POST', '/api/sets/billing/duplicate', { name: 'Billing copy' });
  assert.equal(r.body.id, 'billing-copy');
  assert.deepEqual([(await call('DELETE', '/api/sets/billing-copy')).status, (await call('GET', '/api/sets/billing-copy')).status], [200, 404]);
  assert.equal((await call('GET', '/api/sets/Bad')).status, 400, 'the set id check runs');

  const PG = { name: 'pg', type: 'stdio', command: 'npx', args: ['-y', 'pg-mcp'], fields: [], description: 'pg' };
  assert.equal((await call('POST', '/api/sets/servers', PG)).status, 200);
  assert.deepEqual((await call('GET', '/api/sets/servers')).body, (await call('GET', '/api/mcp/servers')).body);
  assert.deepEqual((await call('GET', '/api/sets/servers')).body.servers.map((s) => s.id), ['manual:pg']);
  assert.equal((await call('POST', '/api/sets/servers/validate', PG)).body.errors.some((e) => /taken/.test(e)), true);
  assert.deepEqual((await call('POST', '/api/sets/servers/validate?edit=1', PG)).body.errors, [], 'the query string rides along');
  r = await call('PUT', `/api/sets/sets/billing/members/${enc('manual:pg')}`, { enabled: true });
  assert.equal(r.status, 404, '/api/sets/sets/<rest> is a set named "sets", not /api/mcp/sets/<rest>');
  assert.equal((await call('PUT', `/api/sets/billing/members/${enc('manual:pg')}`, { enabled: true })).status, 200);
  assert.deepEqual((await readMcpStore()).sets.billing.members.map((m) => m.server), ['manual:pg']);

  assert.equal((await call('PUT', '/api/sets/projects/billing-1a2b3c4d', { sets: ['billing'], includeGeneral: false })).status, 200);
  assert.deepEqual((await call('GET', '/api/sets/projects/billing-1a2b3c4d')).body, (await call('GET', '/api/mcp/projects/billing-1a2b3c4d')).body);
  assert.deepEqual((await call('GET', '/api/sets/projects/billing-1a2b3c4d')).body.sets, [{ id: 'billing', name: 'Billing EU' }]);

  await setTeamSkillState('acme/platform', DEPLOY, { enabled: false });
  assert.equal((await call('POST', `/api/sets/teams/${enc('acme/platform')}/forget`)).status, 200);
  assert.equal(Object.hasOwn((await readMcpStore()).teams, 'acme/platform'), false, 'the Team routes answer too');

  const bogus = { target: { bogus: true } };
  r = await call('POST', '/api/sets/preview', bogus);   // POST /api/mcp/preview is registered far above the alias
  assert.deepEqual([r.status, r.body], [400, (await call('POST', '/api/mcp/preview', bogus)).body]);
  assert.match(r.body.error, /target must be/);

  assert.equal((await call('GET', '/api/sets/billing/nope')).status, 404, 'a path no route answers stays 404');
  assert.equal((await call('GET', '/api/setsbilling')).status, 404, 'only /api/sets and /api/sets/<rest> are the alias');
});

test('/api/sets bodies never set consent, hash, bases or seeded (the /api/mcp guard runs on /api/sets requests, in any letter case)', async () => {
  for (const k of ['hash', 'consent', 'bases', 'seeded']) {
    const r = await call('POST', '/api/sets', { name: `X ${k}`, [k]: 'x' });
    assert.equal(r.status, 400, k);
    assert.equal(r.body.error, `"${k}" cannot be set here`);
  }
  for (const [method, p] of [['POST', '/API/SETS'], ['PUT', '/Api/Sets/billing']]) {   // Express routes ignore letter case; so does the alias
    const r = await call(method, p, { name: 'X case', consent: 'x' });
    assert.deepEqual([r.status, r.body?.error], [400, '"consent" cannot be set here'], p);
  }
  assert.deepEqual((await call('GET', '/Api/Sets/Servers')).body, (await call('GET', '/api/mcp/servers')).body, 'a noun in any letter case');
});

const pluginsDir = mkdtempSync(join(tmpdir(), 'worca-api-sets-'));
after(() => rmSync(pluginsDir, { recursive: true, force: true }));
const LINT = 'skill:plugin:acme-tools/lint';
const skillUrl = (set, id) => `/api/sets/${set}/skills/${enc(id)}`;
const plain = (v) => JSON.parse(JSON.stringify(v));
/** A linked plugin shipping skills/<name>/SKILL.md for each name (skills registry §3.3: plugin skills join the catalog). */
async function linkSkills(plugin, names) {
  const files = Object.fromEntries(names.map((n) => [`skills/${n}/SKILL.md`, `---\nname: ${n}\ndescription: ${n} for ${plugin}\n---\n# ${n}\n`]));
  await linkPlugin(plugin, writeMcpPlugin(join(pluginsDir, plugin), { name: plugin, mcpServers: {}, files }));
}

test('PUT /api/sets/:id/skills/:skillId adds a skill or switches it; DELETE removes it; the views list it', async () => {
  await linkSkills('acme-tools', ['deploy-checklist', 'lint']);
  await call('POST', '/api/sets', { name: 'Shop' });
  let r = await call('PUT', skillUrl('shop', DEPLOY), {});
  assert.deepEqual([r.status, r.body], [200, { ok: true }], r.text);
  r = await call('GET', '/api/sets/shop');
  assert.deepEqual(r.body.skills.map((m) => [m.qualifiedName, m.enabled, m.reason, m.sourceLabel, m.description]),
    [['shop:deploy-checklist', true, null, 'acme-tools', 'deploy-checklist for acme-tools']]);
  assert.equal((await call('GET', '/api/sets')).body.sets.find((s) => s.id === 'shop').skillCount, 1);
  r = await call('PUT', `/api/mcp/sets/shop/skills/${enc(DEPLOY)}`, { enabled: false });   // its /api/mcp twin
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(plain((await readMcpStore()).sets.shop.skills), [{ skill: DEPLOY, enabled: false }]);
  assert.equal((await call('PUT', skillUrl('general', LINT), { enabled: true })).status, 200, 'General holds skills');
  assert.deepEqual((await call('GET', '/api/sets/general')).body.skills.map((m) => m.qualifiedName), ['general:lint']);
  assert.equal((await call('DELETE', skillUrl('shop', DEPLOY))).status, 200);
  assert.equal(Object.hasOwn((await readMcpStore()).sets.shop, 'skills'), false);
  r = await call('DELETE', skillUrl('shop', DEPLOY));
  assert.deepEqual([r.status, r.body.error], [404, `${DEPLOY} is not in this set`]);
});

test('skill routes refuse: bad ids 400, unknown set or skill 404, other body keys 400, a second skill of one name 409', async () => {
  await linkSkills('other-tools', ['deploy-checklist']);
  await call('POST', '/api/sets', { name: 'Ops' });
  assert.equal((await call('PUT', skillUrl('ops', DEPLOY), {})).status, 200);
  const cases = [
    ['PUT', skillUrl('Bad', DEPLOY), {}, 400, 'invalid set id'],
    ['PUT', skillUrl('ops', 'plugin:acme-tools/sentry'), {}, 400, 'invalid skill id'],
    ['PUT', skillUrl('ops', 'skill:library:nope'), {}, 404, 'skill not found'],
    ['PUT', skillUrl('nope', LINT), {}, 404, 'no MCP set "nope"'],
    ['PUT', skillUrl('ops', LINT), { enabled: 'yes' }, 400, 'enabled must be true or false'],
    ['PUT', skillUrl('ops', LINT), { values: {} }, 400, '"values" cannot be set on a skill'],
    ['PUT', skillUrl('ops', LINT), { consent: 'x' }, 400, '"consent" cannot be set here'],
    ['PUT', skillUrl('ops', LINT), [1], 400, 'body must be an object'],
    ['PUT', skillUrl('ops', 'skill:plugin:other-tools/deploy-checklist'), {}, 409, 'a skill named "deploy-checklist" is already in this set'],
    ['DELETE', skillUrl('ops', 'manual:pg'), undefined, 400, 'invalid skill id'],
    ['DELETE', skillUrl('Bad', LINT), undefined, 400, 'invalid set id'],
  ];
  for (const [method, p, body, status, error] of cases) {
    const r = await call(method, p, body);
    assert.deepEqual([r.status, r.body?.error], [status, error], `${method} ${p}`);
  }
});

test('Team set skills: never added or removed by hand; a home this machine has no policy for has none to switch', async () => {
  const TEAM = 'team-acme-platform-9333';
  await setTeamSkillState('acme/platform', DEPLOY, { enabled: true, consent: 'c'.repeat(64) });   // kept state, no cached policy: greyed
  let r = await call('PUT', skillUrl(TEAM, DEPLOY), { enabled: false });
  assert.deepEqual([r.status, r.body.error], [409, 'Team set skills come from team policy and cannot be added here']);
  r = await call('PUT', skillUrl('team-nope-0000', DEPLOY), {});
  assert.deepEqual([r.status, r.body.error], [404, 'set not found']);
  r = await call('DELETE', skillUrl(TEAM, DEPLOY));
  assert.deepEqual([r.status, r.body.error], [409, 'Team set skills come from team policy and cannot be removed here']);
  assert.deepEqual(plain((await readMcpStore()).teams['acme/platform'].skills), { [DEPLOY]: { enabled: true, consent: 'c'.repeat(64) } }, 'nothing changed');
});

test('a set whose id is an /api/sets noun (an older Worca made it) still reaches its skills at the canonical path', async () => {
  put('sets', { sets: { preview: { name: 'Preview', slug: 'preview', members: [] } } });
  const r = await call('PUT', skillUrl('preview', LINT), {});   // /api/mcp/preview/skills/<id> answers nothing; /api/sets/:id/skills/:skillId does
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(plain((await readMcpStore()).sets.preview.skills), [{ skill: LINT, enabled: true }]);
  assert.equal((await call('DELETE', skillUrl('preview', LINT))).status, 200);
});

test('DELETE removes a skill entry this build cannot parse (a newer Worca wrote it; shown as missing-skill); PUT never adds one', async () => {
  const GIT = 'skill:git:acme/deploy';
  put('sets', { sets: { shop: { name: 'Shop', slug: 'shop', members: [], skills: [{ skill: GIT, enabled: true, at: 'v9' }] } } });
  assert.deepEqual((await call('GET', '/api/sets/shop')).body.skills.map((m) => [m.skillId, m.reason]), [[GIT, 'missing-skill']]);
  let r = await call('PUT', skillUrl('shop', GIT), { enabled: false });
  assert.deepEqual([r.status, r.body?.error], [400, 'invalid skill id']);
  r = await call('DELETE', skillUrl('shop', GIT));
  assert.equal(r.status, 200, r.text);
  assert.equal(Object.hasOwn((await readMcpStore()).sets.shop, 'skills'), false);
  for (const id of ['skill: x', 'manual:pg', `skill:${'x'.repeat(1019)}`]) {   // the last one is 1025 characters
    r = await call('DELETE', skillUrl('shop', id));
    assert.deepEqual([r.status, r.body?.error], [400, 'invalid skill id'], id.slice(0, 20));
  }
});
