// scripts/c4-dagre.mjs — the vendored dagre build (ui/public/c4/dagre.min.js) for Node. The file is
// a browser IIFE that declares `var dagre`; under require() that var stays module-local, so it is
// evaluated here once and the value returned. null when the file is missing or unreadable.
import { readFileSync } from 'node:fs';

let cached;
export function loadDagre() {
  if (cached !== undefined) return cached;
  try {
    const src = readFileSync(new URL('../ui/public/c4/dagre.min.js', import.meta.url), 'utf8');
    const d = new Function(`${src}\n;return dagre;`)();   // eslint-disable-line no-new-func -- the shipped vendor file
    cached = d && d.graphlib && typeof d.layout === 'function' ? d : null;
  } catch { cached = null; }
  return cached;
}
