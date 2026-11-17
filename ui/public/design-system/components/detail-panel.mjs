// DetailPanel: what you open to investigate a task, beside the chat and never inside its card. One panel, in tabs
// (Activity, Changes, Decisions, Checks); it names the task it follows in its header. It opens only on intent (a link in
// the card's message, a knot of its train, a vital, the card's Details button) and closes with its close control, Escape
// or the same trigger again; a click elsewhere in the chat leaves it open. Beside the chat it is a named region, not a
// modal; as a sheet (tablet) or full screen (phone) it is a dialog. It has no composer: it is detail, not a chat.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { button } from './button.mjs';
import { tabs } from './tabs.mjs';
import { morph } from './motion.mjs';

/**
 * @param {object} o
 * @param {string} o.title        the task it follows
 * @param {string} [o.mark]       the task's KindMark (markup)
 * @param {string} [o.word]       its state word, before the title
 * @param {{id:string, label:string, count?:string|number, fresh?:boolean}[]} o.tabs   fresh: a quiet mark, something new arrived
 * @param {string} o.tab          the open tab's id
 * @param {string} o.body         the open tab's content (markup: the task page's own parts)
 * @param {boolean} [o.wide]      widened, for logs and diffs
 * @param {boolean} [o.modal]     drawn as a sheet or full screen: a dialog
 * @param {string} [o.foot]       markup under the body (Open task)
 * @param {{close?:object, widen?:object}} [o.hooks]   each control's attributes
 * @param {object} [o.attrs]
 */
export function detailPanel({ title, mark = '', word = '', tabs: list = [], tab = '', body = '', wide = false, modal = false, foot = '', hooks = {}, attrs: a = {} }) {
  const name = `Details of ${title}`;
  const head = `<header class="dp-head"><div class="dp-k">${mark}<span class="dp-w">${esc(word)}</span><span class="dp-tools">${button({ label: wide ? 'Narrow the panel' : 'Widen the panel', kind: 'quiet', iconOnly: true, icon: icon(wide ? 'bar-show' : 'bar-hide', 14), cls: 'dp-widen', attrs: { 'aria-pressed': String(!!wide), ...(hooks.widen || {}) } })}${button({ label: 'Close details', kind: 'quiet', iconOnly: true, icon: icon('x', 14), attrs: { title: 'Close (Esc)', ...(hooks.close || {}) } })}</span></div><h2 class="dp-title" tabindex="-1" data-dp-title title="${esc(title)}">${esc(title)}</h2></header>`;
  const bar = tabs({ label: name, controls: 'dp-body', idPrefix: 'dp-tab-', cls: 'dp-tabs', items: list.map((t) => ({ id: t.id, label: t.fresh ? `${t.label} ·` : t.label, count: t.count, selected: t.id === tab })) });
  return `<aside class="detail-panel${wide ? ' is-wide' : ''}"${attrs({ role: modal ? 'dialog' : 'region', 'aria-modal': modal ? 'true' : null, 'aria-label': name, ...a })}>${head}${bar}<div class="dp-body" id="dp-body" role="tabpanel" tabindex="0"${attrs({ 'aria-labelledby': `dp-tab-${tab}` })}>${body}</div>${foot ? `<footer class="dp-foot">${foot}</footer>` : ''}</aside>`;
}

/** The panel's tabs, the same set and order wherever it is shown; each holds one kind of thing. */
export const DETAIL_TABS = [['steps', 'Steps'], ['log', 'Log'], ['changes', 'Changes'], ['checks', 'Checks'], ['decisions', 'Decisions'], ['cost', 'Cost']];
/**
 * The tabs a thing has: a tab with nothing to show is left out, never shown empty.
 * @param {Record<string, boolean|number|string>} has   per tab id: true (it has something), a count to show, or falsy (left out)
 * @returns {{id:string, label:string, count:string|number}[]}
 */
export function detailTabs(has = {}) {
  return DETAIL_TABS.filter(([id]) => has[id]).map(([id, label]) => ({ id, label, count: has[id] === true ? '' : has[id] }));
}

