// ui/public/index.html, or its parts on a split tree (#919). Names only this one file, so tools/test-related.mjs
// links a test that reads the shell markup to index.html and nothing else.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from './public-assets.mjs';

export const INDEX_HTML = 'ui/public/index.html';
const PUBLIC_DIR = path.dirname(fileURLToPath(new URL('../../ui/public/index.html', import.meta.url)));

export const readIndexHtml = (publicDir = PUBLIC_DIR) => assemble('html', 'index.html', publicDir).text;
