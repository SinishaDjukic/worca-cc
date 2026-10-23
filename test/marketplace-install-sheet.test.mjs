// test/marketplace-install-sheet.test.mjs — P4: the install sheet controller over P3's createSheet with injected deps.
// Review → Install (busy, failures in the sheet, git-free), Set up (one PUT per section), Done (chips, test message, links).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { createInstallSheet } from '../ui/public/marketplace/install-sheet.mjs';
import { createSheet } from '../ui/public/marketplace/layers.mjs';
import { SLACK, ATLASSIAN, AZURE, SLACK_CONFIG, AZURE_CONFIG, GH_SOURCE, EMPTY_CONFIG, SHA, MKTS, F, INV, item, ok, fakeApi, fakePage, settle } from './helpers/marketplace-install-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
function world({ routes = {}, page = fakePage(), confirm = true } = {}) {
  const { window } = trackDom(new JSDOM('<!doctype html><body><button type="button" class="mk-tile" data-key="official/slack-chat">slack-chat</button></body>',
    { url: 'http://localhost/#marketplace' }));
  const doc = window.document;
  const { api, calls } = fakeApi(routes);
  const notes = [];
  const deps = { api, notify: (n) => { notes.push(n); }, confirmModal: async () => confirm, gitOn: () => true,
    invalidateAgentCaches: () => { calls.push(['invalidate']); } };
  return { window, doc, page, calls, notes, sheet: createInstallSheet({ doc, win: window, page, deps }) };
}
const foot = (doc) => [...doc.querySelectorAll('#mk-sheet .mk-sheet-foot [data-act]')].map((b) => b.textContent);
const closeBtn = (doc) => doc.querySelector('#mk-sheet .mk-close');   // P3's layer closeButton
const step = (doc) => doc.querySelector('#mk-sheet .mk-step[aria-current="step"] .mk-step-label')?.textContent;
const act = (doc, a) => doc.querySelector(`#mk-sheet [data-act="${a}"]`);
const posts = (calls, url) => calls.filter(([m, u]) => m === 'POST' && u === url);
const INSTALL = { repoUrl: 'https://github.com/SinishaDjukic/worca-cc', subdir: 'plugins/slack-chat', name: 'slack-chat', sha: SHA, marketplace: 'official' };
const gate = () => { let release; const p = new Promise((r) => { release = r; }); return { p, release }; };
const esc = async (doc) => { doc.getElementById('mk-sheet').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(); };
const discardAsked = (doc) => !!doc.querySelector('dialog.discard-modal');
// P6 stand-in: another createSheet controller takes the shared host (SM21/SM55).
function takeOver(doc, window) {
  const s = createSheet({ doc, win: window });
  s.panel.dataset.mode = 'manage';
  const body = doc.createElement('div'); body.className = 'p6-body'; body.textContent = 'P6';
  s.replace({ head: doc.createElement('div'), body, foot: [] }); s.open();
  return s;
}
const TG = item('telegram-chat', { iconKind: 'chatChannels', inventory: INV({ chatChannels: [{ id: 'main', displayName: 'Telegram', secrets: [] }] }) });
const GH = item('github-source', { iconKind: 'taskSources', inventory: INV({ taskSources: [{ id: 'github', displayName: 'GitHub', secrets: ['token'] }] }) });

