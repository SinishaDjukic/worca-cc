// ui/public/design/model-pills.mjs
// The two model pickers of a Design composer (the start composer and the chat dock), drawn and worked as the Chat
// composer's model picker (ask-panel.mjs openModelPopover): a quiet `.ask-model-btn` reading `Lead  Opus 5.5  high ⌄`
// (the main agent) and `Builders  Sonnet 5.5  medium ⌄` (the agents that build one section each), and an
// `.ask-pop-model` menu: the engine's models (one per family up front, the rest under More models), `Effort  high ›`
// opening its own pane, and `More models ›`. Design adds one row, Default: what the agent runs on with no pick of this
// design (the Models page's Design row, else the model role, else the engine's default model). The choices come from
// GET /api/design/models (start) or GET /api/design/<id>/models (dock). Every string reaches the DOM through `textContent`.
import { createFlyout } from '../side-flyout.mjs';
import { icon } from '../icons.mjs';
import { modelGroups } from '../../../src/shared/connections.mjs';
import { ROLE_LABELS } from '../../../src/shared/model-roles.mjs';
import { DESIGN_AGENT_LABELS } from '../../../src/shared/design-names.mjs';

export const PILL_ROLES = Object.freeze(['lead', 'builder']);
/** The model role each agent falls back to (shared/model-roles.mjs SLOT_ROLES designLead / designBuilder). */
const ROLE_OF = Object.freeze({ lead: 'deep', builder: 'everyday' });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);

/** A `{model, effort?}` pick with a model, else null. */
export function readPick(v) {
  return isObj(v) && str(v.model) ? { model: v.model, ...(str(v.effort) ? { effort: v.effort } : {}) } : null;
}

/** The `/models` answer, checked: `{engine, label, efforts, models, picks, defaults}`, or null when it is not one. */
export function readOptions(body) {
  if (!isObj(body) || !str(body.engine) || !Array.isArray(body.models)) return null;
  const models = body.models.filter((m) => isObj(m) && str(m.id))
    .map((m) => ({ ...m, efforts: Array.isArray(m.efforts) ? m.efforts.filter(str) : [] }));
  const def = (r) => {
    const d = isObj(body.defaults) ? body.defaults[r] : null;
    return { model: str(d?.model), effort: str(d?.effort), source: str(d?.source) || 'default' };
  };
  return {
    engine: body.engine, label: str(body.label) || body.engine,
    efforts: Array.isArray(body.efforts) ? body.efforts.filter(str) : [],
    models,
    picks: Object.fromEntries(PILL_ROLES.map((r) => [r, readPick(isObj(body.picks) ? body.picks[r] : null)])),
    defaults: Object.fromEntries(PILL_ROLES.map((r) => [r, def(r)])),
  };
}

/** A model's name as the Chat picker shows it: its catalog label, else its id. */
export function shortModel(id, models) {
  if (!id) return null;
  const m = (models || []).find((x) => x.id === id);
  return m && str(m.label) ? m.label : id;
}

/** Where an agent's model comes from with no pick of its own, in words. */
export function sourceText(role, source, engineLabel) {
  if (source === 'setting') return 'Models page';
  if (source === 'role') return ROLE_LABELS[ROLE_OF[role]];
  return `${engineLabel || 'the engine'}'s default`;
}

/** The efforts `model` takes on the options' engine: its catalog row's, else the engine's (an unknown model). */
export function effortsFor(model, opts) {
  if (!opts) return [];
  const m = model ? opts.models.find((x) => x.id === model) : null;
  return m ? m.efforts : opts.efforts;
}

/** `effort` when `model` takes it, else `high`, else its first (ask-panel.mjs coerceEffort). */
export function coerceEffort(model, effort, opts) {
  const list = effortsFor(model, opts);
  if (!list.length || list.includes(effort)) return effort;
  return list.includes('high') ? 'high' : list[0];
}

/**
 * What one button shows, as the Chat button's three spans: `{agent, model, effort, title, isDefault}`. `pick` is the
 * design's own pick (null = Default).
 */
