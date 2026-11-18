// test/models-view.test.mjs — pure jsdom tests for the Models-view renderers
// (configurable-models-design.md §4.10). No app.js boot: every renderer takes
// `doc` explicitly and returns detached DOM (guardrails-view test pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import {
  suggestDuplicateId, deleteRefsSummary, renderModelEditor,
  collectModelEditor, makeEnvRow, setModelCost, setModelEngine,
  renderExportWizard, collectExportWizard, applyConnectionModeIn,
} from '../ui/public/models-view.mjs';
import { bridgedBadge, degradationLine } from '../ui/public/bridge-view.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const EFFORTS = ['medium', 'high', 'xhigh', 'max'];
const GLOBAL = {
  id: 'glm-4.7', label: 'GLM (proxy)', efforts: ['medium', 'high'],
  env: { ANTHROPIC_BASE_URL: '••••••e/v1', ANTHROPIC_AUTH_TOKEN: '••••••1234', X_REF: '${MY_VAR}' },
};

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

// ── Duplicate ────────────────────────────────────────────────────────────────

test('deleteRefsSummary (PAN-7): one count of every job the delete clears; an override clears nothing', () => {
  const ask = (refs) => deleteRefsSummary('my-gpt', refs);
  assert.equal(ask({ predefinedShadow: false, steps: [], nodes: [], jobs: [] }), 'Delete model "my-gpt"? No job uses it.');
  assert.equal(ask({ steps: [{}], jobs: [{}, {}] }), 'Delete model "my-gpt"? This also clears 3 jobs that use it.');
  assert.equal(ask({ jobs: [{}] }), 'Delete model "my-gpt"? This also clears 1 job that uses it.');
  assert.equal(ask({ nodes: [{}], steps: [{}] }), 'Delete model "my-gpt"? This also clears 2 jobs that use it.');
  assert.equal(ask({}), 'Delete model "my-gpt"? No job uses it.', 'a refs read answered {}');
  assert.equal(ask(null), 'Delete model "my-gpt"? No job uses it.', 'a failed refs read');
  assert.equal(ask({ memoryDefrag: true, jobs: [] }), 'Delete model "my-gpt"? This also clears 1 job that uses it.');
  assert.equal(ask({ memoryDefrag: true, jobs: [{ kind: 'helper', engine: 'claude', key: 'memoryDefrag' }] }),
    'Delete model "my-gpt"? This also clears 1 job that uses it.', 'the defrag pick is counted once');
  assert.equal(ask({ memoryDefrag: true, jobs: [{ kind: 'helper', engine: 'codex', key: 'memoryDefrag' }] }),
    'Delete model "my-gpt"? This also clears 2 jobs that use it.', "Codex's own defragment job is another job");
  assert.equal(ask({ predefinedShadow: true, steps: [], nodes: [], jobs: [] }),
    'Remove the override of built-in "my-gpt"? The built-in entry comes back; nothing else changes.');
});

test('suggestDuplicateId: first free -copy, then numbered, case-insensitively', () => {
  assert.equal(suggestDuplicateId('glm-4.7', []), 'glm-4.7-copy');
  assert.equal(suggestDuplicateId('glm-4.7', ['glm-4.7']), 'glm-4.7-copy');
  assert.equal(suggestDuplicateId('glm-4.7', ['glm-4.7', 'glm-4.7-copy']), 'glm-4.7-copy-2');
  assert.equal(suggestDuplicateId('glm-4.7', ['GLM-4.7-COPY', 'glm-4.7-copy-2']), 'glm-4.7-copy-3',
    'ids collide case-insensitively, so the suggestion must too');
  // Duplicating a duplicate keeps stacking rather than fighting over one name.
  assert.equal(suggestDuplicateId('glm-4.7-copy', ['glm-4.7-copy']), 'glm-4.7-copy-copy');
});

const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high'];

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

