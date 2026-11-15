// test/stillhet-market-live.test.mjs — the live Marketplace I/O (Stillhet slice 8 D2, D8–D14): every request from
// MARKET_ACTIONS, refusals that change nothing, the update's preview before its apply, one press one request, a source's
// removal after the undo window, and the set-up form's PUTs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMarketLive, MARKET_ACTIONS, fieldKey } from '../ui/public/stillhet/live/market-live.mjs';
import { MK_LISTS, SHA, preview } from './helpers/stillhet-marketplace-host.mjs';

const ALL = [];   // every request of every rig: checked against the table at the end
after(() => {
  const known = Object.values(MARKET_ACTIONS).map(([, f]) => f);
  for (const c of ALL) {
    const fits = known.some((f) => { const [m, u] = f({ id: 'X', name: 'X', url: 'X', sourceId: 'X', profile: 'X', body: {} }); const re = new RegExp(`^${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/X/g, '[^/]+')}$`); return m === c.method && re.test(c.url); });
    assert.ok(fits, `${c.method} ${c.url} is not in MARKET_ACTIONS`);
  }
});

function rig({ answer = () => null, lists = MK_LISTS } = {}) {
  const calls = [], toasts = [], opened = [], timers = [];
  let changes = 0;
  const fetch = async (url, o = {}) => {
    const method = o.method || 'GET', body = o.body ? JSON.parse(o.body) : undefined;
    calls.push({ method, url, body }); ALL.push({ method, url });
    const a = await answer(method, url, body);
    if (a === 'down') throw new TypeError('Failed to fetch');
    const [status, data] = a || (method === 'GET' && lists[url] ? [200, structuredClone(lists[url])] : method === 'GET' ? [404, { error: 'plugin not found' }] : [200, { ok: true }]);
    return { ok: status < 400, status, json: async () => structuredClone(data) };
  };
  const live = startMarketLive({ fetch, toast: (t) => toasts.push(t), open: (u) => opened.push(u), on: () => { changes += 1; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].fn = null; } });
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { live, calls, writes, toasts, opened, timers, changes: () => changes, fire: () => { for (const t of timers.splice(0)) t.fn?.(); } };
}
const ready = async (r) => { await r.live.load(); return r; };
const tick = () => new Promise((res) => setImmediate(res));
const rec = (r, id) => r.live.data().plugins.find((p) => p.id === id);

test('load reads both lists (and the installed plugins\' set-up), maps them; status goes loading → ready', async () => {
  const r = rig();
  assert.equal(r.live.status(), 'loading');
  await r.live.load();
  assert.equal(r.live.status(), 'ready');
  const gets = r.calls.map((c) => c.url);
  for (const u of ['/api/plugins', '/api/marketplaces', '/api/plugins/jira-source/config', '/api/plugins/seed-setup/config']) assert.ok(gets.includes(u), u);
  const d = r.live.data();
  assert.deepEqual(d.markets.map((m) => [m.id, m.builtin]), [['worca-official', true], ['team-plugins', false]]);
  assert.equal(rec(r, 'jira-source').update, '0.2.0');
  assert.deepEqual(rec(r, 'jira-source').asks, ['Jira API token', 'Jira site'], 'an installed plugin asks its config labels');
  assert.equal(rec(r, 'seed-setup').needsSetup, true);
});

test('a failed first read is failed; Try again shows loading while it reads', async () => {
  let fail = true, release; const held = new Promise((res) => { release = res; });
  const r = rig({ answer: async (m, u) => { if (u === '/api/plugins') { if (fail) return [500, { error: 'boom' }]; await held; } return null; } });
  await r.live.load();
  assert.equal(r.live.status(), 'failed');
  fail = false;
  const again = r.live.load();
  assert.equal(r.live.status(), 'loading');
  release(); await again;
  assert.equal(r.live.status(), 'ready');
});