test('open: Review for a not-installed item; installed → openManage; { name, marketplace } resolves; unknown → toast', async () => {
  await checkRows([
    { name: 'Review', run: () => {
      const { doc, sheet } = world();
      doc.querySelector('.mk-tile').focus();
      assert.equal(sheet.open(SLACK), true);
      const panel = doc.getElementById('mk-sheet');
      assert.deepEqual([panel.dataset.mode, panel.getAttribute('aria-labelledby'), doc.getElementById('mk-sheet-title').textContent, step(doc), foot(doc), sheet.isOpen()],
        ['install', 'mk-sheet-title', 'slack-chat', 'Review', ['Cancel', 'Install'], true]);
      assert.deepEqual([act(doc, 'cancel').className, act(doc, 'install').className], ['btn btn-quiet', 'btn btn-primary']);
    } },
    { name: 'installed → the manage action, no sheet', run: () => {
      const { doc, sheet, page } = world();
      assert.equal(sheet.open({ ...SLACK, installed: true }), false);
      assert.deepEqual([doc.getElementById('mk-sheet'), page.calls], [null, [['act', 'openManage', 'slack-chat']]]);
    } },
    { name: '{ name, marketplace } by id, name or url hint, else the first match', run: () => {
      for (const marketplace of ['official', 'Worca CC Official', 'https://github.com/SinishaDjukic/worca-cc', '', 'other']) {
        const { doc, sheet } = world();
        assert.equal(sheet.open({ name: 'slack-chat', marketplace }), true, String(marketplace));
        assert.equal(doc.getElementById('mk-sheet-title').textContent, 'slack-chat');
      }
    } },
    { name: 'unknown plugin: today\'s not-found toast, no sheet', run: () => {
      const { doc, sheet, notes } = world();
      assert.equal(sheet.open({ name: 'ghost', marketplace: 'acme' }), false);
      assert.deepEqual([doc.getElementById('mk-sheet'), notes], [null, [{ tone: 'err', title: 'ghost', detail: 'not found in a synced marketplace — refresh marketplaces (the policy names acme).' }]]);
    } },
    { name: 'an installed plugin no synced marketplace lists any more: Manage, no toast', run: () => {
      const page = fakePage(); page.state.plugins = [{ name: 'ghost' }];
      const { doc, sheet, notes } = world({ page });
      assert.deepEqual([sheet.open({ name: 'ghost', marketplace: 'acme' }), doc.getElementById('mk-sheet'), notes, page.calls], [false, null, [], [['act', 'openManage', 'ghost']]]);
    } },
    { name: 'SM70: leaving #marketplace closes the sheet; a Marketplace tab change keeps it', run: async () => {
      const { window, sheet } = world();
      sheet.open(SLACK);
      window.location.hash = '#marketplace/installed'; await settle();
      assert.equal(sheet.isOpen(), true);
      window.location.hash = '#runs'; await settle();
      assert.equal(sheet.isOpen(), false);
    } },
    { name: 'Cancel and Close close the sheet; focus returns to the live tile with the same key', run: async () => {
      const { doc, sheet } = world();
      doc.querySelector('.mk-tile').focus(); sheet.open(SLACK);
      const fresh = doc.createElement('button'); fresh.type = 'button'; fresh.className = 'mk-tile'; fresh.dataset.key = 'official/slack-chat';
      doc.querySelector('.mk-tile').replaceWith(fresh);          // the page re-rendered Browse under the sheet
      act(doc, 'cancel').click(); await settle();
      assert.deepEqual([sheet.isOpen(), doc.activeElement === fresh], [false, true]);
      sheet.open(SLACK); closeBtn(doc).click(); await settle();
      assert.equal(sheet.isOpen(), false);
    } },
    { name: 'Safari: a click leaves focus on <body>, so the opener is the tile with the item\'s key (review B m-P4-4)', run: async () => {
      const { doc, sheet } = world();
      doc.body.focus(); sheet.open(SLACK);
      act(doc, 'cancel').click(); await settle();
      assert.equal(doc.activeElement, doc.querySelector('.mk-tile[data-key="official/slack-chat"]'));
    } },
    { name: 'a hint picks that marketplace\'s copy of a name two marketplaces share', run: () => {
      const acme = { id: 'acme', name: 'Acme', stale: false, snapshotAt: null };
      const page = fakePage({ catalog: [SLACK, item('slack-chat', { marketplace: acme, version: '9.9.9' })],
        marketplaces: [...MKTS, { id: 'acme', name: 'Acme', url: 'https://github.com/acme/m', lastSync: { sha: SHA, at: null }, plugins: [], warnings: [] }] });
      for (const marketplace of ['acme', 'Acme', 'https://github.com/acme/m']) {
        const { doc, sheet } = world({ page });
        sheet.open({ name: 'slack-chat', marketplace });
        assert.equal(doc.querySelector('#mk-sheet .mk-sheet-id .mk-meta').textContent, '9.9.9 · Acme', marketplace);
      }
    } },
    { name: 'SM55: while the shared panel is in another mode, P4 ignores its clicks', run: () => {
      const { doc, sheet } = world();
      sheet.open(SLACK);
      doc.getElementById('mk-sheet').dataset.mode = 'manage';
      act(doc, 'cancel').click();
      assert.deepEqual([doc.getElementById('mk-sheet-host').classList.contains('hidden'), sheet.isOpen()], [false, false]);
    } },
    { name: 'an item without a snapshot sha: Review with Cancel only, no "@" line, the head shows the version or nothing (m-P4-2)', run: () => {
      const { doc, sheet, calls } = world();
      sheet.open({ ...SLACK, version: null, source: { ...SLACK.source, sha: null } });
      assert.deepEqual([foot(doc), doc.querySelector('#mk-sheet .mk-src-sha'), doc.querySelector('#mk-sheet .mk-sheet-id .mk-meta').textContent, calls.length],
        [['Cancel'], null, 'Worca CC Official', 0]);
    } },
  ]);
});

test('Install: one POST with the snapshot pin, busy while it runs (Escape held), then Set up; caches dropped, page reloaded', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { doc, window, sheet, calls, page } = world({ routes: {
    'POST /api/plugins/install': async () => { await gate; return ok({ ok: true, inventory: {}, warnings: [], ignored: [] }); },
    'GET /api/plugins/slack-chat/config': () => ok(SLACK_CONFIG) } });
  sheet.open(SLACK);
  act(doc, 'install').click(); await settle();
  assert.deepEqual([step(doc), act(doc, 'install').dataset.fbState, act(doc, 'install').textContent, act(doc, 'cancel').disabled, closeBtn(doc).disabled],
    ['Install', 'busy', 'Installing…', true, true]);
  assert.equal(doc.activeElement, doc.getElementById('mk-sheet'), 'busy: focus parks on the panel — Chromium drops it from the disabled Install to <body> (M4)');
  doc.getElementById('mk-sheet').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
  assert.equal(sheet.isOpen(), true, 'busy: Escape does not close');
  release(); await settle();
  assert.deepEqual(posts(calls, '/api/plugins/install').map(([, , b]) => b), [INSTALL]);
  assert.deepEqual([step(doc), foot(doc)], ['Set up', ['Skip for now', 'Save']]);
  assert.equal(doc.activeElement, doc.querySelector('#mk-sheet [data-key="botToken"]'), 'Set up focuses its first field');
  assert.deepEqual([page.calls, calls.some(([m]) => m === 'invalidate')], [[['load', null]], true]);
});

