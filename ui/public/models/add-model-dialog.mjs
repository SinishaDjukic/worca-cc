// ui/public/models/add-model-dialog.mjs — Add model (models-menu P5, DESIGN ADD-1…ADD-4): step 1 "Where it runs" (three
// radio cards, the provider select with its state, the harness tiles) and step 2's list screen (the toolbar, the
// message, the mount the import sheet goes into, the blocked box and the foot). Pure DOM: `doc` is injected, nothing is
// fetched. Each screen is a section.card without .dlg: app.js lays it out (layoutDialog), mounts it in the model editor
// modal and handles its buttons by class; step 1 wires only its own cards, select and tiles.
import { icon } from '../icons.mjs';
import { ENDPOINT_PRESETS, OPENROUTER_PRESET, infoTip, wheresFor } from '../bridge-view.mjs';
import { providerState } from './provider-state.mjs';
import { renderHarnessTiles } from './harness-tiles.mjs';
import { markedSelect } from './brand-marks.mjs';

export const ADD_PROVIDERS = Object.freeze(['copilot', 'openrouter', 'openai', 'anthropic']);
export const ADD_PROVIDER_LABELS = Object.freeze({ copilot: 'GitHub Copilot', openrouter: 'OpenRouter', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' });
/** The providers a harness runs on. Codex speaks only OpenAI's API: OpenRouter and OpenAI-compatible, both of which the
 *  model form stores as `openai` (bridge-view's applyConnectionModeIn offers Codex nothing else). Claude Code, and a
 *  harness wheresFor gives no provider card, keep all four. */
const CODEX_PROVIDERS = Object.freeze(ADD_PROVIDERS.filter((p) => p === 'openrouter' || p === 'openai'));
const providersFor = (engine) => (engine === 'codex' ? CODEX_PROVIDERS : ADD_PROVIDERS);

/** Step 1's cards, in the order they show (ADD-2). */
const WHERE_CARDS = Object.freeze([
  Object.freeze({ where: 'provider', icon: 'cloud', title: 'A provider', text: ADD_PROVIDERS.map((p) => ADD_PROVIDER_LABELS[p]).join(', ') }),
  Object.freeze({ where: 'signin', icon: 'key', title: 'A sign-in', text: 'A CLI you are signed in to, such as Claude Code' }),
  Object.freeze({ where: 'env', icon: 'terminal', title: 'A custom endpoint', text: 'Set by env vars. Claude Code only' }),
]);
const WHERES = Object.freeze(WHERE_CARDS.map((c) => c.where));
/** The OpenAI-compatible list's hosted presets (ENDPOINT_PRESETS), as their buttons read. */
const PRESET_LABELS = Object.freeze({ gemini: 'Gemini', qwen: 'Qwen' });

let fieldSeq = 0;

const el = (doc, tag, cls, text) => {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const button = (doc, cls, text) => {
  const b = el(doc, 'button', cls, text);
  b.type = 'button';
  return b;
};

/** ol.mdl-steps: "1 Where it runs", "2 The model", the current one marked (ADD-1). */
function stepNames(doc, current) {
  const ol = el(doc, 'ol', 'mdl-steps');
  ol.setAttribute('aria-label', 'Steps');
  ['1 Where it runs', '2 The model'].forEach((name, i) => {
    const li = el(doc, 'li', null, name);
    if (i + 1 === current) li.setAttribute('aria-current', 'step');
    ol.appendChild(li);
  });
  return ol;
}

/** div.mdl-add-head: the title ("Add model" unless given), the step names (unless `steps` is false) and Close. */
function headOf(doc, step, { steps = true, title = '' } = {}) {
  const head = el(doc, 'div', 'mdl-add-head');
  head.appendChild(el(doc, 'h3', 'mv-editor-title', title || 'Add model'));
  if (steps) head.appendChild(stepNames(doc, step));
  const close = button(doc, 'btn btn-quiet btn-sm btn-icon mdl-close');
  close.setAttribute('aria-label', 'Close');
  close.appendChild(icon(doc, 'x', 16));
  head.appendChild(close);
  return head;
}

/** section.card.mdl-add[data-step]: the screen root. */
function screenOf(doc, step) {
  const root = el(doc, 'section', 'card mdl-add');
  root.dataset.step = String(step);
  return root;
}

/** select.mdl-add-provider over `offered` (ADD_PROVIDERS' order), `provider` picked, else the first offered. */
function providerSelect(doc, provider, offered = ADD_PROVIDERS) {
  const sel = el(doc, 'select', 'select mdl-add-provider');
  for (const p of offered) {
    const o = el(doc, 'option', null, ADD_PROVIDER_LABELS[p]);
    o.value = p;
    sel.appendChild(o);
  }
  sel.value = offered.includes(provider) ? provider : offered[0];
  return sel;
}

/** Step 1's provider part: the "Provider" select (with the picked provider's mark, ADD-2) and, with the providers
 *  known, its state word beside it. */
function providerPart(doc, root, provider, providers, offered) {
  const field = el(doc, 'div', 'mv-field mdl-add-pfield');
  const sel = providerSelect(doc, provider, offered);
  sel.id = `mdl-add-provider-${++fieldSeq}`;
  const label = el(doc, 'label', 'mv-field-label', 'Provider');
  label.htmlFor = sel.id;
  const row = el(doc, 'div', 'mdl-add-prow');
  row.appendChild(markedSelect(doc, sel, 'provider'));
  const paint = () => {
    row.querySelector('.mdl-st')?.remove();
    if (!providers) return;
    const s = providerState(providers, sel.value, { hasModels: true });
    row.appendChild(el(doc, 'span', `mdl-st ${s.tone}`, s.text));
  };
  sel.addEventListener('change', () => {
    root.dataset.provider = sel.value;
    paint();
  });
  paint();
  field.append(label, row);
  return field;
}

/** Step 1's sign-in part: the harness tiles, the pick kept on the root while the part is away (a locked `engine` is
 *  never the pick: the tiles press the first unlocked harness, and the root keeps that one). */
function harnessPart(doc, root, { engines, engine, locks }) {
  const field = el(doc, 'div', 'mv-field mdl-add-hfield');
  const tiles = renderHarnessTiles(doc, { engines, picked: engine, locks, label: 'Harness' });
  const pressed = tiles.querySelector('.mdl-hx-t[aria-pressed="true"]');
  if (pressed) root.dataset.engine = pressed.dataset.engine;
  tiles.addEventListener('click', (e) => {
    const tile = e.target.closest && e.target.closest('.mdl-hx-t');
    if (tile && !tile.disabled) root.dataset.engine = tile.dataset.engine;
  });
  const label = el(doc, 'span', 'mv-field-label', 'Harness');
  label.setAttribute('aria-hidden', 'true');
  field.append(label, tiles);
  return field;
}

/** button.mdl-opt[role=radio]: the kind's icon, the title and what it covers. */
function whereCard(doc, card, { checked, disabled, text = card.text }) {
  const b = button(doc, 'mdl-opt');
  b.setAttribute('role', 'radio');
  b.dataset.where = card.where;
  b.setAttribute('aria-checked', String(checked));
  b.tabIndex = checked ? 0 : -1;
  b.disabled = disabled;
  const kind = el(doc, 'span', 'mdl-opt-kind');
  kind.appendChild(icon(doc, card.icon, 18));
  b.append(kind, el(doc, 'span', 'mdl-opt-t', card.title), el(doc, 'span', 'mdl-opt-d', text));
  return b;
}

/** state = { where: 'signin'|'provider'|'env', provider: 'copilot', engine: 'claude' } (the defaults).
 *  → section.card.mdl-add[data-step="1"]: head (h3.mv-editor-title "Add model"; ol.mdl-steps with li "1 Where it
 *    runs" [aria-current=step] and li "2 The model"; button.mdl-close); div[role=radiogroup][aria-label="Where it
 *    runs"] with three button.mdl-opt[role=radio][aria-checked][data-where] (span.mdl-opt-kind icon, span.mdl-opt-t,
 *    span.mdl-opt-d):
 *      provider "A provider" / "GitHub Copilot, OpenRouter, OpenAI-compatible, Anthropic-compatible"
 *      signin   "A sign-in"  / "A CLI you are signed in to, such as Claude Code"
 *      env      "A custom endpoint" / "Set by env vars. Claude Code only"
 *    provider: label "Provider" + select.mdl-add-provider (ADD_PROVIDER_LABELS) + span.mdl-st.<tone>
 *      (providerState(providers, p, { hasModels: true }); nothing when providers is null);
 *    signin: renderHarnessTiles(doc, { engines, picked: state.engine, locks, label: 'Harness' });
 *    foot: "Cancel" .mv-cancel, "Next" .mdl-next.btn-primary.
 *  fixedEngine (L26 "Change where it runs" on a saved model, whose harness stays): no tiles; a card whose where is
 *    not in wheresFor(fixedEngine) (Task 3) is disabled; "Next" reads "Continue"; no step names; `title` is the waiting
 *    form's own ("Edit <name>"), as the head still belongs to that edit (FRM-1). On Codex the provider
 *    card and its select offer only OpenRouter and OpenAI-compatible (a state.provider outside them falls back to
 *    OpenRouter, the first).
 *  The module wires its own clicks: a card moves aria-checked and shows its part; the select repaints the state.
 *  The cards are one tab stop (the checked one); the arrow keys move the pick across the enabled ones. */
export function renderAddStep1(state, { doc = globalThis.document, providers = null, engines = null, locks = [], fixedEngine = '', title = '' } = {}) {
  const s = state || {};
  const allowed = fixedEngine ? wheresFor(fixedEngine) : WHERES;
  const where = WHERES.includes(s.where) && allowed.includes(s.where) ? s.where : 'signin';
  const offered = providersFor(fixedEngine);
  const provider = offered.includes(s.provider) ? s.provider : offered[0];
  const engine = fixedEngine || s.engine || 'claude';

  const root = screenOf(doc, 1);
  root.dataset.where = where;
  root.dataset.provider = provider;
  root.dataset.engine = engine;
  if (fixedEngine) root.dataset.fixedEngine = fixedEngine;
  root.appendChild(headOf(doc, 1, { steps: !fixedEngine, title }));

  const main = el(doc, 'div', 'mdl-add-main');
  const group = el(doc, 'div', 'mdl-opts');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Where it runs');
  const offeredText = offered.map((p) => ADD_PROVIDER_LABELS[p]).join(', ');
  const cards = WHERE_CARDS.map((card) => whereCard(doc, card, {
    checked: card.where === where, disabled: !allowed.includes(card.where), text: card.where === 'provider' ? offeredText : card.text,
  }));
  group.append(...cards);

  // Each part is built once and kept while another card shows, so a pick made in it survives a round trip.
  const parts = {
    provider: providerPart(doc, root, provider, providers, offered),
    signin: fixedEngine ? null : harnessPart(doc, root, { engines, engine, locks }),
    env: null,
  };
  const partHost = el(doc, 'div', 'mdl-add-part');
  const show = (w) => {
    const part = parts[w];
    partHost.replaceChildren(...(part ? [part] : []));
    partHost.hidden = !part;
  };
  const pick = (card) => {
    root.dataset.where = card.dataset.where;
    for (const c of cards) {
      const on = c === card;
      c.setAttribute('aria-checked', String(on));
      c.tabIndex = on ? 0 : -1;
    }
    show(card.dataset.where);
  };
  for (const card of cards) card.addEventListener('click', () => { if (!card.disabled) pick(card); });
  group.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const enabled = cards.filter((c) => !c.disabled);
    const at = enabled.findIndex((c) => c.getAttribute('aria-checked') === 'true');
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (!next) return;
    e.preventDefault();
    pick(next);
    next.focus();
  });
  show(where);
  main.append(group, partHost);
  root.appendChild(main);

  const foot = el(doc, 'div', 'mdl-add-foot mv-editor-btns');
  foot.append(button(doc, 'btn mv-cancel', 'Cancel'), button(doc, 'btn btn-primary mdl-next', fixedEngine ? 'Continue' : 'Next'));
  root.appendChild(foot);
  return root;
}

/** → { where, provider, engine } from a step 1 screen: what shows, else what the screen kept while its part was away
 *  (with fixedEngine there are no tiles, and the screen keeps that engine). */
export function collectAddStep1(root) {
  const d = (root && root.dataset) || {};
  const card = root && root.querySelector('.mdl-opt[aria-checked="true"]');
  const sel = root && root.querySelector('select.mdl-add-provider');
  const tile = root && root.querySelector('.mdl-hx-t[aria-pressed="true"]');
  return {
    where: (card && card.dataset.where) || d.where || 'signin',
    provider: (sel && sel.value) || d.provider || ADD_PROVIDERS[0],
    engine: (tile && tile.dataset.engine) || d.engine || 'claude',
  };
}

/** A runtime id: the element also carries it as a class, because app.js reaches step 2's ids by class (ui-id-consistency). */
function withId(node, id) {
  node.id = id;
  node.classList.add(id);
  return node;
}

/** A text input of step 2's OpenAI-compatible row. */
function textInput(doc, id, placeholder, value = '') {
  const input = withId(el(doc, 'input', 'input'), id);
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = value;
  return input;
}

/** div.mv-field: label.mv-field-label[for] with an ⓘ tip beside it (L18: the rule sentence is the tip), then `body`. */
function tippedLabelField(doc, cls, labelText, forId, tip, body) {
  const field = el(doc, 'div', `mv-field ${cls}`);
  const row = el(doc, 'div', 'label-row');
  const label = el(doc, 'label', 'mv-field-label', labelText);
  label.htmlFor = forId;
  row.append(label, infoTip(doc, labelText, tip));
  field.append(row, body);
  return field;
}

/** Step 2's OpenAI-compatible row: Base URL with "List models" and the presets, then the optional key. */
function endpointRow(doc, baseUrl) {
  const box = el(doc, 'div', 'mdl-add-src');
  const base = textInput(doc, 'mimp-base', 'http://127.0.0.1:11434/v1', baseUrl);
  const line = el(doc, 'span', 'mimp-base-row');
  line.append(base, withId(button(doc, 'btn', 'List models'), 'mimp-list'));
  const presets = el(doc, 'span', 'mimp-presets');
  for (const name of Object.keys(ENDPOINT_PRESETS)) {
    const b = button(doc, 'btn btn-sm btn-quiet mimp-preset', PRESET_LABELS[name] || name);
    b.dataset.preset = name;
    presets.appendChild(b);
  }
  const baseBody = el(doc, 'div', 'mdl-add-base');
  baseBody.append(line, presets);
  box.appendChild(tippedLabelField(doc, 'mdl-add-basefield', 'Base URL', 'mimp-base',
    'llama.cpp, Ollama, LM Studio, vLLM or a gateway, on this machine or your network, or a hosted API such as Gemini or Qwen.',
    baseBody));
  const key = textInput(doc, 'mimp-key', ENDPOINT_PRESETS.gemini.keyRef);
  key.autocomplete = 'off';
  key.spellcheck = false;
  box.appendChild(tippedLabelField(doc, 'mdl-add-keyfield', 'API key (optional)', 'mimp-key',
    'For an endpoint that is not the OpenAI-compatible provider\'s: stored on each imported model. A ${VAR} keeps the key itself out of settings.json. The provider\'s own key is only ever sent to its own host.',
    key));
  return box;
}

/** state = { provider, baseUrl: '' }. Each element below with an id also carries the same name as a class
 *  (.mimp-base …): app.js looks them up by class (test/ui-id-consistency).
 *  → section.card.mdl-add[data-step="2"]: head (steps, "2 The model" current; .mdl-close);
 *    toolbar: select.mdl-add-provider, input#mimp-filter.input[type=search][data-dirty-ignore]
 *      [aria-label="Filter the listed models"][placeholder="Filter by model, id or vendor"] (always shown),
 *      button.btn.btn-quiet.mdl-manual "Enter an id instead";
 *    openai only: input#mimp-base (placeholder "http://127.0.0.1:11434/v1", value state.baseUrl or
 *      providers.openai.baseUrl), button#mimp-list "List models", button.mimp-preset[data-preset=gemini|qwen]
 *      "Gemini", "Qwen", input#mimp-key (label "API key (optional)", placeholder "${GEMINI_API_KEY}");
 *    p#mimp-msg[aria-live=polite]; div#mimp-body (app.js mounts the sheet here); p.hint.mdl-add-shown[hidden]
 *      ("N of M shown", paintAddList); div.mdl-add-blocked[hidden] (span.mdl-st + button.mdl-add-fix);
 *    foot: span.mdl-add-note, "Back" .mv-back, button#mimp-go.btn-primary "Add models" (disabled). */
export function renderAddStep2(state, { doc = globalThis.document, providers = null } = {}) {
  const s = state || {};
  const provider = ADD_PROVIDERS.includes(s.provider) ? s.provider : ADD_PROVIDERS[0];
  const root = screenOf(doc, 2);
  root.dataset.provider = provider;
  root.appendChild(headOf(doc, 2));

  const main = el(doc, 'div', 'mdl-add-main');
  const bar = el(doc, 'div', 'mdl-add-bar');
  const sel = providerSelect(doc, provider);
  sel.setAttribute('aria-label', 'Provider');
  const filter = withId(el(doc, 'input', 'input'), 'mimp-filter');
  filter.type = 'search';
  filter.dataset.dirtyIgnore = '';
  filter.setAttribute('aria-label', 'Filter the listed models');
  filter.placeholder = 'Filter by model, id or vendor';
  bar.append(markedSelect(doc, sel, 'provider'), filter, button(doc, 'btn btn-quiet mdl-manual', 'Enter an id instead'));
  main.appendChild(bar);
  if (provider === 'openai') main.appendChild(endpointRow(doc, s.baseUrl || providers?.openai?.baseUrl || ''));
  const msg = withId(el(doc, 'p', 'form-msg'), 'mimp-msg');
  msg.setAttribute('aria-live', 'polite');
  main.appendChild(msg);
  main.appendChild(withId(el(doc, 'div'), 'mimp-body'));
  const shown = el(doc, 'p', 'hint mdl-add-shown');
  shown.hidden = true;
  main.appendChild(shown);
  const blocked = el(doc, 'div', 'mdl-add-blocked');
  blocked.hidden = true;
  blocked.append(el(doc, 'span', 'mdl-st'), button(doc, 'btn btn-sm mdl-add-fix'));
  main.appendChild(blocked);
  root.appendChild(main);

  const foot = el(doc, 'div', 'mdl-add-foot mv-editor-btns');
  const go = withId(button(doc, 'btn btn-primary', 'Add models'), 'mimp-go');
  go.disabled = true;
  foot.append(el(doc, 'span', 'mdl-add-note', ''), button(doc, 'btn mv-back', 'Back'), go);
  root.appendChild(foot);
  return root;
}

/** What step 2 does before any request, from s = providerState(providers, row, { hasModels: true }):
 *  copilot: s.tone 'ok' (connected, or the broker's green state; there is no `copilot.brokered`) →
 *    { kind: 'list', source: 'copilot' }, else { kind: 'blocked', text: s.text, fix: s.fix || 'Sign in', row: 'copilot' };
 *  openrouter: s.tone 'ok' → { kind: 'list', source: 'endpoint', baseUrl: OPENROUTER_PRESET.baseUrl, auto: true },
 *    else { kind: 'blocked', text: s.text, fix: s.fix || 'Set key', row: 'openrouter' };
 *  openai: { kind: 'list', source: 'endpoint', baseUrl: baseUrl || providers.openai.baseUrl || '', auto: !!thatUrl };
 *  anthropic: { kind: 'nolist', text: 'No list to pick from' }. */
export function addStep2Plan(provider, providers, { baseUrl = '' } = {}) {
  if (provider === 'copilot' || provider === 'openrouter') {
    const s = providerState(providers, provider, { hasModels: true });
    if (s.tone === 'ok') {
      return provider === 'copilot'
        ? { kind: 'list', source: 'copilot' }
        : { kind: 'list', source: 'endpoint', baseUrl: OPENROUTER_PRESET.baseUrl, auto: true };
    }
    return { kind: 'blocked', text: s.text, fix: s.fix || (provider === 'copilot' ? 'Sign in' : 'Set key'), row: provider };
  }
  if (provider === 'openai') {
    const url = baseUrl || providers?.openai?.baseUrl || '';
    return { kind: 'list', source: 'endpoint', baseUrl: url, auto: !!url };
  }
  return { kind: 'nolist', text: 'No list to pick from' };
}

/** ADD-3, from the list in #mimp-body: p.mdl-add-shown "N of M shown" (rows the filter leaves, of every row; hidden with
 *  no list), and the head box .mvi-all over the rows shown that can be ticked: checked when all are, indeterminate
 *  (mixed) when some are, clear when none or none can be. */
export function paintAddList(root) {
  const line = root && root.querySelector('.mdl-add-shown');
  const sheet = root && root.querySelector('.mimp-body .mvi');
  const rows = sheet ? [...sheet.querySelectorAll('tbody tr[data-id]')] : [];
  const seen = rows.filter((tr) => !tr.classList.contains('is-filtered'));
  if (line) {
    line.hidden = !rows.length;
    line.textContent = rows.length ? `${seen.length} of ${rows.length} shown` : '';
  }
  const all = sheet && sheet.querySelector('.mvi-all');
  if (!all) return;
  const boxes = seen.map((tr) => tr.querySelector('.mvi-cb')).filter((c) => c && !c.disabled);
  const ticked = boxes.filter((c) => c.checked).length;
  all.checked = boxes.length > 0 && ticked === boxes.length;
  all.indeterminate = ticked > 0 && ticked < boxes.length;
}

/** Foot: note "N selected" ('' for 0); #mimp-go "Add N models" / "Add 1 model" / "Add models" (disabled at 0). */
export function paintAddSelection(root, n) {
  const count = Math.max(0, Math.floor(Number(n)) || 0);
  const note = root && root.querySelector('.mdl-add-note');
  const go = root && root.querySelector('.mimp-go');
  if (note) note.textContent = count ? `${count} selected` : '';
  if (go) {
    go.textContent = count === 1 ? 'Add 1 model' : count ? `Add ${count} models` : 'Add models';
    go.disabled = !count;
  }
}