test('overlapping reads: an older answer that lands last is dropped', async () => {
  const lists = structuredClone(MK_LISTS), old = structuredClone(MK_LISTS['/api/plugins']);
  let release, n = 0; const held = new Promise((res) => { release = res; });
  const r = await ready(rig({ lists, answer: async (m, u) => { if (u === '/api/plugins' && ++n === 2) { await held; return [200, old]; } return null; } }));
  lists['/api/plugins'].plugins = lists['/api/plugins'].plugins.slice(1);   // jira-source removed meanwhile
  const first = r.live.refresh('plugins'); await tick();   // the 2nd plugins read, held: the old answer
  await r.live.refresh('plugins');                          // the 3rd, newer: no jira-source
  release(); await first;
  assert.equal(rec(r, 'jira-source').installed, false, 'the held older answer did not overwrite the newer one');
});

test('each MARKET_ACTIONS id sends its method, URL and body', () => {
  const b = (id, a) => MARKET_ACTIONS[id][1](a);
  assert.deepEqual(b('install', { repoUrl: 'r', name: 'n', sha: 's', subdir: 'd', marketplace: 'm' }), ['POST', '/api/plugins/install', { repoUrl: 'r', name: 'n', sha: 's', subdir: 'd', marketplace: 'm' }]);
  assert.deepEqual(b('update-preview', { id: 'a b' }), ['POST', '/api/plugins/a%20b/update', {}]);
  assert.deepEqual(b('update-apply', { id: 'a', candidateSha: SHA }), ['POST', '/api/plugins/a/update', { confirm: true, candidateSha: SHA }]);
  assert.deepEqual(b('remove', { id: 'a' }), ['DELETE', '/api/plugins/a']);
  assert.deepEqual(b('sync', { id: 'm' }), ['POST', '/api/marketplaces/m/refresh', {}]);
  assert.deepEqual(b('add-source', { url: 'o/r' }), ['POST', '/api/marketplaces', { url: 'o/r' }]);
  assert.deepEqual(b('remove-source', { id: 'm' }), ['DELETE', '/api/marketplaces/m']);
  assert.deepEqual(b('save-config', { id: 'a', body: { sourceId: 's', values: {} } }), ['PUT', '/api/plugins/a/config', { sourceId: 's', values: {} }]);
  assert.deepEqual(b('get-config', { id: 'a' }), ['GET', '/api/plugins/a/config']);
  assert.deepEqual(b('get-plugin', { id: 'a' }), ['GET', '/api/plugins/a']);
});

test('install sends the market\'s full sha, answers Installed and reads both lists again', async () => {
  const r = await ready(rig());
  const n = r.calls.length;
  const a = await r.live.install('slack-chat');
  assert.deepEqual(r.writes().map((c) => [c.method, c.url, c.body]), [['POST', '/api/plugins/install', { repoUrl: 'https://github.com/SinishaDjukic/worca-cc', name: 'slack-chat', sha: SHA, subdir: 'plugins/slack-chat', marketplace: 'worca-official' }]]);
  assert.deepEqual(a, { ok: true, text: 'Installed slack-chat' });
  const again = r.calls.slice(n + 1).map((c) => c.url);
  assert.ok(again.includes('/api/plugins') && again.includes('/api/marketplaces'), again.join());
});

test('a refused install answers Could not install …, and data() is unchanged', async () => {
  const r = await ready(rig({ answer: (m, u) => (u === '/api/plugins/install' ? [500, { error: 'setup.node declared but package-lock.json is missing' }] : null) }));
  const before = structuredClone(r.live.data());
  const a = await r.live.install('slack-chat');
  assert.deepEqual(a, { ok: false, text: 'Could not install slack-chat: setup.node declared but package-lock.json is missing' });
  assert.deepEqual(r.live.data(), before);
  assert.equal(r.live.pending('slack-chat'), '');
});

