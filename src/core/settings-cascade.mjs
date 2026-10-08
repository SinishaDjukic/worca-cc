import { getDb, prepare, tx } from './db.mjs';
import { projectKey as keyOfDir } from './store.mjs';
import {
  readSettings, setProjectLayerReader, nightModeSettings, memoryDefragModel,
  runEngineSetting, stepModelsSetting, utilityModelsSetting, normalizeModelPair, SETTING_CHECKS,
  askEngineSetting, askModelsSetting,
  assertAskWebInput, askWebStoreShape, UTILITY_JOBS,
  DEFAULT_CONTEXT_MAX_BYTES_PER_FILE, DEFAULT_CONTEXT_MAX_BYTES_TOTAL, DEFAULT_SKILL_MOUNT,
  DEFAULT_MEMORY_SOFT_BYTES_PER_FILE, DEFAULT_MEMORY_HARD_BYTES_PER_FILE, DEFAULT_MEMORY_MAX_FILES_PER_SCOPE,
  DEFAULT_MEMORY_HOOK_MAX_CHARS, DEFAULT_MEMORY_DEFRAG_WRITES, DEFAULT_MEMORY_DEFRAG_FILES,
  DEFAULT_MEMORY_DEFRAG_BYTES_PCT, DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES,
  DEFAULT_ASK_MAX_TURNS, DEFAULT_ASK_MAX_BUDGET_USD, DEFAULT_HUMAN_RATE_USD,
} from './settings.mjs';
import { cachedPolicyForKey } from './policy/cache.mjs';
import { fieldsForRun } from './policy/effective.mjs';
import { MODEL_ENGINES, HELPER_ENGINES } from './model-env.mjs';
import { NIGHT_FIELDS, NIGHT_DEFAULTS, fieldError as nightFieldError } from './night/config.mjs';

export const LAYERS = Object.freeze(['project', 'user', 'team']);
const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const dig = (object, path) => path.reduce((value, key) => isObj(value) ? value[key] : undefined, object);
const parseObj = (text) => { try { const value = JSON.parse(text); return isObj(value) ? value : {}; } catch { return {}; } };
const pickPair = (value) => {
  if (!isObj(value)) return undefined;
  const pair = {};
  if (typeof value.model === 'string' && value.model.trim()) pair.model = value.model.trim();
  if (typeof value.effort === 'string' && value.effort.trim()) pair.effort = value.effort.trim();
  return Object.keys(pair).length ? pair : undefined;
};

let modelOwnerReader = null;
export function setCascadeModelOwnerReader(fn) { modelOwnerReader = typeof fn === 'function' ? fn : null; }
const pairCheck = (engine) => (value, _layer, ctx) => {
  try {
    if (normalizeModelPair(engine, value) === null) return false;
    const owner = value?.model && modelOwnerReader ? modelOwnerReader(value.model, { projectDir: ctx?.projectDir || null }) : null;
    return !owner || owner === engine;
  } catch { return false; }
};
const webIn = (raw) => isObj(raw) ? { enabled: raw.enabled, anyHost: raw.anyHost ?? false, allowedDomains: raw.allowedDomains ?? [], search: raw.search ?? null } : raw;
const OFF_WEB = Object.freeze({ enabled: false, anyHost: false, allowedDomains: Object.freeze([]), search: null });

