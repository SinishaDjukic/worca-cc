// ui/public/worca-level/model.mjs — the pure client model for the worca level. Two fetch helpers talk
// to /api/worca-level; the rest turns the served WorcaLevelView into what the hover card shows and
// which dialog (if any) opens. No DOM access.

const LEVEL_COUNT = 4;
const MAX_SUGGESTIONS = 2;
const TOP_LINE = 'You are at the top level. Keep leading the pod.';

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

export async function fetchWorcaLevel() {
  return readView(await globalThis.fetch('/api/worca-level'));
}

/** Acknowledge 'welcome', or 'celebration' of the level `index` that was shown (never "whatever is current"). */
export async function ackWorcaLevel(what, index) {
  return readView(
    await globalThis.fetch('/api/worca-level/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(index === undefined ? { what } : { what, index }),
    }),
  );
}

/** An action link is an in-app hash route; anything else the server sends is not rendered as a link. */
export const isHashHref = (href) => typeof href === 'string' && href.startsWith('#');

const isAvatarSrc = (src) => typeof src === 'string' && src !== '';

/** Set an <img>'s src only from a real string, so a malformed view never loads "undefined". */
export function setAvatarSrc(img, src) {
  if (isAvatarSrc(src)) img.setAttribute('src', src);
}

export function tooltipModel(view) {
  const top = view.top === true;
  const next = Array.isArray(view.next) ? view.next : [];
  return {
    name: view.level.name,
    levelLine: `Level ${view.level.index} of ${LEVEL_COUNT}`,
    progressLine: view.progress ? `${view.progress.done} of ${view.progress.total} done` : null,
    tryNext: top ? [] : next.filter((a) => !a.done && isHashHref(a.href)).slice(0, MAX_SUGGESTIONS),
    topLine: top ? TOP_LINE : null,
  };
}

export function pickDialog(view, { firstRunWelcomeOpen = false, setupOpen = false } = {}) {
  if (firstRunWelcomeOpen || setupOpen) return null;
  if (view.welcome) return `welcome-${view.welcome.kind}`;
  if (view.celebration) return 'celebration';
  return null;
}
