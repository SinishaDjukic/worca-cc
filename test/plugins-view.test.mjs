// test/plugins-view.test.mjs — pure jsdom tests for the Plugins-view renderers.
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderPluginList, renderInstallConsent, renderUpdatePreview,
  renderConfigForm, collectConfigForm, renderDoctorReport, renderReferences409,
  renderOrphanList,
} from '../ui/public/plugins-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

test('install consent lists a requested secret (.pl-secret) + setup commands verbatim', () => {
  const el = renderInstallConsent(
    { name: 'github-source', repoUrl: 'https://github.com/o/r', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
    {
      agents: [{ key: 'issueTriager', tools: ['Bash', 'Read'] }],
      taskSources: [{ id: 'github', displayName: 'GitHub Issues', secrets: ['token'] }],
      skills: ['pdf-to-docx'], workflows: ['triage'], depCount: 12,
      setupCommands: ['npm ci --prefix <dir> --ignore-scripts --omit=dev'],
    },
    { doc },
  );
  const secret = el.querySelector('.pl-secret');
  assert.ok(secret, 'secret request must render');
  assert.match(secret.textContent, /token/);
  assert.match(el.textContent, /a1b2c3d/);                       // pinned sha7
  assert.match(el.textContent, /issueTriager — tools: Bash, Read/);
  assert.match(el.textContent, /12 npm dependencies/);
  assert.match(el.querySelector('.pl-setup-cmd').textContent, /npm ci --prefix <dir> --ignore-scripts --omit=dev/);
});

test('install consent: chat channels render security-loud with secrets; absent -> no section', () => {
  const el = renderInstallConsent(
    { name: 'telegram-chat', repoUrl: 'https://github.com/o/r', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
    {
      agents: [], taskSources: [], skills: [], workflows: [], depCount: null, setupCommands: [],
      chatChannels: [{
        id: 'main', displayName: 'Telegram', platform: 'telegram',
        ingress: 'connect', inbound: true, outbound: true, secrets: ['botToken'],
      }],
    },
    { doc },
  );
  assert.match(el.textContent, /Chat channels \(1\)/);
  assert.match(el.textContent, /Telegram \(telegram, inbound \+ outbound\) — runs a persistent worker/);
  assert.match(el.querySelector('.pl-secret').textContent, /botToken/);
  const warn = el.querySelector('.pl-channel-warn');
  assert.ok(warn, 'security warning must render');
  assert.match(warn.textContent, /pause\/stop\/approve runs/);

  const none = renderInstallConsent(
    { name: 'github-source', repoUrl: 'https://github.com/o/r', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
    { agents: [], taskSources: [], skills: [], workflows: [], depCount: null, setupCommands: [] },
    { doc },
  );
  assert.doesNotMatch(none.textContent, /Chat channels/);
});

test('config form masks secrets; collect skips untouched {set:true} markers', () => {
  const schema = [
    { key: 'token', type: 'text', label: 'GitHub token', secret: true, required: true, default: null, help: null, options: [] },
    { key: 'apiBase', type: 'text', label: 'API base', secret: false, required: false, default: null, help: null, options: [] },
  ];
  const root = renderConfigForm(
    [{ id: 'github', schema, values: { token: { set: true }, apiBase: 'https://api.github.com' } }], { doc });
  const form = root.querySelector('.pl-config-form');
  const token = form.querySelector('[data-key="token"]');
  assert.equal(token.type, 'password');
  assert.equal(token.value, '', 'stored secret must never be echoed');
  assert.equal(token.placeholder, '(set)');
  // Untouched secret is omitted so a save can never clobber it with ''.
  assert.deepEqual(collectConfigForm(form), { sourceId: 'github', values: { apiBase: 'https://api.github.com' } });
  token.value = 'ghp_new';                                        // user typed a new one
  assert.equal(collectConfigForm(form).values.token, 'ghp_new');
});

test('update preview shows commit subjects + diffstat + enabled confirm', () => {
  const el = renderUpdatePreview({
    pinnedSha: 'a1b2c3d4e5f6', candidateSha: 'f00dfacecafe',
    commits: [{ sha: 'f00dfacecafe', subject: 'feat: faster listTasks' }],
    diffstat: ' connector/index.mjs | 12 ++++++------\n 1 file changed',
    manifestDelta: { newSecrets: ['github.webhook_secret'], newTaskSources: [], newAgents: [], setupChanged: false },
  }, { doc });
  assert.match(el.querySelector('.pl-commit').textContent, /feat: faster listTasks/);
  assert.match(el.querySelector('.pl-diffstat').textContent, /1 file changed/);
  assert.match(el.querySelector('.pl-delta-secret').textContent, /NEW SECRET requested: github\.webhook_secret/);
  const btn = el.querySelector('.pl-confirm-update');
  assert.ok(btn && !btn.disabled);
});

test('update preview with no new commits shows up-to-date state, no confirm button', () => {
  const el = renderUpdatePreview({ pinnedSha: 'a1b2c3d4e5f6', candidateSha: 'a1b2c3d4e5f6', commits: [] }, { doc });
  assert.equal(el.querySelector('.pl-confirm-update'), null, 'no apply button when nothing to apply');
  assert.equal(el.querySelector('.pl-diffstat'), null, 'no empty diffstat box');
  assert.equal(el.querySelector('.pl-update-shas'), null, 'no sha arrow when nothing changes');
  const badge = el.querySelector('.pl-uptodate .badge');
  assert.ok(badge, 'up-to-date badge must render');
  assert.match(badge.textContent, /up to date/i);
  assert.match(el.querySelector('.pl-uptodate .hint').textContent, /latest version \(a1b2c3d\)/);
  // Missing shas (defensive) -> still renders the badge, hint without sha.
  const bare = renderUpdatePreview({ commits: [] }, { doc });
  assert.ok(bare.querySelector('.pl-uptodate .badge'));
  assert.match(bare.querySelector('.pl-uptodate .hint').textContent, /latest version/);
});

test('plugin list shows enabled toggle, disabled state, broken badge, contributions', () => {
  const el = renderPluginList([
    { name: 'github-source', version: '0.1.0', pinnedSha: 'a1b2c3d4e5', enabled: true,
      contributions: { agents: ['issueTriager'], taskSources: ['github'], skills: [], workflows: [] } },
    { name: 'jira-source', version: null, pinnedSha: 'deadbeef99', enabled: false, broken: true, contributions: {} },
  ], { doc });
  const cards = el.querySelectorAll('.plugin-card');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].querySelector('.pl-toggle').checked, true);
  assert.match(cards[0].querySelector('.pl-contrib').textContent, /1 agent · 1 source/);
  assert.equal(cards[1].querySelector('.pl-toggle').checked, false);
  assert.ok(cards[1].classList.contains('pl-disabled'));
  assert.ok(cards[1].querySelector('.pl-broken'), 'broken badge must render');
  assert.equal(cards[1].querySelector('.pl-version').textContent, 'deadbee', 'sha7 stands in for a missing version');
  assert.equal(cards[1].querySelector('.pl-remove').dataset.name, 'jira-source'); // delegation hook
});

test('doctor report + references-409 render rows', () => {
  const rep = renderDoctorReport({ ok: false, checks: [
    { id: 'current-symlink', ok: true, detail: '' },
    { id: 'node_modules', ok: false, detail: 'missing — re-run setup' },
  ] }, { doc });
  assert.equal(rep.querySelectorAll('.pl-doc-row').length, 2);
  assert.match(rep.textContent, /re-run setup/);
  const refs = renderReferences409([{ type: 'workflow', name: 'My triage flow' }, 'project config: orchestrator'], { doc });
  assert.equal(refs.querySelectorAll('li').length, 2);
  assert.match(refs.textContent, /My triage flow/);
});

test('orphan list: row per orphan with Purge button; empty input -> empty container', () => {
  const el = renderOrphanList(
    [{ name: 'ghost-src', dataDir: '/home/u/.worca-cc/plugins/ghost-src/data' }],
    { doc },
  );
  assert.equal(el.className, 'pl-orphans');
  const rows = el.querySelectorAll('.pl-orphan-row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.pl-name').textContent, 'ghost-src');
  assert.match(rows[0].querySelector('.hint').textContent, /uninstalled — config\/secrets remain/);
  const btn = rows[0].querySelector('button.pl-purge-orphan');
  assert.ok(btn, 'purge button present');
  assert.equal(btn.dataset.name, 'ghost-src');
  assert.equal(btn.textContent, 'Purge');

  assert.equal(renderOrphanList([], { doc }).childElementCount, 0);
  assert.equal(renderOrphanList(undefined, { doc }).childElementCount, 0);
});

