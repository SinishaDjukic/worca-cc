#!/usr/bin/env node
// tools/readiness.mjs — #919 slice 3: readiness dry run of the split on the latest origin/dev.
//   run   [--out DIR] [--keep]          fetch origin/dev, build + check the migrated tree, rehearse the rollback,
//                                       check open PRs, write DIR/report.md + DIR/report.json (exit 0 go, 1 no-go)
//   post  --out DIR                     post DIR's report on #919 after gh auth + secret scan (exit 0 posted)
//   split --rev REV --splitter-rev REV --out DIR
//                                       clone REV and the splitter REV as marked scratch clones under DIR, split the
//                                       first with the second's splitter, commit (PR catch-up recipe)
// Exit 2: bad arguments; 3: could not start (no report). See docs/split-by-feature.md.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, runLogged } from './readiness/proc.mjs';
import { cloneAt, npmCi, applySplit, treeHash, resetTree, commitMigration, rehearseRollback, servedEquivalence, docsAndPackage } from './readiness/trees.mjs';
import { listTargets, fetchHeads, mergeCheck, actionFor, openPrsProblems, keyOf, EXPRESS5 } from './readiness/open-prs.mjs';
import { conflictShare, fmtShare, deadCode, codeFiles, parityTimings, featureNames, movedByFeature, largestFiles } from './readiness/baseline.mjs';
import { buildReport, validateReport, missingEvidence, renderMarkdown, commentBody, ROLLBACK_NOTE, GATE_NOTE } from './readiness/report.mjs';
import { authStatus, postReport, REPO } from './readiness/gh.mjs';
import { scanSecrets } from '../src/core/secret-scan.mjs';
import { parseFailures, unlistedFailures } from './flaky-register.mjs';
import { SPIKE_GATE } from './split-by-feature.mjs';
import { listRoutes } from './parity/routes.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ev = (label, href) => ({ label, href });
const SUITE_NOTE = 'about 15 min';
const fatal = (msg) => Object.assign(new Error(msg), { fatal: true });

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'run') return { cmd, out: arg('--out'), keep: rest.includes('--keep') };
  if (cmd === 'post') { const out = arg('--out'); if (!out) throw new Error('post needs --out DIR'); return { cmd, out }; }
  if (cmd === 'split') {
    const s = { cmd, rev: arg('--rev'), splitterRev: arg('--splitter-rev'), out: arg('--out') };
    if (!s.rev || !s.splitterRev || !s.out) throw new Error('split needs --rev REV --splitter-rev REV --out DIR');
    return s;
  }
  throw new Error('usage: readiness.mjs run [--out DIR] [--keep] | post --out DIR | split --rev REV --splitter-rev REV --out DIR');
}

/** The catch-up recipe's split: both trees are marked scratch clones made here, so nobody writes the marker by hand,
 *  and the splitter that runs is `splitterRev`'s (M^), never the PR branch's own copy. */