test('a double press sends one request; a network failure says Worca is not answering', async () => {
  let release; const held = new Promise((res) => { release = res; });
  const r = await ready(rig({ answer: async (m, u) => { if (u === '/api/plugins/install') { await held; } return null; } }));
  const one = r.live.install('slack-chat');
  await tick();
  assert.equal(r.live.pending('slack-chat'), 'install');
  assert.deepEqual(await r.live.install('slack-chat'), { ok: false, text: '' });
  release(); await one;
  assert.equal(r.writes().length, 1);
  const down = await ready(rig({ answer: (m, u) => (u === '/api/plugins/install' ? 'down' : null) }));
  assert.deepEqual(await down.live.install('slack-chat'), { ok: false, text: 'Could not install slack-chat: Worca is not answering' });
});

test('a list read during a pending install keeps Installing… (pending stays install)', async () => {
  let release; const held = new Promise((res) => { release = res; });
  const r = await ready(rig({ answer: async (m, u) => { if (u === '/api/plugins/install') await held; return null; } }));
  const one = r.live.install('slack-chat'); await tick();
  await r.live.refresh('plugins', 'markets');
  assert.equal(r.live.pending('slack-chat'), 'install');
  release(); await one;
  assert.equal(r.live.pending('slack-chat'), '');
});

test('update sends the preview, then the apply with that candidateSha', async () => {
  const r = await ready(rig({ answer: (m, u, b) => (u === '/api/plugins/jira-source/update' ? (b.confirm ? [200, { ok: true, updated: true, ...preview().preview }] : [200, preview()]) : null) }));
  const a = await r.live.update('jira-source');
  assert.deepEqual(r.writes().map((c) => c.body), [{}, { confirm: true, candidateSha: SHA }]);
  assert.deepEqual(a, { ok: true, text: 'Updated Jira to 0.2.0' });
});

test('a preview with new access answers ask and applies nothing; confirmed applies that same candidate', async () => {
  const r = await ready(rig({ answer: (m, u, b) => (u === '/api/plugins/jira-source/update' ? (b.confirm ? [200, { ok: true, updated: true, ...preview().preview }] : [200, preview([{ kind: 'secret', id: 'webhookSecret', red: true }])]) : null) }));
  const a = await r.live.update('jira-source');
  assert.equal(a.ok, false); assert.equal(a.ask.text, 'Update jira-source to 0.2.0? It now asks for a secret: webhookSecret.');
  assert.equal(r.writes().length, 1, 'the preview only');
  const b = await r.live.update('jira-source', { confirmed: true });
  assert.equal(b.ok, true);
  assert.deepEqual(r.writes().map((c) => c.body), [{}, { confirm: true, candidateSha: SHA }]);
  // a yes with no ask behind it (none shown in this tab) asks again; nothing is applied
  const c = await r.live.update('jira-source', { confirmed: true });
  assert.equal(c.ok, false); assert.ok(c.ask, 'asked again');
  assert.deepEqual(r.writes().map((x) => x.body), [{}, { confirm: true, candidateSha: SHA }, {}], 'one more preview, no apply');
});

test('a stale preview refuses and applies nothing more; the lists are read again', async () => {
  const r = await ready(rig({ answer: (m, u, b) => (u === '/api/plugins/jira-source/update' ? (b.confirm ? [409, { error: 'plugin "jira-source" moved on since the preview', code: 'STALE_PREVIEW', candidateSha: 'f'.repeat(40) }] : [200, preview()]) : null) }));
  const before = structuredClone(r.live.data()), n = r.calls.length;
  const a = await r.live.update('jira-source');
  assert.deepEqual(a, { ok: false, text: 'Could not update jira-source: plugin "jira-source" moved on since the preview' });
  assert.equal(r.writes().length, 2, 'the preview and the one apply; never re-applied');
  assert.ok(r.calls.slice(n).some((c) => c.url === '/api/plugins'), 'read again');
  assert.deepEqual(r.live.data(), before);
});

