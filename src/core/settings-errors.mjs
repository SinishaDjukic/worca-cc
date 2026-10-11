// POST /api/settings answers (#555): { error: <the user's words>, field: <body path> | null }.
// The src/core validators keep their messages (core tests and the CLI pin them); this maps
// a validator's message, given the body key being validated, to a sentence that names the
// visible label instead of an internal key, plus the path a Settings input carries in
// data-setting.
import { FIELD_LABELS as AWAY_LABELS } from '../shared/away-mode/labels.mjs';

/** Visible labels, keyed by body path. Each must equal the text the Settings UI shows. */
export const SETTINGS_FIELD_LABELS = Object.freeze({
  root: 'Worca root folder',
  projectsRoot: 'Projects root folder',
  pipelineCostLimitUsd: 'Per-pipeline cost limit',
  totalCostLimitUsd: 'Total cost limit',
  costLimitResetPeriod: 'Reset period',
  humanRateUsdPerHour: 'Developer rate',
  askMaxTurns: 'Turn limit',
  askMaxBudgetUsd: 'Per-turn cost cap',
  askWeb: 'Web access',
  'askWeb.enabled': 'Web access',
  'askWeb.anyHost': 'Web access',
  'askWeb.allowedDomains': 'Allowed domains',
  'askWeb.search': 'Search endpoint',
  'askWeb.search.url': 'Search endpoint',
  'askWeb.search.key': 'Search key variable',
  'askWeb.search.keyHeader': 'Key header',
  'askWeb.search.keyPrefix': 'Key prefix',
  debugSpawnEnabled: 'Spawn diagnostics',
  titleModel: 'Title generation model',
  autoWorkflowModel: 'Auto workflow model',
  prDescriptionModel: 'PR description model',
  memoryDefrag: 'Defragment model',
  'memoryDefrag.model': 'Defragment model',
  'memoryDefrag.effort': 'Effort',
  workspaceScan: 'Workspace scan models',
  'workspaceScan.scanModel': 'Scan agent',
  'workspaceScan.scanEffort': 'Effort',
  'workspaceScan.agentModel': 'Project agents',
  'workspaceScan.agentEffort': 'Effort',
  schedule: 'Scheduled runs',
  'schedule.graceMin': 'At most this late',
  'schedule.ifMissed': 'If Worca is not running at that time',
  'schedule.maxFailures': 'Pause a repeating schedule after failures in a row',
  sync: 'Sync before run',
  'sync.beforeRun': 'Sync the source branch before each run',
  'sync.remote': 'Remote',
  'sync.refreshMinutes': 'Check remotes in the background',
  'sync.onDiverged': 'If the source branch has diverged',
  actions: 'Actions',
  'actions.keep': 'Keep checkouts',
  'actions.portLow': 'Low port',
  'actions.portHigh': 'High port',
  'actions.maxCheckouts': 'Keep at most',
  'actions.editor': 'Editor',
  'actions.terminal': 'Terminal',
  nightMode: 'Away mode',
  ...Object.fromEntries(Object.entries(AWAY_LABELS).map(([k, v]) => [`nightMode.${k}`, v.label])),
  nightModeToggle: 'Away mode',
  theme: 'Theme',
  uiLevel: 'Interface mode',
  hideBuiltinModels: 'Hide built-in models',
  chat: 'Chat notifications',
  runEngine: 'Default engine',
  stepModels: 'Step models',
  utilityModels: 'Helper models',
  askEngine: 'Engine for new chats',
  askModels: 'Chat model',
});

// Stored-key spellings the schedule setter uses in its messages.
const ALIASES = { scheduleGraceMin: 'schedule.graceMin', scheduleIfMissed: 'schedule.ifMissed', scheduleMaxFailures: 'schedule.maxFailures' };

