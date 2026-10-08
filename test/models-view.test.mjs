// test/models-view.test.mjs — pure jsdom tests for the Models-view renderers
// (configurable-models-design.md §4.10). No app.js boot: every renderer takes
// `doc` explicitly and returns detached DOM (guardrails-view test pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import {
  suggestDuplicateId, renderModelsList, renderModelEditor,
  collectModelEditor, makeEnvRow, setModelCost, setModelEngine,
  renderExportWizard, collectExportWizard, applyConnectionModeIn,
} from '../ui/public/models-view.mjs';
import { bridgedBadge, degradationLine } from '../ui/public/bridge-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const EFFORTS = ['medium', 'high', 'xhigh', 'max'];
const PREDEFINED = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: EFFORTS },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'] },
];
const GLOBAL = {
  id: 'glm-4.7', label: 'GLM (proxy)', efforts: ['medium', 'high'],
  env: { ANTHROPIC_BASE_URL: '••••••e/v1', ANTHROPIC_AUTH_TOKEN: '••••••1234', X_REF: '${MY_VAR}' },
};
const SHADOW = { id: 'claude-sonnet-4-6', label: 'Sonnet via proxy', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: '••••••e/v1' } };

test('list: global cards get Edit/Delete + shadow badge; legacy get Promote; built-ins read-only + overridden badge', () => {
  const el = renderModelsList({
    globals: [GLOBAL, SHADOW],
    legacy: [{ id: 'old-local', label: 'Old Local' }],
    predefined: PREDEFINED,
    efforts: EFFORTS,
    projectName: 'my-repo',
  }, { doc });

  const cards = el.querySelectorAll('.mv-card:not(.mv-legacy)');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.id, 'glm-4.7');
  assert.equal(cards[0].querySelector('.mv-shadow'), null, 'non-shadow entry has no override badge');
  assert.ok(cards[0].querySelector('.mv-edit'));
  assert.ok(cards[0].querySelector('.mv-delete'));
  assert.match(cards[0].querySelector('.mv-summary').textContent, /3 env vars · routes via base URL/);
  assert.equal(cards[1].querySelector('.mv-shadow').textContent, 'overrides built-in');

  const legacy = el.querySelectorAll('.mv-legacy');
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].querySelector('.mv-origin').textContent, 'project (legacy)');
  assert.equal(legacy[0].querySelector('.mv-promote').dataset.id, 'old-local');

  const builtins = el.querySelectorAll('.mv-builtin');
  assert.equal(builtins.length, 2);
  assert.equal(builtins[0].querySelector('.mv-shadowed'), null);
  assert.equal(builtins[1].querySelector('.mv-shadowed').textContent, 'overridden', 'sonnet is overridden by SHADOW');
  assert.equal(builtins[0].querySelector('button'), null, 'built-ins carry no actions');
});

test('editor (edit): id locked, efforts reflect the entry, masked env rows carry data-original', () => {
  const el = renderModelEditor(GLOBAL, EFFORTS, { doc });
  assert.equal(el.dataset.mode, 'edit');
  assert.equal(el.dataset.id, 'glm-4.7');
  assert.equal(el.querySelector('.mv-id').disabled, true);
  assert.deepEqual(
    [...el.querySelectorAll('.mv-effort-cb')].filter((c) => c.checked).map((c) => c.value),
    ['medium', 'high'],
  );
  const rows = [...el.querySelectorAll('.mv-env-row')];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('.mv-env-val').value, '••••••e/v1');
  assert.equal(rows[0].querySelector('.mv-env-val').dataset.original, '••••••e/v1');
  assert.equal(el.dataset.envKeys, 'ANTHROPIC_BASE_URL\nANTHROPIC_AUTH_TOKEN\nX_REF');
});

