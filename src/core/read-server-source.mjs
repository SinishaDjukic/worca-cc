// The text of ui/server.mjs for source scans in tests (#919). Names only this one file, so tools/test-related.mjs
// links a test that scans the server to server.mjs and nothing else.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_MJS = 'ui/server.mjs';
const UI_DIR = path.dirname(fileURLToPath(new URL('../../ui/server.mjs', import.meta.url)));

/** ui/server.mjs plus, on a split tree, every route file in ui/routes/index.mjs order (feature indexes followed). */
export function readServerSource(uiDir = UI_DIR) {
  const main = fs.readFileSync(path.join(uiDir, 'server.mjs'), 'utf8');
  const routes = path.join(uiDir, 'routes');
  if (!fs.existsSync(path.join(routes, 'index.mjs'))) return main;
  const files = (rel) => {
    const base = path.posix.dirname(rel);
    return [...fs.readFileSync(path.join(routes, rel), 'utf8').matchAll(/from '\.\/([a-z0-9-]+(?:\/index)?\.mjs)'/g)]
      .flatMap(([, f]) => { const r = base === '.' ? f : `${base}/${f}`; return f.endsWith('/index.mjs') ? files(r) : [r]; });
  };
  return [main, ...files('index.mjs').map((f) => fs.readFileSync(path.join(routes, f), 'utf8'))].join('\n');
}