function scalar({ id, path = [id], check, def, teamKey = null, hint, readUser = null }) {
  return { id, path, store: 'settings', default: def, hint, validate: (value) => check(value),
    readUser: readUser || ((ctx) => dig(ctx.settings(), path)), readProject: (ctx) => dig(ctx.projectSettings(), path),
    team: teamKey ? (ctx) => ctx.teamValue(teamKey) : null };
}
const SCALARS = [
  scalar({ id: 'run.engine', path: ['runEngine'], check: SETTING_CHECKS.runEngine, def: 'claude', hint: 'must be an engine', readUser: runEngineSetting }),
  scalar({ id: 'pipelineCostLimitUsd', check: SETTING_CHECKS.usdCap, def: null, hint: 'must be a positive number of USD' }),
  scalar({ id: 'humanRateUsdPerHour', check: SETTING_CHECKS.usdCap, def: DEFAULT_HUMAN_RATE_USD, teamKey: 'cost.humanRateUsd', hint: 'must be a positive number of USD' }),
  scalar({ id: 'askMaxTurns', check: SETTING_CHECKS.askMaxTurns, def: DEFAULT_ASK_MAX_TURNS, teamKey: 'ask.maxTurns', hint: 'must be an integer between 1 and 500' }),
  scalar({ id: 'askMaxBudgetUsd', check: SETTING_CHECKS.askMaxBudgetUsd, def: DEFAULT_ASK_MAX_BUDGET_USD, teamKey: 'ask.maxBudgetUsd', hint: 'must be a valid budget' }),
  scalar({ id: 'askWeb', check: (value) => { try { assertAskWebInput(webIn(value)); return true; } catch { return false; } }, def: OFF_WEB, hint: 'must be web settings', readUser: (ctx) => ctx.settings().askWeb ?? undefined }),
  scalar({ id: 'contextMaxBytesPerFile', check: SETTING_CHECKS.byteCap, def: DEFAULT_CONTEXT_MAX_BYTES_PER_FILE }),
  scalar({ id: 'contextMaxBytesTotal', check: SETTING_CHECKS.byteCap, def: DEFAULT_CONTEXT_MAX_BYTES_TOTAL }),
  scalar({ id: 'skillMount', check: SETTING_CHECKS.skillMount, def: DEFAULT_SKILL_MOUNT }),
  scalar({ id: 'memory.softBytesPerFile', path: ['memory', 'softBytesPerFile'], check: SETTING_CHECKS.byteCap, def: DEFAULT_MEMORY_SOFT_BYTES_PER_FILE }),
  scalar({ id: 'memory.maxBytesPerFile', path: ['memory', 'maxBytesPerFile'], check: SETTING_CHECKS.byteCap, def: DEFAULT_MEMORY_HARD_BYTES_PER_FILE }),
  scalar({ id: 'memory.maxFilesPerScope', path: ['memory', 'maxFilesPerScope'], check: SETTING_CHECKS.byteCap, def: DEFAULT_MEMORY_MAX_FILES_PER_SCOPE }),
  scalar({ id: 'memory.hookMaxChars', path: ['memory', 'hookMaxChars'], check: SETTING_CHECKS.byteCap, def: DEFAULT_MEMORY_HOOK_MAX_CHARS }),
  scalar({ id: 'memory.defrag.writes', path: ['memory', 'defrag', 'writes'], check: SETTING_CHECKS.byteCap, def: DEFAULT_MEMORY_DEFRAG_WRITES }),
  scalar({ id: 'memory.defrag.files', path: ['memory', 'defrag', 'files'], check: SETTING_CHECKS.byteCap, def: DEFAULT_MEMORY_DEFRAG_FILES }),
  scalar({ id: 'memory.defrag.bytesPct', path: ['memory', 'defrag', 'bytesPct'], check: SETTING_CHECKS.pct, def: DEFAULT_MEMORY_DEFRAG_BYTES_PCT }),
  scalar({ id: 'memory.defrag.alwaysOnBytes', path: ['memory', 'defrag', 'alwaysOnBytes'], check: SETTING_CHECKS.byteCap, def: DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES }),
];
const NIGHT = NIGHT_FIELDS.map((field) => ({
  id: `nightMode.${field}`, path: [field], store: 'nightMode', default: NIGHT_DEFAULTS[field], hint: 'is not a valid Away mode value',
  validate: (value, layer) => !(layer === 'project' && field === 'spendCapUsd') && !nightFieldError(field, value),
  readUser: () => nightModeSettings()[field], readProject: (ctx) => ctx.nightProject()?.[field], team: (ctx) => ctx.teamValue(`night.${field}`),
}));
const STATIC = new Map([...SCALARS, ...NIGHT].map((entry) => [entry.id, entry]));
const STEP_RE = new RegExp(`^models\\.(${MODEL_ENGINES.join('|')})\\.steps\\.([A-Za-z0-9_-]{1,64})$`);
// UTIL_RE and ASK_MODEL_RE stay (claude|codex): the sign-in engines (Cursor, Gemini CLI, Qwen Code) have no helper or Ask slots.
const UTIL_RE = /^models\.(claude|codex)\.(?:utility\.(title|classifier|overview|prDescription)|(memoryDefrag|workspaceScan))$/;
const RUN_JOBS = new Set(['title', 'classifier', 'overview', 'prDescription']);
const utilityId = (engine, job) => (RUN_JOBS.has(job) ? `models.${engine}.utility.${job}` : `models.${engine}.${job}`);

