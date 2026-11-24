// ui/public/worca-level/app-wiring.mjs — how app.js drives the worca level: one WorcaLevelView fetched at
// boot and again (debounced) when the server pokes, the corner / shelf / account-menu card repainted from
// it, and the celebration dialog opened. A level is shown, never applied: nothing
// here touches the interface mode or a flag (I-6). app.js passes what only it knows (its painters, the
// onboarding answer, whether the first-run welcome or the setup assistant is up).
import { SESSION_SHOWN_KEY, ackWorcaLevel, fetchWorcaLevel, isLiveRunRoute, isRunResultRoute, pickDialog } from './model.mjs';
import { dialogOpen } from '../modal-guard.mjs';
import { renderWorcaDialog } from './dialogs.mjs';
import { mountLevelCard } from './level-card.mjs';
import { nudgeNotice, runFinishedNotice } from './notices.mjs';
import { notify as defaultNotify } from '../feedback.mjs';
import { renderProfileLevel } from './profile-view.mjs';

export const WORCA_REFRESH_EVENTS = new Set([
  'worca-level-changed', 'pipelines-changed', 'plugins-changed', 'workspaces-changed', 'schedules-changed',
  'team-policy-changed', 'team-metrics-changed', 'onboarding-changed', 'hello',
]);
export const WORCA_REFRESH_MS = 250;
export const WORCA_RETRY_MS = 5000;
/** Opening these pages re-checks the shared-repo facts (a forced discovery), then re-reads the level. */
export const DISCOVER_ENDPOINTS = { 'team-metrics': '/api/team-metrics/discover', 'team-policy': '/api/policy/discover' };
export const DISCOVER_MIN_MS = 60000;
export const DISCOVER_CEILING_MS = 10000;

/** A pending retry or refresh must never keep a process alive (app.js _timerTick is unref'd for the same reason). */
function unrefTimer(t) { if (t && typeof t.unref === 'function') t.unref(); }
export const RUN_NOTICE_MS = 7000;
export const RUN_NOTICE_KEY = 'worca-run-progress';
export const NUDGE_NOTICE_KEY = 'worca-level-nudge';

/** A served view has `count`, a `ladder` and a `setup` object; `level` is a level, or `null` for a person who has none yet. */
export function isUsableView(view) {
  if (!view || typeof view !== 'object') return false;
  if (view.level === null) return !!view.setup && typeof view.setup === 'object' && Array.isArray(view.ladder);
  return !!view.level && typeof view.level === 'object';
}

