// ui-level.mjs — the interface mode (docs/ui-levels.md): simple | advanced | expert.
//
// One machine-wide VIEW preference deciding how much of the UI is on screen. It
// is never a permission: deep links still resolve, nothing is disabled. The
// server renders the stored mode into <html data-level> (src/core/index-html.mjs)
// so the first paint is already right; this module keeps it live.
//
// How an element gets a level:
//   markup    <button data-min-level="advanced">            (style.css hides it below that)
//   renderer  tagLevel(el, 'expert')                        (same attribute, from JS)
//   logic     if (levelAtLeast('advanced')) …               (option lists, default tabs)
//   keep      keepVisible(el, true)                         (a non-default value stays on screen)
//
// Levels are cumulative: advanced shows everything simple shows, expert shows all.

export const UI_LEVELS = Object.freeze(['simple', 'advanced', 'expert']);
export const DEFAULT_UI_LEVEL = 'expert';   // no attribute (tests, an old shell) ⇒ gate nothing

export const LEVEL_INFO = Object.freeze({
  simple: Object.freeze({
    label: 'Simple',
    who: 'New to Worca',
    desc: 'Pick a project, describe the task, watch the run, answer its questions and read the result. Nothing here can break a run.',
    adds: 'Shows: New pipeline, Running, History, Projects, budget limits and Ask Worca.',
  }),
  advanced: Object.freeze({
    label: 'Advanced',
    who: 'Regular use',
    desc: 'Control how a run executes and review what it changed: branches, guardrails, per-agent models, the diff, pull requests and your own workflows.',
    adds: 'Adds: Statistics, Workflow Composer, Workspaces, plugins, memory and the live log.',
  }),
  expert: Object.freeze({
    label: 'Expert',
    who: 'Authoring and team setup',
    desc: 'Everything. Author agents, models and guardrail sets, tune fan-out and loop limits, filter logs by execution and run team metrics.',
    adds: 'Adds: Agents, Team metrics, Models, diagnostics and every per-node tunable.',
  }),
});

export function isUiLevel(v) { return UI_LEVELS.includes(v); }
export function normalizeLevel(v) { return isUiLevel(v) ? v : DEFAULT_UI_LEVEL; }
export function levelRank(v) { return UI_LEVELS.indexOf(normalizeLevel(v)); }

const docOf = (doc) => doc || globalThis.document;

/** The mode the page is in right now. */
export function currentLevel(doc) {
  const d = docOf(doc);
  return normalizeLevel(d && d.documentElement ? d.documentElement.dataset.level : undefined);
}

/** True when the current mode shows things of level `min`. */
export function levelAtLeast(min, doc) { return levelRank(currentLevel(doc)) >= levelRank(min); }

/** True when `min` is shown at `level` (pure; no document). */
export function levelShows(level, min) { return levelRank(level) >= levelRank(min); }

/** Mark `el` as belonging to `min` and above. Returns `el` so it chains in a renderer. */
export function tagLevel(el, min) {
  if (el && isUiLevel(min)) el.dataset.minLevel = min;
  return el;
}

/** A gated control holding a non-default value stays visible at every level. */
export function keepVisible(el, on) {
  if (!el) return el;
  if (on) el.dataset.levelKeep = '1'; else delete el.dataset.levelKeep;
  return el;
}

/** The lowest mode that shows `el`: the highest data-min-level on it or an ancestor. */
export function minLevelFor(el) {
  let best = 'simple';
  for (let n = el; n && n.dataset; n = n.parentElement) {
    if (n.dataset.levelKeep) continue;
    const m = n.dataset.minLevel;
    if (isUiLevel(m) && levelRank(m) > levelRank(best)) best = m;
  }
  return best;
}

// The icon IS the state readout (the collapsed rail shows nothing else): a stack
// of layers, the top sheet always solid, the second lit from advanced, the third
// from expert. Same 24px grid and stroke as every other nav icon.
export function levelIconSvg(level) {
  const r = levelRank(level);
  const off = (n) => (r < n ? ' class="lv-off"' : '');
  return '<svg class="lv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 3 3 8l9 5 9-5-9-5z"></path>'
    + `<path${off(1)} d="M3 12.5l9 5 9-5"></path>`
    + `<path${off(2)} d="M3 17l9 5 9-5"></path></svg>`;
}

