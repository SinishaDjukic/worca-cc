// test/policy-registry.test.mjs
// The team-policy registry (src/core/policy/registry.mjs): document normalisation never throws,
// drops bad pieces one warning at a time, downgrades `hard`, refuses secrets, and serialises in
// registry order (team-policy design §5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, fieldMeta, normalizePolicyDoc, normalizeEntry, validateValue, serializePolicyDoc, emptyPolicyDoc,
  effectiveKind, tierRank, semverAtLeast, looksLikeSecret, POLICY_SCHEMA, GROUP_ORDER,
} from '../src/core/policy/registry.mjs';
import { checkRows } from './helpers/rows.mjs';

const SAMPLE = {
  schema: 1, updatedAt: '2026-09-17T09:12:00Z', updatedBy: 'Mara Lindqvist', title: 'Gateway team policy', notes: 'Q4 budget.',
  fields: {
    'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause', requireReason: false },
    'cost.totalLimitUsd': { kind: 'soft', value: 150, onBreach: 'warn', requireReason: true },
    'cost.resetPeriod': { kind: 'default', value: 'monthly' },
    'cost.pooledBudgetUsd': { kind: 'soft', value: 1200, window: 'monthly' },
    'guardrails.minimum': { kind: 'soft', value: 'normal' },
    'models.allowed': { kind: 'soft', value: ['claude-opus-5-5', 'claude-sonnet-5'] },
    'models.steps': { kind: 'default', value: { planner: { model: 'claude-opus-5-5', effort: 'high' } } },
    'plugins.required': { kind: 'soft', value: [{ name: 'github-source', marketplace: 'worca-cc' }, { name: 'acme-jira', marketplace: 'acme/worca-plugins', minVersion: '1.2.0', config: { baseUrl: 'https://acme.atlassian.net', projectKey: 'GW' } }] },
    'workflows.default': { kind: 'default', value: 'wfp_acme-jira_ticket-to-pr' },
    'worca.minVersion': { kind: 'soft', value: '1.4.0' },
  },
  workspaceRuns: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 25 } },
  catalogs: {
    guardrailSets: [{ id: 'gateway-normal', name: 'Gateway normal', protectedPaths: ['.env*'], deny: ['Bash(git push)', 'Bash(git push:*)'] }],
    models: [{ id: 'acme-proxy-opus', label: 'Opus via Acme gateway', efforts: ['medium', 'high'], env: { ANTHROPIC_BASE_URL: 'https://llm.acme.internal', ANTHROPIC_AUTH_TOKEN: '${ACME_LLM_TOKEN}' } }],
  },
};

test('registry rows are complete and grouped', () => {
  assert.ok(FIELDS.length >= 18);
  for (const f of FIELDS) {
    assert.ok(GROUP_ORDER.includes(f.group), `${f.key} group`);
    assert.ok(f.kinds.length >= 1 && f.kinds.every((k) => ['default', 'soft', 'hard'].includes(k)), `${f.key} kinds`);
    assert.ok(f.label && f.help && f.type, `${f.key} copy`);
  }
  assert.equal(fieldMeta('cost.pipelineLimitUsd').cap, true);
  assert.equal(fieldMeta('nope'), null);
});

test('a well-formed document normalises without warnings and keeps every field', () => {
  const { doc, warnings, unknownSchema, delegateTo } = normalizePolicyDoc(SAMPLE);
  assert.deepEqual(warnings, []);
  assert.equal(unknownSchema, false); assert.equal(delegateTo, null);
  assert.equal(Object.keys(doc.fields).length, 10);
  assert.deepEqual(doc.fields['cost.totalLimitUsd'], { kind: 'soft', value: 150, onBreach: 'warn', requireReason: true });
  assert.deepEqual(doc.workspaceRuns['cost.pipelineLimitUsd'], { kind: 'soft', value: 25 });
  assert.equal(doc.catalogs.guardrailSets[0].honorProjectSettings, true);
  assert.deepEqual(doc.catalogs.models[0].env, SAMPLE.catalogs.models[0].env);
  assert.equal(doc.title, 'Gateway team policy');
});