/** Acknowledge the nudge `id` that was shown; the answer (a view) is not used, the next poke carries the result. */
async function ackNudge(id) {
  const res = await globalThis.fetch('/api/worca-level/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ what: 'nudge', id }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

/**
 * @param {object} deps
 * @param {HTMLElement} deps.menu           the account menu (#acct-menu) that gets the level card
 * @param {() => void} deps.repaint         repaint everything that shows the level (corner, shelf)
 * @param {() => boolean} deps.isSettled    the first onboarding answer is in
 * @param {() => boolean} deps.setupOpen    the setup assistant is open
 * @param {() => string} [deps.hashNow]      the current route (`location.hash`); tests replace it
 * @param {(runId: string) => string|undefined} [deps.runStatus]  a live run's status, for the route gate
 * @param {() => string} [deps.initials]    the person's initials, for the card of someone with no level yet
 * @param {() => void} [deps.onFinishSetup] the no-level card's "Finish setup"
 * @param {() => void} [deps.onSignIn]      the no-level card's "Sign in to a model"
 * @param {(o: object) => void} [deps.notify]  the toast (the run-finished message); tests replace it
 * @param {() => Promise<object>} [deps.fetchView]  how the view is read; tests replace it
 */
export function createWorcaLevelWiring({ menu, repaint, isSettled, setupOpen, initials = () => '', onFinishSetup, onSignIn, notify = defaultNotify, fetchView = fetchWorcaLevel, hashNow = () => globalThis.location?.hash || '', runStatus = () => undefined, doc = globalThis.document, now = () => Date.now() }) {
  const state = { view: null, retried: false, profile: null, dialog: null, celebrated: 0, refreshTimer: 0, retryTimer: 0, seq: 0, finished: [], resultSeen: false, nudged: new Set(), bootLevel: null, discoveredAt: {} };

  /** The level card is the first child of the menu, its own top group; a repaint swaps it in place. */
  function paintLevelCard() {
    mountLevelCard(doc, menu, state.view, { initials: initials(), onFinishSetup, onSignIn });
  }

  /** The served view without what this page load already closed. */
  function viewForDialog() {
    const view = state.view;
    if (!view) return null;
    return {
      ...view,
      celebration: view.celebration && view.celebration.index > state.celebrated ? view.celebration : null,
    };
  }

  /** Tell the server a dialog was seen; the next poke carries the result, so the answer is not used. */
  function acknowledge(what, index) {
    ackWorcaLevel(what, index).catch((err) => console.warn(`worca level: could not acknowledge ${what}: ${err.message}`));
  }

  /** The almost-there toast, once per item: the ack latches it on the server even if the toast is missed (I-11), and
   *  `state.nudged` keeps a second load from toasting it again before that ack lands. Not over an open dialog. */
  function showNudge() {
    const nudge = nudgeNotice(state.view);
    if (!nudge || state.dialog || state.nudged.has(nudge.id)) return;
    state.nudged.add(nudge.id);
    notify({ tone: 'info', title: nudge.title, key: NUDGE_NOTICE_KEY, timeout: RUN_NOTICE_MS });
    ackNudge(nudge.id).catch((err) => console.warn(`worca level: could not acknowledge nudge: ${err.message}`));
  }

  const shownThisSession = () => {
    try { return doc.defaultView?.sessionStorage.getItem(SESSION_SHOWN_KEY) === '1'; } catch { return false; }
  };
  const markShownThisSession = () => {
    try { doc.defaultView?.sessionStorage.setItem(SESSION_SHOWN_KEY, '1'); } catch { /* storage blocked: state.celebrated still holds for this page load */ }
  };
  const guideOpen = () => !!doc.querySelector('.guide-scrim, .guide-balloon:not([hidden])');

  /** Runner is celebrated only after a run's result was on screen: noted while, or after, it is pending. */
  function noteResultSeen(view) {
    if (state.resultSeen || view.celebration?.index !== 2) return;
    if (isRunResultRoute(hashNow(), runStatus)) state.resultSeen = true;
  }

  /** Open the dialog the view calls for, once the person is ready for it (D-14): not over the first-run welcome,
   *  the setup assistant, any other modal, a guide, the open account menu or a live run, and at most one per
   *  browser session. A deferred dialog retries on the next poke, settle, route change, guide close or menu
   *  close; the prompt's nodes are never hidden or moved. */
  function maybeDialog() {
    if (state.dialog || !isSettled()) return;
    const view = viewForDialog();
    if (!view) return;
    noteResultSeen(view);
    const welcome = doc.getElementById('welcome-modal');   // the first-run welcome, when it is showing
    const kind = pickDialog(view, {
      setupOpen: setupOpen(),
      welcomeOpen: !!welcome && !welcome.classList.contains('hidden'),
      dialogOpen: dialogOpen(doc),
      guideOpen: guideOpen(),
      menuOpen: !menu.hidden,
      liveRunOpen: isLiveRunRoute(hashNow(), runStatus),
      shownThisSession: shownThisSession(),
      resultSeen: state.resultSeen,
      liveLevelUp: state.bootLevel !== null && (view.celebration?.index ?? 0) > state.bootLevel,
    });
    if (!kind) return;
    markShownThisSession();
    state.dialog = renderWorcaDialog(kind, view, { doc, onClose: () => {
      state.dialog = null;
      if (kind === 'summary') {
        acknowledge('summary');
        return;
      }
      state.celebrated = Math.max(state.celebrated, view.celebration?.index ?? 0);
      acknowledge('celebration', view.celebration?.index);
    } });
  }

  /** The Profile page repaints with every fresh view while it is open; a page that has moved on is forgotten. */
  function repaintProfile() {
    const open = state.profile;
    if (!open) return;
    if (!open.stillOpen()) { state.profile = null; return; }
    renderProfileLevel(open.host, state.view, { initials: initials() });
  }

  /** A failed first load leaves no view (the corner keeps the initials, the menu has no level block). One retry
   *  waits WORCA_RETRY_MS; if that fails too, nothing more is scheduled until a newer load (a reconnect `hello`,
   *  a refresh event) takes its place. A failure with a view already painted keeps that view and schedules nothing. */
  function scheduleRetry() {
    clearTimeout(state.retryTimer);
    state.retried = true;
    state.retryTimer = setTimeout(() => { state.retryTimer = 0; void load(); }, WORCA_RETRY_MS);
    unrefTimer(state.retryTimer);
  }

  async function load() {
    const ticket = ++state.seq;
    clearTimeout(state.retryTimer);
    state.retryTimer = 0;
    let view;
    try { view = await fetchView(); } catch (err) {
      console.warn(`worca level: could not load your level: ${err.message}`);
      if (ticket === state.seq && !state.view && !state.retried) scheduleRetry();
      return;
    }
    if (ticket !== state.seq) return;   // a newer read is in flight: never paint the older answer
    if (!isUsableView(view)) {
      if (!state.view && !state.retried) scheduleRetry();   // a view that fails the shape check is a failure
      return;
    }
    state.retried = false;
    state.view = view;
    state.bootLevel ??= view.level?.index ?? 0;   // the level this page load started at: a higher one is reached live
    paintLevelCard();
    repaint();
    repaintProfile();
    maybeDialog();
    showRunFinished(ticket);
    showNudge();
  }

  /** The run-finished message: the finishes queued before this load began are answered from this view, once. */
  function showRunFinished(ticket) {
    const ready = state.finished.filter((q) => q.after < ticket);
    if (ready.length === 0) return;
    state.finished = state.finished.filter((q) => q.after >= ticket);
    const notice = runFinishedNotice(state.view, ready[ready.length - 1].run);
    if (notice) notify({ tone: 'info', title: notice.title, key: RUN_NOTICE_KEY, timeout: RUN_NOTICE_MS });
  }

  /** Coalesce the change broadcasts (a finished run fires several) into one refetch. */
  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => { state.refreshTimer = 0; void load(); }, WORCA_REFRESH_MS);
    unrefTimer(state.refreshTimer);
  }

  /** Ask the server to re-check the shared-repo facts, then re-read the level. Best effort: a failed or slow
   *  discovery (offline, no git) keeps the cached verdict and the level is re-read anyway. */
  async function discoverThenLoad(view) {
    const at = now();
    const last = state.discoveredAt[view];
    if (last !== undefined && at - last < DISCOVER_MIN_MS) { void load(); return; }
    state.discoveredAt[view] = at;
    let ceiling;
    try {
      await Promise.race([
        globalThis.fetch(`${DISCOVER_ENDPOINTS[view]}?source=page`, { method: 'POST' }),
        new Promise((resolve) => { ceiling = setTimeout(resolve, DISCOVER_CEILING_MS); unrefTimer(ceiling); }),
      ]);
    } catch { /* offline or no git: the cached verdict stays */ }
    clearTimeout(ceiling);
    void load();
  }

  doc.addEventListener?.('visibilitychange', () => {
    if (doc.visibilityState === 'visible') scheduleRefresh();   // a poke may have been missed while hidden
  });

  return {
    state,
    /** Boot, once the account is known: fetch the view, paint, open a dialog. */
    async boot() { await load(); },
    /** The viewer's own run finished (`{ runId, real }`): say how it counts once the next fresh view is in. */
    queueRunFinished(run) {
      state.finished = [...state.finished, { run, after: state.seq }];
      scheduleRefresh();
    },
    /** Refetch now (tests; the poke path coalesces through scheduleRefresh). */
    refreshNow: load,
    /** A server message arrived: refetch when it may have moved the level. */
    onServerMessage(type) { if (WORCA_REFRESH_EVENTS.has(type)) scheduleRefresh(); },
    /** A view an acknowledgement answered with: it replaces the held one (no repaint), so what was just answered stays answered. */
    adoptView(view) { if (isUsableView(view)) state.view = view; },
    maybeDialog,
    /** The route changed: a deferred dialog may now be allowed (a result route, a run that ended). */
    onRouteChange() { maybeDialog(); },
    /** #profile/level was opened: fetch the view and paint it into `host`, unless the page has moved on. */
    showProfile(host, stillOpen) {
      return fetchWorcaLevel()
        .then((view) => {
          if (!stillOpen()) return;
          if (!isUsableView(view)) throw new Error('the server sent a level view this page cannot read');
          renderProfileLevel(host, view, { initials: initials() });
          state.profile = { host, stillOpen };
        })
        .catch((err) => {
          if (!stillOpen()) return;
          host.replaceChildren(Object.assign(doc.createElement('p'), { className: 'hint', textContent: `Could not load your level: ${err.message}` }));
        });
    },
    /** A page was opened (once per navigation). Team metrics and Team policy re-check their shared-repo facts
     *  (at most once a minute) and refetch, because opening them can change what the card says; no page view is
     *  ever posted to the server. */
    onViewShown(view) {
      if (DISCOVER_ENDPOINTS[view]) void discoverThenLoad(view);
    },
  };
}
