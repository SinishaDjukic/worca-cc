// src/core/setup/apply.mjs — POST /api/setup/apply (D20): validate every group first (nothing written on
// any error, the field named), write settings.json ONCE with only the keys whose stored value changes
// (D19), then run the side effects in order and report one result each. A failed step keeps the earlier
// writes and names itself as the step to retry; a credential-broker refusal is a result, never a stop (AC-3.6).
import {
  readSettings, writeSettingsKeys, assertCostLimitInputs, assertModelRolesInput, assertTestSettingsAccess,
  nextUsdCap, nextCostLimitResetPeriod, nextUiLevel, nextAutoGeneratePrDescription, nextSmartNaming, nextRunEngine,
  nextModelRoles, nextNetworkProxy, nextProviders, copilotTermsAcknowledged,
  nextSyncSettings, nextNetworkWait, assertHideBuiltinModelsInput, DEFAULT_HIDE_BUILTIN_MODELS,
} from '../settings.mjs';
import { COPILOT_TERMS_VERSION } from '../model-env.mjs';
import { settingsErrorReply, userLine, INTERNAL_KEY } from '../settings-errors.mjs';
import { assertProxyLoginInput, savedLoginRefusal, saveProxyLogin, ProxyLoginError } from '../proxy-credentials.mjs';
import { brokerRefusal, testProviderConnection, importCopilotModels, importEndpointModels, endpointModelsForImport, pendingImportIds } from '../bridge/provider-ops.mjs';
import { testModel } from '../model-test.mjs';
import { ROLE_LABELS } from '../../shared/model-roles.mjs';
import { ENGINES } from '../../shared/engine-switch.mjs';
import { SAVED_TEXT, SAVED_OFF_TEXT, PORT_PENDING_TEXT } from '../../shared/network-proxy-text.mjs';

