// test/ui-secret-vault.test.mjs — the secret vault's UI (docs/secrets.md, docs/design-system.md): the one state model,
// Settings › General › Secret vault over the real index.html, the Secrets at rest posture row, the setup assistant's
// choice and apply step, `worca setup`'s question, the note under secret fields and the proxy card's line. Counts only,
// never a value or a name; one primary per card; green only for a vault that is on; amber only where someone must act.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { vaultModel, kindsLine, secretsAtRestRow } from '../src/shared/secret-vault-view.mjs';
import { securityPosture } from '../src/core/security-posture.mjs';
import { paintSecretVault, loadSecretVaultCard, moveMessage } from '../ui/public/settings/secret-vault-card.mjs';
import { addVaultNote, forgetVaultNoteStatus, VAULT_NOTE_TEXT } from '../ui/public/settings/secret-vault-note.mjs';
import { vaultChoiceSection } from '../ui/public/setup-vault-choice.mjs';
import { buildApplyBody } from '../ui/public/setup-assistant.mjs';
import { sidecarMode, VAULT_LOGIN_NOTE, SIDECAR_NOTE } from '../ui/public/settings-network-proxy.mjs';
import { keyStoreHint, vaultOffer } from '../src/core/secrets/offer.mjs';
import { planSetupApply } from '../src/core/setup/apply.mjs';
import { cmdSetup } from '../src/cli/setup.mjs';

const trackDom = useDomRelease(afterEach);
const counts = (vault = {}, files = {}) => ({ vault: { settings: 0, mcp: 0, plugin: 0, proxy: 0, ...vault }, files: { settings: 0, mcp: 0, plugin: 0, proxy: 0, ...files } });
const st = (over = {}) => ({ backend: 'fake', label: 'macOS Keychain', state: 'ready', vault: 'readable', checkedAt: '2026-11-26T10:00:00.000Z', counts: counts({ settings: 2, mcp: 1 }), ...over });

function page({ flag = true } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const doc = dom.window.document;
  doc.documentElement.dataset.flags = flag ? 'secretVault' : '';
  return { doc, card: doc.getElementById('secret-vault-card') };
}

test('the model: each state has its words, its tone and at most one primary', () => {
  const cases = [
    [st(), 'on', 'On', 'ok', null],
    [st({ vault: 'none', counts: counts({}, { settings: 1 }) }), 'off', 'Off', 'neutral', 'turn-on'],
    [st({ counts: counts({ settings: 1 }, { mcp: 2 }) }), 'interrupted', 'Move not finished', 'attention', 'finish'],
    [st({ state: 'locked', vault: 'unknown' }), 'locked', 'Locked', 'attention', 'check'],
    [st({ state: 'unavailable', vault: 'none', counts: counts() }), 'unavailable', 'No key store', 'attention', 'check'],
    [st({ vault: 'unreadable' }), 'unreadable', 'Unreadable', 'attention', 'reset'],
    [{ state: 'container', label: 'Not available in a container' }, 'container', 'Not available', 'neutral', null],
  ];
  for (const [s, state, value, tone, primary] of cases) {
    const m = vaultModel(s, s.counts || {});
    assert.deepEqual([m.state, m.value, m.tone, m.primary], [state, value, tone, primary], state);
  }
  assert.equal(kindsLine(counts({ settings: 2, mcp: 1, proxy: 1 }).vault), '2 provider and model keys, 1 MCP secret, 1 proxy login');
});

test('Settings card: in the General pane after Security; hidden and never fetched with the flag off', async () => {
  const off = page({ flag: false });
  assert.equal(off.card.closest('.settings-pane').dataset.tab, 'general');
  assert.equal(off.card.previousElementSibling.id, 'security-card');
  assert.equal(off.card.dataset.flag, 'secretVault');
  let fetched = 0;
  await loadSecretVaultCard(off.doc, { json: async () => { fetched++; return {}; } });
  assert.equal(fetched, 0);
  assert.equal(off.card.hidden, true);
  assert.equal(off.doc.getElementById('aboutSecretsRow'), null, 'the About row is gone: the card absorbed it');
});