export async function splitAt({ root = process.cwd(), rev, splitterRev, out, deps = {} }) {
  const d = { run, runLogged, cloneAt, npmCi, applySplit, commitMigration, ...deps };
  const sha = (x) => {
    const r = d.run('git', ['-C', root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${x}^{commit}`]);
    if (r.code !== 0) throw new Error(`unknown revision ${x}`);
    return r.stdout.trim();
  };
  out = resolve(out);
  if (existsSync(out) && readdirSync(out).length) throw fatal(`${out} is not empty`);
  const [treeSha, splitterSha] = [sha(rev), sha(splitterRev)];
  const tree = d.cloneAt(d.run, root, treeSha, join(out, 'tree'));
  const splitter = d.cloneAt(d.run, root, splitterSha, join(out, 'splitter'));
  d.npmCi(d.runLogged, tree, join(out, 'npm-ci-tree.log')); d.npmCi(d.runLogged, splitter, join(out, 'npm-ci-splitter.log'));
  const { changed } = await d.applySplit(d.run, tree, { splitter });
  return { tree, commit: d.commitMigration(d.run, tree), changed };
}

export async function runReadiness({ root = process.cwd(), out, keep = false, now = () => new Date(), log = console.log, deps = {} } = {}) {
  const d = { run, runLogged, cloneAt, npmCi, applySplit, treeHash, resetTree, commitMigration, rehearseRollback, servedEquivalence,
    docsAndPackage, listTargets, fetchHeads, mergeCheck, listRoutes, authStatus,
    codeFiles, deadCode, largestFiles, featureNames, movedByFeature, ...deps };
  const generatedAt = now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (out) { out = resolve(out); if (existsSync(out) && readdirSync(out).length) throw fatal(`${out} is not empty`); }
  else out = mkdtempSync(join(tmpdir(), 'worca-readiness-'));      // private (0700) and new: nobody else can pre-create it
  const evd = join(out, 'evidence'); mkdirSync(evd, { recursive: true });
  const E = (f) => join(evd, f);
  const say = (s) => log(`readiness: ${s}`);
  const trees = join(out, 'trees');
  try {
    // 0. dev commit (fatal when it cannot be fetched: no report without a dev commit). Not a row.
    const fetch = d.runLogged('git', ['-C', root, 'fetch', '--no-tags', 'origin', 'dev'], E('fetch.log'));
    if (fetch.code !== 0) throw fatal(`git fetch origin dev failed (${E('fetch.log')})`);
    const sha = d.run('git', ['-C', root, 'rev-parse', 'origin/dev']).stdout.trim();
    const toolCommit = d.run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
    const remoteUrl = d.run('git', ['-C', root, 'remote', 'get-url', 'origin']).stdout.trim();

    const checks = [];
    const step = async (n, id, title, fn) => {
      say(`[${n}/11] ${title}…`);
      try {
        const r = await fn();
        checks.push({ id, title, status: r.ok ? 'pass' : 'fail', detail: r.detail, evidence: r.evidence });
        say(`${r.ok ? '✔' : '✖'} ${id} — ${r.detail}`);
        return r;
      } catch (e) {
        writeFileSync(E(`${id}.log`), `${e.stack ?? e.message}\n`, { flag: 'a' });
        checks.push({ id, title, status: 'fail', detail: `error: ${e.message.split('\n')[0]}`, evidence: [ev(`${id}.log`, `evidence/${id}.log`)] });
        say(`✖ ${id} — error: ${e.message.split('\n')[0]} (evidence/${id}.log)`);
        return null;
      }
    };
    const suite = (dir, id) => {
      const r = d.runLogged(process.execPath, ['tools/test.mjs'], E(`${id}.log`), { cwd: dir });
      const register = JSON.parse(readFileSync(join(dir, 'test/flaky-register.json'), 'utf8'));
      const unlisted = unlistedFailures(r.text, register);             // throws on a log with no ℹ fail summary
      const fails = parseFailures(r.text).length;                      // unlisted ⊆ these, so fails - unlisted >= 0
      return { ok: unlisted.length === 0, detail: unlisted.length ? `${unlisted.length} failures not in the flaky register` : `0 failures outside the flaky register (${fails} known flaky)`,
        evidence: [ev(`${id}.log`, `evidence/${id}.log`)], fails, unlisted };
    };
    const parity = (a, b, dir) => {
      const r = d.runLogged(process.execPath, ['--disable-warning=ExperimentalWarning', join(TOOL_ROOT, 'tools/parity.mjs'), 'run', '--a', `tree:${a}`, '--b', `tree:${b}`, '--out', join(out, dir)], E(`${dir}.log`));
      const rep = JSON.parse(readFileSync(join(out, dir, 'report.json'), 'utf8'));
      return { ok: r.code === 0 && rep.pass && rep.timingGated, rep, evidence: [ev(`${dir}/report.md`, `${dir}/report.md`), ev(`${dir}.log`, `evidence/${dir}.log`)] };
    };

    const base = join(trees, 'base'); const mig = join(trees, 'migrated');
    let plan = null; let migration = null; let parityRep = null; let deadDev = null; let deadMig = null;
    let largest = {}; let features = []; let baselineRows = []; const openRows = []; const flaky = []; let gateFailed = false;
    await step(1, 'gh-auth', 'gh auth status', () => { const a = d.authStatus(d.run); writeFileSync(E('gh-auth.log'), `${a.detail}\n`); return { ...a, evidence: [ev('gh-auth.log', 'evidence/gh-auth.log')] }; });
    await step(2, 'split-check', 'scratch clones; split-by-feature --check --stats on the dev commit', () => {
      d.cloneAt(d.run, root, sha, base); d.npmCi(d.runLogged, base, E('npm-ci-base.log'));
      d.cloneAt(d.run, root, sha, mig); d.npmCi(d.runLogged, mig, E('npm-ci-migrated.log'));
      const r = d.runLogged(process.execPath, ['tools/split-by-feature.mjs', '--check', '--stats', '--root', base], E('split-check.log'), { cwd: base });
      const gate = r.text.match(/after the split: (\d+) lines — spike gate (passed|FAILED)/);
      gateFailed = gate?.[2] === 'FAILED';
      const detail = gate?.[2] === 'FAILED' ? `spike gate FAILED: ui/server.mjs after the split ${gate[1]} lines > ${SPIKE_GATE.serverLinesAfter} (slice 1 follow-up)`
        : gate ? `covered; spike gate passed (${gate[1]} lines)` : `exit ${r.code}`;
      return { ok: r.code === 0, detail, evidence: [ev('split-check.log', 'evidence/split-check.log')] };
    });
    await step(3, 'dry-run-repeatable', 'build the migrated tree twice', async () => {
      plan = (await d.applySplit(d.run, mig)).plan; const h1 = d.treeHash(d.run, mig);
      d.resetTree(d.run, mig, sha); await d.applySplit(d.run, mig); const h2 = d.treeHash(d.run, mig);
      migration = d.commitMigration(d.run, mig);
      writeFileSync(E('dry-run.log'), `tree hash 1: ${h1}\ntree hash 2: ${h2}\nmigration commit: ${migration}\nfiles:\n${[...plan.files.keys()].sort().join('\n')}\n`);
      deadDev = d.deadCode(d.codeFiles(base)); deadMig = d.deadCode(d.codeFiles(mig));
      largest = { dev: d.largestFiles(base), migrated: d.largestFiles(mig) };
      features = d.movedByFeature(plan.files, d.featureNames(plan.files));
      writeFileSync(E('moved.json'), JSON.stringify({ features, largest, deadDev, deadMig }, null, 2));
      return { ok: h1 === h2, detail: h1 === h2 ? `same tree hash ${h1.slice(0, 9)} both times` : `tree hashes differ: ${h1.slice(0, 9)} vs ${h2.slice(0, 9)}`, evidence: [ev('dry-run.log', 'evidence/dry-run.log')] };
    });
    const needMigration = () => { if (!migration) throw new Error('no migrated tree (dry-run-repeatable failed)'); };
    await step(4, 'equivalence', 'served CSS, index.html and route table', async () => {
      needMigration();
      const r = await d.servedEquivalence(base, mig, d.listRoutes); writeFileSync(E('equivalence.json'), JSON.stringify(r, null, 2));
      return { ok: r.ok, detail: r.ok ? `CSS bytes, index.html bytes and ${r.routeCount[0]} routes identical` : `css ${r.css}, html ${r.html}, routes ${r.routes}`, evidence: [ev('equivalence.json', 'evidence/equivalence.json')] };
    });
    await step(5, 'docs-and-package', 'design-system.md, feature-files.md and npm pack of the migrated tree', () => {
      needMigration();
      const r = d.docsAndPackage(d.run, mig, plan); writeFileSync(E('docs-and-package.json'), JSON.stringify(r, null, 2));
      return { ok: r.ok, detail: r.ok ? `docs name the new locations; npm pack lists ui/routes/ and ${r.dirs.length} feature folders` : `design ${r.designOk}, feature-files ${r.featureFiles}, ${r.notListed.length} unlisted, ${r.notPacked.length} unpacked`, evidence: [ev('docs-and-package.json', 'evidence/docs-and-package.json')] };
    });
    await step(6, 'suite-migrated', `npm test on the migrated tree (${SUITE_NOTE})`, () => {
      needMigration(); const s = suite(mig, 'suite-migrated'); flaky.push(...Array(s.fails - s.unlisted.length).fill('suite-migrated')); return s;
    });
    await step(7, 'parity', 'parity: dev vs the migrated tree', () => {
      needMigration(); const p = parity(base, mig, 'parity'); parityRep = p.rep;
      return { ...p, detail: p.ok ? 'PASS: 0 route, visual and flow differences, timings within 10%' : `FAIL: ${p.rep.routeDiffs.length} route diffs, ${p.rep.visualDiffs?.length ?? 0} visual, ${p.rep.failedFlows.length} flows` };
    });
    await step(8, 'open-prs', 'open PRs and dependabot branches against dev and the migrated tree', () => {
      needMigration();
      const listed = d.listTargets(d.run, { repo: REPO, remoteUrl, cwd: mig });
      const gone = new Set(d.fetchHeads(d.run, mig, remoteUrl, listed).map(keyOf));   // closed or deleted since the listing
      const targets = listed.filter((t) => !gone.has(keyOf(t)));
      const vanished = gone.size ? `; ${gone.size} gone before the fetch: ${[...gone].join(', ')}` : '';
      for (const t of targets) { const dev = d.mergeCheck(d.run, mig, sha, t.ref); const split = d.mergeCheck(d.run, mig, migration, t.ref); openRows.push({ ...t, dev, split, action: actionFor(t, { dev, split }) }); }
      const problems = openPrsProblems(targets, openRows);
      // #1049 is expected open; if it was closed or merged, say so instead of passing silently
      const noExpress = openRows.some((t) => EXPRESS5.test(t.title)) ? '' : '; note: no open express 5 PR (#1049 closed or merged?)';
      if (noExpress) say(`note: no open express 5 PR in the table (#1049 closed or merged?)`);
      writeFileSync(E('open-prs.json'), JSON.stringify({ targets: targets.length, gone: [...gone], problems, rows: openRows }, null, 2));
      return { ok: problems.length === 0, detail: problems.length ? problems[0] : `${openRows.length} PRs and branches, ${openRows.filter((t) => t.split.conflict).length} conflict after the split${vanished}${noExpress}`, evidence: [ev('open-prs.json', 'evidence/open-prs.json')] };
    });
    await step(9, 'rollback', 'revert the migration; suite and parity again', () => {
      needMigration();
      const r = d.rehearseRollback(d.run, mig, sha, migration);
      writeFileSync(E('rollback-diff.log'), `left by the suite and parity, removed before the revert:\n${r.cleaned || '(nothing)'}\ngit revert ${migration} → ${r.reverted}\ngit diff --stat ${sha} ${r.reverted}:\n${r.diff || '(empty)'}\ngit status --porcelain:\n${r.status || '(clean)'}\n`);
      const s = suite(mig, 'suite-reverted'); const p = parity(base, mig, 'parity-reverted');
      return { ok: r.ok && s.ok && p.ok, detail: `diff ${r.diff ? 'NOT empty' : 'empty'}; suite ${s.ok ? 'green' : 'red'}; parity ${p.ok ? 'PASS' : 'FAIL'}${gateFailed ? ` (${GATE_NOTE})` : ''} — ${ROLLBACK_NOTE}`,
        evidence: [ev('rollback-diff.log', 'evidence/rollback-diff.log'), ...s.evidence, ...p.evidence] };   // 4 links
    });
    await step(10, 'baseline', 'baseline comparison', () => {
      if (!deadDev || !parityRep) throw new Error('needs the migrated tree and the parity report');
      const t = parityTimings(parityRep);
      baselineRows = [
        { measure: 'conflicted-merge share', dev: fmtShare(conflictShare(openRows, 'dev')), migrated: fmtShare(conflictShare(openRows, 'split')) },
        { measure: 'boot (median ms)', dev: t.boot.dev, migrated: t.boot.migrated },
        ...Object.entries(t.pages).map(([p, x]) => ({ measure: `page load ${p} (median ms)`, dev: x.dev, migrated: x.migrated })),
        { measure: 'dead-code count', dev: deadDev.length, migrated: deadMig.length },
      ];
      writeFileSync(E('baseline.json'), JSON.stringify({ rows: baselineRows, deadDev, deadMig }, null, 2));
      // no open PRs is a valid table; a failed open-prs step (no gh auth, say) is not a comparison
      const prsOk = checks.find((c) => c.id === 'open-prs')?.status === 'pass';
      return { ok: deadMig.length <= deadDev.length && prsOk, detail: `dead code ${deadDev.length} → ${deadMig.length}; conflicts ${baselineRows[0].dev} → ${baselineRows[0].migrated}`,
        evidence: [ev('baseline.json', 'evidence/baseline.json'), ev('parity/report.md', 'parity/report.md')] };
    });

    // 11. report (not a row)
    say('[11/11] report…');
    writeFileSync(E('summary.txt'), checks.map((c) => `${c.status}\t${c.id}\t${c.detail}`).join('\n') + '\n');
    const report = buildReport({ repo: REPO, sha, generatedAt, toolCommit, checks, openPrs: openRows, baseline: { rows: baselineRows },
      moved: { features, largest }, inputs: { owner: null, freezeWindow: null, flaky } });
    const problems = [...validateReport(report), ...missingEvidence(report, (href) => existsSync(join(out, href)))];
    if (problems.length) throw fatal(`report invalid:\n${problems.join('\n')}`);
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(join(out, 'report.md'), renderMarkdown(report));
    say(`verdict ${report.verdict.value} (${report.verdict.failing.length} of ${checks.length} checks fail) — report: ${join(out, 'report.md')}`);
    return { out, report };
  } finally {
    if (!keep) rmSync(trees, { recursive: true, force: true });
  }
}

export function postFrom({ root = process.cwd(), out, run: r = run, log = console.log }) {
  out = resolve(out);
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  const md = readFileSync(join(out, 'report.md'), 'utf8');
  const pairs = [[out, '$OUT'], [realpathSync(out), '$OUT'], [resolve(root), '$REPO'], [realpathSync(root), '$REPO'], [homedir(), '~']];
  const clean = (s) => pairs.reduce((t, [from, to]) => t.replaceAll(from, to), s);
  // the hrefs come from report.md's own links (EVIDENCE_LINK: no `..`), so a read stays inside OUT
  const read = (href) => (existsSync(join(out, href)) ? readFileSync(join(out, href), 'utf8') : null);
  const { marker, text, omitted } = commentBody(report, md, read, { clean, flag: scanSecrets });
  for (const o of omitted) log(`readiness: evidence tail ${o.href} omitted: ${o.reason}`);
  const { url } = postReport({ run: r, root, body: text, marker, file: join(out, 'comment.md') });
  log(`readiness: posted ${url} (shown by gh issue view 919 --comments)`);
  return { url, omitted };
}

export async function main(argv = process.argv.slice(2), { log = console.log, err = console.error } = {}) {
  let a;
  try { a = parseArgs(argv); } catch (e) { err(e.message); return 2; }
  try {
    if (a.cmd === 'run') return (await runReadiness({ out: a.out, keep: a.keep, log })).report.verdict.value === 'go' ? 0 : 1;
    if (a.cmd === 'post') { postFrom({ out: a.out, log }); return 0; }
    const { tree, commit, changed } = await splitAt({ rev: a.rev, splitterRev: a.splitterRev, out: a.out });
    log(`readiness: split ${changed.length} files; ${tree} is at ${commit}`); return 0;
  } catch (e) {
    if (e.fatal) { err(`readiness: cannot start: ${e.message}`); return 3; }
    err(`readiness: ${e.message}`); return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
