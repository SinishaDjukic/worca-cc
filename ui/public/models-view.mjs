// ui/public/models-view.mjs
// Pure DOM renderers for the Models view (configurable-models-design.md §4.10).
// Mirrors guardrails-view.mjs: every function takes `doc` via opts (defaults to
// the browser global) and returns DETACHED elements — no fetch, no listeners
// outside the returned tree. app.js owns endpoint calls and mounting.
// Buttons carry a routing class (mv-save, mv-cancel, mv-back, mv-rewhere,
// mv-env-*, mvx-*) so app.js wires ONE delegated click listener on the model
// dialog (onModelDialogClick); an edit form's root carries data-id.

import { renderConnectionSection, collectConnection, applyConnectionMode, connectionWhere, setConnectionWhere, wheresFor, infoTip, tippedField } from './bridge-view.mjs';
import { modelMark, markedSelect, paintMarkedSelect } from './models/brand-marks.mjs';
import { displayName } from './models/catalogue-model.mjs';
import { providerState } from './models/provider-state.mjs';
import { icon } from './icons.mjs';
import { copyButton } from './copy-button.mjs';
import { engineChoiceLabel, MODEL_ENGINE_NAMES, SIGN_IN_ENGINE_NAMES, CHAT_ENGINE_NAMES, engineReportsCost } from '../../src/shared/engine-switch.mjs';
import { suggestModelHandle, HARNESS_EFFORTS, connectionOf } from '../../src/shared/connections.mjs';
import { SECRETISH_RE } from '../../src/shared/secret-names.mjs';

/** Each model engine's effort list: Claude's, Codex's, Copilot's, Goose's and OpenCode's as given, Gemini CLI's and Qwen
 *  Code's their harness's (src/shared/connections.mjs); Cursor has no effort flag. */
const effortLists = (efforts, codexEfforts, copilotEfforts = [], gooseEfforts = [], opencodeEfforts = []) => ({ claude: efforts, codex: codexEfforts, copilot: copilotEfforts,
  ...Object.fromEntries(SIGN_IN_ENGINE_NAMES.map((e) => [e, [...(HARNESS_EFFORTS[e] || [])]])), goose: gooseEfforts, opencode: opencodeEfforts });


function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The per-Mtok rate keys, in editor order, with their display labels. Mirrors
 *  settings.mjs COST_RATE_KEYS — the server is the validator, this is the form. */
export const COST_RATES = [
  ['input', 'Input'],
  ['output', 'Output'],
  ['cacheRead', 'Cache read'],
  ['cacheWrite', 'Cache write (5m)'],
  ['cacheWrite1h', 'Cache write (1h)'],
];

/** One-line pricing summary for a card, or '' when the model has no override
 *  (the overwhelming default — the CLI's own figure is trusted). */
export function costSummary(cost) {
  if (!cost || typeof cost !== 'object') return '';
  if (cost.free) return 'priced free';
  const p = cost.perMtok;
  if (!p || typeof p !== 'object') return '';
  const set = COST_RATES.filter(([k]) => p[k] != null);
  if (!set.length) return '';
  return `${set.map(([k, lab]) => `${lab.toLowerCase()} $${p[k]}`).join(' · ')} /Mtok`;
}

/**
 * A free id for a duplicate of `id`: `<id>-copy`, then `-copy-2`, `-copy-3`…
 * Compared case-insensitively against EVERY id the catalog knows (global,
 * plugin, built-in, legacy) — the add would be rejected for colliding with any
 * of them, and a suggestion the server refuses is worse than no suggestion.
 * @param {string} id  the source model's id
 * @param {Iterable<string>} takenIds
 * @returns {string}
 */
