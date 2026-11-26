// ui/public/models/jobs-model.mjs — the Jobs tab's view model (models-menu P6, DESIGN JOB-1…JOB-10). Pure: no DOM.
// The tab keeps a draft, a map from today's setting ids ('models.claude.roles.deep', 'models.codex.steps.implementer',
// 'models.claude.utility.title', …) to the edited value ({ model?, effort? }, null = cleared). This module merges it
// over what GET /api/settings holds, builds what jobs-view.mjs draws (harness line, role tiles, the Steps, Helper jobs
// and Design cards), counts what differs, and turns the differences into ONE POST /api/settings body by handing each
// of today's two mappers only its own ids: role ids to rolesPatchToSettingsBody (which reads any id as a role), every
// other id to enginePatchToSettingsBody. The words a row shows when it follows something are today's.
import { HELPER_JOBS, DESIGN_JOBS } from '../../../src/shared/model-jobs.mjs';
import { MODEL_ROLES, ROLE_LABELS, ROLE_SUBS, roleOfSettingId, jobSlot, isCliDecides, CLI_DECIDES, decidesLabel, toolDecidesText } from '../../../src/shared/model-roles.mjs';
import { DESIGN_ENGINE_NAMES } from '../../../src/shared/design-names.mjs';
import { engineLabel, SIGN_IN_ENGINE_NAMES } from '../../../src/shared/engine-switch.mjs';
import { rolesPatchToSettingsBody, enginePatchToSettingsBody, helpersNote } from '../engine-settings-view.mjs';
import { pickLabel, modelName } from './model-picker.mjs';

const str = (v) => (typeof v === 'string' && v ? v : '');
const plain = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const own = (o, key) => (Object.hasOwn(plain(o), key) ? o[key] : undefined);
const ROLE_ID_RE = /^models\.[^.]+\.roles\./;
const UTILITY_SLOT = 'utilityModels.';
const DEFAULT_MODEL = 'The default model';
const WORCA_DEFAULT = "Worca's default";

/** A stored or drafted value with only the keys it holds: { model?, effort? }; a string setting (titleModel) is its
 *  model; '', null and { model: null, effort: null } → null. Always a fresh object. */
function norm(v) {
  if (typeof v === 'string') return v ? { model: v } : null;
  if (!v || typeof v !== 'object') return null;
  if (isCliDecides(v)) return { ...CLI_DECIDES };   // #1450 "Let <tool> decide": kept, never read as "cleared"
  const model = str(v.model);
  const effort = str(v.effort);
  return model || effort ? { ...(model ? { model } : {}), ...(effort ? { effort } : {}) } : null;
}
const same = (a, b) => isCliDecides(a) === isCliDecides(b) && (a?.model || '') === (b?.model || '') && (a?.effort || '') === (b?.effort || '');
/** The tool's name in "Let <tool> decide" / "From <Role> · <tool> decides". */
const toolName = (engine) => (engine === 'codex' ? 'Codex' : engineLabel(engine));
// Helper jobs whose unset value is NOT the role's Worca default: the title keeps its run-model / Haiku cascade, and
// Memory defragment and the Workspace scan their factory defaults (title.mjs, orchestrator _defragAgentPair, withScanRole).
// On Claude Code four more keep their own fallback: the Auto classifier (Sonnet 5, auto/model.mjs), Run naming and
// Command summaries (the cheapest ready model) and the Requirements interview (its Opus default).
const NO_WORCA_DEFAULT_RE = /\.(title|memoryDefrag|workspaceScan)$/;
const NO_WORCA_DEFAULT_CLAUDE_RE = /^models\.claude\.(utility\.(classifier|naming|commandSummary)|requirementsInterview)$/;

/** What is stored, by setting id; an id with nothing stored is absent. Values { model?, effort? } with null/'' keys
 *  dropped (a string setting becomes { model }; '' / null / { model: null, effort: null } are absent).
 *  roles: modelRoles[e][r] → 'models.<e>.roles.<r>'.  steps: stepModels[e][k] → 'models.<e>.steps.<k>'.
 *  helper jobs: each HELPER_JOBS settingId from jobSlot (Claude: titleModel, autoWorkflowModel, prDescriptionModel,
 *  memoryDefrag, agentGenModel, namingModel, commandSummaryModel, secondOpinionModel, requirementsInterview; Codex:
 *  jobSlot gives 'utilityModels.<key>' with no engine segment, so read utilityModels.codex.<key>).
 *  design: designModels[e][lead|builder] → 'models.<e>.design.<…>'. */
