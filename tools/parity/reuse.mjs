#!/usr/bin/env node
// tools/parity/reuse.mjs — #919 crawl reuse rule (docs/split-by-feature.md, "Crawl reuse rule"): an earlier full crawl, and any
// evidence that depends only on served output, stays valid while origin/dev's SHA is unchanged and the served CSS, the served
// index.html and the route table are byte-identical. Re-crawl only when dev moved or a fingerprint differs.
//   node tools/parity/reuse.mjs --earlier-dev SHA --dev SHA --tree LABEL=DIR [--tree LABEL=DIR ...] --out FILE   (exit 0 valid, 1 not, 2 usage)
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listRoutes } from './routes.mjs';
import { readStyleCss } from '../../src/core/read-style-css.mjs';
import { readIndexHtml } from '../../src/core/read-index-html.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** { css, html, routes, routeCount } of one tree, read through its own src/core readers (this checkout's for a tree
 *  without them, such as dev before the #919 tooling): the monolith on an unsplit tree, its parts on a split one. */
export async function servedFingerprint(dir, { list = listRoutes } = {}) {
  const core = join(dir, 'src', 'core'); const pub = join(dir, 'ui', 'public');
  const own = async (file, name, fallback) => (existsSync(join(core, file)) ? (await import(pathToFileURL(join(core, file)).href))[name] : fallback);
  const css = (await own('read-style-css.mjs', 'readStyleCss', readStyleCss))(pub);
  const html = (await own('read-index-html.mjs', 'readIndexHtml', readIndexHtml))(pub);
  const routes = list({ kind: 'tree', root: dir });   // listRoutes: sorted METHOD path rows (tools/parity/routes.mjs:45)
  return { css: sha256(css), html: sha256(html), routes: sha256(JSON.stringify(routes)), routeCount: routes.length };
}

/** earlier/now: { dev, a, b } with a/b fingerprints (A = dev side, B = split side). */
export function reuseVerdict(earlier, now) {
  const reasons = [];
  if (!earlier?.dev || earlier.dev !== now.dev) reasons.push(`dev moved: ${earlier?.dev?.slice(0, 9) ?? '(none recorded)'} → ${String(now.dev).slice(0, 9)}`);
  for (const side of ['a', 'b']) for (const k of ['css', 'html', 'routes']) {
    if (!earlier?.[side]?.[k] || earlier[side][k] !== now[side]?.[k]) reasons.push(`${side}: ${k} differs`);
  }
  return { valid: !reasons.length, reasons };
}

/** The go/no-go's reuse.json: all trees share one fingerprint, and dev is the earlier run's dev. */
export async function reuseReport({ earlierDev, dev, trees, list = listRoutes }) {
  const fps = []; for (const [label, dir] of trees) fps.push({ label, dir, ...(await servedFingerprint(dir, { list })) });
  const reasons = [];
  if (earlierDev !== dev) reasons.push(`dev moved: ${String(earlierDev).slice(0, 9)} → ${String(dev).slice(0, 9)}`);
  for (const k of ['css', 'html', 'routes']) if (new Set(fps.map((f) => f[k])).size > 1) reasons.push(`${k} differs: ${fps.map((f) => `${f.label} ${f[k].slice(0, 12)}`).join(', ')}`);
  return { earlierDev, dev, trees: fps, valid: !reasons.length, reasons };
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const trees = argv.flatMap((x, i) => (x === '--tree' && /^[a-z0-9-]+=./.test(argv[i + 1] ?? '') ? [[argv[i + 1].split('=')[0], resolve(argv[i + 1].slice(argv[i + 1].indexOf('=') + 1))]] : []));
  if (!arg('--earlier-dev') || !arg('--dev') || !trees.length || !arg('--out')) { log('usage: node tools/parity/reuse.mjs --earlier-dev SHA --dev SHA --tree LABEL=DIR [...] --out FILE'); return 2; }
  const r = await reuseReport({ earlierDev: arg('--earlier-dev'), dev: arg('--dev'), trees });
  writeFileSync(arg('--out'), `${JSON.stringify(r, null, 2)}\n`);
  log(`reuse: ${r.valid ? 'VALID' : 'NOT valid'}${r.reasons.length ? ` — ${r.reasons.join('; ')}` : ''}`);
  return r.valid ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
