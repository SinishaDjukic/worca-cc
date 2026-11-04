// src/core/ask/settings-registry.mjs
// worca Chat P2 (U4): the settings the chat may read (list_settings) and change (change_setting), each change a
// receipt the user can revert (R6). ONE table: id, label, group, scope, the stored "unit" a Revert writes back, the
// Settings page's own validators, and the write — one POST /api/settings key (user scope) or one
// PATCH /api/projects/:key/settings entry (project scope), through the functions those routes share
// (deps.applyUser / deps.applyProject, ui/server.mjs). The MCP child's copy has no writers: it lists and checks.
// No I/O here — every reader and writer comes in through deps.
import {
  assertThemeInput, assertUiLevelInput, assertDebugSpawnInput, assertUpdateCheckInput, assertAutoGeneratePrDescriptionInput, assertCostLimitInputs,
  assertHumanRateInput, assertAskLimitInputs, assertAskEngineInput, assertRunEngineInput, assertSyncSettingsInput,
  assertScheduleDefaultsInput, assertWorkspaceScanInput, assertMemoryDefragModelInput, assertAgentGenModelInput, assertNamingModelInput, normalizeModelPair, normalizeRolePair,
  SETTINGS_POST_KEYS, DEFAULT_SYNC_SETTINGS, DEFAULT_SCHEDULE_GRACE_MIN, DEFAULT_SCHEDULE_IF_MISSED,
  DEFAULT_SCHEDULE_MAX_FAILURES, DEFAULT_COST_RESET_PERIOD, DEFAULT_HUMAN_RATE_USD, DEFAULT_ASK_MAX_TURNS,
} from '../settings.mjs';
import { RUN_ENGINES, MODEL_ENGINES, ASK_ENGINES, EFFORTS, SUBAGENT_MODELS, effortsForEngine } from '../model-env.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { MODEL_ROLES, ROLE_LABELS, ROLE_HARNESSES } from '../../shared/model-roles.mjs';
import { receiptCard } from './receipt.mjs';