test('Settings card: rows, one badge each, counts by kind, the time only in a tooltip, one primary', () => {
  const { card } = page();
  for (const s of [st(), st({ vault: 'none', counts: counts({}, { settings: 1 }) }), st({ counts: counts({ settings: 1 }, { plugin: 1 }) }), st({ vault: 'unreadable' })]) {
    paintSecretVault(card, s, { now: Date.parse('2026-11-26T10:05:00Z') });
    assert.ok(card.querySelectorAll('.btn-primary').length <= 1);
    for (const row of card.querySelectorAll('.sv-row')) assert.ok(row.querySelector('.drow-label'));
    for (const b of card.querySelectorAll('.badge')) assert.match(b.className, /\b(green|grey|amber)\b/);
    const visible = card.querySelector('#secretVaultBody').textContent;
    assert.ok(!visible.includes('2026-11-26'), 'no raw timestamp in visible text');
    assert.ok(!/openai|sk-/.test(visible), 'no key name or value');
  }
  paintSecretVault(card, st(), { now: Date.parse('2026-11-26T10:05:00Z') });
  assert.equal(card.querySelector('[data-row="state"] .badge').className.includes('green'), true, 'green only for a vault that is on');
  assert.equal(card.querySelector('[data-row="vault"] .drow-help').textContent, '2 provider and model keys, 1 MCP secret');
  assert.equal(card.querySelector('[data-row="checked"]').title, '2026-11-26T10:00:00.000Z');
  assert.equal(card.querySelector('[data-row="checked"] .sv-when').textContent, '5 min ago');
  assert.deepEqual([...card.querySelectorAll('.sv-actions button')].map((b) => b.textContent), ['Check now', 'Export to files']);
  paintSecretVault(card, st({ vault: 'none', counts: counts({}, { settings: 1 }) }));
  assert.deepEqual([...card.querySelectorAll('.sv-actions button')].map((b) => [b.textContent, b.classList.contains('btn-primary')]), [['Turn on', true], ['Check now', false]]);
  paintSecretVault(card, { state: 'container' });
  assert.equal(card.querySelector('.sv-actions'), null, 'no action in a container');
  assert.match(card.textContent, /credential broker/i);
});

test('Turn on: the confirm says what moves; a refusal shows in the card alert and survives the repaint', async () => {
  const { doc, card } = page();
  const asked = [];
  let enabled = 0;
  const json = async (url, body) => {
    if (url === '/api/secrets/status') return st({ vault: 'none', counts: counts({}, { settings: 2, proxy: 1 }) });
    if (url === '/api/secrets/notice') return { notice: null };
    if (url === '/api/secrets/enable') { enabled++; assert.deepEqual(body, { confirm: true }); throw Object.assign(new Error('x'), { body: { error: 'macOS Keychain did not pass its write and read check, so nothing was moved.' } }); }
    throw new Error(url);
  };
  await loadSecretVaultCard(doc, { json, confirm: async (o) => { asked.push(o); return true; }, notify: () => {} });
  card.querySelector('[data-act="turn-on"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(enabled, 1);
  assert.match(asked[0].message, /2 provider and model keys, 1 proxy login/);
  assert.match(card.querySelector('.card-alert').textContent, /Keys not moved.*Nothing changed/s);
  assert.match(moveMessage(st({ counts: counts({}, { mcp: 1 }) })), /1 MCP secret/);
});

test('Export: a danger confirm with the warning, then the command to copy; no request is sent', async () => {
  const { doc, card } = page();
  const urls = [];
  let opts = null;
  await loadSecretVaultCard(doc, { json: async (u) => { urls.push(u); return u === '/api/secrets/notice' ? { notice: null } : st(); },
    confirm: async (o) => { opts = o; return true; }, notify: () => {} });
  card.querySelector('[data-act="export"]').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(opts.danger, true);
  assert.match(JSON.stringify(opts.message), /plain text/);
  assert.equal(card.querySelector('.sv-export .copy-btn-text').textContent, 'worca secrets export');
  assert.deepEqual(urls, ['/api/secrets/status', '/api/secrets/notice'], 'export has no HTTP door');
});

test('Secrets at rest: Vault (green) natively, Files (0600) without it, files in a container; no row with the flag off', () => {
  assert.equal(secretsAtRestRow({ where: 'native', flagOn: false, vaultOn: false }), null);
  assert.deepEqual([secretsAtRestRow({ where: 'native', flagOn: true, vaultOn: true }).value, secretsAtRestRow({ where: 'native', flagOn: true, vaultOn: true }).tone], ['Vault', 'ok']);
  assert.equal(secretsAtRestRow({ where: 'native', flagOn: true, vaultOn: false }).value, 'Files (0600)');
  assert.match(secretsAtRestRow({ where: 'hardened', flagOn: true, vaultOn: false }).detail, /not available in a container/);
  const p = securityPosture({ env: {}, secretVault: { flagOn: true, vaultOn: true } });
  assert.equal(p.rows.at(-1).id, 'secrets');
  assert.equal(securityPosture({ env: {} }).rows.some((r) => r.id === 'secrets'), false, 'flag off: unchanged');
});

test('detection asks no key store: the hint and the offer read only the place, the flag, the fake state and the files', () => {
  assert.equal(keyStoreHint({ env: { NODE_TEST_CONTEXT: 'child-v8' } }).usable, false, 'a test never reaches the real store');
  assert.equal(keyStoreHint({ env: { WORCA_BOX: 'hardened' } }).reason, 'container');
  assert.equal(keyStoreHint({ env: {}, platform: 'darwin', keyring: () => ({}) }).label, 'macOS Keychain');
  assert.equal(keyStoreHint({ env: {}, platform: 'darwin', keyring: () => null }).usable, false);
  assert.equal(vaultOffer({ env: { WORCA_CONTAINER: '1' } }).state, 'container');
});

test('setup assistant: the choice shows only with an offer; Move sends access.vault, which plans the vault-move step', async () => {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = dom.window.document;
  const section = (t, h, ...c) => { const s = doc.createElement('section'); s.dataset.title = t; s.append(...c); return s; };
  const seg = (opts, value) => { const d = doc.createElement('div'); d.dataset.value = value; d.textContent = opts.map((o) => o[1]).join('|'); return d; };
  assert.equal(vaultChoiceSection({ doc, vault: null, seg, section }), null);
  assert.equal(vaultChoiceSection({ doc, vault: { state: 'container' }, seg, section }), null);
  const s = vaultChoiceSection({ doc, vault: { offer: true, state: 'off', label: 'macOS Keychain', inFiles: 3 }, value: undefined, onPick: () => {}, seg, section });
  assert.equal(s.querySelector('div').dataset.value, 'keep', 'skippable: Keep in files is the default');
  assert.match(s.textContent, /3 saved secrets stay/);
  assert.ok(s.querySelector('a[href*="secrets.md"]'));
  const on = vaultChoiceSection({ doc, vault: { offer: false, state: 'on', label: 'macOS Keychain' }, seg, section });
  assert.match(on.textContent, /^On · /m);
  const answers = { network: { mode: 'direct' }, access: { claude: true, copilot: false, openai: false, anthropic: false, importModels: [], vault: 'move' },
    models: { modelRoles: {}, testRoles: false }, work: {} };
  assert.equal(buildApplyBody({ providers: {}, settings: {} }, answers).access?.vault, 'move');
  const plan = await planSetupApply({ access: { vault: 'move' } }, { readSettings: () => ({}), checkProxy: async () => ({}) });
  assert.deepEqual(plan.steps.map((x) => x.id), ['vault-move']);
  await assert.rejects(planSetupApply({ access: { vault: 'yes' } }, { readSettings: () => ({}), checkProxy: async () => ({}) }), (e) => e.field === 'access.vault');
});

test('worca setup: asks once when there is something to move; y adds the vault-move step', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Readable, Writable } = await import('node:stream');
  const file = join(mkdtempSync(join(tmpdir(), 'worca-setup-vault-')), 'team.json');
  writeFileSync(file, JSON.stringify({ version: 1, fields: {} }));
  const asked = [];
  const prompt = new Writable({ write(c, _e, cb) { asked.push(String(c)); cb(); } });
  const input = Readable.from(['\n'.repeat(9) + 'n\n']);
  const out = [];
  await cmdSetup(['--from', file], { out: (s) => out.push(s), err: () => {}, input, prompt, settings: () => ({}),
    catalog: async () => [], claudeAuth: async () => 'signed-in', vault: async () => ({ offer: true, inFiles: 2, label: 'macOS Keychain' }) });
  assert.ok(asked.some((q) => /Move the 2 saved secrets into the secret vault \(key in macOS Keychain\)\? \[y\/N\]/.test(q)), asked.join(''));
});

