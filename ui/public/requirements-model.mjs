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
export function whoInterviews(doc, { models = [], harnesses = [], choice, defaults = {}, onChange = () => {}, legend = 'Who interviews', repoOnly = false } = {}) {
  const fs = node(doc, 'fieldset', 'req-who');
  fs.append(node(doc, 'legend', null, legend));
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

  for (const hn of harnesses) {
    const o = harnessOption(doc, hn);
    if (repoOnly && hn.repo === false) o.disabled = true;   // a brief reads the code (D18): greyed, the option text says why
    harness.append(o);
  }
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
  const pickable = (e) => !!of(e) && !(repoOnly && of(e).repo === false);
  const firstOpen = [...harness.options].find((o) => !o.disabled) || harness.options[0];
  harness.value = pickable(start.engine) ? start.engine : (firstOpen ? firstOpen.value : '');
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
      if (pickable(c.engine) && of(c.engine).ready !== false) harness.value = c.engine;
      fillModel(harness.value, c.model);
      fillEffort(harness.value, c.effort || '');
    },
  };
}

/**
 * The recommendation note (board 1, D8). `estimates` is GET /estimates ({ look, round, recommended: { model, look, round } | null });
 * `labels` { harness, picked, recommended } are display names; `repo` false leaves the code look out; `onUse` runs from Use <rec>.
 */