test('malformed pieces are dropped one warning each; the rest survives (the readRemoteConfig lesson)', () => {
  const raw = {
    schema: 1,
    fields: {
      'cost.pipelineLimitUsd': { kind: 'soft', value: -3 },              // bad value
      'cost.resetPeriod': { kind: 'soft', value: 'monthly' },            // kind not accepted
      'models.allowed': { kind: 'soft', value: 'claude-opus-5-5' },        // not a list
      'guardrails.minimum': { kind: 'soft', value: 'normal', onBreach: 'x' }, // attr not on this field: ignored silently
      'bogus.key': { kind: 'default', value: 1 },
      'run.humanInLoop': 'yes',
      'worca.minVersion': { kind: 'soft', value: '1.4.0' },
    },
    workspaceRuns: 'nope',
    catalogs: { guardrailSets: [{ name: 'no id' }, { id: 'ok', deny: ['x'] }, { id: 'OK' }], models: [{ id: 'm1', env: { WORCA_X: '1' } }, { id: 'm2', env: { ANTHROPIC_AUTH_TOKEN: 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH' } }, { id: 'm3', env: { ANTHROPIC_BASE_URL: 'https://x' } }] },
  };
  const { doc, warnings } = normalizePolicyDoc(raw);
  assert.deepEqual(Object.keys(doc.fields), ['guardrails.minimum', 'worca.minVersion']);
  assert.deepEqual(doc.workspaceRuns, {});
  assert.deepEqual(doc.catalogs.guardrailSets.map((s) => s.id), ['ok']);
  assert.deepEqual(doc.catalogs.models.map((m) => m.id), ['m3']);
  assert.ok(warnings.some((w) => w.startsWith('cost.pipelineLimitUsd:')));
  assert.ok(warnings.some((w) => w.includes('cost.resetPeriod') && w.includes('not allowed')));
  assert.ok(warnings.some((w) => w.includes('bogus.key')));
  assert.ok(warnings.some((w) => w.includes('workspaceRuns')));
  assert.ok(warnings.some((w) => w.includes('WORCA_X') && w.includes('reserved')));
  assert.ok(warnings.some((w) => w.includes('m2') && w.includes('secret')));
  assert.ok(warnings.some((w) => w.includes('duplicate id OK')));
});

test('normalisation edges: hard reads as soft/default with a warning; a newer schema is unusable; a marker carries delegateTo', async () => {
  await checkRows([
    { name: 'hard is reserved: accepted with a warning, effectiveKind downgrades it', run: () => {
      const { entry, warning } = normalizeEntry('cost.pipelineLimitUsd', { kind: 'hard', value: 10 });
      assert.equal(entry.kind, 'hard');
      assert.match(warning, /not enforced by this version — treated as soft/);
      assert.equal(effectiveKind(fieldMeta('cost.pipelineLimitUsd'), 'hard'), 'soft');
      const d = normalizeEntry('cost.resetPeriod', { kind: 'hard', value: 'weekly' });
      assert.match(d.warning, /treated as default/);
      assert.equal(effectiveKind(fieldMeta('cost.resetPeriod'), 'hard'), 'default');
      assert.equal(effectiveKind(fieldMeta('cost.resetPeriod'), 'default'), 'default');
    } },
    { name: 'a newer schema is unusable, not partially applied; a marker carries delegateTo', run: () => {
      const up = normalizePolicyDoc({ schema: POLICY_SCHEMA + 1, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 1 } } });
      assert.equal(up.doc, null); assert.equal(up.unknownSchema, true); assert.match(up.warnings[0], /needs a newer Worca/);
      const marker = normalizePolicyDoc({ schema: 1, delegateTo: 'Acme/Gateway' });
      assert.equal(marker.delegateTo, 'acme/gateway'); assert.deepEqual(marker.doc.fields, {});
      assert.equal(normalizePolicyDoc('x').doc, null);
      assert.equal(normalizePolicyDoc(null).warnings[0], 'policy.json is not a JSON object');
    } },
  ]);
});

test('validateValue per type', () => {
  const m = (k) => fieldMeta(k);
  assert.equal(validateValue(m('cost.pipelineLimitUsd'), 10), null);
  assert.match(validateValue(m('cost.pipelineLimitUsd'), 0), /positive/);
  assert.equal(validateValue(m('ask.maxBudgetUsd'), null), null);
  assert.match(validateValue(m('ask.maxBudgetUsd'), 500), /between/);
  assert.equal(validateValue(m('ask.maxTurns'), 40), null);
  assert.match(validateValue(m('ask.maxTurns'), 4.5), /integer/);
  assert.match(validateValue(m('guardrails.minimum'), 'strict'), /one of/);
  assert.match(validateValue(m('worca.minVersion'), 'v1'), /version like/);
  assert.match(validateValue(m('models.steps'), { planner: { effort: 'ultra' } }), /effort/);
  assert.match(validateValue(m('plugins.required'), [{ name: 'Bad Name' }]), /not a valid plugin name/);
  assert.match(validateValue(m('plugins.required'), [{ name: 'ok', config: { token: 'ghp_' + 'a'.repeat(36) } }]), /looks like a secret/);
  assert.equal(validateValue(m('plugins.required'), [{ name: 'ok', config: { baseUrl: 'https://x', retries: 3, on: true } }]), null);
});

test('serialisation follows registry order and round-trips; the empty doc is publishable', () => {
  const { doc } = normalizePolicyDoc({ ...SAMPLE, fields: { 'worca.minVersion': SAMPLE.fields['worca.minVersion'], 'cost.pipelineLimitUsd': SAMPLE.fields['cost.pipelineLimitUsd'] } });
  const text = serializePolicyDoc(doc);
  assert.ok(text.endsWith('\n'));
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed.fields), ['cost.pipelineLimitUsd', 'worca.minVersion']);
  assert.deepEqual(Object.keys(parsed), ['schema', 'updatedAt', 'updatedBy', 'title', 'notes', 'fields', 'workspaceRuns', 'catalogs']);
  const again = normalizePolicyDoc(parsed);
  assert.deepEqual(again.warnings, []);
  const empty = emptyPolicyDoc({ updatedBy: 'x', title: 't' });
  assert.deepEqual(normalizePolicyDoc(JSON.parse(serializePolicyDoc(empty))).warnings, []);
});