test('editor: a new model picks its connection first; through a provider it is Claude Code\'s, and an OpenAI Responses endpoint runs on OpenAI Codex too', () => {
  const providers = { openai: { configured: false, keySet: false, keyOptional: false } };
  const el = renderModelEditor(null, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, providers });
  const conn = el.querySelector('.mv-conn');
  const signin = el.querySelector('.mv-signin-field');
  // A new entry is on no engine until its connection says so: every mode, whatever the sign-in.
  setModelEngine(el, 'codex');
  const shown = [...conn.querySelectorAll('.mv-conn-mode')].filter((l) => !l.hidden);
  assert.deepEqual(shown.map((l) => l.querySelector('.mv-conn-mode-rb').value), ['direct', 'env', 'provider']);
  assert.equal(shown[0].querySelector('.mv-conn-mode-title').textContent, "A harness's own sign-in");
  assert.equal(signin.hidden, false, 'the sign-in asks which harness');
  assert.match(conn.querySelector('.mv-conn-runs').textContent, /^Runs on OpenAI Codex only/);
  // Through a provider the entry is Claude Code's: the sign-in leaves, the efforts are Claude Code's list.
  conn.querySelector('.mv-conn-mode-rb[value="provider"]').checked = true;
  applyConnectionModeIn(el);
  assert.equal(signin.hidden, true);
  assert.equal(el.dataset.engine, 'claude');
  assert.deepEqual([...el.querySelectorAll('.mv-effort-cb')].map((c) => c.value), EFFORTS);
  const prov = conn.querySelector('.mv-conn-provider');
  assert.equal(prov.disabled, false);
  prov.value = 'openai';
  conn.querySelector('.mv-conn-api').value = 'openai-responses';
  conn.querySelector('.mv-conn-model').value = 'gpt-5.5';
  applyConnectionModeIn(el);
  assert.equal(conn.querySelector('.mv-conn-api').value, 'openai-responses');
  assert.equal(conn.querySelector('.mv-conn-runs').textContent, "Runs on Claude Code (through worca's bridge) and OpenAI Codex (directly).");
  // The id follows the provider and the upstream model until typed: gpt-5.5 itself is Codex's own sign-in.
  assert.equal(el.querySelector('.mv-id').value, 'openai-gpt-5.5');
  const { body } = collectModelEditor(el);
  assert.equal('engine' in body, false, 'stored as Claude Code\'s; its harnesses follow from the connection');
  assert.equal(body.id, 'openai-gpt-5.5');
  assert.equal(body.upstream.model, 'gpt-5.5');
  conn.querySelector('.mv-conn-api').value = 'openai-chat';
  applyConnectionModeIn(el);
  assert.match(conn.querySelector('.mv-conn-runs').textContent, /^Runs on Claude Code, through worca's bridge\./);
  // A typed id is kept.
  el.querySelector('.mv-id').value = 'my-gpt'; el.querySelector('.mv-id').dataset.auto = 'off';
  applyConnectionModeIn(el);
  assert.equal(el.querySelector('.mv-id').value, 'my-gpt');
});