test('Install failures stay inside the sheet', async () => {
  const run = async (answer, { marketplaces = MKTS } = {}) => {
    const w = world({ page: fakePage({ marketplaces }), routes: { 'POST /api/plugins/install': () => answer } });
    w.sheet.open(SLACK); act(w.doc, 'install')?.click(); await settle();
    return w;
  };
  const wash = (doc) => doc.querySelector('#mk-sheet .mk-wash-bad[role="alert"]')?.textContent ?? null;
  await checkRows([
    { name: 'a server error leads the Review; Install stays current; Try again posts again', run: async () => {
      const { doc, notes, calls } = await run({ ok: false, status: 500, data: { error: 'tarball download failed: 503 Service Unavailable' } });
      assert.deepEqual([wash(doc), step(doc), foot(doc), notes], ['tarball download failed: 503 Service Unavailable', 'Install', ['Cancel', 'Try again'], []]);
      assert.equal(doc.activeElement, act(doc, 'install'), 'focus stays in the sheet, on Try again (review B M4)');
      act(doc, 'install').click(); await settle();
      assert.equal(posts(calls, '/api/plugins/install').length, 2);
    } },
    { name: 'no message: "install failed"', run: async () => assert.equal(wash((await run({ ok: false, status: 500, data: {} })).doc), 'install failed') },
    { name: 'a sha the remote no longer has: the stale-snapshot sentence', run: async () => {
      for (const error of ['fatal: not a valid object name 735b354', `Command failed: git archive\nfatal: not a tree object: ${SHA}`]) {
        assert.equal(wash((await run({ ok: false, status: 500, data: { error } })).doc), 'This plugin snapshot is stale — Refresh the marketplace and try again.', error);
      }
    } },
    { name: 'already installed (a stale catalog): the page reloads, the sheet closes, Manage opens', run: async () => {
      const { sheet, page, notes } = await run({ ok: false, status: 500, data: { error: 'plugin "slack-chat" is already installed' } });
      assert.deepEqual([sheet.isOpen(), page.calls, notes], [false, [['load', null], ['act', 'openManage', 'slack-chat']], []]);
    } },
    { name: 'GIT_MISSING: back at Review with the Needs git chip, Cancel only, no error wash', run: async () => {
      const { doc, calls } = await run({ ok: false, status: 409, data: { error: 'git is not installed on this machine', code: 'GIT_MISSING' } });
      assert.deepEqual([doc.querySelector('#mk-sheet .mk-src .pl-needs-git')?.textContent, foot(doc), step(doc), wash(doc), posts(calls, '/api/plugins/install').length],
        ['Needs git', ['Cancel'], 'Review', null, 1]);
      assert.equal(doc.activeElement, act(doc, 'cancel'), 'focus stays in the sheet, on Cancel (review B M4)');
    } },
    { name: 'a marketplace that needs git: Cancel only and the chip from the start; nothing posts', run: async () => {
      const { doc, calls } = await run(null, { marketplaces: [{ ...MKTS[0], needsGit: true }] });
      assert.deepEqual([foot(doc), doc.querySelector('#mk-sheet .pl-needs-git').textContent, calls.length], [['Cancel'], 'Needs git', 0]);
    } },
    { name: 'a double click posts once', run: async () => {
      const w = world({ routes: { 'POST /api/plugins/install': () => ({ ok: false, status: 409, data: { error: 'x', code: 'GIT_MISSING' } }) } });
      w.sheet.open(SLACK);
      const ins = () => act(w.doc, 'install');
      ins().dispatchEvent(new w.window.MouseEvent('click', { bubbles: true, detail: 1 }));
      ins().dispatchEvent(new w.window.MouseEvent('click', { bubbles: true, detail: 2 }));   // lands on the repainted, busy Install
      await settle();
      assert.equal(posts(w.calls, '/api/plugins/install').length, 1);
    } },
  ]);
});

