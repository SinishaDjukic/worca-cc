// Run: node plans/rail/prototype/components-js.mjs
// Writes components.js next to this file: the Worca Rail components (ui/public/design-system/components/) bundled
// as one script that sets window.RailUI, so the file:// prototype builds its pages from the app's own components
// (a page opened from disk cannot import modules), and window.RailCatalog (docs/design-system-catalog.json) for the
// gallery. Generated and not committed; ds-check and the sweeps write it before they run.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
export const COMPONENTS_JS = here('components.js');

export function writeComponentsJs() {
  buildSync({ entryPoints: [here('../../../ui/public/design-system/components/index.mjs')], bundle: true, format: 'iife',
    globalName: 'RailUI', outfile: COMPONENTS_JS, legalComments: 'none', logLevel: 'error' });
  appendFileSync(COMPONENTS_JS, `window.RailCatalog = ${readFileSync(here('../../../docs/design-system-catalog.json'), 'utf8').trim()};\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeComponentsJs();
