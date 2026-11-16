// test/stillhet-marketplace-host-actions.test.mjs — Stillhet's Marketplace actions in the live kind (slice 8 D8–D14): each
// sends dev's route with its body, shows its working label disabled while it is pending (`hold`), and a refusal toasts
// `Could not …` with the card unchanged. No RailWould phrase runs live.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceHost, MK_LISTS, SHA, preview, settle, go, saidText, closeHosts } from './helpers/stillhet-marketplace-host.mjs';

afterEach(closeHosts);
const sent = (calls) => calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]);
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
// every RailWould phrase asked for: none may be, live
const noWould = (win) => { const orig = win.RailWould; win.__would = []; win.RailWould = (ph) => { win.__would.push(ph); return orig(ph); }; };
async function host(o = {}) { const h = await marketplaceHost({ ...o, beforeScripts: (w) => { o.beforeScripts?.(w); } }); noWould(h.w); return h; }
const card = (d, id) => d.querySelector(`[data-mk-card="${id}"]`);

test('Install: confirm, then Installing… disabled while POST /api/plugins/install is pending, with the full sha; then Installed', async () => {
  const g = gate();
  const { w, d, calls } = await host({ hash: '#marketplace/slack-chat', hold: (u) => (u === '/api/plugins/install' ? g.p : null) });
  d.querySelector('[data-mk-step]').click(); await settle(20);
  assert.equal(sent(calls).length, 0, 'nothing before Yes');
  d.querySelector('[data-confirm="yes"]').click(); await settle(30);
  const yes = d.querySelector('[data-confirm="yes"]');
  assert.equal(yes.textContent.trim(), 'Installing…'); assert.equal(yes.disabled, true);
  assert.deepEqual(sent(calls), [['POST', '/api/plugins/install', { repoUrl: 'https://github.com/SinishaDjukic/worca-cc', name: 'slack-chat', sha: SHA, subdir: 'plugins/slack-chat', marketplace: 'worca-official' }]]);
  assert.equal(SHA.length, 40);
  g.open(); await settle(80);
  assert.match(saidText(d), /Installed slack-chat/);
  assert.deepEqual(w.__would, []);
});

test('a 500 install toasts Could not install …, and the card still reads Install', async () => {
  const { w, d } = await host({ hash: '#marketplace/slack-chat', write: (u) => (u === '/api/plugins/install' ? [500, { error: 'setup.node declared but package-lock.json is missing' }] : [200, { ok: true }]) });
  d.querySelector('[data-mk-step]').click(); await settle(20);
  d.querySelector('[data-confirm="yes"]').click(); await settle(80);
  assert.match(saidText(d), /Could not install slack-chat: setup\.node declared/);
  assert.ok(!d.querySelector('[data-confirm]'), 'the form closed');
  await go(w, '#marketplace', 60);
  assert.equal(card(d, 'slack-chat').textContent.trim(), 'Install');
});

test('Update: Updating… disabled through the preview and the apply; the bodies are the preview then the candidate', async () => {
  const gp = gate(), ga = gate();
  let n = 0;
  const { d, calls } = await host({ hash: '#marketplace/~updates', hold: (u) => (u === '/api/plugins/jira-source/update' ? (n++ === 0 ? gp.p : ga.p) : null),
    write: (u, b) => (u === '/api/plugins/jira-source/update' ? (b.confirm ? [200, { ok: true, updated: true, ...preview().preview }] : [200, preview()]) : [200, { ok: true }]) });
  card(d, 'jira-source').click(); await settle(30);
  assert.equal(card(d, 'jira-source').textContent.trim(), 'Updating…'); assert.equal(card(d, 'jira-source').disabled, true);
  gp.open(); await settle(30);
  assert.equal(card(d, 'jira-source').textContent.trim(), 'Updating…', 'still, through the apply');
  assert.deepEqual(sent(calls).map((c) => c[2]), [{}, { confirm: true, candidateSha: SHA }]);
  ga.open(); await settle(80);
  assert.match(saidText(d), /Updated Jira to 0\.2\.0/);
});

test('a 409 update toasts Could not update …; the card still reads Update to 0.2.0 after the lists are read again', async () => {
  const { d } = await host({ hash: '#marketplace/~updates', write: (u, b) => (u === '/api/plugins/jira-source/update' ? (b.confirm ? [409, { error: 'plugin "jira-source" moved on since the preview', code: 'STALE_PREVIEW' }] : [200, preview()]) : [200, { ok: true }]) });
  card(d, 'jira-source').click(); await settle(120);
  assert.match(saidText(d), /Could not update jira-source: plugin "jira-source" moved on/);
  assert.equal(card(d, 'jira-source').textContent.trim(), 'Update to 0.2.0');
});

