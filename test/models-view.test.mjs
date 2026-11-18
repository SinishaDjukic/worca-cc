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
  renderExportWizard, collectExportWizard, applyConnectionModeIn, envRowsProblem, setFormWhere,
} from '../ui/public/models-view.mjs';
import { bridgedBadge, degradationLine, connectionWhere, setConnectionWhere, wheresFor } from '../ui/public/bridge-view.mjs';
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

const SHARE_GLOBALS = () => [
  { id: 'ds-stable', label: 'DS Stable', efforts: EFFORTS, env: { ANTHROPIC_BASE_URL: '••••••mple', ANTHROPIC_AUTH_TOKEN: '••••••1234' } },
  { id: 'other', label: 'Other', efforts: EFFORTS },
];
const fire = (node, type) => { node.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true })); };

test('share as plugin (SHR-1, SHR-2): three numbered parts, and Export scaffold stays disabled until it can work', () => {
  const w = renderExportWizard(SHARE_GLOBALS(), { doc });
  assert.equal(w.querySelector(':scope > .mvx-head > .mv-editor-title').textContent, 'Share as plugin');
  assert.ok(w.querySelector(':scope > .mvx-head > button.btn.mdl-close[aria-label="Close"]'), 'the head closes the dialog');
  assert.deepEqual([...w.querySelectorAll(':scope > .mvx-step > h4.mvx-step-title')].map((t) => t.textContent), ['1 Models', '2 Env vars', '3 Plugin']);
  assert.deepEqual([...w.querySelectorAll('.mvx-model .opt-name')].map((n) => n.textContent), ['DS Stable', 'Other']);
  assert.equal(w.querySelectorAll('.mvx-model .mdl-mark').length, 2, 'each model wears its mark');
  assert.deepEqual([...w.querySelectorAll('.mvx-step .mvx-fields .mv-field-label')].map((l) => l.textContent),
    ['Plugin name', 'Version', 'Description', 'Destination folder']);
  assert.equal(w.querySelector('.mvx-desc').placeholder, 'What these models are for');
  assert.ok([...w.querySelectorAll('small.hint')].every((s) => s.textContent.length <= 80), 'no hint paragraphs (L18)');
  assert.deepEqual([...w.querySelectorAll('.mv-editor-btns > .btn')].map((b) => b.textContent), ['Cancel', 'Export scaffold'], 'Export comes last');

  const go = w.querySelector('.mvx-export');
  assert.equal(go.disabled, true, 'nothing ticked, nothing named');
  const cb = w.querySelector('.mvx-model-cb');
  cb.checked = true; fire(cb, 'change');
  assert.equal(go.disabled, true, 'a model alone is not enough');
  w.querySelector('.mvx-name').value = 'team-models'; fire(w.querySelector('.mvx-name'), 'input');
  assert.equal(go.disabled, true, 'still no folder');
  w.querySelector('.mvx-dest').value = '~/dev/team-models'; fire(w.querySelector('.mvx-dest'), 'input');
  assert.equal(go.disabled, false, 'a model, a name and a folder');
  w.querySelector('.mvx-name').value = ''; fire(w.querySelector('.mvx-name'), 'input');
  assert.equal(go.disabled, true, 'clearing the name disables it again');
  w.querySelector('.mvx-name').value = 'team-models'; fire(w.querySelector('.mvx-name'), 'input');
  w.querySelector('.mvx-dest').value = '  '; fire(w.querySelector('.mvx-dest'), 'input');
  assert.equal(go.disabled, true, 'clearing the folder disables it again');
  w.querySelector('.mvx-dest').value = '~/dev/team-models'; fire(w.querySelector('.mvx-dest'), 'input');
  cb.checked = false; fire(cb, 'change');
  assert.equal(go.disabled, true, 'unticking the last model disables it again');
});

