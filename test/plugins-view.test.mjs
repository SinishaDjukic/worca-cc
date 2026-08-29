// test/plugins-view.test.mjs — pure jsdom tests for the Plugins-view renderers.
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderPluginList, renderInstallConsent, renderUpdatePreview,
  renderConfigForm, collectConfigForm, renderConnectResult, renderDoctorReport, renderReferences409,
  renderOrphanList, renderAvailableList, renderMarketplaceList, relTime,
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

// ── profiles ───────────────────────────────────────────────────────────────────
// A multiProfile source holds several independent configurations (two Jira
// instances, two GitHub orgs). The settings pane becomes a roster + the
// selected profile's form; a single-profile source must not pay for any of it.
test('a multiProfile source renders a profile roster and stamps the form with it', () => {
  const schema = [{ key: 'ticketUrl', type: 'text', label: 'Ticket URL', secret: false, required: true, default: null, help: null, options: [] }];
  const root = renderConfigForm([{
    id: 'jira', schema, multiProfile: true,
    profile: 'acme',
    profiles: [{ id: 'acme', label: 'Acme' }, { id: 'globex', label: null }],
    values: { ticketUrl: 'https://t.example.com/browse/A-1' },
  }], { doc });

  const sel = root.querySelector('.pl-profile-sel');
  assert.ok(sel, 'roster select must render');
  assert.deepEqual([...sel.options].map((o) => o.value), ['acme', 'globex']);
  assert.equal(sel.value, 'acme', 'the echoed profile is the selected one');
  assert.match([...sel.options][0].textContent, /Acme/);
  assert.equal([...sel.options][1].textContent, 'globex', 'no label falls back to the id');
  assert.ok(root.querySelector('.pl-profile-add'), 'can add a profile');
  assert.ok(root.querySelector('.pl-profile-del'), 'can remove one');

  // The form carries the profile, so a save/connect targets the right bucket
  // rather than whichever the server would have defaulted to.
  const form = root.querySelector('.pl-config-form');
  assert.equal(form.dataset.profile, 'acme');
  assert.deepEqual(collectConfigForm(form), {
    sourceId: 'jira', profile: 'acme', values: { ticketUrl: 'https://t.example.com/browse/A-1' },
  });
});

test('a multiProfile source with NO profiles yet asks for one instead of showing a form', () => {
  // Saving into a profile that does not exist is the one thing the server
  // rejects outright, so an empty roster must not render a fillable form.
  const schema = [{ key: 'ticketUrl', type: 'text', label: 'Ticket URL', secret: false, required: true, default: null, help: null, options: [] }];
  const root = renderConfigForm([{ id: 'jira', schema, multiProfile: true, profile: null, profiles: [], values: {} }], { doc });
  assert.equal(root.querySelector('.pl-config-form'), null, 'no form without a profile to write to');
  assert.ok(root.querySelector('.pl-profile-add'), 'the only offered action is creating one');
  assert.match(root.textContent, /No profiles yet/i);
});