test('editor (edit): a stored Codex endpoint model keeps codex\'s rules — its own sign-in or an OpenAI-compatible Responses endpoint', () => {
  const upstream = { provider: 'openai', api: 'openai-responses', model: 'qwen3-coder', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '${CX_KEY}', headers: { 'X-Team': 'blue' } };
  const edit = renderModelEditor({ id: 'cx-local', engine: 'codex', efforts: CODEX_EFFORTS, upstream }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
  const conn = edit.querySelector('.mv-conn');
  const shown = [...conn.querySelectorAll('.mv-conn-mode')].filter((l) => !l.hidden);
  assert.deepEqual(shown.map((l) => l.querySelector('.mv-conn-mode-rb').value), ['direct', 'provider'], 'no env mode on Codex');
  assert.deepEqual(shown.map((l) => l.querySelector('.mv-conn-mode-title').textContent), ['Codex default', 'OpenAI-compatible endpoint']);
  assert.equal(edit.querySelector('.mv-conn-mode-rb:checked').value, 'provider');
  const prov = conn.querySelector('.mv-conn-provider');
  assert.equal(prov.value, 'openai');
  assert.equal(prov.disabled, true);
  assert.deepEqual([...conn.querySelectorAll('.mv-conn-api option')].map((o) => o.value), ['openai-responses'], 'codex no longer speaks chat completions');
  assert.equal(conn.querySelector('.mv-conn-caps').hidden, true, 'the bridge\'s capability pins do not apply');
  assert.match(conn.querySelector('.mv-conn-note').textContent, /Codex calls the endpoint’s Responses API itself/);
  assert.equal(conn.querySelector('.mv-conn-runs').textContent, "Runs on Claude Code (through worca's bridge) and OpenAI Codex (directly).");
  const { body } = collectModelEditor(edit);
  assert.deepEqual(body.env, {});
  assert.deepEqual(body.upstream, upstream);
  edit.querySelector('.mv-conn-mode-rb[value="direct"]').checked = true;
  assert.equal(collectModelEditor(edit).body.upstream, null, 'switching back to codex\'s default clears the endpoint');
});

test('cards: a Codex endpoint model says endpoint, not bridged, and carries no translation line', () => {
  const m = { id: 'cx-local', engine: 'codex', bridged: 'openai', upstreamModel: 'qwen3-coder', upstream: { provider: 'openai', api: 'openai-responses', model: 'qwen3-coder' } };
  const b = bridgedBadge(m, { doc });
  assert.equal(b.textContent, 'endpoint: openai');
  assert.match(b.title, /Codex connects to this OpenAI-compatible endpoint itself as qwen3-coder/);
  assert.equal(degradationLine(m), '');
});

test('editor: Cursor takes no env, no endpoint, no effort and no pricing; the fields come back off Cursor', () => {
  const el = renderModelEditor(null, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, cursorEfforts: [] });
  assert.deepEqual([...el.querySelectorAll('.mv-engine option')].map((o) => o.value), ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen']);
  setModelEngine(el, 'cursor');
  assert.equal(el.querySelector('.mv-engine').value, 'cursor');
  assert.equal(el.querySelectorAll('.mv-effort-cb').length, 0, 'no effort chips');
  assert.equal(el.querySelector('.mv-env').closest('.mv-field').hidden, true);
  assert.equal(el.querySelector('.mv-cost-edit').closest('.mv-field').hidden, true, 'the whole Pricing field');
  assert.equal(el.querySelector('.mv-efforts').closest('.mv-field').hidden, true);
  const conn = el.querySelector('.mv-conn');
  const shown = [...conn.querySelectorAll('.mv-conn-mode')].filter((l) => !l.hidden);
  // A new entry still offers every connection; on Cursor's sign-in it runs on Cursor alone.
  assert.equal(shown.length, 3);
  assert.equal(conn.querySelector('.mv-conn-mode-rb:checked').value, 'direct');
  assert.match(conn.querySelector('.mv-conn-runs').textContent, /^Runs on Cursor only/);
  assert.equal(conn.querySelector('.mv-conn-body').hidden, true);
  el.querySelector('.mv-id').value = 'sonnet-4.5';
  const { body } = collectModelEditor(el);
  assert.equal(body.engine, 'cursor');
  assert.deepEqual(body.env, {});
  assert.deepEqual(body.efforts, []);
  assert.equal('upstream' in body, false);
  setModelEngine(el, 'codex');
  assert.equal(el.querySelector('.mv-cost-edit').closest('.mv-field').hidden, false, 'Pricing is back');
  assert.equal(el.querySelector('.mv-efforts').closest('.mv-field').hidden, false, 'efforts are back');
  assert.deepEqual([...el.querySelectorAll('.mv-effort-cb')].map((c) => c.value), CODEX_EFFORTS);
});

test('editor: Goose takes no env and no endpoint; its efforts are GOOSE_THINKING_EFFORT values and Pricing stays', () => {
  const el = renderModelEditor(null, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, cursorEfforts: [], gooseEfforts: ['low', 'medium', 'high', 'max'] });
  setModelEngine(el, 'goose');
  assert.deepEqual([...el.querySelectorAll('.mv-effort-cb')].map((c) => c.value), ['low', 'medium', 'high', 'max']);
  assert.equal(el.querySelector('.mv-env').closest('.mv-field').hidden, true);
  assert.equal(el.querySelector('.mv-cost-edit').closest('.mv-field').hidden, false, 'Goose prices its own runs; an override still applies');
  const conn = el.querySelector('.mv-conn');
  assert.match(conn.querySelector('.mv-conn-runs').textContent, /^Runs on Goose only/);
  assert.equal(conn.querySelector('.mv-conn-body').hidden, true);
  el.querySelector('.mv-id').value = 'google/gemini-2.5-flash';
  const { body } = collectModelEditor(el);
  assert.equal(body.engine, 'goose');
  assert.deepEqual(body.env, {});
  assert.equal('upstream' in body, false);
});

test('editor: OpenCode takes no env and no endpoint; its efforts are the variants and Pricing stays', () => {
  const el = renderModelEditor(null, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, cursorEfforts: [], opencodeEfforts: ['minimal', 'low', 'medium', 'high', 'max'] });
  setModelEngine(el, 'opencode');
  assert.deepEqual([...el.querySelectorAll('.mv-effort-cb')].map((c) => c.value), ['minimal', 'low', 'medium', 'high', 'max']);
  assert.equal(el.querySelector('.mv-env').closest('.mv-field').hidden, true);
  assert.equal(el.querySelector('.mv-cost-edit').closest('.mv-field').hidden, false, 'OpenCode prices its own runs; an override still applies');
  const conn = el.querySelector('.mv-conn');
  const shown = [...conn.querySelectorAll('.mv-conn-mode')].filter((l) => !l.hidden);
  // A new entry still offers every connection; on OpenCode's providers it runs on OpenCode alone.
  assert.equal(shown.length, 3);
  assert.equal(conn.querySelector('.mv-conn-mode-rb:checked').value, 'direct');
  assert.match(conn.querySelector('.mv-conn-runs').textContent, /^Runs on OpenCode only/);
  assert.equal(conn.querySelector('.mv-conn-body').hidden, true);
  el.querySelector('.mv-id').value = 'anthropic/claude-sonnet-4-5';
  const { body } = collectModelEditor(el);
  assert.equal(body.engine, 'opencode');
  assert.deepEqual(body.env, {});
  assert.equal('upstream' in body, false);
});

