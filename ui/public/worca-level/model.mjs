// ui/public/worca-level/model.mjs — the pure client model for the worca level. Two fetch helpers talk
// to /api/worca-level; the rest turns the served WorcaLevelView into what the hover card shows and
// which dialog (if any) opens. No DOM access.

import { WORCA_LEVEL_COUNT } from '../../../src/shared/worca-levels.mjs';
import { browserTimeZone } from '../schedule-sheet.mjs';

const MAX_SUGGESTIONS = 2;
const TOP_LINE = "You've reached the top level. There is no next level to work toward.";

async function readError(res) {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // an unreadable body falls through to the status message
  }
  return `Request failed (${res.status})`;
}

async function readView(res) {
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

const postJson = (url, body) =>
  globalThis.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, tz: browserTimeZone() }),
  });

export async function fetchWorcaLevel() {
  return readView(await globalThis.fetch(`/api/worca-level?tz=${encodeURIComponent(browserTimeZone())}`));
}

/** Acknowledge 'celebration' of the level `index` that was shown (never "whatever is current"). */
export async function ackWorcaLevel(what, index) {
  return readView(await postJson('/api/worca-level/ack', index === undefined ? { what } : { what, index }));
}

/** An action link is an in-app hash route; anything else the server sends is not rendered as a link. */
export const isHashHref = (href) => typeof href === 'string' && href.startsWith('#');

const isAvatarSrc = (src) => typeof src === 'string' && src !== '';

/** Set an <img>'s src only from a real string, so a malformed view never loads "undefined". */
export function setAvatarSrc(img, src) {
  if (isAvatarSrc(src)) img.setAttribute('src', src);
}

function progressText(progress) {
  if (!progress) return null;
  const tail = progress.unit === 'days' ? 'days' : 'done';
  return `${progress.done} of ${progress.total} ${tail}`;
}

/** Undone required items, then the undone choices of pick items; a solo user never gets a team-only item (A-16). */
function suggestions(next, onTeam) {
  return next
    .filter((a) => !a.done && (onTeam || !a.onlyFor))
    .flatMap((a) => (a.kind === 'pick' && Array.isArray(a.choices) ? a.choices.filter((c) => !c.done) : [a]))
    .filter((a) => isHashHref(a.href))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ label, hint, href }) => ({ label, hint, href }));
}

export function tooltipModel(view) {
  const top = view.top === true;
  const next = Array.isArray(view.next) ? view.next : [];
  const text = top ? null : progressText(view.progress);
  return {
    name: view.level.name,
    levelLine: `Level ${view.level.index} of ${WORCA_LEVEL_COUNT}`,
    tagline: view.level.tagline,
    nextName: top || !view.nextLevel ? null : view.nextLevel.name,
    progressText: text,
    progressLine: text,
    segments: top || !view.progress ? null : { done: view.progress.done, total: view.progress.total },
    tryNextHeading: view.level.index === 1 ? 'Your first steps' : 'Try next',
    tryNext: top ? [] : suggestions(next, view.onTeam === true),
    topLine: top ? TOP_LINE : null,
  };
}

/** sessionStorage key: a celebration or summary was already shown in this browser session. */
export const SESSION_SHOWN_KEY = 'worca-level:shown-in-session';

const RUNNER_INDEX = 2;
// The statuses that mean "this run is over" (app.js isTerminalStatus, kept in step: the model is pure).
const TERMINAL = new Set(['done', 'error', 'stopped', 'aborted', 'failed', 'complete', 'completed', 'interrupted']);
const isTerminal = (status) => TERMINAL.has(String(status || '').toLowerCase());

/** `#history/<p>/<id>` or `#running/<id>[/details…]` as segments; anything else is null. */
function runRoute(hash) {
  const segs = String(hash == null ? '' : hash).replace(/^#/, '').split('/');
  if (segs[0] === 'history') return segs[1] && segs[2] ? { saved: true } : null;
  if (segs[0] === 'running') return segs[1] ? { saved: false, runId: segs[1] } : null;
  return null;
}

/** A run-result route is on screen: a saved run, or a live-route run that has ended. */
export function isRunResultRoute(hash, statusOf) {
  const r = runRoute(hash);
  if (!r) return false;
  return r.saved || (statusOf(r.runId) !== undefined && isTerminal(statusOf(r.runId)));
}

/** The route shows a run that is still going (a known, non-terminal status). */
export function isLiveRunRoute(hash, statusOf) {
  const r = runRoute(hash);
  if (!r || r.saved) return false;
  const status = statusOf(r.runId);
  return !!status && !isTerminal(status);
}

/**
 * Which dialog may open now (D-14): null while anything else holds the person's attention, while one
 * was already shown this session (a level reached while this page was open is the exception: it is celebrated live), or (Runner only) before a run-result route was on screen (D-13).
 * A summary outranks a celebration.
 */
export function pickDialog(view, env = {}) {
  const blocked = env.setupOpen || env.welcomeOpen || env.dialogOpen || env.guideOpen
    || env.menuOpen || env.liveRunOpen || (env.shownThisSession && !env.liveLevelUp);
  if (blocked) return null;
  if (view.summary) return 'summary';
  if (!view.celebration) return null;
  if (view.celebration.index === RUNNER_INDEX && !env.resultSeen) return null;
  return 'celebration';
}