test('share as plugin: a credential is flagged and defaults to "Require at install"; the segment drives the body', () => {
  const w = renderExportWizard(SHARE_GLOBALS(), { doc });
  const row = (k) => [...w.querySelectorAll('.mvx-env-row')].find((r) => r.dataset.key === k);
  const pressed = (r) => [...r.querySelectorAll('.seg.mvx-seg[role="group"] > button[aria-pressed="true"]')].map((b) => b.textContent);
  const token = row('ANTHROPIC_AUTH_TOKEN');
  assert.equal(token.querySelector('span.badge.mvx-warn').textContent, 'Looks like a credential');
  assert.deepEqual([...token.querySelectorAll('.mvx-seg > button')].map((b) => b.textContent), ['Include value', 'Require at install', 'Omit']);
  assert.deepEqual(pressed(token), ['Require at install']);
  assert.equal(row('ANTHROPIC_BASE_URL').querySelector('.mvx-warn'), null, 'a base URL is no credential');
  assert.deepEqual(pressed(row('ANTHROPIC_BASE_URL')), ['Include value']);
  assert.equal(token.querySelector('select.mvx-mode').hidden, true, 'the segment is the face of the hidden select');

  const changes = [];
  w.addEventListener('change', (e) => changes.push(e.target.className));
  [...token.querySelectorAll('.mvx-seg > button')].find((b) => b.textContent === 'Omit').click();
  assert.deepEqual(pressed(token), ['Omit']);
  assert.equal(token.querySelector('.mvx-mode').value, 'omit');
  assert.deepEqual(changes, ['select mvx-mode'], 'a pick is a change the dialog sees');
  w.querySelector('.mvx-model-cb[value="ds-stable"]').checked = true;
  assert.equal(collectExportWizard(w).models[0].env.ANTHROPIC_AUTH_TOKEN, 'omit');
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
  assert.deepEqual(wheresFor(el.dataset.engine), ['signin', 'provider'], 'a Codex model keeps a (narrowed) Connection');
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

test('editor: a new model picks where it runs first; a harness that cannot reach a provider leaves for Claude Code, and the id follows the provider', () => {
  const providers = { openai: { configured: false, keySet: false, keyOptional: false } };
  const el = renderModelEditor(null, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, providers });
  const conn = el.querySelector('.mv-conn');
  const harness = el.querySelector('.mv-engine').closest('.mv-field');
  // A new entry starts on a sign-in, and the harness field asks which one.
  setModelEngine(el, 'copilot');
  assert.equal(connectionWhere(el), 'signin');
  assert.equal(harness.hidden, false, 'the sign-in asks which harness');
  assert.equal(conn.querySelector('.mv-conn-body').hidden, true);
  // Through a provider a Copilot-harness entry is Claude Code's: the harness leaves, the efforts are Claude Code's list.
  setConnectionWhere(el, 'provider');
  assert.equal(harness.hidden, true);
  assert.equal(el.dataset.engine, 'claude');
  assert.deepEqual([...el.querySelectorAll('.mv-effort-cb')].map((c) => c.value), EFFORTS);
  const prov = conn.querySelector('.mv-conn-provider');
  assert.equal(prov.disabled, false);
  prov.value = 'openai';
  el.querySelector('.mv-conn-api').value = 'openai-responses';
  conn.querySelector('.mv-conn-model').value = 'gpt-5.5';
  applyConnectionModeIn(el);
  assert.equal(el.querySelector('.mv-conn-api').value, 'openai-responses');
  // The id follows the provider and the upstream model until typed: gpt-5.5 itself is Codex's own sign-in.
  assert.equal(el.querySelector('.mv-id').value, 'openai-gpt-5.5');
  const { body } = collectModelEditor(el);
  assert.equal('engine' in body, false, 'stored as Claude Code\'s; its harnesses follow from the connection');
  assert.equal(body.id, 'openai-gpt-5.5');
  assert.equal(body.upstream.model, 'gpt-5.5');
  // OpenRouter is an OpenAI-compatible endpoint: the suggested id names openai, not openrouter.
  prov.value = 'openrouter';
  applyConnectionModeIn(el);
  assert.equal(el.querySelector('.mv-id').value, 'openai-gpt-5.5');
  // A typed id is kept.
  el.querySelector('.mv-id').value = 'my-gpt'; el.querySelector('.mv-id').dataset.auto = 'off';
  applyConnectionModeIn(el);
  assert.equal(el.querySelector('.mv-id').value, 'my-gpt');
});

test('editor (edit): a stored Codex endpoint model keeps codex\'s rules — its own sign-in or an OpenAI-compatible Responses endpoint', () => {
  const upstream = { provider: 'openai', api: 'openai-responses', model: 'qwen3-coder', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '${CX_KEY}', headers: { 'X-Team': 'blue' } };
  const edit = renderModelEditor({ id: 'cx-local', engine: 'codex', efforts: CODEX_EFFORTS, upstream }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
  const conn = edit.querySelector('.mv-conn');
  assert.deepEqual(wheresFor('codex'), ['signin', 'provider'], 'no env on Codex');
  assert.equal(connectionWhere(edit), 'provider');
  const prov = conn.querySelector('.mv-conn-provider');
  assert.equal(prov.value, 'openai');
  assert.equal(prov.disabled, true);
  assert.deepEqual([...edit.querySelectorAll('.mv-conn-api option')].map((o) => o.value), ['openai-responses'], 'codex no longer speaks chat completions');
  assert.equal(edit.querySelector('.mv-conn-caps').hidden, true, 'the bridge\'s capability pins do not apply');
  const { body } = collectModelEditor(edit);
  assert.deepEqual(body.env, {});
  assert.deepEqual(body.upstream, upstream);
  // Its efforts are Codex's, drawn after its harness: never the bridge's medium-only rule for a translated Claude model.
  assert.deepEqual(body.efforts, [], 'every Codex effort stored: the default, sent as []');
  const two = renderModelEditor({ id: 'cx-local', engine: 'codex', efforts: ['low', 'medium'], upstream }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
  assert.deepEqual(collectModelEditor(two).body.efforts, ['low', 'medium'], 'a stored subset is kept');
  setConnectionWhere(edit, 'signin');
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
  // On Cursor's sign-in it runs on Cursor alone (a new entry may still pick a provider, which makes it Claude Code's).
  assert.deepEqual(wheresFor('cursor'), ['signin']);
  assert.equal(connectionWhere(el), 'signin');
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
  assert.equal(connectionWhere(el), 'signin');
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
  // On OpenCode's providers it runs on OpenCode alone (a new entry may still pick a provider, which makes it Claude Code's).
  assert.deepEqual(wheresFor('opencode'), ['signin']);
  assert.equal(connectionWhere(el), 'signin');
  assert.equal(conn.querySelector('.mv-conn-body').hidden, true);
  el.querySelector('.mv-id').value = 'anthropic/claude-sonnet-4-5';
  const { body } = collectModelEditor(el);
  assert.equal(body.engine, 'opencode');
  assert.deepEqual(body.env, {});
  assert.equal('upstream' in body, false);
});

test('editor: editing a Goose model offers only its own providers', () => {
  const el = renderModelEditor({ id: 'google/gemini-2.5-flash', label: 'Flash', engine: 'goose', efforts: ['high'] }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, gooseEfforts: ['low', 'medium', 'high', 'max'] });
  assert.deepEqual(wheresFor(el.dataset.engine), ['signin']);
  // An edit keeps its harness: a where the harness cannot reach falls back to its sign-in.
  setConnectionWhere(el, 'provider');
  assert.equal(connectionWhere(el), 'signin');
  assert.equal(el.dataset.engine, 'goose');
  assert.equal(el.querySelector('.mv-conn-body').hidden, true);
});

test('editor: editing an OpenCode model offers only its own providers', () => {
  const el = renderModelEditor({ id: 'anthropic/claude-sonnet-4-5', label: 'Sonnet', engine: 'opencode', efforts: ['high'] }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS, opencodeEfforts: ['minimal', 'low', 'medium', 'high', 'max'] });
  assert.deepEqual(wheresFor(el.dataset.engine), ['signin']);
  setConnectionWhere(el, 'env');
  assert.equal(connectionWhere(el), 'signin');
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
    // On its CLI's sign-in it runs on that CLI alone.
    assert.deepEqual(wheresFor(engine), ['signin']);
    assert.equal(connectionWhere(el), 'signin');
    assert.equal(conn.querySelector('.mv-conn-body').hidden, true);
    el.querySelector('.mv-id').value = 'm-1';
    const { body } = collectModelEditor(el);
    assert.equal(body.engine, engine);
  });

  test(`editor: editing a ${label} model shows its efforts and only its own sign-in`, () => {
    const el = renderModelEditor({ id: 'm-1', label: 'm-1', engine, efforts }, EFFORTS, { doc, codexEfforts: CODEX_EFFORTS });
    assert.equal(el.querySelectorAll('.mv-effort-cb').length, efforts.length);
    assert.equal(el.querySelector('.mv-efforts').closest('.mv-field').hidden, false);
    assert.deepEqual(wheresFor(el.dataset.engine), ['signin']);
    assert.equal(connectionWhere(el), 'signin');
  });

}

