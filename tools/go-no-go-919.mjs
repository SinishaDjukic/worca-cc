#!/usr/bin/env node
// tools/go-no-go-919.mjs — #919: the go/no-go, computed from the proofs (T1 verify, T2 real e2e, T3 readiness, the stub
// smoke) and three local checks; unclear is fail. Writes OUT/919-go-no-go.md and .json. Never posts, never pushes.
//   npm run go-no-go:919 -- --verify DIR --readiness DIR --t2 DIR --stub-smoke FILE [--since-crawl FILE] --out DIR
//     [--pending REASON] (why an input is still missing; joins every missing gate's evidence) [--note ID=TEXT ...] (joins verify row ID)
// While verify-919.json is absent, DIR/verify-919.md (the partial table) still gives its rows and row b's line count.
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './readiness/proc.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FROZEN_DEV = 'bf92e157937860f00dcc42ccdb5cd5f1be69db45';
export const SIZE_BASE = 10085;
const EMFILE = /EMFILE|ENFILE|too many open files|posix_openpt|forkpty/g;
const T2_FLOWS = ['pages', 'chat', 'run', 'history', 'setting', 'labs'];
const VERIFY_ROWS = 'abcdefghijkl'.split('');
const withPending = (evidence, pending) => (!pending ? evidence : evidence === '—' ? `pending: ${pending}` : `${evidence}; pending: ${pending}`);
const missing = (gate, what, evidence = '—', pending = null) => ({ gate, ok: false, number: `missing: ${what}`, evidence: withPending(evidence, pending) });

// The verify table verify:919 writes as it goes: `| a. fetch | pass | number | evidence |`, one line per finished row.
export function parseVerifyMd(md) {
  const dev = /origin\/dev ([0-9a-f]{40})/.exec(md)?.[1] ?? null;
  const rows = [...md.matchAll(/^\| ([a-l])\. (.+?) \| (pass|FAIL) \| (.*) \| ([^|]+) \|$/gm)]
    .map(([, id, check, res, number, evidence]) => ({ id, check, ok: res === 'pass', number, evidence }));
  return { dev, rows };
}