function stepEntry(engine, role) {
  return { id: `models.${engine}.steps.${role}`, family: 'steps', engine, role, path: ['stepModels', engine, role],
    store: engine === 'claude' ? 'steps' : 'settings', default: undefined, validate: pairCheck(engine),
    readUser: () => pickPair(dig(stepModelsSetting(), [engine, role])),
    readProject: (ctx) => pickPair(engine === 'claude' ? ctx.stepsRow()[role] : dig(ctx.projectSettings(), ['stepModels', engine, role])),
    team: engine === 'claude' ? (ctx) => pickPair(dig(ctx.teamValue('models.steps'), [role])) : null };
}
const storedModel = (ctx, key) => typeof ctx.settings()[key] === 'string' && ctx.settings()[key].trim() ? { model: ctx.settings()[key].trim() } : undefined;
const CLAUDE_USER = {
  title: (ctx) => storedModel(ctx, 'titleModel'), classifier: (ctx) => storedModel(ctx, 'autoWorkflowModel'),
  overview: () => undefined, prDescription: (ctx) => storedModel(ctx, 'prDescriptionModel'),
  memoryDefrag: () => { const pair = memoryDefragModel(); return pair.model ? { model: pair.model, ...(pair.effort ? { effort: pair.effort } : {}) } : undefined; },
};
function utilEntry(engine, job) {
  if (!HELPER_ENGINES.includes(engine)) return null;          // Cursor, Gemini CLI, Qwen Code: no utility ids (helper jobs run on Claude)
  if (engine === 'claude' && job === 'workspaceScan') return null;
  return { id: utilityId(engine, job), family: 'utility', engine, job, path: ['utilityModels', engine, job], store: 'settings',
    default: undefined, userOnly: job === 'workspaceScan', validate: pairCheck(engine),
    readUser: engine === 'claude' ? CLAUDE_USER[job] : () => pickPair(dig(utilityModelsSetting(), [engine, job])),
    readProject: (ctx) => pickPair(dig(ctx.projectSettings(), ['utilityModels', engine, job])), team: null };
}
// Ask Worca (D17): user-only, not cascadable — reachable by id so one resolver serves every caller, but never
// listed by settingIds(), so the project Settings API and tab are unchanged.
const ASK_ENGINE = Object.freeze({ id: 'askEngine', path: ['askEngine'], store: 'settings', default: 'claude', userOnly: true, hint: 'must be an engine',
  validate: (value) => SETTING_CHECKS.engine(value), readUser: () => askEngineSetting(), readProject: () => undefined, team: null });
const ASK_MODEL_RE = /^models\.(claude|codex)\.ask$/;
function askModelEntry(engine) {
  return { id: `models.${engine}.ask`, family: 'ask', engine, path: ['askModels', engine], store: 'settings', default: undefined, userOnly: true,
    validate: pairCheck(engine), readUser: () => pickPair(askModelsSetting()[engine]), readProject: () => undefined, team: null };
}
export function settingEntry(id) {
  if (typeof id !== 'string') return null;
  if (STATIC.has(id)) return STATIC.get(id);
  if (id === 'askEngine') return ASK_ENGINE;
  const ask = ASK_MODEL_RE.exec(id);
  if (ask) return askModelEntry(ask[1]);
  let match = STEP_RE.exec(id);
  if (match) return stepEntry(match[1], match[2]);
  match = UTIL_RE.exec(id);
  return match ? utilEntry(match[1], match[2] || match[3]) : null;
}
export function settingIds({ roles = [] } = {}) {
  const ids = [...STATIC.keys()];
  for (const engine of MODEL_ENGINES) {
    for (const role of roles) ids.push(`models.${engine}.steps.${role}`);
    for (const job of UTILITY_JOBS) { const entry = utilEntry(engine, job); if (entry) ids.push(entry.id); }
  }
  return ids;
}