export function jobsSaved(settings) {
  const s = plain(settings);
  const out = {};
  const put = (id, raw) => { const v = norm(raw); if (v) out[id] = v; };
  for (const [e, roles] of Object.entries(plain(s.modelRoles))) for (const r of MODEL_ROLES) put(`models.${e}.roles.${r}`, own(roles, r));
  for (const [e, steps] of Object.entries(plain(s.stepModels))) for (const [k, v] of Object.entries(plain(steps))) put(`models.${e}.steps.${k}`, v);
  for (const [e, jobs] of Object.entries(HELPER_JOBS)) {
    for (const job of jobs) {
      const slot = jobSlot(e, job.key);
      put(job.settingId, slot.startsWith(UTILITY_SLOT) ? own(own(s.utilityModels, e), slot.slice(UTILITY_SLOT.length)) : own(s, slot));
    }
  }
  for (const [e, design] of Object.entries(plain(s.designModels))) for (const d of DESIGN_JOBS) put(`models.${e}.design.${d.key}`, own(design, d.key));
  return out;
}

/** The value a row shows: the draft's when the draft has the id (null = cleared), else the saved one, else null. */
export function jobValue(id, draft, saved) {
  return norm(Object.hasOwn(plain(draft), id) ? draft[id] : own(saved, id));
}

/** Ids whose draft value differs from the saved one (deep-equal after the same normalising; null equals absent). */
export function jobsDirty(draft, saved) {
  return Object.keys(plain(draft)).filter((id) => !same(norm(draft[id]), norm(own(saved, id)))).sort();
}

/** One POST /api/settings body for jobsDirty(draft, saved): ids matching /^models\.[^.]+\.roles\./ through
 *  rolesPatchToSettingsBody, all other ids through enginePatchToSettingsBody, the two results merged. {} when
 *  nothing differs. Only the ids that differ are fed, so an untouched stored value is never sent again. */
export function jobsSaveBody(draft, saved) {
  const roles = {};
  const others = {};
  for (const id of jobsDirty(draft, saved)) (ROLE_ID_RE.test(id) ? roles : others)[id] = norm(draft[id]);
  return { ...rolesPatchToSettingsBody(roles), ...enginePatchToSettingsBody(others) };
}

/** A model's name for the "(default)" words: modelName of the catalogue row, else the id. */
const labelOf = (id, catalog) => {
  const m = (Array.isArray(catalog) ? catalog : []).find((x) => x && x.id === id);
  return (m && modelName(m)) || id;
};
/** A "(default)" pair { model, effort? } as today's empty options read it: "Opus 5.5 (default)", "medium (default)". */
const pairText = (p, catalog) => ({ text: `${labelOf(p.model, catalog)} (default)`, effort: str(p.effort) ? `${p.effort} (default)` : '' });

/** Today's words for a row with no value of its own whose role is not set (or that never follows one):
 *  → { text, effort } (effort '' when none). Ported from app.js at checkpoint 98c2f9e3e (the
 *  "(default)" pairs: the Second-opinion reviewer and Memory defragment from factoryModels.claude.helpers, the
 *  interview's requirementsInterviewDefault, Command summaries' automatic model) and engine-settings-view.mjs (steps,
 *  helper jobs, Design). Memory defragment only reaches here while the Quick jobs role is unset: buildJobs follows the role first. */