test('v3: an answer from an earlier opening never lands in the next one, nor in another controller\'s sheet', async () => {
  const routes = { 'POST /api/plugins/install': () => ok({ ok: true }), 'GET /api/plugins/slack-chat/config': () => ok(SLACK_CONFIG) };
  const handOff = async (extra) => {
    const g = gate();
    const w = world({ routes: { ...routes, ...extra(g) } });
    w.sheet.open(SLACK); act(w.doc, 'install').click(); await settle();
    takeOver(w.doc, w.window);
    const html = w.doc.getElementById('mk-sheet').innerHTML;
    g.release(); await settle(30);
    return { w, same: w.doc.getElementById('mk-sheet').innerHTML === html };
  };
  await checkRows([
    { name: 'a refused install answering after the hand-off', run: async () => {
      assert.equal((await handOff((g) => ({ 'POST /api/plugins/install': async () => { await g.p; return { ok: false, status: 500, data: { error: 'x' } }; } }))).same, true);
    } },
    { name: 'opened again after a hand-off while the install is still out: not busy, and the late answer changes nothing', run: async () => {
      const g = gate();
      const w = world({ routes: { ...routes, 'POST /api/plugins/install': async () => { await g.p; return { ok: false, status: 500, data: { error: 'x' } }; } } });
      w.sheet.open(SLACK); act(w.doc, 'install').click(); await settle();
      takeOver(w.doc, w.window);
      w.sheet.open(GH);
      const idle = () => [closeBtn(w.doc).disabled, w.doc.getElementById('mk-sheet').hasAttribute('aria-busy')];
      assert.deepEqual(idle(), [false, false]);
      g.release(); await settle(30);
      assert.deepEqual([...idle(), step(w.doc), w.doc.querySelector('#mk-sheet .mk-wash-bad')], [false, false, 'Review', null]);
    } },
    { name: 'an install answering ok after the hand-off: no config read', run: async () => {
      const { w, same } = await handOff((g) => ({ 'POST /api/plugins/install': async () => { await g.p; return ok({ ok: true }); } }));
      assert.deepEqual([same, w.calls.some(([m, u]) => m === 'GET' && u?.endsWith('/config'))], [true, false]);
    } },
    { name: 'the config read answering after the hand-off', run: async () => {
      assert.equal((await handOff((g) => ({ 'GET /api/plugins/slack-chat/config': async () => { await g.p; return ok(SLACK_CONFIG); } }))).same, true);
    } },
    { name: 'closed during the config read, another plugin opened: it stays at its own Review', run: async () => {
      const g = gate();
      const w = world({ routes: { ...routes, 'GET /api/plugins/slack-chat/config': async () => { await g.p; return ok(SLACK_CONFIG); } } });
      w.sheet.open(SLACK); act(w.doc, 'install').click(); await settle(); await esc(w.doc);
      w.sheet.open(GH); g.release(); await settle(30);
      assert.deepEqual([w.doc.getElementById('mk-sheet-title').textContent, step(w.doc), w.doc.querySelectorAll('#mk-sheet [data-key]').length, closeBtn(w.doc).disabled],
        ['github-source', 'Review', 0, false]);
    } },
    { name: 'opened again for another plugin while an install is out (no close between): the answer stays out of it', run: async () => {
      const g = gate();
      const w = world({ routes: { ...routes, 'POST /api/plugins/install': async () => { await g.p; return ok({ ok: true }); } } });
      w.sheet.open(SLACK); act(w.doc, 'install').click(); await settle();
      w.sheet.open(GH); g.release(); await settle(30);
      assert.deepEqual([w.doc.getElementById('mk-sheet-title').textContent, step(w.doc), w.calls.some(([m, u]) => m === 'GET' && u?.endsWith('/config'))], ['github-source', 'Review', false]);
    } },
    { name: 'the finished "Install" left on screen while Set up loads posts nothing', run: async () => {
      const g = gate();
      const w = world({ routes: { ...routes, 'GET /api/plugins/slack-chat/config': async () => { await g.p; return ok(SLACK_CONFIG); } } });
      w.sheet.open(SLACK); act(w.doc, 'install').click(); await settle(); act(w.doc, 'install').click(); g.release(); await settle(30);
      assert.deepEqual([posts(w.calls, '/api/plugins/install').length, step(w.doc)], [1, 'Set up']);
    } },
    { name: 'v5: SM70 closed the sheet mid-install; reopened, it offers no second install until the first answered', run: async () => {
      const g = gate();
      const w = world({ routes: { ...routes, 'POST /api/plugins/install': async () => { await g.p; return ok({ ok: true }); } } });
      w.sheet.open(SLACK); act(w.doc, 'install').click(); await settle();
      w.window.location.hash = '#runs'; await settle();
      w.window.location.hash = '#marketplace'; await settle();
      w.sheet.open(SLACK); act(w.doc, 'install')?.click(); await settle();
      assert.deepEqual([foot(w.doc), posts(w.calls, '/api/plugins/install').length], [['Cancel'], 1]);
      g.release(); await settle(30);
      w.sheet.close(); w.sheet.open(SLACK);
      assert.deepEqual(foot(w.doc), ['Cancel', 'Install'], 'the first install answered: the guard is free again');
    } },
    { name: 'v5: the finished Install back to idle (withButton\'s done timer) while Set up loads posts nothing; Cancel is free', run: async () => {
      const g = gate();
      const w = world({ routes: { ...routes, 'GET /api/plugins/slack-chat/config': async () => { await g.p; return ok(SLACK_CONFIG); } } });
      w.sheet.open(SLACK); act(w.doc, 'install').click(); await settle();
      act(w.doc, 'install').removeAttribute('data-fb-state');   // what toIdle does after BUTTON_DONE_MS (2 s)
      act(w.doc, 'install').click(); await settle();
      assert.deepEqual([posts(w.calls, '/api/plugins/install').length, act(w.doc, 'cancel').disabled], [1, false]);
      g.release(); await settle(30);
      assert.equal(step(w.doc), 'Set up');
    } },
    { name: 'v5: opening the plugin already on screen keeps its step and what was typed', run: async () => {
      const w = world({ routes });
      w.sheet.open(SLACK); act(w.doc, 'install').click(); await settle();
      const tok = w.doc.querySelector('#mk-sheet [data-key="botToken"]');
      tok.value = 'xoxb-typed';
      assert.equal(w.sheet.open({ name: 'slack-chat', marketplace: 'official' }), true);
      assert.deepEqual([step(w.doc), w.doc.querySelector('#mk-sheet [data-key="botToken"]') === tok, tok.value], ['Set up', true, 'xoxb-typed']);
    } },
  ]);
});

const toSetUp = async ({ item = SLACK, config = SLACK_CONFIG, routes = {}, confirm } = {}) => {
  const w = world({ confirm, routes: { 'POST /api/plugins/install': () => ok({ ok: true }),
    [`GET /api/plugins/${item.name}/config`]: () => ok(config), [`PUT /api/plugins/${item.name}/config`]: () => ok(),
    'GET /api/chat/status': () => ok({ channels: [] }), ...routes } });
  w.sheet.open(item); act(w.doc, 'install').click(); await settle();
  return w;
};
const type = (doc, key, v) => { const i = doc.querySelector(`#mk-sheet [data-key="${key}"]`); i.value = v; i.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); };
const puts = (calls) => calls.filter(([m]) => m === 'PUT').map(([, , b]) => b);