test('an apply that answers updated:false says it is up to date', async () => {
  const r = await ready(rig({ answer: (m, u, b) => (u === '/api/plugins/jira-source/update' ? (b.confirm ? [200, { ok: true, updated: false }] : [200, preview()]) : null) }));
  assert.deepEqual(await r.live.update('jira-source'), { ok: true, text: 'jira-source is up to date' });
});

test('updateAll runs the updates one at a time and sums them in one text', async () => {
  const lists = structuredClone(MK_LISTS);
  lists['/api/plugins'].plugins[1].latest = { version: '0.3.0', sha: SHA, marketplace: 'worca-official', access: [] };
  let inflight = 0, most = 0;
  const r = await ready(rig({ lists, answer: async (m, u, b) => {
    if (!u.endsWith('/update')) return null;
    inflight++; most = Math.max(most, inflight); await tick(); inflight--;
    if (u.includes('seed-setup')) return [500, { error: 'doctor precheck failed' }];
    return b.confirm ? [200, { ok: true, updated: true, ...preview().preview }] : [200, preview()];
  } }));
  const a = await r.live.updateAll();
  assert.equal(most, 1, 'one at a time');
  assert.equal(a.text, 'Updated Jira; could not update Seed tracker: doctor precheck failed');
});

test('remove sends DELETE /api/plugins/:name; a REFERENCED 409 answers Could not remove', async () => {
  const r = await ready(rig());
  assert.deepEqual(await r.live.remove('jira-source'), { ok: true, text: 'Removed jira-source' });
  assert.deepEqual(r.writes().map((c) => [c.method, c.url]), [['DELETE', '/api/plugins/jira-source']]);
  const x = await ready(rig({ answer: (m, u) => (m === 'DELETE' ? [409, { error: 'plugin "jira-source" agents are referenced by: wf', references: [] }] : null) }));
  assert.deepEqual(await x.live.remove('jira-source'), { ok: false, text: 'Could not remove jira-source: plugin "jira-source" agents are referenced by: wf' });
});

test('sync: a fresh lastError answers Could not sync …; a clean one says Synced', async () => {
  const bad = { ...structuredClone(MK_LISTS['/api/marketplaces'].marketplaces[1]), lastError: { message: 'unreachable', code: 'UNREACHABLE', at: '2026-11-14T12:00:01.000Z' } };
  const r = await ready(rig({ answer: (m, u) => (u === '/api/marketplaces/team-plugins/refresh' ? [200, { ok: true, marketplace: bad }] : null) }));
  assert.deepEqual(await r.live.sync('team-plugins'), { ok: false, text: 'Could not sync team/plugins: unreachable' });
  const ok = await ready(rig({ answer: (m, u) => (u === '/api/marketplaces/team-plugins/refresh' ? [200, { ok: true, marketplace: MK_LISTS['/api/marketplaces'].marketplaces[1] }] : null) }));
  assert.deepEqual(await ok.live.sync('team-plugins'), { ok: true, text: 'Synced team/plugins: 1 plugin' });
});

test('addSource: a market goes to its source way, a linked folder to its plugin, a refusal says why', async () => {
  const m = { id: 'acme-x', name: 'acme/x', url: 'https://github.com/acme/x', lastSync: { sha: SHA, at: '2026-11-14T12:00:00.000Z' }, plugins: [] };
  const r = await ready(rig({ answer: (me, u, b) => (u === '/api/marketplaces' && me === 'POST' ? (b.url === 'acme/x' ? [200, { ok: true, marketplace: m }] : b.url === './mine' ? [200, { ok: true, linked: true, plugin: { ok: true, name: 'mine' } }] : [409, { error: 'marketplace already added: x', code: 'EXISTS' }]) : null) }));
  assert.deepEqual(await r.live.addSource('acme/x'), { ok: true, text: 'Added acme/x: no plugins from it yet', to: 'marketplace/~src-acme-x' });
  assert.deepEqual(await r.live.addSource('./mine'), { ok: true, text: 'Linked mine', to: 'marketplace/mine' });
  assert.deepEqual(await r.live.addSource('o/dup'), { ok: false, text: 'Could not add o/dup: marketplace already added: x' });
});