export function pillView(role, pick, opts) {
  const agent = DESIGN_AGENT_LABELS[role];
  if (!opts) return { agent, model: '', effort: '', title: `${agent} model`, isDefault: true };
  const d = opts.defaults[role];
  const id = pick ? pick.model : d.model;
  const effort = pick ? (pick.effort || d.effort) : d.effort;
  const model = shortModel(id, opts.models) || 'Default';
  const shownEffort = effort && effortsFor(id, opts).length ? effort : '';
  const from = pick ? 'picked for this design' : `default, from ${sourceText(role, d.source, opts.label)}`;
  return { agent, model, effort: shownEffort, title: `${agent} · ${model}${shownEffort ? ` · ${shownEffort}` : ''} (${from})`, isDefault: !pick };
}

/** The family a model belongs to, so the main pane lists one of each (ask-panel.mjs familyKey). */
function familyKey(m) {
  if ((m.engine || 'claude') === 'copilot' && m.id.startsWith('copilot/')) {
    return `copilot:${(m.id.slice('copilot/'.length).match(/^[a-z]+(?:-[a-z]+)*/) || ['other'])[0]}`;
  }
  const fam = (m.id.match(/^claude-(opus|fable|sonnet|haiku)-/) || [])[1];
  if (fam) return `claude:${fam}`;
  if (m.custom === 'plugin' && m.plugin) return `plugin:${m.plugin}`;
  return 'other';
}

/** The main pane's models and More models' (ask-panel.mjs splitCatalog): the first of each family up front, the
 *  person's own models always, and `current` (the pick) up front so its ✓ shows. */
export function splitModels(models, current) {
  const primary = [];
  const rest = [];
  const seen = new Set();
  for (const m of models || []) {
    if (m.hidden && m.id !== current) continue;
    if (m.needsSignIn && m.id !== current) continue;
    if (m.custom === 'global') { primary.push(m); continue; }
    const fam = familyKey(m);
    if (seen.has(fam) && m.id !== current) rest.push(m);
    else { seen.add(fam); primary.push(m); }
  }
  return { primary, rest };
}

/**
 * Two pickers, `Lead` and `Builders`, in one `span.dz-models`.
 * @param {{doc: Document, win?: Window, fetch: Function, url: () => string|null, mode?: 'up'|'down'|'beside',
 *   parent?: HTMLElement|null,
 *   save?: (role: 'lead'|'builder', pick: object|null) => Promise<string>,
 *   onChange?: (picks: {lead: object|null, builder: object|null}) => void}} o
 *   `url` names the choices to load (null loads nothing). `save` stores a pick and answers '' or the refusal, which
 *   puts the pick back (the dock); without it a pick is only kept here (the start composer reads `picks()`).
 *   `parent` is the popup the pickers sit in (composer-settings.mjs): each menu then opens as its submenu, so opening
 *   one leaves that popup open (use `mode: 'beside'`).
 * @returns {{el: HTMLElement, load: () => Promise<void>, picks: () => {lead?: object, builder?: object},
 *   engine: () => string|null, reset: () => void, destroy: () => void}}
 */