test('editor: editing a Goose model offers only its own providers', () => {
  const el = renderModelEditor({ id: 'google/gemini-2.5-flash', label: 'Flash', engine: 'goose', efforts: ['high'] }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, gooseEfforts: ['low', 'medium', 'high', 'max'] });
  const shown = [...el.querySelectorAll('.mv-conn .mv-conn-mode')].filter((l) => !l.hidden);
  assert.deepEqual(shown.map((l) => l.querySelector('.mv-conn-mode-title').textContent), ['Goose providers']);
  assert.equal(el.querySelector('.mv-conn-body').hidden, true);
});

test('editor: editing an OpenCode model offers only its own providers', () => {
  const el = renderModelEditor({ id: 'anthropic/claude-sonnet-4-5', label: 'Sonnet', engine: 'opencode', efforts: ['high'] }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, opencodeEfforts: ['minimal', 'low', 'medium', 'high', 'max'] });
  const shown = [...el.querySelectorAll('.mv-conn .mv-conn-mode')].filter((l) => !l.hidden);
  assert.deepEqual(shown.map((l) => l.querySelector('.mv-conn-mode-title').textContent), ['OpenCode providers']);
  assert.equal(el.querySelector('.mv-conn-body').hidden, true);
});

for (const [engine, label, efforts] of [['gemini', 'Gemini CLI', ['low', 'medium', 'high']], ['qwen', 'Qwen Code', ['low', 'medium', 'high', 'xhigh', 'max']]]) {
  test(`editor: ${label} — its own sign-in only, no env, its own efforts, a price for its chats`, () => {
    const el = renderModelEditor(null, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
    setModelEngine(el, engine);
    assert.deepEqual([...el.querySelectorAll('.mv-effort-cb')].map((c) => c.value), efforts, "the engine's own efforts");
    assert.equal(el.querySelector('.mv-env').closest('.mv-field').hidden, true);
    assert.equal(el.querySelector('.mv-cost-edit').closest('.mv-field').hidden, false, "a chat's cost cap and spend use the price");
    const conn = el.querySelector('.mv-conn');
    // A new entry still offers every connection; on its CLI's sign-in it runs on that CLI alone.
    assert.equal(conn.querySelector('.mv-conn-mode-rb:checked').value, 'direct');
    assert.match(conn.querySelector('.mv-conn-runs').textContent, new RegExp(`^Runs on ${label} only`));
    assert.equal(conn.querySelector('.mv-conn-body').hidden, true);
    el.querySelector('.mv-id').value = 'm-1';
    const { body } = collectModelEditor(el);
    assert.equal(body.engine, engine);
  });

  test(`editor: editing a ${label} model shows its efforts and only its own sign-in`, () => {
    const el = renderModelEditor({ id: 'm-1', label: 'm-1', engine, efforts }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
    assert.equal(el.querySelectorAll('.mv-effort-cb').length, efforts.length);
    assert.equal(el.querySelector('.mv-efforts').closest('.mv-field').hidden, false);
    const shown = [...el.querySelectorAll('.mv-conn .mv-conn-mode')].filter((l) => !l.hidden);
    assert.deepEqual(shown.map((l) => l.querySelector('.mv-conn-mode-title').textContent), [`${label} default`]);
  });

}

test('phones: the Models header and the model cards wrap at 760px instead of running off a 375px screen', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readIndexHtml();
  assert.match(html, /<div class="mv-head-actions"(?: data-tab-only="catalogue")?>\s*<button type="button" id="model-share-btn"/, 'the header buttons sit in a styled group, not an inline-styled div');
  const css = readStyleCss();
  assert.match(css, /\n\.mv-head-actions\{display:flex;gap:8px;flex:0 0 auto;\}/);
  // The page head (the tab strip and these actions) wraps in models-page.css; the cards' block stays here.
  assert.match(readFileSync(new URL('../ui/public/models/models-page.css', import.meta.url), 'utf8'), /@media \(max-width:760px\)\{\.mdl-head\{flex-wrap:wrap\}\}/);
  const phone = css.match(/@media \(max-width:760px\)\{\s*\.mv-head-actions\{[^}]*\}[^@]*/);
  assert.ok(phone, 'a phone block for the Models page');
  assert.match(phone[0], /\.mv-head-actions\{flex:1 1 100%;flex-wrap:wrap;\}/);
  assert.match(phone[0], /\.mv-card\{flex-wrap:wrap;\}/);
  assert.match(phone[0], /\.mv-body\{flex-basis:100%;\}/);
});