test('helpers: tierRank, semverAtLeast, looksLikeSecret', () => {
  assert.equal(tierRank('permissive'), 0); assert.equal(tierRank('secure'), 2); assert.equal(tierRank('nope'), null);
  assert.equal(tierRank({ settings: { envScrub: true } }), 2);
  assert.equal(tierRank({ deny: ['Bash(git push)'] }), 1);
  assert.equal(tierRank({ settings: { deny: [], protectedPaths: [] } }), 0);
  assert.equal(semverAtLeast('1.4.0', '1.3.9'), true); assert.equal(semverAtLeast('1.3.0', '1.4.0'), false); assert.equal(semverAtLeast('1.4.0-rc.1', '1.4.0'), true);
  assert.equal(looksLikeSecret('${TOKEN}'), false); assert.equal(looksLikeSecret('https://x'), false);
  assert.equal(looksLikeSecret('sk-ant-' + 'a'.repeat(30)), true); assert.equal(looksLikeSecret('a'.repeat(48)), true);
  // Both Azure DevOps PAT shapes (84-char with AZDO, 52-char base32): the long opaque token rule covers them.
  assert.equal(looksLikeSecret('A'.repeat(76) + 'AZDO' + 'abcd'), true);
  assert.equal(looksLikeSecret('abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst'), true);
});