test('Save: required first, then one PUT per section in order, then Done', async () => {
  const config = { sources: [GH_SOURCE], channels: SLACK_CONFIG.channels,
    models: { schema: [F('apiKey', 'API key', { secret: true })], values: { apiKey: { set: false } } } };   // the server's shape: optional
  const { doc, calls } = await toSetUp({ config });
  assert.deepEqual([...doc.querySelectorAll('#mk-sheet .mk-setup-h')].map((h) => h.textContent), ['Set up github', 'Set up Slack', 'Model secrets']);
  act(doc, 'save').click(); await settle();
  assert.deepEqual([doc.querySelectorAll('#mk-sheet .field-invalid').length, puts(calls).length, step(doc)], [3, 0, 'Set up']);
  type(doc, 'botToken', 'xoxb-1'); type(doc, 'appToken', 'xapp-1'); type(doc, 'notifyChatIds', 'C07Q2M4KD1'); type(doc, 'apiKey', 'k-1');
  act(doc, 'save').click(); await settle();
  assert.deepEqual(puts(calls), [
    { sourceId: 'github', values: { closeOnDone: 'no' } },
    { channelId: 'main', values: { botToken: 'xoxb-1', appToken: 'xapp-1', notifyChatIds: 'C07Q2M4KD1', allowedChatIds: '', channelAllowlist: '' } },
    { target: 'modelSecrets', values: { apiKey: 'k-1' } },
  ]);
  assert.equal(step(doc), 'Done');
});

test('Set up: the other paths', async () => {
  await checkRows([
    { name: 'a refused PUT: its message in the sheet, still at Set up, later sections not sent', run: async () => {
      const { doc, calls, notes } = await toSetUp({ config: { sources: [GH_SOURCE], channels: [] }, routes: {
        'PUT /api/plugins/slack-chat/config': () => ({ ok: false, status: 400, data: { error: 'unknown sourceId "github"' } }) } });
      act(doc, 'save').click(); await settle();
      assert.deepEqual([doc.querySelector('#mk-sheet .mk-wash-bad[role="alert"]').textContent, step(doc), puts(calls).length, notes], ['unknown sourceId "github"', 'Set up', 1, []]);
      assert.deepEqual([...doc.querySelector('#mk-sheet .mk-sheet-body > .mk-stack').children].map((c) => c.className),
        ['mk-wash mk-wash-ok', 'mk-wash mk-wash-bad', 'mk-setup'], 'the error sits right under the installed wash');
    } },
    { name: 'an empty roster: POST the profile, then PUT into it', run: async () => {
      const { doc, calls } = await toSetUp({ item: AZURE, config: AZURE_CONFIG(), routes: { 'POST /api/plugins/azure-boards-source/profiles': () => ok({ ok: true, profile: { id: 'work', label: '' } }) } });
      assert.equal(doc.querySelector('#mk-sheet .mk-setup-h').textContent, 'Set up Azure Boards');
      doc.querySelector('#mk-sheet .mk-profile-id').value = 'work'; type(doc, 'organization', 'acme'); type(doc, 'pat', 'p-1');
      act(doc, 'save').click(); await settle();
      assert.deepEqual(calls.filter(([m, u]) => (m === 'POST' || m === 'PUT') && u !== '/api/plugins/install').map(([m, u, b]) => [m, u, b]), [
        ['POST', '/api/plugins/azure-boards-source/profiles', { sourceId: 'azure', id: 'work', label: '' }],
        ['PUT', '/api/plugins/azure-boards-source/config', { sourceId: 'azure', profile: 'work', values: { organization: 'acme', pat: 'p-1' } }]]);
    } },
    { name: 'a refused profile id: the server reason under the field, nothing saved', run: async () => {
      const { doc, calls } = await toSetUp({ item: AZURE, config: AZURE_CONFIG(), routes: {
        'POST /api/plugins/azure-boards-source/profiles': () => ({ ok: false, status: 400, data: { error: 'profile id "default" is reserved — pick another name' } }) } });
      doc.querySelector('#mk-sheet .mk-profile-id').value = 'default'; type(doc, 'organization', 'acme'); type(doc, 'pat', 'p-1');
      act(doc, 'save').click(); await settle();
      const idField = doc.querySelector('#mk-sheet .mk-profile-id');
      assert.deepEqual([idField.classList.contains('field-invalid'), idField.closest('.field').querySelector('.fe-text').textContent, puts(calls).length, step(doc)],
        [true, 'profile id "default" is reserved — pick another name', 0, 'Set up']);
    } },
    { name: 'switching the profile re-reads its values into that section', run: async () => {
      const roster = [{ id: 'work', label: 'Work' }, { id: 'home', label: 'Home' }];
      const home = AZURE_CONFIG(roster); home.sources[0].profile = 'home'; home.sources[0].values = { organization: 'acme-home', pat: { set: false } };
      // confirm: false — a browser fires `input` on the select before `change`; that alone must not count as an edit.
      const { doc } = await toSetUp({ item: AZURE, config: AZURE_CONFIG(roster), confirm: false, routes: { 'GET /api/plugins/azure-boards-source/config?profile=home': () => ok(home) } });
      const sel = doc.querySelector('#mk-sheet .mk-profile-sel');
      sel.value = 'home';
      for (const t of ['input', 'change']) sel.dispatchEvent(new doc.defaultView.Event(t, { bubbles: true }));
      await settle();
      const sec = doc.querySelector('#mk-sheet .mk-setup');
      assert.deepEqual([sec.dataset.profile, sec.querySelector('[data-key="organization"]').value], ['home', 'acme-home']);
    } },
    { name: 'an edited section asks before switching; No keeps the select and the edits', run: async () => {
      const roster = [{ id: 'work', label: 'Work' }, { id: 'home', label: 'Home' }];
      const { doc, calls } = await toSetUp({ item: AZURE, config: AZURE_CONFIG(roster), confirm: false });
      type(doc, 'organization', 'edited');
      const sel = doc.querySelector('#mk-sheet .mk-profile-sel');
      sel.value = 'home'; sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); await settle();
      assert.deepEqual([sel.value, doc.querySelector('#mk-sheet [data-key="organization"]').value, calls.some(([, u]) => u?.endsWith('?profile=home'))], ['work', 'edited', false]);
    } },
    { name: 'Skip for now: closes and lands on Installed', run: async () => {
      const { doc, sheet, page } = await toSetUp();
      act(doc, 'skip').click(); await settle();
      assert.deepEqual([sheet.isOpen(), page.calls.at(-1)], [false, ['setTab', 'installed']]);   // SM63: setTab keeps the address in step
    } },
    { name: 'Set up is a form: the scrim never closes it', run: async () => {
      const { doc, window, sheet } = await toSetUp();
      const host = doc.getElementById('mk-sheet-host');
      host.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); host.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      assert.equal(sheet.isOpen(), true);
    } },
    { name: 'nothing to set up: straight to Done, Set up marked done', run: async () => {
      const { doc } = await toSetUp({ item: ATLASSIAN, config: EMPTY_CONFIG });
      assert.deepEqual([step(doc), doc.querySelectorAll('#mk-sheet .mk-step.is-done').length], ['Done', 3]);
    } },
    { name: 'the config cannot be read: the reason in the sheet, Skip for now only', run: async () => {
      const { doc } = await toSetUp({ routes: { 'GET /api/plugins/slack-chat/config': () => ({ ok: false, status: 409, data: { error: 'plugin manifest unreadable — run doctor' } }) } });
      assert.deepEqual([step(doc), doc.querySelector('#mk-sheet .mk-wash-bad').textContent, foot(doc)], ['Set up', 'plugin manifest unreadable — run doctor', ['Skip for now']]);
    } },
  ]);
});