// ── The model form (DESIGN FRM-1…FRM-7): where it runs picks the fields; the request bodies stay today's ────────────

/** GET /api/providers: Copilot signed in, OpenRouter's key set, the OpenAI-compatible row keyed with no address. */
const P = Object.freeze({
  copilot: { connected: true }, openrouter: { keySet: true }, openai: { configured: true, keySet: true, baseUrl: '' },
  anthropic: {}, broker: { enabled: false },
});
/** A Copilot model as GET /api/models lists it (its efforts the full effective list). */
const BRIDGED = Object.freeze({
  id: 'copilot-gpt-x', label: 'GPT X', efforts: [...EFFORTS],
  upstream: { provider: 'copilot', api: 'openai-responses', model: 'gpt-x', capabilities: { toolCalls: true, vision: true, maxPromptTokens: 272000 } },
});
const win = doc.defaultView;
/** No ancestor of `el` is hidden. */
const shows = (el) => { for (let n = el; n; n = n.parentElement) if (n.hidden) return false; return true; };
const fieldNames = (ed) => [...ed.querySelectorAll('.mv-field')].filter(shows).map((f) => f.querySelector('.mv-field-label').textContent);
const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new win.Event('input', { bubbles: true })); };
const folds = (ed) => [...ed.querySelectorAll('.mdl-disc')].map((b) => [b.querySelector('.mdl-disc-name').textContent, b.querySelector('.mdl-disc-sum').textContent, b.getAttribute('aria-expanded')]);

test('envRowsProblem: reserved names, the provider\'s own four, a shared name, a value with no name — the first one', () => {
  assert.equal(envRowsProblem([{ key: 'A', value: '1' }]), '');
  assert.equal(envRowsProblem([{ key: 'WORCA_X', value: '1' }]), 'WORCA_ names are reserved');
  assert.equal(envRowsProblem([{ key: 'ANTHROPIC_MODEL', value: 'm' }], { provider: true }), 'ANTHROPIC_MODEL is set by the provider');
  assert.equal(envRowsProblem([{ key: 'ANTHROPIC_MODEL', value: 'm' }]), '');
  assert.equal(envRowsProblem([{ key: 'A', value: '1' }, { key: 'A', value: '2' }]), 'Two variables share a name');
  assert.equal(envRowsProblem([{ key: '', value: 'v' }]), 'Name the variable');
});