function makeCtx(scope) {
  const selected = typeof scope === 'string' ? { projectDir: scope } : isObj(scope) ? scope : {};
  // `key` names the project whose team policy applies; a workspace run (its primary member)
  // keeps the team layer and skips only the project layer (`projectLayer`), as before Plan 2a.
  let key = null;
  if (typeof selected.projectKey === 'string' && selected.projectKey) key = selected.projectKey;
  else if (typeof selected.projectDir === 'string' && selected.projectDir) try { key = keyOfDir(selected.projectDir); } catch {}
  const projectLayer = !!key && !selected.workspace;
  const memo = new Map();
  const once = (name, fn) => { if (!memo.has(name)) memo.set(name, fn()); return memo.get(name); };
  const row = () => once('row', () => { if (!projectLayer) return null; try { getDb(); return prepare('SELECT steps, extra FROM project_config WHERE project_key = ?').get(key) || null; } catch { return null; } });
  const extra = () => once('extra', () => parseObj(row()?.extra));
  const fields = () => once('team', () => { if (!key) return {}; try { const policy = cachedPolicyForKey(key); return policy ? fieldsForRun(policy.doc) || {} : {}; } catch { return {}; } });
  return { key, projectLayer, projectDir: typeof selected.projectDir === 'string' ? selected.projectDir : null, settings: () => once('settings', readSettings),
    projectSettings: () => isObj(extra().settings) ? extra().settings : {}, nightProject: () => isObj(extra().nightMode) ? extra().nightMode : null,
    stepsRow: () => once('steps', () => parseObj(row()?.steps)), teamValue: (teamKey) => fields()[teamKey]?.kind === 'default' ? fields()[teamKey].value : undefined };
}
const warned = new Set();
const WHERE = { project: 'project settings', user: 'settings.json', team: 'the team policy' };
function layerValue(entry, layer, raw, ctx) {
  if (raw === undefined) return undefined;
  let valid = false;
  try { valid = !!entry.validate(raw, layer, ctx); } catch {}
  if (valid) return raw;
  const key = `${entry.id}|${layer}|${JSON.stringify(raw)}`;
  if (!warned.has(key)) { warned.add(key); console.warn(`[worca] ignoring invalid ${entry.id} ${JSON.stringify(raw)} in ${WHERE[layer]} — the next layer applies`); }
  return undefined;
}
const safeRead = (reader, ctx) => { try { return reader ? reader(ctx) : undefined; } catch { return undefined; } };
function resolveWith(entry, ctx) {
  const layers = { project: entry.userOnly || !ctx.projectLayer ? undefined : layerValue(entry, 'project', safeRead(entry.readProject, ctx), ctx),
    user: layerValue(entry, 'user', safeRead(entry.readUser, ctx), ctx), team: !ctx.key ? undefined : layerValue(entry, 'team', safeRead(entry.team, ctx), ctx), default: entry.default };
  for (const source of LAYERS) if (layers[source] !== undefined) return { value: layers[source], source, layers };
  return { value: entry.default, source: 'default', layers };
}
const entryOrThrow = (id) => { const entry = settingEntry(id); if (!entry) throw new Error(`unknown setting "${id}"`); return entry; };
export function resolveSetting(id, scope = null) { return resolveWith(entryOrThrow(id), makeCtx(scope)); }
export function resolveMany(ids, scope = null) { const ctx = makeCtx(scope); return Object.fromEntries(ids.map((id) => [id, resolveWith(entryOrThrow(id), ctx)])); }
export function resolveAll(scope = null, { roles = [] } = {}) { return resolveMany(settingIds({ roles }), scope); }
setProjectLayerReader((id, scope) => { const entry = settingEntry(id); if (!entry || entry.userOnly) return undefined; const ctx = makeCtx(scope); return ctx.projectLayer ? layerValue(entry, 'project', safeRead(entry.readProject, ctx), ctx) : undefined; });