export function recommendationNote(doc, { picked, recommended, estimates, labels = {}, repo = true, kind = 'step', onUse = () => {} } = {}) {
  // The note sits in a slot that is the live region (each page keeps one), so the note itself has none.
  const p = node(doc, 'p', 'hint req-new-note');
  p.append(infoIcon(doc));
  const body = node(doc, 'span');
  p.append(body);
  const rec = estimates && estimates.recommended;
  if (kind === 'brief') return briefNote(doc, p, body, { picked, recommended, estimates, labels, onUse });
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

/** One price of a brief: "about $0.42", "no estimate yet" or "cost unknown". */
const briefCost = (est) => (est && typeof est.usd === 'number' ? `about ${usd(est.usd)}` : priceWords(est));
/** The brief's note (board 9, D18): the estimates are GET /estimates?step=brief ({ brief, recommended: { model, brief } }). */
function briefNote(doc, p, body, { picked, recommended, estimates, labels, onUse }) {
  const tail = 'Counts toward your limit.';
  if (!recommended) {
    const c = briefCost(estimates && estimates.brief);
    body.textContent = `${c[0].toUpperCase()}${c.slice(1)}. ${tail}`;
    return p;
  }
  const rec = estimates && estimates.recommended;
  const lead = `A brief works best with a strong model, like ${labels.recommended} on ${labels.harness}: ${briefCost(rec && rec.brief)}.`;
  if (picked === recommended) { body.textContent = `${lead} ${tail}`; return p; }
  body.append(`${lead} You picked ${labels.picked}: ${briefCost(estimates && estimates.brief)}. ${tail} `);
  const use = node(doc, 'button', 'link-btn req-new-use', `Use ${labels.recommended}`);
  use.type = 'button';
  use.addEventListener('click', () => onUse());
  body.append(use);
  return p;
}

/** "Your default: <model> on <Harness>. Use the default", only when the choice differs from the default; else null.
 *  `lead` ("Last made with <model> on <Harness>. ") comes first and keeps the line alive when the default is the pick. */
export function defaultLine(doc, { choice, defaultChoice, labels = {}, lead = '', onUse = () => {} } = {}) {
  const differs = !!choice && !!defaultChoice && !(choice.engine === defaultChoice.engine && choice.model === defaultChoice.model);
  if (!differs) return lead ? node(doc, 'p', 'hint req-new-default', lead.trim()) : null;
  const p = node(doc, 'p', 'hint req-new-default', `${lead}Your default: ${labels.model} on ${labels.harness}. `);
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

// ── 9c boards 3, 4, 9: the feature's model chip, its dialog, the switch confirm, the brief's box and Refresh dialog ──

/** The chip after the cost chip (board 3): a button that names the model and harness and opens the dialog. */
export function modelChip(doc, f, onOpen = () => {}) {
  const b = node(doc, 'button', 'chip req-model-chip');
  b.type = 'button';
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('data-ui', 'model-chip');
  b.append(f.modelLabel);
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 9l6 6 6-6');
  svg.append(path);
  b.append(svg);
  b.addEventListener('click', () => onOpen(b));
  return b;
}

/** Who gets the text (D11, gap 7): the harness's named company, or "the provider of <model>" for a harness without one
 *  (Goose, OpenCode) and for a model with its own endpoint (the same rule as the server's companyOf). */
export function sentTo(harness, entry, label) {
  const own = !!entry && (((entry.custom === 'global' || entry.custom === 'plugin') && entry.hasEnv === true)
    || !!entry.bridged || !!entry.upstream || !!entry.upstreamApi);
  const name = label || (entry && (entry.label || entry.id)) || '';
  return harness && harness.company && !own ? { company: harness.company, named: true } : { company: `the provider of ${name}`, named: false };
}

const TEXT_INLINE_BYTES = 24 * 1024;   // a harness other than Claude gets a text file of at most 24 KB (gap 8)
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The switch confirm (board 4, D11, D17) in engineSwitchConfirm's format: { title, message, confirmLabel } for confirmModal, or null
 * when the new pick loses nothing and sends the text to the same company. `from` / `to` are { engine, model }; `models` is the
 * catalog, `harnesses` the GET /models list, `files` the feature's files (default: feature.attachments).
 */
export function switchConfirm({ from, to, harnesses = [], models = [], files, feature } = {}) {
  if (!from || !to) return null;
  const of = (e) => harnesses.find((x) => x.engine === e) || {};
  const entry = (id) => models.find((m) => m && m.id === id) || null;
  const label = (id) => { const m = entry(id); return (m && (m.label || m.id)) || id; };
  const hf = of(from.engine);
  const ht = of(to.engine);
  const name = engineLabel(to.engine);
  const lines = [];
  const move = from.engine !== to.engine;
  if (hf.repo !== false && ht.repo === false) lines.push(`${name} can't read the repo: code looks are skipped, for this feature and for the Product brief.`);
  if (move && !ht.files) {
    const all = Array.isArray(files) ? files : (feature && feature.attachments) || [];
    const skipped = all.filter((a) => a && !(a.kind === 'text' && Number(a.bytes) <= TEXT_INLINE_BYTES)).map((a) => a.name);
    if (skipped.length) lines.push(`Attached files go as text: ${joinAnd(skipped)} ${skipped.length === 1 ? 'is' : 'are'} skipped.`);
  }
  if (move && ht.keepsCopy) lines.push(`${name} keeps its own copy of each step in its history on this computer.`);
  const a = sentTo(hf, entry(from.model), label(from.model));
  const b = sentTo(ht, entry(to.model), label(to.model));
  if (!(a.named && b.named && a.company === b.company)) lines.push(`Your feature's description, answers and attachments are sent to ${b.company}.`);
  if (move && ht.reportsCost === false) lines.push(`${name} reports no cost. Worca estimates it from list prices where it can.`);
  if (!lines.length) return null;
  return {
    title: `Switch this feature to ${name}?`,
    message: `Worca's next step runs on ${name} with ${label(to.model)}. Steps already done keep their answers and their cost.\n\nWhat changes:\n${lines.map((l) => `• ${l}`).join('\n')}`,
    confirmLabel: `Switch to ${name}`,
  };
}

/**
 * The choice box the feature dialog, the brief box and the Refresh dialog share: Who interviews / Who makes it, the grey fallback
 * line, the harness hint, any `extra` lines, "Your default" and the recommendation note. The note's slot is the page's live region
 * (aria-live), kept across redraws. `fetchEstimate(choice)` answers GET /estimates (kind 'brief': step=brief).
 * Returns { el, value(), set(c) }.
 */
export function choiceBox(doc, { catalog, choice, defaultChoice = null, fallbackReason = null, lead = '', kind = 'step', legend, repoOnly = false, hint = true,
  extra = [], fetchEstimate = async () => null, onChange = () => {} } = {}) {
  const el = node(doc, 'div', 'req-who-box');
  const slots = { fallback: node(doc, 'div'), hint: node(doc, 'div'), extra: node(doc, 'div'), def: node(doc, 'div'), note: node(doc, 'div') };
  slots.note.setAttribute('aria-live', 'polite');
  const modelLabel = (id) => { const m = catalog.models.find((x) => x && x.id === id); return (m && (m.label || m.id)) || id; };
  const harnessOf = (e) => catalog.harnesses.find((x) => x.engine === e) || {};
  let lastEst = null;
  let estNo = 0;
  let who = null;
  const drawNote = () => {
    const c = who.value();
    const rec = (catalog.recommended && catalog.recommended[c.engine]) || null;
    const line = recommendationNote(doc, { picked: c.model, recommended: rec, estimates: lastEst, kind, repo: kind === 'brief' || harnessOf(c.engine).repo !== false,
      labels: { harness: engineLabel(c.engine), picked: modelLabel(c.model), recommended: rec ? modelLabel(rec) : '' },
      onUse: () => { who.set({ engine: c.engine, model: rec, effort: '' }); onPick(); onChange(who.value()); } });
    slots.note.replaceChildren(line);
  };
  function onPick() {
    const c = who.value();
    const hl = hint ? harnessLine(c.engine, harnessOf(c.engine)) : null;
    slots.hint.replaceChildren(...(hl ? [node(doc, 'p', 'hint req-new-harness', hl)] : []));
    const dl = defaultLine(doc, { choice: c, defaultChoice, lead, labels: defaultChoice ? { model: modelLabel(defaultChoice.model), harness: engineLabel(defaultChoice.engine) } : {},
      onUse: () => { who.set(defaultChoice); onPick(); onChange(who.value()); } });
    slots.def.replaceChildren(...(dl ? [dl] : []));
    const mine = ++estNo;
    Promise.resolve().then(() => fetchEstimate(c)).then((e) => e, () => null).then((e) => {
      if (mine !== estNo) return;
      lastEst = e;
      drawNote();
    });
  }
  who = whoInterviews(doc, { models: catalog.models, harnesses: catalog.harnesses, choice, defaults: catalog.defaults, legend, repoOnly,
    onChange: (c) => { onPick(); onChange(c); } });
  const fb = fallbackLine(doc, fallbackReason);
  if (fb) slots.fallback.append(fb);
  slots.extra.append(...extra);
  el.append(who.el, slots.fallback, slots.hint, slots.extra, slots.def, slots.note);
  onPick();
  return { el, value: who.value, set(c) { who.set(c); onPick(); }, note: slots.note };
}

const dialogId = () => `req-dlg-${Math.random().toString(36).slice(2, 8)}`;
const dialogCard = (doc, cls, titleText) => {
  const id = dialogId();
  const card = node(doc, 'section', `card req-dialog ${cls}`);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', id);
  const title = node(doc, 'h2', null, titleText);
  title.id = id;
  return { card, title };
};
const button = (doc, cls, text, ui) => {
  const b = node(doc, 'button', cls, text);
  b.type = 'button';
  if (ui) b.setAttribute('data-ui', ui);
  return b;
};

/** The feature's model dialog (board 3): role=dialog "Model for this feature". Returns { card, first, value(), save }. */
export function modelDialog(doc, { catalog, choice, defaultChoice = null, fetchEstimate, onSave = () => {}, onCancel = () => {} } = {}) {
  const { card, title } = dialogCard(doc, 'req-model-dialog', 'Model for this feature');
  const box = choiceBox(doc, { catalog, choice, defaultChoice, fetchEstimate, legend: 'Model',
    extra: [node(doc, 'p', 'hint req-model-applies', 'Applies from the next step. Steps already done keep the model that ran them.')] });
  box.el.querySelector('legend').className = 'sr-only';
  const cancel = button(doc, 'btn', 'Cancel', 'model-cancel');
  const save = button(doc, 'btn btn-primary', 'Save', 'model-save');
  cancel.addEventListener('click', () => onCancel());
  save.addEventListener('click', () => onSave(box.value(), save));
  const btns = node(doc, 'div', 'req-dlg-btns');
  btns.append(cancel, save);
  card.append(title, node(doc, 'p', 'req-dlg-lead', 'Interviews, code looks, file reads and Feature chat use it.'), box.el, btns);
  return { card, first: box.el.querySelector('select'), value: box.value, save };
}

/** The brief's Refresh dialog (board 9): the three selects start from what made the brief last, the note is the brief's own. */
export function briefRefreshDialog(doc, { catalog, choice, defaultChoice = null, madeWith = null, branch = null, workspace = false, fetchEstimate,
  onSave = () => {}, onCancel = () => {} } = {}) {
  const { card, title } = dialogCard(doc, 'req-brief-refresh', 'Refresh the brief');
  const sub = node(doc, 'p', 'req-dlg-lead');
  if (workspace) sub.append("One look at each project's default branch, read-only, 3 to 5 minutes. Your edits are kept.");
  else if (branch) sub.append('One look at ', node(doc, 'code', null, branch), ', read-only, 3 to 5 minutes. Your edits are kept.');
  else sub.append('One look, read-only, 3 to 5 minutes. Your edits are kept.');
  const labelOf = (id) => { const m = catalog.models.find((x) => x && x.id === id); return (m && (m.label || m.id)) || id; };
  const lead = madeWith && madeWith.model ? `Last made with ${madeWith.label || labelOf(madeWith.model)} on ${engineLabel(madeWith.engine)}. ` : '';
  const box = choiceBox(doc, { catalog, choice, defaultChoice, lead, kind: 'brief', legend: 'Who makes it', repoOnly: true, hint: false, fetchEstimate });
  box.el.querySelector('legend').className = 'sr-only';
  const cancel = button(doc, 'btn', 'Cancel', 'brief-refresh-cancel');
  const go = button(doc, 'btn btn-primary', 'Refresh the brief', 'brief-refresh-go');
  cancel.addEventListener('click', () => onCancel());
  go.addEventListener('click', () => onSave(box.value(), go));
  const btns = node(doc, 'div', 'req-dlg-btns');
  btns.append(cancel, go);
  card.append(title, sub, box.el, btns);
  return { card, first: box.el.querySelector('select'), value: box.value, go };
}