test('form (FRM-1, FRM-2): the fields follow where the model runs', () => {
  assert.deepEqual(fieldNames(renderModelEditor(null, EFFORTS, { doc, where: 'signin' })), ['Name', 'ID', 'Harness', 'Env vars', 'Efforts', 'Pricing']);
  assert.deepEqual(fieldNames(renderModelEditor(null, EFFORTS, { doc, providers: P, where: 'provider' })).slice(0, 4), ['Name', 'ID', 'Provider', 'Upstream model id']);
  const env = renderModelEditor(null, EFFORTS, { doc, where: 'env' });
  assert.deepEqual([...env.querySelectorAll('.mv-env-key')].map((k) => k.value), ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'], 'a new custom endpoint starts with the two it needs');
  assert.deepEqual([...env.querySelectorAll('.mv-env-row')].map((r) => r.dataset.key), [undefined, undefined], 'new rows, not stored ones');
  assert.deepEqual([...env.querySelectorAll('.mv-engine option')].filter((o) => !o.hidden).map((o) => o.value), ['claude'], 'a custom endpoint offers Claude Code only');
});

test('form (FRM-1, FRM-5): titles, steps and the foot; Save waits for a free id and clean env vars', () => {
  const add = renderModelEditor(null, EFFORTS, { doc, steps: true, takenIds: ['my-gpt'] });
  assert.deepEqual([...add.children].map((c) => c.className).filter((c, i, all) => i === 0 || i >= all.length - 2), ['mv-editor-head', 'form-msg mv-editor-msg', 'mv-editor-btns']);
  assert.equal(add.querySelector(':scope > .mv-editor-head > .mv-editor-title').textContent, 'Add model');
  assert.ok(add.querySelector(':scope > .mv-editor-head .mdl-steps'));
  assert.ok(add.querySelector(':scope > .mv-editor-head > .mdl-close.btn[aria-label="Close"]'));
  assert.equal(add.querySelector('.mv-rewhere'), null);
  assert.deepEqual([...add.querySelectorAll('.mv-editor-btns > button')].map((b) => b.textContent), ['Back', 'Cancel', 'Add model'], 'Save last');
  const save = add.querySelector('.mv-save');
  assert.equal(save.disabled, true, 'no id yet');
  typeInto(add.querySelector('.mv-id'), 'gpt-local');
  assert.equal(save.disabled, false);
  typeInto(add.querySelector('.mv-id'), 'My-GPT');
  assert.equal(save.disabled, true, 'the id is taken, whatever its case');
  typeInto(add.querySelector('.mv-id'), 'gpt-local');
  assert.equal(save.disabled, false);
  const row = makeEnvRow({ doc });
  add.querySelector('.mv-env').appendChild(row);
  typeInto(row.querySelector('.mv-env-key'), 'WORCA_X');
  assert.equal(save.disabled, true);
  const problem = add.querySelector('.mv-env-problem');
  assert.deepEqual([problem.hidden, problem.textContent], [false, 'WORCA_ names are reserved']);
  assert.equal(add.querySelector('.mv-env-note').hidden, true);
  setModelEngine(add, 'codex');
  assert.equal(save.disabled, false, 'env vars are Claude Code\'s: a Codex model sends none, so none is refused');

  const model = { id: 'my-gpt', label: 'My GPT', efforts: ['high'] };
  const edit = renderModelEditor(model, EFFORTS, { doc });
  assert.equal(edit.querySelector('.mv-editor-title').textContent, 'Edit My GPT');
  assert.ok(edit.querySelector('.mv-rewhere'));
  assert.equal(edit.querySelector('.mdl-steps'), null);
  assert.equal(edit.querySelector('.mv-back'), null);
  assert.equal(edit.querySelector('.mv-id').disabled, true);
  assert.deepEqual([edit.querySelector('.mv-save').textContent, edit.querySelector('.mv-save').disabled], ['Save', false]);

  const copy = renderModelEditor(model, EFFORTS, { doc, copyFrom: 'my-gpt', id: 'my-gpt-copy' });
  assert.equal(copy.querySelector('.mv-editor-title').textContent, 'Add a copy');
  assert.deepEqual([copy.querySelector('.mv-id').disabled, copy.querySelector('.mv-id').value], [false, 'my-gpt-copy']);
  assert.equal(copy.querySelector('.mv-save').disabled, false, 'enabled with no event');
  assert.equal(copy.querySelector('.mv-rewhere'), null);
  assert.deepEqual([copy.dataset.mode, copy.dataset.copyFrom], ['create', 'my-gpt']);
});

test('form (FRM-4): a provider model folds Connection and Capabilities and limits after Pricing, each with its summary', () => {
  const ed = renderModelEditor(BRIDGED, EFFORTS, { doc, providers: P });
  assert.deepEqual(folds(ed), [['Connection', 'OpenAI Responses', 'false'], ['Capabilities and limits', 'Tools, vision · 272k prompt', 'false']]);
  assert.ok(ed.querySelector('.mv-cost-edit').compareDocumentPosition(ed.querySelector('.mv-conn-more')) & win.Node.DOCUMENT_POSITION_FOLLOWING, 'the folds come after Pricing');
  assert.equal(ed.querySelector('.mv-conn .mv-conn-more'), null, 'moved out of the connection field');
  const disc = ed.querySelector('.mdl-disc');
  assert.ok(disc.classList.contains('btn') && disc.classList.contains('btn-quiet'));
  const body = ed.querySelector(`#${disc.getAttribute('aria-controls')}`);
  assert.equal(body.hidden, true);
  disc.click();
  assert.deepEqual([disc.getAttribute('aria-expanded'), body.hidden], ['true', false]);
  disc.click();
  assert.deepEqual([disc.getAttribute('aria-expanded'), body.hidden], ['false', true]);
  // The summaries follow the fields.
  ed.querySelector('.mv-conn-cap-cb[data-cap="reasoning"]').checked = true;
  applyConnectionModeIn(ed);
  assert.equal(folds(ed)[1][1], 'Tools, vision, reasoning · 272k prompt');
  for (const cb of ed.querySelectorAll('.mv-conn-cap-cb')) cb.checked = false;
  ed.querySelector('.mv-conn-limit-in[data-limit="maxPromptTokens"]').value = '';
  applyConnectionModeIn(ed);
  assert.equal(folds(ed)[1][1], 'No capabilities');
  const own = renderModelEditor({ ...BRIDGED, upstream: { ...BRIDGED.upstream, provider: 'openai', api: 'openai-chat', baseUrl: 'https://gw.example/v1' } }, EFFORTS, { doc, providers: P });
  assert.equal(folds(own)[0][1], 'OpenAI chat completions · own address');
});

test('form: the API segment drives the hidden select the collector reads; Pricing is a segment over the kept radios', () => {
  const ed = renderModelEditor(BRIDGED, EFFORTS, { doc, providers: P });
  const sel = ed.querySelector('select.mv-conn-api');
  assert.equal(sel.hidden, true);
  const segs = () => [...ed.querySelectorAll('.mv-conn-api-seg button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
  assert.deepEqual(segs(), [['Anthropic Messages', 'false'], ['OpenAI chat completions', 'false'], ['OpenAI Responses', 'true']]);
  let changes = 0;
  ed.addEventListener('change', (e) => { if (e.target === sel) changes += 1; });
  [...ed.querySelectorAll('.mv-conn-api-seg button')].find((b) => b.textContent === 'OpenAI chat completions').click();
  assert.equal(collectModelEditor(ed).body.upstream.api, 'openai-chat');
  assert.equal(changes, 1, 'a bubbling change: app.js and the modal guard see it');
  assert.deepEqual(segs(), [['Anthropic Messages', 'false'], ['OpenAI chat completions', 'true'], ['OpenAI Responses', 'false']]);
  assert.equal(folds(ed)[0][1], 'OpenAI chat completions');
  const pressed = () => ed.querySelector('.mv-cost-seg [aria-pressed="true"]').textContent;
  assert.equal(pressed(), 'Trust the CLI');
  setModelCost(ed, { free: true });
  assert.equal(pressed(), 'Free ($0)');
  [...ed.querySelectorAll('.mv-cost-seg button')].find((b) => b.textContent === 'Per million tokens').click();
  assert.equal(ed.querySelector('.mv-cost-mode-rb:checked').value, 'perMtok');
  assert.equal(ed.querySelector('.mv-cost-rates').hidden, false);
  assert.equal(pressed(), 'Per million tokens');
});

test('form: the Provider select offers OpenRouter, an OpenAI-compatible endpoint at openrouter.ai; an untouched model collects today\'s body', () => {
  const add = renderModelEditor(null, EFFORTS, { doc, providers: P, where: 'provider' });
  const sel = add.querySelector('select.mv-conn-provider');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent]), [['copilot', 'GitHub Copilot'], ['openrouter', 'OpenRouter'], ['openai', 'OpenAI-compatible'], ['anthropic', 'Anthropic-compatible']]);
  const bu = add.querySelector('.mv-conn-baseurl');
  sel.value = 'openrouter';
  applyConnectionModeIn(add);
  assert.equal(bu.value, 'https://openrouter.ai/api/v1');
  const up = collectModelEditor(add).body.upstream;
  assert.deepEqual([up.provider, up.baseUrl], ['openai', 'https://openrouter.ai/api/v1']);
  sel.value = 'openai';
  applyConnectionModeIn(add);
  assert.equal(bu.value, '', 'leaving OpenRouter clears its address');
  bu.value = 'https://openrouter.ai/api/v1';
  applyConnectionModeIn(add);
  assert.equal(sel.value, 'openai', 'typing a URL never moves the select');
  // A preset OpenRouter form fills the address at render; its state word is OpenRouter's own row's.
  const preset = renderModelEditor(null, EFFORTS, { doc, providers: { ...P, openrouter: { keySet: false } }, where: 'provider', provider: 'openrouter' });
  assert.equal(preset.querySelector('.mv-conn-baseurl').value, 'https://openrouter.ai/api/v1');
  const word = preset.querySelector('.mv-conn-provider-hint');
  assert.deepEqual([word.className, word.textContent], ['mdl-st mv-conn-provider-hint need', 'Needs key'], 'not the OpenAI-compatible row\'s "Key set"');

  const PO = { ...P, openai: { ...P.openai, baseUrl: 'https://openrouter.ai/api/v1' } };
  const OR = { id: 'or-gpt', label: 'OR GPT', efforts: [...EFFORTS], upstream: { provider: 'openai', api: 'openai-chat', model: 'openai/gpt-x', capabilities: { toolCalls: true, vision: false, reasoning: false } } };
  const ed = renderModelEditor(OR, EFFORTS, { doc, providers: PO });
  assert.equal(ed.querySelector('.mv-conn-provider').value, 'openrouter');
  assert.equal(ed.querySelector('.mv-conn-baseurl').value, '', 'rendering changes no field');
  assert.deepEqual(collectModelEditor(ed), { id: 'or-gpt', body: {
    label: 'OR GPT', efforts: ['medium'], env: {}, cost: null,
    upstream: { provider: 'openai', api: 'openai-chat', model: 'openai/gpt-x', capabilities: { toolCalls: true, vision: false, reasoning: false } },
  } });
  const E5 = ['low', 'medium', 'high', 'xhigh', 'max'];
  const OR2 = { ...OR, efforts: ['low', 'high'], upstream: { ...OR.upstream, capabilities: { toolCalls: true, vision: false, reasoning: true, reasoningEfforts: ['low', 'high'] } } };
  assert.deepEqual(collectModelEditor(renderModelEditor(OR2, E5, { doc, providers: PO })), { id: 'or-gpt', body: {
    label: 'OR GPT', efforts: ['low', 'high'], env: {}, cost: null,
    upstream: { provider: 'openai', api: 'openai-chat', model: 'openai/gpt-x', capabilities: { toolCalls: true, vision: false, reasoning: true, reasoningEfforts: ['low', 'high'] } },
  } });
});