/** What the chat never reads or changes, and why (list_settings returns `what`; a refused change names `why`). */
export const SETTING_EXCLUSIONS = Object.freeze([
  { match: ['root', 'projectsRoot'], what: 'Worca and projects root folders', why: 'folders widen what can be browsed' },
  { match: ['actions'], what: 'Actions (editor, terminal, ports, checkouts)', why: 'they hold commands run as the server user — the actions card changes them' },
  { match: ['askWeb', 'chat.scriptTools'], what: "Chat web access and the chat's script tools", why: "the chat's own powers are only the user's to grant" },
  { match: ['chat.channels'], what: 'Chat channels', why: 'they send messages to another service' },
  { match: ['nightMode', 'nightModeToggle'], what: 'Away mode settings', why: 'Away mode keeps its own card (propose_away_mode_change) and switch (set_away_now)' },
  { match: ['providers', 'models', 'speech', 'credentials', 'mcp', 'plugins', 'marketplaces'], what: 'Providers, model catalog entries, speech, credentials, MCP servers and plugins', why: 'they hold keys and tokens, or run outside code' },
  { match: ['policy', 'metrics'], what: 'Team policy and team metrics', why: 'they publish to the team' },
  { match: ['memory.team'], what: 'Team memory sharing', why: 'it publishes to the team' },
  { match: ['guardrails'], what: 'Guardrail sets', why: 'editing a set can loosen it' },
  { match: ['hideBuiltinModels'], what: 'Hide built-in models', why: 'once set it overrides the team default, and a Revert could not bring that back — the Models page sets it' },
]);
const exclusionOf = (id) => SETTING_EXCLUSIONS.find((e) => e.match.some((m) => id === m || id.startsWith(`${m}.`))) || null;
const WRITE_NEVER = new Set(['root', 'projectsRoot', 'actions']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const canon = (v) => (Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
/** The same stored value? undefined and null both mean unset; key order never matters. */
export const sameValue = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const ownKey = (s, key) => (Object.prototype.hasOwnProperty.call(s, key) && s[key] !== undefined ? s[key] : null);
const fail = (message) => { throw new Error(message); };
const usd = (none) => (v) => (v == null ? none : `$${Number(v).toFixed(2)}`);
const onOff = (v) => (v === true ? 'On' : v === false ? 'Off' : '—');
const pairText = (p) => (isObj(p) && (p.model || p.effort) ? [p.model || 'Model default', p.effort].filter(Boolean).join(' · ') : 'Default');
const minutes = (m) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`);
const bytes = (n) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024} KB` : `${n} bytes`);
const choice = (pairs) => {
  const values = pairs.map(([value, label]) => ({ value, label }));
  return { values, fmt: (v) => (values.find((x) => x.value === v) || { label: v == null ? 'Default' : String(v) }).label,
    allowed: values.map((x) => JSON.stringify(x.value)).join(' | ') };
};
const THEME = choice([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]);
const LEVEL = choice([['simple', 'Simple'], ['advanced', 'Advanced'], ['expert', 'Expert']]);
const PERIOD = choice([['weekly', 'Weekly'], ['monthly', 'Monthly']]);
const DIVERGED = choice([['ask', 'Ask me'], ['origin', 'Start from origin'], ['fail', "Don't run"]]);
const MISSED = choice([['run', 'Start it late'], ['skip', 'Skip it']]);
const MOUNT = choice([['copy', 'Copy'], ['symlink', 'Link']]);
const RUN_ENGINE = choice(RUN_ENGINES.map((e) => [e, engineLabel(e)]));
const CHAT_ENGINE = choice(ASK_ENGINES.map((e) => [e, engineLabel(e)]));
const NOTIFY = Object.freeze({ question: 'Approval / question needed', done: 'Run finished', error: 'Run failed', paused: 'Run paused', away: 'Away hours start or end' });
const JOBS = Object.freeze({ title: 'Title model', classifier: 'Auto workflow classifier model', overview: 'Run overview model', prDescription: 'PR description model', memoryDefrag: 'Memory defragment model', workspaceScan: 'Workspace scan model' });
const CLAUDE_HELPER_KEYS = Object.freeze({ title: 'titleModel', classifier: 'autoWorkflowModel', prDescription: 'prDescriptionModel' });
const CODEX_JOBS = Object.freeze(['title', 'classifier', 'overview', 'prDescription', 'memoryDefrag', 'workspaceScan']);
const RUN_JOBS = new Set(['title', 'classifier', 'overview', 'prDescription']);
const AGENT_GEN_ID = 'models.claude.utility.agentGen';
const NAMING_ID = 'models.claude.utility.naming';
const SCAN_FIELDS = Object.freeze({
  scanModel: { label: 'Workspace scan: scan agent model', allowed: 'a model id from list_models' },
  scanEffort: { label: 'Workspace scan: scan agent effort', allowed: EFFORTS.map((e) => JSON.stringify(e)).join(' | ') },
  agentModel: { label: 'Workspace scan: project agents model', allowed: SUBAGENT_MODELS.map((e) => JSON.stringify(e)).join(' | ') },
  agentEffort: { label: 'Workspace scan: project agents effort', allowed: EFFORTS.map((e) => JSON.stringify(e)).join(' | ') },
});
const PROJECT_ONLY = Object.freeze({
  contextMaxBytesPerFile: { label: 'Context size per file', group: 'Runs', fmt: bytes, allowed: 'a whole number of bytes' },
  contextMaxBytesTotal: { label: 'Context size in all', group: 'Runs', fmt: bytes, allowed: 'a whole number of bytes' },
  skillMount: { label: 'Skill mount', group: 'Runs', fmt: MOUNT.fmt, allowed: MOUNT.allowed },
  watchNewPrs: { label: 'Watch new pull requests', group: 'Runs', fmt: onOff, allowed: 'true | false' },
  runUserClaudeSettings: { label: 'Runs load my Claude Code setup', group: 'Runs', fmt: onOff, allowed: 'true | false' },
  'memory.softBytesPerFile': { label: 'Memory: flag files above', group: 'Memory', fmt: bytes, allowed: 'a whole number of bytes' },
  'memory.maxBytesPerFile': { label: 'Memory: largest file', group: 'Memory', fmt: bytes, allowed: 'a whole number of bytes' },
  'memory.teamMaxFiles': { label: 'Memory: most team notes loaded', group: 'Memory', fmt: String, allowed: 'a whole number' },
  'memory.maxFilesPerScope': { label: 'Memory: most files', group: 'Memory', fmt: String, allowed: 'a whole number' },
  'memory.hookMaxChars': { label: 'Memory: hook length', group: 'Memory', fmt: (n) => `${n} characters`, allowed: 'a whole number of characters' },
  'memory.defrag.writes': { label: 'Memory defragment due after writes', group: 'Memory', fmt: String, allowed: 'a whole number' },
  'memory.defrag.files': { label: 'Memory defragment due at files', group: 'Memory', fmt: String, allowed: 'a whole number' },
  'memory.defrag.bytesPct': { label: 'Memory defragment due at size', group: 'Memory', fmt: (n) => `${n}%`, allowed: 'a whole number 1–100' },
  'memory.defrag.alwaysOnBytes': { label: 'Memory defragment due at always-on size', group: 'Memory', fmt: bytes, allowed: 'a whole number of bytes' },
});

const pairAllowed = (engine) => `{"model": a model from list_models that runs on ${engineLabel(engine)}${effortsForEngine(engine).length ? `, "effort": ${effortsForEngine(engine).map((e) => JSON.stringify(e)).join(' | ')}` : ''}}`;
/** A {model, effort} slot: the shape check, then the catalog (the model exists, runs on that engine, offers that effort). */
const pairCheck = (engine) => async (v, ctx) => {
  const pair = normalizeModelPair(engine, v, ctx.def.id);
  if (pair) await ctx.slot([{ id: ctx.def.id, engine, value: pair }]);
  return pair;
};
/** A model role: the model must exist and run on the harness; its effort is any reasoning level, mapped when used (A7). */
const roleCheck = (engine) => async (v, ctx) => {
  const pair = normalizeRolePair(v, ctx.def.id);
  if (pair) await ctx.slot([{ id: ctx.def.id, engine, value: { model: pair.model } }]);
  return pair;
};

/** A user-scope setting. unit = what settings.json holds for it (null = unset): the receipt's raw before/after and
 *  what a Revert writes back. get/put map a unit several settings share (the workspace scan pick) to this one. */
function userDef(spec) {
  return { scope: 'user', get: (unit) => unit, put: (_unit, v) => v, dflt: null, ...spec };
}
const topKey = (key) => ({ read: (s) => ownKey(s, key), body: (unit) => ({ [key]: unit ?? '' }) });
/** A stored slot read as its {model, effort} only: a hand-edited extra field never reaches a reply or a Revert. */
const pickPair = (p) => (p ? Object.fromEntries(['model', 'effort'].filter((k) => Object.hasOwn(p, k)).map((k) => [k, p[k]])) : null);
const pairDef = (id, label, group, engine, read, body) => userDef({ id, label, group, read: (s) => pickPair(read(s)), body, fmt: pairText, allowed: pairAllowed(engine), check: pairCheck(engine) });

function buildUserDefs(roles, scanDefaults) {
  const defs = [
    userDef({ id: 'theme', label: 'Theme', group: 'General', ...topKey('theme'), dflt: 'system', fmt: THEME.fmt, allowed: THEME.allowed,
      check: (v) => { assertThemeInput(v); return v === 'system' ? null : v; } }),
    userDef({ id: 'uiLevel', label: 'Interface mode', group: 'General', ...topKey('uiLevel'), fmt: LEVEL.fmt, allowed: LEVEL.allowed,
      check: (v) => { assertUiLevelInput(v); return v ?? null; } }),
    userDef({ id: 'debugSpawnEnabled', label: 'Spawn diagnostics', group: 'General', read: (s) => ownKey(s, 'debugSpawnEnabled'),
      body: (unit) => ({ debugSpawnEnabled: unit === true }), dflt: false, fmt: onOff, allowed: 'true | false',
      check: (v) => { if (v == null) return null; assertDebugSpawnInput(v); return v === false ? null : v; } }),
    userDef({ id: 'updateCheck', label: 'Check for new Worca versions', group: 'General', read: (s) => ownKey(s, 'updateCheck'),
      body: (unit) => ({ updateCheck: unit !== false }), dflt: true, fmt: onOff, allowed: 'true | false',
      check: (v) => { if (v == null) return null; assertUpdateCheckInput(v); return v === true ? null : v; } }),
    userDef({ id: 'autoGeneratePrDescription', label: 'Draft the PR description with AI automatically', group: 'General', read: (s) => ownKey(s, 'autoGeneratePrDescription'),
      body: (unit) => ({ autoGeneratePrDescription: unit === true }), dflt: false, fmt: onOff, allowed: 'true | false',
      check: (v) => { if (v == null) return null; assertAutoGeneratePrDescriptionInput(v); return v === false ? null : v; } }),
    userDef({ id: 'pipelineCostLimitUsd', label: 'Per-pipeline cost limit', group: 'Runs', ...topKey('pipelineCostLimitUsd'), fmt: usd('No limit'), allowed: 'a positive amount in USD',
      check: (v) => { assertCostLimitInputs({ pipelineCostLimitUsd: v ?? '' }); return v ?? null; } }),
    userDef({ id: 'totalCostLimitUsd', label: 'Total cost limit', group: 'Runs', ...topKey('totalCostLimitUsd'), fmt: usd('No limit'), allowed: 'a positive amount in USD',
      check: (v) => { assertCostLimitInputs({ totalCostLimitUsd: v ?? '' }); return v ?? null; } }),
    userDef({ id: 'costLimitResetPeriod', label: 'Cost limit reset period', group: 'Runs', ...topKey('costLimitResetPeriod'), dflt: DEFAULT_COST_RESET_PERIOD, fmt: PERIOD.fmt, allowed: PERIOD.allowed,
      check: (v) => { assertCostLimitInputs({ costLimitResetPeriod: v ?? '' }); return v ?? null; } }),
    userDef({ id: 'humanRateUsdPerHour', label: 'Developer rate', group: 'Runs', ...topKey('humanRateUsdPerHour'), dflt: DEFAULT_HUMAN_RATE_USD, fmt: (v) => `$${Number(v)}/h`, allowed: 'a positive amount in USD per hour',
      check: (v) => { assertHumanRateInput(v ?? ''); return v ?? null; } }),
    ...[['beforeRun', 'Sync before run', onOff, 'true | false'], ['onDiverged', 'If the source branch has diverged', DIVERGED.fmt, DIVERGED.allowed],
      ['remote', 'Sync remote', String, 'a remote name such as "origin"'],
      ['refreshMinutes', 'Check remotes in the background', (v) => (v === 0 ? 'Off' : v === 60 ? 'Every hour' : `Every ${v} minutes`), 'whole minutes 0–1440 (0 = off)']]
      .map(([k, label, fmt, allowed]) => userDef({ id: `sync.${k}`, label, group: 'Runs', fmt, allowed, dflt: DEFAULT_SYNC_SETTINGS[k],
        read: (s) => (isObj(s.sync) && Object.prototype.hasOwnProperty.call(s.sync, k) ? s.sync[k] : null),
        body: (unit) => ({ sync: { [k]: unit ?? null } }),
        check: (v) => { assertSyncSettingsInput({ [k]: v ?? null }); return v ?? null; } })),
    ...[['ifMissed', 'scheduleIfMissed', 'If worca is not running at that time', MISSED.fmt, MISSED.allowed, DEFAULT_SCHEDULE_IF_MISSED],
      ['graceMin', 'scheduleGraceMin', 'At most this late', minutes, 'whole minutes 0–10080', DEFAULT_SCHEDULE_GRACE_MIN],
      ['maxFailures', 'scheduleMaxFailures', 'Pause a repeating schedule after failures in a row', (v) => (v === 0 ? 'Never' : String(v)), 'a whole number 0–100 (0 = never)', DEFAULT_SCHEDULE_MAX_FAILURES]]
      .map(([k, key, label, fmt, allowed, dflt]) => userDef({ id: `schedule.${k}`, label, group: 'Runs', fmt, allowed, dflt,
        read: (s) => ownKey(s, key), body: (unit) => ({ schedule: { [k]: unit ?? null } }),
        check: (v) => { assertScheduleDefaultsInput({ [k]: v ?? null }); return v ?? null; } })),
    ...Object.entries(SCAN_FIELDS).map(([f, { label, allowed }]) => userDef({ id: `workspaceScan.${f}`, label, group: 'Runs', allowed,
      fmt: f === 'scanEffort' ? (v) => v || 'Model default' : String,
      read: (s) => (isObj(s.workspaces) && isObj(s.workspaces.scan) ? s.workspaces.scan : null),
      get: (unit) => (unit || scanDefaults)[f] ?? null,
      // null = this field's default (list_settings promises "null (default)"); all four at their defaults = unset.
      put: (unit, v) => { const next = { ...(unit || scanDefaults), [f]: v ?? scanDefaults[f] }; return sameValue(next, scanDefaults) ? null : next; },
      body: (unit) => ({ workspaceScan: unit ?? null }),
      check: async (v, ctx) => { const pick = assertWorkspaceScanInput(ctx.def.put(ctx.unit, v), await ctx.models()); return pick ? pick[f] : null; } })),
    ...Object.entries(NOTIFY).map(([ev, words]) => userDef({ id: `chat.notify.${ev}`, label: `Chat notification: ${words}`, group: 'Runs', fmt: onOff, allowed: 'true | false',
      read: (s) => !(isObj(s.chat) && isObj(s.chat.notify) && s.chat.notify[ev] === false),
      body: (unit) => ({ chat: { notify: { [ev]: unit !== false } } }),
      check: (v) => (v == null ? true : typeof v === 'boolean' ? v : fail(`chat.notify.${ev} must be true or false`)) })),
    userDef({ id: 'askEngine', label: 'Engine for new chats', group: 'Chat', read: (s) => ownKey(s, 'askEngine'), body: (unit) => ({ askEngine: unit ?? null }),
      dflt: 'claude', fmt: CHAT_ENGINE.fmt, allowed: CHAT_ENGINE.allowed, check: (v) => assertAskEngineInput(v) }),
    ...ASK_ENGINES.map((e) => pairDef(`models.${e}.ask`, `Chat model (${engineLabel(e)})`, 'Chat', e,
      (s) => (isObj(s.askModels) && isObj(s.askModels[e]) ? s.askModels[e] : null), (unit) => ({ askModels: { [e]: unit ?? null } }))),
    userDef({ id: 'askMaxTurns', label: 'Turn limit', group: 'Chat', ...topKey('askMaxTurns'), dflt: DEFAULT_ASK_MAX_TURNS, fmt: String, allowed: 'a whole number 1–500',
      check: (v) => { assertAskLimitInputs({ askMaxTurns: v ?? '' }); return v ?? null; } }),
    // A STORED null is the Settings page's "No cap" tick: a value that outranks a team default (limits.mjs askLimits),
    // never unset — unit 'none', so a Revert writes the null back instead of clearing the key. The marker never leaves
    // unit / put / get / body: check() returns the model's own value (null), which the child hands the parent.
    userDef({ id: 'askMaxBudgetUsd', label: 'Per-turn cost cap', group: 'Chat', fmt: usd('No cap'), allowed: 'USD 0.1–100',
      read: (s) => (Object.prototype.hasOwnProperty.call(s, 'askMaxBudgetUsd') && s.askMaxBudgetUsd === null ? 'none' : ownKey(s, 'askMaxBudgetUsd')),
      get: (unit) => (unit === 'none' ? null : unit),
      put: (unit, v) => (v == null && unit === 'none' ? 'none' : v),
      body: (unit) => ({ askMaxBudgetUsd: unit === 'none' ? null : unit ?? '' }),
      check: (v) => { assertAskLimitInputs({ askMaxBudgetUsd: v ?? '' }); return v ?? null; } }),
    userDef({ id: 'models.claude.memoryDefrag', label: 'Memory defragment model', group: 'Memory', fmt: pairText, allowed: pairAllowed('claude'),
      read: (s) => {
        const d = isObj(s.memory) && isObj(s.memory.defrag) ? s.memory.defrag : null;
        return d && typeof d.model === 'string' && d.model.trim() ? { model: d.model.trim(), ...(typeof d.effort === 'string' && d.effort ? { effort: d.effort } : {}) } : null;
      },
      body: (unit) => ({ memoryDefrag: unit && unit.model ? { model: unit.model, effort: unit.effort || '' } : null }),
      check: async (v, ctx) => { const pair = assertMemoryDefragModelInput(v, await ctx.models()); return pair ? { model: pair.model, ...(pair.effort ? { effort: pair.effort } : {}) } : null; } }),
    userDef({ id: 'run.engine', label: 'Engine for new runs', group: 'Models', read: (s) => ownKey(s, 'runEngine'), body: (unit) => ({ runEngine: unit ?? null }),
      dflt: 'claude', fmt: RUN_ENGINE.fmt, allowed: RUN_ENGINE.allowed, check: (v) => assertRunEngineInput(v) }),
    ...MODEL_ENGINES.flatMap((e) => roles.map((r) => pairDef(`models.${e}.steps.${r.key}`, `${r.label || r.key} model (${engineLabel(e)})`, 'Models', e,
      (s) => (isObj(s.stepModels) && isObj(s.stepModels[e]) && isObj(s.stepModels[e][r.key]) ? s.stepModels[e][r.key] : null),
      (unit) => ({ stepModels: { [e]: { [r.key]: unit ?? null } } })))),
    ...ROLE_HARNESSES.flatMap((e) => MODEL_ROLES.map((r) => userDef({ id: `models.${e}.roles.${r}`, label: `${ROLE_LABELS[r]} role (${engineLabel(e)})`, group: 'Models',
      read: (s) => pickPair(isObj(s.modelRoles) && isObj(s.modelRoles[e]) && isObj(s.modelRoles[e][r]) ? s.modelRoles[e][r] : null),
      body: (unit) => ({ modelRoles: { [e]: { [r]: unit ?? null } } }),
      fmt: pairText, allowed: `a model ${engineLabel(e)} can run, with any effort`, check: roleCheck(e) }))),
    ...Object.entries(CLAUDE_HELPER_KEYS).map(([job, key]) => userDef({ id: `models.claude.utility.${job}`, label: `${JOBS[job]} (${engineLabel('claude')})`, group: 'Models',
      fmt: pairText, allowed: '{"model": a Claude model from list_models}',
      read: (s) => (typeof s[key] === 'string' && s[key].trim() ? { model: s[key].trim() } : null),
      body: (unit) => ({ [key]: unit && unit.model ? unit.model : '' }),
      check: async (v, ctx) => {
        if (v == null) return null;
        if (!isObj(v) || typeof v.model !== 'string' || !v.model.trim() || Object.keys(v).some((k) => k !== 'model')) fail(`${ctx.def.id} must be {"model": "<id>"} or null — this slot takes no effort`);
        const value = { model: v.model.trim() };
        await ctx.slot([{ id: ctx.def.id, engine: 'claude', value }]);
        return value;
      } })),
    // The agent wizard's Generate: always Claude and project-less, so user scope only (not a cascade id).
    userDef({ id: AGENT_GEN_ID, label: 'Agent generation model', group: 'Models', fmt: pairText, allowed: pairAllowed('claude'),
      read: (s) => (isObj(s.agentGenModel) && typeof s.agentGenModel.model === 'string' && s.agentGenModel.model.trim()
        ? { model: s.agentGenModel.model.trim(), ...(typeof s.agentGenModel.effort === 'string' && s.agentGenModel.effort ? { effort: s.agentGenModel.effort } : {}) } : null),
      body: (unit) => ({ agentGenModel: unit && unit.model ? { model: unit.model, effort: unit.effort || '' } : null }),
      check: async (v, ctx) => {
        const pair = assertAgentGenModelInput(v, await ctx.models());
        if (!pair) return null;
        const value = { model: pair.model, ...(pair.effort ? { effort: pair.effort } : {}) };
        await ctx.slot([{ id: ctx.def.id, engine: 'claude', value }]);   // in the catalog is not enough: it must run on Claude
        return value;
      } }),
    // Smart run naming's one call: always Claude and project-less, so user scope only (not a cascade id).
    userDef({ id: NAMING_ID, label: 'Run naming model', group: 'Models', fmt: pairText, allowed: pairAllowed('claude'),
      read: (s) => (isObj(s.namingModel) && typeof s.namingModel.model === 'string' && s.namingModel.model.trim()
        ? { model: s.namingModel.model.trim(), ...(typeof s.namingModel.effort === 'string' && s.namingModel.effort ? { effort: s.namingModel.effort } : {}) } : null),
      body: (unit) => ({ namingModel: unit && unit.model ? { model: unit.model, effort: unit.effort || '' } : null }),
      check: async (v, ctx) => {
        const pair = assertNamingModelInput(v, await ctx.models());
        if (!pair) return null;
        const value = { model: pair.model, ...(pair.effort ? { effort: pair.effort } : {}) };
        await ctx.slot([{ id: ctx.def.id, engine: 'claude', value }]);
        return value;
      } }),
    ...CODEX_JOBS.map((job) => pairDef(RUN_JOBS.has(job) ? `models.codex.utility.${job}` : `models.codex.${job}`, `${JOBS[job]} (${engineLabel('codex')})`, 'Models', 'codex',
      (s) => (isObj(s.utilityModels) && isObj(s.utilityModels.codex) && isObj(s.utilityModels.codex[job]) ? s.utilityModels.codex[job] : null),
      (unit) => ({ utilityModels: { codex: { [job]: unit ?? null } } }))),
  ];
  return defs;
}

const MODEL_ID_RE = new RegExp(`^models\\.(${MODEL_ENGINES.join('|')})\\.(?:steps\\.(.+)|utility\\.(title|classifier|overview|prDescription)|(memoryDefrag|workspaceScan))$`);
function buildProjectDefs(ids, userDefs, roles) {
  const twins = new Map(userDefs.map((d) => [d.id, d]));
  return ids.filter((id) => id !== 'askWeb' && id !== 'memory.team' && !id.startsWith('nightMode.')).map((id) => {
    const twin = twins.get(id) || null;
    const own = PROJECT_ONLY[id] || null;
    const m = MODEL_ID_RE.exec(id);
    const roleLabel = m && m[2] ? ((roles.find((r) => r.key === m[2]) || {}).label || m[2]) : null;
    const label = (own && own.label) || (twin && twin.label)
      || (m ? (roleLabel ? `${roleLabel} model (${engineLabel(m[1])})` : `${JOBS[m[3] || m[4]]} (${engineLabel(m[1])})`) : id);
    return {
      id, scope: 'project', label, group: (own && own.group) || (twin && twin.group) || 'Runs',
      fmt: (own && own.fmt) || (twin && twin.fmt) || (m ? pairText : String),
      allowed: (own && own.allowed) || (twin && twin.allowed) || (m ? pairAllowed(m[1]) : 'a value'),
      get: (unit) => unit, put: (_unit, v) => v, dflt: null,
      check: async (v, ctx) => {
        let item;
        // A cascade scalar with no hint words its refusal "<id> undefined": name what the setting takes instead.
        try { [item] = ctx.assertProject({ [id]: v }); }
        catch (err) { const m = String((err && err.message) || err); throw new Error(/ undefined$/.test(m) ? `${id} must be ${(own && own.allowed) || 'a valid value'}` : m); }
        if (item && item.entry && item.entry.family && item.value) await ctx.slot([{ id, engine: item.entry.engine, value: item.value }]);
        return item ? (item.value ?? null) : null;
      },
    };
  });
}

/** One settings.json writer at a time: every setter reads the file, then awaits its write, so two writes in flight
 *  at once each write back the file without the other's key. ui/server.mjs shares ONE queue between the registry
 *  and the Away switch (a turn's parallel set_away_now + change_setting). */
export function createWriteQueue() {
  let chain = Promise.resolve();
  return (fn) => { const p = chain.then(fn, fn); chain = p.then(() => {}, () => {}); return p; };
}

/**
 * @param {object} deps  see the header; applyUser / applyProject absent = a read-only registry (the MCP child)
 */
export function createSettingsRegistry(deps = {}) {
  const D = {
    readSettings: () => ({}), roles: () => [], listModels: async () => [], assertSlotModels: async () => {},
    resolveSetting: () => { throw new Error('no project settings here'); }, assertProjectSettingsPatch: () => [],
    projectSettingIds: () => [], projects: async () => [],
    scanDefaults: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' },
    applyUser: null, applyProject: null, serial: null, ...deps,
  };
  const roleList = () => { try { return (D.roles() || []).filter((r) => r && typeof r.key === 'string' && r.key); } catch { return []; } };
  const defsFor = (scope) => {
    const roles = roleList();
    const user = buildUserDefs(roles, D.scanDefaults);
    if (scope !== 'project') return user;
    let ids = [];
    try { ids = D.projectSettingIds(roles.map((r) => r.key)) || []; } catch { ids = []; }
    return buildProjectDefs(ids, user, roles);
  };
  const findDef = (id, scope) => defsFor(scope).find((d) => d.id === id) || null;
  const projectOf = async (key) => (await D.projects()).find((p) => p && p.key === key) || null;
  const ctxFor = (def, project, unit) => ({
    def, unit, project,
    models: () => D.listModels(project ? project.path : ''),
    slot: (items) => D.assertSlotModels(items, { projectDir: project ? project.path : '' }),
    assertProject: (patch) => D.assertProjectSettingsPatch(patch, { roles: roleList().map((r) => r.key) }),
  });
  const display = (def, value, unset, scope) => {
    const text = def.fmt(value);
    if (!unset) return text;
    if (scope === 'project') return `${text} (inherited)`;
    return value == null ? text : `${text} (default)`;
  };
  function current(def, project) {
    if (def.scope === 'project') {
      const r = D.resolveSetting(def.id, { projectDir: project.path });
      const own = r.layers.project === undefined ? null : r.layers.project;
      const unset = own === null;
      return { unit: own, unset, text: display(def, unset ? r.value : own, unset, 'project'), source: r.source,
        inherited: [r.layers.user, r.layers.team, r.layers.default].find((v) => v !== undefined) ?? null };   // a stored null is a value (the cascade's rule)
    }
    const unit = def.read(D.readSettings() || {});
    const unset = unit === null || unit === undefined;
    const value = unset ? (def.get(null) ?? def.dflt) : def.get(unit);
    return { unit: unset ? null : unit, unset, text: display(def, value, unset, 'user') };
  }
  const allowedText = (def, scope) => `${def.allowed} | null (${scope === 'project' ? 'inherited' : 'default'})`;

  async function list({ scope = 'user', projectKey = null, query = '' } = {}) {
    const project = scope === 'project' ? await projectOf(projectKey) : null;
    if (scope === 'project' && !project) throw new Error(`unknown project "${projectKey}"`);
    const q = String(query || '').trim().toLowerCase();
    const rows = [];
    for (const def of defsFor(scope)) {
      if (q && !def.id.toLowerCase().includes(q) && !def.label.toLowerCase().includes(q)) continue;
      let cur;
      try { cur = current(def, project); } catch { continue; }
      rows.push({ id: def.id, label: def.label, group: def.group, value: cur.text, stored: cur.unset ? null : def.get(cur.unit),
        ...(cur.source ? { source: cur.source } : {}), allowed: allowedText(def, scope) });
    }
    return { scope, ...(project ? { projectKey: project.key, project: project.name || project.key } : {}), settings: rows,
      excluded: SETTING_EXCLUSIONS.map((e) => e.what) };
  }

  /** The child's self-check and the parent's authoritative re-check: the same validators, over the current state. */
  async function check({ id, scope = 'user', projectKey = null, value } = {}) {
    if (scope !== 'user' && scope !== 'project') return { ok: false, error: 'scope must be "user" or "project"' };
    const sid = typeof id === 'string' ? id.trim() : '';
    let project = null;
    if (scope === 'project') {
      if (!projectKey) return { ok: false, error: 'scope "project" needs projectKey — list_projects gives it' };
      project = await projectOf(projectKey);
      if (!project) return { ok: false, error: `unknown project "${projectKey}"` };
    }
    const def = findDef(sid, scope);
    if (!def) {
      // A model slot id is never an exclusion (the 'models' entry is the catalog): a project-only slot or a typo.
      const slot = MODEL_ID_RE.test(sid) || ASK_ENGINES.some((e) => sid === `models.${e}.ask`) || sid === AGENT_GEN_ID || sid === NAMING_ID;
      const ex = slot ? null : exclusionOf(sid);
      if (ex) return { ok: false, error: `${sid} is not changed from the chat: ${ex.why}` };
      const projectOnly = scope === 'user' && findDef(sid, 'project') ? ' (it is set per project: scope "project")' : '';
      return { ok: false, error: `unknown setting "${sid}" — list_settings names the ones the chat can change${projectOnly}` };
    }
    let before;
    try { before = current(def, project); } catch (err) { return { ok: false, error: `${sid}: ${(err && err.message) || err}` }; }
    let next;
    try { next = await def.check(value === undefined || value === '' ? null : value, ctxFor(def, project, before.unit)); }
    catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    const unit = def.scope === 'project' ? (next ?? null) : def.put(before.unit, next ?? null);
    const unset = unit === null || unit === undefined;
    const afterValue = def.scope === 'project' ? (unset ? before.inherited : unit) : (unset ? (def.get(null) ?? def.dflt) : def.get(unit));
    return { ok: true, def, project, value: next ?? null, before: { unit: before.unit, text: before.text },
      after: { unit: unset ? null : unit, text: display(def, afterValue, unset, def.scope) } };
  }

  /** ONE known POST key, never root / projectsRoot / actions — an empty body would clear root (Review Focus 1). */
  function bodyFor(def, unit) {
    const body = def.body(unit);
    const keys = Object.keys(body || {});
    if (keys.length !== 1 || !SETTINGS_POST_KEYS.includes(keys[0]) || WRITE_NEVER.has(keys[0])) throw new Error(`${def.id}: refusing to write ${JSON.stringify(keys)}`);
    return body;
  }
  async function write(def, project, unit) {
    if (def.scope === 'project') {
      if (typeof D.applyProject !== 'function') throw new Error('settings are read-only here');
      return D.applyProject(project, { [def.id]: unit ?? null });
    }
    if (typeof D.applyUser !== 'function') throw new Error('settings are read-only here');
    return D.applyUser(bodyFor(def, unit));
  }

  async function apply(req) {
    const r = await check(req);
    if (!r.ok) return r;
    if (sameValue(r.before.unit, r.after.unit)) return { ok: true, unchanged: true, notice: `${r.def.label} is already ${r.before.text}` };
    try { await write(r.def, r.project, r.after.unit); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    let now = r.after;
    try { now = current(r.def, r.project); } catch { /* the write landed; show what was asked */ }
    return { ok: true, card: receiptCard({
      kind: 'setting', label: r.def.label,
      target: { settingId: r.def.id, scope: r.def.scope, ...(r.project ? { projectKey: r.project.key, title: r.project.name || r.project.key } : {}) },
      before: r.before.text, after: now.text, raw: { before: r.before.unit, after: now.unit }, revertible: true,
    }) };
  }

  async function revert(card) {
    const t = (card && card.target) || {};
    const raw = (card && card.raw) || {};
    const scope = t.scope === 'project' ? 'project' : 'user';
    const def = findDef(t.settingId, scope);
    if (!def) return { ok: false, code: 'NOT_REVERTIBLE', error: 'This setting can no longer be changed from the chat' };
    let project = null;
    if (scope === 'project') {
      project = await projectOf(t.projectKey);
      if (!project) return { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — the project is no longer registered' };
    }
    let now;
    try { now = current(def, project); } catch (err) { return { ok: false, code: 'REVERT_FAILED', error: String((err && err.message) || err) }; }
    if (!sameValue(now.unit, raw.after)) return { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' };
    try { await write(def, project, raw.before ?? null); } catch (err) { return { ok: false, code: 'REVERT_FAILED', error: String((err && err.message) || err) }; }
    return { ok: true, notice: `Reverted: ${card.label}${scope === 'project' && t.title ? ` (${t.title})` : ''} back to ${card.before}` };
  }

  // One change at a time: every setter reads settings.json, then awaits its write, so two changes in flight at once
  // (a turn's parallel change_setting calls, two Revert clicks) would each write back the file without the other's key.
  const serial = typeof D.serial === 'function' ? D.serial : createWriteQueue();

  return { list, check, apply: (req) => serial(() => apply(req)), revert: (card) => serial(() => revert(card)), defsFor };
}