test('collect (create): id from input, partial efforts, env rows as typed; full effort set collapses to []', () => {
  const el = renderModelEditor(null, EFFORTS, { doc });
  el.querySelector('.mv-id').value = '  my-model  ';
  el.querySelector('.mv-label').value = 'Mine';
  el.querySelector('.mv-efforts').appendChild(makeEnvRow({ doc })); // noop guard: env rows live in .mv-env
  el.querySelector('.mv-env').appendChild(makeEnvRow({ doc }));
  const row = el.querySelector('.mv-env .mv-env-row');
  row.querySelector('.mv-env-key').value = 'ANTHROPIC_BASE_URL';
  row.querySelector('.mv-env-val').value = 'https://x';

  let { id, body } = collectModelEditor(el);
  assert.equal(id, null);
  assert.deepEqual(body, { id: 'my-model', label: 'Mine', efforts: [], env: { ANTHROPIC_BASE_URL: 'https://x' }, cost: null });

  // Uncheck one effort -> the subset is sent.
  el.querySelector('.mv-effort-cb[value="max"]').checked = false;
  ({ body } = collectModelEditor(el));
  assert.deepEqual(body.efforts, ['medium', 'high', 'xhigh']);
});

test('collect (edit): removed env rows become null-deletes; kept masked values are echoed', () => {
  const el = renderModelEditor(GLOBAL, EFFORTS, { doc });
  // Remove the token row entirely; change the base URL; keep X_REF untouched.
  const rows = [...el.querySelectorAll('.mv-env-row')];
  rows[1].remove(); // ANTHROPIC_AUTH_TOKEN
  rows[0].querySelector('.mv-env-val').value = 'https://new.example';

  const { id, body } = collectModelEditor(el);
  assert.equal(id, 'glm-4.7');
  assert.equal(body.env.ANTHROPIC_BASE_URL, 'https://new.example');
  assert.equal(body.env.ANTHROPIC_AUTH_TOKEN, null, 'removed row -> null delete');
  assert.equal(body.env.X_REF, '${MY_VAR}', 'untouched value echoed (server keeps refs readable)');
});

// ── plugin section + export wizard (design §9.5–§9.6) ────────────────────────

const PLUGINS = [
  {
    id: 'ds-stable', label: 'DS Stable', efforts: ['medium', 'high'], plugin: 'team-models',
    env: { ANTHROPIC_BASE_URL: '••••••mple', ANTHROPIC_AUTH_TOKEN: '(secret: ds-token)' },
    secrets: [{ key: 'ds-token', label: 'DS token', set: false }],
  },
  { id: 'claude-sonnet-4-6', label: 'Sonnet via plugin', efforts: ['medium'], plugin: 'team-models', env: {}, secrets: [] },
];

test('list: plugin cards are read-only with provenance + secret status + Edit-a-copy; shadows badge both ways', () => {
  const el = renderModelsList({
    globals: [{ ...GLOBAL, id: 'ds-stable' }],
    plugins: PLUGINS,
    predefined: PREDEFINED,
    efforts: EFFORTS,
  }, { doc });

  const cards = [...el.querySelectorAll('.mv-plugin')];
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.plugin, 'team-models');
  assert.equal(cards[0].querySelector('.mv-origin').textContent, 'plugin: team-models');
  assert.equal(cards[0].querySelector('.mv-edit'), null, 'no Edit on plugin cards');
  assert.equal(cards[0].querySelector('.mv-delete'), null, 'no Delete on plugin cards');
  const copy = cards[0].querySelector('.mv-copy');
  assert.equal(copy.dataset.id, 'ds-stable');
  assert.equal(copy.dataset.plugin, 'team-models');
  assert.match(cards[0].querySelector('.mv-secret').textContent, /NOT SET/);
  assert.match(cards[0].querySelector('.mv-shadowed').textContent, /overridden by your copy/,
    'the user global with the same id shadows this plugin entry');

  // The user's global card says it overrides the plugin (not a built-in).
  const globalCard = el.querySelector('.mv-card:not(.mv-plugin):not(.mv-legacy)');
  assert.equal(globalCard.querySelector('.mv-shadow').textContent, 'overrides plugin');

  // A plugin entry with a predefined id marks the built-in overridden.
  const sonnetRow = [...el.querySelectorAll('.mv-builtin')].find((r) => r.dataset.id === 'claude-sonnet-4-6');
  assert.equal(sonnetRow.querySelector('.mv-shadowed').textContent, 'overridden');
});

