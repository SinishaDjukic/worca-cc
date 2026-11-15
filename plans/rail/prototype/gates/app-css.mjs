// Run: node plans/rail/prototype/gates/app-css.mjs
// Writes the prototype's app.css: the app's /style.css, assembled from the parts in ui/public/parts.json (#919), so
// the file:// prototype draws on the same CSS the app serves. Generated and not committed; ds-check and the sweeps
// write it before they run.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble } from '../../../../src/core/public-assets.mjs';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
export const APP_CSS = here('../../../../ui/public/stillhet/app.css');

export function writeAppCss() {
  const { text } = assemble('css', 'style.css', here('../../../../ui/public'));
  // The app serves its fonts and images from its root (/fonts/…, /assets/…); a file:// page finds them in ui/public.
  // Images (the logo's mask, promos) go in as data: a mask from another file is refused on file://, and the published
  // prototype then needs no asset files. Fonts stay as files.
  const pub = here('../../../../ui/public/');
  const MIME = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp' };
  const out = text.replace(/url\((['"]?)\/(?!\/)([^)'"]+)\1\)/g, (m, q, path) => {
    const ext = path.split('.').pop().toLowerCase();
    if (MIME[ext] && existsSync(pub + path)) return `url(data:${MIME[ext]};base64,${readFileSync(pub + path).toString('base64')})`;
    return `url(${q}../${path}${q})`;
  });
  writeFileSync(APP_CSS, out);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeAppCss();
