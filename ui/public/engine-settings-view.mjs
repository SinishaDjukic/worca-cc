import { renderInheritField, readDirtyFields } from './inherit-field.mjs';
import { engineLabel, engineChoiceLabel, isBetaEngine, ENGINE_NAMES, MODEL_ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';
export const ENGINE_EFFORTS = Object.freeze({ claude: Object.freeze(['medium', 'high', 'xhigh', 'max']), codex: Object.freeze(['minimal', 'low', 'medium', 'high']), cursor: Object.freeze([]) });
// An inherited value's label; an unset one stays null, so the field shows its bare heading.
const engineName = (v) => (v == null ? null : engineLabel(v));
const CURSOR_HELPERS_NOTE = "Cursor runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude — see the Claude tab.";
export const JOB_LABELS = Object.freeze({ title: 'Titles', classifier: 'Auto workflow classifier', overview: 'Run overview', prDescription: 'PR description', memoryDefrag: 'Memory defragment', workspaceScan: 'Workspace scan' });
// The setting id of an engine's helper slot, as settings-cascade.mjs names it: memory defragment
// and workspace scan are runs of their own (spec §3.1 "own-run models"), the rest are utility jobs.
const OWN_RUN_JOBS = new Set(['memoryDefrag', 'workspaceScan']);
export const utilityId = (engine, job) => (OWN_RUN_JOBS.has(job) ? `models.${engine}.${job}` : `models.${engine}.utility.${job}`);
const EMPTY = Object.freeze({ own: undefined, inherited: { value: undefined, source: 'default' } });
// What each helper job does, as the hover hint on its row's name.
export const JOB_HINTS = Object.freeze({
  title: 'Writes the short title every run and chat gets.',
  classifier: 'Reads an Auto run\'s task and picks the workflow it runs.',
  overview: 'Writes the overview a finished run opens on.',
  prDescription: 'Drafts the pull request description ("Generate with AI").',
  memoryDefrag: 'Runs Memory defragment, which restructures saved memory.',
  workspaceScan: 'Runs the workspace scan that maps how member projects connect.',
});

/** One section of an engine tab (level 3): a heading with its controls on the right, a Model / Effort table (level 4)
 *  listing only the rows this level changes, and one summary line for the rest (level 5). "+ Override a …" reveals
 *  one row, Show all (Expert) every row. A row ends with Test (when it names a model and `onTest` is given) and ×,
 *  which clears it back to what it inherits. `what`: "step" | "helper job". `from`: where unset rows come from. */
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
      const test = doc.createElement('button'); test.type = 'button'; test.className = 'btn btn-ghost btn-mini engine-slot-test'; test.textContent = 'Test';
      test.title = 'Send one tiny prompt to this model';
      const paintTest = () => { test.hidden = !model.value; };
      model.addEventListener('change', paintTest); paintTest();
      test.addEventListener('click', () => onTest(model.value, test));
      actions.append(test);
    }
    const clear = r.el.querySelector('.inherit-clear');
    if (clear) { clear.textContent = '×'; clear.setAttribute('aria-label', `Clear ${r.label}`); clear.title = 'Clear: follow ' + from; clear.classList.add('engine-slot-clear'); actions.append(clear); }
    r.el.append(actions);
    box.append(r.el);
  }
  const rest = doc.createElement('small'); rest.className = 'hint engine-slot-rest';
  const add = doc.createElement('select'); add.className = 'select engine-slot-add'; add.setAttribute('aria-label', `Override a ${what}`);
  const all = doc.createElement('button'); all.type = 'button'; all.className = 'btn btn-ghost btn-mini engine-slot-all'; all.dataset.minLevel = 'expert';
  let showAll = false;
  const paint = () => {
    const hidden = rows.filter((r) => r.el.hidden);
    const shown = rows.length - hidden.length;
    cols.hidden = shown === 0;
    rest.textContent = !hidden.length ? '' : shown === 0
      ? `Every ${what} follows ${from}.`
      : `${hidden.length} other ${what}${hidden.length === 1 ? '' : 's'} follow${hidden.length === 1 ? 's' : ''} ${from}.`;
    rest.hidden = !rest.textContent;
    add.replaceChildren(Object.assign(doc.createElement('option'), { value: '', textContent: `+ Override a ${what}…` }));
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
  if (always) { box.append(rest); paint(); add.hidden = true; all.hidden = true; return box; }
  bar.append(add, all); box.append(rest); paint();
  return box;
}