export function suggestDuplicateId(id, takenIds = []) {
  const taken = new Set([...takenIds].map((t) => String(t).toLowerCase()));
  const base = `${id}-copy`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const c = `${base}-${n}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
  return base; // 998 copies of one model: let the server reject the duplicate
}

/**
 * The label a duplicate of `src` starts with: `<label> copy` for a label the user chose; '' for one that is only the
 * id (or none), so the copy's label defaults to its own new id. models/brand-marks.mjs vendorOf reads past both.
 * @param {{ id: string, label?: string }} src
 * @returns {string}
 */
export function suggestDuplicateLabel(src) {
  const label = String(src?.label ?? '');
  return label && label !== src.id ? `${label} copy` : '';
}

/** One env key/value editor row. Existing values arrive MASKED; leaving a
 *  masked value untouched means "keep" (the server drops masked echoes).
 *  STORED rows (a key was persisted) also get a copy button that fetches the
 *  RAW value — the user owns it on disk anyway (design note: same trust
 *  boundary as ~/.worca-cc/settings.json, made deliberate by the click). */
function envRow(doc, key = '', value = '') {
  const row = h(doc, 'div', 'mv-env-row');
  const k = h(doc, 'input', 'input mv-env-key');
  k.type = 'text'; k.placeholder = 'NAME'; k.value = key;
  const v = h(doc, 'input', 'input mv-env-val');
  v.type = 'text'; v.placeholder = 'value, or ${VAR} to read your shell env'; v.value = value;
  if (value) v.dataset.original = value; // masked echo detection on collect
  row.appendChild(k); row.appendChild(v);
  if (key) {
    // The STORED key, frozen at render time — the copy must reveal what is on
    // disk even after the user edits the key input.
    row.dataset.key = key;
    const cp = copyButton(doc, { name: 'Copy the real (unmasked) value', cls: 'mv-env-copy' });
    row.appendChild(cp);
  }
  const rm = h(doc, 'button', 'btn btn-sm btn-quiet btn-icon mv-env-rm');
  rm.type = 'button';
  rm.title = 'Remove this variable';
  rm.setAttribute('aria-label', rm.title);
  rm.append(icon(doc, 'x', 14));
  row.appendChild(rm);
  return row;
}

/** Where a model runs, as connectionOf (src/shared/connections.mjs) names the kinds. */
const WHERE_KINDS = Object.freeze(['signin', 'env', 'provider']);
/** The three pricing modes, in the segment's order. */
const COST_MODES = Object.freeze([['cli', 'Trust the CLI'], ['free', 'Free ($0)'], ['perMtok', 'Per million tokens']]);
/** The ID's placeholder follows the harness: a Goose or OpenCode model's id is provider/model. */
const idPlaceholder = (engine) => (engine === 'goose' || engine === 'opencode' ? 'provider/model' : 'claude-opus-4-8, glm-4.7, a fine-tune id…');
/** The four names a provider model's bridge sets itself (model-env.mjs BRIDGE_ROUTING_KEYS). */
const PROVIDER_ENV_KEYS = Object.freeze(['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']);
/** The two rows a custom endpoint is made of (FRM-2): its address and its key. */
const ENDPOINT_ENV_KEYS = Object.freeze(['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']);
/** A value GET /api/models masked, echoed back: the server's isMaskedEcho (ui/routes/models/models.mjs), which a copy's
 *  `copyFrom` fills from its source. */
const isMaskedEcho = (v) => typeof v === 'string' && v.startsWith('••');

/** Today's hints, which carry rules rather than formats: each is its field's ⓘ tip (L18). */
const TIPS = Object.freeze({
  id: 'What runs and settings name this entry by. A sign-in model uses the model’s own id (a built-in id overrides that built-in); through a provider the id is yours, and the endpoint is sent the upstream model id below.',
  harness: 'The harness whose sign-in runs this model. A Cursor, Gemini CLI or Qwen Code model takes no effort, and Worca cannot price it. '
    + "A Goose model's id is provider/model (for example google/gemini-2.5-flash); Goose's own providers connect it. "
    + "An OpenCode model's id is provider/model (as `opencode models` lists it); OpenCode's own providers connect it, and its effort is OpenCode's --variant.",
  harnessFixed: 'Fixed once created. Delete the model and add it again to change it.',
  env: 'e.g. ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN. ANTHROPIC_MODEL sets the wire id sent to --model (the id above stays worca’s handle). Stored values show masked; leave masked to keep. WORCA_* and process keys are reserved. Through a provider, the bridge owns ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY / ANTHROPIC_MODEL. Setting them here is refused.',
  pricing: 'Only for an endpoint the CLI prices by NAME rather than from what the endpoint reports (an on-prem or proxied model). '
    + 'Trust the CLI is the default and leaves spend exactly as today. Blank rates count as $0, except Cache write (1h), '
    + 'which falls back to the 5m rate when blank.',
});

let fieldSeq = 0;

/**
 * div.mv-field named by its first .mv-field-label (FRM-1): a label[for] its control (with a tip, tippedField's), or for a
 * group of buttons or rows a span that labels the group — never a label wrapping buttons, whose text click presses the
 * first. `box` is what the field shows; `names` the element its name names (the box unless given).
 */
function fieldOf(doc, text, box, { tip = '', names = box } = {}) {
  const control = /^(?:INPUT|SELECT|TEXTAREA)$/.test(names.tagName);
  if (control && tip && names === box) return tippedField(doc, text, box, tip);
  const wrap = h(doc, 'div', 'mv-field');
  const name = h(doc, control ? 'label' : 'span', 'mv-field-label', text);
  if (control) {
    names.id = `mv-field-${++fieldSeq}`;
    name.htmlFor = names.id;
  } else {
    name.id = `mv-field-${++fieldSeq}`;
    names.setAttribute('role', 'group');
    names.setAttribute('aria-labelledby', name.id);
  }
  if (tip) {
    const row = h(doc, 'div', 'label-row');
    row.append(name, infoTip(doc, text, tip));
    wrap.appendChild(row);
  } else wrap.appendChild(name);
  wrap.appendChild(box);
  return wrap;
}

/** ol.mdl-steps: "1 Where it runs", then "2 The model", the current one (ADD-1). */
function stepNames(doc) {
  const ol = h(doc, 'ol', 'mdl-steps');
  ol.setAttribute('aria-label', 'Steps');
  ol.appendChild(h(doc, 'li', null, '1 Where it runs'));
  const now = h(doc, 'li', null, '2 The model');
  now.setAttribute('aria-current', 'step');
  ol.appendChild(now);
  return ol;
}

/**
 * The model form (DESIGN FRM-1…FRM-7): add, edit or copy. `model` is a MASKED global entry, or null for a new one.
 * Returns detached DOM: section.card.mv-editor[data-mode][data-where][data-engine][data-effort-lists] (data-id and
 * data-env-keys on edit, data-copy-from on a copy) > div.mv-editor-head (the model's mark on edit and copy, the title,
 * the step names with `steps`, Close), div.mv-editor-grid (the fields by where; the connection's folds after Pricing),
 * p.mv-editor-msg, div.mv-editor-btns (Back with `steps`, "Change where it runs" on edit, Cancel, Save last). app.js
 * lays it out (layoutDialog), wires the buttons and calls collectModelEditor on save.
 * `where`: 'provider' | 'signin' | 'env' (an existing model's connectionOf kind, else a sign-in); `steps`: reached through
 * step 1; `provider`: a new provider form's choice; `takenIds`: every listed id, refused on add and copy; `copyFrom`: a
 * source id — the model drawn as on edit, collected as a new one with `id` and `label`.
 */
export function renderModelEditor(model, efforts, { doc = globalThis.document, providers = null, copilotModels = [], codexEfforts = ['minimal', 'low', 'medium', 'high'], copilotEfforts = [], gooseEfforts = ['low', 'medium', 'high', 'max'], opencodeEfforts = ['minimal', 'low', 'medium', 'high', 'max'], where = '', steps = false, provider = '', takenIds = [], copyFrom = '', id = '', label = '' } = {}) {
  const copying = !!(model && copyFrom);
  const editing = !!model && !copying;
  const root = h(doc, 'section', 'card mv-editor');
  // Every engine's effort list rides the root so setModelEngine can swap them (§3.1a).
  const lists = effortLists(efforts, codexEfforts, copilotEfforts, gooseEfforts, opencodeEfforts);
  root.dataset.effortLists = JSON.stringify(lists);
  const engineNow = model && MODEL_ENGINE_NAMES.includes(model.engine) ? model.engine : 'claude';
  root.dataset.mode = editing ? 'edit' : 'create';
  if (editing) {
    root.dataset.id = model.id;
    // The stored env keys, so collect can send null (= delete) for rows the
    // user removed — the write-only PATCH can't infer deletions otherwise.
    root.dataset.envKeys = Object.keys(model.env || {}).join('\n');
  }
  if (copying) root.dataset.copyFrom = copyFrom;
  // Add and copy refuse an id the catalogue already lists, whatever its case (FRM-5).
  if (!editing) root.dataset.takenIds = [...(takenIds || [])].map((t) => String(t).toLowerCase()).join('\n');
  const whereNow = WHERE_KINDS.includes(where) ? where : model ? connectionOf(model).kind : 'signin';
  root.dataset.where = whereNow;

  const head = h(doc, 'div', 'mv-editor-head');
  // A copy is yours: it wears your mark even when its source is a plugin's.
  if (model) head.appendChild(modelMark(doc, copying ? { ...model, plugin: undefined } : model, 'lg'));
  head.appendChild(h(doc, 'h3', 'mv-editor-title', editing ? `Edit ${displayName(model)}` : copying ? 'Add a copy' : 'Add model'));
  if (steps) head.appendChild(stepNames(doc));
  const close = h(doc, 'button', 'btn btn-quiet btn-sm btn-icon mdl-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.appendChild(icon(doc, 'x', 16));
  head.appendChild(close);
  root.appendChild(head);

  const grid = h(doc, 'div', 'mv-editor-grid');
  const labelInput = h(doc, 'input', 'input mv-label');
  labelInput.type = 'text';
  labelInput.placeholder = 'Display name (defaults to the id)';
  labelInput.value = editing ? (model.label === model.id ? '' : model.label) : copying ? label : '';
  grid.appendChild(fieldOf(doc, 'Name', labelInput));

  const idInput = h(doc, 'input', 'input mv-id');
  idInput.type = 'text';
  idInput.placeholder = idPlaceholder(engineNow);
  idInput.value = editing ? model.id : copying ? id : '';
  idInput.disabled = editing; // the id IS the reference — delete + re-add to rename
  // Typing an id stops the editor from deriving one from the provider and upstream model (applyConnectionModeIn); a
  // copy's id is given.
  if (copying) idInput.dataset.auto = 'off';
  if (!editing && typeof idInput.addEventListener === 'function') idInput.addEventListener('input', () => { idInput.dataset.auto = 'off'; });
  grid.appendChild(fieldOf(doc, 'ID', idInput, { tip: editing ? '' : TIPS.id }));

  // The harness of a sign-in (all eight, beta ones marked) or of a custom endpoint (Claude Code only). A sibling of the
  // connection, never inside it, so an engine change is not also a connection change (app.js). Fixed once created.
  const engineSel = h(doc, 'select', 'select mv-engine');
  for (const v of MODEL_ENGINE_NAMES) {
    const o = doc.createElement('option');
    o.value = v; o.textContent = engineChoiceLabel(v);
    engineSel.appendChild(o);
  }
  engineSel.value = engineNow;
  engineSel.disabled = editing;
  // FRM-1: the picked harness's mark inside the select; the label still names the select.
  grid.appendChild(fieldOf(doc, 'Harness', markedSelect(doc, engineSel, 'harness'), { tip: editing ? TIPS.harnessFixed : TIPS.harness, names: engineSel }));

  // ── Connection (model-bridge-design.md §8.3): Provider and Upstream model id here, its folds after Pricing ──
  const connEl = renderConnectionSection(model, { doc, providers, copilotModels, where: whereNow, provider });
  if (editing) connEl.dataset.editing = '1';
  // setConnectionWhere runs the form's own rules after the connection's: the harness, a new form's engine, Save.
  connEl._applyEditor = () => applyConnectionModeIn(root);
  grid.appendChild(connEl);

  // Env vars (FRM-2): Claude Code's only (setModelEngine hides them on every other harness).
  const envWrap = h(doc, 'div', 'mv-env');
  const rows = model && model.env ? Object.entries(model.env) : [];
  for (const [k, v] of rows) envWrap.appendChild(envRow(doc, k, v));
  // A new custom endpoint starts with the two it needs.
  if (!model && whereNow === 'env') for (const k of ENDPOINT_ENV_KEYS) envWrap.appendChild(starterRow(doc, k));
  const envField = fieldOf(doc, 'Env vars', envWrap, { tip: TIPS.env });
  envField.classList.add('mv-wide');   // Env vars, Efforts and Pricing take the whole width
  const envBtns = h(doc, 'div', 'mv-env-btns');
  const add = h(doc, 'button', 'btn mv-env-add', 'Env var');
  add.prepend(icon(doc, 'plus', 14));
  add.type = 'button';
  envBtns.appendChild(add);
  if (rows.length) {
    // Reveal toggle: swaps the masked inputs to the REAL stored values (the
    // user owns them on disk in ~/.worca-cc/settings.json). app.js wires it.
    const reveal = h(doc, 'button', 'btn mv-env-reveal', 'Show values');
    reveal.type = 'button';
    reveal.title = 'Reveal the real stored values';
    envBtns.appendChild(reveal);
  }
  // Beside the button: the first refused name (paintEditorSave), else what the rows are for.
  const problem = h(doc, 'span', 'mdl-st fail mv-env-problem');
  problem.hidden = true;
  envBtns.append(problem, h(doc, 'span', 'mv-env-note'));
  envField.appendChild(envBtns);
  grid.appendChild(envField);

  const effWrap = h(doc, 'div', 'mv-efforts');
  const effortList = lists[engineNow] || efforts;
  const selected = new Set(model && Array.isArray(model.efforts) ? model.efforts : effortList);
  for (const lab of effortBoxes(doc, effortList, selected)) effWrap.appendChild(lab);
  const effField = fieldOf(doc, 'Efforts', effWrap);
  effField.classList.add('mv-wide');
  effField.appendChild(h(doc, 'small', 'hint mv-efforts-hint', 'All checked = every effort (the default).'));   // applyConnectionMode rewrites it
  grid.appendChild(effField);

  // ── Pricing (opt-in per-model cost override, config.mjs resolveModelCost) ──
  // The CLI computes total_cost_usd from its OWN table keyed on the model NAME,
  // so an on-prem/proxied endpoint gets a fabricated figure worca cannot tell
  // from a real one. Three mutually exclusive modes; the default is unchanged
  // behavior. The segment is the face; the radios under it stay the mode's one
  // state (collectModelEditor, setModelCost and app.js read them), hidden.
  const costWrap = h(doc, 'div', 'mv-cost-edit');
  const seg = h(doc, 'div', 'seg mv-cost-seg');
  const modes = h(doc, 'div', 'mv-cost-modes');
  modes.hidden = true;
  const groupName = `mv-cost-mode-${editing ? model.id : 'new'}`;
  for (const [value, text] of COST_MODES) {
    const b = h(doc, 'button', null, text);
    b.type = 'button'; b.dataset.mode = value; b.setAttribute('aria-pressed', 'false');
    seg.appendChild(b);
    const lab = h(doc, 'label', 'mv-cost-mode');
    const rb = h(doc, 'input', 'mv-cost-mode-rb');
    rb.type = 'radio'; rb.name = groupName; rb.value = value;
    lab.appendChild(rb);
    lab.appendChild(h(doc, 'span', null, text));
    modes.appendChild(lab);
  }
  seg.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-mode]') : null;
    if (!b) return;
    for (const rb of modes.querySelectorAll('.mv-cost-mode-rb')) rb.checked = rb.value === b.dataset.mode;
    applyCostMode(root);
  });
  costWrap.append(seg, modes);

  const rates = h(doc, 'div', 'mv-cost-rates');
  for (const [key, labelText] of COST_RATES) {
    const lab = h(doc, 'label', 'mv-cost-rate');
    lab.appendChild(h(doc, 'span', 'mv-cost-rate-label', labelText));
    const inp = h(doc, 'input', 'input mv-cost-rate-in');
    inp.type = 'number'; inp.min = '0'; inp.step = '0.01'; inp.placeholder = '0';
    inp.dataset.rate = key;
    lab.appendChild(inp);
    lab.appendChild(h(doc, 'span', 'mv-cost-rate-unit', '$/Mtok'));
    rates.appendChild(lab);
  }
  costWrap.appendChild(rates);
  const pricingField = fieldOf(doc, 'Pricing', costWrap, { tip: TIPS.pricing, names: seg });
  pricingField.classList.add('mv-wide');
  grid.appendChild(pricingField);

  // The connection's folds (FRM-4) after Pricing, which stays outside the connection (app.js onModelsConnChange).
  const more = connEl.querySelector('.mv-conn-more');
  if (more) grid.appendChild(more);
  root.appendChild(grid);

  setModelCost(root, model ? model.cost : null); // grid is attached now — the block is reachable from root
  root.dataset.engine = engineNow;
  setModelEngine(root, engineNow);   // the fields by harness, and the Connection narrowed to it
  applyConnectionModeIn(root);       // where it runs: the harness field, the suggested id, the provider's state word
  const msg = h(doc, 'p', 'form-msg mv-editor-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);

  const btns = h(doc, 'div', 'mv-editor-btns');
  const button = (cls, text) => { const b = h(doc, 'button', cls, text); b.type = 'button'; return b; };
  if (steps) btns.appendChild(button('btn mv-back', 'Back'));
  if (editing) btns.appendChild(button('btn btn-quiet mv-rewhere', 'Change where it runs'));
  btns.append(button('btn mv-cancel', 'Cancel'), button('btn btn-primary mv-save', editing ? 'Save' : 'Add model'));
  root.appendChild(btns);
  // Save follows the id and the env rows as they are typed (delegated: app.js adds rows later).
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('input', (e) => {
      if (e.target && e.target.closest && e.target.closest('.mv-id, .mv-env-row')) paintEditorSave(root);
    });
  }
  paintEditorSave(root);
  return root;
}

/** The effort checkboxes for one engine's list; `selected` null = all checked. */
function effortBoxes(doc, list, selected) {
  return list.map((e) => {
    const lab = h(doc, 'label', 'mv-effort');
    const cb = h(doc, 'input', 'mv-effort-cb');
    cb.type = 'checkbox'; cb.value = e; cb.checked = selected ? selected.has(e) : true;
    lab.appendChild(cb);
    lab.appendChild(h(doc, 'span', null, e));
    return lab;
  });
}

/**
 * Put an editor on an engine (§3.1a): the effort checkboxes become that engine's list (all
 * checked) when the engine changes, the routing env hides for every harness but Claude Code, the ID's
 * placeholder follows the harness, and the Connection offers the engine only what it can reach (bridge-view
 * applyConnectionMode, wheresFor). The ONE place that knows the rule — the initial render, the select's change
 * handler (app.js) and "+ Add model…" from a Codex New pipeline all go through it. Safe on any editor.
 * @param {Element} rootEl the .mv-editor root
 * @param {'claude'|'codex'|'copilot'|'cursor'|'gemini'|'goose'|'opencode'|'qwen'} engine
 */
export function setModelEngine(rootEl, engine) {
  const sel = rootEl && rootEl.querySelector('.mv-engine');
  if (!sel) return;
  const next = MODEL_ENGINE_NAMES.includes(engine) ? engine : 'claude';
  sel.value = next;
  paintMarkedSelect(sel.closest('.mdl-picksel'));
  if (rootEl.dataset.engine !== next) {
    let lists = {};
    try { lists = JSON.parse(rootEl.dataset.effortLists || '{}') || {}; } catch { lists = {}; }
    const wrap = rootEl.querySelector('.mv-efforts');
    if (wrap) wrap.replaceChildren(...effortBoxes(rootEl.ownerDocument, lists[next] || [], null));
    rootEl.dataset.engine = next;
  }
  const noEnv = next !== 'claude';
  const envField = rootEl.querySelector('.mv-env')?.closest('.mv-field');
  if (envField) envField.hidden = noEnv;
  // A sign-in engine's model that reports no cost: its price matters only to a chat on it (the per-turn cost cap and the
  // chat's spend, src/core/ask/chat-price.mjs), so the field shows for a Chat engine (Gemini CLI, Qwen Code) and hides
  // for Cursor; Goose and OpenCode price their own runs. A field with no effort hides (Cursor).
  const signIn = SIGN_IN_ENGINE_NAMES.includes(next);
  const pricing = rootEl.querySelector('.mv-cost-edit')?.closest('.mv-field');
  if (pricing) pricing.hidden = signIn && !engineReportsCost(next) && !CHAT_ENGINE_NAMES.includes(next);
  const effField = rootEl.querySelector('.mv-efforts')?.closest('.mv-field');
  let nextEfforts = [];
  try { nextEfforts = (JSON.parse(rootEl.dataset.effortLists || '{}') || {})[next] || []; } catch { nextEfforts = []; }
  if (effField) effField.hidden = signIn && !nextEfforts.length;
  const idIn = rootEl.querySelector('.mv-id');
  if (idIn) idIn.placeholder = idPlaceholder(next);
  const conn = rootEl.querySelector('.mv-conn');
  if (conn) { conn.dataset.engine = next; applyConnectionMode(conn); }
  paintHarness(rootEl);
  paintEditorSave(rootEl);
}

/**
 * Load a `cost` override into an editor: pick the matching mode and fill the
 * rates. The ONE place that maps a stored cost onto the form, shared by the
 * initial render and by "Edit a copy"'s prefill of a plugin model's pricing —
 * a second implementation of this mapping is exactly how the two would drift.
 * Safe on an editor with no pricing block. Pass null/undefined for no override.
 * @param {Element} rootEl  the .mv-editor root
 * @param {{free?:boolean, perMtok?:Record<string,number>}|null} [cost]
 */
export function setModelCost(rootEl, cost) {
  const rates = rootEl && rootEl.querySelector('.mv-cost-rates');
  if (!rates) return;
  const mode = !cost ? 'cli' : (cost.free ? 'free' : 'perMtok');
  for (const rb of rootEl.querySelectorAll('.mv-cost-mode-rb')) rb.checked = rb.value === mode;
  const p = cost && cost.perMtok && typeof cost.perMtok === 'object' ? cost.perMtok : {};
  for (const inp of rootEl.querySelectorAll('.mv-cost-rate-in')) {
    const v = p[inp.dataset.rate];
    inp.value = v == null ? '' : String(v);
  }
  applyCostMode(rootEl);
}

/**
 * Show the per-Mtok rate inputs only in that mode, and press the segment's button for the mode. The single place
 * that knows the rule, so the initial render, the segment's click and the delegated `change` handler in app.js can
 * never drift apart. Safe on an editor with no pricing block.
 * @param {Element} rootEl  the .mv-editor root
 */
export function applyCostMode(rootEl) {
  const rates = rootEl && rootEl.querySelector('.mv-cost-rates');
  if (!rates) return;
  const picked = rootEl.querySelector('.mv-cost-mode-rb:checked');
  const mode = picked ? picked.value : 'cli';
  rates.hidden = mode !== 'perMtok';
  for (const b of rootEl.querySelectorAll('.mv-cost-seg button[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
}

/** app.js exposes envRow creation to the delegated mv-env-add handler. */
export function makeEnvRow({ doc = globalThis.document } = {}) {
  return envRow(doc);
}

/** A new row named `key` (makeEnvRow with the key set): never envRow(doc, key), which would mark it stored (data-key and
 *  a copy button). */
function starterRow(doc, key) {
  const row = makeEnvRow({ doc });
  row.querySelector('.mv-env-key').value = key;
  return row;
}

/** rows: [{ key, value }]; → '' or the first problem, in this order:
 *  'WORCA_ names are reserved'; '<NAME> is set by the provider' (provider models: ANTHROPIC_BASE_URL,
 *  ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_MODEL); 'Two variables share a name'; 'Name the variable'
 *  (a value with no name); 'ANTHROPIC_BASE_URL needs a value' (`endpoint`, a custom endpoint: no row names
 *  ANTHROPIC_BASE_URL with a value, so it would save as a sign-in). */
export function envRowsProblem(rows, { provider = false, endpoint = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const names = list.map((r) => String((r && r.key) ?? '').trim()).filter(Boolean);
  if (names.some((k) => k.startsWith('WORCA_'))) return 'WORCA_ names are reserved';
  const owned = provider ? names.find((k) => PROVIDER_ENV_KEYS.includes(k)) : '';
  if (owned) return `${owned} is set by the provider`;
  if (names.some((k, i) => names.indexOf(k) !== i)) return 'Two variables share a name';
  if (list.some((r) => !String((r && r.key) ?? '').trim() && String((r && r.value) ?? '').trim())) return 'Name the variable';
  if (endpoint && !list.some((r) => String((r && r.key) ?? '').trim() === 'ANTHROPIC_BASE_URL' && String((r && r.value) ?? '').trim())) return 'ANTHROPIC_BASE_URL needs a value';
  return '';
}

/** ed: a .mv-editor → disables .mv-save (empty id, a taken id on add/copy, an env problem) and writes the problem. */
export function paintEditorSave(ed) {
  if (!ed || !ed.querySelector) return;
  const provider = connectionWhere(ed) === 'provider';
  const endpoint = connectionWhere(ed) === 'env';
  // Env vars count only while the field shows (Claude Code's): collect sends none for any other harness.
  const envField = ed.querySelector('.mv-env')?.closest('.mv-field');
  const rows = [...ed.querySelectorAll('.mv-env .mv-env-row')].map((r) => ({ key: r.querySelector('.mv-env-key')?.value || '', value: r.querySelector('.mv-env-val')?.value || '' }));
  const problem = envField && !envField.hidden ? envRowsProblem(rows, { provider, endpoint }) : '';
  const out = ed.querySelector('.mv-env-problem');
  if (out) { out.textContent = problem; out.hidden = !problem; }
  const note = ed.querySelector('.mv-env-note');
  if (note) {
    note.hidden = !!problem;
    note.textContent = provider ? 'Passed to Claude Code. The provider sets the address, key and model itself.' : 'Passed to Claude Code when this model runs.';
  }
  const save = ed.querySelector('.mv-save');
  if (!save || save.dataset.fbState === 'busy') return;   // a request in flight owns the button (feedback.mjs withButton)
  const id = (ed.querySelector('.mv-id')?.value || '').trim();
  const taken = ed.dataset.mode !== 'edit' && !!id && (ed.dataset.takenIds || '').split('\n').includes(id.toLowerCase());
  save.disabled = !id || taken || !!problem;
}

/**
 * Move a form to another place to run ("Change where it runs" › Continue): the ONE mover app.js calls, so the kind Save
 * sends is the one picked. Into a custom endpoint (`env`) from elsewhere it adds an ANTHROPIC_BASE_URL and an
 * ANTHROPIC_AUTH_TOKEN row where no row names them (new rows, as a new custom endpoint starts: FRM-2); out of `env` it
 * removes the rows naming them (an edit then sends them as null through data-env-keys). Then setConnectionWhere's rules
 * and paintEditorSave. The rows follow where the form lands: an edit whose harness cannot run at `where` falls back to
 * its sign-in (applyConnectionMode), and the same where touches no row.
 * @param {Element} ed  the .mv-editor root
 * @param {'signin'|'env'|'provider'} where
 */
export function setFormWhere(ed, where) {
  if (!ed || !ed.querySelector) return;
  const prev = connectionWhere(ed);
  setConnectionWhere(ed, where);
  const now = connectionWhere(ed);
  const wrap = ed.querySelector('.mv-env');
  const keyOf = (row) => (row.querySelector('.mv-env-key')?.value || '').trim();
  if (wrap && now !== prev && now === 'env') {
    const named = new Set([...wrap.querySelectorAll('.mv-env-row')].map(keyOf));
    for (const k of ENDPOINT_ENV_KEYS) if (!named.has(k)) wrap.appendChild(starterRow(ed.ownerDocument, k));
  } else if (wrap && now !== prev && prev === 'env') {
    for (const row of [...wrap.querySelectorAll('.mv-env-row')]) if (ENDPOINT_ENV_KEYS.includes(keyOf(row))) row.remove();
  }
  paintEditorSave(ed);
}

/** The harness field shows unless the model runs through a provider; a custom endpoint offers Claude Code only. */
function paintHarness(rootEl) {
  const sel = rootEl.querySelector('.mv-engine');
  const field = sel && sel.closest('.mv-field');
  if (!field) return;
  const where = connectionWhere(rootEl);
  field.hidden = where === 'provider';
  for (const o of sel.options) o.hidden = o.disabled = where === 'env' && o.value !== 'claude';
}

/** The state word beside the Provider select: the Catalogue's (provider-state.mjs) for the row selected — OpenRouter's
 *  own row for OpenRouter — and nothing without a Providers payload. */
function paintProviderState(rootEl, conn) {
  const word = rootEl.querySelector('.mv-conn-provider-hint');
  if (!word) return;
  const choice = rootEl.querySelector('.mv-conn-provider')?.value || '';
  paintMarkedSelect(rootEl.querySelector('.mv-conn-provider')?.closest('.mdl-picksel'));   // a pick made by code too
  const st = conn._providers && choice ? providerState(conn._providers, choice, { hasModels: true }) : null;
  word.hidden = !st || !st.text;
  word.textContent = st ? st.text : '';
  word.className = `mdl-st mv-conn-provider-hint${st ? ` ${st.tone}` : ''}`;
}

/**
 * Collect the editor into a request body. For EDIT mode the env is a write-only
 * PATCH: unchanged masked values are echoed (the server treats them as "keep"),
 * removed keys are sent as null. Returns { id, body } — id is null in create
 * mode (POST carries it in the body instead). A copy adds `copyFrom` while a
 * masked echo is left in `env` or `upstream.apiKey`: the server takes each one's
 * real value from that model. Typed over, none is left, and the add no longer
 * needs the source (which may have been deleted since).
 */
export function collectModelEditor(rootEl) {
  const editing = rootEl.dataset.mode === 'edit';
  const id = editing ? rootEl.dataset.id : (rootEl.querySelector('.mv-id')?.value || '').trim();
  const label = (rootEl.querySelector('.mv-label')?.value || '').trim();
  const efforts = [...rootEl.querySelectorAll('.mv-effort-cb')].filter((c) => c.checked).map((c) => c.value);
  const allCount = rootEl.querySelectorAll('.mv-effort-cb').length;
  const engineValue = rootEl.querySelector('.mv-engine')?.value;
  const engine = MODEL_ENGINE_NAMES.includes(engineValue) ? engineValue : 'claude';
  const copyFrom = editing ? '' : rootEl.dataset.copyFrom || '';

  const env = {};
  const seen = new Set();
  for (const row of rootEl.querySelectorAll('.mv-env-row')) {
    const k = (row.querySelector('.mv-env-key')?.value || '').trim();
    const v = row.querySelector('.mv-env-val')?.value ?? '';
    if (!k) continue;
    seen.add(k);
    env[k] = v;
  }
  if (editing) {
    // Keys the stored entry had but the editor no longer shows -> delete (null).
    for (const k of (rootEl.dataset.envKeys || '').split('\n').filter(Boolean)) {
      if (!seen.has(k)) env[k] = null;
    }
  }

  // Pricing. The editor renders the STORED override, so it round-trips: a user
  // who came to change a label leaves it untouched. 'cli' is therefore an
  // explicit CLEAR (null), not an omission — it is what the form now shows.
  // Rate values are sent raw for the server to validate (settings.mjs
  // assertModelCost owns the rules; duplicating them here would let them drift).
  const mode = rootEl.querySelector('.mv-cost-mode-rb:checked')?.value || 'cli';
  let cost = null;
  if (mode === 'free') cost = { free: true };
  else if (mode === 'perMtok') {
    const perMtok = {};
    for (const inp of rootEl.querySelectorAll('.mv-cost-rate-in')) {
      const raw = (inp.value ?? '').trim();
      if (raw !== '') perMtok[inp.dataset.rate] = Number(raw);
    }
    cost = { perMtok };   // empty -> the server rejects it by name, surfaced in the form
  }

  // Connection (model-bridge-design.md §8.3): the object to store, or null to
  // clear — like 'cli' for pricing, the form shows the truth.
  const { upstream } = collectConnection(rootEl);
  const sentEnv = engine !== 'claude' ? {} : env;
  const masked = Object.values(sentEnv).some(isMaskedEcho) || isMaskedEcho(upstream && upstream.apiKey);

  const body = {
    ...(editing ? {} : { id }),
    ...(!editing && engine !== 'claude' ? { engine } : {}),
    label,
    // All boxes checked = the full set = store the default (empty).
    efforts: efforts.length === allCount ? [] : efforts,
    env: sentEnv,
    cost,
    // Create mode has nothing to clear, so a null upstream is simply omitted
    // and the POST body stays byte-identical for a non-bridged entry.
    ...(upstream === undefined || (!editing && upstream === null) ? {} : { upstream }),
    ...(copyFrom && masked ? { copyFrom } : {}),
  };
  return { id: editing ? id : null, body };
}

/** applyConnectionMode over an editor root (re-exported here so app.js's one delegated `change` handler for the editor
 *  needs a single import), then the form's own rules for where the model runs: a new form's harness, the harness
 *  field, the suggested id, the provider's state word and Save. */
export function applyConnectionModeIn(rootEl) {
  const conn = rootEl && rootEl.querySelector && rootEl.querySelector('.mv-conn');
  if (!conn) return;
  applyConnectionMode(conn);
  const where = connectionWhere(conn);
  const creating = rootEl.dataset.mode !== 'edit';
  // A new form (or a copy) whose harness cannot run where it was put becomes Claude Code's: routing env is Claude
  // Code's, a provider Claude Code's or Codex's (wheresFor). An edit keeps its harness (applyConnectionMode fell back).
  if (creating && rootEl.dataset.engine && !wheresFor(rootEl.dataset.engine).includes(where)) setModelEngine(rootEl, 'claude');
  paintHarness(rootEl);
  // Through a provider, a new entry's id defaults to <provider>-<upstream id> until the user types one: a built-in
  // id names a harness's own sign-in, so the gateway's twin of gpt-5.5 is openai-gpt-5.5 (OpenRouter's too).
  const idIn = rootEl.querySelector('.mv-id');
  const upstreamId = (conn.querySelector('.mv-conn-model')?.value || '').trim();
  if (creating && idIn && idIn.dataset.auto !== 'off' && where === 'provider' && upstreamId) {
    idIn.value = suggestModelHandle(upstreamId, conn.dataset.provider || 'openai');
    idIn.dataset.auto = 'on';
  }
  paintProviderState(rootEl, conn);
  paintEditorSave(rootEl);
}

// ── Share-as-plugin export wizard (design §9.5) ─────────────────────────────

/**
 * Share as plugin (DESIGN SHR-1, SHR-2): pick global models, set each env var's policy, name the plugin, choose a
 * destination folder. `globals` are MASKED entries from GET /api/models (only KEYS matter here — values are read
 * server-side at export). Returns detached DOM: section.card.mv-editor.mvx (no .dlg; the opener lays it out) >
 * div.mvx-head (the title, Close), three div.mvx-step parts ("1 Models", "2 Env vars", "3 Plugin"), p.mvx-msg,
 * div.mv-editor-btns (Cancel, Export scaffold last — disabled until a model is ticked and a name and a folder are given).
 * Each env var's segment drives its hidden select.mvx-mode, the choice's one state (collectExportWizard reads it).
 * app.js wires mdl-close, mvx-cancel and mvx-export.
 */
export function renderExportWizard(globals, { doc = globalThis.document } = {}) {
  const root = h(doc, 'section', 'card mv-editor mvx');
  const head = h(doc, 'div', 'mvx-head');
  head.appendChild(h(doc, 'h3', 'mv-editor-title', 'Share as plugin'));
  const close = h(doc, 'button', 'btn btn-quiet btn-sm btn-icon mdl-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.appendChild(icon(doc, 'x', 16));
  head.appendChild(close);
  root.appendChild(head);

  // A numbered part; the rule its hint carried is the ⓘ tip beside its name (L18).
  const step = (title, name, tip) => {
    const s = h(doc, 'div', 'mvx-step');
    s.appendChild(h(doc, 'h4', 'mvx-step-title', title));
    if (tip) s.appendChild(infoTip(doc, name, tip));
    root.appendChild(s);
    return s;
  };

  const pick = step('1 Models', 'Models', 'Only your global models can be shared.');
  if (globals.length) {
    const list = h(doc, 'div', 'mvx-models');
    for (const m of globals) {
      const lab = h(doc, 'label', 'mvx-model opt-row');
      const cb = h(doc, 'input', 'mvx-model-cb');
      cb.type = 'checkbox'; cb.value = m.id;
      cb.dataset.envKeys = Object.keys(m.env || {}).join('\n');
      lab.append(cb, modelMark(doc, m, 'sm'), h(doc, 'span', 'opt-name', displayName(m)));
      list.appendChild(lab);
    }
    pick.appendChild(list);
  } else pick.appendChild(h(doc, 'div', 'hist-empty', 'No global models to share yet.'));

  // One env var: its name, the credential badge where SECRETISH_RE matches, and the segment over the hidden
  // select.mvx-mode (include | secret | omit; a credential starts at "Require at install"). A pick sets the select and
  // fires a bubbling `change`, as a select's own pick would.
  const shareEnvRow = (key) => {
    const row = h(doc, 'div', 'mvx-env-row');
    row.dataset.key = key;
    row.appendChild(h(doc, 'span', 'mono mvx-env-key', key));
    const credential = SECRETISH_RE.test(key);
    if (credential) row.appendChild(h(doc, 'span', 'badge mvx-warn', 'Looks like a credential'));
    const seg = h(doc, 'div', 'seg mvx-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', key);
    const sel = h(doc, 'select', 'select mvx-mode');
    sel.hidden = true;
    for (const [v, label] of [['include', 'Include value'], ['secret', 'Require at install'], ['omit', 'Omit']]) {
      const opt = h(doc, 'option', null, label);
      opt.value = v;
      sel.appendChild(opt);
      const b = h(doc, 'button', null, label);
      b.type = 'button';
      b.dataset.mode = v;
      seg.appendChild(b);
    }
    sel.value = credential ? 'secret' : 'include';
    const paint = () => {
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === sel.value));
    };
    seg.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button[data-mode]') : null;
      if (!b || b.dataset.mode === sel.value) return;
      sel.value = b.dataset.mode;
      const ev = doc.createEvent('Event');
      ev.initEvent('change', true, false);
      sel.dispatchEvent(ev);
    });
    sel.addEventListener('change', paint);
    paint();
    row.append(seg, sel);
    return row;
  };

  const envKeys = [...new Set(globals.flatMap((m) => Object.keys(m.env || {})))];
  const pol = step('2 Env vars', 'Env vars',
    'Include value commits the stored value to the plugin (it will live in a git repo). ' +
    'Require at install strips it: teammates are prompted once and the value stays on their machine.');
  if (envKeys.length) {
    const list = h(doc, 'div', 'mvx-envs');
    for (const k of envKeys) list.appendChild(shareEnvRow(k));
    pol.appendChild(list);
  } else pol.appendChild(h(doc, 'small', 'hint', 'No env vars on your models. Nothing to decide.'));

  const meta = step('3 Plugin');
  const fields = h(doc, 'div', 'mvx-fields');
  const field = (labelText, cls, placeholder, { tip = '', wide = false } = {}) => {
    const input = h(doc, 'input', `input ${cls}`);
    input.type = 'text'; input.placeholder = placeholder;
    const wrap = fieldOf(doc, labelText, input, { tip });
    if (wide) wrap.classList.add('mvx-wide');
    fields.appendChild(wrap);
    return input;
  };
  const name = field('Plugin name', 'mvx-name', 'team-models', { tip: 'Kebab-case: it becomes the folder name and the install name.' });
  field('Version', 'mvx-version', '0.1.0');
  field('Description', 'mvx-desc', 'What these models are for', { wide: true });
  const dest = field('Destination folder', 'mvx-dest', '~/dev/team-models',
    { wide: true, tip: 'Must be new or empty. The scaffold goes here. Run git init + push it to share.' });
  meta.appendChild(fields);

  const msg = h(doc, 'p', 'form-msg mvx-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);
  const btns = h(doc, 'div', 'mv-editor-btns');
  const cancel = h(doc, 'button', 'btn mvx-cancel', 'Cancel');
  cancel.type = 'button';
  const go = h(doc, 'button', 'btn btn-primary mvx-export', 'Export scaffold');
  go.type = 'button';
  btns.append(cancel, go);
  root.appendChild(btns);

  // Export scaffold waits for a ticked model, a name and a folder (SHR-2): the boxes change, the fields take input.
  const paintExport = () => {
    const ticked = [...root.querySelectorAll('.mvx-model-cb')].some((cb) => cb.checked);
    go.disabled = !ticked || !name.value.trim() || !dest.value.trim();
  };
  root.addEventListener('change', paintExport);
  root.addEventListener('input', paintExport);
  paintExport();
  return root;
}

/** Collect the wizard into the POST /api/models/export-plugin body. */
export function collectExportWizard(rootEl) {
  const modes = {};
  for (const row of rootEl.querySelectorAll('.mvx-env-row')) {
    modes[row.dataset.key] = row.querySelector('.mvx-mode')?.value || 'include';
  }
  const models = [...rootEl.querySelectorAll('.mvx-model-cb')]
    .filter((cb) => cb.checked)
    .map((cb) => ({
      id: cb.value,
      env: Object.fromEntries((cb.dataset.envKeys || '').split('\n').filter(Boolean)
        .map((k) => [k, modes[k] || 'include'])),
    }));
  const val = (cls) => (rootEl.querySelector(`.${cls}`)?.value || '').trim();
  return {
    name: val('mvx-name'),
    description: val('mvx-desc'),
    ...(val('mvx-version') ? { version: val('mvx-version') } : {}),
    dest: val('mvx-dest'),
    models,
  };
}

/** Human summary of what deleting `id` clears, for the confirmation prompt (PAN-7). `refs` is the refs
 *  read: `{}` or `null` (a failed read) counts nothing. One count of every job the delete clears: the user-level
 *  jobs, the project steps and nodes, and Settings › Memory's defragment pick when no job already counts it. */
export function deleteRefsSummary(id, refs) {
  if (refs && refs.predefinedShadow) {
    return `Remove the override of built-in "${id}"? The built-in entry comes back; nothing else changes.`;
  }
  const list = (key) => (refs && Array.isArray(refs[key]) ? refs[key] : []);
  const jobs = list('jobs');
  // Claude's defragment pick is also a job; Codex's memoryDefrag job is another pick.
  const defrag = !!(refs && refs.memoryDefrag) && !jobs.some((j) => j && j.engine === 'claude' && j.key === 'memoryDefrag');
  const n = jobs.length + list('steps').length + list('nodes').length + (defrag ? 1 : 0);
  if (!n) return `Delete model "${id}"? No job uses it.`;
  return n === 1
    ? `Delete model "${id}"? This also clears 1 job that uses it.`
    : `Delete model "${id}"? This also clears ${n} jobs that use it.`;
}