const KEPT = 'worca-stillhet.detail-panel', WHERE = 'worca-stillhet.card-layout', OPEN = 'worca-stillhet.detail-open';
const quoted = (s) => String(s).replace(/["\\]/g, '\\$&');

/**
 * Where a thing's details open (panel.detail-where): true for the side panel (the default), false for "Inside the card".
 * @param {Storage} [store]
 */
export function detailsInPanel(store) {
  try { return (store || globalThis.localStorage).getItem(WHERE) !== 'card'; } catch (e) { return true; }
}

/**
 * DetailPanel's behaviour, the same wherever a thing is shown (its card in a chat, its own page, a member of a feature).
 * It owns the state (which thing, which tab, wide, the trigger that gets the focus back), the triggers
 * (`data-dp-open="ID|tab"`, with `data-dp-stage` for a knot; `data-dp-close`; `data-dp-widen`; the panel's own tabs),
 * the stage a knot pointed at (`state.stage`: the page marks that stage `is-pointed` in its Steps, the controller
 * scrolls the panel to it), Esc, the focus in and back, the sheet at 1024px and under, and what it remembers (the last tab and wide). The page
 * gives it only what a thing is and where to paint.
 * @param {object} o
 * @param {Element} o.root      holds the triggers and the panel; hidden, the panel leaves the keys alone
 * @param {(id:string) => ({title:string, mark?:string, word?:string, tabs:object[], body:(tab:string)=>string, foot?:string, tab?:string}|null)} o.resolve
 *        a thing by its id: its header, its tabs, each tab's content, and the tab that fits its state
 * @param {Element|(() => Element|null)} [o.host]   where paint() draws it; its parent gets `has-detail` and `is-detail-wide`
 * @param {() => void} [o.repaint]   the page draws itself again (and calls paint()); without it the panel alone is painted
 * @param {(hit:Element, id:string, tab:string) => boolean|void} [o.point]   before a trigger opens: the page moves to the spot
 *        it names (a knot's stage). True: the spot changed, so an open panel stays open and shows it
 * @param {(state:object) => void} [o.changed]   after the person changed the state, before the redraw
 * @param {() => boolean} [o.held]   something of the page holds Esc now (an open menu)
 * @param {Storage} [o.storage]
 * @returns {{state:{id:string, tab:string, wide:boolean, stage:string}, sidePanel:() => boolean, modal:() => boolean, open:Function, set:Function, close:Function, html:() => string, paint:() => void, click:(e:Event) => boolean}}
 */
export function detailPanelController({ root, resolve, host = null, repaint = null, point = null, changed = null, held = null, storage = null }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const store = storage || (() => { try { return win.localStorage; } catch (e) { return null; } })();
  const s = { id: '', tab: '', wide: false, last: '', stage: '' };
  let from = '', was = '';
  try { const k = JSON.parse(store?.getItem(KEPT) || '{}'); s.wide = !!k.wide; s.last = k.tab || ''; } catch (e) { /* a private window: nothing remembered */ }
  const keep = () => { try { store?.setItem(KEPT, JSON.stringify({ wide: s.wide, tab: s.tab || s.last })); } catch (e) { /* not kept */ } keepOpen(); };
  // what was open comes back after a reload of the same address, in this browser tab only (panel.detail-remembers)
  const tabStore = () => { try { return win.sessionStorage; } catch (e) { return null; } };
  const keepOpen = () => { try { if (s.id) tabStore()?.setItem(OPEN, JSON.stringify({ at: win.location.hash, id: s.id, tab: s.tab })); else tabStore()?.removeItem(OPEN); } catch (e) { /* not kept */ } };
  let reopened = false;
  const reopen = () => {
    if (reopened || s.id) return; reopened = true;
    try { const k = JSON.parse(tabStore()?.getItem(OPEN) || 'null'); if (k && k.at === win.location.hash && sidePanel() && resolve(k.id)) { s.id = k.id; s.tab = s.last = k.tab || s.last; } } catch (e) { /* nothing to bring back */ }
  };
  const modal = () => win.matchMedia?.('(max-width: 1024px)').matches || false;   // a sheet on a tablet, full screen on a phone: a dialog
  const sidePanel = () => detailsInPanel(store);
  const hostEl = () => (typeof host === 'function' ? host() : host);
  const draw = () => { changed?.(s); if (repaint) repaint(); else paint(); };
  const tabOf = (r, tab) => { const ids = (r.tabs || []).map((t) => t.id), now = (x) => (x === 'activity' && !ids.includes(x) ? 'steps' : x);   // a tab remembered under its old name
    return [tab, s.last, r.tab, ids[0]].map(now).find((x) => x && ids.includes(x)) || ''; };

  // the stage a knot pointed at is brought to the top of the panel's body; the page behind does not move
  const toPointed = () => { const b = s.stage !== '' && root.querySelector('.detail-panel .dp-body'), p = b && b.querySelector('.is-pointed'); if (p) b.scrollTop = Math.max(0, b.scrollTop + p.getBoundingClientRect().top - b.getBoundingClientRect().top - 8); };
  function open(id, tab, by) {
    const r = sidePanel() && resolve(id); if (!r) return false;
    const to = tabOf(r, tab);
    if (s.id === id && (s.tab === to || !tab)) { close(); return true; }   // the same trigger again closes it
    s.id = id; s.tab = s.last = to; from = by || from; keep(); draw();
    root.querySelector('[data-dp-title]')?.focus();
    toPointed();
    return true;
  }
  // the page's own code moved it (an address, a link in one of its parts): no toggle, no focus move, no redraw
  function set(id, tab) { s.id = id || ''; if (id && tab) { s.tab = s.last = tab; keep(); } }
  function close() {
    if (!s.id) return; s.id = ''; s.stage = ''; keepOpen(); draw();
    const back = from && root.querySelector(from); from = ''; back?.focus();   // Close and Esc give the focus back to what opened it
  }
  function html() {
    reopen();
    const r = s.id && sidePanel() ? resolve(s.id) : null; if (!r) { s.id = ''; return ''; }
    s.tab = tabOf(r, s.tab);
    const m = modal();
    return (m ? '<div class="dp-scrim" data-dp-close></div>' : '') + detailPanel({ title: r.title, mark: r.mark || '', word: r.word || '', tabs: r.tabs, tab: s.tab, body: r.body(s.tab), wide: s.wide, modal: m, foot: r.foot || '',
      hooks: { close: { 'data-dp-close': '' }, widen: { 'data-dp-widen': '' } }, attrs: { 'data-dp': s.id } });
  }
  function paint() {
    const el = hostEl(); if (!el) return;
    const h = html(), at = h ? `${s.id}|${s.tab}` : '';
    el.parentElement?.classList.toggle('has-detail', !!h); el.parentElement?.classList.toggle('is-detail-wide', !!h && s.wide);
    morph(el, h);   // what stays is the same element: the focus, what was typed and the scroll stay with it
    if (at !== was) { was = at; const b = el.querySelector('.dp-body'); if (b) b.scrollTop = 0; }   // another thing or tab starts at its top
  }
  function click(e) {
    const on = (q) => e.target.closest?.(q); let hit;
    if (on('[data-dp-close]')) { close(); return true; }
    if (on('[data-dp-widen]')) { s.wide = !s.wide; keep(); draw(); return true; }
    if ((hit = on('.detail-panel .dp-tabs [data-tab]'))) { s.tab = s.last = hit.dataset.tab; keep(); draw(); root.querySelector(`#dp-tab-${s.tab}`)?.focus(); return true; }
    if ((hit = on('[data-dp-open]'))) {
      const [id, tab = ''] = hit.dataset.dpOpen.split('|'), st = hit.dataset.dpStage;
      const moved = st != null && st !== s.stage, spot = point?.(hit, id, tab);
      s.stage = st ?? '';   // a knot points at its stage; any other trigger points at none
      if ((spot || moved) && s.id === id && s.tab === (tab || s.tab)) { draw(); toPointed(); return true; }   // the open panel moves to the spot
      open(id, tab, `[data-dp-open="${quoted(hit.dataset.dpOpen)}"]${st != null ? `[data-dp-stage="${quoted(st)}"]` : ''}`);
      return true;
    }
    return false;
  }
  // Esc closes it: beside the page only from the page or the panel, as a sheet from anywhere; a menu or a Dialog closes first
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !s.id || e.defaultPrevented || root.hidden || !root.isConnected || held?.() || doc.querySelector('dialog[open], .menu')) return;
    if (!modal() && !root.contains(e.target) && e.target !== doc.body) return;
    e.preventDefault(); close();
  });
  // as a sheet it is a dialog: Tab stays inside it
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !s.id || !modal() || root.hidden) return;
    const panel = root.querySelector('.detail-panel'); if (!panel) return;
    const stops = [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.getClientRects().length);
    if (!stops.length) return;
    const first = stops[0], last = stops[stops.length - 1], at = doc.activeElement;
    if (!panel.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  });
  win.addEventListener('stillhet-settings', () => { if (!root.hidden) draw(); });   // Settings › Appearance › Task details changed
  return { state: s, sidePanel, modal, open, set, close, html, paint, click };
}
