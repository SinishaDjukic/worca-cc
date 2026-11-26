// ui/public/security-status-view.mjs — Settings › General › Security (#security-card): the instance's posture from
// GET /api/security/posture (src/core/security-posture.mjs) — where Worca runs, the credential broker, agent users,
// the outbound network, where the proxy login lives, the default execution environment — and, in a container, the box
// image (Current or Stale, the rebuild command). Read-only: no control changes anything here. Divided rows with one
// `.badge` each (docs/design-system.md, Chips and badges); the setup assistant shows the same rows (postureBadge).
import { docsLink } from './docs-links.mjs';

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
/** The row's tone (security-posture.mjs) as a badge colour: green a protection that is on, grey a plain value, amber
 *  only where someone must act. */
export const TONE_BADGE = Object.freeze({ ok: 'green', neutral: 'grey', attention: 'amber' });

/** The chip of one posture row (or the box image): `.badge` + its tone, the same words on every surface. */
export function postureBadge(doc, { value, tone }) {
  const b = el(doc, 'span', `badge ${TONE_BADGE[tone] || 'grey'} posture-badge`, value);
  b.dataset.tone = tone || 'neutral';
  return b;
}

function drow(doc, { label, detail, title, badge }) {
  const row = el(doc, 'div', 'drow security-row');
  row.append(el(doc, 'span', 'drow-label', label));
  if (detail) row.append(el(doc, 'small', 'hint drow-help', detail));
  if (title) row.title = title;
  const ctl = el(doc, 'div', 'drow-control');
  ctl.append(badge);
  row.append(ctl);
  return row;
}

const IMAGE = Object.freeze({ current: ['Current', 'ok'], stale: ['Stale', 'attention'], unknown: ['Unknown', 'neutral'] });

/** The box image row (a container's posture), or null. The tag and the reasons are in its tooltip. */
export function boxImageRow(doc, img) {
  if (!img || !img.image) return null;
  const [value, tone] = IMAGE[img.state] || IMAGE.unknown;
  const row = drow(doc, { label: 'Box image', detail: img.summary || '', title: [img.image, ...(img.reasons || [])].join('\n'),
    badge: postureBadge(doc, { value, tone }) });
  row.dataset.state = img.state;
  const cmd = el(doc, 'small', 'hint drow-help security-cmd');
  cmd.append(doc.createTextNode(img.state === 'stale' ? 'Rebuild it on the host with ' : 'After a spec change, rebuild it on the host with '),
    el(doc, 'code', null, img.command), doc.createTextNode('.'));
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
    const row = drow(doc, { label: r.label, detail: r.detail, title: r.title, badge: postureBadge(doc, { value: r.value || r.status, tone: r.tone }) });
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
