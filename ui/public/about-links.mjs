// ui/public/about-links.mjs
// The About card's outbound links. Split out of app.js's paintAbout so a test can
// drive it against the real #about-card markup without booting the whole app —
// app.js has no exports at all. Pure DOM in, pure DOM out; no fetch, no listeners.

/**
 * Point the two feedback anchors at `info.bugsUrl` (package.json bugs.url, served
 * as `app.bugsUrl` by GET /api/settings). A missing or empty bugsUrl leaves the
 * static hrefs in index.html alone, so the links work before /api/settings lands.
 *
 * @param {ParentNode} root  any node containing #aboutBugLink / #aboutIdeaLink
 * @param {{bugsUrl?:string}} info
 */
export function paintAboutInto(root, info = {}) {
  if (!root || !info || typeof info.bugsUrl !== 'string' || !info.bugsUrl) return;
  const base = info.bugsUrl.replace(/\/+$/, '');
  const bug = root.querySelector('#aboutBugLink');
  const idea = root.querySelector('#aboutIdeaLink');
  if (bug) bug.href = `${base}/new?labels=bug`;
  if (idea) idea.href = `${base}/new?labels=enhancement`;
}

const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/\S+$/.test(u) ? u : '');
const isStatus = (vs) => !!vs && typeof vs === 'object' && typeof vs.status === 'string';

/**
 * The About card's update state (GET /api/app/version, issue #841): the badge next to the version,
 * the What's new / Changes since links while outdated, the Release notes href and the switch.
 * A missing or malformed payload reads as unknown: no badge, no update links, static hrefs kept.
 *
 * @param {ParentNode} root  any node containing the #about-card rows
 * @param {{current?:string, latest?:string|null, status?:string, enabled?:boolean,
 *          links?:{releaseNotes?:string, whatsNew?:string, compare?:string}}|null} vs
 */
export function paintVersionStatusInto(root, vs) {
  if (!root) return;
  const ok = isStatus(vs);
  const links = ok && vs.links && typeof vs.links === 'object' ? vs.links : {};
  const outdated = ok && vs.status === 'outdated' && typeof vs.latest === 'string' && !!vs.latest;

  const badge = root.querySelector('#aboutUpdateState');
  if (badge) {
    const text = !ok ? '' : vs.status === 'up-to-date' ? 'Latest' : outdated ? `Update available: ${vs.latest}` : '';
    badge.textContent = text;
    badge.hidden = !text;
    if (text) badge.dataset.state = vs.status; else delete badge.dataset.state;
  }

  const notes = root.querySelector('#aboutReleaseNotes');
  if (notes && httpsUrl(links.releaseNotes)) notes.href = links.releaseNotes;

  const link = (sel, url, text) => {
    const a = root.querySelector(sel);
    if (!a) return false;
    const href = outdated ? httpsUrl(url) : '';
    if (href) a.href = href; else a.removeAttribute('href');
    if (href && text) a.textContent = text;
    a.hidden = !href;
    return !!href;
  };
  const shownNew = link('#aboutWhatsNew', links.whatsNew, '');
  const shownCmp = link('#aboutCompare', links.compare, typeof vs?.current === 'string' && vs.current ? `Changes since ${vs.current}` : '');
  const row = root.querySelector('#aboutUpdateLinks');
  if (row) row.hidden = !(shownNew || shownCmp);

  const sw = root.querySelector('#aboutUpdateCheck');
  if (sw && ok && typeof vs.enabled === 'boolean') sw.checked = vs.enabled;
  const btn = root.querySelector('#aboutCheckNow');
  if (btn && sw) btn.hidden = !sw.checked;
}

/** The sidebar-footer marker: visible only while outdated. Never shows for unknown / ahead / up-to-date. */
export function paintUpdateMarkerInto(root, vs) {
  const m = root && root.querySelector('#side-update');
  if (!m) return;
  const show = isStatus(vs) && vs.status === 'outdated' && typeof vs.latest === 'string' && !!vs.latest;
  m.hidden = !show;
  const label = show ? `Update available: Worca ${vs.latest}` : 'Update available';
  m.title = label;
  m.setAttribute('aria-label', label);
}
