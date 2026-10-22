// test/plugins-view.test.mjs — pure jsdom tests for the Plugins-view renderers.
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  renderInstallConsent, renderUpdatePreview,
  renderConfigForm, collectConfigForm, renderConnectResult,
  relTime,
} from '../ui/public/plugins-view.mjs';
import { checkRows } from './helpers/rows.mjs';

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

test('install consent: an ask-forms line only for agents with forms; a pre-forms snapshot renders none', async () => {
  await checkRows([
    { name: 'install consent names an agent’s ask forms and the file types they may display', run: () => {
      const el = renderInstallConsent(
        { name: 'mockup-source', repoUrl: 'https://github.com/o/r', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
        {
          agents: [
            { key: 'mockupReviewer', tools: ['Read'], forms: ['review-mockups'], fileTypes: ['application/pdf', 'image/*'] },
            { key: 'plainAgent', tools: [], forms: [], fileTypes: [] },
          ],
          taskSources: [], skills: [], workflows: [], depCount: null, setupCommands: [],
        },
        { doc },
      );
      const rows = [...el.querySelectorAll('.pl-consent-forms')];
      assert.equal(rows.length, 1, 'only the agent that HAS forms gets the line');
      assert.equal(rows[0].textContent,
        '1 form: review-mockups · may display application/pdf, image/* from the run folder');
      assert.match(el.textContent, /mockupReviewer — tools: Read/, 'the tools line is untouched');
    } },
    { name: 'install consent tolerates a snapshot taken before ask forms existed', run: () => {
      const el = renderInstallConsent(
        { name: 'old-snap', repoUrl: 'https://github.com/o/r', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
        { agents: [{ key: 'legacy', tools: ['Read'] }], taskSources: [], skills: [], workflows: [], depCount: null, setupCommands: [] },
        { doc },
      );
      assert.equal(el.querySelector('.pl-consent-forms'), null);
      assert.match(el.textContent, /legacy — tools: Read/);
    } },
  ]);
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
test('config form profiles: roster + stamped form; empty roster offers only Add; single-profile source has no roster and collect omits profile', async () => {
  await checkRows([
    { name: 'a multiProfile source renders a profile roster and stamps the form with it', run: () => {
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
    } },
    { name: 'a multiProfile source with NO profiles yet asks for one instead of showing a form', run: () => {
      // Saving into a profile that does not exist is the one thing the server
      // rejects outright, so an empty roster must not render a fillable form.
      const schema = [{ key: 'ticketUrl', type: 'text', label: 'Ticket URL', secret: false, required: true, default: null, help: null, options: [] }];
      const root = renderConfigForm([{ id: 'jira', schema, multiProfile: true, profile: null, profiles: [], values: {} }], { doc });
      assert.equal(root.querySelector('.pl-config-form'), null, 'no form without a profile to write to');
      assert.ok(root.querySelector('.pl-profile-add'), 'the only offered action is creating one');
      assert.match(root.textContent, /No profiles yet/i);
    } },
    { name: 'a single-profile source is untouched: no roster, and collect omits profile', run: () => {
      const schema = [{ key: 'apiBase', type: 'text', label: 'API base', secret: false, required: false, default: null, help: null, options: [] }];
      const root = renderConfigForm([{ id: 'github', schema, values: { apiBase: 'https://api.github.com' } }], { doc });
      assert.equal(root.querySelector('.pl-profile-bar'), null, 'no profile UI for a single-instance source');
      const got = collectConfigForm(root.querySelector('.pl-config-form'));
      assert.ok(!('profile' in got), 'the profile key never appears for a single-profile source');
    } },
  ]);
});

test('update preview: commits, diffstat, new-secret line and confirm; up-to-date shows the badge and no confirm/diffstat', async () => {
  await checkRows([
    { name: 'update preview shows commit subjects + diffstat + enabled confirm', run: () => {
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
    } },
    { name: 'update preview with no new commits shows up-to-date state, no confirm button', run: () => {
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
    } },
  ]);
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

test('update preview: chat-channel delta — a new channel secret is red, a new channel is a plain line', () => {
  const el = renderUpdatePreview({ pinnedSha: 'a'.repeat(12), candidateSha: 'b'.repeat(12), commits: [{ sha: 'b'.repeat(12), subject: 'add slack' }],
    manifestDelta: { newChatChannels: ['main'], newChannelSecrets: ['main.botToken'] } }, { doc });
  assert.deepEqual([...el.querySelectorAll('.pl-manifest-delta > div')].map((d) => [d.className, d.textContent]),
    [['pl-delta-secret', 'NEW CHAT SECRET requested: main.botToken'], ['pl-delta', 'new chat channel: main']]);
});

// ── marketplaces: registry rows, installed provenance ───────

test('the Available list is gone: Browse tiles replace it (marketplace P3)', async () => {
  const mod = await import('../ui/public/plugins-view.mjs');
  assert.equal('renderAvailableList' in mod, false);
  assert.equal('renderPluginList' in mod || 'renderOrphanList' in mod, false, 'the Installed tab replaced them (marketplace P5)');
  assert.doesNotMatch(readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8'), /\.pl-avail|\.pl-available/);
});

test('the old Marketplaces list is gone: marketplace cards replace it (marketplace P7)', async () => {
  const mod = await import('../ui/public/plugins-view.mjs');
  assert.equal('renderMarketplaceList' in mod, false);
  assert.doesNotMatch(readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8'), /\.pl-mkt/);
});

test('relTime: fixed-now buckets (pure, jsdom-safe) (C4)', () => {
  const now = Date.parse('2026-08-17T12:00:00Z');
  assert.equal(relTime('2026-08-17T11:59:40Z', now), 'just now');
  assert.equal(relTime('2026-08-17T11:55:00Z', now), '5m ago');
  assert.equal(relTime('2026-08-17T09:00:00Z', now), '3h ago');
  assert.equal(relTime('2026-08-15T12:00:00Z', now), '2d ago');
  assert.equal(relTime('not-a-date', now), 'not-a-date');
});

test('scripts: consent rows (runtime, command, case count), card count, python-missing chip', async () => {
  await checkRows([
    { name: 'install consent lists shipped scripts with their runtime and command', run: () => {
      const el = renderInstallConsent({ name: 'p', repoUrl: 'https://x/y', sha: 'a'.repeat(40) },
        { agents: [], taskSources: [], scripts: [{ key: 'tidy', runtime: 'shell', file: null, command: 'npm run tidy' }, { key: 'lint', runtime: 'node', file: 'lint.mjs', command: null }], skills: [], workflows: [] }, { doc });
      assert.match(el.textContent, /Scripts \(2\)/);
      assert.match(el.textContent, /tidy — shell · npm run tidy/);
      assert.match(el.textContent, /lint — node · lint\.mjs/);
    } },
    { name: 'a consent script row counts its cases', run: () => {
      const el = renderInstallConsent({ name: 'p', repoUrl: 'https://x/y', sha: 'a'.repeat(40) },
        { agents: [], taskSources: [], skills: [], workflows: [],
          scripts: [{ key: 'tidy', runtime: 'shell', file: null, command: 'npm run tidy', cases: 2 },
            { key: 'lint', runtime: 'node', file: 'lint.mjs', command: null, cases: 1 }] }, { doc });
      assert.match(el.textContent, /tidy — shell · npm run tidy · 2 cases/);
      assert.match(el.textContent, /lint — node · lint\.mjs · 1 case/);
    } },
  ]);
});
