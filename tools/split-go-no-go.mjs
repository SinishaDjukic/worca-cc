#!/usr/bin/env node
// tools/split-go-no-go.mjs — #919: the go/no-go, computed from the proofs (verify, T2 real e2e, T3 readiness, the stub
// smoke) and three local checks; unclear is fail. Writes OUT/split-go-no-go.md and .json. Never posts, never pushes.
//   npm run split:go-no-go -- --verify DIR [--verify-earlier DIR] --readiness DIR --t2 DIR --stub-smoke FILE [--crawl DIR]
//     [--masks-crawl DIR] [--reuse FILE] [--renamed FILE] [--row e|f|g=DIR ...] [--waive GATE=OWNER:REASON ...] --out DIR
// --renamed is tools/parity/reuse.mjs run on the earlier split and the renamed one: when it holds, rows i–l that ran on the
// earlier split stay valid (the behaviour is byte-identical) and say so; when it does not, they fail.
// Verify rows a–l come from, in this order: a --row replacement, this round's split-verify.json (a fresh partial run too),
// T3's row for b, c and d (the renamed split), and the earlier run's split-verify.md, carried only under the crawl reuse rule.
// A --waive turns a failing gate into WAIVED; its number keeps the computed result after "was:".
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, cpSync } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './readiness/proc.mjs';
import { parityGaps } from './split-verify.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FROZEN_DEV = 'bf92e157937860f00dcc42ccdb5cd5f1be69db45';
export const SIZE_BASE = 10085;
const EMFILE = /EMFILE|ENFILE|too many open files|posix_openpt|forkpty/g;
const T2_FLOWS = ['pages', 'chat', 'run', 'history', 'setting', 'labs'];
const VERIFY_ROWS = 'abcdefghijkl'.split('');
const RENAME_KEEPS = new Set(['i', 'j', 'k', 'l']);   // the long rows a rename does not rerun
const missing = (gate, what, evidence = '—') => ({ gate, ok: false, number: `missing: ${what}`, evidence });
/** Verify rows the renamed split changes: T3's row on the renamed split stands in (D4). */
export const T3_COVERS = Object.freeze({ b: 'split-check', c: 'dry-run-repeatable', d: 'suite-migrated' });
const statusOf = (r) => r.status ?? (r.ok ? 'pass' : 'fail');

/** `--waive GATE=OWNER:REASON`, repeatable → { gate: { owner, reason } }. */
export function parseWaivers(argv) {
  const out = {};
  argv.forEach((x, i) => {
    if (x !== '--waive') return;
    const m = /^([a-z0-9-]+)=([^:]+):(.+)$/s.exec(argv[i + 1] ?? '');
    if (!m) throw new Error(`--waive needs GATE=OWNER:REASON, got "${argv[i + 1] ?? ''}"`);
    out[m[1]] = { owner: m[2].trim(), reason: m[3].trim() };
  });
  return out;
}

/** A waiver turns a failing gate into WAIVED; a passing or already-waived gate keeps its status. An unknown gate throws. */
export function applyWaivers(rows, waivers) {
  const known = new Set(rows.map((r) => r.gate));
  const unknown = Object.keys(waivers).filter((g) => !known.has(g));
  if (unknown.length) throw new Error(`--waive: no gate ${unknown.join(', ')} (gates: ${[...known].join(', ')})`);
  return rows.map((r) => {
    const w = waivers[r.gate];
    if (!w || statusOf(r) !== 'fail') return { ...r, status: statusOf(r) };
    return { ...r, status: 'waived', ok: true, waived: w,
      number: `WAIVED by ${w.owner}: ${w.reason} (was: ${String(r.number).replace(/^missing: /, 'not produced: ')})` };
  });
}

