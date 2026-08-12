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