test('deferRemoveSource sends no DELETE before the window and none on undo; the source is hidden meanwhile', async () => {
  const r = await ready(rig());
  const u = r.live.deferRemoveSource('team-plugins', 5000);
  assert.equal(r.writes().length, 0); assert.equal(r.timers[0].ms, 5000);
  assert.ok(!r.live.data().markets.some((m) => m.id === 'team-plugins'), 'hidden while it waits');
  assert.equal(u.undo(), true); r.fire();
  assert.equal(r.writes().length, 0, 'undo sends nothing');
  assert.ok(r.live.data().markets.some((m) => m.id === 'team-plugins'), 'back');
  r.live.deferRemoveSource('team-plugins', 5000); r.fire(); await tick(); await tick();
  assert.deepEqual(r.writes().map((c) => [c.method, c.url]), [['DELETE', '/api/marketplaces/team-plugins']]);
});

test('setupFields reads the config; saveSetup PUTs only typed values, one target per Save', async () => {
  const r = await ready(rig());
  const f = await r.live.setupFields('jira-source');
  assert.deepEqual(f.fields.map((x) => [x.label, x.group, x.where]), [['Jira API token', 'source|jira', 'the jira source'], ['Jira site', 'source|jira', 'the jira source']]);
  const v = { [fieldKey(f.fields[0])]: 'tok', [fieldKey(f.fields[1])]: '' };
  assert.deepEqual(await r.live.saveSetup('jira-source', v), { ok: true, text: 'Jira is set up' });
  assert.deepEqual(r.writes().map((c) => [c.method, c.url, c.body]), [['PUT', '/api/plugins/jira-source/config', { sourceId: 'jira', values: { apiToken: 'tok' } }]]);
  assert.deepEqual(await r.live.saveSetup('jira-source', {}), { ok: false, text: 'Nothing to save for Jira: type a value first' });
  assert.equal(r.writes().length, 1, 'nothing typed sends nothing');
  // two targets: each Save sends its own target only, so a refusal on the channel changes nothing
  const lists = structuredClone(MK_LISTS);
  lists['/api/plugins/jira-source/config'].channels = [{ id: 'ch', displayName: 'Ch', platform: 'x', schema: [{ key: 'bot', label: 'Bot', secret: true, required: true }], values: { bot: { set: false } } }];
  const x = await ready(rig({ lists, answer: (m, u, b) => (m === 'PUT' && b.channelId === 'ch' ? [400, { error: 'bad token' }] : null) }));
  const g = (await x.live.setupFields('jira-source')).fields, all = Object.fromEntries(g.map((y) => [fieldKey(y), 'v']));
  assert.deepEqual(await x.live.saveSetup('jira-source', all, 'channel|ch'), { ok: false, text: 'Could not set up jira-source: bad token' });
  assert.deepEqual(x.writes().map((c) => c.body.channelId || c.body.sourceId), ['ch'], 'only the channel was sent');
  await x.live.saveSetup('jira-source', all);
  assert.deepEqual(x.writes().slice(1).map((c) => c.body.sourceId), ['jira'], 'the default Save is the first target only');
});

test('saveSetup: never "is set up" while dev still reads Needs set-up', async () => {
  const r = await ready(rig());   // the lists keep seed-setup's setup.ok false
  const f = (await r.live.setupFields('seed-setup')).fields;
  assert.deepEqual(await r.live.saveSetup('seed-setup', { [fieldKey(f[0])]: 'tok' }), { ok: true, more: true, text: 'Saved the seed source: Seed tracker still needs set-up' });
});