test('v3: Save holds the sheet; a profile switch keeps focus and is no edit', async () => {
  const roster = [{ id: 'work', label: 'Work' }, { id: 'home', label: 'Home' }];
  const home = AZURE_CONFIG(roster); home.sources[0].profile = 'home'; home.sources[0].values = { organization: 'acme-home', pat: { set: false } };
  const switchTo = async (doc) => {
    const sel = doc.querySelector('#mk-sheet .mk-profile-sel');
    sel.focus(); sel.value = 'home';
    for (const t of ['input', 'change']) sel.dispatchEvent(new doc.defaultView.Event(t, { bubbles: true }));
    await settle();
    return sel;
  };
  await checkRows([
    { name: 'busy while the PUT is out (Close and Skip disabled, Escape held); a refusal frees them and puts focus back on Save', run: async () => {
      const g = gate();
      const { doc } = await toSetUp({ routes: { 'PUT /api/plugins/slack-chat/config': async () => { await g.p; return { ok: false, status: 400, data: { error: 'no' } }; } } });
      type(doc, 'botToken', 'b'); type(doc, 'appToken', 'a');
      act(doc, 'save').focus(); act(doc, 'save').click(); await settle(); await esc(doc);   // Chromium focuses a clicked button
      assert.deepEqual([closeBtn(doc).disabled, act(doc, 'skip').disabled, doc.getElementById('mk-sheet-host').classList.contains('hidden'), discardAsked(doc)], [true, true, false, false]);
      g.release(); await settle();
      assert.deepEqual([closeBtn(doc).disabled, act(doc, 'skip').disabled, doc.activeElement === act(doc, 'save')], [false, false, true]);
    } },
    { name: 'a second refusal leaves one wash', run: async () => {
      const { doc } = await toSetUp({ routes: { 'PUT /api/plugins/slack-chat/config': () => ({ ok: false, status: 400, data: { error: 'no' } }) } });
      type(doc, 'botToken', 'b'); type(doc, 'appToken', 'a');
      act(doc, 'save').click(); await settle(); act(doc, 'save').click(); await settle();
      assert.equal(doc.querySelectorAll('#mk-sheet .mk-wash-bad').length, 1);
    } },
    { name: 'a refused profile id, then a refused PUT: the old field error is gone', run: async () => {
      let n = 0;
      const { doc } = await toSetUp({ item: AZURE, config: AZURE_CONFIG(), routes: {
        'POST /api/plugins/azure-boards-source/profiles': () => (n++ ? ok({ ok: true }) : { ok: false, status: 400, data: { error: 'reserved' } }),
        'PUT /api/plugins/azure-boards-source/config': () => ({ ok: false, status: 400, data: { error: 'put no' } }) } });
      doc.querySelector('#mk-sheet .mk-profile-id').value = 'work'; type(doc, 'organization', 'o'); type(doc, 'pat', 'p');
      act(doc, 'save').click(); await settle(); act(doc, 'save').click(); await settle();
      assert.deepEqual([doc.querySelectorAll('#mk-sheet .field-error').length, doc.querySelector('#mk-sheet .mk-wash-bad')?.textContent], [0, 'put no']);
    } },
    { name: 'a profile switch keeps focus on the new select (M4), and alone is no edit: Escape closes without asking', run: async () => {
      const { doc, sheet } = await toSetUp({ item: AZURE, config: AZURE_CONFIG(roster), routes: { 'GET /api/plugins/azure-boards-source/config?profile=home': () => ok(home) } });
      await switchTo(doc);
      assert.equal(doc.activeElement, doc.querySelector('#mk-sheet .mk-profile-sel'));
      await esc(doc);
      assert.deepEqual([sheet.isOpen(), discardAsked(doc)], [false, false]);
    } },
    { name: 'a profile that cannot be read: the reason in the sheet; the select and the values stay', run: async () => {
      const { doc } = await toSetUp({ item: AZURE, config: AZURE_CONFIG(roster), routes: {
        'GET /api/plugins/azure-boards-source/config?profile=home': () => ({ ok: false, status: 400, data: { error: 'plugin "azure-boards-source" has no profile "home"' } }) } });
      const sel = await switchTo(doc);
      assert.deepEqual([sel.value, doc.querySelector('#mk-sheet .mk-wash-bad')?.textContent, doc.querySelector('#mk-sheet [data-key="organization"]').value],
        ['work', 'plugin "azure-boards-source" has no profile "home"', 'acme']);
    } },
    { name: 'SM55: a profile select changed while the panel is in another mode is not P4\'s', run: async () => {
      const { doc, calls } = await toSetUp({ item: AZURE, config: AZURE_CONFIG(roster) });
      doc.getElementById('mk-sheet').dataset.mode = 'manage';
      await switchTo(doc);
      assert.equal(calls.some(([, u]) => u?.includes('?profile=')), false);
    } },
    { name: 'a PUT answering after another controller took the host: its sheet is left alone, the next section is not sent', run: async () => {
      const g = gate();
      const w = await toSetUp({ item: GH, config: { sources: [GH_SOURCE, { ...GH_SOURCE, id: 'gh2' }], channels: [] }, routes: {
        'PUT /api/plugins/github-source/config': async (b) => { if (b.sourceId === 'github') await g.p; return ok(); } } });
      act(w.doc, 'save').click(); await settle();
      takeOver(w.doc, w.window);
      const html = w.doc.getElementById('mk-sheet').innerHTML;
      g.release(); await settle(30);
      assert.deepEqual([w.doc.getElementById('mk-sheet').innerHTML === html, puts(w.calls).map((b) => b.sourceId)], [true, ['github']]);
    } },
  ]);
});