test('ask.webEnabled / ask.webAllowedDomains', () => {
  const e = fieldMeta('ask.webEnabled');
  assert.equal(e.type, 'bool'); assert.deepEqual(e.kinds, ['soft']); assert.equal(e.group, 'ask');
  assert.equal(validateValue(e, false), null);
  assert.match(validateValue(e, true), /only switch web access off/, 'a team can never switch web access on');
  const d = fieldMeta('ask.webAllowedDomains');
  assert.equal(d.type, 'string[]'); assert.deepEqual(d.kinds, ['soft']); assert.equal(d.domains, true);
  assert.match(validateValue(d, ['*.github.io']), /anyone can host/);
  assert.equal(validateValue(d, ['docs.example.com', '*.mdn.io']), null);
  assert.match(validateValue(d, ['not a host']), /host name/);
});

test('catalog models: a Codex entry keeps its engine, Codex efforts and a Responses endpoint; routing env drops it', () => {
  const { doc, warnings } = normalizePolicyDoc({
    schema: 1,
    catalogs: { models: [
      { id: 'acme-codex', engine: 'codex', efforts: ['low', 'max'] },
      { id: 'acme-codex-env', engine: 'codex', env: { ANTHROPIC_BASE_URL: 'https://x' } },
      { id: 'acme-codex-local', engine: 'codex', upstream: { provider: 'openai', api: 'openai-responses', model: 'qwen', baseUrl: 'http://gw.acme:8000/v1', apiKey: '${ACME_KEY}' } },
      { id: 'acme-codex-chat', engine: 'codex', upstream: { provider: 'openai', api: 'openai-chat', model: 'qwen' } },
      { id: 'acme-codex-literal', engine: 'codex', upstream: { provider: 'openai', api: 'openai-responses', model: 'qwen', apiKey: 'sk-literal-key-123456' } },
      { id: 'acme-odd', engine: 'gemini' },
      { id: 'acme-claude', efforts: ['high'] },
    ] },
  });
  assert.deepEqual(doc.catalogs.models, [
    { id: 'acme-codex', label: 'acme-codex', efforts: ['low'], engine: 'codex' },
    { id: 'acme-codex-local', label: 'acme-codex-local', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex',
      upstream: { provider: 'openai', api: 'openai-responses', model: 'qwen', baseUrl: 'http://gw.acme:8000/v1', apiKey: '${ACME_KEY}' } },
    { id: 'acme-claude', label: 'acme-claude', efforts: ['high'] },
  ]);
  assert.ok(warnings.some((w) => w.includes('acme-codex-env') && w.includes('a codex model takes no env')), warnings.join('\n'));
  assert.ok(warnings.some((w) => w.includes('acme-codex-chat') && w.includes('Responses API only')), warnings.join('\n'));
  assert.ok(warnings.some((w) => w.includes('acme-codex-literal') && w.includes('${VAR} reference')), warnings.join('\n'));
  assert.ok(warnings.some((w) => w.includes('acme-odd') && w.includes('engine')), warnings.join('\n'));
});

test('catalog models: a Cursor entry keeps its engine with no efforts; env or an upstream drops it', () => {
  const { doc, warnings } = normalizePolicyDoc({
    schema: 1,
    catalogs: { models: [
      { id: 'acme-cursor', engine: 'cursor', efforts: ['high'] },
      { id: 'acme-cursor-env', engine: 'cursor', env: { X: 'y' } },
      { id: 'acme-cursor-up', engine: 'cursor', upstream: { provider: 'openai', api: 'openai-responses', model: 'qwen' } },
      { id: 'acme-claude' },
    ] },
  });
  assert.deepEqual(doc.catalogs.models, [
    { id: 'acme-cursor', label: 'acme-cursor', efforts: [], engine: 'cursor' },
    { id: 'acme-claude', label: 'acme-claude', efforts: ['medium', 'high'] },
  ]);
  assert.ok(warnings.some((w) => w.includes('acme-cursor-env') && w.includes('a cursor model takes no env')), warnings.join('\n'));
  assert.ok(warnings.some((w) => w.includes('acme-cursor-up') && w.includes('a cursor model takes no upstream')), warnings.join('\n'));
});