test('an update that asks for something new asks first; Cancel sends no apply', async () => {
  const { d, calls } = await host({ hash: '#marketplace/~updates', write: (u, b) => (u === '/api/plugins/jira-source/update' ? (b.confirm ? [200, { ok: true, updated: true }] : [200, preview([{ kind: 'secret', id: 'webhookSecret', red: true }])]) : [200, { ok: true }]) });
  card(d, 'jira-source').click(); await settle(120);
  assert.match(d.querySelector('[data-mk-update-asks]')?.textContent || '', /Update jira-source to 0\.2\.0\? It now asks for a secret: webhookSecret\./);
  d.querySelector('[data-confirm="no"]').click(); await settle(30);
  assert.deepEqual(sent(calls).map((c) => c[2]), [{}], 'the preview only');
});

test('Remove: the strip, then Yes, sends DELETE /api/plugins/jira-source', async () => {
  const { d, calls } = await host({ hash: '#marketplace/jira-source' });
  d.querySelector('[data-menu="mk-more"]').click(); await settle(10);
  d.querySelector('[data-menu-pick="mk-more|remove"]').click(); await settle(20);
  assert.match(d.querySelector('.rc-confirm')?.textContent || '', /Remove jira-source\?/);
  assert.equal(sent(calls).length, 0);
  d.querySelector('[data-confirm="yes"]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['DELETE', '/api/plugins/jira-source', undefined]]);
  assert.match(saidText(d), /Removed jira-source/);
});

test('Set up: the fields are the config schema\'s required fields; Save PUTs {sourceId, values}; a double press sends one PUT', async () => {
  const g = gate();
  let saving = false;
  const done = structuredClone(MK_LISTS['/api/plugins']); done.plugins[1].setup = { ok: true, missing: [], noProfiles: [] };
  const { d, calls } = await host({ hash: '#marketplace/seed-setup', hold: (u) => (u === '/api/plugins/seed-setup/config' && saving ? g.p : null), read: (u) => (u === '/api/plugins' && saving ? [200, structuredClone(done)] : null) });
  d.querySelector('[data-mk-step]').click(); await settle(80);
  const fields = [...d.querySelectorAll('[data-mk-field]')];
  assert.deepEqual(fields.map((f) => d.querySelector(`label[for="${f.id}"]`).textContent), ['Seed token']);
  assert.equal(fields[0].type, 'password');
  fields[0].value = 's3cret'; saving = true;
  d.querySelector('[data-confirm="yes"]').click(); await settle(5);
  d.querySelector('[data-confirm="yes"]').click(); await settle(20);
  const puts = sent(calls).filter((c) => c[0] === 'PUT');
  assert.deepEqual(puts, [['PUT', '/api/plugins/seed-setup/config', { sourceId: 'seed', values: { token: 's3cret' } }]]);
  g.open(); await settle(80);
  assert.match(saidText(d), /Seed tracker is set up/);
  assert.ok(!d.querySelector('[data-confirm]'), 'the form closed');
  assert.ok(d.activeElement?.matches('[data-mk-step]'), 'the focus stays on the plugin\'s step');
});

test('Set up while dev still reads Needs set-up: never "is set up"; the form opens again on what is left', async () => {
  const { d } = await host({ hash: '#marketplace/seed-setup' });   // the lists keep setup.ok false
  d.querySelector('[data-mk-step]').click(); await settle(80);
  d.querySelector('[data-mk-field]').value = 's3cret';
  d.querySelector('[data-confirm="yes"]').click(); await settle(150);
  assert.match(saidText(d), /Saved the seed source: Seed tracker still needs set-up/);
  assert.doesNotMatch(saidText(d), /is set up/);
  assert.ok(d.querySelector('[data-mk-field]'), 'the form is open again');
});

test('Needs set-up with nothing to type (a multi-profile source with no profile): Save makes the first profile, never a false "is set up"', async () => {
  const lists = structuredClone(MK_LISTS);
  lists['/api/plugins'].plugins[1].setup = { ok: false, missing: [], noProfiles: ['seed'] };
  lists['/api/plugins/seed-setup/config'].sources[0] = { id: 'seed', schema: [{ key: 'jql', label: 'Filter', required: false }], multiProfile: true, profile: null, profiles: [], values: {} };
  const { d, calls } = await host({ hash: '#marketplace/seed-setup', lists });
  d.querySelector('[data-mk-step]').click(); await settle(80);
  assert.doesNotMatch(saidText(d), /is set up/);
  assert.match(d.querySelector('form.rc-confirm')?.textContent || '', /the seed source needs its first profile, named Default/);
  assert.equal(d.querySelectorAll('[data-mk-field]').length, 0);
  d.querySelector('[data-confirm="yes"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/plugins/seed-setup/profiles', { sourceId: 'seed', id: 'main', label: 'Default' }]]);
});