test('export wizard: renders picks + env policy (secret-ish defaults) and collects the POST body', () => {
  const globals = [
    { id: 'ds-stable', label: 'DS Stable', efforts: EFFORTS, env: { ANTHROPIC_BASE_URL: '••••••mple', ANTHROPIC_AUTH_TOKEN: '••••••1234' } },
    { id: 'other', label: 'Other', efforts: EFFORTS },
  ];
  const el = renderExportWizard(globals, { doc });
  const cbs = [...el.querySelectorAll('.mvx-model-cb')];
  assert.deepEqual(cbs.map((c) => c.value), ['ds-stable', 'other']);
  assert.equal(cbs[0].dataset.envKeys, 'ANTHROPIC_BASE_URL\nANTHROPIC_AUTH_TOKEN');

  const rows = [...el.querySelectorAll('.mvx-env-row')];
  assert.deepEqual(rows.map((r) => r.dataset.key), ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']);
  assert.equal(rows[0].querySelector('.mvx-mode').value, 'include', 'base URL defaults to include');
  assert.equal(rows[1].querySelector('.mvx-mode').value, 'secret', 'TOKEN-ish key defaults to require-at-install');
  assert.ok(rows[1].querySelector('.mvx-warn'), 'credential-looking key is called out');

  cbs[0].checked = true;
  el.querySelector('.mvx-name').value = ' team-models ';
  el.querySelector('.mvx-desc').value = 'Team routing';
  el.querySelector('.mvx-dest').value = '~/dev/team-models';
  const body = collectExportWizard(el);
  assert.deepEqual(body, {
    name: 'team-models', description: 'Team routing', dest: '~/dev/team-models',
    models: [{ id: 'ds-stable', env: { ANTHROPIC_BASE_URL: 'include', ANTHROPIC_AUTH_TOKEN: 'secret' } }],
  });

  // Version is included only when set; mode changes flow into the body.
  el.querySelector('.mvx-version').value = '1.0.0';
  rows[1].querySelector('.mvx-mode').value = 'omit';
  const body2 = collectExportWizard(el);
  assert.equal(body2.version, '1.0.0');
  assert.equal(body2.models[0].env.ANTHROPIC_AUTH_TOKEN, 'omit');
});

test('export wizard: token LIMITS are not credentials (MAX_OUTPUT_TOKENS defaults to include)', () => {
  const el = renderExportWizard([{
    id: 'm', label: 'M', efforts: EFFORTS,
    env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192', MAX_THINKING_TOKENS: '8191', ANTHROPIC_AUTH_TOKEN: '••1234', API_KEY: '••5678' },
  }], { doc });
  const mode = (k) => [...el.querySelectorAll('.mvx-env-row')].find((r) => r.dataset.key === k).querySelector('.mvx-mode').value;
  assert.equal(mode('CLAUDE_CODE_MAX_OUTPUT_TOKENS'), 'include');
  assert.equal(mode('MAX_THINKING_TOKENS'), 'include');
  assert.equal(mode('ANTHROPIC_AUTH_TOKEN'), 'secret');
  assert.equal(mode('API_KEY'), 'secret');
});

// ── Pricing: the opt-in per-model cost override (config.mjs resolveModelCost) ──

const PRICED = {
  id: 'discreetstack', label: 'DiscreetStack', efforts: EFFORTS,
  env: { ANTHROPIC_BASE_URL: '••••••e/v1' },
  cost: { perMtok: { input: 0.5, output: 1.5 } },
};
const FREE = { id: 'onprem', label: 'On-prem', efforts: EFFORTS, cost: { free: true } };
const mode = (el) => el.querySelector('.mv-cost-mode-rb:checked')?.value;
const rate = (el, k) => el.querySelector(`.mv-cost-rate-in[data-rate="${k}"]`);

test('collect: each pricing mode emits its own cost shape (blank rates omitted, zero kept, all-blank perMtok sent as-is)', async () => {
  await checkRows([
    { name: 'collect: each mode emits its own cost shape; only filled rates are sent, as numbers', run: () => {
      const el = renderModelEditor(null, EFFORTS, { doc });
      el.querySelector('.mv-id').value = 'm';
      assert.equal(collectModelEditor(el).body.cost, null, 'Trust the CLI = no override');

      el.querySelector('.mv-cost-mode-rb[value="free"]').checked = true;
      assert.deepEqual(collectModelEditor(el).body.cost, { free: true });

      el.querySelector('.mv-cost-mode-rb[value="perMtok"]').checked = true;
      rate(el, 'input').value = '0.5';
      rate(el, 'cacheRead').value = '0.05';
      rate(el, 'output').value = '';
      assert.deepEqual(collectModelEditor(el).body.cost, { perMtok: { input: 0.5, cacheRead: 0.05 } },
        'blank rates are omitted (cacheWrite1h then falls back to the 5m rate), values are numbers');

      // A pinned ZERO is a rate, not a blank.
      rate(el, 'output').value = '0';
      assert.deepEqual(collectModelEditor(el).body.cost.perMtok.output, 0);
    } },
    { name: 'collect: per-Mtok with every rate blank is sent as-is for the server to reject by name', run: () => {
      const el = renderModelEditor(null, EFFORTS, { doc });
      el.querySelector('.mv-id').value = 'm';
      el.querySelector('.mv-cost-mode-rb[value="perMtok"]').checked = true;
      assert.deepEqual(collectModelEditor(el).body.cost, { perMtok: {} },
        'settings.mjs owns the rules — duplicating them here would let them drift');
    } },
  ]);
});

test('collect: the override ROUND-TRIPS, so editing a label never silently reprices a model', () => {
  const el = renderModelEditor(PRICED, EFFORTS, { doc });
  el.querySelector('.mv-label').value = 'Renamed';
  const { body } = collectModelEditor(el);
  assert.equal(body.label, 'Renamed');
  assert.deepEqual(body.cost, { perMtok: { input: 0.5, output: 1.5 } }, 'untouched pricing survives');
});

test('setModelCost: loads any override into an editor (the ONE cost -> form mapping)', () => {
  const el = renderModelEditor(null, EFFORTS, { doc });
  setModelCost(el, { perMtok: { input: 0.5, cacheWrite1h: 1.2 } });
  assert.equal(mode(el), 'perMtok');
  assert.equal(el.querySelector('.mv-cost-rates').hidden, false);
  assert.equal(rate(el, 'input').value, '0.5');
  assert.equal(rate(el, 'cacheWrite1h').value, '1.2');
  assert.equal(rate(el, 'output').value, '');

  setModelCost(el, { free: true });
  assert.equal(mode(el), 'free');
  assert.equal(rate(el, 'input').value, '', 'switching modes clears the stale rates');

  setModelCost(el, null);
  assert.equal(mode(el), 'cli');
  assert.equal(el.querySelector('.mv-cost-rates').hidden, true);
  setModelCost(doc.createElement('div'), { free: true }); // never throws without the block
});

test('list: priced/free/unpriced badges and summaries on global and plugin cards', async () => {
  await checkRows([
    { name: 'list: a priced model shows its rates and drops the now-meaningless "cost not verified" badge', run: () => {
      const el = renderModelsList({
        globals: [
          { ...PRICED, costUnreliable: true },
          { ...FREE, costUnreliable: true },
          { ...GLOBAL, costUnreliable: true },
        ],
        predefined: [], efforts: EFFORTS,
      }, { doc });
      const cards = [...el.querySelectorAll('.mv-card')];
      const badges = (c) => [...c.querySelectorAll('.badge')].map((b) => b.textContent);

      assert.ok(badges(cards[0]).includes('priced'));
      assert.ok(!badges(cards[0]).includes('cost not verified'),
        'an override GOVERNS the spend — the unreliable flag says nothing about it');
      assert.match(cards[0].querySelector('.mv-summary').textContent, /input \$0\.5 · output \$1\.5 \/Mtok/);

      assert.ok(badges(cards[1]).includes('free'));
      assert.match(cards[1].querySelector('.mv-summary').textContent, /priced free/);

      // A model with NO override still shows the flag — unchanged.
      assert.ok(badges(cards[2]).includes('cost not verified'));
      assert.ok(!badges(cards[2]).includes('priced'));
    } },
    { name: 'list: a plugin card shows its MANIFEST price, same rules as a global card', run: () => {
      const el = renderModelsList({
        globals: [],
        plugins: [
          { id: 'pp-rated', label: 'PP Rated', efforts: EFFORTS, plugin: 'priced-plug', secrets: [],
            env: { ANTHROPIC_BASE_URL: '••••••mple' }, cost: { perMtok: { input: 1, output: 3 } }, costUnreliable: true },
          { id: 'pp-free', label: 'PP Free', efforts: EFFORTS, plugin: 'priced-plug', secrets: [], cost: { free: true } },
          { id: 'pp-plain', label: 'PP Plain', efforts: EFFORTS, plugin: 'priced-plug', secrets: [], costUnreliable: true },
        ],
        predefined: [], efforts: EFFORTS,
      }, { doc });
      const cards = [...el.querySelectorAll('.mv-plugin')];
      const badges = (c) => [...c.querySelectorAll('.badge')].map((b) => b.textContent);

      assert.ok(badges(cards[0]).includes('priced'));
      assert.ok(!badges(cards[0]).includes('cost not verified'), 'a pinned price governs the spend');
      assert.match(cards[0].querySelector('.mv-summary').textContent, /input \$1 · output \$3 \/Mtok/);
      assert.ok(badges(cards[1]).includes('free'));
      assert.ok(badges(cards[2]).includes('cost not verified'), 'unpriced plugin model: flag unchanged');
    } },
  ]);
});

// ── Duplicate ────────────────────────────────────────────────────────────────

test('suggestDuplicateId: first free -copy, then numbered, case-insensitively', () => {
  assert.equal(suggestDuplicateId('glm-4.7', []), 'glm-4.7-copy');
  assert.equal(suggestDuplicateId('glm-4.7', ['glm-4.7']), 'glm-4.7-copy');
  assert.equal(suggestDuplicateId('glm-4.7', ['glm-4.7', 'glm-4.7-copy']), 'glm-4.7-copy-2');
  assert.equal(suggestDuplicateId('glm-4.7', ['GLM-4.7-COPY', 'glm-4.7-copy-2']), 'glm-4.7-copy-3',
    'ids collide case-insensitively, so the suggestion must too');
  // Duplicating a duplicate keeps stacking rather than fighting over one name.
  assert.equal(suggestDuplicateId('glm-4.7-copy', ['glm-4.7-copy']), 'glm-4.7-copy-copy');
});

// ── #422: endpoint-routed badge ──

test('list (#422): endpoint-routed badge on global + plugin cards whose env carries ANTHROPIC_BASE_URL, and only those', () => {
  const plain = { id: 'plain', label: 'Plain', efforts: [], env: { ANTHROPIC_AUTH_TOKEN: '••••' } };
  const plug = { id: 'pm', label: 'PM', efforts: [], plugin: 'p', env: { ANTHROPIC_BASE_URL: '••••' }, secrets: [] };
  const root = renderModelsList({ globals: [GLOBAL, plain], plugins: [plug], predefined: PREDEFINED, efforts: EFFORTS }, { doc });
  const badgeOf = (id) => root.querySelector(`.mv-card[data-id="${id}"] .mv-routed`);
  assert.ok(badgeOf('glm-4.7'), 'routed global');
  assert.equal(badgeOf('plain'), null, 'no base url → no badge');
  assert.ok(badgeOf('pm'), 'routed plugin');
  assert.match(badgeOf('glm-4.7').title, /haiku\/sonnet\/opus\/fable/);
});

const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high'];

test('list: Codex built-ins have their own group; a Codex custom model carries a Codex badge', () => {
  const el = renderModelsList({
    globals: [{ id: 'gpt-5.5-tuned', label: 'Tuned', efforts: ['low', 'high'], engine: 'codex' }],
    predefined: PREDEFINED, efforts: EFFORTS,
    codex: [{ id: 'gpt-5.5', label: 'GPT-5.5', efforts: CODEX_EFFORTS }], codexEfforts: CODEX_EFFORTS,
  }, { doc });
  const sec = el.querySelector('.mv-section[data-section="codex"]');
  assert.ok(sec);
  assert.equal(sec.querySelector('.mv-section-title').textContent, 'Codex built-in models');
  assert.deepEqual([...sec.querySelectorAll('.mv-builtin.mv-codex')].map((r) => r.dataset.id), ['gpt-5.5']);
  assert.match(sec.querySelector('.mv-summary').textContent, /gpt-5\.5 — all efforts/);
  const card = el.querySelector('.mv-card[data-id="gpt-5.5-tuned"]');
  assert.equal(card.querySelector('.mv-engine').textContent, 'Codex');
  assert.match(card.querySelector('.mv-summary').textContent, /low · high/);
  assert.equal(el.querySelectorAll('.mv-builtin:not(.mv-codex)').length, 2);
});

test('editor: the engine swaps the efforts and hides env for Codex; collect sends it', () => {
  const el = renderModelEditor(null, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
  const engine = el.querySelector('.mv-engine');
  assert.equal(engine.value, 'claude');
  assert.equal(engine.disabled, false);
  setModelEngine(el, 'codex');
  assert.equal(engine.value, 'codex');
  assert.deepEqual([...el.querySelectorAll('.mv-effort-cb')].map((c) => c.value), CODEX_EFFORTS);
  assert.equal(el.querySelector('.mv-env').closest('.mv-field').hidden, true);
  assert.equal(el.querySelector('.mv-conn').closest('.mv-field').hidden, false, 'a Codex model keeps a (narrowed) Connection');
  el.querySelector('.mv-id').value = 'gpt-5.5-tuned';
  el.querySelector('.mv-effort-cb[value="minimal"]').checked = false;
  const { id, body } = collectModelEditor(el);
  assert.equal(id, null);
  assert.equal(body.engine, 'codex');
  assert.deepEqual(body.efforts, ['low', 'medium', 'high']);
  assert.deepEqual(body.env, {});
  assert.equal('upstream' in body, false);
  setModelEngine(el, 'claude');
  assert.deepEqual([...el.querySelectorAll('.mv-effort-cb')].map((c) => c.value), EFFORTS);
  assert.equal(collectModelEditor(el).body.engine, undefined, 'a Claude create body is unchanged');
  const edit = renderModelEditor({ id: 'gpt-5.5-tuned', label: 'Tuned', efforts: ['low'], engine: 'codex' }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
  assert.equal(edit.querySelector('.mv-engine').disabled, true, 'the engine is fixed once created');
  assert.deepEqual([...edit.querySelectorAll('.mv-effort-cb')].filter((c) => c.checked).map((c) => c.value), ['low']);
  assert.equal(edit.querySelector('.mv-env').closest('.mv-field').hidden, true);
});

test('editor: a Codex Connection offers codex\'s default or an OpenAI-compatible Responses endpoint, nothing else', () => {
  const providers = { openai: { configured: false, keySet: false, keyOptional: false } };
  const el = renderModelEditor(null, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, providers });
  setModelEngine(el, 'codex');
  const conn = el.querySelector('.mv-conn');
  const shown = [...conn.querySelectorAll('.mv-conn-mode')].filter((l) => !l.hidden);
  assert.deepEqual(shown.map((l) => l.querySelector('.mv-conn-mode-rb').value), ['direct', 'provider'], 'no env mode on Codex');
  assert.deepEqual(shown.map((l) => l.querySelector('.mv-conn-mode-title').textContent), ['Codex default', 'OpenAI-compatible endpoint']);
  conn.querySelector('.mv-conn-mode-rb[value="provider"]').checked = true;
  applyConnectionModeIn(el);
  const prov = conn.querySelector('.mv-conn-provider');
  assert.equal(prov.value, 'openai');
  assert.equal(prov.disabled, true);
  assert.deepEqual([...prov.options].filter((o) => !o.hidden).map((o) => o.value), ['openai']);
  assert.deepEqual([...conn.querySelectorAll('.mv-conn-api option')].map((o) => o.value), ['openai-responses'], 'codex no longer speaks chat completions');
  assert.equal(conn.querySelector('.mv-conn-caps').hidden, true, 'the bridge\'s capability pins do not apply');
  assert.equal(conn.querySelector('.mv-conn-adv').hidden, false, 'Base URL, key and headers overrides stay');
  assert.match(conn.querySelector('.mv-conn-provider-hint').textContent, /No provider key/);
  assert.match(conn.querySelector('.mv-conn-note').textContent, /Codex calls the endpoint’s Responses API itself/);
  assert.ok([...el.querySelectorAll('.mv-effort-cb')].every((c) => !c.disabled), 'efforts are not collapsed as for a translated model');
  el.querySelector('.mv-id').value = 'cx-local';
  conn.querySelector('.mv-conn-model').value = 'qwen3-coder';
  conn.querySelector('.mv-conn-baseurl').value = 'http://127.0.0.1:8000/v1';
  conn.querySelector('.mv-conn-key').value = '${CX_KEY}';
  conn.querySelector('.mv-conn-headers').value = 'X-Team: blue';
  const { body } = collectModelEditor(el);
  assert.equal(body.engine, 'codex');
  assert.deepEqual(body.env, {});
  assert.deepEqual(body.upstream, { provider: 'openai', api: 'openai-responses', model: 'qwen3-coder', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '${CX_KEY}', headers: { 'X-Team': 'blue' } });
  // A stored Codex endpoint renders in provider mode; going back to Claude restores every mode and provider.
  const edit = renderModelEditor({ id: 'cx-local', engine: 'codex', efforts: CODEX_EFFORTS, upstream: body.upstream }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
  assert.equal(edit.querySelector('.mv-conn-mode-rb:checked').value, 'provider');
  assert.equal(collectModelEditor(edit).body.upstream.model, 'qwen3-coder');
  edit.querySelector('.mv-conn-mode-rb[value="direct"]').checked = true;
  assert.equal(collectModelEditor(edit).body.upstream, null, 'switching back to codex\'s default clears the endpoint');
  setModelEngine(el, 'claude');
  assert.equal([...conn.querySelectorAll('.mv-conn-mode')].filter((l) => !l.hidden).length, 3);
  assert.equal(prov.disabled, false);
  assert.equal(conn.querySelector('.mv-conn-mode-rb[value="direct"]').closest('.mv-conn-mode').querySelector('.mv-conn-mode-title').textContent, 'Anthropic API / CLI default');
});

test('cards: a Codex endpoint model says endpoint, not bridged, and carries no translation line', () => {
  const m = { id: 'cx-local', engine: 'codex', bridged: 'openai', upstreamModel: 'qwen3-coder', upstream: { provider: 'openai', api: 'openai-responses', model: 'qwen3-coder' } };
  const b = bridgedBadge(m, { doc });
  assert.equal(b.textContent, 'endpoint: openai');
  assert.match(b.title, /Codex connects to this OpenAI-compatible endpoint itself as qwen3-coder/);
  assert.equal(degradationLine(m), '');
});

test('list: a Codex built-in shadowed by a same-id model of any engine says overridden', () => {
  const el = renderModelsList({
    globals: [{ id: 'gpt-5.5', label: 'GPT via proxy', efforts: ['medium'] }],
    predefined: PREDEFINED, efforts: EFFORTS,
    codex: [{ id: 'gpt-5.5', label: 'GPT-5.5', efforts: CODEX_EFFORTS }, { id: 'gpt-5.6-sol', label: 'Sol', efforts: CODEX_EFFORTS }], codexEfforts: CODEX_EFFORTS,
    policy: [{ id: 'gpt-5.6-sol', label: 'Sol via Acme', efforts: ['medium'], home: 'acme/gateway' }],
  }, { doc });
  const badge = (id) => !!el.querySelector(`.mv-builtin.mv-codex[data-id="${id}"] .mv-shadowed`);
  assert.equal(badge('gpt-5.5'), true, 'a Claude global of the same id owns it');
  assert.equal(badge('gpt-5.6-sol'), true, 'a team-policy model of the same id owns it');
});
