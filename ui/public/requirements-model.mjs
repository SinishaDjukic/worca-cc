// ui/public/requirements-model.mjs — the "Who interviews" pieces of the Requirements page (9c boards 1, 2, 7, 8), pure DOM:
// the three selects, the recommendation note, the "Your default" line and the grey fallback line. Shared by the New feature form
// (and, in Task 12, the feature page). Every function takes the document, so jsdom tests drive them directly. Classes only:
// colours and spacing live in requirements.css.
import { effortsOn, runsOn } from '../../src/shared/connections.mjs';
import { engineLabel } from '../../src/shared/engine-switch.mjs';
import { appendModelGroups } from './model-options.mjs';
import { lockEngineOptions } from './engine-locks.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const INFO_SHAPES = [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 8h.01M11 12h1v5h1' }]];

/** The info icon the page's notes lead with (the same drawing as requirements-view's ICONS.info). */
export function infoIcon(doc, size = 14) {
  const set = (e, attrs) => { for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
  const svg = set(doc.createElementNS(SVG_NS, 'svg'), { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  for (const [tag, attrs] of INFO_SHAPES) svg.append(set(doc.createElementNS(SVG_NS, tag), attrs));
  return svg;
}

const node = (doc, tag, cls, text) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/** One estimate as a price: "$0.16", "no estimate yet" or "cost unknown" (a model without a price; never $0.00). */
export function priceWords(est) {
  if (est && typeof est.usd === 'number') return usd(est.usd);
  return est && est.reason === 'no-price' ? 'cost unknown' : 'no estimate yet';
}
/** One part of a note: "about $X for a code look" when known, else "no estimate yet for ..." / "cost unknown for ...". */
const part = (est, what, noun) => (est && typeof est.usd === 'number' ? { ok: true, text: `about ${usd(est.usd)} ${what}` }
  : { ok: false, words: priceWords(est), text: `${priceWords(est)} for ${noun}` });
const costs = (est, repo) => {
  const parts = [...(repo ? [part(est && est.look, 'for a code look', 'a code look')] : []), part(est && est.round, 'a round', 'a round')];
  if (parts.length > 1 && parts.every((p) => !p.ok && p.words === parts[0].words)) return parts[0].words;
  return parts.map((p) => p.text).join(', ');
};

/** The line under the harness choice (board 2): what the harness can and can't do. */
export function harnessLine(engine, harness) {
  if (!engine || engine === 'claude') return null;
  const name = engineLabel(engine);
  return harness && harness.repo === false ? `${name} can't read the repo. Files go to it as text.` : `${name} reads the repo read-only. Files go to it as text.`;
}

/** Option text of one harness (gap 4): the choice label, then what it can't do or why it is greyed. */
function harnessOption(doc, h) {
  const o = node(doc, 'option');
  o.value = h.engine;
  o.textContent = `${h.choiceLabel || engineLabel(h.engine)}${h.repo === false ? " · Can't read the repo" : ''}${h.ready === false && !h.broker ? ` · ${h.short || 'Not ready'}` : ''}`;
  if (h.ready === false) o.disabled = true;
  return o;
}

/**
 * The Who interviews group (board 1): a fieldset with Harness, Model and Effort. `models` is the catalog, `harnesses` the offered
 * list (Cursor never in it), `defaults` each harness's { model, effort }. Returns { el, value(), set(choice) }.
 */
export function whoInterviews(doc, { models = [], harnesses = [], choice, defaults = {}, onChange = () => {} } = {}) {
  const fs = node(doc, 'fieldset', 'req-who');
  fs.append(node(doc, 'legend', null, 'Who interviews'));
  const uid = `req-who-${Math.random().toString(36).slice(2, 8)}`;
  const field = (name, sel) => {
    sel.id = `${uid}-${name.toLowerCase()}`;
    const wrap = node(doc, 'div', 'req-who-field');
    const label = node(doc, 'label', null, name);
    label.setAttribute('for', sel.id);
    const sw = node(doc, 'div', 'select-wrap');
    sw.append(sel);
    wrap.append(label, sw);
    return wrap;
  };
  const harness = node(doc, 'select', 'req-who-harness');
  const model = node(doc, 'select', 'req-who-model');
  const effort = node(doc, 'select', 'req-who-effort');
  const of = (engine) => harnesses.find((x) => x.engine === engine);

  for (const hn of harnesses) harness.append(harnessOption(doc, hn));
  lockEngineOptions(harness);
  // A broker-greyed engine the lock list does not know of still says why (the lock adds its own suffix when it knows).
  for (const o of harness.options) {
    const hn = of(o.value);
    if (hn && hn.broker && !o.textContent.includes('credential broker')) o.textContent += ` · ${hn.short || 'Off while the credential broker is on'}`;
  }
  const entryOf = (id) => models.find((m) => m && m.id === id);
  function fillModel(engine, pick) {
    model.replaceChildren();
    appendModelGroups(model, models.filter((m) => runsOn(m, engine)), { engine });
    const ids = [...model.options].map((o) => o.value);
    model.value = pick && ids.includes(pick) ? pick : (ids[0] || '');
  }
  function fillEffort(engine, pick) {
    effort.replaceChildren();
    const entry = entryOf(model.value);
    const none = node(doc, 'option', null, 'Default effort');
    none.value = '';
    effort.append(none);
    for (const e of effortsOn(entry, engine)) { const o = node(doc, 'option', null, e); o.value = e; effort.append(o); }
    effort.value = pick && [...effort.options].some((o) => o.value === pick) ? pick : '';
    effortWrap.hidden = !!(entry && entry.noEffort);
  }
  const effortWrap = field('Effort', effort);
  fs.append(field('Harness', harness), field('Model', model), effortWrap);

  const start = choice || {};
  harness.value = of(start.engine) ? start.engine : (harness.options[0] ? harness.options[0].value : '');
  fillModel(harness.value, start.model);
  fillEffort(harness.value, start.effort);

  const value = () => ({ engine: harness.value, model: model.value, effort: effortWrap.hidden ? null : (effort.value || null) });
  harness.addEventListener('change', () => {
    const d = defaults[harness.value] || {};
    fillModel(harness.value, d.model);
    fillEffort(harness.value, '');
    onChange(value());
  });
  model.addEventListener('change', () => { fillEffort(harness.value, effort.value); onChange(value()); });
  effort.addEventListener('change', () => onChange(value()));
  return {
    el: fs,
    value,
    /** Move the three selects to `c` (Use <model>, Use the default); does not call onChange. */
    set(c) {
      if (of(c.engine) && of(c.engine).ready !== false) harness.value = c.engine;
      fillModel(harness.value, c.model);
      fillEffort(harness.value, c.effort || '');
    },
  };
}

/**
 * The recommendation note (board 1, D8). `estimates` is GET /estimates ({ look, round, recommended: { model, look, round } | null });
 * `labels` { harness, picked, recommended } are display names; `repo` false leaves the code look out; `onUse` runs from Use <rec>.
 */
export function recommendationNote(doc, { picked, recommended, estimates, labels = {}, repo = true, onUse = () => {} } = {}) {
  const p = node(doc, 'p', 'hint req-new-note');
  p.setAttribute('aria-live', 'polite');
  p.append(infoIcon(doc));
  const body = node(doc, 'span');
  p.append(body);
  const rec = estimates && estimates.recommended;
  if (!recommended) {
    body.textContent = `${costs(estimates, repo)[0].toUpperCase()}${costs(estimates, repo).slice(1)}.`;
    return p;
  }
  const lead = `Requirements work best with a strong model, like ${labels.recommended} on ${labels.harness}: ${costs(rec || {}, repo)}.`;
  if (picked === recommended) { body.textContent = lead; return p; }
  body.append(`${lead} You picked ${labels.picked}: ${costs(estimates, repo)}. `);
  const use = node(doc, 'button', 'link-btn req-new-use', `Use ${labels.recommended}`);
  use.type = 'button';
  use.addEventListener('click', () => onUse());
  body.append(use);
  return p;
}

/** "Your default: <model> on <Harness>. Use the default", only when the choice differs from the default; else null. */
export function defaultLine(doc, { choice, defaultChoice, labels = {}, onUse = () => {} } = {}) {
  if (!choice || !defaultChoice) return null;
  if (choice.engine === defaultChoice.engine && choice.model === defaultChoice.model) return null;
  const p = node(doc, 'p', 'hint req-new-default', `Your default: ${labels.model} on ${labels.harness}. `);
  const use = node(doc, 'button', 'link-btn req-new-use', 'Use the default');
  use.type = 'button';
  use.addEventListener('click', () => onUse());
  p.append(use);
  return p;
}

/** The grey line when the Default engine can't run Requirements (D4); the server's own words. */
export function fallbackLine(doc, reason) {
  if (!reason) return null;
  return node(doc, 'p', 'hint req-new-fallback', reason);
}

/** The privacy note on a harness other than Claude (D15): who gets the files and what is skipped. */
export function otherHarnessPrivacy(modelLabel, harnessName) {
  return `Worca sends each file to ${modelLabel} on ${harnessName} to read it. Text is checked for keys and passwords first. ${harnessName} gets files as text: PDFs and images are skipped.`;
}
