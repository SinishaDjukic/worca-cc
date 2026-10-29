// src/core/index-html.mjs — the one server-side render of the web shell: the
// stored theme mode goes into <html data-theme="…"> so the first paint is
// already right (dark-mode design §5.2). Pure: no fs, no settings — the server
// hands in the file text and the mode. `theme` is always one of THEME_MODES
// (settings.mjs#theme guarantees it), so no escaping question arises.
import { FLAGS } from '../shared/flags/registry.mjs';
import { flagsAttr, flagGateCss } from '../shared/flags/resolve.mjs';

export const INDEX_THEME_ANCHOR = '<html lang="en" data-theme="system">';
// Feature flags (docs/feature-flags.md, D5): the server fills this empty sheet with one rule per
// flag that is off, so flagged-off markup never paints. Keys match FLAG_KEY_RE: nothing to escape.
export const FLAG_GATES_ANCHOR = '<style id="flag-gates"></style>';
// The shell's Content-Security-Policy (G23, defence in depth). Scripts load only from this origin:
// index.html holds no inline script or handler attribute (test/ui-index-theme.test.mjs guards
// it), so an injected <script> or onerror= never runs. 'wasm-unsafe-eval' lets voice mode's
// onnxruntime compile its WebAssembly; it allows no JS eval. base-uri stops an injected <base>
// from re-pointing the relative module URLs. Styles stay open: the flag gates are an inline sheet.
export const SHELL_CSP = "script-src 'self' 'wasm-unsafe-eval'; base-uri 'none'; frame-ancestors 'none'";

/**
 * @param {string} html  the on-disk ui/public/index.html
 * @param {'system'|'light'|'dark'} theme
 * @param {'simple'|'advanced'|'expert'} [level]  always one of UI_LEVELS (the server resolves it)
 * @param {Record<string, boolean>} [flags]  resolved { key: on } (src/core/flags.mjs#allFlags)
 * @param {{ git?: boolean }} [opts]  git: is git usable (src/core/git-available.mjs#gitAvailable)
 * @returns {string}
 * @throws {Error} when an anchor is not present (index.html drifted)
 */
export function renderIndexHtml(html, theme, level, flags, { git } = {}) {
  if (!html.includes(INDEX_THEME_ANCHOR)) throw new Error('index.html theme anchor missing');
  // `level` (docs/ui-levels.md) rides the same anchor so the first paint already hides what the
  // interface mode hides. Omitted ⇒ no attribute, and the stylesheet then gates nothing.
  const lvl = level ? ` data-level="${level}"` : '';
  // CONTRACT §0: data-git="on|off" lets the first paint hide git-only surfaces. Omitted ⇒ no attribute.
  const gitAttr = typeof git === 'boolean' ? ` data-git="${git ? 'on' : 'off'}"` : '';
  if (!flags) return html.replace(INDEX_THEME_ANCHOR, `<html lang="en" data-theme="${theme}"${lvl}${gitAttr}>`);
  if (!html.includes(FLAG_GATES_ANCHOR)) throw new Error('index.html flag-gates anchor missing');
  return html
    .replace(INDEX_THEME_ANCHOR, `<html lang="en" data-theme="${theme}"${lvl} data-flags="${flagsAttr(FLAGS, flags)}"${gitAttr}>`)
    .replace(FLAG_GATES_ANCHOR, `<style id="flag-gates">${flagGateCss(FLAGS, flags)}</style>`);
}
