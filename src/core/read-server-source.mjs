// The text of ui/server.mjs for source scans in tests (#919). Names only this one file, so tools/test-related.mjs
// links a test that scans the server to server.mjs and nothing else.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_MJS = 'ui/server.mjs';
const UI_DIR = path.dirname(fileURLToPath(new URL('../../ui/server.mjs', import.meta.url)));

/** ui/server.mjs plus, on a split tree, every route file in ui/routes/index.mjs order. */
export function readServerSource(uiDir = UI_DIR) {
  const main = fs.readFileSync(path.join(uiDir, 'server.mjs'), 'utf8');
  const list = path.join(uiDir, 'routes', 'index.mjs');
  if (!fs.existsSync(list)) return main;
  const files = [...fs.readFileSync(list, 'utf8').matchAll(/from '\.\/([a-z0-9-]+\.mjs)'/g)].map((x) => x[1]);
  return [main, ...files.map((f) => fs.readFileSync(path.join(uiDir, 'routes', f), 'utf8'))].join('\n');
}