const toDone = async ({ item = SLACK, routes = {} } = {}) => {
  const w = await toSetUp({ item, config: item === SLACK ? SLACK_CONFIG : EMPTY_CONFIG, routes: {
    'GET /api/chat/status': () => ok({ channels: [{ plugin: 'slack-chat', channelId: 'main', displayName: 'Slack', state: 'connecting', detail: null },
      { plugin: 'telegram-chat', channelId: 'main', displayName: 'Telegram', state: 'connected', detail: null }] }), ...routes } });
  if (item === SLACK) { type(w.doc, 'botToken', 'b'); type(w.doc, 'appToken', 'a'); type(w.doc, 'notifyChatIds', 'C07Q2M4KD1'); act(w.doc, 'save').click(); await settle(); }
  return w;
};

test('Done: chips, Send test message inside the sheet, links close the sheet', async () => {
  await checkRows([
    { name: 'a chat plugin: its chips only, Send test message + Done, focus on Done', run: async () => {
      const { doc } = await toDone();
      assert.deepEqual([step(doc), [...doc.querySelectorAll('#mk-sheet .pl-channel')].map((c) => [c.dataset.channelKey, c.textContent]), foot(doc), doc.activeElement === act(doc, 'done')],
        ['Done', [['slack-chat/main', 'Slack · connecting']], ['Send test message', 'Done'], true]);
      assert.equal(doc.querySelector('#mk-sheet .mk-list-row .mk-meta').textContent, 'Notifies C07Q2M4KD1');
    } },
    { name: 'an MCP plugin: no chip, Done only; Set up in Connectors leads Next', run: async () => {
      const { doc } = await toDone({ item: ATLASSIAN });
      assert.deepEqual([doc.querySelector('#mk-sheet .pl-channel'), foot(doc), doc.querySelector('#mk-sheet a.mk-lrow').dataset.link], [null, ['Done'], 'connectors']);
    } },
    { name: 'Send test message: POST per channel; delivered → "Delivered", no wash', run: async () => {
      const { doc, calls } = await toDone({ routes: { 'POST /api/chat/test': () => ok({ ok: true, results: [{ chatId: 'C07Q2M4KD1', ok: true }] }) } });
      act(doc, 'test').click(); await settle();
      assert.deepEqual([posts(calls, '/api/chat/test').map(([, , b]) => b), act(doc, 'test').textContent, doc.querySelector('#mk-sheet .mk-wash-bad')],
        [[{ plugin: 'slack-chat', channelId: 'main' }], 'Delivered', null]);
    } },
    { name: 'a refused test: "Test message not sent" + the reason, in the sheet', run: async () => {
      const { doc, notes } = await toDone({ routes: { 'POST /api/chat/test': () => ({ ok: false, status: 400, data: { error: 'notifyChatIds is not configured for this channel' } }) } });
      act(doc, 'test').click(); await settle();
      const w = doc.querySelector('#mk-sheet .mk-wash-bad[role="alert"]');
      assert.deepEqual([w.querySelector('.mk-wash-title').textContent, w.querySelector('.mk-wash-text').textContent, act(doc, 'test').textContent, notes],
        ['Test message not sent', 'notifyChatIds is not configured for this channel', 'Send test message', []]);
    } },
    { name: 'a failed delivery names the chats', run: async () => {
      const { doc } = await toDone({ routes: { 'POST /api/chat/test': () => ok({ ok: false, results: [{ chatId: 'C07Q2M4KD1', ok: false, error: { kind: 'plugin', message: 'channel_not_found' } }] }) } });
      act(doc, 'test').click(); await settle();
      const w = doc.querySelector('#mk-sheet .mk-wash-bad');
      assert.deepEqual([w.querySelector('.mk-wash-title').textContent, w.querySelector('.mk-wash-text').textContent], ['Delivery failed for C07Q2M4KD1', 'channel_not_found']);
    } },
    { name: 'Manage: closes, Installed tab, openManage', run: async () => {
      const { doc, sheet, page, window } = await toDone();
      const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
      doc.querySelector('#mk-sheet a[data-link="manage"]').dispatchEvent(ev); await settle();
      // SM63: the tab switch (and the address) go through page.setTab only; the link's own href is not followed.
      assert.deepEqual([sheet.isOpen(), page.calls.slice(-2), ev.defaultPrevented], [false, [['setTab', 'installed'], ['act', 'openManage', 'slack-chat']], true]);
    } },
    { name: 'Browse more: closes and filters Browse by the plugin\'s kind', run: async () => {
      const { doc, sheet, page } = await toDone();
      doc.querySelector('#mk-sheet a[data-link="browse"]').click(); await settle();
      assert.deepEqual([sheet.isOpen(), page.calls.at(-1)], [false, ['act', 'browse', { adds: 'chatChannels' }]]);
    } },
    { name: 'a landing link and Set up in Connectors close the sheet and keep their href', run: async () => {
      const a = await toDone();
      const land = a.doc.querySelector('#mk-sheet a[data-link="landing"]');
      const ev = new a.window.MouseEvent('click', { bubbles: true, cancelable: true });
      land.dispatchEvent(ev); await settle();
      assert.deepEqual([a.sheet.isOpen(), ev.defaultPrevented], [false, false]);
      const b = await toDone({ item: ATLASSIAN });
      b.doc.querySelector('#mk-sheet a[data-link="connectors"]').click(); await settle();
      assert.equal(b.sheet.isOpen(), false);
    } },
    { name: 'Done closes', run: async () => {
      const { doc, sheet } = await toDone();
      act(doc, 'done').click(); await settle();
      assert.equal(sheet.isOpen(), false);
    } },
  ]);
});