test('plugin cards show live channel badges when channelStatus rows match', () => {
  const el = renderPluginList([
    { name: 'telegram-chat', enabled: true, contributions: { agents: 0, taskSources: 0, chatChannels: 1, skills: 0, workflows: 0 } },
    { name: 'github-source', enabled: true, contributions: { agents: 1, taskSources: 1, skills: 0, workflows: 0 } },
  ], {
    doc,
    channelStatus: [
      { plugin: 'telegram-chat', channelId: 'main', displayName: 'Telegram', platform: 'telegram', state: 'connected', detail: null },
    ],
  });
  const badge = el.querySelector('.pl-channel');
  assert.ok(badge);
  assert.equal(badge.dataset.channelKey, 'telegram-chat/main');
  assert.match(badge.className, /green/);
  assert.match(badge.textContent, /Telegram · connected/);
  const cards = el.querySelectorAll('.plugin-card');
  assert.equal(cards[1].querySelector('.pl-channel'), null, 'no badges without matching rows');
  assert.match(cards[0].querySelector('.pl-contrib').textContent, /1 chat channel/);
});

test('config form renders channel sections with data-channel-id; collect routes accordingly', () => {
  const schema = [
    { key: 'botToken', type: 'text', label: 'Bot token', secret: true, required: true, default: null, help: null, options: [] },
    { key: 'notifyChatIds', type: 'text', label: 'Notify', secret: false, required: false, default: null, help: null, options: [] },
  ];
  const root = renderConfigForm({
    sources: [{ id: 'gh', schema: [{ key: 'token', type: 'text', label: 'T', secret: true, required: true, default: null, help: null, options: [] }], values: {} }],
    channels: [{ id: 'main', displayName: 'Telegram', platform: 'telegram', schema, values: { botToken: { set: true }, notifyChatIds: '42' } }],
  }, { doc });

  const forms = [...root.querySelectorAll('.pl-config-form')];
  assert.equal(forms.length, 2);
  assert.equal(forms[0].dataset.sourceId, 'gh');
  assert.equal(forms[1].dataset.channelId, 'main');
  assert.match(forms[1].querySelector('.pl-config-h').textContent, /Telegram \(telegram channel\)/);

  const tokenInput = forms[1].querySelector('[data-key="botToken"]');
  assert.equal(tokenInput.type, 'password');
  assert.equal(tokenInput.placeholder, '(set)');
  forms[1].querySelector('[data-key="notifyChatIds"]').value = '42, 77';
  assert.deepEqual(collectConfigForm(forms[1]), { channelId: 'main', values: { notifyChatIds: '42, 77' } });
  assert.deepEqual(collectConfigForm(forms[0]).sourceId, 'gh', 'legacy source forms unchanged');
});
