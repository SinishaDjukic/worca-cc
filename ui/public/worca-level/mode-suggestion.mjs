// ui/public/worca-level/mode-suggestion.mjs — the interface-mode suggestion banner (R-po-15). When a level opens a bigger
// interface mode (Hooked -> Advanced, WorcaHolic -> Expert) a dismissible banner offers it. The mode changes ONLY inside
// `onAccept` (the caller's level controller); dismiss and a repaint never touch <html data-level> (I-10).
import { levelRank, LEVEL_INFO } from '../ui-level.mjs';

export const BANNER_ID = 'mode-suggest-banner';
export const HOST_ID = 'mode-suggest-host';
const SVG_NS = 'http://www.w3.org/2000/svg';
const X_PATH = 'M6 6l12 12M18 6L6 18';
const MODE_SENTENCE = Object.freeze({
  advanced: 'Advanced mode shows Marketplace, Workspaces and Schedules in the sidebar.',
  expert: 'Expert mode shows Team metrics, Team policy and the Models page in the sidebar.',
});
const SUGGESTED = Object.keys(MODE_SENTENCE);

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function closeIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', X_PATH);
  svg.appendChild(path);
  return svg;
}

/**
 * Paint (or clear) the banner. It shows only when `view.modeSuggestion` names a mode ABOVE `currentMode`.
 * @param {Document} doc
 * @param {object} view  the served WorcaLevelView
 * @param {{currentMode: string, onAccept: (mode: string) => void, onDismiss: (mode: string) => void}} o
 */
export function paintModeSuggestion(doc, view, { currentMode, onAccept, onDismiss }) {
  doc.getElementById(BANNER_ID)?.remove();
  const mode = view?.modeSuggestion;
  const levelName = view?.level?.name;
  if (!SUGGESTED.includes(mode) || typeof levelName !== 'string' || !levelName) return;
  if (levelRank(mode) <= levelRank(currentMode)) return;
  const host = doc.getElementById(HOST_ID);
  if (!host) return;

  const label = LEVEL_INFO[mode].label;
  const banner = el(doc, 'div', 'wl-mode-suggest');
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'status');
  banner.appendChild(el(doc, 'span', 'wl-mode-suggest-text', `You're ${levelName}. ${MODE_SENTENCE[mode]}`));
  const accept = el(doc, 'button', 'btn btn-sm', `Try ${label} mode`);
  accept.type = 'button';
  accept.addEventListener('click', () => { banner.remove(); onAccept(mode); });
  const dismiss = el(doc, 'button', 'btn btn-quiet btn-icon');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.appendChild(closeIcon(doc));
  dismiss.addEventListener('click', () => { banner.remove(); onDismiss(mode); });
  banner.append(accept, dismiss);
  host.appendChild(banner);
}

/** Record the person's answer; the server never offers that mode again. Resolves the served view; a failure is the caller's to log. */
export async function ackModeSuggestion(mode, answer) {
  const res = await globalThis.fetch('/api/worca-level/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ what: 'mode-suggestion', mode, answer }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}
