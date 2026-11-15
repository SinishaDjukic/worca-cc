// The page the gates open for index.html: the prototype from disk by default, or the running app when STILLHET_TARGET names its
// base URL (tools/stillhet-gates.mjs sets it). The other pages (components.html, run-page.html, pulse.html) always open from disk.
import { fileURLToPath } from 'node:url';
import { writeAppCss } from './app-css.mjs';
import { writeComponentsJs } from './components-js.mjs';

const INDEX_FILE = fileURLToPath(new URL('../index.html', import.meta.url));

/** The address of index.html, with an optional hash route. */
export const indexUrl = (hash = '') => (process.env.STILLHET_TARGET ? process.env.STILLHET_TARGET.replace(/\/$/, '') + '/' : 'file://' + INDEX_FILE) + hash;

/** The address of a prototype page by file name. */
export const pageUrl = (name, file) => (name === 'index.html' ? indexUrl() : 'file://' + file);

/** Builds the shared bundles (app.css, components.js, graph.js) for a gate run from disk. Against the app the runner
 *  (tools/stillhet-gates.mjs) has built them once before any gate starts, so a gate never rewrites them mid-run. */
export const buildBundles = () => { if (process.env.STILLHET_TARGET) return; writeAppCss(); writeComponentsJs(); };
