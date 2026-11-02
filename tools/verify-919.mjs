#!/usr/bin/env node
// tools/verify-919.mjs — #919: THE check before Ship and on freeze day (docs/split-by-feature.md, top section).
// Runs rows a–l in order on this checkout's HEAD and its split; never stops early; prints one table
// (check · pass/fail · number · evidence file) and exits 0 only when every row passes. Never posts, never pushes.
//   Run: npm run verify:919 [-- --out DIR] [--keep] [--firefox-in-ci]      (many hours; OUT/verify-919.md grows row by row)
// --firefox-in-ci: e2e:firefox-smoke is left to the CI job firefox-e2e (headless Playwright Firefox hangs on macOS); rows
// i and k and the table's tail name it "not run locally", which is not a pass.
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, runLogged } from './readiness/proc.mjs';
import { cloneAt, npmCi, applySplit, commitMigration, rehearseRollback } from './readiness/trees.mjs';
import { e2eRow, CI_ONLY } from './readiness/e2e.mjs';
import { crawlSummary } from './parity/crawl-compare.mjs';
import { runFixture, catchUpAll, defaultDeps as catchUpDeps } from './catch-up-919.mjs';
import { parseFailures, unlistedFailures, registerEntryFor } from './flaky-register.mjs';
import { EXPECTED_SHOTS, FLOW_NAMES } from './parity/compare.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = [process.execPath, '--disable-warning=ExperimentalWarning'];
export const ROWS = [['a', 'fetch'], ['b', 'gate'], ['c', 'dry-run-repeatable'], ['d', 'suite-split'], ['e', 'parity-quick'],
  ['f', 'parity-full'], ['g', 'parity-package'], ['h', 'crawl'], ['i', 'e2e-split'], ['j', 'catch-up'], ['k', 'rollback'], ['l', 'readiness']];
const USAGE = 'usage: npm run verify:919 [-- --out DIR] [--keep] [--firefox-in-ci]';
const short = (s) => String(s ?? '').slice(0, 12);
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);

/** What makes a parity report incomplete even when it passed (D12). */
export function parityGaps(rep, { timing }) {
  const g = [];
  if (!rep.pass) g.push('parity FAIL');
  if (rep.visual?.length !== EXPECTED_SHOTS) g.push(`${rep.visual?.length ?? 0} shot pairs, expected ${EXPECTED_SHOTS}`);
  for (const side of ['a', 'b']) {
    const names = new Set((rep.flows ?? []).filter((f) => f.side === side).map((f) => f.name));
    if (!FLOW_NAMES.every((n) => names.has(n))) g.push(`${side}: not all ${FLOW_NAMES.length} flows`);
    if (!rep.routeCounts?.[side]?.probed) g.push(`${side}: no routes probed`);
  }
  if (rep.signedOutProblems?.length) g.push(`${rep.signedOutProblems.length} signed-out problems`);
  if (timing && !(rep.timingGated && rep.timings?.boot?.a != null && ['chat-home', 'runs'].every((p) => rep.timings.pages?.[p]?.a != null))) g.push('timings not gated');
  return g;
}

/** What makes a crawl report incomplete even when it says pass. */
export function crawlGaps(rep) {
  const g = [];
  if (!rep.pass) g.push('crawl FAIL');
  if (rep.control !== true) g.push('no control pass');
  if (rep.comparisons?.length !== 2) g.push(`${rep.comparisons?.length ?? 0} comparisons, expected 2 (split, package)`);
  if (rep.coverage?.routes?.unvisited?.length) g.push(`${rep.coverage.routes.unvisited.length} unvisited routes`);
  if (rep.coverage?.routes?.unfillable?.length) g.push(`${rep.coverage.routes.unfillable.length} unfillable routes`);
  return g;
}

