// ui/public/style.css, or its parts on a split tree (#919). Names only this one file, so tools/test-related.mjs
// links a test that reads the stylesheet to style.css and nothing else.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from './public-assets.mjs';

export const STYLE_CSS = 'ui/public/style.css';
const PUBLIC_DIR = path.dirname(fileURLToPath(new URL('../../ui/public/style.css', import.meta.url)));

export const readStyleCss = (publicDir = PUBLIC_DIR) => assemble('css', 'style.css', publicDir).text;
/** { text, mtimeMs } for serving /style.css with a Last-Modified header. */
export const readStyleCssEntry = (publicDir = PUBLIC_DIR) => {
  const { text, mtimeMs } = assemble('css', 'style.css', publicDir);
  return { text, mtimeMs };
};