export function gates({ verify, verifyPartial = null, crawl, crawlLog, stubSmoke, readiness, t2, tests, raises, ceiling, isAncestor, sinceCrawl = null, pending = null, notes = {} }) {
  const rows = [];
  const miss = (gate, what, evidence) => missing(gate, what, evidence, pending);
  const partial = !verify && verifyPartial?.rows.length ? verifyPartial : null;
  const vRows = verify?.rows ?? partial?.rows ?? [];
  const noted = (id, ev) => (notes[id] ? `${ev}; ${notes[id]}` : ev);
  // stub
  if (!crawl || !stubSmoke || crawlLog == null) rows.push(miss('stub', !crawl ? 'crawl report' : !stubSmoke ? 'stub smoke report' : 'crawl log'));
  else if (!crawl.externalApps) rows.push(miss('stub', 'externalApps in the crawl report (crawled without the stub?)', 'verify/crawl/report.json'));
  else {
    const real = crawl.externalApps.canary?.length ?? NaN; const noise = (crawlLog.match(EMFILE) ?? []).length;
    const smoke = stubSmoke.externalApps ?? { stubbed: 0, canary: ['no externalApps'] };
    rows.push({ gate: 'stub', ok: tests.stub === 0 && real === 0 && smoke.canary.length === 0 && smoke.stubbed > 0 && crawl.externalApps.stubbed > 0 && noise === 0,
      number: `${crawl.externalApps.stubbed ?? '?'} stubbed in the crawl, ${smoke.stubbed} in the smoke, ${real + smoke.canary.length} real; ${noise} EMFILE/ENFILE/pty lines; test ${tests.stub === 0 ? 'pass' : 'FAIL'}`,
      evidence: 'test/parity-stub-apps.test.mjs; stub-smoke-report.json; verify/crawl/report.md' });
  }
  // verify rows
  if (!verify) {
    for (const r of partial?.rows ?? []) rows.push({ gate: `verify-${r.id}`, ok: r.ok, number: `${r.check}: ${r.number} (partial T1)`, evidence: noted(r.id, `verify/${r.evidence}`) });
    rows.push(miss('verify', `verify-919.json${partial ? ` (partial table: rows ${partial.rows.map((r) => r.id).join(', ')})` : ''}`));
  } else {
    for (const r of verify.rows ?? []) rows.push({ gate: `verify-${r.id}`, ok: r.ok === true, number: `${r.check}: ${r.number}${r.carried ? ' (earlier run)' : ''}`, evidence: noted(r.id, `verify/${r.evidence}`) });
    const absent = VERIFY_ROWS.filter((id) => !(verify.rows ?? []).some((r) => r.id === id));
    rows.push({ gate: 'verify-rows', ok: !absent.length, number: absent.length ? `missing rows: ${absent.join(', ')}` : `all ${VERIFY_ROWS.length} rows a–l`, evidence: 'verify/verify-919.json' });
  }
  const vDev = verify ? verify.dev : partial?.dev;
  if ((verify || partial) && vDev !== FROZEN_DEV) rows.push({ gate: 'verify-dev', ok: false, number: `origin/dev ${vDev} is not the frozen ${FROZEN_DEV.slice(0, 9)}`, evidence: 'verify/verify-919.md' });
  // crawl coverage and masks
  const routes = crawl?.coverage?.routes;
  if (!Array.isArray(routes?.unvisited) || !Array.isArray(routes?.unfillable) || !crawl?.coverage?.elements || !Array.isArray(crawl?.masks)) rows.push(miss('crawl-coverage', 'crawl report (coverage)'), miss('masks', 'crawl report (masks)'));
  else {
    const c = crawl.coverage; const e = c.elements;
    rows.push({ gate: 'crawl-coverage', ok: !c.routes.unvisited.length && !c.routes.unfillable.length && e.exercised > 0,
      number: `${c.screens} screens; routes ${c.routes.visited}/${c.routes.registered}; elements ${e.found} found, ${e.exercised} exercised, ${e.skipped} skipped (${Object.entries(e.byReason ?? {}).map(([k, n]) => `${k}: ${n}`).join(', ')})`,
      evidence: 'verify/crawl/report.md' });
    const by = {}; for (const m of crawl.masks) by[m.why ?? 'unexplained'] = (by[m.why ?? 'unexplained'] ?? 0) + 1;
    const unexplained = by.unexplained ?? 0;
    rows.push({ gate: 'masks', ok: unexplained === 0 && tests.visualMasksDoc === 0,
      number: `${crawl.masks.length} crawl masks (${Object.entries(by).map(([k, n]) => `${k}: ${n}`).join(', ')}); ${unexplained} unexplained; visual masks ${tests.visualMasksDoc === 0 ? 'documented' : 'NOT documented'}`,
      evidence: 'verify/crawl/report.md; docs/parity-harness.md (Visual masks)' });
  }
  // T2
  if (!t2) rows.push(miss('t2', 'T2 report'));
  else for (const f of T2_FLOWS) {
    const x = t2.flows?.find((y) => y.id === f);
    rows.push(x ? { gate: `t2-${f}`, ok: x.ok === true, number: x.detail, evidence: x.evidence ?? 't2/report.md' } : miss(`t2-${f}`, `flow ${f}`, 't2/report.md'));
  }
  // T3 readiness
  if (!readiness) rows.push(miss('readiness', 'T3 report.json'));
  else if (!Array.isArray(readiness.checks)) rows.push(miss('readiness', 'checks in the T3 report.json', 't3/report.json'));
  else {
    for (const c of readiness.checks) rows.push({ gate: `readiness-${c.id}`, ok: c.status === 'pass', number: c.detail, evidence: 't3/report.md' });
    if (readiness.checks.length !== 10) rows.push({ gate: 'readiness-count', ok: false, number: `${readiness.checks.length} rows, expected 10`, evidence: 't3/report.md' });
    const p = readiness.checks.find((c) => c.id === 'parity');
    const reused = /\(verify:919 row h, same trees\)/.test(p?.detail ?? '');
    const since = sinceCrawl?.length ? `; T3 ran on the crawled snapshot, ${sinceCrawl.length} file(s) changed since (t3-since-crawl.txt)` : '';
    rows.push({ gate: 'readiness-reuse', ok: reused,
      number: !p ? 'no parity row' : reused ? `parity row reuses verify row h (no second crawl)${since}` : 'parity row did NOT reuse verify row h (a second crawl ran)',
      evidence: 't3/report.md; t3-since-crawl.txt' });
  }
  // firefox-e2e on Ship
  const ci = verify?.notLocal?.some((x) => x.ci === 'firefox-e2e') ?? false;
  rows.push({ gate: 'firefox-e2e-on-ship', ok: tests.firefoxWorkflow === 0 && ci,
    number: `job firefox-e2e on every PR into dev and push to dev (test/extension-packaging.test.mjs ${tests.firefoxWorkflow === 0 ? 'pass' : 'FAIL'}); verify lists it as CI: ${verify ? ci : 'missing verify-919.json'}`,
    evidence: verify ? '.github/workflows/firefox-e2e.yml' : withPending('.github/workflows/firefox-e2e.yml', pending) });
  // size cap (the residual ui/server.mjs after the split; D17)
  const lines = Number(/(\d+) lines/.exec(vRows.find((r) => r.id === 'b')?.number ?? '')?.[1]);
  if (!Number.isInteger(lines)) rows.push(miss('size-cap', 'row b line count'));
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
  const bad = rows.filter((r) => !r.ok);
  const verdict = bad.length ? `NO-GO — ${bad.length} of ${rows.length} gates fail: ${bad.map((r) => r.gate).join(', ')}` : `GO — all ${rows.length} gates pass`;
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const md = `# ${verdict}\n\n| Gate | Result | Number | Evidence |\n|---|---|---|---|\n${rows.map((r) => `| ${cell(r.gate)} | ${r.ok ? 'pass' : 'FAIL'} | ${cell(r.number)} | ${cell(r.evidence)} |`).join('\n')}\n`;
  return { verdict, md, json: { verdict: bad.length ? 'NO-GO' : 'GO', line: verdict, gates: rows } };
}

