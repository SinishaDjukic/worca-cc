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