export function renderTable(rows, ctx = {}) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const notLocal = ctx.notLocal ?? [];
  const was = { i: 'h', k: 'i' };   // the letters before this round (the user's direction names h and i)
  const tail = notLocal.length ? `\nNot run locally (not a pass): ${[...new Set(notLocal.map((x) => x.name))].map((n) => `${n} in rows ${notLocal.filter((x) => x.name === n).map((x) => `${x.row}${was[x.row] ? ` (was ${was[x.row]})` : ''}`).join(' and ')} → CI job ${notLocal.find((x) => x.name === n).ci} (.github/workflows/firefox-e2e.yml)`).join('; ')}\n` : '';
  return `# verify:919${ctx.dev ? ` · origin/dev ${ctx.dev}` : ''}${ctx.head ? ` · HEAD ${ctx.head}` : ''}\n\n`
    + '| Check | Result | Number | Evidence |\n|---|---|---|---|\n'
    + rows.map((r) => `| ${r.id}. ${r.check} | ${r.ok ? 'pass' : 'FAIL'} | ${cell(r.number)} | ${cell(r.evidence)} |`).join('\n') + '\n' + tail;
}

export async function runVerify({ root = ROOT, out, keep = false, firefoxInCi = false, log = console.log, deps = {} } = {}) {
  const d = { run, runLogged, cloneAt, npmCi, applySplit, commitMigration, rehearseRollback,
    buildExtension: (file) => runLogged(NODE[0], [NODE[1], 'tools/build-extension.mjs', '--pack'], file, { cwd: root }),
    catchUpFixture: (o) => runFixture({ ...o, d: catchUpDeps }), catchUpAll: (o) => catchUpAll({ ...o, d: catchUpDeps }),
    register: (dir) => JSON.parse(readFileSync(join(dir, 'test/flaky-register.json'), 'utf8')),
    scripts: (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts, ...deps };
  const E = (f) => join(out, 'evidence', f);
  mkdirSync(join(out, 'evidence'), { recursive: true });
  const git = (...a) => d.run('git', a, { cwd: root });
  const ctx = { head: git('rev-parse', 'HEAD').stdout.trim(), notLocal: [] };
  const e2eMemo = new Map();   // row k reuses row i's "before" run of the same-results suites
  const ciOnly = firefoxInCi ? CI_ONLY : {};
  const rows = [];
  const row = async (id, check, fn) => {
    log(`[${id}] ${check} …`);
    let r;
    try { r = await fn(); } catch (e) {
      appendFileSync(E(`${id}-${check}.log`), `${e?.stack ?? e}\n`);   // append: a-fetch.log / b-gate.log may already hold the child's log
      r = { ok: false, number: `error: ${String(e?.message ?? e).split('\n')[0]}`, evidence: `evidence/${id}-${check}.log` };
    }
    rows.push({ id, check, ok: r.ok === true, number: String(r.number ?? ''), evidence: r.evidence });
    writeFileSync(join(out, 'verify-919.md'), renderTable(rows, ctx));
    log(`[${id}] ${check}: ${r.ok ? 'pass' : 'FAIL'} · ${r.number} · ${r.evidence}`);
  };

  // shared checks (also used by row i)
  const suite = (dir, tag) => {
    const r = d.runLogged(NODE[0], ['tools/test.mjs'], E(`${tag}.log`), { cwd: dir });
    const register = d.register(dir);
    const failed = parseFailures(r.text); const unlisted = unlistedFailures(r.text, register);
    const known = failed.filter((f) => !unlisted.some((u) => u.file === f.file && u.test === f.test)).map((f) => ({ ...f, entry: registerEntryFor(f, register) }));
    for (const file of new Set(known.map((k) => k.file))) {
      const solo = d.runLogged(NODE[0], ['tools/test.mjs', file], E(`${tag}-solo-${file.replace(/\W+/g, '-')}.log`), { cwd: dir });
      for (const k of known.filter((x) => x.file === file)) Object.assign(k, { soloRerun: solo.code === 0 ? 'pass' : 'fail', soloLog: `evidence/${tag}-solo-${file.replace(/\W+/g, '-')}.log` });
    }
    writeFileSync(E(`${tag}-flaky.json`), JSON.stringify(known, null, 2));
    const files = new Set(known.map((k) => k.file)).size; const green = new Set(known.filter((k) => k.soloRerun === 'pass').map((k) => k.file)).size;
    const number = `fail ${failed.length}${known.length ? ` (${known.length} flaky; ${green}/${files} solo green)` : ''}${unlisted.length ? `; ${unlisted.length} NOT in the register: ${unlisted[0].file}` : ''}`;
    return { ok: unlisted.length === 0, number, evidence: `evidence/${tag}.log` };
  };
  const parity = (a, b, tag, { quick = false, timing = false } = {}) => {
    const o = join(out, tag);
    const r = d.runLogged(NODE[0], [NODE[1], 'tools/parity.mjs', 'run', '--a', a, '--b', b, '--out', o, ...(quick ? ['--quick'] : [])], E(`${tag}.log`), { cwd: root });
    const rep = readJson(join(o, 'report.json'));
    if (!rep) return { ok: false, number: `exit ${r.code}, no report`, evidence: `evidence/${tag}.log` };
    const gaps = parityGaps(rep, { timing });
    return { ok: r.code === 0 && !gaps.length, evidence: `${tag}/report.md`,
      number: `${rep.routeDiffs.length} route, ${rep.visualDiffs.length} visual, ${rep.failedFlows.length} flow diffs${gaps.length ? `; ${gaps.join('; ')}` : ''}` };
  };
  if (!existsSync(join(root, 'node_modules'))) d.npmCi(d.runLogged, root, E('setup.log'));

  await row('a', 'fetch', () => {
    const f = d.runLogged('git', ['fetch', '--no-tags', 'origin', 'dev'], E('a-fetch.log'), { cwd: root });
    ctx.dev = git('rev-parse', 'origin/dev').stdout.trim();
    const contains = git('merge-base', '--is-ancestor', ctx.dev, ctx.head).code === 0;
    const dirty = git('status', '--porcelain', '--untracked-files=no').stdout.trim();
    appendFileSync(E('a-fetch.log'), `origin/dev ${ctx.dev}\nHEAD ${ctx.head}\nHEAD contains origin/dev: ${contains}\ntracked changes: ${dirty || '(none)'}\n`);
    log(`origin/dev used: ${ctx.dev}`);
    return { ok: f.code === 0 && contains && !dirty, evidence: 'evidence/a-fetch.log',
      number: `origin/dev ${short(ctx.dev)}${contains ? '' : '; HEAD does not contain it'}${dirty ? '; tracked changes' : ''}` };
  });
  await row('b', 'gate', () => {
    const r = d.runLogged(NODE[0], ['tools/split-by-feature.mjs', '--check', '--stats'], E('b-gate.log'), { cwd: root });
    const line = r.text.split('\n').find((l) => /spike gate/.test(l)) ?? '';
    const m = /\((\d+)%\), ui\/server\.mjs after the split: (\d+) lines/.exec(line);
    return { ok: r.code === 0 && /spike gate passed/.test(line), number: m ? `${m[1]}% moved, ${m[2]} lines` : 'no gate line', evidence: 'evidence/b-gate.log' };
  });
  await row('c', 'dry-run-repeatable', () => {
    const runs = [1, 2].map((n) => {
      const j = E(`c-dry-run-${n}.json`);
      const r = d.runLogged(NODE[0], ['tools/split-by-feature.mjs', '--dry-run', '--tests', 'none', '--json', j], E(`c-dry-run-${n}.log`), { cwd: root });
      const rep = readJson(j) ?? {};
      return { ok: r.code === 0 && rep.ok === true, hash: rep.treeHash };
    });
    const same = !!runs[0].hash && runs[0].hash === runs[1].hash;
    return { ok: same && runs.every((x) => x.ok), evidence: 'evidence/c-dry-run-1.json',
      number: same ? `treeHash ${short(runs[0].hash)} ×2` : `${short(runs[0].hash)} ≠ ${short(runs[1].hash)}` };
  });

  // the split tree: a scratch clone of HEAD, npm ci, split, committed as the migration (D9; commitMigration stages, D16)
  const split = join(out, 'trees', 'split');
  try {
    d.cloneAt(d.run, root, ctx.head, split);
    d.npmCi(d.runLogged, split, E('split-tree.log'));
    await d.applySplit(d.run, split);
    ctx.migration = d.commitMigration(d.run, split);
  } catch (e) { ctx.splitError = String(e?.message ?? e); appendFileSync(E('split-tree.log'), `${e?.stack ?? e}\n`); }
  const needSplit = () => { if (!ctx.migration) throw new Error(`no split tree (${ctx.splitError ?? 'not built'}; evidence/split-tree.log)`); };

  await row('d', 'suite-split', () => { needSplit(); return suite(split, 'd-suite-split'); });
  await row('e', 'parity-quick', () => { needSplit(); return parity('tree:.', `tree:${split}`, 'parity-quick', { quick: true }); });
  await row('f', 'parity-full', () => { needSplit(); return parity('tree:.', `tree:${split}`, 'parity-full', { timing: true }); });
  // extension/dist is gitignored, so a build survives git clean and the rollback. GET /api/extension/install reports
  // it, so a build on one side of a tree parity is a route diff: g removes the build it made, i drops row h's e2e build.
  await row('g', 'parity-package', () => {
    const dist = join(root, 'extension', 'dist'); const had = existsSync(dist);
    try {
      const b = d.buildExtension(E('g-build-extension.log'));
      if (b.code !== 0) return { ok: false, number: 'build-extension --pack failed', evidence: 'evidence/g-build-extension.log' };
      return parity('tree:.', 'package:.', 'parity-package');
    } finally { if (!had) rmSync(dist, { recursive: true, force: true }); }
  });
  // h: the differential crawl, dev (this checkout) vs the split tree and vs the package. extension/dist is built for the run
  // (as g) and copied into the split tree so both trees match the package; both builds are removed afterwards.
  await row('h', 'crawl', () => {
    needSplit();
    const dist = join(root, 'extension', 'dist'); const had = existsSync(dist); const sdist = join(split, 'extension', 'dist');
    try {
      const b = d.buildExtension(E('h-build-extension.log'));
      if (b.code !== 0) return { ok: false, number: 'build-extension --pack failed', evidence: 'evidence/h-build-extension.log' };
      cpSync(dist, sdist, { recursive: true });
      const o = join(out, 'crawl');
      const r = d.runLogged(NODE[0], [NODE[1], 'tools/parity.mjs', 'crawl', '--a', 'tree:.', '--b', `tree:${split}`, '--b', 'package:.', '--out', o], E('h-crawl.log'), { cwd: root });
      const rep = readJson(join(o, 'report.json'));
      if (!rep) return { ok: false, number: `exit ${r.code}, no report`, evidence: 'evidence/h-crawl.log' };
      const gaps = crawlGaps(rep);
      return { ok: r.code === 0 && !gaps.length, evidence: 'crawl/report.md', number: `${crawlSummary(rep)}${gaps.length ? `; ${gaps.join('; ')}` : ''}` };
    } finally { rmSync(sdist, { recursive: true, force: true }); if (!had) rmSync(dist, { recursive: true, force: true }); }
  });
  // the "before" of the e2e judgement: a clean clone of HEAD, made once (row k still gets it when row i threw)
  let before = null;
  const beforeTree = () => {
    if (!before) { const dir = join(out, 'trees', 'before'); d.cloneAt(d.run, root, ctx.head, dir); d.npmCi(d.runLogged, dir, E('before-tree.log')); before = dir; }
    return before;
  };
  await row('i', 'e2e-split', () => {
    needSplit();
    const e = e2eRow(d, beforeTree(), split, 'i-e2e', E, e2eMemo, { ciOnly });
    writeFileSync(E('i-e2e.json'), JSON.stringify(e.list, null, 2));
    ctx.notLocal.push(...e.notLocal.map((x) => ({ row: 'i', ...x })));
    return { ok: e.ok, number: e.text, evidence: 'evidence/i-e2e.json' };
  });
  // j: the catch-up recipe on the fixture "old" PR and every open PR, with the split tree as the latest dev. root is the
  // clean checkout at ctx.head (= M^ in the rehearsal), so it is M^'s splitter. It runs before k, which reverts the split.
  await row('j', 'catch-up', async () => {
    needSplit();
    const o = join(out, 'catch-up');
    const cctx = { rehearsal: true, mParent: ctx.head, m: ctx.migration, mRepo: split, devRepo: split, devRef: ctx.migration, splitter: root, devTree: split };
    const fx = await d.catchUpFixture({ root, out: join(o, 'fixture'), ctx: cctx, log });
    const all = await d.catchUpAll({ root, out: o, ctx: cctx, log });
    const work = all.filter((x) => x.verdict === 'works').length;
    const forks = all.filter((x) => x.tests && !x.tests.ran).length;
    return { ok: fx.verdict === 'works', evidence: 'catch-up/report.md',
      number: `fixture ${fx.verdict}${fx.reasons.length ? ` (${fx.reasons[0]})` : ''}: ${fx.moved.map((m) => `${m.from} → ${m.to.join(', ')}`).join('; ')}; `
        + `open PRs: ${work} work, ${all.length - work} need a hand fix${forks ? `, ${forks} fork (split and apply only)` : ''}` };
  });
  await row('k', 'rollback', () => {
    needSplit();
    const r = d.rehearseRollback(d.run, split, ctx.head, ctx.migration);
    rmSync(join(split, 'extension', 'dist'), { recursive: true, force: true });
    writeFileSync(E('k-rollback-diff.log'), `left by the suite and parity, removed before the revert:\n${r.cleaned || '(nothing)'}\ngit revert ${ctx.migration} → ${r.reverted}\ngit diff --stat ${ctx.head} ${r.reverted}:\n${r.diff || '(empty)'}\ngit status --porcelain:\n${r.status || '(clean)'}\n`);
    const s = suite(split, 'k-suite-reverted'); const p = parity('tree:.', `tree:${split}`, 'parity-reverted', { timing: true });
    const e = e2eRow(d, beforeTree(), split, 'k-e2e', E, e2eMemo, { ciOnly });
    ctx.notLocal.push(...e.notLocal.map((x) => ({ row: 'k', ...x })));
    writeFileSync(E('k-rollback.json'), JSON.stringify({ revert: r, suite: s, parity: p, e2e: e.list }, null, 2));
    return { ok: r.ok && s.ok && p.ok && e.ok, evidence: 'evidence/k-rollback.json',
      number: `diff ${r.ok ? 'empty' : 'NOT empty'}; suite ${s.number}; parity ${p.ok ? 'pass' : `FAIL (${p.number})`}; e2e ${e.text}` };
  });
  // l: readiness, reusing h's crawl and j's catch-up dry run when their trees match its own
  await row('l', 'readiness', () => {
    const o = join(out, 'readiness');
    const args = [NODE[1], 'tools/readiness.mjs', 'run', '--out', o, ...(ctx.dev && ctx.head !== ctx.dev ? ['--dev-ref', ctx.head] : []),
      '--crawl-from', join(out, 'crawl'), '--catch-up-from', join(out, 'catch-up', 'all.json'), ...(firefoxInCi ? ['--firefox-in-ci'] : [])];
    const r = d.runLogged(NODE[0], args, E('l-readiness.log'), { cwd: root });
    const rep = readJson(join(o, 'report.json'));
    const both = !!rep && existsSync(join(o, 'report.md'));
    return { ok: r.code === 0 && both && rep.verdict?.value === 'go', evidence: both ? 'readiness/report.md' : 'evidence/l-readiness.log',
      number: rep ? `verdict ${rep.verdict?.value}${rep.verdict?.failing?.length ? ` (${rep.verdict.failing.join(', ')})` : ''}` : `exit ${r.code}, no report` };
  });

  const pass = rows.length === ROWS.length && rows.every((x) => x.ok);
  const ci = [...new Set(ctx.notLocal.map((x) => x.ci))];
  writeFileSync(join(out, 'verify-919.json'), JSON.stringify({ dev: ctx.dev, head: ctx.head, pass, notLocal: ctx.notLocal, rows }, null, 2));
  if (!keep) rmSync(join(out, 'trees'), { recursive: true, force: true });
  log(`\n${renderTable(rows, ctx)}\nverify:919 ${pass ? 'PASS' : 'FAIL'}${pass && ci.length ? `, except ${new Set(ctx.notLocal.map((x) => x.name)).size} suite left to CI (${ci.join(', ')})` : ''} (${join(out, 'verify-919.md')})`);
  return { out, rows, pass };
}

export async function main(argv = process.argv.slice(2), { log = console.log, verify = runVerify } = {}) {
  let out = null; let keep = false; let firefoxInCi = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out = resolve(argv[++i]);
    else if (argv[i] === '--keep') keep = true;
    else if (argv[i] === '--firefox-in-ci') firefoxInCi = true;
    else { log(`verify-919: unknown argument ${argv[i]}\n${USAGE}`); return 2; }
  }
  if (out && existsSync(out) && readdirSync(out).length) { log(`verify-919: ${out} is not empty`); return 3; }
  out ??= mkdtempSync(join(tmpdir(), 'worca-verify-919-'));
  return (await verify({ out, keep, firefoxInCi, log })).pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
