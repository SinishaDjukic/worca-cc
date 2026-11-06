// ui/public/worca-level/app-wiring.mjs — how app.js drives the worca level: one WorcaLevelView fetched at
// boot and again (debounced) when the server pokes, the corner / shelf / account-menu card repainted from
// it, and the welcome / celebration dialogs opened in order. A level is shown, never applied: nothing
// here touches the interface mode or a flag (I-6). app.js passes what only it knows (its painters, the
// onboarding answer, whether the first-run welcome or the setup assistant is up).
import { ackWorcaLevel, fetchWorcaLevel, pickDialog, postWorcaLevelEvent } from './model.mjs';
import { dialogOpen } from '../modal-guard.mjs';
import { renderWorcaDialog } from './dialogs.mjs';
import { wireHoverCard } from './hover-card.mjs';
import { renderLevelCard } from '../account-menu.mjs';
import { renderProfileLevel } from './profile-view.mjs';

export const WORCA_REFRESH_EVENTS = new Set([
  'worca-level-changed', 'pipelines-changed', 'plugins-changed', 'workspaces-changed', 'schedules-changed',
  'team-policy-changed', 'team-metrics-changed',
]);
export const WORCA_REFRESH_MS = 250;

/**
 * @param {object} deps
 * @param {HTMLElement} deps.trigger        the account corner (hover card anchor)
 * @param {HTMLElement} deps.menu           the account menu (#acct-menu) that gets the level card
 * @param {() => void} deps.repaint         repaint everything that shows the level (corner, shelf)
 * @param {() => boolean} deps.isSettled    the first onboarding answer is in
 * @param {() => boolean} deps.setupOpen    the setup assistant is open
 */
export function createWorcaLevelWiring({ trigger, menu, repaint, isSettled, setupOpen, doc = globalThis.document }) {
  const state = { view: null, dialog: null, welcomeDone: false, celebrated: 0, refreshTimer: 0, hover: null, seq: 0 };

  /** The level card sits immediately before the Interface-mode row (#acct-lvl); a repaint swaps it in place. */
  function mountLevelCard() {
    const card = renderLevelCard(state.view, { doc });
    const old = menu.querySelector('#acct-level-card');
    if (!card) { old?.remove(); return; }
    if (old) { old.replaceWith(card); return; }
    const anchor = menu.querySelector('#acct-lvl');
    if (anchor) anchor.before(card);
    else (menu.querySelector('.msect') || menu).prepend(card);
  }

  /** The served view without what this page load already closed. */
  function viewForDialog() {
    const view = state.view;
    if (!view) return null;
    return {
      ...view,
      welcome: state.welcomeDone ? null : view.welcome,
      celebration: view.celebration && view.celebration.index > state.celebrated ? view.celebration : null,
    };
  }

  /** Tell the server a dialog was seen; the next poke carries the result, so the answer is not used. */
  function acknowledge(what, index) {
    ackWorcaLevel(what, index).catch((err) => console.warn(`worca level: could not acknowledge ${what}: ${err.message}`));
  }

  /** Open the welcome or celebration dialog the view calls for. Waits for the first-run welcome, the setup
   *  assistant, the onboarding answer (which decides whether the first-run welcome will show) and any other
   *  modal or blocking prompt on screen (D-14). A deferred dialog retries on the next poke or settle; the
   *  prompt's nodes are never hidden or moved. */
  function maybeDialog() {
    if (state.dialog || !isSettled() || dialogOpen(doc)) return;
    const view = viewForDialog();
    if (!view) return;
    const welcome = doc.getElementById('welcome-modal');   // the first-run welcome, when it is showing
    const kind = pickDialog(view, { firstRunWelcomeOpen: !!welcome && !welcome.classList.contains('hidden'), setupOpen: setupOpen() });
    if (!kind) return;
    state.dialog = renderWorcaDialog(kind, view, { doc, onClose: () => {
      state.dialog = null;
      if (kind === 'celebration') {
        state.celebrated = Math.max(state.celebrated, view.celebration.index);
        acknowledge('celebration', view.celebration.index);
      } else {
        state.welcomeDone = true;
        acknowledge('welcome');
      }
      maybeDialog();
    } });
  }

  async function load() {
    const ticket = ++state.seq;
    let view;
    try { view = await fetchWorcaLevel(); } catch (err) {
      console.warn(`worca level: could not load your level: ${err.message}`);
      return;
    }
    if (ticket !== state.seq || !view || !view.level) return;   // a newer read is in flight: never paint the older answer
    state.view = view;
    mountLevelCard();
    repaint();
    maybeDialog();
  }

  /** Coalesce the change broadcasts (a finished run fires several) into one refetch. */
  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => { state.refreshTimer = 0; void load(); }, WORCA_REFRESH_MS);
  }

  /** Record a page view; fire and forget. `thenLoad` refetches the level once the server has the fact. */
  function postViewed(type, thenLoad) {
    postWorcaLevelEvent(type)
      .then(() => { if (thenLoad) return load(); return undefined; })
      .catch((err) => console.warn(`worca level: could not record ${type}: ${err.message}`));
  }

  return {
    state,
    /** Boot, once the account is known: fetch the view, paint, open a dialog, wire the hover card. */
    async boot() {
      if (!state.hover) state.hover = wireHoverCard(trigger, { getView: () => state.view });
      await load();
    },
    /** A server message arrived: refetch when it may have moved the level. */
    onServerMessage(type) { if (WORCA_REFRESH_EVENTS.has(type)) scheduleRefresh(); },
    maybeDialog,
    /** #profile/level was opened: fetch the view and paint it into `host`, unless the page has moved on. */
    showProfile(host, stillOpen) {
      return fetchWorcaLevel()
        .then((view) => { if (stillOpen()) renderProfileLevel(host, view); })
        .catch((err) => {
          if (!stillOpen()) return;
          host.replaceChildren(Object.assign(doc.createElement('p'), { className: 'hint', textContent: `Could not load your level: ${err.message}` }));
        });
    },
    /** A page that feeds the level was opened (once per navigation). Statistics is a fact only; Team metrics
     *  is a fact and then a refetch, since the fact may have moved the level; Team policy only refetches,
     *  because opening it never marks anything. Other pages do nothing. */
    onViewShown(view) {
      if (view === 'stats') postViewed('stats-viewed', false);
      else if (view === 'team-metrics') postViewed('team-metrics-viewed', true);
      else if (view === 'team-policy') void load();
    },
  };
}