/** The Engine & models card body — Settings › Models › Engines (level "user") and a project's settings ("project"):
 *  the default engine, then one engine at a time (the switch is Expert's; Advanced sees the default engine's tab),
 *  each tab the same skeleton: a readiness line, Step models, Helper jobs. `options.status`: an element that says how
 *  many changes are unsaved. `options.onTest(modelId, button)`: a row's Test. `options.noEffort`: setting ids whose
 *  slot stores a model only. Returns {} (kept for callers that read engine extras). */
export function renderEngineSection(host, options) {
  const doc = host.ownerDocument; host.replaceChildren(); const field = (id) => options.fields?.[id] || EMPTY;
  const run = field('run.engine'); host.append(renderInheritField(doc, { id: 'run.engine', label: 'Default engine', kind: 'select', level: options.level, hint: 'New pipeline starts on this engine. You can still switch per run.', options: ENGINE_NAMES.map((e) => ({ value: e, label: engineChoiceLabel(e) })), own: run.own, inherited: run.inherited, format: engineName }));
  const from = options.level === 'project' ? 'your settings' : "Worca's defaults";
  const noEffort = new Set(options.noEffort || []);
  // The tab shown first: the default engine's (Copilot owns no models, so Claude's).
  const runEngine = run.own ?? run.inherited?.value;
  const first = MODEL_ENGINE_NAMES.includes(runEngine) ? runEngine : 'claude';
  const sw = doc.createElement('div'); sw.className = 'seg engine-switch'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Engine'); sw.dataset.minLevel = 'expert';
  // A titled block under a rule: the switch picks which engine's models show; it is not part of Default engine.
  const head = doc.createElement('div'); head.className = 'field engine-models-head'; head.dataset.minLevel = 'advanced';
  head.append(Object.assign(doc.createElement('span'), { className: 'label', textContent: 'Models per engine' }), Object.assign(doc.createElement('small'), { className: 'hint', textContent: 'Each engine keeps its own step and helper models. They apply whenever a run uses that engine.' }), sw);
  host.append(head);
  const cards = {};
  const pick = (engine) => {
    for (const [e, c] of Object.entries(cards)) c.hidden = e !== engine;
    for (const b of sw.querySelectorAll('button')) { const on = b.dataset.engine === engine; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  };
  for (const engine of MODEL_ENGINE_NAMES) {
    const btn = doc.createElement('button'); btn.type = 'button'; btn.dataset.engine = engine; btn.textContent = engineLabel(engine);
    if (isBetaEngine(engine)) { const beta = doc.createElement('span'); beta.className = 'badge violet beta-badge'; beta.textContent = 'Beta'; btn.append(beta); }
    btn.addEventListener('click', () => pick(engine)); sw.append(btn);
    const card = doc.createElement('section'); card.className = 'engine-card'; card.dataset.engine = engine; card.dataset.minLevel = 'advanced';
    // Advanced has no switch: the tab names its engine. Expert's switch already does (style.css hides this there).
    const heading = doc.createElement('h3'); heading.className = 'engine-card-name'; heading.textContent = engineLabel(engine); if (isBetaEngine(engine)) { const beta = doc.createElement('span'); beta.className = 'badge violet beta-badge'; beta.textContent = 'Beta'; heading.append(beta); } card.append(heading);
    // A non-Claude tab's readiness line (GET /api/engines), filled by app.js on Settings › Models.
    if (engine !== 'claude') { const status = doc.createElement('small'); status.className = 'engine-card-status'; card.append(status); }
    if (options.notes?.[engine]) { const note = doc.createElement('small'); note.className = 'hint engine-card-note'; note.textContent = options.notes[engine]; card.append(note); }
    const row = (id, label, defaultLabel, hint = null) => { const value = field(id); return { id, label, hint, set: value.own !== undefined && value.own !== null, el: renderInheritField(doc, { id, label, kind: 'model', level: options.level, engine, catalog: options.catalog || [], efforts: ENGINE_EFFORTS[engine], own: value.own, inherited: value.inherited, defaultLabel, noEffort: noEffort.has(id) }) }; };
    const steps = (options.roles || []).map((role) => row(`models.${engine}.steps.${role.key}`, role.label || role.key, options.defaultLabels?.steps || (engine === 'cursor' ? "Cursor's default model" : "the workflow's model")));
    card.append(slotTable(doc, 'engine-steps', 'Step models', steps, { what: 'step', from, onTest: options.onTest }));
    const jobs = options.jobs?.[engine] || [];
    if (jobs.length) {
      const helpers = jobs.map((job) => row(utilityId(engine, job), JOB_LABELS[job] || job, options.defaultLabels?.[engine] || (engine === 'codex' ? "Codex's default model (GPT-5.6 Sol)" : 'the default model'), JOB_HINTS[job]));
      card.append(slotTable(doc, 'engine-helpers', 'Helper jobs', helpers, { what: 'helper job', from, onTest: options.onTest }));
    } else if (engine === 'cursor') {
      const sec = doc.createElement('section'); sec.className = 'engine-slots engine-helpers';
      const bar = doc.createElement('div'); bar.className = 'engine-slot-bar'; bar.append(Object.assign(doc.createElement('h4'), { textContent: 'Helper jobs' }));
      sec.append(bar, Object.assign(doc.createElement('small'), { className: 'hint engine-slot-rest', textContent: CURSOR_HELPERS_NOTE }));
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
const CLAUDE_HELPER_KEYS = Object.freeze({ title: 'titleModel', classifier: 'autoWorkflowModel', prDescription: 'prDescriptionModel', memoryDefrag: 'memoryDefrag' });
export function enginePatchToSettingsBody(patch) {
  const body = {};
  for (const [id, value] of Object.entries(patch || {})) {
    if (id === 'run.engine') { body.runEngine = value; continue; }
    let match = /^models\.(claude|codex|cursor)\.steps\.(.+)$/.exec(id); if (match) { ((body.stepModels ||= {})[match[1]] ||= {})[match[2]] = value; continue; }
    match = /^models\.(codex)\.(?:utility\.)?(title|classifier|overview|prDescription|memoryDefrag|workspaceScan)$/.exec(id); if (match) ((body.utilityModels ||= {})[match[1]] ||= {})[match[2]] = value;
    // Claude's helper slots live in their own settings keys: a model id (title, Auto, PR description), and the
    // Memory defragment pair.
    match = /^models\.claude\.(?:utility\.)?(title|classifier|prDescription|memoryDefrag)$/.exec(id);
    if (match) { const key = CLAUDE_HELPER_KEYS[match[1]]; body[key] = key === 'memoryDefrag' ? (value && value.model ? { model: value.model, effort: value.effort || '' } : null) : (value && value.model) || ''; }
  }
  return body;
}

/** Settings › Ask Worca (cascading-settings-design.md D17): the engine new chats start on, and the model each engine's
 *  chats start with. User-only; `defaults` are the catalog's built-in picks, shown as "<value> (default)". */
export function renderAskEngineSection(host, { catalog = [], askEngine, askModels = {}, defaults = {}, onTest = null, status = null } = {}) {
  const doc = host.ownerDocument; host.replaceChildren();
  // The catalog lists no Codex model while this codex cannot be locked down for a chat (docs/models.md#codex): a saved
  // Codex choice then starts new chats on Claude, and the card says so instead of offering an empty model row.
  const codexOffered = catalog.some((m) => m && m.engine === 'codex');
  const unavailable = 'Ask on Codex is unavailable on this codex version, so new chats start on Claude.';
  host.append(renderInheritField(doc, { id: 'askEngine', label: 'Engine for new chats', kind: 'select', level: 'user',
    hint: `A chat keeps the engine it started on; to switch, start a new chat.${codexOffered ? '' : ` ${unavailable}`}`,
    options: [{ value: 'claude', label: 'Claude' }, { value: 'codex', label: codexOffered ? engineChoiceLabel('codex') : 'Codex (unavailable)' }],
    own: askEngine ?? undefined, inherited: { value: 'claude', source: 'default' }, format: engineName }));
  // The chat models: the Engines card's table, one row per engine and always listed (no switch, nothing folded).
  const rows = [];
  for (const engine of ['claude', 'codex']) {
    if (engine === 'codex' && !codexOffered) continue;
    const id = `models.${engine}.ask`; const label = engineChoiceLabel(engine);
    rows.push({ id, label, set: askModels[engine] != null,
      hint: engine === 'codex' ? 'On Codex the per-turn cost cap is checked when a reply ends, and needs a model worca can price.' : null,
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
    const match = /^models\.(claude|codex)\.ask$/.exec(id);
    if (match) (body.askModels ||= {})[match[1]] = value;
  }
  return body;
}
