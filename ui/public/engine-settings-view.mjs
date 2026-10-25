import { icon } from './icons.mjs';
import { renderInheritField, readDirtyFields, readInheritField, inheritText, formatPair } from './inherit-field.mjs';
import { engineLabel, engineChoiceLabel, isBetaEngine, ENGINE_NAMES, MODEL_ENGINE_NAMES, SIGN_IN_ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';
import { applyEngineLocks, engineLock } from './engine-locks.mjs';
import { MODEL_ROLES, ROLE_LABELS, ROLE_HINTS, ROLE_HARNESSES, roleOfSettingId } from '../../src/shared/model-roles.mjs';
const roleLabelText = (role) => `From ${ROLE_LABELS[role]}`;
// The own-sign-in engines have no effort flag, except Goose and OpenCode.
export const ENGINE_EFFORTS = Object.freeze({ claude: Object.freeze(['medium', 'high', 'xhigh', 'max']), codex: Object.freeze(['minimal', 'low', 'medium', 'high']),
  copilot: Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  ...Object.fromEntries(SIGN_IN_ENGINE_NAMES.map((e) => [e, Object.freeze([])])),
  goose: Object.freeze(['low', 'medium', 'high', 'max']), opencode: Object.freeze(['minimal', 'low', 'medium', 'high', 'max']) });
// An inherited value's label; an unset one stays null, so the field shows its bare heading.
const engineName = (v) => (v == null ? null : engineLabel(v));
const helpersNote = (engine) => (engine === 'copilot' ? "Copilot runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on its own default model."
  : `${engineLabel(engine)} runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude. See the Claude tab.`);
export const JOB_LABELS = Object.freeze({ title: 'Titles', classifier: 'Auto workflow classifier', overview: 'Run overview', prDescription: 'PR description', memoryDefrag: 'Memory defragment', agentGen: 'Agent generation', naming: 'Run naming', commandSummary: 'Command summaries', workspaceScan: 'Workspace scan', requirementsInterview: 'Requirements interview' });
// The setting id of an engine's helper slot, as settings-cascade.mjs names it: memory defragment
// and workspace scan are runs of their own (spec §3.1 "own-run models"), the rest are utility jobs.
// Agent generation, Run naming and Command summaries have no cascade entry (user-only, Claude-only); their ids are the
// Chat registry's (Command summaries has no registry entry: only the Models page sets it). The requirements interview
// is a bare id: a user-only slot of its own, not a cascade utility job.
const OWN_RUN_JOBS = new Set(['memoryDefrag', 'workspaceScan', 'requirementsInterview']);
export const utilityId = (engine, job) => (OWN_RUN_JOBS.has(job) ? `models.${engine}.${job}` : `models.${engine}.utility.${job}`);
const EMPTY = Object.freeze({ own: undefined, inherited: { value: undefined, source: 'default' } });
// What each helper job does, as the hover hint on its row's name.
export const JOB_HINTS = Object.freeze({
  title: 'Writes the short title every run and chat gets.',
  classifier: 'Reads an Auto run\'s task and picks the workflow it runs.',
  overview: 'Writes the overview a finished run opens on.',
  prDescription: 'Drafts the pull request description ("Generate").',
  memoryDefrag: 'Runs Memory defragment, which restructures saved memory.',
  agentGen: 'Drafts a new agent\'s prompt and metadata in Workflows › Agents (Generate).',
  naming: 'Suggests the title and branch name on the New run form (Smart run naming). Unset: the cheapest ready Claude model.',
  commandSummary: 'Writes the one-line summary of a chat command when the chat gave none, from the command alone (secrets hidden, never its output). Turn it off in Settings › Chat › Summarise commands. Unset: the cheapest ready Claude model; with none ready, commands keep their raw text.',
  workspaceScan: 'Runs the workspace scan that maps how member projects connect.',
  requirementsInterview: 'Makes product briefs, looks at the code for a feature and runs the interview rounds on the Requirements page.',
});

/** One section of an engine tab (level 3): a heading with its controls on the right, a Model / Effort table (level 4)
 *  listing only the rows this level changes, and one summary line for the rest (level 5). "+ Override a …" reveals
 *  one row, Show all (Expert) every row. A row ends with Test (when it names a model and `onTest` is given) and ×,
 *  which clears it back to what it inherits. `what`: "step" | "helper job". `from`: where unset rows come from; a row
 *  marked data-role-set="1" follows its model role instead (read at paint time: a `roles-changed` event repaints). */
function slotTable(doc, cls, title, rows, { what, from, onTest = null, always = false }) {
  const box = doc.createElement('section'); box.className = `engine-slots ${cls}`;
  const bar = doc.createElement('div'); bar.className = 'engine-slot-bar';
  const head = doc.createElement('h4'); head.textContent = title; bar.append(head); box.append(bar);
  const cols = doc.createElement('div'); cols.className = 'engine-slot-head';
  cols.append(doc.createElement('span'), Object.assign(doc.createElement('span'), { textContent: 'Model' }), Object.assign(doc.createElement('span'), { textContent: 'Effort' }), doc.createElement('span'));
  box.append(cols);
  for (const r of rows) {
    r.el.classList.add('engine-slot'); r.el.hidden = !always && !r.set;
    if (r.hint) r.el.querySelector('.label-row label')?.setAttribute('title', r.hint);
    const actions = doc.createElement('div'); actions.className = 'engine-slot-actions';
    const model = r.el.querySelector('.inherit-model');
    if (onTest && model) {
      const test = doc.createElement('button'); test.type = 'button'; test.className = 'btn btn-sm engine-slot-test'; test.textContent = 'Test';
      test.title = 'Send one tiny prompt to this model';
      const paintTest = () => { test.hidden = !model.value; };
      model.addEventListener('change', paintTest); paintTest();
      test.addEventListener('click', () => onTest(model.value, test));
      actions.append(test);
    }
    const clear = r.el.querySelector('.inherit-clear');
    if (clear) { clear.replaceChildren(icon(doc, 'x', 14)); clear.setAttribute('aria-label', `Clear ${r.label}`); clear.classList.add('engine-slot-clear'); actions.append(clear); }
    r.el.append(actions);
    box.append(r.el);
  }
  const rest = doc.createElement('small'); rest.className = 'hint engine-slot-rest';
  const add = doc.createElement('select'); add.className = 'select engine-slot-add'; add.setAttribute('aria-label', `Override a ${what}`);
  const all = doc.createElement('button'); all.type = 'button'; all.className = 'btn btn-sm engine-slot-all'; all.dataset.minLevel = 'expert';
  let showAll = false;
  const followsRole = (r) => r.el.dataset.roleSet === '1';
  // Where the folded rows come from: their model role when every one has a role set, both when some do.
  const fromOf = (hidden, one) => {
    const withRole = hidden.filter(followsRole).length;
    if (!withRole) return from;
    const role = one ? 'its model role' : 'their model role';
    return withRole === hidden.length ? role : `${role} or ${from}`;
  };
  const paint = () => {
    const hidden = rows.filter((r) => r.el.hidden);
    const shown = rows.length - hidden.length;
    cols.hidden = shown === 0;
    rest.textContent = !hidden.length ? '' : shown === 0
      ? `Every ${what} follows ${fromOf(hidden, true)}.`
      : `${hidden.length} other ${what}${hidden.length === 1 ? '' : 's'} follow${hidden.length === 1 ? 's' : ''} ${fromOf(hidden, hidden.length === 1)}.`;
    for (const r of rows) {
      const clear = r.el.querySelector('.inherit-clear');
      if (clear) clear.title = `Clear: follow ${followsRole(r) ? ROLE_LABELS[r.el.dataset.role] : from}`;
    }
    rest.hidden = !rest.textContent;
    add.replaceChildren(Object.assign(doc.createElement('option'), { value: '', textContent: `Override a ${what}…` }));
    for (const r of hidden) add.append(Object.assign(doc.createElement('option'), { value: r.id, textContent: r.label }));
    add.value = ''; add.hidden = !hidden.length;
    all.textContent = showAll ? 'Show only changes' : `Show all ${rows.length}`;
    all.hidden = rows.length === 0 || (!showAll && !hidden.length);
  };
  add.addEventListener('change', () => {
    const r = rows.find((x) => x.id === add.value); if (!r) return;
    r.el.hidden = false; paint(); r.el.querySelector('select')?.focus();
  });
  all.addEventListener('click', () => {
    showAll = !showAll;
    // Collapsing keeps every row that holds a value here, including one picked a moment ago.
    for (const r of rows) r.el.hidden = !showAll && !r.set && r.el.dataset.dirty !== '1';
    paint();
  });
  // `always`: every row is listed (one per engine, as Ask Worca's chat models): nothing to override or show.
  box.addEventListener('roles-changed', paint);
  if (always) { box.append(rest); paint(); add.hidden = true; all.hidden = true; return box; }
  bar.append(add, all); box.append(rest); paint();
  return box;
}

/** The Engine & models card body — the Models page › Engines (level "user") and a project's settings ("project"):
 *  the default engine, then one engine at a time (the switch is Expert's; Advanced sees the default engine's tab),
 *  each tab the same skeleton: a readiness line, Step models, Helper jobs. `options.status`: an element that says how
 *  many changes are unsaved. `options.onTest(modelId, button)`: a row's Test. `options.noEffort`: setting ids whose
 *  slot stores a model only. Returns {} (kept for callers that read engine extras). */
export function renderEngineSection(host, options) {
  const doc = host.ownerDocument; host.replaceChildren(); const field = (id) => options.fields?.[id] || EMPTY;
  const run = field('run.engine'); host.append(renderInheritField(doc, { id: 'run.engine', label: 'Default engine', kind: 'select', level: options.level, hint: 'New run starts on this engine. You can still switch per run.', options: ENGINE_NAMES.map((e) => ({ value: e, label: engineChoiceLabel(e) })), own: run.own, inherited: run.inherited, format: engineName }));
  applyEngineLocks(host);
  const from = options.level === 'project' ? 'your settings' : "Worca's defaults";
  const noEffort = new Set(options.noEffort || []);
  // The tab shown first: the default engine's.
  const runEngine = run.own ?? run.inherited?.value;
  const first = MODEL_ENGINE_NAMES.includes(runEngine) ? runEngine : 'claude';
  const cards = {};
  const sw = engineSwitch(doc, MODEL_ENGINE_NAMES, (engine) => pick(engine));
  // A titled block under a rule: the switch picks which engine's models show; it is not part of Default engine.
  const head = doc.createElement('div'); head.className = 'field engine-models-head'; head.dataset.minLevel = 'advanced';
  head.append(Object.assign(doc.createElement('span'), { className: 'label', textContent: 'Models per engine' }), Object.assign(doc.createElement('small'), { className: 'hint', textContent: 'Each engine keeps its own step and helper models. They apply whenever a run uses that engine.' }), sw.el);
  host.append(head);
  const pick = (engine) => {
    for (const [e, c] of Object.entries(cards)) c.hidden = e !== engine;
    sw.pick(engine);
  };
  for (const engine of MODEL_ENGINE_NAMES) {
    const card = doc.createElement('section'); card.className = 'engine-card'; card.dataset.engine = engine; card.dataset.minLevel = 'advanced';
    // Advanced has no switch: the tab names its engine. Expert's switch already does (style.css hides this there).
    const heading = doc.createElement('h3'); heading.className = 'engine-card-name'; heading.textContent = engineLabel(engine); if (isBetaEngine(engine)) { const beta = doc.createElement('span'); beta.className = 'flag-chip flag-chip-beta beta-badge'; beta.textContent = 'Beta'; heading.append(beta); } card.append(heading);
    // A non-Claude tab's readiness line (GET /api/engines), filled by app.js on the Models page.
    if (engine !== 'claude') { const status = doc.createElement('small'); status.className = 'engine-card-status'; card.append(status); }
    if (options.notes?.[engine]) { const note = doc.createElement('small'); note.className = 'hint engine-card-note'; note.textContent = options.notes[engine]; card.append(note); }
    // options.modelRoles: the saved roles ({ claude: { everyday: {model, effort} } }). A row with no value of its own and
    // nothing inherited from a team or project layer falls back to its role ("From Everyday coding · Sonnet 5.5").
    const row = (id, label, defaultLabel, hint = null) => {
      const value = field(id); const role = roleOfSettingId(id, { name: label });
      const rolePick = role && options.modelRoles?.[engine]?.[role];
      const ownInherited = value.inherited?.value !== undefined;
      const inherited = rolePick && rolePick.model && !ownInherited ? { value: rolePick, source: 'role', label: roleLabelText(role) } : value.inherited;
      const el = renderInheritField(doc, { id, label, kind: 'model', level: options.level, engine, catalog: options.catalog || [], efforts: ENGINE_EFFORTS[engine], own: value.own, inherited, defaultLabel, noEffort: noEffort.has(id) });
      // Only rows whose fallback is the role's to paint: a team or project layer keeps its own text.
      if (role && !ownInherited) { el.dataset.role = role; el.dataset.defaultLabel = defaultLabel; el.dataset.roleSet = rolePick && rolePick.model ? '1' : ''; }
      return { id, label, hint, set: value.own !== undefined && value.own !== null, el };
    };
    const steps = (options.roles || []).map((role) => row(`models.${engine}.steps.${role.key}`, role.label || role.key, options.defaultLabels?.steps || (SIGN_IN_ENGINE_NAMES.includes(engine) ? `${engineLabel(engine)}'s default model` : "the workflow's model")));
    card.append(slotTable(doc, 'engine-steps', 'Step models', steps, { what: 'step', from, onTest: options.onTest }));
    const jobs = options.jobs?.[engine] || [];
    if (jobs.length) {
      const helpers = jobs.map((job) => row(utilityId(engine, job), JOB_LABELS[job] || job, options.defaultLabels?.[engine] || (engine === 'codex' ? "Codex's default model (GPT-5.6 Sol)" : 'the default model'), JOB_HINTS[job]));
      card.append(slotTable(doc, 'engine-helpers', 'Helper jobs', helpers, { what: 'helper job', from, onTest: options.onTest }));
    } else if (SIGN_IN_ENGINE_NAMES.includes(engine) || engine === 'copilot') {
      const sec = doc.createElement('section'); sec.className = 'engine-slots engine-helpers';
      const bar = doc.createElement('div'); bar.className = 'engine-slot-bar'; bar.append(Object.assign(doc.createElement('h4'), { textContent: 'Helper jobs' }));
      sec.append(bar, Object.assign(doc.createElement('small'), { className: 'hint engine-slot-rest', textContent: helpersNote(engine) }));
      card.append(sec);
    }
    host.append(card); cards[engine] = card;
  }
  pick(first);
  // Level 5 under the card's Save: how many changes are pending.
  if (options.status) {
    const paintStatus = () => { const n = host.querySelectorAll('.inherit-field[data-dirty="1"]').length; options.status.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : ''; };
    host.addEventListener('change', paintStatus); host.addEventListener('input', paintStatus); host.addEventListener('click', paintStatus);
    paintStatus();
  }
  return {};
}
export const readEngineSection = (host) => readDirtyFields(host);

/** The Claude / Codex / … engine switch (Expert). Used by the Engines card and the Roles card. `onPick(engine)`
 *  is called on a click; returns { el, pick } where pick(engine) sets the pressed button. */
export function engineSwitch(doc, engines, onPick) {
  const sw = doc.createElement('div'); sw.className = 'seg engine-switch'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Engine'); sw.dataset.minLevel = 'expert';
  for (const engine of engines) {
    const btn = doc.createElement('button'); btn.type = 'button'; btn.dataset.engine = engine; btn.textContent = engineLabel(engine);
    if (isBetaEngine(engine)) { const beta = doc.createElement('span'); beta.className = 'flag-chip flag-chip-beta beta-badge'; beta.textContent = 'Beta'; btn.append(beta); }
    btn.addEventListener('click', () => onPick(engine)); sw.append(btn);
  }
  const pick = (engine) => { for (const b of sw.querySelectorAll('button')) { const on = b.dataset.engine === engine; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };
  return { el: sw, pick };
}

const ROLES_HOST = new WeakMap();
/** The Roles card body (Models page): per harness, one model + effort row per role. Binds its listeners once per host. */
export function renderRolesSection(host, { roles = {}, catalog = [], engine = 'claude', status = null, onChange = null } = {}) {
  const doc = host.ownerDocument; host.replaceChildren();
  const first = ROLE_HARNESSES.includes(engine) ? engine : 'claude';
  const panels = {};
  const show = (h) => { for (const [e, p] of Object.entries(panels)) p.hidden = e !== h; sw.pick(h); };
  const sw = engineSwitch(doc, ROLE_HARNESSES, show);
  host.append(sw.el);
  for (const h of ROLE_HARNESSES) {
    const panel = doc.createElement('section'); // Not .engine-card: that class names the Engines card's own panels.
    panel.className = 'roles-engine'; panel.dataset.engine = h;
    panel.append(Object.assign(doc.createElement('h3'), { className: 'engine-card-name', textContent: engineLabel(h) }));
    for (const r of MODEL_ROLES) {
      const el = renderInheritField(doc, { id: `models.${h}.roles.${r}`, label: ROLE_LABELS[r], hint: ROLE_HINTS[r], kind: 'model', level: 'user', engine: h,
        catalog, efforts: ENGINE_EFFORTS[h], own: roles?.[h]?.[r], inherited: { value: undefined, source: 'default' }, defaultLabel: "each job's own default" });
      const clear = el.querySelector('.inherit-clear');
      if (clear) { clear.replaceChildren(icon(doc, 'x', 14)); clear.setAttribute('aria-label', `Clear ${ROLE_LABELS[r]}`); clear.title = 'Clear: each job uses its own default'; }
      panel.append(el);
    }
    host.append(panel); panels[h] = panel;
  }
  show(first);
  // Counts dirty rows on both harness panels, the hidden one included: a Save posts them all.
  // Writing the count resets the tone, so an earlier error colour never sticks to it.
  const paintStatus = () => { if (!status) return; const n = host.querySelectorAll('.inherit-field[data-dirty="1"]').length; status.className = 'hint'; status.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : ''; };
  // A clean card's repaint (the save's own settings-changed broadcast) keeps a result line such as "Saved.";
  // only a count left over from before the repaint is stale.
  const paintFresh = () => { if (!status) return; if (host.querySelector('.inherit-field[data-dirty="1"]') || /unsaved change/.test(status.textContent)) paintStatus(); };
  // The host outlives repaints: bind once, and read the latest callbacks from the host's state.
  ROLES_HOST.set(host, { paintStatus, onChange });
  if (!host.dataset.rolesBound) {
    host.dataset.rolesBound = '1';
    const changed = () => { const s = ROLES_HOST.get(host); s?.paintStatus(); s?.onChange?.(readRolesValues(host)); };
    host.addEventListener('change', changed); host.addEventListener('click', changed);
  }
  paintFresh();
}
/** Every role row's current value (saved or pending): { claude: { deep: {model, effort}|null, … }, codex: { … } }. */
export function readRolesValues(host) {
  const out = {};
  for (const el of host.querySelectorAll('.inherit-field[data-setting^="models."]')) {
    const [, h, , r] = el.dataset.setting.split('.');
    (out[h] ||= {})[r] = readInheritField(el);
  }
  return out;
}
/** The dirty role rows as a POST /api/settings body ({ modelRoles: { claude: { quick: null } } } clears). */
export function rolesPatchToSettingsBody(dirty) {
  const body = {};
  for (const [id, value] of Object.entries(dirty || {})) { const [, h, , r] = id.split('.'); ((body.modelRoles ||= {})[h] ||= {})[r] = value; }
  return body;
}
/** AC-1.5: repaint every role-tagged Engines row's empty options from the Roles card's current values, then tell
 *  each table to repaint its folded summary. */
export function paintRoleFallbacks(engineHost, roles, catalog = []) {
  for (const el of engineHost.querySelectorAll('.inherit-field[data-role]')) {
    const engine = el.closest('.engine-card')?.dataset.engine; const pick = roles?.[engine]?.[el.dataset.role];
    el.dataset.roleSet = pick && pick.model ? '1' : '';
    const model = el.querySelector('.inherit-model'); const effort = el.querySelector('.inherit-effort');
    const empty = model?.querySelector('option[value=""]'); if (!empty) continue;
    const label = roleLabelText(el.dataset.role);
    if (pick && pick.model) empty.textContent = inheritText('role', formatPair({ model: pick.model }, catalog), label);
    else { const d = el.dataset.defaultLabel || ''; empty.textContent = d.charAt(0).toUpperCase() + d.slice(1); }
    const effortEmpty = !model.value && effort && !effort.disabled ? effort.querySelector('option[value=""]') : null;
    if (effortEmpty) effortEmpty.textContent = pick?.model && pick.effort ? inheritText('role', pick.effort, label) : 'Model default';
  }
  for (const box of engineHost.querySelectorAll('.engine-slots')) box.dispatchEvent(new (engineHost.ownerDocument.defaultView.Event)('roles-changed'));
}
const CLAUDE_HELPER_KEYS = Object.freeze({ title: 'titleModel', classifier: 'autoWorkflowModel', prDescription: 'prDescriptionModel', memoryDefrag: 'memoryDefrag', agentGen: 'agentGenModel', naming: 'namingModel', commandSummary: 'commandSummaryModel' });
const CLAUDE_PAIR_KEYS = new Set(['memoryDefrag', 'agentGenModel', 'namingModel', 'commandSummaryModel']);
export function enginePatchToSettingsBody(patch) {
  const body = {};
  for (const [id, value] of Object.entries(patch || {})) {
    if (id === 'run.engine') { body.runEngine = value; continue; }
    let match = new RegExp(`^models\\.(${MODEL_ENGINE_NAMES.join('|')})\\.steps\\.(.+)$`).exec(id); if (match) { ((body.stepModels ||= {})[match[1]] ||= {})[match[2]] = value; continue; }
    match = /^models\.(codex)\.(?:utility\.)?(title|classifier|overview|prDescription|memoryDefrag|workspaceScan)$/.exec(id); if (match) ((body.utilityModels ||= {})[match[1]] ||= {})[match[2]] = value;
    // Claude's helper slots live in their own settings keys: a model id (title, Auto, PR description), and the
    // Memory defragment, Agent generation and Run naming pairs; the Requirements interview pair is its own key.
    if (id === 'models.claude.requirementsInterview') {
      const pair = {}; if (value && value.model) pair.model = value.model; if (value && value.effort) pair.effort = value.effort;
      body.requirementsInterview = Object.keys(pair).length ? pair : null; continue;
    }
    match = /^models\.claude\.(?:utility\.)?(title|classifier|prDescription|memoryDefrag|agentGen|naming|commandSummary)$/.exec(id);
    if (match) { const key = CLAUDE_HELPER_KEYS[match[1]]; body[key] = CLAUDE_PAIR_KEYS.has(key) ? (value && value.model ? { model: value.model, effort: value.effort || '' } : null) : (value && value.model) || ''; }
  }
  return body;
}

/** Settings › Ask Worca (cascading-settings-design.md D17): the engine new chats start on, and the model each engine's
 *  chats start with. User-only; `defaults` are the catalog's built-in picks, shown as "<value> (default)". */
export function renderAskEngineSection(host, { catalog = [], askEngine, askModels = {}, defaults = {}, onTest = null, status = null } = {}) {
  const doc = host.ownerDocument; host.replaceChildren();
  // The catalog lists no Codex model while this codex cannot be locked down for a chat (docs/models.md#codex): a saved
  // Codex choice then starts new chats on Claude, and the card says so instead of offering an empty model row.
  // Copilot: its rows are listed while the credential broker is off (the Copilot CLI is never probed here).
  const others = ['codex', 'copilot'];
  const offered = Object.fromEntries(others.map((e) => [e, catalog.some((m) => m && m.engine === e)]));
  const unavailable = (e) => (engineLock(e) !== null ? `Chat on ${engineLabel(e)} is off while the credential broker is on, so new chats start on Claude.`
    : `Chat on ${engineLabel(e)} is unavailable on this ${e} version, so new chats start on Claude.`);
  const notes = others.filter((e) => !offered[e]).map(unavailable).join(' ');
  host.append(renderInheritField(doc, { id: 'askEngine', label: 'Engine for new chats', kind: 'select', level: 'user',
    hint: `A chat keeps the engine it started on; to switch, start a new chat.${notes ? ` ${notes}` : ''}`,
    options: [{ value: 'claude', label: 'Claude' }, ...others.map((e) => ({ value: e, label: offered[e] ? engineChoiceLabel(e) : `${engineLabel(e)} (unavailable)` }))],
    own: askEngine ?? undefined, inherited: { value: 'claude', source: 'default' }, format: engineName }));
  applyEngineLocks(host);
  // The chat models: the Engines card's table, one row per engine and always listed (no switch, nothing folded).
  const rows = [];
  for (const engine of ['claude', ...others]) {
    if (engine !== 'claude' && !offered[engine]) continue;
    const id = `models.${engine}.ask`; const label = engineChoiceLabel(engine);
    rows.push({ id, label, set: askModels[engine] != null,
      hint: engine === 'codex' ? 'On Codex the per-turn cost cap is checked when a reply ends, and needs a model worca can price.'
        : engine === 'copilot' ? 'Copilot reports no cost: its chats run only while the per-turn cost cap is off.' : null,
      el: renderInheritField(doc, { id, label, kind: 'model', level: 'user', engine, catalog, efforts: ENGINE_EFFORTS[engine], own: askModels[engine], inherited: { value: defaults[engine] || undefined, source: 'default' } }) });
  }
  host.append(slotTable(doc, 'ask-chat-models', 'Chat models', rows, { what: 'engine', from: "Worca's defaults", onTest, always: true }));
  if (status) {
    const paintStatus = () => { const n = host.querySelectorAll('.inherit-field[data-dirty="1"]').length; status.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : ''; };
    host.addEventListener('change', paintStatus); host.addEventListener('click', paintStatus); paintStatus();
  }
}
export const readAskEngineSection = (host) => readDirtyFields(host);
export function askPatchToSettingsBody(patch) {
  const body = {};
  for (const [id, value] of Object.entries(patch || {})) {
    if (id === 'askEngine') { body.askEngine = value; continue; }
    const match = /^models\.(claude|codex|copilot)\.ask$/.exec(id);
    if (match) (body.askModels ||= {})[match[1]] = value;
  }
  return body;
}
