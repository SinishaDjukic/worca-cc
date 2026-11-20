// src/core/workflow-tests/judge-models.mjs — Part 4 (plans/workflow-tests-part4-plan.md D87, D105, P4-Q2): the models that can check
// criteria (the Claude models of Worca's catalog) and the one Worca suggests: one the workflow's latest tries did not write with, so it
// does not mark its own work (board 2's hint).
import { listModels } from '../config.mjs';
import { runsOn, connectionLabel } from '../../shared/connections.mjs';
import { resolveModelEnv } from '../config.mjs';
import { PROVIDER_MODE_ENV_KEYS } from '../model-env.mjs';
import { brokerEnabled } from '../broker-client.mjs';
import { readUserSignIn } from '../engines/claude-sign-in.mjs';
import { carryOverModelEnv } from '../engines/claude.mjs';
import { manifestModels } from '../broker-routing.mjs';
import { findPipelineRowById } from '../artifacts.mjs';
import { getDb, prepare } from '../db.mjs';
import { testError } from './store.mjs';

const FAMILY = ['opus', 'fable', 'sonnet', 'haiku'];
const familyOf = (id) => { const i = FAMILY.findIndex((f) => String(id).toLowerCase().includes(`-${f}-`)); return i < 0 ? FAMILY.length : i; };
const plainId = (id) => String(id || '').toLowerCase().replace(/\[1m\]$/, '');

