// ui/public/security-status-view.mjs — Settings › General › Security (#security-card): the instance's posture from
// GET /api/security/posture (src/core/security-posture.mjs) — where Worca runs, the credential broker, agent users,
// the outbound network, where the proxy login lives, the default execution environment — and, in a container, the box
// image (tag, current or stale, the rebuild command as text). Read-only: no control changes anything here.
import { docsLink } from './docs-links.mjs';

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
/** The status chip's tone: on reads green, off muted (a choice, not a fault), unknown amber. */
export const TONE = Object.freeze({ on: 'ok', off: 'muted', unknown: 'warn' });

function chip(doc, text, status) {
  const c = el(doc, 'span', 'exec-env-status security-chip', text);
  c.dataset.tone = TONE[status] || 'muted';
  return c;
}

function drow(doc, { label, detail, chipText, status }) {
  const row = el(doc, 'div', 'drow security-row');
  row.append(el(doc, 'span', 'drow-label', label));
  if (detail) row.append(el(doc, 'small', 'hint drow-help', detail));
  const ctl = el(doc, 'div', 'drow-control');
  ctl.append(chip(doc, chipText, status));
  row.append(ctl);
  return row;
}

/** The box image row (item of a container's posture), or null. */
export function boxImageRow(doc, img) {
  if (!img || !img.image) return null;
  const status = img.state === 'current' ? 'on' : img.state === 'stale' ? 'off' : 'unknown';
  const text = img.state === 'current' ? 'Current' : img.state === 'stale' ? 'Stale' : 'Unknown';
  const parts = [img.image];
  if (img.reasons?.length) parts.push(img.reasons.join('; '));
  const row = drow(doc, { label: 'Box image', detail: `${parts.join(': ')}.`, chipText: text, status });
  row.dataset.state = img.state;
  if (status === 'off') row.querySelector('.exec-env-status').dataset.tone = 'warn';
  const cmd = el(doc, 'small', 'hint drow-help security-cmd');
  cmd.append(doc.createTextNode(img.state === 'current' ? 'After a spec change, rebuild on the host: ' : 'Rebuild on the host: '), el(doc, 'code', null, img.command));
  cmd.append(doc.createTextNode('.'));
  if (img.note) cmd.append(doc.createTextNode(` ${img.note}`));
  row.insertBefore(cmd, row.querySelector('.drow-control'));
  return row;
}

/** Paint one posture payload into `host` (the card's body). */
export function paintSecurityStatus(host, posture) {
  if (!host) return;
  const doc = host.ownerDocument;
  host.replaceChildren();
  if (!posture || !Array.isArray(posture.rows)) {
    host.append(el(doc, 'p', 'hint', 'The security status is not available from this server.'));
    return;
  }
  const list = el(doc, 'div', 'drows security-rows');
  for (const r of posture.rows) {
    const row = drow(doc, { label: r.label, detail: r.detail, chipText: r.value || r.status, status: r.status });
    row.dataset.row = r.id;
    list.append(row);
  }
  const img = boxImageRow(doc, posture.boxImage);
  if (img) list.append(img);
  host.append(list);
  const links = el(doc, 'p', 'hint security-links');
  links.append(docsLink(doc, 'security-overview', 'Security overview'), doc.createTextNode(' · '), docsLink(doc, 'choose-a-setup', 'Choose a setup'));
  if (posture.where === 'hardened') links.append(doc.createTextNode(' · '), docsLink(doc, 'hardened-box', 'Hardened box'));
  host.append(links);
}

/** Load and paint; a failed fetch says so in the card. @returns {Promise<object|null>} the posture */
export async function loadSecurityStatus(host, { fetchFn = (u) => fetch(u) } = {}) {
  let posture = null;
  try { const r = await fetchFn('/api/security/posture'); posture = r.ok ? await r.json() : null; } catch { posture = null; }
  paintSecurityStatus(host, posture);
  return posture;
}
