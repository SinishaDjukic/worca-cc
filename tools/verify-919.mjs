#!/usr/bin/env node
// tools/verify-919.mjs — #919: THE check before Ship and on freeze day (docs/split-by-feature.md, top section).
// Runs rows a–j in order on this checkout's HEAD and its split; never stops early; prints one table
// (check · pass/fail · number · evidence file) and exits 0 only when every row passes. Never posts, never pushes.
//   Run: npm run verify:919 [-- --out DIR] [--keep]      (several hours; OUT/verify-919.md grows row by row)
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, runLogged } from './readiness/proc.mjs';
import { cloneAt, npmCi, applySplit, commitMigration, rehearseRollback } from './readiness/trees.mjs';
import { e2eScripts } from './readiness.mjs';
import { parseFailures, unlistedFailures, registerEntryFor } from './flaky-register.mjs';
import { EXPECTED_SHOTS, FLOW_NAMES } from './parity/compare.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = [process.execPath, '--disable-warning=ExperimentalWarning'];
export const ROWS = [['a', 'fetch'], ['b', 'gate'], ['c', 'dry-run-repeatable'], ['d', 'suite-split'], ['e', 'parity-quick'],
  ['f', 'parity-full'], ['g', 'parity-package'], ['h', 'e2e-split'], ['i', 'rollback'], ['j', 'readiness']];
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

export function renderTable(rows, ctx = {}) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return `# verify:919${ctx.dev ? ` · origin/dev ${ctx.dev}` : ''}${ctx.head ? ` · HEAD ${ctx.head}` : ''}\n\n`
    + '| Check | Result | Number | Evidence |\n|---|---|---|---|\n'
    + rows.map((r) => `| ${r.id}. ${r.check} | ${r.ok ? 'pass' : 'FAIL'} | ${cell(r.number)} | ${cell(r.evidence)} |`).join('\n') + '\n';
}

export async function runVerify({ root = ROOT, out, keep = false, log = console.log, deps = {} } = {}) {
  const d = { run, runLogged, cloneAt, npmCi, applySplit, commitMigration, rehearseRollback,
    buildExtension: (file) => runLogged(NODE[0], [NODE[1], 'tools/build-extension.mjs', '--pack'], file, { cwd: root }),
    register: (dir) => JSON.parse(readFileSync(join(dir, 'test/flaky-register.json'), 'utf8')),
    scripts: (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts, ...deps };
  const E = (f) => join(out, 'evidence', f);
  mkdirSync(join(out, 'evidence'), { recursive: true });
  const git = (...a) => d.run('git', a, { cwd: root });
  const ctx = { head: git('rev-parse', 'HEAD').stdout.trim() };
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
  const e2e = (dir, tag) => {
    const list = e2eScripts(d.scripts(dir)).map((name) => {
      const file = `${tag}-${name.replace(/:/g, '-')}.log`;
      const r = d.runLogged('npm', ['run', name], E(file), { cwd: dir });
      const skipped = /\bSKIP\b/.test(r.text ?? '');
      return { name, ok: r.code === 0 && !skipped, skipped, code: r.code, evidence: `evidence/${file}` };
    });
    writeFileSync(E(`${tag}.json`), JSON.stringify(list, null, 2));
    const skipped = list.filter((x) => x.skipped).map((x) => x.name); const bad = list.filter((x) => !x.ok && !x.skipped).map((x) => x.name);
    return { ok: list.length > 0 && list.every((x) => x.ok), evidence: `evidence/${tag}.json`,
      number: `${list.filter((x) => x.ok).length}/${list.length} green${bad.length ? `; failed: ${bad.join(', ')}` : ''}${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}` };
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
  await row('h', 'e2e-split', () => { needSplit(); return e2e(split, 'h-e2e'); });
  await row('i', 'rollback', () => {
    needSplit();
    const r = d.rehearseRollback(d.run, split, ctx.head, ctx.migration);
    rmSync(join(split, 'extension', 'dist'), { recursive: true, force: true });
    writeFileSync(E('i-rollback-diff.log'), `left by the suite and parity, removed before the revert:\n${r.cleaned || '(nothing)'}\ngit revert ${ctx.migration} → ${r.reverted}\ngit diff --stat ${ctx.head} ${r.reverted}:\n${r.diff || '(empty)'}\ngit status --porcelain:\n${r.status || '(clean)'}\n`);
    const s = suite(split, 'i-suite-reverted'); const p = parity('tree:.', `tree:${split}`, 'parity-reverted', { timing: true }); const e = e2e(split, 'i-e2e');
    writeFileSync(E('i-rollback.json'), JSON.stringify({ revert: r, suite: s, parity: p, e2e: e }, null, 2));
    return { ok: r.ok && s.ok && p.ok && e.ok, evidence: 'evidence/i-rollback.json',
      number: `diff ${r.ok ? 'empty' : 'NOT empty'}; suite ${s.number}; parity ${p.ok ? 'pass' : `FAIL (${p.number})`}; e2e ${e.number}` };
  });
  await row('j', 'readiness', () => {
    const o = join(out, 'readiness');
    const args = [NODE[1], 'tools/readiness.mjs', 'run', '--out', o, ...(ctx.dev && ctx.head !== ctx.dev ? ['--dev-ref', ctx.head] : [])];
    const r = d.runLogged(NODE[0], args, E('j-readiness.log'), { cwd: root });
    const rep = readJson(join(o, 'report.json'));
    const both = !!rep && existsSync(join(o, 'report.md'));
    return { ok: r.code === 0 && both && rep.verdict?.value === 'go', evidence: both ? 'readiness/report.md' : 'evidence/j-readiness.log',
      number: rep ? `verdict ${rep.verdict?.value}${rep.verdict?.failing?.length ? ` (${rep.verdict.failing.join(', ')})` : ''}` : `exit ${r.code}, no report` };
  });

  const pass = rows.length === ROWS.length && rows.every((x) => x.ok);
  writeFileSync(join(out, 'verify-919.json'), JSON.stringify({ dev: ctx.dev, head: ctx.head, pass, rows }, null, 2));
  if (!keep) rmSync(join(out, 'trees'), { recursive: true, force: true });
  log(`\n${renderTable(rows, ctx)}\nverify:919 ${pass ? 'PASS' : 'FAIL'} (${join(out, 'verify-919.md')})`);
  return { out, rows, pass };
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  let out = null; let keep = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out = resolve(argv[++i]);
    else if (argv[i] === '--keep') keep = true;
    else { log(`verify-919: unknown argument ${argv[i]}\nusage: npm run verify:919 [-- --out DIR] [--keep]`); return 2; }
  }
  if (out && existsSync(out) && readdirSync(out).length) { log(`verify-919: ${out} is not empty`); return 3; }
  out ??= mkdtempSync(join(tmpdir(), 'worca-verify-919-'));
  return (await runVerify({ out, keep, log })).pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