test('saveSetup: a refused PUT deletes the profile that Save made; a refused delete names the profile kept', async () => {
  const lists = structuredClone(MK_LISTS);
  lists['/api/plugins/seed-setup/config'].sources[0] = { ...lists['/api/plugins/seed-setup/config'].sources[0], multiProfile: true, profile: null, profiles: [] };
  const run = async (del) => {
    const r = await ready(rig({ lists, answer: (m) => (m === 'PUT' ? [400, { error: 'token: too short' }] : m === 'DELETE' ? del : m === 'POST' ? [200, { ok: true, profile: { id: 'main', label: 'Default' } }] : null) }));
    const f = (await r.live.setupFields('seed-setup')).fields;
    const a = await r.live.saveSetup('seed-setup', { [fieldKey(f[0])]: 'x' });
    return { a, w: r.writes().map((c) => [c.method, c.url]) };
  };
  const ok = await run(null);
  assert.deepEqual(ok.a, { ok: false, text: 'Could not set up seed-setup: token: too short' });
  assert.deepEqual(ok.w, [['POST', '/api/plugins/seed-setup/profiles'], ['PUT', '/api/plugins/seed-setup/config'], ['DELETE', '/api/plugins/seed-setup/profiles/main?sourceId=seed']]);
  const kept = await run([500, { error: 'disk full' }]);
  assert.deepEqual(kept.a, { ok: false, text: 'Could not set up seed-setup: token: too short (its new profile main was kept: disk full)' });
});

test('saveSetup: a multi-profile source with no profile and nothing to type makes its first profile alone', async () => {
  const lists = structuredClone(MK_LISTS);
  lists['/api/plugins/seed-setup/config'].sources[0] = { id: 'seed', schema: [{ key: 'jql', label: 'Filter', required: false }], multiProfile: true, profile: null, profiles: [], values: {} };
  const r = await ready(rig({ lists }));
  const f = (await r.live.setupFields('seed-setup')).fields;
  assert.deepEqual(f.map((x) => [x.profileOnly, x.label]), [[true, 'A first profile for seed']]);
  const a = await r.live.saveSetup('seed-setup', {});
  assert.equal(a.ok, true);
  assert.deepEqual(r.writes().map((c) => [c.method, c.url, c.body]), [['POST', '/api/plugins/seed-setup/profiles', { sourceId: 'seed', id: 'main', label: 'Default' }]]);
});

test('saveSetup: a multi-profile source with no profile first POSTs one; a double press sends one PUT', async () => {
  const lists = structuredClone(MK_LISTS);
  lists['/api/plugins/seed-setup/config'].sources[0] = { ...lists['/api/plugins/seed-setup/config'].sources[0], multiProfile: true, profile: null, profiles: [] };
  let release; const held = new Promise((res) => { release = res; });
  const r = await ready(rig({ lists, answer: async (m) => { if (m === 'PUT') await held; return null; } }));
  const f = (await r.live.setupFields('seed-setup')).fields;
  const v = { [fieldKey(f[0])]: 's3cret' };
  const one = r.live.saveSetup('seed-setup', v); await tick(); await tick();
  assert.equal(r.live.pending('seed-setup'), 'setup');
  assert.deepEqual(await r.live.saveSetup('seed-setup', v), { ok: false, text: '' });
  release(); await one;
  assert.deepEqual(r.writes().map((c) => [c.method, c.url, c.body]), [
    ['POST', '/api/plugins/seed-setup/profiles', { sourceId: 'seed', id: 'main', label: 'Default' }],
    ['PUT', '/api/plugins/seed-setup/config', { sourceId: 'seed', profile: 'main', values: { token: 's3cret' } }],
  ]);
});

