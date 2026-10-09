import { renderInheritField, readDirtyFields } from './inherit-field.mjs';
import { engineLabel, engineChoiceLabel, isBetaEngine, ENGINE_NAMES, MODEL_ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';
export const ENGINE_EFFORTS = Object.freeze({ claude: Object.freeze(['medium', 'high', 'xhigh', 'max']), codex: Object.freeze(['minimal', 'low', 'medium', 'high']), cursor: Object.freeze([]) });
// An inherited value's label; an unset one stays null, so the field shows its bare heading.
const engineName = (v) => (v == null ? null : engineLabel(v));
const CURSOR_HELPERS_NOTE = "Helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) run on Claude on a Cursor run.";
export const JOB_LABELS = Object.freeze({ title: 'Titles', classifier: 'Auto workflow classifier', overview: 'Run overview', prDescription: 'PR description', memoryDefrag: 'Memory defragment', workspaceScan: 'Workspace scan' });
// The setting id of an engine's helper slot, as settings-cascade.mjs names it: memory defragment
// and workspace scan are runs of their own (spec §3.1 "own-run models"), the rest are utility jobs.
const OWN_RUN_JOBS = new Set(['memoryDefrag', 'workspaceScan']);
export const utilityId = (engine, job) => (OWN_RUN_JOBS.has(job) ? `models.${engine}.${job}` : `models.${engine}.utility.${job}`);
const EMPTY = Object.freeze({ own: undefined, inherited: { value: undefined, source: 'default' } });
/** A slot table: one compact row per step (or helper job) under a Model / Effort header. Only the rows this level
 *  changes show; the rest are summed up in one line, "+ Override a step…" reveals one, and Show all (Expert) all of them.
 *  `what`: "step" | "helper job". `from`: where unset rows come from ("your settings", "Worca's defaults"). */
function slotTable(doc, cls, title, rows, { what, from }) {
  const box = doc.createElement('div'); box.className = `engine-slots ${cls}`;
  const head = doc.createElement('h4'); head.textContent = title; box.append(head);
  const cols = doc.createElement('div'); cols.className = 'engine-slot-head';
  cols.append(doc.createElement('span'), Object.assign(doc.createElement('span'), { textContent: 'Model' }), Object.assign(doc.createElement('span'), { textContent: 'Effort' }));
  box.append(cols);
  for (const r of rows) { r.el.classList.add('engine-slot'); r.el.hidden = !r.set; box.append(r.el); }
  const foot = doc.createElement('div'); foot.className = 'engine-slot-foot';
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
  foot.append(rest, add, all); box.append(foot); paint();
  return box;
}

export function renderEngineSection(host, options) {
  const doc = host.ownerDocument; host.replaceChildren(); const field = (id) => options.fields?.[id] || EMPTY;
  const run = field('run.engine'); host.append(renderInheritField(doc, { id: 'run.engine', label: 'Default engine', kind: 'select', level: options.level, hint: 'New pipeline starts on this engine. You can still switch per run.', options: ENGINE_NAMES.map((e) => ({ value: e, label: engineChoiceLabel(e) })), own: run.own, inherited: run.inherited, format: engineName }));
  const from = options.level === 'project' ? 'your settings' : "Worca's defaults";
  // The card shown first: the default engine's (Copilot owns no models, so Claude's).
  const runEngine = run.own ?? run.inherited?.value;
  let shown = MODEL_ENGINE_NAMES.includes(runEngine) ? runEngine : 'claude';
  // One engine at a time (Expert switches between them); Advanced sees the default engine's card, Simple none.
  const sw = doc.createElement('div'); sw.className = 'seg engine-switch'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Engine'); sw.dataset.minLevel = 'expert';
  host.append(sw);
  const cards = {};
  const pick = (engine) => {
    shown = engine;
    for (const [e, c] of Object.entries(cards)) c.hidden = e !== engine;
    for (const b of sw.querySelectorAll('button')) { const on = b.dataset.engine === engine; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  };
  const extras = {};
  // One card per engine that owns catalog models: Copilot owns none, so it has no step or helper slots to set.
  for (const engine of MODEL_ENGINE_NAMES) {
    const btn = doc.createElement('button'); btn.type = 'button'; btn.dataset.engine = engine; btn.textContent = engineLabel(engine);
    if (isBetaEngine(engine)) { const beta = doc.createElement('span'); beta.className = 'badge violet beta-badge'; beta.textContent = 'Beta'; btn.append(beta); }
    btn.addEventListener('click', () => pick(engine)); sw.append(btn);
    const card = doc.createElement('section'); card.className = 'engine-card'; card.dataset.engine = engine; card.dataset.minLevel = 'advanced';
    const heading = doc.createElement('h3'); heading.textContent = engineLabel(engine); if (isBetaEngine(engine)) { const beta = doc.createElement('span'); beta.className = 'badge violet beta-badge'; beta.textContent = 'Beta'; heading.append(beta); } card.append(heading);
    // A non-Claude card's readiness line (GET /api/engines), filled by app.js on Settings › Models.
    if (engine !== 'claude') { const status = doc.createElement('small'); status.className = 'engine-card-status'; card.append(status); }
    const noteText = [options.notes?.[engine], engine === 'cursor' ? CURSOR_HELPERS_NOTE : null].filter(Boolean).join(' ');
    if (noteText) { const note = doc.createElement('small'); note.className = 'hint'; note.textContent = noteText; card.append(note); }
    const row = (id, label, defaultLabel) => { const value = field(id); return { id, label, set: value.own !== undefined && value.own !== null, el: renderInheritField(doc, { id, label, kind: 'model', level: options.level, engine, catalog: options.catalog || [], efforts: ENGINE_EFFORTS[engine], own: value.own, inherited: value.inherited, defaultLabel }) }; };
    const steps = (options.roles || []).map((role) => row(`models.${engine}.steps.${role.key}`, role.label || role.key, options.defaultLabels?.steps || (engine === 'cursor' ? "Cursor's default model" : "the workflow's model")));
    card.append(slotTable(doc, 'engine-steps', 'Step models', steps, { what: 'step', from }));
    const jobs = options.jobs?.[engine] || [];
    if (jobs.length) {
      const helpers = jobs.map((job) => row(utilityId(engine, job), JOB_LABELS[job] || job, options.defaultLabels?.[engine] || (engine === 'codex' ? "Codex's default model (GPT-5.6 Sol)" : null)));
      // Helper jobs are set rarely: folded, and the fold says how many this level changes.
      const fold = doc.createElement('details'); fold.className = 'engine-helpers-fold';
      const sum = doc.createElement('summary'); const n = helpers.filter((r) => r.set).length;
      sum.textContent = `Helper jobs${n ? ` · ${n} changed` : ''}`; fold.open = n > 0; fold.append(sum);
      fold.append(slotTable(doc, 'engine-helpers', 'Helper models', helpers, { what: 'helper job', from }));
      card.append(fold);
    }
    const extra = doc.createElement('div'); extra.className = 'engine-card-extra'; card.append(extra); extras[engine] = extra; host.append(card);
    cards[engine] = card;
  }
  pick(shown);
  return extras;
}
export const readEngineSection = (host) => readDirtyFields(host);
export function enginePatchToSettingsBody(patch) {
  const body = {};
  for (const [id, value] of Object.entries(patch || {})) {
    if (id === 'run.engine') { body.runEngine = value; continue; }
    let match = /^models\.(claude|codex|cursor)\.steps\.(.+)$/.exec(id); if (match) { ((body.stepModels ||= {})[match[1]] ||= {})[match[2]] = value; continue; }
    match = /^models\.(codex)\.(?:utility\.)?(title|classifier|overview|prDescription|memoryDefrag|workspaceScan)$/.exec(id); if (match) ((body.utilityModels ||= {})[match[1]] ||= {})[match[2]] = value;
  }
  return body;
}

/** Settings › Ask Worca (cascading-settings-design.md D17): the engine new chats start on, and the model each engine's
 *  chats start with. User-only; `defaults` are the catalog's built-in picks, shown as "<value> (default)". */
export function renderAskEngineSection(host, { catalog = [], askEngine, askModels = {}, defaults = {} } = {}) {
  const doc = host.ownerDocument; host.replaceChildren();
  // The catalog lists no Codex model while this codex cannot be locked down for a chat (docs/models.md#codex): a saved
  // Codex choice then starts new chats on Claude, and the card says so instead of offering an empty model row.
  const codexOffered = catalog.some((m) => m && m.engine === 'codex');
  const unavailable = 'Ask on Codex is unavailable on this codex version, so new chats start on Claude.';
  host.append(renderInheritField(doc, { id: 'askEngine', label: 'Engine for new chats', kind: 'select', level: 'user',
    hint: `A chat keeps the engine it started on; to switch, start a new chat.${codexOffered ? '' : ` ${unavailable}`}`,
    options: [{ value: 'claude', label: 'Claude' }, { value: 'codex', label: codexOffered ? engineChoiceLabel('codex') : 'Codex (unavailable)' }],
    own: askEngine ?? undefined, inherited: { value: 'claude', source: 'default' }, format: engineName }));
  for (const engine of ['claude', 'codex']) {
    if (engine === 'codex' && !codexOffered) continue;
    host.append(renderInheritField(doc, { id: `models.${engine}.ask`, label: `${engineLabel(engine)} chat model`, kind: 'model', level: 'user', engine,
      catalog, efforts: ENGINE_EFFORTS[engine], own: askModels[engine], inherited: { value: defaults[engine] || undefined, source: 'default' },
      ...(engine === 'codex' ? { hint: 'On Codex the per-turn cost cap is checked when a reply ends, and needs a model worca can price.' } : {}) }));
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