// Whole-message rewrites: [regex, field | (m) => field | null (= ctx), text | (m) => text].
const SPECIAL = [
  [/^askMaxBudgetUsd must be null \(no cap\) or a number between 0\.1 and 100$/, 'askMaxBudgetUsd',
    '“Per-turn cost cap” must be a number from 0.1 to 100, or tick No cap.'],
  [/^actions: the low port must not be above the high port$/, 'actions.portRange', 'The low port can’t be higher than the high port.'],
  [/^The (editor|terminal) command must be text of at most 2000 characters$/, (m) => `actions.${m[1]}`,
    (m) => `The ${m[1]} command must be at most 2000 characters.`],
  [/^unknown model "(.+)" — (?:pick one from the catalog|add it to the catalog first)$/, null,
    (m) => `The model “${m[1]}” is not in the catalog. Pick another one.`],
  [/^utilityModels\.claude: Claude's helper models are /, 'utilityModels.claude',
    'Claude’s helper models are set in Title generation model, Auto workflow model, PR description model and Defragment model.'],
  [/^path does not exist$/, null, 'That folder does not exist.'],
  [/^path is not a directory$/, null, 'That path is not a folder.'],
  [/^cannot use this folder as the Worca CC root: (.*)$/, null, (m) => `This folder can’t be the Worca root: ${m[1]}`],
  [/^([\w.]+)(?: prefs)? must be an object$/, (m) => ALIASES[m[1]] || m[1],
    (m) => `${quote(labelOf(ALIASES[m[1]] || m[1]) || 'This setting')} got a value Worca can’t read. Reload the page and try again.`],
];

// An internal key that must never reach the user: camelCase (askMaxTurns) or a dotted path
// under a settings key (sync.remote). Plain dotted text ("e.g.", "worca.dev") is fine.
const INTERNAL_KEY = /\b[a-z]+[A-Z][a-z]\w*\b|\b(?:askWeb|memoryDefrag|workspaceScan|nightMode|actions|sync|schedule|criteria|chat|search)\.\w+/;
const VERB = /^(?:must|is|are|needs?|has|have|holds?|cannot|can’t|can't|should)\b/;

const labelOf = (path) => SETTINGS_FIELD_LABELS[path] || null;
const quote = (label) => `“${label}”`;
// Capitalise only a plain lowercase word, never an id such as claude-sonnet-4-5 or a.b.
const sentence = (s) => {
  const t = String(s).trim();
  const u = /^[a-z]+\b(?![-.\d_])/.test(t) ? t[0].toUpperCase() + t.slice(1) : t;
  return /[.!?…]$/.test(u) ? u : `${u}.`;
};
const safe = (text, path, ctx) => (INTERNAL_KEY.test(text)
  ? sentence(`${quote(labelOf(path) || labelOf(ctx) || 'This setting')} has a value Worca can’t use`)
  : text);

/**
 * @param {Error|string} err  what the validator / setter threw
 * @param {string|null} ctx   the body key being validated (e.g. 'actions', 'askMaxTurns'); null
 *                            when the failure did not come from a validator (I/O and the like)
 * @returns {{ error: string, field: string|null }}
 */
export function settingsErrorReply(err, ctx) {
  const raw = String((err && err.message) || err || 'invalid setting');
  // No validator context: not a bad value. Say what failed, verbatim, with no field.
  if (!ctx) return { error: sentence(`Settings were not saved: ${raw}`), field: null };
  for (const [re, f, text] of SPECIAL) {
    const m = re.exec(raw);
    if (!m) continue;
    const field = (typeof f === 'function' ? f(m) : f) || ctx;
    return { error: safe(sentence(typeof text === 'function' ? text(m) : text), field, ctx), field };
  }
  // "<token>[:] <rest>" where token is the context key, a path under it, or a schedule alias.
  const m = /^([A-Za-z_]\w*(?:\.\w+)*)(:?)\s+(.*)$/.exec(raw);
  if (m) {
    const token = ALIASES[m[1]] || m[1];
    if (token === ctx || token.startsWith(`${ctx}.`)) {
      const leaf = token.split('.').pop();
      // "nightMode.maxDecisions: maxDecisions must…" → "must…"
      const rest = m[2] && m[3].startsWith(`${leaf} `) ? m[3].slice(leaf.length + 1) : m[3];
      const label = labelOf(token) || labelOf(ctx);
      const body = rest.replace(/\s+\|\s+/g, ', ');
      const text = !label ? body : VERB.test(body) ? `${quote(label)} ${body}` : `${quote(label)}: ${body}`;
      return { error: safe(sentence(text), token, ctx), field: token };
    }
  }
  return { error: safe(sentence(raw), ctx, ctx), field: ctx };
}

/** Run `fn`, tagging any failure (sync or async) with the body key `ctx` it validated. */
export function asSettingsField(ctx, fn) {
  const tag = (e) => { if (e && typeof e === 'object' && !e.settingsCtx) e.settingsCtx = ctx; throw e; };
  try {
    const v = fn();
    return v && typeof v.then === 'function' ? v.catch(tag) : v;
  } catch (e) { return tag(e); }
}
