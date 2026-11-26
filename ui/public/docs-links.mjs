// ui/public/docs-links.mjs — links from the UI into Worca's docs. docs.worca.dev serves the changelog and the landing
// page only; the guides live in the repository's docs/ folder, so a link opens the page on GitHub (as the engine
// docs links do, src/core/engines/chat-descriptor.mjs). One place to change when the guides move.
export const DOCS_BASE = 'https://github.com/worca-org/worca/blob/dev/docs/';

/** The guide `page` ('choose-a-setup' or 'choose-a-setup.md'), with an optional #anchor. */
export function docsUrl(page, anchor = '') {
  const file = String(page || '').replace(/\.md$/, '');
  return `${DOCS_BASE}${file}.md${anchor ? `#${String(anchor).replace(/^#/, '')}` : ''}`;
}

/** An <a> that opens a guide in a new tab, in the UI's link convention (target=_blank rel=noopener noreferrer). */
export function docsLink(doc, page, text, { anchor = '', className = 'about-link' } = {}) {
  const a = doc.createElement('a');
  a.href = docsUrl(page, anchor);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  if (className) a.className = className;
  a.textContent = text;
  return a;
}