/** Write the mode onto <html> and tell the app (renderers that branch on it repaint). */
export function applyLevel(level, doc) {
  const d = docOf(doc);
  const next = normalizeLevel(level);
  const prev = d.documentElement.dataset.level;
  d.documentElement.dataset.level = next;
  if (prev !== next) {
    const Ev = (d.defaultView && d.defaultView.CustomEvent) || globalThis.CustomEvent;   // jsdom rejects Node's
    d.dispatchEvent(new Ev('worca:level', { detail: { level: next, previous: prev || null } }));
  }
  return next;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The three radio cards of the dialog. */
export function levelCardsHtml(level) {
  const cur = normalizeLevel(level);
  return UI_LEVELS.map((id) => {
    const i = LEVEL_INFO[id];
    const on = id === cur;
    return `<button type="button" class="lv-card" role="radio" data-level-choice="${id}" aria-checked="${on}" tabindex="${on ? 0 : -1}">`
      + `<span class="lv-card-icon">${levelIconSvg(id)}</span>`
      + `<span class="lv-card-text"><span class="lv-card-title">${esc(i.label)}<span class="lv-card-who">${esc(i.who)}</span></span>`
      + `<span class="lv-card-desc">${esc(i.desc)}</span><span class="lv-card-adds">${esc(i.adds)}</span></span>`
      + '<span class="lv-card-radio" aria-hidden="true"></span></button>';
  }).join('');
}

/**
 * Wire the mode item(s), the dialog and the Settings card.
 *
 * @param {object} o
 * @param {Document} [o.doc]
 * @param {(level:string)=>Promise<{ok:boolean,level?:string,error?:string}>} o.save  persists; answers the CONFIRMED mode
 * @returns {{paint:(level?:string)=>void, open:(from?:Element)=>void, close:()=>void, choose:(level:string)=>Promise<void>}}
 */
export function createLevelController({ doc, save } = {}) {
  const d = docOf(doc);
  const $ = (s) => d.querySelector(s);
  const modal = $('#mode-modal');
  const cards = $('#mode-cards');
  const msg = $('#mode-msg');
  let confirmed = currentLevel(d);   // the last SERVER-confirmed mode
  let seq = 0;                       // out-of-order saves never repaint a stale answer
  let opener = null;

  function paint(level) {
    const lvl = applyLevel(level === undefined ? currentLevel(d) : level, d);
    const info = LEVEL_INFO[lvl];
    for (const b of d.querySelectorAll('[data-mode-open]')) {
      const icon = b.querySelector('.lv-icon-slot');
      if (icon) icon.innerHTML = levelIconSvg(lvl);
      const name = b.querySelector('.lv-name');
      if (name) name.textContent = b.dataset.modeOpen === 'short' ? info.label : `${info.label} mode`;
      b.setAttribute('aria-label', `Interface mode: ${info.label}. Change how much of Worca is shown`);
      b.title = `${info.label} mode — change how much of Worca is shown`;   // the collapsed rail's only label
    }
    const sIcon = $('#modeSettingsIcon'); if (sIcon) sIcon.innerHTML = levelIconSvg(lvl);
    const sName = $('#modeSettingsName'); if (sName) sName.textContent = `${info.label} mode`;
    const sDesc = $('#modeSettingsDesc'); if (sDesc) sDesc.textContent = info.desc;
    if (cards && modal && !modal.classList.contains('hidden')) {
      const had = d.activeElement && d.activeElement.closest && d.activeElement.closest('#mode-cards');
      cards.innerHTML = levelCardsHtml(lvl);
      if (had) { const b = cards.querySelector('[aria-checked="true"]'); if (b) b.focus(); }
    }
  }

  function open(from) {
    if (!modal) return;
    opener = from || d.activeElement || null;
    if (msg) { msg.textContent = ''; msg.className = 'hint'; }
    cards.innerHTML = levelCardsHtml(currentLevel(d));
    modal.classList.remove('hidden');
    const b = cards.querySelector('[aria-checked="true"]'); if (b) b.focus();
  }
  function close() {
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    // The opener may have been repainted or hidden by the change; fall back to the sidebar item.
    const back = (opener && opener.isConnected && opener.offsetParent !== null) ? opener : $('.nav [data-mode-open]');
    if (back && typeof back.focus === 'function') back.focus();
    opener = null;
  }

  async function choose(level) {
    if (!isUiLevel(level)) return;
    const mine = ++seq;
    const previous = confirmed;
    paint(level);                                  // optimistic: the app re-lays out behind the dialog
    if (msg) { msg.textContent = ''; msg.className = 'hint'; }
    let out;
    try { out = await save(level); } catch (e) { out = { ok: false, error: (e && e.message) || 'network error' }; }
    if (mine !== seq) return;                      // a later click owns the paint now
    if (!out || !out.ok) {
      paint(previous);
      if (msg) { msg.textContent = `Could not save the mode: ${(out && out.error) || 'unknown error'}`; msg.className = 'hint err'; }
      return;
    }
    confirmed = normalizeLevel(out.level || level);
    paint(confirmed);
  }

  d.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const card = t.closest('[data-level-choice]');
    if (card) { choose(card.dataset.levelChoice); return; }
    if (t.closest('#mode-done') || t === modal) { close(); return; }
    const op = t.closest('[data-mode-open], [data-mode-set]');
    if (!op) return;
    // A banner's "Switch to …" sets the mode directly; everything else opens the dialog.
    if (op.dataset.modeSet) { choose(op.dataset.modeSet); return; }
    open(op);
  });
  d.addEventListener('keydown', (e) => {
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const step = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 0;
    if (step && e.target.closest && e.target.closest('#mode-cards')) {
      e.preventDefault();
      const i = UI_LEVELS.indexOf(currentLevel(d));
      choose(UI_LEVELS[(i + step + UI_LEVELS.length) % UI_LEVELS.length]);
      return;
    }
    if (e.key === 'Tab') {                          // two stops: the radiogroup and Done
      const stops = [cards.querySelector('[aria-checked="true"]'), $('#mode-done')].filter(Boolean);
      if (!stops.length) return;
      e.preventDefault();
      const at = stops.indexOf(d.activeElement);
      stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    }
  }, true);

  return {
    paint,
    open,
    close,
    choose,
    /** A server-confirmed value from elsewhere (GET /api/settings, settings-changed). */
    confirm(level) { if (isUiLevel(level)) { confirmed = level; paint(level); } },
  };
}