const badPatch = (message) => Object.assign(new Error(message), { status: 400 });
function setPath(object, path, value) {
  const [head, ...rest] = path;
  if (!rest.length) { if (value === null) delete object[head]; else object[head] = value; return; }
  const child = isObj(object[head]) ? { ...object[head] } : {};
  setPath(child, rest, value);
  if (Object.keys(child).length) object[head] = child; else delete object[head];
}
export function assertProjectSettingsPatch(patch, { roles = null } = {}) {
  if (!isObj(patch)) throw badPatch('project settings must be an object of setting id → value (null clears it)');
  const out = [];
  for (const [id, raw] of Object.entries(patch)) {
    const entry = settingEntry(id);
    if (!entry) throw badPatch(`unknown setting "${id}"`);
    if (entry.userOnly) throw badPatch(`${id} is set per user, not per project`);
    if (entry.family === 'steps' && Array.isArray(roles) && !roles.includes(entry.role)) throw badPatch(`${id}: unknown step "${entry.role}"`);
    if (raw === null) { out.push({ entry, value: null }); continue; }
    let value = raw;
    if (entry.family) {
      try { value = normalizeModelPair(entry.engine, raw, id); } catch (error) { throw badPatch(error.message); }
    } else if (entry.id === 'askWeb') {
      try { value = askWebStoreShape(assertAskWebInput(raw)); } catch (error) { throw badPatch(`askWeb: ${error.message}`); }
    } else if (entry.store === 'nightMode') {
      const field = entry.path[0];
      const error = field === 'spendCapUsd' ? 'spendCapUsd is set per user, not per project (it spans all runs)' : nightFieldError(field, raw);
      if (error) throw badPatch(`${id}: ${error}`);
    } else if (!entry.validate(raw, 'project')) throw badPatch(`${id} ${entry.hint}`);
    out.push({ entry, value });
  }
  return out;
}
export function writeProjectSettings(scope, patch, { roles = null } = {}) {
  const items = assertProjectSettingsPatch(patch, { roles });
  const key = makeCtx(scope).key;
  if (!key) throw badPatch('project settings need a project (workspace runs have no project layer)');
  tx(() => {
    const row = prepare('SELECT steps, extra FROM project_config WHERE project_key = ?').get(key);
    const extra = parseObj(row?.extra);
    const steps = parseObj(row?.steps);
    const settings = isObj(extra.settings) ? { ...extra.settings } : {};
    const night = isObj(extra.nightMode) ? { ...extra.nightMode } : {};
    for (const { entry, value } of items) {
      if (entry.store === 'steps') {
        const keep = isObj(steps[entry.role]) ? { ...steps[entry.role] } : {};
        delete keep.model; delete keep.effort;
        const next = value === null ? keep : { ...value, ...keep };
        if (Object.keys(next).length) steps[entry.role] = next; else delete steps[entry.role];
      } else if (entry.store === 'nightMode') {
        if (value === null) delete night[entry.path[0]]; else night[entry.path[0]] = value;
      } else setPath(settings, entry.path, value);
    }
    if (Object.keys(settings).length) extra.settings = settings; else delete extra.settings;
    if (Object.keys(night).length) extra.nightMode = night; else delete extra.nightMode;
    prepare(`INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra) VALUES (?, ?, '[]', NULL, ?)
      ON CONFLICT(project_key) DO UPDATE SET steps = excluded.steps, extra = excluded.extra`).run(key, JSON.stringify(steps), JSON.stringify(extra));
  });
}

export function hasProjectSetting(id, scope) {
  const entry = settingEntry(id);
  if (!entry || entry.userOnly) return false;
  const ctx = makeCtx(scope);
  return ctx.projectLayer && layerValue(entry, 'project', safeRead(entry.readProject, ctx), ctx) !== undefined;
}

export function resolveRunEngine({ explicit = null, projectDir = null, projectKey = null, workspace = false } = {}) {
  if (typeof explicit === 'string' && explicit.trim()) return { engine: explicit.trim(), source: 'run' };
  const result = resolveSetting('run.engine', { projectDir, projectKey, workspace });
  return { engine: result.value, source: result.source };
}
export function resolvedModelPair(engine, family, name, scope = null) {
  return resolveSetting(`models.${engine}.${family}.${name}`, scope).value;
}
export function scopeForRunKey(key) {
  if (typeof key !== 'string' || !key) return null;
  return key.startsWith('workspaces/') ? { workspace: true } : { projectKey: key };
}
/** The slot of `job` on `engine`. An engine without helper slots (Cursor) gets an empty one, never Claude's: the
 *  memory defrag and the workspace scan run ON that engine, and a helper caller passes helperEngineFor(engine). */
export function utilityModelFor(engine, job, scope = null) {
  // Copilot has no helper-model slots: its helper jobs run copilot's own default model.
  if (engine === 'copilot') return { model: null, effort: null, source: 'default' };
  const e = engine || 'claude';
  const entry = HELPER_ENGINES.includes(e) ? settingEntry(utilityId(e, job)) : null;
  if (!entry) return { model: null, effort: null, source: 'default' };
  const result = resolveWith(entry, makeCtx(scope)); const value = result.value || {};
  return { model: value.model || null, effort: value.effort || null, source: result.source };
}
export function defragSlotPair(engine, projectDir = null) {
  const slot = utilityModelFor(engine, 'memoryDefrag', projectDir ? { projectDir } : null);
  return { model: slot.model, effort: slot.effort };
}
export function nightRawLayers(projectDir) {
  const ctx = makeCtx(projectDir ? { projectDir } : null);
  const team = {};
  if (ctx.key) for (const field of NIGHT_FIELDS) {
    const value = safeRead((c) => c.teamValue(`night.${field}`), ctx);
    if (value !== undefined) team[field] = value;
  }
  let user = null;
  try { user = nightModeSettings(); } catch {}
  return { project: ctx.nightProject(), user, team };
}
