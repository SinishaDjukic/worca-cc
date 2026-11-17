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

/** Acknowledge 'welcome', or 'celebration' of the level `index` that was shown (never "whatever is current"). */
export async function ackWorcaLevel(what, index) {
  return readView(await postJson('/api/worca-level/ack', index === undefined ? { what } : { what, index }));
}

/** Tell the server a page was opened: 'stats-viewed' or 'team-metrics-viewed'. */
export async function postWorcaLevelEvent(type) {
  return readView(await postJson('/api/worca-level/events', { type }));
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
    tryNext: top
      ? []
      : next
          .filter((a) => !a.done && isHashHref(a.href))
          .slice(0, MAX_SUGGESTIONS)
          .map(({ label, hint, href }) => ({ label, hint, href })),
    topLine: top ? TOP_LINE : null,
  };
}

export function pickDialog(view, { firstRunWelcomeOpen = false, setupOpen = false } = {}) {
  if (firstRunWelcomeOpen || setupOpen) return null;
  if (view.welcome) return `welcome-${view.welcome.kind}`;
  if (view.celebration) return 'celebration';
  return null;
}