test('form (Review Focus 2): a rename keeps what the form does not draw — headers, reasoning efforts, efforts', () => {
  const stored = { ...BRIDGED, upstream: { ...BRIDGED.upstream, headers: { 'X-Team': 'a' }, capabilities: { ...BRIDGED.upstream.capabilities, reasoning: true, reasoningEfforts: ['low', 'high'] } } };
  const plain = collectModelEditor(renderModelEditor(stored, EFFORTS, { doc, providers: P })).body;
  const ed = renderModelEditor(stored, EFFORTS, { doc, providers: P });
  ed.querySelector('.mv-label').value = 'Renamed';
  const { body } = collectModelEditor(ed);
  assert.equal(body.label, 'Renamed');
  assert.deepEqual(body.upstream.headers, { 'X-Team': 'a' });
  assert.deepEqual(body.upstream.capabilities.reasoningEfforts, ['low', 'high']);
  assert.deepEqual(body.efforts, plain.efforts);
  // Another upstream model is another model: what was stored for gpt-x does not follow it.
  ed.querySelector('.mv-conn-model').value = 'gpt-y';
  assert.equal('headers' in collectModelEditor(ed).body.upstream, false);
  // Off Copilot the form draws the headers, so it decides: cleared headers stay cleared.
  const gw = renderModelEditor({ ...stored, upstream: { ...stored.upstream, provider: 'openai', api: 'openai-chat' } }, EFFORTS, { doc, providers: P });
  gw.querySelector('.mv-conn-headers').value = '';
  assert.equal('headers' in collectModelEditor(gw).body.upstream, false);
});