export function jobDefaultText(id, { engine, settings, catalog } = {}) {
  const m = /^models\.([^.]+)\.(.+)$/.exec(typeof id === 'string' ? id : '');
  const e = (m ? m[1] : '') || str(engine) || 'claude';
  const rest = m ? m[2] : '';
  const words = (text) => ({ text, effort: '' });
  const ownDefault = `${engineLabel(e)}'s default model`;
  if (rest.startsWith('steps.')) return words(SIGN_IN_ENGINE_NAMES.includes(e) ? ownDefault : "The workflow's model");
  if (rest.startsWith('design.')) {
    if (e === 'codex') return words("Codex's default model");
    return words(e === 'copilot' || SIGN_IN_ENGINE_NAMES.includes(e) ? ownDefault : DEFAULT_MODEL);
  }
  if (e === 'codex') return words(`${engineLabel('codex')}'s default model`);
  if (e !== 'claude') return words(DEFAULT_MODEL);
  const s = plain(settings);
  const job = rest.startsWith('utility.') ? rest.slice('utility.'.length) : rest;
  if (job === 'memoryDefrag' || job === 'secondOpinion') {
    const p = own(own(own(s.factoryModels, 'claude'), 'helpers'), job);
    if (p && str(p.model)) return pairText(p, catalog);
  } else if (job === 'commandSummary') {
    // Unset, it runs on the cheapest ready Claude model: today's empty option names that model, never an effort.
    const c = plain(s.commandSummaryModelEffective);
    if (c.source === 'auto' && str(c.model)) return words(`${labelOf(c.model, catalog)} (default)`);
  } else if (job === 'requirementsInterview') {
    const p = plain(s.requirementsInterviewDefault);
    if (str(p.model)) return pairText(p, catalog);
  }
  return words(DEFAULT_MODEL);
}

const countText = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

/** data = { settings, steps: [{ key, label }], catalog, engines: [{ name, label, ready, reason }] | null,
 *    locks: [{ name, reason }], flags: { requirements, design, smartRunNaming, commandSummaries } (resolved booleans;
 *    a missing flag is off), testable: Set<string> }
 *  view = { engine, showAll: { steps: false, helpers: false }, revealed: Set<string> }
 *  → { engine, engineLabel, defaultEngine, isDefault, canDefault, defaultTitle, reason,
 *      roles: [{ id, role, name, sub, value, text, effortText, model, clearLabel }],
 *      sections: [{ key: 'steps'|'helpers'|'design', title, count, overrideLabel, note, rows: Row[], moreText, canFold, showingAll, choices: Choice[] }],
 *      dirty: number, dirtyText }
 *  Row    = { id, name, sub, own, value, text, effort, model, missing, inherit, role, clearLabel, modelOnly, allowEffortOnly, canTest }
 *  Choice = { id, name, group: 'deep'|'quick'|'everyday'|null, taken }
 *  The Requirements interview never follows its role on this tab (today's words): its row carries role null. A
 *  model-only job following its role shows the role's model and no effort (today's disabled "Default"). */