// The verify table split:verify writes as it goes: `| a. fetch | pass | number | evidence |`, one line per finished row.
export function parseVerifyMd(md) {
  const dev = /origin\/dev ([0-9a-f]{40})/.exec(md)?.[1] ?? null;
  const rows = [...md.matchAll(/^\| ([a-l])\. (.+?) \| (pass|FAIL) \| (.*) \| ([^|]+) \|$/gm)]
    .map(([, id, check, res, number, evidence]) => ({ id, check, ok: res === 'pass', number, evidence }));
  const notLocal = [...md.matchAll(/^Not run locally \(not a pass\):.*CI job ([a-z0-9-]+)/gm)].map(([, ci]) => ({ ci }));
  return { dev, rows, ...(notLocal.length ? { notLocal } : {}) };
}

export function gates({ verify, verifyEarlier = null, crawl, masksCrawl = null, crawlLog, stubSmoke, readiness, t2, tests, raises, ceiling,
  isAncestor, reuse = null, renamed = null, rowOverrides = {}, labels = { verify: 'verify', verifyEarlier: 't1', readiness: 'verify/readiness', crawl: 'verify/crawl', masksCrawl: 'masks-crawl' } }, waivers = {}) {
  const rows = [];
  // row h waived (on the command line or in this round's split-verify.json): there is no crawl to read
  const hWaived = !!waivers['verify-h'] || !!verify?.rows?.some((r) => r.id === 'h' && r.waived);
  // stub
  if (hWaived && stubSmoke) {   // with row h waived the smoke and the stub test decide
    const smoke = stubSmoke.externalApps ?? { stubbed: 0, canary: ['no externalApps'] };
    rows.push({ gate: 'stub', ok: tests.stub === 0 && smoke.canary.length === 0 && smoke.stubbed > 0,
      number: `crawl part: row h waived; ${smoke.stubbed} stubbed in the smoke, ${smoke.canary.length} real; test ${tests.stub === 0 ? 'pass' : 'FAIL'}`,
      evidence: 'test/parity-stub-apps.test.mjs; stub-smoke-report.json' });
  } else if (!crawl || !stubSmoke || crawlLog == null) rows.push(missing('stub', !crawl ? 'crawl report' : !stubSmoke ? 'stub smoke report' : 'crawl log'));
  else if (!crawl.externalApps) rows.push(missing('stub', 'externalApps in the crawl report (crawled without the stub?)', `${labels.crawl}/report.json`));
  else {
    const real = crawl.externalApps.canary?.length ?? NaN; const noise = (crawlLog.match(EMFILE) ?? []).length;
    const smoke = stubSmoke.externalApps ?? { stubbed: 0, canary: ['no externalApps'] };
    rows.push({ gate: 'stub', ok: tests.stub === 0 && real === 0 && smoke.canary.length === 0 && smoke.stubbed > 0 && crawl.externalApps.stubbed > 0 && noise === 0,
      number: `${crawl.externalApps.stubbed ?? '?'} stubbed in the crawl, ${smoke.stubbed} in the smoke, ${real + smoke.canary.length} real; ${noise} EMFILE/ENFILE/pty lines; test ${tests.stub === 0 ? 'pass' : 'FAIL'}`,
      evidence: `test/parity-stub-apps.test.mjs; stub-smoke-report.json; ${labels.crawl}/report.md` });
  }
  // verify rows a–l (D4): --row replacement > this round's run > T3 coverage > T1 carried under the reuse rule
  if (!verify && !verifyEarlier) rows.push(missing('verify-rows', 'split-verify.json'));
  else {
    const t3 = readiness?.checks ?? []; const from = {}; let carried = false;
    for (const id of VERIFY_ROWS) {
      const v = verify?.rows?.find((r) => r.id === id && !r.notRun);
      const t1 = verifyEarlier?.rows?.find((r) => r.id === id);
      const c = T3_COVERS[id] ? t3.find((x) => x.id === T3_COVERS[id]) : null;
      const o = rowOverrides[id];
      const check = v?.check ?? t1?.check ?? id; const gate = `verify-${id}`;
      if (o) { rows.push({ gate, ok: o.ok, number: `${check}: ${o.number} (${o.from})`, evidence: o.evidence }); from[id] = 'replaced'; }
      else if (v) {
        rows.push({ gate, ok: v.ok === true, ...(v.waived ? { status: 'waived', waived: v.waived } : {}),
          number: `${check}: ${v.number} (${v.carried ? 'earlier run' : 'this round'})`, evidence: `${labels.verify}/${v.evidence}` });
        from[id] = 'this round';
      } else if (c) {
        rows.push({ gate, ok: c.status === 'pass', number: `${check}: covered by readiness-${c.id} (T3, renamed split): ${c.detail}`, evidence: `${labels.readiness}/report.md` });
        from[id] = 'T3';
      } else if (t1) {
        carried = true;
        rows.push({ gate, ok: t1.ok && reuse?.valid === true,
          number: `${check}: ${t1.number} (carried from T1 under the reuse rule${reuse?.valid === true ? '' : '; reuse rule not shown'})`, evidence: `${labels.verifyEarlier}/${t1.evidence}` });
        from[id] = 'T1';
      } else rows.push(missing(gate, `row ${id}`));
      const last = rows.at(-1);
      if (renamed && RENAME_KEEPS.has(id) && last.gate === gate && !/^missing: /.test(last.number)) {
        last.number += renamed.valid === true ? '; stays valid after the rename: behaviour byte-identical (gate rename)' : '; NOT valid after the rename (gate rename)';
        if (renamed.valid !== true) last.ok = false;
      }
    }
    const n = Object.keys(from).length;
    const list = (src) => VERIFY_ROWS.filter((id) => from[id] === src).join(', ') || '—';
    rows.push({ gate: 'verify-rows', ok: n === VERIFY_ROWS.length,
      number: `${n} of ${VERIFY_ROWS.length} rows accounted: this round ${list('this round')}; T3 ${list('T3')}; replaced ${list('replaced')}; T1 ${list('T1')}`,
      evidence: `${labels.verify}/split-verify.json` });
    if (carried) rows.push(reuse ? { gate: 'reuse-rule', ok: reuse.valid === true,
      number: reuse.valid ? `dev ${String(reuse.dev).slice(0, 9)} unchanged; served CSS, index.html and route table identical on ${reuse.trees.map((t) => t.label).join(', ')}` : reuse.reasons.join('; '),
      evidence: 'reuse.json' } : missing('reuse-rule', 'reuse.json (carried T1 rows need the crawl reuse rule)'));
  }
  if (renamed) rows.push({ gate: 'rename', ok: renamed.valid === true, evidence: 'renamed.json',
    number: renamed.valid === true ? `dev ${String(renamed.dev).slice(0, 9)} unchanged; served CSS, index.html and route table identical on ${renamed.trees.map((t) => t.label).join(', ')}` : renamed.reasons.join('; ') });
  const vDev = verify?.dev ?? verifyEarlier?.dev;
  if ((verify || verifyEarlier) && vDev !== FROZEN_DEV) rows.push({ gate: 'verify-dev', ok: false, number: `origin/dev ${vDev} is not the frozen ${FROZEN_DEV.slice(0, 9)}`, evidence: `${labels.verify}/split-verify.md` });
  // crawl coverage: a full crawl is the only evidence; a Chat-only crawl never reads as coverage
  const routes = crawl?.coverage?.routes;
  if (!crawl) rows.push(missing('crawl-coverage', hWaived ? 'full crawl report (row h waived)' : 'crawl report (coverage)'));
  else if (!Array.isArray(routes?.unvisited) || !Array.isArray(routes?.unfillable) || !crawl.coverage?.elements) rows.push(missing('crawl-coverage', 'crawl report (coverage)'));
  else {
    const c = crawl.coverage; const e = c.elements;
    rows.push({ gate: 'crawl-coverage', ok: !c.routes.unvisited.length && !c.routes.unfillable.length && e.exercised > 0,
      number: `${c.screens} screens; routes ${c.routes.visited}/${c.routes.registered}; elements ${e.found} found, ${e.exercised} exercised, ${e.skipped} skipped (${Object.entries(e.byReason ?? {}).map(([k, n]) => `${k}: ${n}`).join(', ')})`,
      evidence: `${labels.crawl}/report.md` });
  }
  // masks: --masks-crawl when given, else the full crawl
  const mc = masksCrawl ?? crawl;
  if (!Array.isArray(mc?.masks)) rows.push(missing('masks', 'crawl report (masks)'));
  else {
    const by = {}; for (const m of mc.masks) by[m.why ?? 'unexplained'] = (by[m.why ?? 'unexplained'] ?? 0) + 1;
    const unexplained = by.unexplained ?? 0;
    rows.push({ gate: 'masks', ok: unexplained === 0 && tests.visualMasksDoc === 0,
      number: `${mc.masks.length} crawl masks (${Object.entries(by).map(([k, n]) => `${k}: ${n}`).join(', ')}); ${unexplained} unexplained; visual masks ${tests.visualMasksDoc === 0 ? 'documented' : 'NOT documented'}`,
      evidence: `${masksCrawl ? labels.masksCrawl : labels.crawl}/report.md; docs/parity-harness.md (Visual masks)` });
  }
  // T2
  if (!t2) rows.push(missing('t2', 'T2 report'));
  else for (const f of T2_FLOWS) {
    const x = t2.flows?.find((y) => y.id === f);
    rows.push(x ? { gate: `t2-${f}`, ok: x.ok === true, number: x.detail, evidence: x.evidence ?? 't2/report.md' } : missing(`t2-${f}`, `flow ${f}`, 't2/report.md'));
  }
  // T3 readiness
  if (!readiness) rows.push(missing('readiness', 'T3 report.json'));
  else if (!Array.isArray(readiness.checks)) rows.push(missing('readiness', 'checks in the T3 report.json', `${labels.readiness}/report.json`));
  else {
    for (const c of readiness.checks) rows.push({ gate: `readiness-${c.id}`, ok: c.status !== 'fail', status: c.status === 'waived' ? 'waived' : c.status === 'pass' ? 'pass' : 'fail',
      ...(c.waived ? { waived: c.waived } : {}), number: c.detail, evidence: `${labels.readiness}/report.md` });
    if (readiness.checks.length !== 10) rows.push({ gate: 'readiness-count', ok: false, number: `${readiness.checks.length} rows, expected 10`, evidence: `${labels.readiness}/report.md` });
    const p = readiness.checks.find((c) => c.id === 'parity');
    const w = waivers['verify-h'] ?? p?.waived;
    if (p?.status === 'waived' && !w?.owner) {   // a waived parity row with no owner anywhere: a failing gate, never a crash
      rows.push({ gate: 'readiness-reuse', ok: false, number: 'parity row waived without an owner and reason (no --waive verify-h)', evidence: `${labels.readiness}/report.md` });
    } else if (p?.status === 'waived') {
      rows.push({ gate: 'readiness-reuse', ok: true, status: 'waived', waived: w, number: `no crawl ran (crawl waived); row h waiver: ${w.owner}: ${w.reason}`, evidence: `${labels.readiness}/report.md; ${labels.readiness}/evidence/crawl-waived.txt` });
    } else {
      const reused = /\(split:verify row h, (same trees|reuse rule)\)/.exec(p?.detail ?? '');
      rows.push({ gate: 'readiness-reuse', ok: !!reused, number: !p ? 'no parity row' : reused ? `parity row reuses verify row h (${reused[1]}; no second crawl)` : 'parity row did NOT reuse verify row h (a second crawl ran)', evidence: `${labels.readiness}/report.md` });
    }
  }
  // firefox-e2e on Ship
  const ci = (verify?.notLocal ?? verifyEarlier?.notLocal ?? []).some((x) => x.ci === 'firefox-e2e');
  rows.push({ gate: 'firefox-e2e-on-ship', ok: tests.firefoxWorkflow === 0 && ci,
    number: `job firefox-e2e on every PR into dev and push to dev (test/extension-packaging.test.mjs ${tests.firefoxWorkflow === 0 ? 'pass' : 'FAIL'}); verify lists it as CI: ${verify || verifyEarlier ? ci : 'missing split-verify.json'}`,
    evidence: '.github/workflows/firefox-e2e.yml' });
  // size cap (the residual ui/server.mjs after the split; D17): the renamed split's count first, else row b's line count
  const rowB = [verify, verifyEarlier].map((x) => x?.rows?.find((r) => r.id === 'b' && !r.notRun)).find((r) => /(\d+) lines/.test(r?.number ?? ''));
  const lines = Number(readiness?.risks?.serverLines ?? /(\d+) lines/.exec(rowB?.number ?? '')?.[1]);
  if (!Number.isInteger(lines)) rows.push(missing('size-cap', 'row b line count'));
  else {
    const over = raises.filter((r) => r.to > SIZE_BASE);
    const okRaises = lines <= SIZE_BASE || (raises.at(-1)?.to === ceiling && over.every((r) => r.commit && isAncestor(r.commit, FROZEN_DEV)));
    rows.push({ gate: 'size-cap', ok: lines <= ceiling && okRaises,
      number: `${lines} lines, ceiling ${ceiling}; ${lines > SIZE_BASE ? `raised by ${over.map((r) => r.commit ?? '(no commit)').join(', ')} (on bf92e1579)` : `within ${SIZE_BASE}`}; owner sign-off: checklist A3`,
      evidence: 'tools/split-by-feature/size-caps-raises.json; size-cap.log' });
  }
  return rows;
}

