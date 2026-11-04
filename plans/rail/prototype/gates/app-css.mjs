// Run: node plans/rail/prototype/app-css.mjs
// Writes app.css next to this file: the app's /style.css, assembled from the parts in ui/public/parts.json (#919), so
// the file:// prototype draws on the same CSS the app serves. Generated and not committed; ds-check and the sweeps
// write it before they run.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble } from '../../../../src/core/public-assets.mjs';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
export const APP_CSS = here('../app.css');

export function writeAppCss() {
  const { text } = assemble('css', 'style.css', here('../../../../ui/public'));
  writeFileSync(APP_CSS, text);
  return text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeAppCss();