export function buildJobs(data, draft, view) {
  const d = plain(data);
  const settings = plain(d.settings);
  const catalog = Array.isArray(d.catalog) ? d.catalog : [];
  const flags = plain(d.flags);
  const flagOn = (name) => flags[name] === true;
  const testable = d.testable instanceof Set ? d.testable : new Set(Array.isArray(d.testable) ? d.testable : []);
  const v = plain(view);
  const showAll = plain(v.showAll);
  const revealed = v.revealed instanceof Set ? v.revealed : new Set();
  const defaultEngine = str(settings.runEngine) || 'claude';
  const engine = str(v.engine) || defaultEngine;
  const saved = jobsSaved(settings);
  const valueOf = (id) => jobValue(id, draft, saved);
  const ctx = { engine, settings, catalog };

  /** This harness's pick for a role (draft over saved), only when it names a model; else null. */
  const rolePick = (role) => {
    if (!role) return null;
    const pick = valueOf(`models.${engine}.roles.${role}`);
    return pick && pick.model ? pick : null;
  };
  // #1450: what an empty role runs here — Worca's default (GET /api/settings roleDefaults) on Claude Code (unless it is
  // signed out) and Codex; on every other harness, or Claude Code signed out, the tool decides.
  const defaults = plain(own(plain(settings.roleDefaults), engine));
  const hasDefaults = Object.keys(defaults).length > 0 && !(engine === 'claude' && settings.claudeAuth === 'signed-out');
  const knowsDefaults = Object.keys(plain(settings.roleDefaults)).length > 0;   // an older payload: today's words
  const roleDefault = (role) => (hasDefaults && role ? str(own(plain(own(defaults, role)), 'model')) : '');
  const roleCliDecides = (role) => !!role && isCliDecides(valueOf(`models.${engine}.roles.${role}`));
  /** What a row with no model of its own shows: its role's "From …" words when that role is set (the model's name,
   *  else its id, as today's empty option), the role's Worca default or "<tool> decides", else today's default words. */
  const fallback = (id, role) => {
    const pick = rolePick(role);
    if (pick) return { text: `From ${ROLE_LABELS[role]} · ${labelOf(pick.model, catalog)}`, effort: pick.effort || '' };
    if (role && roleCliDecides(role)) return { text: `From ${ROLE_LABELS[role]} · ${toolName(engine)} decides`, effort: '' };
    const dflt = NO_WORCA_DEFAULT_RE.test(id) || NO_WORCA_DEFAULT_CLAUDE_RE.test(id) ? '' : roleDefault(role);
    if (dflt) return { text: `From ${ROLE_LABELS[role]} · ${labelOf(dflt, catalog)} (Worca default)`, effort: '' };
    return jobDefaultText(id, ctx);
  };

  // clearLabel: what a tile's picker clears back to (the prototype's words). A stored effort with no model (the server
  // refuses one; only a hand-edited settings.json holds it) still shows its effort.
  const roles = MODEL_ROLES.map((role) => {
    const id = `models.${engine}.roles.${role}`;
    const value = valueOf(id);
    const decides = isCliDecides(value);
    const label = value && !decides ? pickLabel(value, catalog) : null;
    const dflt = roleDefault(role);
    const emptyText = !knowsDefaults ? "Each job's own default"
      : dflt ? `Worca default · ${labelOf(dflt, catalog)}` : toolDecidesText(engineLabel(engine));
    return {
      id, role, name: ROLE_LABELS[role], sub: ROLE_SUBS[role], value,
      text: decides ? decidesLabel(toolName(engine)) : value && value.model ? label.text : emptyText,
      effortText: !value || decides ? '' : value.effort ? `${value.effort} effort` : 'Model default effort',
      model: label ? label.model : null,
      clearLabel: !knowsDefaults ? "Each job's own default" : dflt ? `Worca's default (${labelOf(dflt, catalog)})` : toolDecidesText(engineLabel(engine)),
      // "Let Claude Code decide" / "Let Codex decide" is offered only where an empty role means a Worca default.
      decideLabel: hasDefaults ? decidesLabel(toolName(engine)) : '',
    };
  });

  const rowOf = ({ id, name, role, modelOnly = false, allowEffortOnly = false }) => {
    const value = valueOf(id);
    const clearLabel = role ? `Follow ${ROLE_LABELS[role]}` : WORCA_DEFAULT;
    if (!value) {
      // A job that keeps a model only (today's disabled "Default" effort) never runs at its role's effort.
      const f = fallback(id, role);
      return { id, name, sub: '', own: false, value: null, text: f.text, effort: modelOnly ? '' : f.effort, model: null, missing: false, inherit: true,
        role, clearLabel, modelOnly, allowEffortOnly, canTest: false };
    }
    // An effort with no model (a step, a Codex helper job, the interview) reads as the row would without a value.
    const label = pickLabel(value, catalog);
    return {
      id, name, sub: `Instead of ${role ? ROLE_LABELS[role] : WORCA_DEFAULT}`, own: true, value,
      text: value.model ? label.text : fallback(id, role).text, effort: value.effort || '', model: label.model, missing: label.missing,
      inherit: false, role, clearLabel, modelOnly, allowEffortOnly, canTest: !!value.model && testable.has(value.model),
    };
  };

  /** One card. `always`: every row shows and nothing folds (Design). */
  const section = ({ key, title, jobs, overrideLabel, always = false, showingAll = false }) => {
    const rows = jobs.map(rowOf);
    const folded = always ? [] : rows.filter((r) => !r.own && !revealed.has(r.id));
    const follow = folded.filter((r) => rolePick(r.role)).length;
    const parts = [];
    if (follow) parts.push(countText(follow, '1 more follows its role', 'more follow their role'));
    if (folded.length - follow) parts.push(countText(folded.length - follow, "1 uses Worca's default", "use Worca's default"));
    const shows = (r) => always || showingAll || revealed.has(r.id);
    return {
      key, title, count: jobs.length, overrideLabel, note: '',
      rows: [...rows.filter((r) => r.own), ...rows.filter((r) => !r.own && shows(r))],
      moreText: parts.join(' · '), canFold: !always && rows.some((r) => !r.own), showingAll: always || showingAll,
      choices: rows.map((r) => ({ id: r.id, name: r.name, group: r.role || null, taken: r.own })),
    };
  };

  const stepJobs = (Array.isArray(d.steps) ? d.steps : []).filter((s) => s && str(s.key)).map((s) => {
    const id = `models.${engine}.steps.${s.key}`;
    const name = str(s.label) || s.key;
    return { id, name, role: roleOfSettingId(id, { name }), allowEffortOnly: true };
  });
  const sections = [section({ key: 'steps', title: 'Steps', jobs: stepJobs, overrideLabel: 'Override a step', showingAll: !!showAll.steps })];

  const helperJobs = Object.hasOwn(HELPER_JOBS, engine) ? HELPER_JOBS[engine] : null;
  if (helperJobs) {
    const jobs = helperJobs.filter((j) => !j.flag || flagOn(j.flag))
      .map((j) => ({ id: j.settingId, name: j.label, role: j.key === 'requirementsInterview' ? null : j.role, modelOnly: !!j.modelOnly }));
    sections.push(section({ key: 'helpers', title: 'Helper jobs', jobs, overrideLabel: 'Override a helper job', showingAll: !!showAll.helpers }));
  } else {
    sections.push({ key: 'helpers', title: 'Helper jobs', count: 0, overrideLabel: '', note: helpersNote(engine), rows: [], moreText: '',
      canFold: false, showingAll: !!showAll.helpers, choices: [] });
  }

  if (flagOn('design') && DESIGN_ENGINE_NAMES.includes(engine)) {
    const jobs = DESIGN_JOBS.map((j) => ({ id: `models.${engine}.design.${j.key}`, name: j.label, role: j.role }));
    sections.push(section({ key: 'design', title: 'Design', jobs, overrideLabel: '', always: true }));
  }

  // The harness line: two sentences ported from app.js at checkpoint 98c2f9e3e; a ready harness with no
  // warning says nothing.
  const ready = (Array.isArray(d.engines) ? d.engines : []).find((x) => x && x.name === engine) || null;
  const label = (ready && str(ready.label)) || engineLabel(engine);
  const local = !ready ? ''
    : !ready.ready ? `${label} can't start runs yet: ${String(ready.reason || 'its check did not answer').replace(/\.$/, '')}.`
      : ready.reason ? `${label} can start runs: its CLI is installed and signed in. Note: ${String(ready.reason).replace(/\.$/, '')}.` : '';
  // A configured remote backend (GET /api/engines `sandbox`): whether Worca can sign this harness's model calls from a
  // sandbox (the credential stays on the server; the sandbox reaches the model through Worca's relay).
  const box = ready && ready.sandbox && Array.isArray(ready.sandbox.titles)
    ? `Remote sandbox (${ready.sandbox.titles.join(', ')}): ${ready.sandbox.ready ? 'Worca can sign its model calls from the sandbox.'
      : `${String(ready.sandbox.reason || 'Worca cannot sign its model calls').replace(/\.$/, '')}.`}` : '';
  const reason = [local, box].filter(Boolean).join(' ');
  const lock = (Array.isArray(d.locks) ? d.locks : []).find((l) => l && l.name === engine) || null;
  const isDefault = defaultEngine === engine;
  const dirty = jobsDirty(draft, saved).length;
  return {
    engine, engineLabel: engineLabel(engine), defaultEngine, isDefault, canDefault: !isDefault && !lock, defaultTitle: lock ? str(lock.reason) : '',
    reason, roles, sections, dirty, dirtyText: `${dirty} unsaved change${dirty === 1 ? '' : 's'}`,
  };
}