test('a single-profile source is untouched: no roster, and collect omits profile', () => {
  const schema = [{ key: 'apiBase', type: 'text', label: 'API base', secret: false, required: false, default: null, help: null, options: [] }];
  const root = renderConfigForm([{ id: 'github', schema, values: { apiBase: 'https://api.github.com' } }], { doc });
  assert.equal(root.querySelector('.pl-profile-bar'), null, 'no profile UI for a single-instance source');
  const got = collectConfigForm(root.querySelector('.pl-config-form'));
  assert.ok(!('profile' in got), 'the profile key never appears for a single-profile source');
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

test('an API-mismatched plugin gets an amber "needs update" badge and the note', () => {
  const el = renderPluginList([
    { name: 'old-plugin', version: '0.2.0', enabled: true, broken: true, contributions: { agents: 1, workflows: 1 },
      apiMismatch: { builtFor: 2, host: 3, agents: 1, workflows: 1,
        message: 'built for plugin API 2; this version of worca requires plugin API 3 for agents and pipeline templates \u2014 update or reinstall the plugin (1 agent(s), 1 template(s) ignored)' } },
    { name: 'fine-plugin', version: '1.0.0', enabled: true, contributions: {} },
  ], { doc });
  const cards = el.querySelectorAll('.plugin-card');
  const badge = cards[0].querySelector('.pl-api-mismatch');
  assert.ok(badge, 'needs-update badge renders');
  assert.equal(badge.textContent, 'needs update');
  assert.ok(badge.classList.contains('amber'));
  assert.equal(cards[0].querySelector('.pl-broken'), null,
    'needs-update WINS: an outdated plugin never also shows the red "broken" badge');
  assert.equal(cards[0].querySelectorAll('.badge').length, 1, 'exactly one badge on the card');
  const note = cards[0].querySelector('.pl-api-note');
  assert.equal(note.textContent,
    'built for plugin API 2; this version of worca requires plugin API 3 for agents and pipeline '
    + 'templates \u2014 update or reinstall the plugin (1 agent(s), 1 template(s) ignored)');
  assert.equal(note.previousElementSibling.className, 'pl-contrib hint', 'the note follows the contributions line');
  assert.equal(cards[1].querySelector('.pl-api-mismatch'), null);
  assert.equal(cards[1].querySelector('.pl-api-note'), null);
});

test('a card without apiMismatch renders no note (the browser has no formatter of its own)', () => {
  const el = renderPluginList([{ name: 'fine', version: '1.0.0', enabled: true, contributions: {} }], { doc });
  assert.equal(el.querySelector('.pl-api-note'), null);
});

test('connect result: connected / waiting / field errors, and a bare transport error', () => {
  const okEl = renderConnectResult(
    { ok: true, identity: 'Jane Doe', instance: { baseUrl: 'https://tracker.example.com/jira', project: 'PROJ' } },
    { doc },
  );
  assert.equal(okEl.querySelector('.badge').textContent, 'connected');
  assert.match(okEl.textContent, /Jane Doe/);
  assert.match(okEl.textContent, /tracker\.example\.com\/jira · PROJ/); // which instance, not just who
  // An older/unknown instance is simply omitted, never rendered as "null".
  assert.doesNotMatch(renderConnectResult({ ok: true, identity: 'X' }, { doc }).textContent, /null/);

  // pending is the poll signal: setup is legitimately mid-flight, not failed.
  const waitEl = renderConnectResult({ ok: false, pending: true, message: 'Browser opening — sign in there.' }, { doc });
  assert.equal(waitEl.querySelector('.badge').textContent, 'waiting');
  assert.match(waitEl.textContent, /Browser opening/);

  const errEl = renderConnectResult({ ok: false, errors: [{ field: 'ticketUrl', message: 'Paste any ticket URL.' }] }, { doc });
  assert.equal(errEl.querySelector('.badge').textContent, 'not connected');
  assert.equal(errEl.querySelectorAll('.pl-connect-err').length, 1);
  assert.match(errEl.textContent, /ticketUrl/);

  // No envelope at all (shim transport failure) still renders one row.
  const bare = renderConnectResult({ ok: false, error: { kind: 'timeout', message: 'jtr whoami timed out' } }, { doc });
  assert.match(bare.textContent, /timed out/);
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

// ── model contributions in the plugin surfaces (design §9.4, §9.6) ───────────

test('install consent: models section — base URL verbatim + model secrets red', () => {
  const el = renderInstallConsent(
    { name: 'team-models', repoUrl: 'https://example.com/r', sha: 'a1b2c3d4e5f6' },
    {
      agents: [], taskSources: [], skills: [], workflows: [],
      models: [
        { id: 'ds-stable', label: 'DS Stable', efforts: ['medium'], envKeys: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'], baseUrl: 'https://api.ds.example' },
        { id: 'ds-plain', label: 'DS Plain', efforts: [], envKeys: [], baseUrl: null },
      ],
      modelSecrets: [{ key: 'ds-token', label: 'DS token' }],
    },
    { doc },
  );
  const text = el.textContent;
  assert.match(text, /Models \(2\)/);
  assert.match(text, /routes to: https:\/\/api\.ds\.example/, 'base URL shown verbatim');
  assert.match(text, /requests model secret: ds-token \(DS token\)/);
  assert.ok([...el.querySelectorAll('.pl-secret')].length >= 2, 'base URL + model secret render red');
});

test('update preview: model delta flags — env change and new model secret are red', () => {
  const el = renderUpdatePreview({
    pinnedSha: 'a'.repeat(12), candidateSha: 'b'.repeat(12),
    commits: [{ sha: 'b'.repeat(12), subject: 'reroute' }],
    manifestDelta: {
      newSecrets: [], newTaskSources: [], newAgents: [], setupChanged: false,
      newModels: ['ds-new'], removedModels: ['ds-old'],
      envChangedModels: ['ds-stable'], newModelSecrets: ['ds-token'],
    },
  }, { doc });
  const reds = [...el.querySelectorAll('.pl-delta-secret')].map((n) => n.textContent);
  assert.ok(reds.some((t) => /MODEL ENV CHANGED .*ds-stable/.test(t)));
  assert.ok(reds.some((t) => /NEW MODEL SECRET requested: ds-token/.test(t)));
  const infos = [...el.querySelectorAll('.pl-delta')].map((n) => n.textContent);
  assert.ok(infos.includes('new model: ds-new'));
  assert.ok(infos.includes('removed model: ds-old'));
});

test('plugin list card counts models; references409 renders model guard entries', () => {
  const list = renderPluginList([{
    name: 'team-models', version: '1', enabled: true,
    contributions: { agents: 0, taskSources: 0, models: 3, skills: 0, workflows: 0 },
  }], { doc });
  assert.match(list.querySelector('.pl-contrib').textContent, /3 models/);

  const refs = renderReferences409([
    { id: 'ds-stable', steps: [{ projectKey: 'a', step: 'planner' }], nodes: [{ projectKey: 'a', workflowId: 'w', nodeId: 'n' }] },
  ], { doc });
  assert.match(refs.querySelector('li').textContent, /model: ds-stable \(2 pipeline selections\)/);
});

// ── marketplaces: available cards, registry rows, installed provenance ───────

const MKT = {
  id: 'm-1', url: '/tmp/m1', name: 'Fixture Market', description: 'x', builtin: true,
  addedAt: '2026-08-17T00:00:00Z',
  lastSync: { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', at: '2026-08-17T10:00:00Z' },
  warnings: ['worca-cc-marketplace.json: bad/entry — skipped'],
  plugins: [
    { name: 'aa', subdir: 'plugins/aa', description: 'first', version: '1.0.0', installed: false, inventory: {} },
    { name: 'bb', subdir: 'plugins/bb', description: 'second', version: null, installed: true, inventory: {} },
  ],
};

test('renderAvailableList: install button only for non-installed; marketplace badge; installed tag', () => {
  const el = renderAvailableList([MKT], { doc });
  const cards = el.querySelectorAll('.pl-avail-card');
  assert.equal(cards.length, 2);
  const btn = cards[0].querySelector('.pl-install-avail');
  assert.ok(btn);
  assert.equal(btn.dataset.name, 'aa');
  assert.equal(btn.dataset.marketplace, 'm-1');
  assert.match(cards[0].querySelector('.pl-mkt-badge').textContent, /Fixture Market/);
  assert.ok(!cards[1].querySelector('.pl-install-avail'), 'installed plugin has no install button');
  assert.match(cards[1].querySelector('.pl-installed').textContent, /Installed/);
});

test('renderAvailableList: never-synced marketplace disables install; empty states', () => {
  const unsynced = { ...MKT, id: 'm-2', lastSync: null, plugins: [{ name: 'cc', subdir: '', description: '', version: null, installed: false, inventory: {} }] };
  const el = renderAvailableList([unsynced], { doc });
  assert.ok(!el.querySelector('.pl-install-avail'), 'no install button before first sync');
  assert.match(renderAvailableList([], { doc }).textContent, /No marketplaces yet/);
  assert.match(renderAvailableList([{ ...MKT, plugins: [] }], { doc }).textContent, /No plugins discovered/);
});

test('renderMarketplaceList: builtin badge, sync line (relTime), warnings, action buttons', () => {
  const el = renderMarketplaceList([MKT], { doc, now: Date.parse('2026-08-17T13:00:00Z') }); // C4: inject now
  const row = el.querySelector('.pl-mkt-row');
  assert.equal(row.dataset.id, 'm-1');
  assert.match(row.querySelector('.pl-mkt-builtin').textContent, /built-in/);
  assert.match(row.querySelector('.pl-mkt-sync').textContent, /a1b2c3d.*synced .*(ago|\d{4}-).*2 plugins/);
  assert.match(row.querySelector('.pl-mkt-warning').textContent, /bad\/entry/);
  assert.equal(row.querySelector('.pl-mkt-refresh').dataset.id, 'm-1');
  assert.equal(row.querySelector('.pl-mkt-remove').dataset.id, 'm-1');
  const never = renderMarketplaceList([{ ...MKT, id: 'm-3', lastSync: null, warnings: [] }], { doc });
  assert.match(never.querySelector('.pl-mkt-sync').textContent, /never synced/);
});

test('renderPluginList: provenance line renders marketplace + repo @ sha7', () => {
  const el = renderPluginList([{
    name: 'aa', version: '1.0.0', pinnedSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    enabled: true, linked: false, broken: false,
    contributions: { agents: 0, taskSources: 1, chatChannels: 0, models: 0, skills: 0, workflows: 0 },
    repo: '/tmp/m1', subdir: 'plugins/aa', marketplace: 'm-1', marketplaceName: 'Fixture Market',
  }], { doc });
  const prov = el.querySelector('.pl-provenance');
  assert.ok(prov);
  assert.match(prov.textContent, /Fixture Market · \/tmp\/m1 @ a1b2c3d/);
});

test('relTime: fixed-now buckets (pure, jsdom-safe) (C4)', () => {
  const now = Date.parse('2026-08-17T12:00:00Z');
  assert.equal(relTime('2026-08-17T11:59:40Z', now), 'just now');
  assert.equal(relTime('2026-08-17T11:55:00Z', now), '5m ago');
  assert.equal(relTime('2026-08-17T09:00:00Z', now), '3h ago');
  assert.equal(relTime('2026-08-15T12:00:00Z', now), '2d ago');
  assert.equal(relTime('not-a-date', now), 'not-a-date');
});

test('renderPluginList: provenance falls back to the raw repo when marketplaceName is null (E14)', () => {
  const el = renderPluginList([{
    name: 'bb', version: '1.0.0', pinnedSha: 'deadbeefcafebabe0000000000000000deadbeef',
    enabled: true, linked: false, broken: false,
    contributions: { agents: 0, taskSources: 1, chatChannels: 0, models: 0, skills: 0, workflows: 0 },
    repo: '/tmp/gone-repo', subdir: 'plugins/bb', marketplace: 'gone', marketplaceName: null,
  }], { doc });
  const prov = el.querySelector('.pl-provenance');
  assert.ok(prov);
  assert.match(prov.textContent, /\/tmp\/gone-repo @ deadbee/);
  assert.doesNotMatch(prov.textContent, /·/); // no marketplace name -> no separator
});

test('a card renders the ignored contributions as an amber note (MAJ-13)', () => {
  const el = renderPluginList([
    { name: 'coll-plug', version: '0.1.0', enabled: true, contributions: { agents: 2, workflows: 2 },
      ignored: [
        { file: 'agents/planner.meta.json', reason: 'collides with an existing agent' },
        { file: 'workflows/coll-flow.json', reason: 'invalid template (V5: wire \'w1\': \'n_p.brief\' is not a declared input)' },
      ] },
    { name: 'fine-plugin', version: '1.0.0', enabled: true, contributions: {}, ignored: [] },
  ], { doc });
  const cards = el.querySelectorAll('.plugin-card');
  const note = cards[0].querySelector('.pl-ignored-note');
  assert.ok(note, 'the ignored note renders');
  assert.equal(note.className, 'pl-ignored-note hint err');
  assert.equal(note.textContent,
    '2 contributions ignored: agents/planner.meta.json — collides with an existing agent; '
    + "workflows/coll-flow.json — invalid template (V5: wire 'w1': 'n_p.brief' is not a declared input)");
  assert.equal(cards[1].querySelector('.pl-ignored-note'), null, 'a clean plugin gets no note');
  // singular
  const one = renderPluginList([{ name: 'p', version: '1', enabled: true, contributions: {},
    ignored: [{ file: 'agents/x.meta.json', reason: 'unreadable JSON' }] }], { doc });
  assert.equal(one.querySelector('.pl-ignored-note').textContent,
    '1 contribution ignored: agents/x.meta.json — unreadable JSON');
});