export function createModelPills({ doc, win = doc.defaultView || globalThis, fetch: fetchFn, url, mode = 'down', parent = null, save = null, onChange = () => {} }) {
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const el = make('span', 'dz-models');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Models');
  let opts = null;
  let picks = { lead: null, builder: null };
  let seq = 0;
  let destroyed = false;
  let saving = false;

  const pills = PILL_ROLES.map((role) => {
    // The Chat button: agent (where Chat names the engine), model, effort, chevron.
    const btn = make('button', 'btn btn-sm btn-quiet ask-model-btn dz-model-btn');
    btn.type = 'button';
    btn.dataset.role = role;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    const agent = make('span', 'ask-model-btn-engine', DESIGN_AGENT_LABELS[role]);
    const label = make('span', 'ask-model-btn-label');
    const effort = make('span', 'ask-model-btn-effort');
    btn.append(agent, label, effort, icon(doc, 'chevron-down', 12));
    const menu = make('div', 'menu ask-pop ask-pop-model dz-model-pop');
    menu.id = `dz-model-menu-${role}-${Math.random().toString(36).slice(2, 8)}`;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `${DESIGN_AGENT_LABELS[role]} model`);
    menu.hidden = true;
    btn.setAttribute('aria-controls', menu.id);
    el.append(btn, menu);
    const p = { role, btn, label, effort, menu, fly: null, pane: 'main' };
    p.fly = createFlyout({ doc, win, trigger: btn, menu, mode, parent, onOpen: () => renderPane(p, 'main') });
    return p;
  });

  function paint() {
    for (const p of pills) {
      const v = pillView(p.role, picks[p.role], opts);
      p.label.textContent = v.model;
      p.label.hidden = !v.model;
      p.effort.textContent = v.effort;
      p.effort.hidden = !v.effort;
      p.btn.title = v.title;
      p.btn.setAttribute('aria-label', v.title);
      p.btn.classList.toggle('is-default', v.isDefault);
      p.btn.disabled = !opts || saving;
    }
  }

  function checkMark() {
    const c = make('span', 'ask-model-check');
    c.append(icon(doc, 'check', 12));
    return c;
  }
  /** A row of the menu, as ask-panel.mjs menuItem. */
  function menuItem(cls, onPick) {
    const b = make('button', `menu-item ask-pop-item ${cls}`.trim());
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    if (onPick) b.addEventListener('click', onPick);
    return b;
  }
  const closeFrom = (p, e) => p.fly.close(e && e.detail === 0 ? { refocus: true } : { blur: true });

  /** One pane of `p`'s menu: 'main' (Default, the models, Effort, More models), 'effort' or 'more'. */
  function renderPane(p, pane) {
    p.pane = pane;
    const panel = p.menu;
    const rows = [];
    if (!opts) {
      rows.push(make('div', 'ask-pop-empty', 'Loading models…'));
      panel.replaceChildren(...rows);
      return;
    }
    const role = p.role;
    const own = picks[role];
    const d = opts.defaults[role];
    const current = own ? own.model : d.model;
    const curEffort = own ? (own.effort || d.effort) : d.effort;
    const back = (text, to) => {
      const b = menuItem('ask-pane-back', () => renderPane(p, to));
      b.append(make('span', null, text));
      rows.push(b, make('div', 'ask-pop-divider'));
    };
    const modelRow = (m) => {
      const item = menuItem('ask-model-item', (e) => {
        closeFrom(p, e);
        void choose(role, { model: m.id, ...(coerceEffort(m.id, curEffort, opts) ? { effort: coerceEffort(m.id, curEffort, opts) } : {}) });
      });
      item.append(make('span', 'ask-model-name', str(m.label) || m.id));
      if (own && own.model === m.id) item.append(checkMark());
      return item;
    };
    const byConnection = (models) => {
      const groups = modelGroups(models, { engine: opts.engine });
      for (const g of groups) {
        if (groups.length > 1) rows.push(make('div', 'ask-pop-subgroup', g.label));
        for (const m of g.models) rows.push(modelRow(m));
      }
    };
    const split = splitModels(opts.models, own ? own.model : null);
    if (pane === 'effort') {
      back('‹ Effort', 'main');
      for (const e of effortsFor(current, opts)) {
        const item = menuItem('ask-effort-item', (ev) => {
          closeFrom(p, ev);
          void choose(role, { model: current, effort: e });
        });
        item.append(make('span', 'ask-model-name', e));
        if (e === curEffort) item.append(checkMark());
        rows.push(item);
      }
    } else if (pane === 'more') {
      back('‹ Models', 'main');
      byConnection(split.rest);
    } else {
      rows.push(make('div', 'ask-pop-group', `${DESIGN_AGENT_LABELS[role]} · ${opts.label}`));
      // Default: no pick of this design. Its row names what that runs on, and where that comes from.
      const def = menuItem('ask-model-item dz-model-default', (e) => {
        closeFrom(p, e);
        void choose(role, null);
      });
      def.title = `From ${sourceText(role, d.source, opts.label)}`;
      def.append(make('span', 'ask-model-name', 'Default'), make('span', 'ask-pop-row-value', shortModel(d.model, opts.models) || `${opts.label}'s default`));
      if (!own) def.append(checkMark());
      rows.push(def);
      byConnection(split.primary);
      if (!opts.models.length) rows.push(make('div', 'ask-pop-empty', `No ${opts.label} model in the catalog`));
      rows.push(make('div', 'ask-pop-divider'));
      const efforts = effortsFor(current, opts);
      const effortRow = menuItem('ask-effort-row', current && efforts.length ? () => renderPane(p, 'effort') : null);
      effortRow.append(make('span', null, 'Effort'));
      if (!current || !efforts.length) {
        // The engine's own default model: there is no model to set an effort on until one is picked.
        effortRow.disabled = true;
        effortRow.title = current ? 'This model takes no reasoning effort.' : 'Pick a model to change the effort.';
        effortRow.append(make('span', 'ask-pop-row-value', curEffort || 'not supported'));
      } else {
        effortRow.append(make('span', 'ask-pop-row-value', curEffort), make('span', 'ask-pop-row-chev', '›'));
      }
      rows.push(effortRow);
      if (split.rest.length) {
        const more = menuItem('ask-more-models', () => renderPane(p, 'more'));
        more.append(make('span', null, 'More models'), make('span', 'ask-pop-row-chev', '›'));
        rows.push(more);
      }
    }
    panel.replaceChildren(...rows);
    if (p.fly.isOpen()) {
      p.fly.reposition();
      // A pane change keeps the keyboard in the menu, as the Chat picker's focusFirst.
      if (panel.contains(doc.activeElement) || doc.activeElement === doc.body || !doc.activeElement) {
        const first = panel.querySelector('[role="menuitem"]:not(:disabled)');
        if (pane !== 'main' && first) first.focus();
      }
    }
  }

  /** Keep `pick` for `role` (null = Default): saved first when the pickers save, and put back when that is refused. */
  async function choose(role, pick) {
    const before = picks[role];
    picks = { ...picks, [role]: pick };
    paint();
    if (save) {
      saving = true;
      paint();
      let error = '';
      try { error = await save(role, pick); } catch (err) { error = err && err.message ? err.message : 'The model was not saved.'; }
      if (destroyed) return;
      saving = false;
      if (error) picks = { ...picks, [role]: before };
      paint();
    }
    onChange({ ...picks });
  }

  async function load() {
    const target = url();
    const my = ++seq;
    if (!target) return;
    let body = null;
    try {
      const r = await fetchFn(target);
      body = r.ok ? await r.json() : null;
    } catch { body = null; }
    if (destroyed || my !== seq) return;
    const next = readOptions(body);
    if (!next) return;
    const engineChanged = opts && opts.engine !== next.engine;
    opts = next;
    if (save) picks = { ...next.picks };
    // A start composer's picks name models of the engine they were made on: another engine drops them.
    else if (engineChanged) picks = { lead: null, builder: null };
    paint();
    for (const p of pills) if (p.fly.isOpen()) renderPane(p, p.pane);
  }

  paint();
  return {
    el,
    load,
    /** The picks that name a model, as POST /api/design takes them. */
    picks: () => Object.fromEntries(PILL_ROLES.filter((r) => picks[r]).map((r) => [r, picks[r]])),
    engine: () => (opts ? opts.engine : null),
    reset() { picks = { lead: null, builder: null }; paint(); },
    destroy() {
      destroyed = true;
      for (const p of pills) { if (p.fly.isOpen()) p.fly.close(); p.fly.destroy?.(); }
      el.remove();
    },
  };
}