const readJson = (f) => (f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const readText = (f) => (f && existsSync(f) ? readFileSync(f, 'utf8') : null);

export async function main(argv = process.argv.slice(2), { log = console.log, run: r = run } = {}) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const out = arg('--out');
  if (!out) { log('usage: npm run go-no-go:919 -- --verify DIR --readiness DIR --t2 DIR --stub-smoke FILE [--since-crawl FILE] [--pending REASON] [--note ID=TEXT ...] --out DIR'); return 2; }
  const v = arg('--verify'); const t3 = arg('--readiness'); const t2 = arg('--t2');
  const since = arg('--since-crawl');
  const notes = Object.fromEntries(argv.flatMap((x, i) => (x === '--note' && /^[a-l]=/.test(argv[i + 1] ?? '') ? [[argv[i + 1][0], argv[i + 1].slice(2)]] : [])));
  const partialMd = readText(v && join(v, 'verify-919.md'));
  const test = (file) => r(process.execPath, ['tools/test.mjs', file], { cwd: ROOT }).code;
  const raises = (readJson(join(ROOT, 'tools/split-by-feature/size-caps-raises.json')) ?? []).filter((x) => x.file === 'ui/server.mjs');
  const rows = gates({
    verify: readJson(v && join(v, 'verify-919.json')), verifyPartial: partialMd && parseVerifyMd(partialMd), pending: arg('--pending') ?? null, notes, crawl: readJson(v && join(v, 'crawl', 'report.json')), crawlLog: readText(v && join(v, 'evidence', 'h-crawl.log')),
    stubSmoke: readJson(arg('--stub-smoke')), readiness: readJson(t3 && join(t3, 'report.json')), t2: readJson(t2 && join(t2, 'report.json')),
    tests: { stub: test('test/parity-stub-apps.test.mjs'), firefoxWorkflow: test('test/extension-packaging.test.mjs'), visualMasksDoc: test('test/parity-visual.test.mjs') },
    raises, ceiling: (readJson(join(ROOT, 'tools/split-by-feature/size-caps.json')) ?? {})['ui/server.mjs'] ?? null,
    isAncestor: (c, d) => r('git', ['merge-base', '--is-ancestor', c, d], { cwd: ROOT }).code === 0,
    sinceCrawl: since ? (readText(since) ?? '').split('\n').map((x) => x.trim()).filter(Boolean) : null,
  });
  const { verdict, md, json } = renderGoNoGo(rows);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, '919-go-no-go.md'), md);
  writeFileSync(join(out, '919-go-no-go.json'), `${JSON.stringify(json, null, 2)}\n`);
  log(`go-no-go:919: ${verdict} (${join(resolve(out), '919-go-no-go.md')})`);
  return json.verdict === 'GO' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
