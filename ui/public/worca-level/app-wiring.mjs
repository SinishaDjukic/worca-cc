// ui/public/worca-level/app-wiring.mjs — how app.js drives the worca level: one WorcaLevelView fetched at
// boot and again (debounced) when the server pokes, the corner / shelf / account-menu row repainted from
// it, and the welcome / celebration dialogs opened in order. A level is shown, never applied: nothing
// here touches the interface mode or a flag (I-6). app.js passes what only it knows (its painters, the
// onboarding answer, whether the first-run welcome or the setup assistant is up).
import { fetchWorcaLevel, pickDialog } from './model.mjs';
import { renderWorcaDialog } from './dialogs.mjs';
import { wireHoverCard } from './hover-card.mjs';
import { renderLevelRow } from '../account-menu.mjs';
import { renderProfileLevel } from './profile-view.mjs';

export const WORCA_REFRESH_EVENTS = new Set(['worca-level-changed', 'pipelines-changed', 'plugins-changed', 'workspaces-changed', 'schedules-changed']);
export const WORCA_REFRESH_MS = 250;

/** The shelf's next-level line: the level after the current one, or null at the top (or before a view). */
export function worcaNextFor(view) {
  if (!view || view.top === true || !Array.isArray(view.ladder)) return null;
  const upcoming = view.ladder.find((l) => l.index === view.level.index + 1);
  return upcoming ? { name: upcoming.name, avatar: upcoming.avatar, next: upcoming.index } : null;
}

/**
 * @param {object} deps
 * @param {HTMLElement} deps.trigger        the account corner (hover card anchor)
 * @param {HTMLElement} deps.menu           the account menu (#acct-menu) that gets the "Your level" row
 * @param {() => void} deps.repaint         repaint everything that shows the level (corner, shelf)
 * @param {() => boolean} deps.isSettled    the first onboarding answer is in
 * @param {() => boolean} deps.setupOpen    the setup assistant is open
 */
export function createWorcaLevelWiring({ trigger, menu, repaint, isSettled, setupOpen, doc = globalThis.document }) {
  const state = { view: null, dialog: null, welcomeDone: false, celebrated: 0, refreshTimer: 0, hover: null, seq: 0 };

  function mountLevelRow() {
    const row = renderLevelRow(state.view, { doc });
    const old = menu.querySelector('#acct-level');
    if (!row) { old?.remove(); return; }
    if (old) { old.replaceWith(row); return; }
    const section = menu.querySelector('.msect');
    if (section) section.prepend(row); else menu.append(row);
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

  /** Open the welcome or celebration dialog the view calls for. Waits for the first-run welcome, the setup
   *  assistant and the onboarding answer (which decides whether the first-run welcome will show). */
  function maybeDialog() {
    if (state.dialog || !isSettled()) return;
    const view = viewForDialog();
    if (!view) return;
    const welcome = doc.getElementById('welcome-modal');   // the first-run welcome, when it is showing
    const kind = pickDialog(view, { firstRunWelcomeOpen: !!welcome && !welcome.classList.contains('hidden'), setupOpen: setupOpen() });
    if (!kind) return;
    state.dialog = renderWorcaDialog(kind, view, { doc, onClose: () => {
      state.dialog = null;
      if (kind === 'celebration') state.celebrated = Math.max(state.celebrated, view.celebration.index);
      else state.welcomeDone = true;
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
    mountLevelRow();
    repaint();
    maybeDialog();
  }

  /** Coalesce the change broadcasts (a finished run fires several) into one refetch. */
  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => { state.refreshTimer = 0; void load(); }, WORCA_REFRESH_MS);
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
    /** The Statistics page was opened: a fact for the level, fire and forget. */
    postStatsViewed() {
      fetch('/api/worca-level/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'stats-viewed' }) })
        .then((res) => { if (!res.ok) console.warn(`worca level: stats-viewed was refused (${res.status})`); })
        .catch((err) => console.warn(`worca level: could not record stats-viewed: ${err.message}`));
    },
  };
}