export const SETUP_GROUPS = Object.freeze({
  network: Object.freeze(['networkProxy', 'login']),
  access: Object.freeze(['copilot', 'openai', 'anthropic']),
  models: Object.freeze(['modelRoles', 'testRoles']),
  work: Object.freeze(['uiLevel', 'pipelineCostLimitUsd', 'totalCostLimitUsd', 'costLimitResetPeriod', 'autoGeneratePrDescription', 'smartNaming', 'runEngine',
    'hideBuiltinModels', 'sync', 'networkWait']),
});
const PROVIDER_FIELDS = Object.freeze({
  copilot: ['acknowledgeTerms', 'accountType', 'signIn', 'importModels'],
  openai: ['baseUrl', 'apiKey', 'importModels'],
  anthropic: ['baseUrl', 'apiKey'],
});
// The labels Models › Providers shows (ui/public/bridge-view.mjs PROVIDER_LABELS and its field labels).
export const PROVIDER_LABELS = Object.freeze({ copilot: 'GitHub Copilot', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' });
const PROVIDER_FIELD_LABELS = Object.freeze({ baseUrl: 'Base URL', apiKey: 'API key', accountType: 'Account type', importModels: 'Import models' });
// The Network proxy card's login labels (ui/public/settings-network-proxy.mjs).
export const LOGIN_LABELS = Object.freeze({ domain: 'Domain', user: 'User name', password: 'Password' });
const WORK_NEXT = Object.freeze({
  uiLevel: (_cur, v) => nextUiLevel(v),
  pipelineCostLimitUsd: (_cur, v) => nextUsdCap('pipelineCostLimitUsd', v),
  totalCostLimitUsd: (_cur, v) => nextUsdCap('totalCostLimitUsd', v),
  costLimitResetPeriod: (_cur, v) => nextCostLimitResetPeriod(v),
  autoGeneratePrDescription: (_cur, v) => nextAutoGeneratePrDescription(v),
  smartNaming: (cur, v) => nextSmartNaming(cur, v),
  runEngine: (_cur, v) => nextRunEngine(v),
  hideBuiltinModels: (_cur, v) => { assertHideBuiltinModelsInput(v); return v === DEFAULT_HIDE_BUILTIN_MODELS ? undefined : v; },
  sync: (cur, v) => nextSyncSettings(cur, v),
  networkWait: (cur, v) => nextNetworkWait(cur, v),
});
const COST_KEYS = ['pipelineCostLimitUsd', 'totalCostLimitUsd', 'costLimitResetPeriod'];
const MAX_IMPORT_IDS = 200;

export class SetupFieldError extends Error {
  constructor(field, message, code) { super(message); this.field = field; if (code) this.code = code; }
}

/** Settings changed on disk between Plan and Commit for a key this apply writes: the route answers 409. */
export class SetupConflictError extends Error {
  constructor(keys) { super('Settings changed while Worca was applying the setup. Review them and apply again.'); this.keys = keys; this.code = 'SETTINGS_CHANGED'; }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
const sentence = (s) => userLine(s);          // capitalised, ends in a stop, credentials stripped, no internal key (A21)

/** Key-order-insensitive deep equal over JSON values (A5): {a,b} and {b,a} are the same stored value. */
export function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (!isObj(a) || !isObj(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => own(b, k) && sameValue(a[k], b[k]));
}

/** A settings validator's throw → { field: '<group>.<path>', error: the label sentence } (settings-errors.mjs). */
function settingsFieldError(group, key, err) {
  const { error, field } = settingsErrorReply(err, key);
  return new SetupFieldError(`${group}.${field || key}`, error);
}
async function check(group, key, fn) {
  try { return await fn(); } catch (err) { throw err instanceof SetupFieldError ? err : settingsFieldError(group, key, err); }
}
function providerFieldError(name, err) {
  const m = /^(\w+)\s+(.*)$/.exec(String(err && err.message || err));
  const key = m && PROVIDER_FIELD_LABELS[m[1]] ? m[1] : null;
  return new SetupFieldError(`access.${name}${key ? `.${key}` : ''}`,
    key ? sentence(`“${PROVIDER_LABELS[name]} · ${PROVIDER_FIELD_LABELS[key]}” ${m[2]}`)
      : userLine(`${PROVIDER_LABELS[name]}: ${err && err.message ? err.message : err}`, PROVIDER_LABELS[name]));
}
function importIds(name, v) {
  if (!Array.isArray(v) || !v.length || v.length > MAX_IMPORT_IDS || !v.every((x) => typeof x === 'string' && x.trim() && x.length <= 200)) {
    throw new SetupFieldError(`access.${name}.importModels`, `“${PROVIDER_LABELS[name]} · Import models” must list 1 to ${MAX_IMPORT_IDS} model ids.`);
  }
  return v.map((x) => x.trim());
}
const isMaskedEcho = (v) => typeof v === 'string' && v.startsWith('••');

/**
 * Phase 1: validate every group and compute what would be stored. Writes nothing, spawns nothing.
 * @throws {SetupFieldError} the first invalid field, as { field, message, code? }
 * @returns {Promise<{values:Record<string,any>, written:string[], before:Record<string,any>, steps:object[], refused:object[], fromStep:string|null}>}
 */
export async function planSetupApply(body, deps = {}) {
  // checkProxy has no default on purpose: a caller that forgets it must not skip the UNTESTED gate (fail closed).
  const d = { readSettings, brokerRefusal, checkProxy: null, checkModelRoles: async (p) => p,
    endpointModels: (o) => endpointModelsForImport(o),
    fixedPortNow: () => null, now: () => new Date(), ...deps };
  if (!isObj(body)) throw new SetupFieldError(null, 'Send the setup as one JSON object.');
  for (const k of Object.keys(body)) if (!own(SETUP_GROUPS, k) && k !== 'fromStep') throw new SetupFieldError(k, `Worca has no setup group “${k}”.`);
  for (const [g, keys] of Object.entries(SETUP_GROUPS)) {
    if (!own(body, g)) continue;
    if (!isObj(body[g])) throw new SetupFieldError(g, `The “${g}” group must be an object.`);
    for (const k of Object.keys(body[g])) if (!keys.includes(k)) throw new SetupFieldError(`${g}.${k}`, `Worca has no setup field “${g}.${k}”.`);
  }
  const current = d.readSettings();
  const next = {};            // top-level key -> value to store (undefined = delete)
  const refused = [];
  const steps = [];

  // ── work ──
  const work = body.work || {};
  const costs = COST_KEYS.filter((k) => own(work, k));
  if (costs.length) {
    try { assertCostLimitInputs(Object.fromEntries(costs.map((k) => [k, work[k]]))); }
    catch (err) { throw settingsFieldError('work', costs.find((k) => String(err.message).startsWith(k)) || costs[0], err); }
  }
  for (const [k, fn] of Object.entries(WORK_NEXT)) if (own(work, k)) next[k] = await check('work', k, () => fn(current[k], work[k]));
  // The person (or their team setup) has now chosen, as setHideBuiltinModels records.
  if (own(work, 'hideBuiltinModels')) next.hideBuiltinModelsChosen = true;

  // ── models ── (the shape is checked here; the catalog check runs after access, with its planned imports)
  const models = body.models || {};
  const roleInput = own(models, 'modelRoles') ? await check('models', 'modelRoles', () => assertModelRolesInput(models.modelRoles)) : null;
  if (own(models, 'testRoles') && typeof models.testRoles !== 'boolean') throw new SetupFieldError('models.testRoles', '“Models · Test the roles” must be true or false.');

  // ── network ──
  const network = body.network || {};
  let networkProxy = isObj(current.networkProxy) ? current.networkProxy : undefined;
  if (own(network, 'networkProxy')) {
    if (typeof d.checkProxy !== 'function') throw new Error('setup apply: the proxy gate (checkProxy) is required for network.networkProxy');
    networkProxy = await check('network', 'networkProxy', () => nextNetworkProxy(network.networkProxy));
    // Nothing new would be sent when the planned value is already stored (a proxy-swap retry after the
    // 10-minute test pass expired): the gate guards a write, so it is skipped then (architect-2-2).
    // The login this apply saves rides along: the pass must be for that account (D9).
    if (!sameValue(networkProxy, current.networkProxy)) {
      const { refused: gate } = await check('network', 'networkProxy', () => d.checkProxy(network.networkProxy, own(network, 'login') ? network.login : undefined));
      if (gate) throw new SetupFieldError('network.networkProxy', gate.body.error, gate.body.code);
    }
    next.networkProxy = networkProxy;
  }
  let login = null;
  if (own(network, 'login')) {
    const l = isObj(network.login) ? network.login : {};
    // The auth the proxy will have AFTER this apply: the planned value when the body sets networkProxy
    // (undefined when it clears it, i.e. the default), else the stored one (architect-2-3).
    const refusal = savedLoginRefusal(own(network, 'networkProxy') ? networkProxy?.auth : current.networkProxy?.auth);
    if (refusal) throw new SetupFieldError('network.login', refusal, 'BASIC_NO_SAVED_LOGIN');
    try { login = { ...assertProxyLoginInput(l), password: l.password }; }
    catch (err) {
      if (!(err instanceof ProxyLoginError)) throw err;
      throw new SetupFieldError(`network.login.${err.field}`, sentence(`“${LOGIN_LABELS[err.field] || 'Proxy login'}”: ${err.message}`));
    }
  }

  // ── access ──
  const access = body.access || {};
  let providers = current.providers;
  const imports = {};
  let signIn = false;
  let signInRefused = false;
  let openaiKey;
  // The body's own order (every key was checked against SETUP_GROUPS.access above), so refusal rows
  // follow the order the person entered the providers in; the side-effect steps keep the D20 order below.
  for (const name of Object.keys(access)) {
    const a = access[name];
    if (!isObj(a)) throw new SetupFieldError(`access.${name}`, `“${PROVIDER_LABELS[name]}” must be an object.`);
    for (const k of Object.keys(a)) if (!PROVIDER_FIELDS[name].includes(k)) throw new SetupFieldError(`access.${name}.${k}`, `Worca has no setup field “access.${name}.${k}”.`);
    const patch = {};
    if (own(a, 'baseUrl')) patch.baseUrl = a.baseUrl;
    if (own(a, 'accountType')) patch.accountType = a.accountType;
    if (own(a, 'apiKey') && !isMaskedEcho(a.apiKey)) {
      const err = typeof a.apiKey === 'string' && a.apiKey.trim() ? d.brokerRefusal('store a provider key') : null;
      if (err) refused.push({ id: `provider-key.${name}`, label: `${PROVIDER_LABELS[name]} · API key`, state: 'refused', line: err.message });
      else patch.apiKey = typeof a.apiKey === 'string' && !a.apiKey.trim() ? '' : a.apiKey;   // whitespace-only is a clear, never a stored ''
    }
    if (name === 'openai' && own(patch, 'apiKey')) openaiKey = patch.apiKey;
    if (name === 'copilot') {
      if (own(a, 'acknowledgeTerms') && a.acknowledgeTerms !== true) throw new SetupFieldError('access.copilot.acknowledgeTerms', '“GitHub Copilot · Acknowledge the notice” must be true.');
      if (a.acknowledgeTerms === true && !copilotTermsAcknowledged()) Object.assign(patch, { acknowledgedTerms: d.now().toISOString(), termsVersion: COPILOT_TERMS_VERSION });
      if (own(a, 'signIn') && typeof a.signIn !== 'boolean') throw new SetupFieldError('access.copilot.signIn', '“GitHub Copilot · Sign in” must be true or false.');
      if (a.signIn === true) {
        const err = d.brokerRefusal('sign in to GitHub Copilot');
        if (err) { refused.push({ id: 'copilot-signin', label: 'GitHub Copilot sign-in', state: 'refused', line: err.message }); signInRefused = true; }
        else signIn = true;
      }
    }
    if (own(a, 'importModels')) imports[name] = importIds(name, a.importModels);
    if (Object.keys(patch).length) {
      assertTestSettingsAccess();
      try { providers = nextProviders(providers, name, patch); } catch (err) { throw providerFieldError(name, err); }
    }
  }
  if (providers !== current.providers) next.providers = providers;

  // ── model roles (D20): a role may name a model this apply's own import creates (pending ids) ──
  let rolePatch = null;
  let pending = [];
  if (roleInput) {
    const openaiBase = providers?.openai?.baseUrl || undefined;
    const p = await pendingImportIds({
      copilot: imports.copilot && !signInRefused ? imports.copilot : null,           // a skipped import creates nothing
      openai: imports.openai ? { ids: imports.openai, baseUrl: openaiBase, apiKey: openaiKey, providerBaseUrl: openaiBase } : null,
    }, { endpointModels: d.endpointModels });
    pending = p.pending;
    rolePatch = await check('models', 'modelRoles', async () => {
      try { return await d.checkModelRoles(roleInput, { pending }); }
      catch (err) {
        if (p.unreachable && /unknown model/.test(String(err && err.message))) {
          // A camelCase token in the reason would make settingsErrorReply's safe() replace the WHOLE line (D-E).
          const why = INTERNAL_KEY.test(p.unreachable) ? '' : `: ${p.unreachable}`;
          err.message = `${String(err.message).replace(/\.$/, '')}. Worca could not reach the OpenAI-compatible endpoint to list the models this setup imports${why}`;
        }
        throw err;
      }
    });
    next.modelRoles = nextModelRoles(current.modelRoles, rolePatch);
  }

  // ── diff (D19) and steps (D20 order) ──
  const fromStep = body.fromStep ?? null;
  if (fromStep !== null && (typeof fromStep !== 'string' || fromStep.length > 100)) throw new SetupFieldError('fromStep', 'The step to retry must be a step name from this setup.');
  const written = Object.keys(next).filter((k) => !sameValue(next[k], current[k]));
  const values = Object.fromEntries(written.map((k) => [k, next[k]]));
  const before = Object.fromEntries(written.map((k) => [k, current[k]]));
  // A failed swap is retried with the same body: networkProxy is then already stored (not written), so the
  // step is also planned when the retry names it (architect-1-1).
  if (own(network, 'networkProxy') && (written.includes('networkProxy') || fromStep === 'proxy-swap')) {
    steps.push({ id: 'proxy-swap', label: 'Network proxy', networkProxy: networkProxy ?? {}, beforeFixed: d.fixedPortNow() });
  }
  if (login) steps.push({ id: 'proxy-login', label: 'Proxy login', login });
  if (signIn) steps.push({ id: 'copilot-signin', label: 'GitHub Copilot sign-in' });
  if (imports.copilot) steps.push({ id: 'copilot-import', label: 'Import Copilot models', ids: imports.copilot,
    ...(signInRefused ? { skip: 'Not run: GitHub Copilot sign-in is on the key page.' } : {}) });
  if (imports.openai) steps.push({ id: 'openai-import', label: 'Import OpenAI-compatible models', ids: imports.openai,
    baseUrl: (providers?.openai?.baseUrl) || undefined });
  if (models.testRoles === true) {
    const roles = rolePatch || (isObj(current.modelRoles) ? current.modelRoles : {});
    const importedBy = new Map(pending.map((p) => [p.id.toLowerCase(), p.from]));
    for (const [engine, byRole] of Object.entries(roles)) for (const [role, pair] of Object.entries(byRole || {})) {
      if (!pair || !pair.model) continue;
      const from = importedBy.get(pair.model.toLowerCase());
      steps.push({ id: `role-test.${engine}.${role}`, label: `${ROLE_LABELS[role] || role} · ${ENGINES[engine]?.label || engine}`,
        model: pair.model, ...(from ? { importedBy: from } : {}) });
    }
  }
  if (fromStep !== null && !steps.some((s) => s.id === fromStep)) throw new SetupFieldError('fromStep', 'That step is not part of this setup, so there is nothing to retry there.');
  return { values, written, before, steps, refused, fromStep };
}

/**
 * Phase 2: the ONE settings write (none when nothing changed). Re-reads settings first: when a key this
 * apply writes changed on disk since Plan (another tab, the CLI), it throws SetupConflictError and writes
 * nothing, so a stale `providers` or `modelRoles` never overwrites a newer one (architect-1-2).
 */
export async function commitSetupPlan(plan, deps = {}) {
  if (!plan.written.length) return [];
  const fresh = (deps.readSettings || readSettings)();
  const moved = plan.written.filter((k) => !sameValue(fresh[k], plan.before[k]));
  if (moved.length) throw new SetupConflictError(moved);
  return (deps.writeSettingsKeys || writeSettingsKeys)(plan.values);
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "Imported 2 models from X." — or, when every id was already there, never "Imported 0 models" (ux-2-3). */
const importedLine = (r, from) => {
  const n = r.created.length + r.updated.length;
  return n ? `Imported ${plural(n, 'model')} from ${from}.` : 'Those models were already imported.';
};
/** The catalog ids an import now holds (created or updated), read defensively (D-H). */
const importedIds = (r) => [...(r?.created || []), ...(r?.updated || [])];
const DEFAULT_RUN_DEPS = {
  applyProxy: async () => { throw new Error('the proxy cannot be applied outside the Worca server'); },
  reloadLogin: () => {},
  saveLogin: async (l) => saveProxyLogin(l),
  verifyCopilot: () => testProviderConnection('copilot'),
  importCopilot: (ids) => importCopilotModels(ids),
  importEndpoint: (ids, o) => importEndpointModels(ids, o),
  testModel: (id) => testModel(id),
};
const RUNNERS = {
  'proxy-swap': async (s, d) => {
    const r = await d.applyProxy(s.networkProxy, s.beforeFixed);
    if (r.upstreamError) return { ok: false, line: sentence(r.upstreamError) };
    // The Network proxy card's own formula (ui/public/settings-network-proxy.mjs), same constants (A20).
    const port = (r.pending || []).includes('fixedPort') ? PORT_PENDING_TEXT : '';
    return { ok: true, line: (s.networkProxy?.enabled ? SAVED_TEXT : SAVED_OFF_TEXT) + port };
  },
  'proxy-login': async (s, d) => {
    const view = await d.saveLogin(s.login);
    d.reloadLogin();
    return { ok: true, line: `Logged in as ${view.label}.` };
  },
  'copilot-signin': async (_s, d) => {
    const r = await d.verifyCopilot();
    if (r.ok) return { ok: true, line: 'Signed in to GitHub Copilot.' };
    const why = String(r.message || 'GitHub did not accept the sign-in').replace(/\.$/, '');
    // Say "sign in again" once: testProviderConnection's 401 reason already ends with it.
    return { ok: false, line: sentence(`GitHub Copilot sign-in failed: ${why}${/sign in again/i.test(why) ? '' : '. Sign in again, then retry'}`) };
  },
  'copilot-import': async (s, d) => {
    const r = await d.importCopilot(s.ids);
    return { ok: true, line: importedLine(r, 'GitHub Copilot'), imported: importedIds(r) };
  },
  'openai-import': async (s, d) => {
    const r = await d.importEndpoint(s.ids, { baseUrl: s.baseUrl });
    return { ok: true, line: importedLine(r, String(r.baseUrl || s.baseUrl).replace(/(\/\/)[^/\s:@]+(?::[^/\s@]*)?@/, '$1')), imported: importedIds(r) };   // no user:pass@ in the row
  },
  'role-test': async (s, d) => {
    const r = await d.testModel(s.model);
    return r.ok ? { ok: true, line: `${s.model} answered.` } : { ok: false, line: [sentence(r.message), r.hint].filter(Boolean).join(' ') };
  },
};
const runnerOf = (id) => RUNNERS[id.startsWith('role-test.') ? 'role-test' : id];
const failLine = (step, err) => {
  const msg = String(err && err.message ? err.message : err).replace(/\.$/, '');
  const text = step.id === 'proxy-login' ? `Could not log in: ${msg}` : step.id.endsWith('-import') ? `Could not import models: ${msg}` : msg;
  return userLine(text, step.label);       // credentials stripped, bounded, no internal key (A21)
};

/**
 * Phase 3: the side effects, in order. Refusals first (they never stop the run), then each step;
 * the first failure names itself as `retry` and every later step is skipped. A role test on a model this
 * apply imports is not run when that import failed or did not import it: Retry is then the import (D-H).
 * @returns {Promise<{ok:boolean, retry:string|null, results:object[]}>}
 */
export async function runSetupSteps(plan, { deps = {}, onResult = () => {} } = {}) {
  const d = { ...DEFAULT_RUN_DEPS, ...deps };
  const results = [];
  const emit = (r) => { results.push(r); onResult(r); };
  for (const r of plan.refused) emit(r);
  const start = plan.fromStep ? plan.steps.findIndex((s) => s.id === plan.fromStep) : 0;
  const imported = new Map();        // import step id -> lower-cased catalog ids it created or updated
  let failed = null;
  let notImported = null;            // the import step a role test waited on in vain
  const indexOf = (id) => plan.steps.findIndex((s) => s.id === id);
  for (const [i, step] of plan.steps.entries()) {
    const base = { id: step.id, label: step.label };
    if (i < start) { emit({ ...base, state: 'skipped', line: 'Done before; not run again.' }); continue; }
    if (step.importedBy && (failed?.id === step.importedBy
      || (imported.has(step.importedBy) && !imported.get(step.importedBy).has(String(step.model).toLowerCase())))) {
      notImported ||= step.importedBy;
      emit({ ...base, state: 'skipped', line: `Not run: ${step.model} was not imported.` });
      continue;
    }
    if (failed) { emit({ ...base, state: 'skipped', line: `Not run: ${failed.label} failed first.` }); continue; }
    if (step.skip) { emit({ ...base, state: 'skipped', line: step.skip }); continue; }      // a broker-refused sign-in's import: not a failure
    let r;
    try { r = await runnerOf(step.id)(step, d); } catch (err) { r = { ok: false, line: failLine(step, err) }; }
    if (r.ok) {
      if (Array.isArray(r.imported)) imported.set(step.id, new Set(r.imported.map((x) => String(x).toLowerCase())));
      emit({ ...base, state: 'ok', line: r.line });
    } else { failed = step; emit({ ...base, state: 'failed', line: r.line, retry: step.id }); }
  }
  // Retry from the EARLIEST step that needs a re-run (D-H): an import that skipped a role's model comes before a
  // role test that failed later, and retrying that role test alone would test a model that was never imported.
  const candidates = [failed?.id, notImported].filter(Boolean);
  const retry = candidates.length ? candidates.reduce((a, b) => (indexOf(b) < indexOf(a) ? b : a)) : null;
  return { ok: !failed && !notImported, retry, results };
}