test('v3: Done after a re-open or a hand-off; repeat tests; the next plugin starts clean', async () => {
  const save = async (doc) => { type(doc, 'botToken', 'b'); type(doc, 'appToken', 'a'); act(doc, 'save').click(); await settle(); };
  await checkRows([
    { name: 'closed during Send test message, another plugin opened: no wash there, no test POST for it', run: async () => {
      const g = gate();
      const w = await toSetUp({ routes: { 'GET /api/plugins/telegram-chat/config': () => ok(EMPTY_CONFIG),
        'POST /api/chat/test': async (b) => { if (b.plugin === 'slack-chat') { await g.p; return { ok: false, status: 400, data: { error: 'SLACK' } }; } return ok({ ok: true, results: [] }); } } });
      await save(w.doc);
      act(w.doc, 'test').click(); await settle(); await esc(w.doc);
      w.sheet.open(TG); act(w.doc, 'install').click(); await settle();
      g.release(); await settle(30);
      assert.deepEqual([w.doc.getElementById('mk-sheet-title').textContent, step(w.doc), w.doc.querySelector('#mk-sheet .mk-wash-bad'), posts(w.calls, '/api/chat/test').map(([, , b]) => b.plugin)],
        ['telegram-chat', 'Done', null, ['slack-chat']]);
    } },
    { name: 'closed during the first of two channels\' test messages: the second is not sent', run: async () => {
      const g = gate();
      const two = item('two-chat', { iconKind: 'chatChannels', inventory: INV({ chatChannels: [{ id: 'a', displayName: 'A', secrets: [] }, { id: 'b', displayName: 'B', secrets: [] }] }) });
      const w = await toSetUp({ item: two, config: EMPTY_CONFIG, routes: { 'POST /api/chat/test': async (b) => { if (b.channelId === 'a') await g.p; return ok({ ok: true, results: [] }); } } });
      act(w.doc, 'test').click(); await settle(); await esc(w.doc);
      g.release(); await settle(30);
      assert.deepEqual([w.sheet.isOpen(), posts(w.calls, '/api/chat/test').map(([, , b]) => b.channelId)], [false, ['a']]);
    } },
    { name: 'saved, Done still loading: Escape closes without asking to discard', run: async () => {
      const g = gate();
      const w = await toSetUp({ routes: { 'GET /api/chat/status': async () => { await g.p; return ok({ channels: [] }); } } });
      await save(w.doc); await esc(w.doc);
      assert.equal(discardAsked(w.doc), false);
      g.release(); await settle();
    } },
    { name: 'the chat status answering after another controller took the host leaves its sheet alone', run: async () => {
      const g = gate();
      const w = await toSetUp({ routes: { 'GET /api/chat/status': async () => { await g.p; return ok({ channels: [] }); } } });
      await save(w.doc);
      takeOver(w.doc, w.window);
      const html = w.doc.getElementById('mk-sheet').innerHTML;
      g.release(); await settle(30);
      assert.equal(w.doc.getElementById('mk-sheet').innerHTML, html);
    } },
    { name: 'a second failed test leaves one wash and focus on Send test message', run: async () => {
      const { doc } = await toDone({ routes: { 'POST /api/chat/test': () => ({ ok: false, status: 400, data: { error: 'no' } }) } });
      act(doc, 'test').focus(); act(doc, 'test').click(); await settle(); act(doc, 'test').click(); await settle();
      assert.deepEqual([doc.querySelectorAll('#mk-sheet .mk-wash-bad').length, doc.activeElement === act(doc, 'test')], [1, true]);
    } },
    { name: 'the next plugin\'s Done never shows the previous plugin\'s saved ids', run: async () => {
      const w = await toDone({ routes: { 'GET /api/plugins/telegram-chat/config': () => ok(EMPTY_CONFIG) } });
      act(w.doc, 'done').click(); await settle();
      w.sheet.open(TG); act(w.doc, 'install').click(); await settle();
      assert.deepEqual([step(w.doc), w.doc.querySelector('#mk-sheet .mk-list-row .mk-meta')], ['Done', null]);
    } },
    { name: 'Browse more does not follow its href', run: async () => {
      const { doc, window } = await toDone();
      const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
      doc.querySelector('#mk-sheet a[data-link="browse"]').dispatchEvent(ev); await settle();
      assert.equal(ev.defaultPrevented, true);
    } },
  ]);
});