test('the field note: shown while the vault takes saves, never in a container or with the flag off', async () => {
  for (const [state, want] of [['ready', true], ['container', false], ['locked', false]]) {
    forgetVaultNoteStatus();
    const { doc } = page();
    const wrap = doc.createElement('div'); const input = doc.createElement('input'); wrap.append(input); doc.body.append(wrap);
    addVaultNote(input, { fetchFn: async () => ({ ok: true, json: async () => ({ state, vault: 'readable' }) }) });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(wrap.querySelector('.sv-field-note')?.textContent === VAULT_NOTE_TEXT, want, state);
  }
  forgetVaultNoteStatus();
  const { doc } = page({ flag: false });
  const wrap = doc.createElement('div'); const input = doc.createElement('input'); wrap.append(input);
  addVaultNote(input, { fetchFn: async () => { throw new Error('fetched'); } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(wrap.querySelector('.sv-field-note'), null);
  forgetVaultNoteStatus();
});

test('proxy card: natively with the login in the vault it says so; in a container it keeps saying the sidecar', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = dom.window.document;
  const f = { where: doc.createElement('small'), loginRows: [], fixedRow: null, login: {}, logout: {}, save: {}, detect: {}, test: {}, enabled: {}, host: {}, port: {}, auth: { value: 'auto' }, noProxy: {}, connectS: {}, authS: {}, idleS: {} };
  sidecarMode(f, { loginInVault: true });
  assert.deepEqual([f.where.hidden, f.where.textContent], [false, VAULT_LOGIN_NOTE]);
  sidecarMode(f, { sidecar: true, loginInVault: true });
  assert.equal(f.where.textContent, SIDECAR_NOTE);
  sidecarMode(f, {});
  assert.equal(f.where.hidden, true);
});