test('form (Review Focus 1): a copy echoes the masks and names its source; a removed row is simply not sent', () => {
  const gw = { id: 'gw', label: 'Gateway', efforts: [...EFFORTS], env: { X: '••••••abcd' }, upstream: { provider: 'openai', api: 'openai-chat', model: 'm', apiKey: '••••••1234', capabilities: { toolCalls: true, vision: false, reasoning: true } } };
  const ed = renderModelEditor(gw, EFFORTS, { doc, providers: P, copyFrom: 'gw', id: 'gw-copy', label: 'Gateway copy' });
  assert.ok(ed.querySelector('.mv-env-row[data-key="X"] .mv-env-copy'), 'a stored row keeps its copy button');
  const { id, body } = collectModelEditor(ed);
  assert.equal(id, null);
  assert.deepEqual([body.id, body.label, body.copyFrom], ['gw-copy', 'Gateway copy', 'gw']);
  assert.equal(body.upstream.apiKey, '••••••1234');
  assert.deepEqual(body.env, { X: '••••••abcd' });
  ed.querySelector('.mv-env-row').remove();
  assert.deepEqual(collectModelEditor(ed).body.env, {}, 'no null: a copy deletes nothing');
});

test('form: "Change where it runs" goes through setConnectionWhere; a Codex form stays Codex through a provider', () => {
  assert.deepEqual([wheresFor('claude'), wheresFor('codex'), wheresFor('cursor')], [['signin', 'env', 'provider'], ['signin', 'provider'], ['signin']]);
  const ed = renderModelEditor(BRIDGED, EFFORTS, { doc, providers: P });
  assert.equal(connectionWhere(ed), 'provider');
  setConnectionWhere(ed, 'signin');
  assert.deepEqual([ed.dataset.where, ed.querySelector('.mv-conn').dataset.where], ['signin', 'signin']);
  assert.equal(collectModelEditor(ed).body.upstream, null);
  assert.equal(ed.querySelector('.mv-conn-mode-rb'), null);
  assert.equal(ed.querySelector('.mv-engine').closest('.mv-field').hidden, false, 'the harness field comes back');

  const add = renderModelEditor(null, EFFORTS, { doc, providers: P, codexEfforts: CODEX_EFFORTS });
  setModelEngine(add, 'codex');
  setConnectionWhere(add, 'provider');
  assert.equal(add.dataset.engine, 'codex');
  const caps = [...add.querySelectorAll('.mdl-disc')].find((b) => b.querySelector('.mdl-disc-name').textContent === 'Capabilities and limits');
  assert.equal(caps.hidden, true);
  add.querySelector('.mv-id').value = 'gpt-x-local';
  const { body } = collectModelEditor(add);
  assert.deepEqual([body.engine, body.upstream.provider, body.upstream.api], ['codex', 'openai', 'openai-responses']);
});