test('Set up with two targets: one part and one Save each; a refused channel Save sends the channel only', async () => {
  const lists = structuredClone(MK_LISTS);
  lists['/api/plugins/jira-source/config'].channels = [{ id: 'ch', displayName: 'Ch', platform: 'x', schema: [{ key: 'bot', label: 'Bot', secret: true, required: true }], values: { bot: { set: false } } }];
  const { d, calls } = await host({ hash: '#marketplace/jira-source', lists, write: (u, b) => (b?.channelId === 'ch' ? [400, { error: 'bad token' }] : [200, { ok: true }]) });
  d.querySelector('[data-mk-setup]').click(); await settle(80);
  const forms = [...d.querySelectorAll('form.rc-confirm')];
  assert.deepEqual(forms.map((f) => f.querySelector('.rc-confirm-t').textContent), ['Set up Jira, the jira source: what it asks for stays on this machine.', 'Set up Jira, the ch channel: what it asks for stays on this machine.']);
  for (const i of d.querySelectorAll('[data-mk-field]')) i.value = 'v';
  forms[1].querySelector('[data-confirm="yes"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['PUT', '/api/plugins/jira-source/config', { channelId: 'ch', values: { bot: 'v' } }]]);
  assert.match(saidText(d), /Could not set up jira-source: bad token/);
  assert.equal(d.querySelectorAll('form.rc-confirm').length, 2, 'a refusal keeps the form');
});

test('an installed plugin\'s set secret reads Set; type to replace', async () => {
  const { d } = await host({ hash: '#marketplace/jira-source' });
  d.querySelector('[data-mk-setup]').click(); await settle(80);
  const f = [...d.querySelectorAll('[data-mk-field]')];
  assert.deepEqual(f.map((x) => x.placeholder), ['Set; type to replace', '']);
});

test('Sync sends the refresh; Add a source reads Adding… while held; Remove a source then Undo sends no DELETE', async () => {
  const g = gate();
  const added = { id: 'acme-x', name: 'acme/x', url: 'https://github.com/acme/x', lastSync: { sha: SHA, at: '2026-11-14T12:00:00.000Z' }, plugins: [] };
  let adding = false;
  const { d, calls } = await host({ hash: '#marketplace', hold: (u) => (u === '/api/marketplaces' && adding ? (adding = false, g.p) : null),
    write: (u, b, m) => (u === '/api/marketplaces' ? [200, { ok: true, marketplace: added }] : u.endsWith('/refresh') ? [200, { ok: true, marketplace: MK_LISTS['/api/marketplaces'].marketplaces[1] }] : [200, { ok: true }]) });
  d.querySelector('[data-mk-sync="team-plugins"]').click(); await settle(80);
  assert.deepEqual(sent(calls).at(-1), ['POST', '/api/marketplaces/team-plugins/refresh', {}]);
  assert.match(saidText(d), /Synced team\/plugins: 1 plugin/);
  d.querySelector('[data-mk-add]').value = 'acme/x'; adding = true;
  d.querySelector('[data-mk-addgo]').click(); await settle(30);
  const add = d.querySelector('[data-mk-addgo]');
  assert.equal(add.textContent.trim(), 'Adding…'); assert.equal(add.disabled, true);
  assert.deepEqual(sent(calls).at(-1), ['POST', '/api/marketplaces', { url: 'acme/x' }]);
  g.open(); await settle(80);
  const w = d.defaultView; await go(w, '#marketplace', 60);
  d.querySelector('[data-mk-unsource="team-plugins"]').click(); await settle(20);
  assert.ok(!d.querySelector('[data-mk-unsource="team-plugins"]'), 'hidden while the undo window is open');
  [...d.querySelectorAll('body > .rc-toast button')].find((b) => /Undo/.test(b.textContent))?.click(); await settle(20);
  assert.equal(sent(calls).filter((c) => c[0] === 'DELETE').length, 0);
  assert.ok(d.querySelector('[data-mk-unsource="team-plugins"]'), 'back');
});

test('a market\'s URL opens it on GitHub', async () => {
  const { w, d } = await host({ hash: '#marketplace' });
  d.querySelector('[data-mk-market="team-plugins"]').click(); await settle(20);
  assert.deepEqual(w.__opened, [[`https://github.com/team/plugins/tree/${MK_LISTS['/api/marketplaces'].marketplaces[1].lastSync.sha}`, '_blank', 'noopener']]);
  assert.deepEqual(w.__would, []);
});
