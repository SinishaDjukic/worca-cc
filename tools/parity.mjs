// tools/parity.mjs — #919 slice 2: end-to-end parity of two targets (routes, flows, visuals, timings).
//   snapshot --target T --out DIR                         one target → DIR/snapshot.json + DIR/shots/*.png
//   compare  --a DIR --b DIR --out DIR                    two snapshots → report.json + report.md (exit 1 unless PASS)
//   run      --a T --b T --out DIR [--quick] [--no-timing-gate]   both snapshots (timings interleaved) + compare
//   crawl    --a T --b T [--b T …] --out DIR [--workers N] [--screens GLOB] [--no-control] [--keep]
//                                                         the differential crawl (tools/parity/crawl.mjs; tree: and package: only)
// T is tree:DIR | package:DIR (npm pack of that tree) | docker:IMAGE. See docs/parity-harness.md.
import { mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTarget, startTarget, installPackage, fixedRoot } from './parity/launch.mjs';
import { seed } from './parity/seed.mjs';
import { listRoutes, probeSignedIn, probeSignedOut } from './parity/routes.mjs';
import { FLOWS, openBrowser, newPage, flowError } from './parity/flows.mjs';
import { capture, diffPng, writeDiffPng } from './parity/visual.mjs';
import { measureBoot, measurePageLoad, RUNS } from './parity/timing.mjs';
import { compareSnapshots, renderReport, summaryLine, flowLine, timingLine } from './parity/compare.mjs';
import { crawl } from './parity/crawl.mjs';
import { crawlSummary } from './parity/crawl-compare.mjs';

const PAGE_LOADS = { 'chat-home': '#chat/new', runs: '#runs' };

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const need = (k) => { const v = arg(k); if (!v) throw new Error(`${cmd} needs ${k}`); return v; };
  const flags = { quick: rest.includes('--quick'), gateTimings: !rest.includes('--no-timing-gate') };
  if (cmd === 'snapshot') return { cmd, target: need('--target'), out: need('--out'), ...flags };
  if (cmd === 'compare' || cmd === 'run') return { cmd, a: need('--a'), b: need('--b'), out: need('--out'), ...flags };
  if (cmd === 'crawl') {
    const all = (k) => rest.flatMap((x, i) => (x === k ? [rest[i + 1]] : []));
    const o = { cmd, a: need('--a'), bs: all('--b'), out: need('--out'), workers: Number(arg('--workers') ?? 8), screens: arg('--screens'),
      control: !rest.includes('--no-control'), keep: rest.includes('--keep') };
    if (!o.bs.length) throw new Error('crawl needs --b');
    if ([o.a, ...o.bs].some((x) => /^docker:/.test(x))) throw new Error('crawl supports tree: and package: targets');
    if (!(Number.isInteger(o.workers) && o.workers > 0)) throw new Error('crawl --workers must be a positive integer');
    return o;
  }
  throw new Error('usage: parity.mjs snapshot|compare|run|crawl …');
}

function resolveSpec(spec) {
  const t = parseTarget(spec);
  if (t.kind === 'docker') return t;
  return t.kind === 'package' ? { ...t, appDir: installPackage(resolve(t.ref)), root: undefined } : { ...t, root: resolve(t.ref) };
}

const seededTarget = async (spec, opts) => {
  const t = await startTarget(spec, opts);
  try { return { t, seed: await seed(t) }; } catch (e) { await t.stop(); throw e; }
};

/** One target: probe server, signed-out server, UI server (D8). Boot timings come from `run`. */
export async function snapshot(spec, out, { bootMs = [], samples = 1, log = () => {}, side = 'A' } = {}) {
  mkdirSync(join(out, 'shots'), { recursive: true });
  const name = `${spec.kind}:${spec.ref}`;
  const snap = { target: name, kind: spec.kind, routes: {}, flows: [], shots: [], timings: { samples, bootMs, pageLoadMs: {} } };
  const routes = listRoutes({ ...spec, root: spec.root ?? spec.appDir });
  // 1. probe server (its own seed; its state is thrown away)
  let probe = await seededTarget(spec);
  try {
    const res = await probeSignedIn(probe.t, routes, probe.seed, { log,
      restart: async () => { await probe.t.stop(); probe = await seededTarget(spec); return probe; } });
    snap.routes.signedIn = res.rows;
    const n = (f) => res.rows.filter(f).length;
    log(`routes ${side}: ${routes.length} listed, ${n((r) => !r.skipped)} probed, ${n((r) => r.skipped)} skipped, ${n((r) => r.status === 'crashed')} crashed`);
  } finally { await probe.t.stop(); }
  // 2. signed-out server (unseeded, remote mode)
  const so = await startTarget({ ...spec, signedOut: true });
  try {
    snap.routes.signedOut = await probeSignedOut(so, routes);
    const bad = snap.routes.signedOut.filter((r) => r.problem).length;
    log(`signed out ${side}: ${snap.routes.signedOut.filter((r) => r.status === 401).length} → 401, 2 public, ${bad} unexpected`);
  } finally { await so.stop(); }
  // 3. UI server at fixed paths: captures on the clean seed, then the flows
  const lock = spec.kind === 'docker' ? null : fixedRoot();
  let ui; let browser;
  try {
    ui = await seededTarget(spec, lock ? { fixed: lock.root } : {});
    browser = await openBrowser();
    const page = await newPage(browser, ui.t);
    snap.shots = await capture(page, ui.t, ui.seed, join(out, 'shots'), log);
    const state = {};                                          // shared by the flows: run-finish's run for history-open
    for (const f of FLOWS) {
      const t0 = Date.now();
      page.parityErrors.length = 0; page.parityPageErrors = 0;   // per flow (open-pages revisits every captured page)
      try { await f.run({ page, t: ui.t, seed: ui.seed, state }); snap.flows.push({ name: f.name, ok: true, ms: Date.now() - t0 }); }
      catch (e) {
        const file = join(out, `fail-${f.name}.png`);
        const shot = await page.screenshot({ path: file }).then(() => file, () => null);
        snap.flows.push({ name: f.name, ok: false, ms: Date.now() - t0, ...flowError(e, page), shot });   // no free text (R-sec-4)
      }
      log(`flow ${flowLine(snap.flows.at(-1))}`);
    }
  } finally { await browser?.close(); await ui?.t.stop(); lock?.release(); }
  writeFileSync(join(out, 'snapshot.json'), JSON.stringify(snap, null, 2));
  return snap;
}

