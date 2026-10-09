// ui/public/alerts.mjs — Alerts: desktop notifications and a waiting badge (Settings › General ›
// Alerts). Only waits that need a person notify (a run's pending question, a run paused on a
// usage limit, an error or a cost cap, a schedule problem);
// never while the tab is visible and focused, never for what was already pending when the page
// loaded, and never twice for one wait (tag worca:<runId>:<questionId>, shared across tabs). The
// body names the run, never the question. The badge — tab title, favicon dot and, where the
// browser has it, the app icon — counts runs waiting plus unread schedule problems.
// Per browser (permission belongs to the browser): the settings live in localStorage and every
// access is try/catch'd. `Notification`, `doc`, `nav`, `storage` and `win` are injected.

export const ALERT_KEYS = Object.freeze({ notify: 'worca-cc.alerts.notify', badge: 'worca-cc.alerts.badge' });
export const TITLE_PREFIX = 'Worca: ';
/** Question kind → notification title. An unknown kind uses GENERIC_TITLE, so a new kind still alerts. */
export const KIND_TITLES = Object.freeze({
  questions: 'Questions waiting',
  clarify: 'Questions waiting',
  form: 'Questions waiting',
  gate: 'Approval needed',
  recovery: 'Recovery decision needed',
  workflow: 'Workflow proposal to review',
  'cost-cap': 'Cost cap reached',
});
export const GENERIC_TITLE = 'Waiting for you';
/** Pause reason (failure-policy REASON) → notification title. A reason not listed — no reason
 * (Pause pressed) or 'drain' (the server stopping) — waits on nobody, so it never notifies. */
export const PAUSE_TITLES = Object.freeze({
  usage_limit: 'Usage limit reached',
  recoverable: 'Run paused on an error',
  error: 'Run paused on an error',
  cost_pipeline: 'Cost cap reached',
  cost_total: 'Cost cap reached',
  cost_pipeline_policy: 'Cost cap reached',
  cost_total_policy: 'Cost cap reached',
  night_guardrail: 'Night guardrail reached',
});
export const SCHEDULE_TITLE = 'Scheduled run needs attention';
export const BLOCKED_HINT = 'Notifications are blocked for this site in your browser settings.';
const UNSUPPORTED_HINT = "This browser doesn't support desktop notifications.";
const INSECURE_HINT = 'Desktop notifications need a secure address: open Worca on https:// or localhost.';
const DOT_COLOR = '#e5484d';

export function kindTitle(kind) {
  return TITLE_PREFIX + (Object.hasOwn(KIND_TITLES, kind) ? KIND_TITLES[kind] : GENERIC_TITLE);
}
export function questionTag(runId, questionId) { return `worca:${runId}:${questionId}`; }
/** The title for a pause that waits on a person, or null. */
export function pauseTitle(reason) {
  return typeof reason === 'string' && Object.hasOwn(PAUSE_TITLES, reason) ? TITLE_PREFIX + PAUSE_TITLES[reason] : null;
}
/** A resume starts a new runId, so one pause tag per run is enough. */
export function pauseTag(runId) { return questionTag(runId, 'pause'); }
/** `title` with its `(N) ` prefix set to n, or removed at 0. */
export function titleWithCount(title, n) {
  const base = String(title == null ? '' : title).replace(/^\(\d+\) /, '');
  return n > 0 ? `(${n}) ${base}` : base;
}
export function badgeCount({ waitingRuns = 0, unreadProblems = 0 } = {}) {
  const c = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
  return c(waitingRuns) + c(unreadProblems);
}

function readKey(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}
function writeKey(storage, key, on) {
  try { if (storage) storage.setItem(key, on ? '1' : '0'); } catch { /* private mode / storage disabled */ }
}
/** {notify, badge}. Notifications are off by default; the badge follows them until it is set itself. */
export function readAlertSettings(storage) {
  const notify = readKey(storage, ALERT_KEYS.notify) === '1';
  const b = readKey(storage, ALERT_KEYS.badge);
  return { notify, badge: b === '1' || b === '0' ? b === '1' : notify };
}