export function renderGoNoGo(rows) {
  const st = rows.map((r) => ({ ...r, status: statusOf(r) }));
  const bad = st.filter((r) => r.status === 'fail'); const waived = st.filter((r) => r.status === 'waived');
  const verdict = bad.length ? `NO-GO — ${bad.length} of ${st.length} gates fail: ${bad.map((r) => r.gate).join(', ')}`
    : waived.length ? `GO — ${st.length - waived.length} of ${st.length} gates pass, ${waived.length} waived` : `GO — all ${st.length} gates pass`;
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const res = (r) => (r.status === 'pass' ? 'pass' : r.status === 'waived' ? 'WAIVED' : 'FAIL');
  const waivedLine = waived.length ? `Waived gates: ${waived.map((r) => `${r.gate} (${r.waived.owner}: ${r.waived.reason})`).join('; ')}\n\n` : '';
  const md = `# ${verdict}\n\n${waivedLine}| Gate | Result | Number | Evidence |\n|---|---|---|---|\n${st.map((r) => `| ${cell(r.gate)} | ${res(r)} | ${cell(r.number)} | ${cell(r.evidence)} |`).join('\n')}\n`;
  return { verdict, md, json: { verdict: bad.length ? 'NO-GO' : 'GO', line: verdict, waived: waived.map(({ gate, waived: w }) => ({ gate, ...w })), gates: st } };
}