test('form: the edit title names the model as the Catalogue does (displayName)', () => {
  const title = (m) => renderModelEditor(m, EFFORTS, { doc, providers: P }).querySelector('.mv-editor-title').textContent;
  assert.equal(title({ id: 'copilot-gpt-5', label: 'GPT-5 (Copilot)', efforts: [...EFFORTS], upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5' } }), 'Edit GPT-5', 'no import suffix');
  assert.equal(title({ id: 'or-x', label: 'OpenAI: GPT-X', efforts: [...EFFORTS], upstream: { provider: 'openai', api: 'openai-chat', model: 'openai/gpt-x' } }), 'Edit GPT-X', 'no OpenRouter vendor prefix');
  assert.equal(title({ id: 'bare', efforts: [] }), 'Edit bare', 'no label: the id');
});

test('form: the id suggested through a provider is written with no input event, and Save follows it', () => {
  const ed = renderModelEditor(null, EFFORTS, { doc, providers: P, where: 'provider', steps: true });
  const save = ed.querySelector('.mv-save');
  assert.equal(save.disabled, true, 'no id yet');
  ed.querySelector('.mv-conn-model').value = 'gpt-x';
  applyConnectionModeIn(ed);   // app.js onModelsConnChange, on the field's change
  assert.equal(ed.querySelector('.mv-id').value, 'copilot-gpt-x');
  assert.equal(save.disabled, false);
});

test('form: through a provider the bridge sets the routing names, so an ANTHROPIC_MODEL row blocks Save', () => {
  const ed = renderModelEditor(null, EFFORTS, { doc, providers: P, where: 'provider' });
  typeInto(ed.querySelector('.mv-id'), 'gw-x');
  const save = ed.querySelector('.mv-save');
  assert.equal(save.disabled, false);
  const row = makeEnvRow({ doc });
  ed.querySelector('.mv-env').appendChild(row);
  typeInto(row.querySelector('.mv-env-key'), 'ANTHROPIC_MODEL');
  const problem = ed.querySelector('.mv-env-problem');
  assert.equal(save.disabled, true);
  assert.deepEqual([problem.hidden, problem.textContent], [false, 'ANTHROPIC_MODEL is set by the provider']);
  setConnectionWhere(ed, 'signin');
  assert.equal(save.disabled, false, 'on a sign-in the name is the model\'s to set');
});

/** gw-claude as GET /api/models lists it: a custom endpoint, each value masked. */
const GW = Object.freeze({ id: 'gw-claude', label: 'GW Claude', efforts: [...EFFORTS], env: Object.freeze({ ANTHROPIC_BASE_URL: '••••••mple', ANTHROPIC_AUTH_TOKEN: '••••••9999' }) });
const envOf = (ed) => [...ed.querySelectorAll('.mv-env-row')].map((r) => [r.querySelector('.mv-env-key').value, r.querySelector('.mv-env-val').value, r.dataset.key]);

test('envRowsProblem (endpoint): a custom endpoint needs its ANTHROPIC_BASE_URL, after every other problem', () => {
  assert.equal(envRowsProblem([{ key: 'ANTHROPIC_BASE_URL', value: '' }, { key: 'ANTHROPIC_AUTH_TOKEN', value: 't' }], { endpoint: true }), 'ANTHROPIC_BASE_URL needs a value');
  assert.equal(envRowsProblem([{ key: 'ANTHROPIC_BASE_URL', value: '   ' }], { endpoint: true }), 'ANTHROPIC_BASE_URL needs a value', 'blank is no address');
  assert.equal(envRowsProblem([{ key: 'A', value: '1' }], { endpoint: true }), 'ANTHROPIC_BASE_URL needs a value', 'no row at all');
  assert.equal(envRowsProblem([{ key: ' ANTHROPIC_BASE_URL ', value: 'http://x' }], { endpoint: true }), '');
  assert.equal(envRowsProblem([{ key: 'ANTHROPIC_BASE_URL', value: '' }]), '', 'only on a custom endpoint');
  assert.equal(envRowsProblem([{ key: 'WORCA_X', value: '1' }], { endpoint: true }), 'WORCA_ names are reserved', 'the others first');
});

test('form (M4): a new custom endpoint waits for an id and its address', () => {
  const ed = renderModelEditor(null, EFFORTS, { doc, where: 'env', steps: true });
  const save = ed.querySelector('.mv-save');
  const problem = ed.querySelector('.mv-env-problem');
  assert.equal(save.disabled, true);
  typeInto(ed.querySelector('.mv-id'), 'gw-local');
  assert.equal(save.disabled, true, 'an id alone is not enough');
  assert.deepEqual([problem.hidden, problem.textContent], [false, 'ANTHROPIC_BASE_URL needs a value']);
  const url = ed.querySelector('.mv-env-row .mv-env-val');   // the first row: ANTHROPIC_BASE_URL
  typeInto(url, 'http://127.0.0.1:4000');
  assert.equal(save.disabled, false);
  assert.equal(problem.hidden, true);
  typeInto(ed.querySelector('.mv-id'), '');
  assert.equal(save.disabled, true, 'the id still counts');
});

test('form (M4): setFormWhere out of a custom endpoint removes its two rows, so the PATCH deletes them', () => {
  const ed = renderModelEditor(GW, EFFORTS, { doc, providers: P });
  assert.equal(connectionWhere(ed), 'env');
  setFormWhere(ed, 'signin');
  assert.equal(connectionWhere(ed), 'signin');
  assert.equal(ed.querySelectorAll('.mv-env-row').length, 0);
  assert.equal(ed.querySelector('.mv-save').disabled, false);
  const { body } = collectModelEditor(ed);
  assert.deepEqual(body.env, { ANTHROPIC_BASE_URL: null, ANTHROPIC_AUTH_TOKEN: null });
  assert.equal(body.upstream, null);
  // Only those two: another row stays, sent as it is.
  const more = renderModelEditor({ ...GW, env: { ...GW.env, X_REF: '${MY_VAR}' } }, EFFORTS, { doc, providers: P });
  setFormWhere(more, 'provider');
  assert.deepEqual(collectModelEditor(more).body.env, { X_REF: '${MY_VAR}', ANTHROPIC_BASE_URL: null, ANTHROPIC_AUTH_TOKEN: null });
  assert.deepEqual([more.querySelector('.mv-save').disabled, more.querySelector('.mv-env-problem').hidden], [false, true], 'no refusal left of the rows it removed');
});

test('form (M4): setFormWhere into a custom endpoint adds the rows it lacks, and Save waits for the address', () => {
  const ed = renderModelEditor(BRIDGED, EFFORTS, { doc, providers: P });
  setFormWhere(ed, 'env');
  assert.equal(connectionWhere(ed), 'env');
  assert.deepEqual(envOf(ed), [['ANTHROPIC_BASE_URL', '', undefined], ['ANTHROPIC_AUTH_TOKEN', '', undefined]], 'new rows, not stored ones');
  const save = ed.querySelector('.mv-save');
  const problem = ed.querySelector('.mv-env-problem');
  assert.equal(save.disabled, true);
  assert.deepEqual([problem.hidden, problem.textContent], [false, 'ANTHROPIC_BASE_URL needs a value']);
  typeInto(ed.querySelector('.mv-env-row .mv-env-val'), 'https://gw.example');
  assert.equal(save.disabled, false);
  const { body } = collectModelEditor(ed);
  assert.equal(body.env.ANTHROPIC_BASE_URL, 'https://gw.example');
  assert.equal(body.upstream, null);
  setFormWhere(ed, 'env');
  assert.equal(ed.querySelectorAll('.mv-env-row').length, 2, 'the same place adds nothing');
  // A row the model already names is not added again.
  const tok = renderModelEditor({ id: 'tok', label: 'Tok', efforts: [...EFFORTS], env: { ANTHROPIC_AUTH_TOKEN: '••••••1234' } }, EFFORTS, { doc, providers: P });
  assert.equal(connectionWhere(tok), 'signin');
  setFormWhere(tok, 'env');
  assert.deepEqual(envOf(tok).map(([k]) => k), ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']);
  // A harness that cannot run there keeps its sign-in, and its rows.
  const cx = renderModelEditor({ id: 'cx', engine: 'codex', efforts: [], upstream: { provider: 'openai', api: 'openai-responses', model: 'q' } }, EFFORTS, { doc, providers: P, codexEfforts: CODEX_EFFORTS });
  setFormWhere(cx, 'env');
  assert.deepEqual([connectionWhere(cx), cx.querySelectorAll('.mv-env-row').length], ['signin', 0]);
});

test('form (M5): a copy names its source only while a masked echo is left for the server to fill', () => {
  const gw = { id: 'gw', label: 'Gateway', efforts: [...EFFORTS], env: { X: '••••••abcd', Y: 'lit' }, upstream: { provider: 'openai', api: 'openai-chat', model: 'm', apiKey: '••••••1234', capabilities: { toolCalls: true } } };
  const ed = renderModelEditor(gw, EFFORTS, { doc, providers: P, copyFrom: 'gw', id: 'gw-copy' });
  const x = ed.querySelector('.mv-env-row[data-key="X"] .mv-env-val');
  const key = ed.querySelector('.mv-conn-key');
  assert.equal(collectModelEditor(ed).body.copyFrom, 'gw');
  x.value = 'real-x';
  assert.equal(collectModelEditor(ed).body.copyFrom, 'gw', 'the key is still masked');
  key.value = 'sk-real';
  const { body } = collectModelEditor(ed);
  assert.equal('copyFrom' in body, false, 'every mask typed over: the source is not needed');
  assert.deepEqual([body.env, body.upstream.apiKey], [{ X: 'real-x', Y: 'lit' }, 'sk-real']);
  x.value = '••••••abcd';
  assert.equal(collectModelEditor(ed).body.copyFrom, 'gw', 'an env mask alone');
  assert.equal('copyFrom' in collectModelEditor(renderModelEditor(gw, EFFORTS, { doc, providers: P })).body, false, 'an edit never names one');
});

test('form (L18): no paragraph of explanation — every hint is 80 characters or fewer', () => {
  const forms = [
    ...['signin', 'env', 'provider'].map((where) => [where, renderModelEditor(null, EFFORTS, { doc, providers: P, where })]),
    ['provider edit', renderModelEditor(BRIDGED, EFFORTS, { doc, providers: P })],
  ];
  for (const [name, ed] of forms) {
    assert.deepEqual([...ed.querySelectorAll('small.hint')].map((s) => s.textContent).filter((t) => t.length > 80), [], name);
  }
});

test('phones: the Models header and the model cards wrap at 760px instead of running off a 375px screen', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readIndexHtml();
  assert.match(html, /<div class="mv-head-actions"(?: data-tab-only="catalogue")?>\s*<button type="button" id="models-more-btn" class="btn btn-quiet btn-icon" aria-label="More">\s*<svg[^>]*>(?:(?!<\/button>)[\s\S])*<\/svg>\s*<\/button>\s*<button type="button" id="model-create-btn"/, 'the header buttons sit in a styled group, not an inline-styled div: More (an icon), then Add model');
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