/** Page-load timings, interleaved: both targets up at once, A then B per sample. */
async function pageLoads(A, B, samples, log) {
  let ta; let tb; let browser;
  try {
    ta = await startTarget(A); tb = await startTarget(B);
    browser = await openBrowser();
    const pa = await newPage(browser, ta); const pb = await newPage(browser, tb);
    const res = { a: {}, b: {} };
    for (const [name, hash] of Object.entries(PAGE_LOADS)) {
      const r = await measurePageLoad(pa, `http://localhost:${ta.port}/${hash}`, pb, `http://localhost:${tb.port}/${hash}`, samples);
      res.a[name] = r.a; res.b[name] = r.b;
      log(`page load ${name}: A ${r.a.join(', ')} ms; B ${r.b.join(', ')} ms`);
    }
    return res;
  } finally { await browser?.close(); await ta?.stop(); await tb?.stop(); }
}

export function compareDirs(dirA, dirB, out, { gateTimings = true, log = () => {} } = {}) {
  const a = JSON.parse(readFileSync(join(dirA, 'snapshot.json'), 'utf8'));
  const b = JSON.parse(readFileSync(join(dirB, 'snapshot.json'), 'utf8'));
  // shots live in DIR/shots: resolve them there, so a copied or downloaded snapshot reads its own PNGs
  const shotOf = (snap, dir, { page, theme }) => {
    const s = snap.shots.find((x) => x.page === page && x.theme === theme);
    const file = s && join(dir, 'shots', basename(s.file));
    return file && existsSync(file) ? file : null;
  };
  const keys = [...a.shots, ...b.shots].filter((s, i, all) => all.findIndex((x) => x.page === s.page && x.theme === s.theme) === i);
  const visual = keys.map(({ page, theme }) => {
    const fa = shotOf(a, dirA, { page, theme }); const fb = shotOf(b, dirB, { page, theme });
    if (!fa || !fb) return { page, theme, pixels: null, note: fa ? 'missing in B' : 'missing in A' };
    const d = diffPng(readFileSync(fa), readFileSync(fb));
    const row = { page, theme, pixels: d.pixels, ...(d.note ? { note: d.note } : {}) };
    if (d.pixels && !d.sizeMismatch) { row.diff = join(out, `${page}-${theme}.diff.png`); writeDiffPng(row.diff, d); }
    return row;
  });
  for (const v of visual) log(`visual ${v.page}/${v.theme}: ${v.note ?? `${v.pixels} px`}${v.diff ? ` (diff: ${v.diff})` : ''}`);
  const r = compareSnapshots(a, b, { visual, gateTimings });
  log(timingLine('boot', r.timings.boot));
  for (const [p, x] of Object.entries(r.timings.pages)) log(timingLine(p, x));
  writeFileSync(join(out, 'report.json'), JSON.stringify(r, null, 2));
  writeFileSync(join(out, 'report.md'), renderReport(r));
  return r;
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  let o; try { o = parseArgs(argv); } catch (e) { log(e.message); return 2; }
  try {
    mkdirSync(o.out, { recursive: true });
    if (o.cmd === 'snapshot') { await snapshot(resolveSpec(o.target), o.out, { log }); return 0; }
    if (o.cmd === 'crawl') {
      const spec = (x) => ({ ...resolveSpec(x), label: x });
      const r = await crawl({ a: spec(o.a), bs: o.bs.map(spec), out: resolve(o.out), workers: o.workers, screens: o.screens, control: o.control, keep: o.keep, log });
      log(`crawl: ${crawlSummary(r)} — ${r.pass ? 'PASS' : 'FAIL'} (${join(resolve(o.out), 'report.md')})`);
      return r.pass ? 0 : 1;
    }
    if (o.cmd === 'run') {
      const A = resolveSpec(o.a); const B = resolveSpec(o.b);
      const samples = o.quick ? 1 : RUNS;
      const boot = await measureBoot(A, B, samples, log);
      const loads = await pageLoads(A, B, samples, log);
      const sa = await snapshot(A, join(o.out, 'a'), { bootMs: boot.a, samples, log, side: 'A' });
      const sb = await snapshot(B, join(o.out, 'b'), { bootMs: boot.b, samples, log, side: 'B' });
      sa.timings.pageLoadMs = loads.a; sb.timings.pageLoadMs = loads.b;
      writeFileSync(join(o.out, 'a', 'snapshot.json'), JSON.stringify(sa, null, 2));
      writeFileSync(join(o.out, 'b', 'snapshot.json'), JSON.stringify(sb, null, 2));
    }
    const r = compareDirs(o.cmd === 'run' ? join(o.out, 'a') : o.a, o.cmd === 'run' ? join(o.out, 'b') : o.b, o.out,
      { gateTimings: o.gateTimings, log });
    log(`parity: ${summaryLine(r)} (${join(o.out, 'report.md')})`);
    return r.pass ? 0 : 1;
  } catch (e) { log(`FAIL (fatal) ${e.message}`); return 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
