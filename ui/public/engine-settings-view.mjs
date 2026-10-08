import { renderInheritField, readDirtyFields } from './inherit-field.mjs';
export const ENGINE_LABELS = Object.freeze({ claude: 'Claude', codex: 'Codex', copilot: 'Copilot' });
export const ENGINE_EFFORTS = Object.freeze({ claude: Object.freeze(['medium', 'high', 'xhigh', 'max']), codex: Object.freeze(['minimal', 'low', 'medium', 'high']) });
export const JOB_LABELS = Object.freeze({ title: 'Titles', classifier: 'Auto workflow classifier', overview: 'Run overview', prDescription: 'PR description', memoryDefrag: 'Memory defragment', workspaceScan: 'Workspace scan' });
// The setting id of an engine's helper slot, as settings-cascade.mjs names it: memory defragment
// and workspace scan are runs of their own (spec §3.1 "own-run models"), the rest are utility jobs.
const OWN_RUN_JOBS = new Set(['memoryDefrag', 'workspaceScan']);
export const utilityId = (engine, job) => (OWN_RUN_JOBS.has(job) ? `models.${engine}.${job}` : `models.${engine}.utility.${job}`);
const EMPTY = Object.freeze({ own: undefined, inherited: { value: undefined, source: 'default' } });
export function renderEngineSection(host, options) {
  const doc = host.ownerDocument; host.replaceChildren(); const field = (id) => options.fields?.[id] || EMPTY;
  const run = field('run.engine'); host.append(renderInheritField(doc, { id: 'run.engine', label: 'Default engine', kind: 'select', level: options.level, hint: 'New pipeline starts on this engine. You can still switch per run.', options: [{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }, { value: 'copilot', label: 'Copilot' }], own: run.own, inherited: run.inherited, format: (value) => ENGINE_LABELS[value] || value }));
  const extras = {};
  for (const engine of ['claude', 'codex']) {
    const card = doc.createElement('section'); card.className = 'engine-card'; card.dataset.engine = engine;
    const heading = doc.createElement('h3'); heading.textContent = ENGINE_LABELS[engine]; card.append(heading);
    if (options.notes?.[engine]) { const note = doc.createElement('small'); note.className = 'hint'; note.textContent = options.notes[engine]; card.append(note); }
    const row = (id, label, defaultLabel) => { const value = field(id); return renderInheritField(doc, { id, label, kind: 'model', level: options.level, engine, catalog: options.catalog || [], efforts: ENGINE_EFFORTS[engine], own: value.own, inherited: value.inherited, defaultLabel }); };
    const steps = doc.createElement('div'); steps.className = 'engine-steps'; const sh = doc.createElement('h4'); sh.textContent = 'Step models'; steps.append(sh);
    for (const role of options.roles || []) steps.append(row(`models.${engine}.steps.${role.key}`, role.label || role.key, options.defaultLabels?.steps || "the workflow's model")); card.append(steps);
    const jobs = options.jobs?.[engine] || []; if (jobs.length) { const helpers = doc.createElement('div'); helpers.className = 'engine-helpers'; const hh = doc.createElement('h4'); hh.textContent = 'Helper models'; helpers.append(hh); for (const job of jobs) helpers.append(row(utilityId(engine, job), JOB_LABELS[job] || job, options.defaultLabels?.[engine] || (engine === 'codex' ? "Codex's default model (GPT-5.6 Sol)" : null))); card.append(helpers); }
    const extra = doc.createElement('div'); extra.className = 'engine-card-extra'; card.append(extra); extras[engine] = extra; host.append(card);
  }
  return extras;
}
export const readEngineSection = (host) => readDirtyFields(host);
export function enginePatchToSettingsBody(patch) {
  const body = {};
  for (const [id, value] of Object.entries(patch || {})) {
    if (id === 'run.engine') { body.runEngine = value; continue; }
    let match = /^models\.(claude|codex)\.steps\.(.+)$/.exec(id); if (match) { ((body.stepModels ||= {})[match[1]] ||= {})[match[2]] = value; continue; }
    match = /^models\.(codex)\.(?:utility\.)?(title|classifier|overview|prDescription|memoryDefrag|workspaceScan)$/.exec(id); if (match) ((body.utilityModels ||= {})[match[1]] ||= {})[match[2]] = value;
  }
  return body;
}

/** Settings › Ask Worca (cascading-settings-design.md D17): the engine new chats start on, and the model each engine's
 *  chats start with. User-only; `defaults` are the catalog's built-in picks, shown as "Worca default (…)". */
export function renderAskEngineSection(host, { catalog = [], askEngine, askModels = {}, defaults = {} } = {}) {
  const doc = host.ownerDocument; host.replaceChildren();
  // The catalog lists no Codex model while this codex cannot be locked down for a chat (docs/models.md#codex): a saved
  // Codex choice then starts new chats on Claude, and the card says so instead of offering an empty model row.
  const codexOffered = catalog.some((m) => m && m.engine === 'codex');
  const unavailable = 'Ask on Codex is unavailable on this codex version, so new chats start on Claude.';
  host.append(renderInheritField(doc, { id: 'askEngine', label: 'Engine for new chats', kind: 'select', level: 'user',
    hint: `A chat keeps the engine it started on; to switch, start a new chat.${codexOffered ? '' : ` ${unavailable}`}`,
    options: [{ value: 'claude', label: 'Claude' }, { value: 'codex', label: codexOffered ? 'Codex' : 'Codex (unavailable)' }],
    own: askEngine ?? undefined, inherited: { value: 'claude', source: 'default' }, format: (value) => ENGINE_LABELS[value] || value }));
  for (const engine of ['claude', 'codex']) {
    if (engine === 'codex' && !codexOffered) continue;
    host.append(renderInheritField(doc, { id: `models.${engine}.ask`, label: `${ENGINE_LABELS[engine]} chat model`, kind: 'model', level: 'user', engine,
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