/** The favicon with a dot, as a data URL; null when the browser cannot draw it. */
export function canvasFavicon(doc, href) {
  return new Promise((resolve) => {
    const view = doc.defaultView;
    if (!view || typeof view.Image !== 'function') { resolve(null); return; }
    const img = new view.Image();
    img.onload = () => {
      try {
        const size = 32;
        const canvas = doc.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, size, size);
        ctx.beginPath();
        ctx.arc(size - 8, 8, 7, 0, 2 * Math.PI);
        ctx.fillStyle = DOT_COLOR;
        ctx.fill();
        resolve(canvas.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = href;
  });
}

/**
 * @param {{Notification?: Function|null, doc: Document, nav?: object, storage?: object, win?: object,
 *   onOpen?: (target: {runId: string}|{schedule: true}) => void, drawFavicon?: (href: string) => Promise<string|null>}} opts
 */
export function createAlerts({ Notification: N = null, doc, nav = {}, storage = null, win = {}, onOpen = null, drawFavicon = null }) {
  const notified = new Set();          // tags already notified or deliberately skipped (D7, D8)
  const open = new Map();              // tag -> the Notification this tab is showing
  const counts = { waitingRuns: 0, unreadProblems: 0 };
  let appBadge = 0;
  let iconHref = null;                 // the original favicon, read on first use
  let dotted = null;                   // Promise<string|null>: the dotted favicon, drawn once
  const draw = drawFavicon || ((href) => canvasFavicon(doc, href));

  const settings = () => readAlertSettings(storage);
  function support() {
    if (typeof N !== 'function') return { ok: false, hint: UNSUPPORTED_HINT };
    if (win && win.isSecureContext === false) return { ok: false, hint: INSECURE_HINT };
    return { ok: true, hint: '' };
  }
  const permission = () => (support().ok ? N.permission : 'unsupported');
  const canNotify = () => settings().notify && permission() === 'granted';
  const looking = () => doc.visibilityState === 'visible' && (typeof doc.hasFocus !== 'function' || doc.hasFocus());

  function show(tag, title, body, target) {
    let n;
    try { n = new N(title, { body, tag }); } catch { return null; }
    open.set(tag, n);
    n.onclick = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      try { if (win && typeof win.focus === 'function') win.focus(); } catch { /* not ours to focus */ }
      if (target && typeof onOpen === 'function') onOpen(target);
      close(tag);
    };
    n.onclose = () => { if (open.get(tag) === n) open.delete(tag); };
    return n;
  }
  function close(tag) {
    const n = open.get(tag);
    open.delete(tag);
    try { if (n) n.close(); } catch { /* already gone */ }
  }
  // One wait notifies at most once: the first sighting is remembered whether or not it notified.
  function notifyOnce(tag, title, body, target, quiet) {
    if (notified.has(tag)) return;
    notified.add(tag);
    if (quiet || !canNotify() || looking()) return;
    show(tag, title, body, target);
  }

  const shown = () => (settings().badge ? badgeCount(counts) : 0);
  function applyBadge() {
    const n = shown();
    const title = titleWithCount(doc.title, n);
    if (title !== doc.title) doc.title = title;
    const link = doc.querySelector('link[rel~="icon"]');
    if (link) {
      if (iconHref === null) iconHref = link.getAttribute('href') || '';
      if (n > 0) {
        if (!dotted) dotted = Promise.resolve().then(() => draw(iconHref)).catch(() => null);
        dotted.then((url) => { if (url && shown() > 0) link.setAttribute('href', url); });
      } else if (link.getAttribute('href') !== iconHref) {
        link.setAttribute('href', iconHref);
      }
    }
    if (n !== appBadge) {
      appBadge = n;
      const fn = n > 0 ? nav && nav.setAppBadge : nav && nav.clearAppBadge;
      if (typeof fn === 'function') {
        try { const p = n > 0 ? fn.call(nav, n) : fn.call(nav); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* not installed as an app */ }
      }
    }
  }

  return {
    settings,
    support,
    permission,
    /** Ask the browser. Call it from a click only: Safari and Firefox refuse otherwise. */
    requestPermission() {
      if (!support().ok) return Promise.resolve(permission());
      return new Promise((resolve) => {
        try {
          const p = N.requestPermission((answer) => resolve(answer));     // the old callback form
          if (p && typeof p.then === 'function') p.then(resolve, () => resolve(N.permission));
        } catch { resolve(N.permission); }
      });
    },
    setNotify(on) { writeKey(storage, ALERT_KEYS.notify, !!on); applyBadge(); },
    setBadge(on) { writeKey(storage, ALERT_KEYS.badge, !!on); applyBadge(); },
    /** A run's question. `backfill`: it was already pending when the page loaded (D7). */
    onQuestion(run, msg, { backfill = false } = {}) {
      if (!run || !run.runId || !msg) return;
      const tag = questionTag(run.runId, msg.id != null ? msg.id : msg.kind);
      notifyOnce(tag, kindTitle(msg.kind), run.title || run.runId, { runId: run.runId }, backfill);
    },
    /** A run paused for `reason`. `backfill`: it was already paused when the page loaded (D7). */
    onPaused(run, reason, { backfill = false } = {}) {
      const title = pauseTitle(reason);
      if (!run || !run.runId || !title) return;
      notifyOnce(pauseTag(run.runId), title, run.title || run.runId, { runId: run.runId }, backfill);
    },
    onResolved(run, msg) {
      if (!run || !run.runId) return;
      if (msg && msg.id != null) { close(questionTag(run.runId, msg.id)); return; }
      const prefix = questionTag(run.runId, '');
      for (const tag of [...open.keys()]) if (tag.startsWith(prefix)) close(tag);
    },
    /** A row of the notification log; only an unread-able `problem` notifies. */
    onScheduleNotification(row) {
      if (!row || row.severity !== 'problem' || row.id == null) return;
      notifyOnce(`worca:schedule:${row.id}`, TITLE_PREFIX + SCHEDULE_TITLE, row.title || 'Scheduled run', { schedule: true }, false);
    },
    showTest() {
      if (!canNotify()) return false;
      return !!show('worca:test', `${TITLE_PREFIX}Test`, 'Worca alerts will look like this.', null);
    },
    /** Set either count (runs with a pending question, unread schedule problems) and repaint. */
    updateBadge(next = {}) {
      if ('waitingRuns' in next) counts.waitingRuns = next.waitingRuns;
      if ('unreadProblems' in next) counts.unreadProblems = next.unreadProblems;
      applyBadge();
    },
  };
}

/** Wire the Settings › General › Alerts card. Returns { paint } or null when the card is absent. */
export function mountAlertsCard({ doc, alerts }) {
  const notify = doc.getElementById('alertsNotify');
  const hint = doc.getElementById('alertsNotifyHint');
  const badge = doc.getElementById('alertsBadge');
  const testBtn = doc.getElementById('alertsTest');
  if (!notify || !hint || !badge || !testBtn) return null;
  let denied = false;
  function paint() {
    const s = alerts.settings();
    const sup = alerts.support();
    const perm = alerts.permission();
    notify.disabled = !sup.ok;
    notify.checked = sup.ok && s.notify && perm === 'granted';
    const msg = !sup.ok ? sup.hint : (denied || (s.notify && perm === 'denied')) ? BLOCKED_HINT : '';
    hint.textContent = msg;
    hint.hidden = !msg;
    badge.checked = s.badge;
    testBtn.disabled = !notify.checked;
  }
  notify.addEventListener('change', async () => {
    if (!notify.checked) { denied = false; alerts.setNotify(false); paint(); return; }
    const answer = await alerts.requestPermission();
    denied = answer === 'denied';
    alerts.setNotify(answer === 'granted');
    paint();
  });
  badge.addEventListener('change', () => { alerts.setBadge(badge.checked); paint(); });
  testBtn.addEventListener('click', () => { alerts.showTest(); });
  paint();
  return { paint };
}