const CLOUDS = Object.freeze({ CLAUDE_CODE_USE_VERTEX: 'Google Vertex AI', CLAUDE_CODE_USE_BEDROCK: 'Amazon Bedrock', CLAUDE_CODE_USE_FOUNDRY: 'Microsoft Foundry' });
// The CLI's own rule (model-env.mjs `cliTruthy`, not exported): only 1, true, yes, on are on.
const isOn = (v) => typeof v === 'string' && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
// `own`: the model's env. A cloud switch it sets itself (even to '0') is its own word, so an ambient one does not apply.
const cloudIn = (env, own = null) => { for (const k of PROVIDER_MODE_ENV_KEYS) if (env && isOn(env[k]) && !(own && k in own)) return CLOUDS[k]; return null; };
const has = (env, keys) => !!env && keys.some((k) => typeof env[k] === 'string' && env[k].trim());
const apiKeyIn = (env) => has(env, ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
const tokenIn = (env) => has(env, ['CLAUDE_CODE_OAUTH_TOKEN']);
const baseUrlIn = (env) => has(env, ['ANTHROPIC_BASE_URL']);
const safeModelEnv = (id) => { try { return resolveModelEnv(id); } catch { return undefined; } };
const userClaude = () => { try { const u = readUserSignIn(); return { env: (u && u.env) || {}, settings: (u && u.settings) || {} }; } catch { return { env: {}, settings: {} }; } };

/** N3 (P4-Q17): who pays for a check with `m`, as far as Worca can see, in P4-Q17's order: the broker; the model's own
 *  routing (a cloud, a key, its connection or endpoint); what is set where Worca runs; what is in the person's Claude Code
 *  settings (env, an `apiKeyHelper`, AWS commands); "Claude sign-in" last. Only key presence is read, never a value. Worca
 *  cannot see managed Claude Code settings; P4-Q17 says so. */
export function paysFor(m, { modelEnv, processEnv = process.env, userEnv = {}, userSettings = {} } = {}) {
  if (brokerEnabled(processEnv)) return "Worca's credential broker";
  // Your Claude Code settings env goes OVER the model env at spawn, except over Worca's in-process bridge (carryOverModelEnv,
  // engines/claude.mjs), so a cloud it switches on pays even when the model env turns that cloud off.
  const yours = carryOverModelEnv(modelEnv) ? cloudIn(userEnv) : '';
  const own = cloudIn(modelEnv);
  if (own) return own;
  if (yours) return `${yours}, set in your Claude Code settings`;
  const label = connectionLabel(m);
  if (label !== 'Claude sign-in' || (modelEnv && 'ANTHROPIC_BASE_URL' in modelEnv)) return label === 'Claude sign-in' ? 'Custom endpoint' : label;
  // A row that otherwise reads as signed in. The CLI drops a key when a cloud switch is on, so a cloud set elsewhere beats the
  // model's key; the model env goes over the env where Worca runs, so a switch it sets itself wins there.
  const here = cloudIn(processEnv, modelEnv);
  if (here) return `${here}, set where Worca runs`;
  if (apiKeyIn(modelEnv)) return "An API key in this model's settings";
  if (tokenIn(modelEnv)) return "A Claude sign-in token in this model's settings";
  if (baseUrlIn(processEnv)) return 'Custom endpoint, set where Worca runs';
  if (apiKeyIn(processEnv)) return 'An API key set where Worca runs';
  if (tokenIn(processEnv)) return 'A Claude sign-in token set where Worca runs';
  if (baseUrlIn(userEnv)) return 'Custom endpoint, set in your Claude Code settings';
  const st = userSettings || {};
  if (has(st, ['apiKeyHelper'])) return 'An API key helper in your Claude Code settings';
  if (has(st, ['awsAuthRefresh', 'awsCredentialExport'])) return 'Amazon Bedrock, set in your Claude Code settings';
  if (apiKeyIn(userEnv)) return 'An API key set in your Claude Code settings';
  if (tokenIn(userEnv)) return 'A Claude sign-in token set in your Claude Code settings';
  return 'Claude sign-in';
}

/** P4-Q2, P4-Q17: the catalog's models that run on Claude Code, whatever their connection, as `{ id, label, pays }` in the
 *  catalog's order. `pays` names who pays for a check with it (`paysFor`). The deps exist for tests. */
export function claudeModels(catalog, { envOf = safeModelEnv, processEnv = process.env, userEnv, userSettings } = {}) {
  const u = userEnv === undefined || userSettings === undefined ? userClaude() : null;
  const uEnv = userEnv === undefined ? u.env : userEnv;
  const uSet = userSettings === undefined ? u.settings : userSettings;
  return (Array.isArray(catalog) ? catalog : []).filter((m) => m && typeof m.id === 'string' && !m.hidden && runsOn(m, 'claude'))
    .map((m) => ({ id: m.id, label: m.label || m.id, pays: paysFor(m, { modelEnv: envOf(m.id), processEnv, userEnv: uEnv, userSettings: uSet }) }));
}

/** D105 (pure): Opus, Fable, Sonnet, Haiku, each newest first; no "(1M)" twin unless there is nothing else; the first not in `writers`. */
export function suggestJudgeModel(models, writers = new Set()) {
  const plain = models.filter((m) => !/\[1m\]$/i.test(m.id));
  const pool = (plain.length ? plain : models).map((m, i) => ({ m, i }))
    .sort((x, y) => familyOf(x.m.id) - familyOf(y.m.id) || x.i - y.i).map((x) => x.m);
  if (!pool.length) return null;
  const used = new Set([...writers].map(plainId));
  const free = pool.find((m) => !used.has(plainId(m.id)));
  return free ? { ...free, suggested: true } : { ...pool[0], suggested: false };
}

/** The models the workflow's latest 10 finished real tries wrote with (their run manifests, `pipelines.stepper`). */
export function writerModelsOf(workflowId, { limit = 10 } = {}) {
  getDb();
  const rows = prepare(`SELECT pipeline_id FROM wf_test_tries WHERE workflow_id = ? AND status IN ('passed', 'failed') AND mock = 0
      AND pipeline_id IS NOT NULL ORDER BY id DESC LIMIT ?`).all(workflowId, limit);
  const out = new Set();
  for (const r of rows) {
    const row = findPipelineRowById(r.pipeline_id);
    let stepper = null;
    try { stepper = row && row.stepper ? JSON.parse(row.stepper) : null; } catch { stepper = null; }
    if (stepper) manifestModels(stepper, out);
  }
  return out;
}

export async function judgeModelsView(workflowId, { catalog = () => listModels() } = {}) {
  const models = claudeModels(await catalog());
  return { models, suggested: suggestJudgeModel(models, writerModelsOf(workflowId)) };
}

export async function checkJudgeModel(model, { catalog = () => listModels() } = {}) {
  // Validators ignore `hidden` (config.mjs: pickers skip it): a model saved before built-ins were hidden still validates.
  const rows = await catalog();
  if (!(Array.isArray(rows) ? rows : []).some((m) => m && m.id === model && typeof m.id === 'string' && runsOn(m, 'claude'))) {
    throw testError('pick one of the AI models in the list to check your criteria', 'BAD_REQUEST');
  }
}

/** D87: a picked model is checked; an example that has criteria and no model gets the suggestion when it is saved. */
export async function withJudgeModel(workflowId, fields, was = null, { catalog = () => listModels() } = {}) {
  if (fields.judge && fields.judge.model) { await checkJudgeModel(fields.judge.model, { catalog }); return fields; }
  const judge = fields.judge !== undefined ? fields.judge : was ? was.judge : null;
  const criteria = fields.criteria !== undefined ? fields.criteria : was ? was.criteria : [];
  if (judge || !Array.isArray(criteria) || !criteria.some((c) => String(c && typeof c === 'object' ? c.text : c || '').trim())) return fields;
  const view = await judgeModelsView(workflowId, { catalog });
  return view.suggested ? { ...fields, judge: { model: view.suggested.id } } : fields;
}