const readJson = (f) => (f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const readText = (f) => (f && existsSync(f) ? readFileSync(f, 'utf8') : null);

const USAGE = 'usage: npm run split:go-no-go -- --verify DIR [--verify-earlier DIR] --readiness DIR --t2 DIR --stub-smoke FILE [--crawl DIR]\n'
  + '  [--masks-crawl DIR] [--reuse FILE] [--renamed FILE] [--row e|f|g=DIR ...] [--waive GATE=OWNER:REASON ...] --out DIR';

export async function main(argv = process.argv.slice(2), { log = console.log, run: r = run } = {}) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const out = arg('--out');
  if (!out) { log(USAGE); return 2; }
  let waivers;
  try { waivers = parseWaivers(argv); } catch (e) { log(`${e.message}\n${USAGE}`); return 2; }
  const rowArgs = argv.flatMap((x, i) => (x === '--row' ? [argv[i + 1] ?? ''] : []));
  const badRow = rowArgs.find((x) => !/^[efg]=./.test(x));
  if (badRow !== undefined) { log(`--row needs e, f or g=DIR, got "${badRow}"\n${USAGE}`); return 2; }
  const v = arg('--verify'); const earlier = arg('--verify-earlier'); const t3 = arg('--readiness'); const t2 = arg('--t2');
  const verify = readJson(v && join(v, 'split-verify.json'));
  // a waived row h ran no crawl: a crawl left in VERIFY by an earlier run is never read
  const crawlDir = verify?.crawl === 'waived' && !arg('--crawl') ? null : arg('--crawl') ?? (v && join(v, 'crawl'));
  const masksDir = arg('--masks-crawl');
  mkdirSync(out, { recursive: true });
  const parent = dirname(resolve(out));
  const label = (dir, dflt) => (dir ? relative(parent, resolve(dir)) || '.' : dflt);
  const labels = { verify: label(v, 'verify'), verifyEarlier: label(earlier, 't1'), readiness: label(t3, 'verify/readiness'), crawl: label(crawlDir, 'verify/crawl'), masksCrawl: 'masks-crawl' };
  if (masksDir) {
    mkdirSync(join(out, 'masks-crawl'), { recursive: true });
    for (const f of ['report.md', 'report.json']) if (existsSync(join(masksDir, f))) cpSync(join(masksDir, f), join(out, 'masks-crawl', f));
  }
  const rowOverrides = {};
  for (const x of rowArgs) {
    const id = x[0]; const dir = resolve(x.slice(2)); const rep = readJson(join(dir, 'report.json'));
    cpSync(dir, join(out, `${id}-row`), { recursive: true });
    if (!rep) { rowOverrides[id] = { ok: false, number: 'no report.json', evidence: `${id}-row/`, from: basename(dir) }; continue; }
    const gaps = parityGaps(rep, { timing: id === 'f' });
    rowOverrides[id] = { ok: !gaps.length, from: basename(dir), evidence: `${id}-row/report.md`,
      number: `${rep.routeDiffs.length} route, ${rep.visualDiffs.length} visual, ${rep.failedFlows.length} flow diffs${gaps.length ? `; ${gaps.join('; ')}` : ''}` };
  }
  const earlierMd = readText(earlier && join(earlier, 'split-verify.md'));
  const test = (file) => r(process.execPath, ['tools/test.mjs', file], { cwd: ROOT }).code;
  const raises = (readJson(join(ROOT, 'tools/split-by-feature/size-caps-raises.json')) ?? []).filter((x) => x.file === 'ui/server.mjs');
  let rows;
  try {
    rows = applyWaivers(gates({
      verify, verifyEarlier: earlierMd && parseVerifyMd(earlierMd), crawl: readJson(crawlDir && join(crawlDir, 'report.json')), masksCrawl: readJson(masksDir && join(masksDir, 'report.json')),
      crawlLog: readText(v && join(v, 'evidence', 'h-crawl.log')),
      stubSmoke: readJson(arg('--stub-smoke')), readiness: readJson(t3 && join(t3, 'report.json')), t2: readJson(t2 && join(t2, 'report.json')),
      tests: { stub: test('test/parity-stub-apps.test.mjs'), firefoxWorkflow: test('test/extension-packaging.test.mjs'), visualMasksDoc: test('test/parity-visual.test.mjs') },
      raises, ceiling: (readJson(join(ROOT, 'tools/split-by-feature/size-caps.json')) ?? {})['ui/server.mjs'] ?? null,
      isAncestor: (c, d) => r('git', ['merge-base', '--is-ancestor', c, d], { cwd: ROOT }).code === 0,
      reuse: readJson(arg('--reuse')), renamed: readJson(arg('--renamed')), rowOverrides, labels,
    }, waivers), waivers);
  } catch (e) { if (/^--waive: /.test(e.message)) { log(`${e.message}\n${USAGE}`); return 2; } throw e; }
  const { verdict, md, json } = renderGoNoGo(rows);
  writeFileSync(join(out, 'split-go-no-go.md'), md);
  writeFileSync(join(out, 'split-go-no-go.json'), `${JSON.stringify(json, null, 2)}\n`);
  log(`split:go-no-go: ${verdict} (${join(resolve(out), 'split-go-no-go.md')})`);
  return json.verdict === 'GO' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
