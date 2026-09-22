// src/core/ask/model-proposal.mjs
// The ONE validator behind mcp__worca__propose_model_change, the edit merge its apply replays,
// and the event/notice text of the model card (docs/models.md "Ask Worca"). Pure: every reader
// and every dry-run setter is injected (model-deps.mjs binds the real ones), so the MCP child
// validates for the model's self-correction and the parent turn re-validates authoritatively —
// the policy-proposal.mjs split. Nothing here writes; applying a card is ui/server.mjs's
// business, behind the user's click.
//
// Why a card: the catalog and the providers are machine-wide settings every run spawns with,
// and a wrong base URL or key breaks every pipeline that names the model. Credentials never
// pass through here: a key is a ${VAR} reference or nothing, and the Copilot sign-in and its
// notice stay on the Providers card.
import { modelEnvRef, maskModelEnvValue, isLocalBaseUrl, UPSTREAM_PROVIDERS } from '../model-env.mjs';

export const MODEL_CHANGE_KINDS = Object.freeze(['add_model', 'edit_model', 'remove_model', 'provider', 'import_copilot']);
const MAX_IMPORT = 40;
/** Below this a local model's pipelines thrash auto-compact (docs/models.md Troubleshooting). */
export const LOCAL_MIN_WINDOW = 65536;

// ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, AWS_SECRET_ACCESS_KEY … — but not *_MAX_OUTPUT_TOKENS.
const SECRET_ENV_RE = /(^|_)(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(_|$)/i;
const SECRET_HEADER_RE = /authorization|api[-_]?key|token|secret|cookie|password/i;

export const MODEL_ERRORS = Object.freeze({
  kind: `kind must be one of ${MODEL_CHANGE_KINDS.join(', ')}`,
  model: 'model must be an object: {id, label?, efforts?, env?, cost?, upstream?}',
  idRequired: (kind) => `${kind} needs an id (the catalog model id from list_models)`,
  unknownModel: (id) => `unknown model "${id}" — list_models shows the catalog`,
  builtin: (id) => `"${id}" is a built-in model with no catalog entry — propose add_model with the same id to override it`,
  readOnly: (id, where) => `"${id}" comes from ${where} and is read-only here`,
  secretEnv: (k) => `env ${k} looks like a credential — pass it as a \${VAR} reference to a variable set in worca's environment, or leave it out and let the user paste it in Settings › Models`,
  secretKey: (where) => `${where} must be a \${VAR} reference to a variable set in worca's environment (or empty to clear) — never the key itself; the user can paste a literal key in Settings › Models`,
  secretHeader: (k) => `upstream.headers.${k} looks like a credential — the user sets it in the model editor; use apiKey with a \${VAR} reference instead`,
  provider: `provider must be one of ${UPSTREAM_PROVIDERS.join(', ')}`,
  providerSet: 'provider needs set: {baseUrl?, apiKey?, maxConcurrent?, accountType?}',
  signIn: (k) => `${k} is not settable here — the Copilot sign-in and its notice happen on the Providers card (Settings › Models), by the user`,
  noChange: 'nothing changes — the settings already say exactly this',
  importIds: `import_copilot needs ids: 1 to ${MAX_IMPORT} Copilot model ids from list_copilot_models`,
  editEmpty: 'edit_model needs model with at least one of label, efforts, env, cost, upstream',
});

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
const isClear = (v) => v === null || v === '';

/** A stored value as the card and the tools show it: a ${VAR} ref reads, a literal is masked. */
export function maskValue(v) {
  if (typeof v !== 'string' || !v) return v;
  return modelEnvRef(v) ? v : maskModelEnvValue(v);
}

// A value that can carry a credential whatever its key: URL userinfo, or a key / token in a query string.
const EMBEDDED_SECRET_RE = /:\/\/[^/\s]*@|[?&](?:key|api[-_]?key|token|access_token|sig|secret)=/i;

/** One env value as Ask shows it: routing and tuning read (a base URL, a model id, a limit); a credential is masked. */
export function maskEnvValue(key, v) {
  if (typeof v !== 'string' || !v || modelEnvRef(v)) return v;
  return SECRET_ENV_RE.test(key) || EMBEDDED_SECRET_RE.test(v) ? maskModelEnvValue(v) : v;
}

/** A catalog entry with every credential masked (credential env values, upstream.apiKey). */
export function maskEntry(m) {
  if (!m) return m;
  return {
    ...m,
    ...(m.env ? { env: Object.fromEntries(Object.entries(m.env).map(([k, v]) => [k, maskEnvValue(k, v)])) } : {}),
    ...(m.upstream ? { upstream: { ...m.upstream, ...(m.upstream.apiKey ? { apiKey: maskValue(m.upstream.apiKey) } : {}) } } : {}),
  };
}

/** Credentials must arrive as ${VAR}: returns the first error, or null. */
function secretErrors(model) {
  const errs = [];
  if (isObj(model.env)) {
    for (const [k, v] of Object.entries(model.env)) {
      if (v === null) continue;                                     // a delete marker carries no secret
      if (SECRET_ENV_RE.test(k) && !(typeof v === 'string' && modelEnvRef(v.trim()))) errs.push(MODEL_ERRORS.secretEnv(k));
    }
  }
  if (isObj(model.upstream)) {
    const key = model.upstream.apiKey;
    if (key !== undefined && !isClear(key) && !(typeof key === 'string' && modelEnvRef(key.trim()))) errs.push(MODEL_ERRORS.secretKey('upstream.apiKey'));
    if (isObj(model.upstream.headers)) {
      for (const k of Object.keys(model.upstream.headers)) if (SECRET_HEADER_RE.test(k)) errs.push(MODEL_ERRORS.secretHeader(k));
    }
  }
  return errs;
}

/**
 * The edit patch the setter receives, from the model's patch and the CURRENT entry. `upstream`
 * merges into the current block (a null field removes it; `capabilities` merges one level
 * deeper) so a change of limits never has to restate — or see — the stored key; `upstream: null`
 * drops the block. `env` is updateGlobalModel's own per-key merge. Re-run at apply time against
 * the entry as it is then, so the card never stores a merged block (it could hold a literal key).
 */
export function mergeEditPatch(current, patch) {
  const out = {};
  for (const k of ['label', 'efforts', 'env', 'cost']) if (patch[k] !== undefined) out[k] = patch[k];
  if (patch.upstream === null) out.upstream = null;
  else if (isObj(patch.upstream)) {
    const next = { ...(current && current.upstream ? current.upstream : {}) };
    for (const [k, v] of Object.entries(patch.upstream)) {
      if (k === 'capabilities' && isObj(v)) {
        const caps = { ...(next.capabilities || {}) };
        for (const [ck, cv] of Object.entries(v)) { if (cv === null) delete caps[ck]; else caps[ck] = cv; }
        if (Object.keys(caps).length) next.capabilities = caps; else delete next.capabilities;
      } else if (isClear(v)) delete next[k];
      else next[k] = v;
    }
    out.upstream = next;
  }
  return out;
}

const connectionOf = (m) => (m.upstream ? `through provider ${m.upstream.provider}` : m.env && m.env.ANTHROPIC_BASE_URL ? 'custom endpoint via env' : 'Anthropic API / CLI default');
const fmtEfforts = (e) => (Array.isArray(e) && e.length ? e.join(', ') : 'all');
const fmtCost = (c) => (!c ? null : c.free ? 'free' : c.perMtok ? Object.entries(c.perMtok).map(([k, v]) => `${k} $${v}`).join(' · ') : JSON.stringify(c));
const fmtCaps = (c) => (!c ? null : Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · '));

/** Display rows for one entry (masked): [{field, value}]. */
function entryRows(m) {
  const rows = [
    { field: 'Label', value: m.label || m.id },
    { field: 'Connection', value: connectionOf(m) },
  ];
  if (m.upstream) {
    rows.push({ field: 'Upstream model', value: `${m.upstream.model} (${m.upstream.api})` });
    if (m.upstream.baseUrl) rows.push({ field: 'Base URL', value: m.upstream.baseUrl });
    if (m.upstream.apiKey) rows.push({ field: 'API key', value: maskValue(m.upstream.apiKey) });
    if (m.upstream.headers) rows.push({ field: 'Headers', value: Object.keys(m.upstream.headers).join(', ') });
    if (m.upstream.capabilities) rows.push({ field: 'Limits', value: fmtCaps(m.upstream.capabilities) });
  }
  for (const [k, v] of Object.entries(m.env || {})) rows.push({ field: k, value: typeof v === 'string' ? maskEnvValue(k, v) : String(v) });
  rows.push({ field: 'Efforts', value: fmtEfforts(m.efforts) });
  const c = fmtCost(m.cost);
  if (c) rows.push({ field: 'Pricing', value: c });
  return rows;
}

/** before → after rows for the fields that differ. */
function diffRows(before, after) {
  const b = new Map(entryRows(before).map((r) => [r.field, r.value]));
  const a = new Map(entryRows(after).map((r) => [r.field, r.value]));
  const rows = [];
  for (const f of new Set([...b.keys(), ...a.keys()])) {
    if (b.get(f) !== a.get(f)) rows.push({ field: f, before: b.get(f) ?? null, after: a.get(f) ?? null });
  }
  return rows;
}

/**
 * @param {{
 *   listGlobalModels:()=>Array<object>, listPluginModels:()=>Array<object>, policyModels:()=>Array<object>,
 *   predefined:Array<{id:string,label:string}>, addModel:(m:object, o:{dryRun:true})=>Promise<object>,
 *   updateModel:(id:string, p:object, o:{dryRun:true})=>Promise<object>, updateProvider:(n:string, p:object, o:{dryRun:true})=>Promise<object>,
 *   providerConfig:(n:string)=>object, providerReadiness:(u:object)=>{ok:boolean, message?:string},
 *   modelRefs:(id:string)=>{steps:Array, nodes:Array, predefinedShadow:boolean}, envHas:(name:string)=>boolean,
 *   copilotModels?:()=>Promise<Array<{id:string,name:string,inCatalog:boolean}>>,
 * }} r
 */
export function createModelChangeValidator(r) {
  const findGlobal = (id) => r.listGlobalModels().find((m) => m.id.toLowerCase() === id.toLowerCase()) || null;
  const where = (id) => {
    const lc = id.toLowerCase();
    const p = r.listPluginModels().find((m) => m.id.toLowerCase() === lc);
    if (p) return `plugin ${p.plugin}`;
    let t = null;
    try { t = r.policyModels().find((m) => m.id.toLowerCase() === lc); } catch { t = null; }
    if (t) return `the team policy${t.home ? ` of ${t.home}` : ''}`;
    return null;
  };

  /** Warnings about the entry as it will be — never blocking. */
  function entryWarnings(m) {
    const w = [];
    const refs = [];
    for (const v of Object.values(m.env || {})) { const ref = typeof v === 'string' ? modelEnvRef(v) : null; if (ref) refs.push(ref); }
    const keyRef = m.upstream && typeof m.upstream.apiKey === 'string' ? modelEnvRef(m.upstream.apiKey) : null;
    if (keyRef) refs.push(keyRef);
    for (const ref of refs) if (!r.envHas(ref)) w.push(`\${${ref}} is not set in worca's environment — set it and restart Worca before a run uses this model`);
    if (m.upstream) {
      const ready = r.providerReadiness(m.upstream);
      if (!ready.ok && !keyRef) w.push(`${ready.message} — the model shows "needs sign-in" until then`);
      const caps = m.upstream.capabilities || {};
      const base = m.upstream.baseUrl || (m.upstream.provider !== 'copilot' ? r.providerConfig(m.upstream.provider).baseUrl : null);
      if (m.upstream.api === 'openai-chat' && !caps.maxPromptTokens) {
        w.push('no prompt limit (capabilities.maxPromptTokens) — the CLI then assumes a 200k window and compacts too late; set it to what the endpoint serves');
      } else if (base && isLocalBaseUrl(base) && caps.maxPromptTokens < LOCAL_MIN_WINDOW) {
        w.push(`a ${caps.maxPromptTokens}-token window is too small for pipelines — serve at least ${LOCAL_MIN_WINDOW} (llama.cpp -c ${LOCAL_MIN_WINDOW}) and raise the limit to match`);
      }
    }
    return w;
  }

  async function validateModel(kind, input) {
    const note = clip(str(input.note), 200) || null;
    if (kind === 'add_model') {
      if (!isObj(input.model)) return { ok: false, errors: [MODEL_ERRORS.model] };
      const errs = secretErrors(input.model);
      if (errs.length) return { ok: false, errors: errs };
      const id = str(input.model.id);
      if (id && where(id)) return { ok: false, errors: [MODEL_ERRORS.readOnly(id, where(id))] };
      let entry;
      try { entry = await r.addModel(input.model, { dryRun: true }); } catch (err) { return { ok: false, errors: [err.message] }; }
      const shadows = r.predefined.find((p) => p.id.toLowerCase() === entry.id.toLowerCase());
      return { ok: true, card: {
        type: 'model', kind, target: entry.id, summary: `Add model ${entry.label || entry.id}${shadows ? ` (overrides the built-in ${shadows.label})` : ''}`,
        note, rows: entryRows(maskEntry(entry)).map((x) => ({ field: x.field, before: null, after: x.value })),
        warnings: entryWarnings(entry), change: { model: input.model },
      } };
    }
    const id = str(input.id) || (isObj(input.model) ? str(input.model.id) : '');
    if (!id) return { ok: false, errors: [MODEL_ERRORS.idRequired(kind)] };
    const current = findGlobal(id);
    if (!current) {
      const w = where(id);
      if (w) return { ok: false, errors: [MODEL_ERRORS.readOnly(id, w)] };
      if (r.predefined.some((p) => p.id.toLowerCase() === id.toLowerCase())) return { ok: false, errors: [MODEL_ERRORS.builtin(id)] };
      return { ok: false, errors: [MODEL_ERRORS.unknownModel(id)] };
    }
    if (kind === 'remove_model') {
      const refs = r.modelRefs(current.id);
      const n = (refs.steps || []).length + (refs.nodes || []).length;
      const warnings = [];
      if (n) warnings.push(`${n} workflow ${n === 1 ? 'node uses' : 'nodes use'} this model — ${n === 1 ? 'it falls' : 'they fall'} back to the default model`);
      if (refs.predefinedShadow) warnings.push('this entry overrides a built-in model — removing it restores the built-in');
      return { ok: true, card: {
        type: 'model', kind, target: current.id, summary: `Remove model ${current.label || current.id}`, note,
        rows: entryRows(maskEntry(current)).map((x) => ({ field: x.field, before: x.value, after: null })),
        warnings, change: { id: current.id },
      } };
    }
    // edit_model
    const patch = isObj(input.model) ? { ...input.model } : null;
    if (patch) delete patch.id;
    if (!patch || !['label', 'efforts', 'env', 'cost', 'upstream'].some((k) => patch[k] !== undefined)) return { ok: false, errors: [MODEL_ERRORS.editEmpty] };
    const errs = secretErrors(patch);
    if (errs.length) return { ok: false, errors: errs };
    let next;
    try { next = await r.updateModel(current.id, mergeEditPatch(current, patch), { dryRun: true }); } catch (err) { return { ok: false, errors: [err.message] }; }
    const rows = diffRows(maskEntry(current), maskEntry(next));
    if (!rows.length) return { ok: false, errors: [MODEL_ERRORS.noChange] };
    return { ok: true, card: {
      type: 'model', kind, target: current.id, summary: `Edit model ${current.label || current.id}`, note,
      rows, warnings: entryWarnings(next), change: { id: current.id, patch },
    } };
  }

  async function validateProvider(input) {
    const note = clip(str(input.note), 200) || null;
    const name = str(input.provider);
    if (!UPSTREAM_PROVIDERS.includes(name)) return { ok: false, errors: [MODEL_ERRORS.provider] };
    if (!isObj(input.set) || !Object.keys(input.set).length) return { ok: false, errors: [MODEL_ERRORS.providerSet] };
    const set = { ...input.set };
    for (const k of ['githubToken', 'acknowledgedTerms', 'termsVersion', 'login']) if (k in set) return { ok: false, errors: [MODEL_ERRORS.signIn(k)] };
    if ('apiKey' in set && !isClear(set.apiKey) && !(typeof set.apiKey === 'string' && modelEnvRef(set.apiKey.trim()))) {
      return { ok: false, errors: [MODEL_ERRORS.secretKey(`${name} apiKey`)] };
    }
    const before = r.providerConfig(name);
    let after;
    try { after = await r.updateProvider(name, set, { dryRun: true }); } catch (err) { return { ok: false, errors: [err.message] }; }
    const fields = ['baseUrl', 'apiKey', 'maxConcurrent', 'accountType'];
    const label = { baseUrl: 'Base URL', apiKey: 'API key', maxConcurrent: 'Max concurrent requests', accountType: 'Account type' };
    const shown = (f, v) => (v == null ? null : String(f === 'apiKey' ? maskValue(v) : v));
    const rows = fields
      .map((f) => ({ field: label[f], before: shown(f, before[f]), after: shown(f, after[f]) }))
      .filter((x) => x.before !== x.after);
    if (!rows.length) return { ok: false, errors: [MODEL_ERRORS.noChange] };
    const warnings = [];
    const keyRef = typeof after.apiKey === 'string' ? modelEnvRef(after.apiKey) : null;
    if (keyRef && !r.envHas(keyRef)) warnings.push(`\${${keyRef}} is not set in worca's environment — set it and restart Worca`);
    if (name !== 'copilot' && !after.apiKey && !(name === 'openai' && isLocalBaseUrl(after.baseUrl))) {
      warnings.push(`no API key — models through ${name} show "needs sign-in" until the user sets one`);
    }
    const title = { copilot: 'GitHub Copilot', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' }[name];
    return { ok: true, card: {
      type: 'model', kind: 'provider', target: name, summary: `Change the ${title} provider`, note,
      rows, warnings, change: { provider: name, set },
    } };
  }

  async function validateImport(input) {
    const note = clip(str(input.note), 200) || null;
    const ids = Array.isArray(input.ids) ? [...new Set(input.ids.map((s) => str(s)).filter(Boolean))] : [];
    if (!ids.length || ids.length > MAX_IMPORT) return { ok: false, errors: [MODEL_ERRORS.importIds] };
    if (typeof r.copilotModels !== 'function') return { ok: false, errors: ['the Copilot model list is unavailable'] };
    let list;
    try { list = await r.copilotModels(); } catch (err) { return { ok: false, errors: [err.message] }; }
    const byId = new Map(list.map((m) => [m.id, m]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) return { ok: false, errors: [`not offered to this Copilot account: ${unknown.join(', ')} — list_copilot_models shows what is`] };
    const rows = ids.map((id) => { const m = byId.get(id); return { field: m.name || id, before: m.inCatalog ? 'in catalog' : null, after: m.inCatalog ? 'capabilities refreshed' : `added as copilot-${id}` }; });
    return { ok: true, card: {
      type: 'model', kind: 'import_copilot', target: 'copilot',
      summary: `Import ${ids.length} Copilot model${ids.length === 1 ? '' : 's'}`, note, rows, warnings: [], change: { ids },
    } };
  }

  /** @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>} */
  return async function validateModelChange(input) {
    const inp = isObj(input) ? input : {};
    const kind = str(inp.kind);
    if (!MODEL_CHANGE_KINDS.includes(kind)) return { ok: false, errors: [MODEL_ERRORS.kind] };
    if (kind === 'provider') return validateProvider(inp);
    if (kind === 'import_copilot') return validateImport(inp);
    return validateModel(kind, inp);
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on a model card. */
export function modelEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 200);
  if (state === 'declined') return `[worca event] model card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] model card ${cardId} failed: ${eventText(result?.error || 'unknown error', 200)}; "${summary}"`;
  return `[worca event] model card ${cardId} applied; "${summary}"${result?.detail ? `; ${eventText(result.detail, 300)}` : ''}`;
}

/** The user-row notice above the event turn. */
export function modelNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 160);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(result.detail, 200)}` : ''}`;
}