test('openSource opens the installed pin\'s webUrl, or the market snapshot\'s; openMarket the market on GitHub', async () => {
  const r = await ready(rig({ answer: (m, u) => (u === '/api/plugins/jira-source' ? [200, { webUrl: 'https://github.com/SinishaDjukic/worca-cc/tree/0123/plugins/jira-source' }] : null) }));
  await r.live.openSource('jira-source');
  await r.live.openSource('slack-chat');
  await r.live.openMarket('team-plugins');
  assert.deepEqual(r.opened, ['https://github.com/SinishaDjukic/worca-cc/tree/0123/plugins/jira-source', `https://github.com/SinishaDjukic/worca-cc/tree/${SHA}/plugins/slack-chat`, `https://github.com/team/plugins/tree/9a8b7c6d5e4f30219a8b7c6d5e4f30219a8b7c6d`]);
});

test('refresh reads both lists again once started; nothing before', async () => {
  const r = rig();
  assert.equal(await r.live.refresh(), false);
  assert.equal(r.calls.length, 0);
  await r.live.load(); const n = r.calls.length;
  await r.live.refresh();
  assert.ok(r.calls.slice(n).some((c) => c.url === '/api/plugins'));
});

// the first sync (#1298): dev seeds the builtin with lastSync: null and never syncs it
const fresh = (edit = (ms) => ms) => { const l = structuredClone(MK_LISTS); l['/api/marketplaces'].marketplaces = edit(l['/api/marketplaces'].marketplaces.map((m) => (m.builtin ? { ...m, lastSync: null, plugins: [] } : m))); return l; };
const settleAll = async () => { for (let i = 0; i < 10; i++) await tick(); };

test('a never-synced builtin is synced once after the first read: one POST to /api/marketplaces/:id/refresh, then a re-read', async () => {
  const r = rig({ lists: fresh() });
  await r.live.load();
  assert.equal(r.live.firstSyncing(), true, 'the sync is in flight');
  await settleAll();
  assert.deepEqual(r.writes().map((c) => [c.method, c.url]), [['POST', '/api/marketplaces/worca-official/refresh']]);
  const after = r.calls.slice(r.calls.findIndex((c) => c.method === 'POST') + 1).map((c) => c.url);
  assert.ok(after.includes('/api/marketplaces') && after.includes('/api/plugins'), 'both lists read again after it');
  await r.live.refresh(); await settleAll();
  assert.equal(r.writes().length, 1, 'never a second time in the same page load');
  assert.equal(r.live.firstSyncing(), false, 'tried and answered: the page draws the catalogue, or No plugins yet');
  assert.deepEqual(r.toasts, [], 'no toast');
});

test('a synced builtin, a never-synced added source and a needsGit builtin send no sync', async () => {
  const added = rig({ lists: fresh((ms) => ms.map((m) => (m.builtin ? { ...m, lastSync: { sha: SHA, at: '2026-11-14T10:00:00.000Z' } } : { ...m, lastSync: null }))) });
  await added.live.load(); await settleAll();
  assert.deepEqual(added.writes(), []);
  assert.equal(added.live.firstSyncing(), false);
  const git = rig({ lists: fresh((ms) => ms.map((m) => (m.builtin ? { ...m, needsGit: true } : m))) });
  await git.live.load(); await settleAll();
  assert.deepEqual(git.writes(), []);
  assert.equal(git.live.firstSyncing(), false);
});

test('a failed first sync is not retried on the next refresh, and firstSyncing() is false after it', async () => {
  const lists = fresh();
  const r = rig({ lists, answer: (m, u) => { if (m === 'POST') { lists['/api/marketplaces'].marketplaces[0].lastError = { message: 'git clone failed', at: '2026-11-15T10:00:00.000Z' }; return [200, { marketplace: lists['/api/marketplaces'].marketplaces[0] }]; } return null; } });
  await r.live.load(); await settleAll();
  assert.equal(r.writes().length, 1);
  assert.equal(r.live.firstSyncing(), false, 'tried and answered: no longer loading');
  assert.equal(r.live.data().markets[0].error, 'git clone failed', 'the failure shows through the market');
  await r.live.refresh(); await settleAll();
  assert.equal(r.writes().length, 1, 'not retried');
  assert.deepEqual(r.toasts, []);
});
