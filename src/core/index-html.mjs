// src/core/index-html.mjs — the one server-side render of the web shell: the
// stored theme mode goes into <html data-theme="…"> so the first paint is
// already right (dark-mode design §5.2). Pure: no fs, no settings — the server
// hands in the file text and the mode. `theme` is always one of THEME_MODES
// (settings.mjs#theme guarantees it), so no escaping question arises.
export const INDEX_THEME_ANCHOR = '<html lang="en" data-theme="system">';

/**
 * @param {string} html  the on-disk ui/public/index.html
 * @param {'system'|'light'|'dark'} theme
 * @param {'simple'|'advanced'|'expert'} [level]  always one of UI_LEVELS (the server resolves it)
 * @returns {string}
 * @throws {Error} when the anchor is not present (index.html drifted)
 */
export function renderIndexHtml(html, theme, level) {
  if (!html.includes(INDEX_THEME_ANCHOR)) throw new Error('index.html theme anchor missing');
  // `level` (docs/ui-levels.md) rides the same anchor so the first paint already hides what the
  // interface mode hides. Omitted ⇒ no attribute, and the stylesheet then gates nothing.
  const lvl = level ? ` data-level="${level}"` : '';
  return html.replace(INDEX_THEME_ANCHOR, `<html lang="en" data-theme="${theme}"${lvl}>`);
}
