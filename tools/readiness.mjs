#!/usr/bin/env node
// tools/readiness.mjs — #919 slice 3: readiness dry run of the split on the latest origin/dev.
//   run   [--out DIR] [--keep] [--dev-ref REF] [--crawl-from DIR] [--catch-up-from FILE]
//                                       fetch origin/dev (or rehearse on REF), build + check the migrated tree, rehearse the rollback,
//                                       check open PRs, write DIR/report.md + DIR/report.json (exit 0 go, 1 no-go)
//   post  --out DIR                     post DIR's report on #919 after gh auth + secret scan (exit 0 posted)
//   split --rev REV --splitter-rev REV --out DIR
//                                       clone REV and the splitter REV as marked scratch clones under DIR, split the
//                                       first with the second's splitter, commit (PR catch-up recipe)
// Exit 2: bad arguments; 3: could not start (no report). See docs/split-by-feature.md.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, runLogged } from './readiness/proc.mjs';
import { cloneAt, npmCi, hasSplitter, applySplit, sliceOneEquivalence, treeHash, resetTree, commitMigration, rehearseRollback, servedEquivalence, docsAndPackage } from './readiness/trees.mjs';
import { listTargets, fetchHeads, mergeCheck, actionFor, openPrsProblems, keyOf, EXPRESS5 } from './readiness/open-prs.mjs';
import { conflictShare, fmtShare, deadCode, codeFiles, parityTimings, featureNames, movedByFeature, largestFiles } from './readiness/baseline.mjs';
import { buildReport, validateReport, missingEvidence, renderMarkdown, commentBody, ROLLBACK_NOTE, GATE_NOTE, SPLITTER_MISSING } from './readiness/report.mjs';
import { authStatus, postReport, REPO } from './readiness/gh.mjs';
import { scanSecrets } from '../src/core/secret-scan.mjs';
import { parseFailures, unlistedFailures } from './flaky-register.mjs';
import { listRoutes } from './parity/routes.mjs';
import { crawlSummary } from './parity/crawl-compare.mjs';
import { catchUpAll, defaultDeps as catchUpDeps } from './catch-up-919.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ev = (label, href) => ({ label, href });
const SUITE_NOTE = 'about 15 min';
const fatal = (msg) => Object.assign(new Error(msg), { fatal: true });
export { e2eScripts } from './readiness/e2e.mjs';

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'run') {
    const VALUED = ['--out', '--dev-ref', '--crawl-from', '--catch-up-from'];
    for (let i = 0; i < rest.length; i += 1) {
      if (VALUED.includes(rest[i])) i += 1;
      else if (rest[i] !== '--keep') throw new Error(`run: unknown argument ${rest[i]}`);
    }
    const devRef = arg('--dev-ref');
    if (rest.includes('--dev-ref') && (!devRef || devRef.startsWith('--'))) throw new Error('run --dev-ref needs REF');
    const path = (k) => { const v = arg(k); if (rest.includes(k) && (!v || v.startsWith('--'))) throw new Error(`run ${k} needs a path`); return v ? resolve(v) : null; };
    return { cmd, out: arg('--out'), keep: rest.includes('--keep'),
      crawlFrom: path('--crawl-from'), catchUpFrom: path('--catch-up-from'), ...(devRef ? { devRef } : {}) };
  }
  if (cmd === 'post') { const out = arg('--out'); if (!out) throw new Error('post needs --out DIR'); return { cmd, out }; }
  if (cmd === 'split') {
    const s = { cmd, rev: arg('--rev'), splitterRev: arg('--splitter-rev'), out: arg('--out') };
    if (!s.rev || !s.splitterRev || !s.out) throw new Error('split needs --rev REV --splitter-rev REV --out DIR');
    return s;
  }
  throw new Error('usage: readiness.mjs run [--out DIR] [--keep] [--dev-ref REF] [--crawl-from DIR] [--catch-up-from FILE] | post --out DIR | split --rev REV --splitter-rev REV --out DIR');
}

/** The runbook's Inputs table (docs/split-by-feature.md): the go/no-go owner and the freeze window; an empty cell is null. */
export function runbookInputs(doc) {
  const cell = (k) => new RegExp(`^\\| ${k} \\| *([^|]*?) *\\|$`, 'm').exec(doc)?.[1] || null;
  return { owner: cell('Go/no-go owner'), freezeWindow: cell('Freeze window') };
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
  const made = !existsSync(out);
  try {
    const [treeSha, splitterSha] = [sha(rev), sha(splitterRev)];
    const tree = d.cloneAt(d.run, root, treeSha, join(out, 'tree'));
    const splitter = d.cloneAt(d.run, root, splitterSha, join(out, 'splitter'));
    d.npmCi(d.runLogged, tree, join(out, 'npm-ci-tree.log')); d.npmCi(d.runLogged, splitter, join(out, 'npm-ci-splitter.log'));
    const { changed } = await d.applySplit(d.run, tree, { splitter });
    return { tree, commit: d.commitMigration(d.run, tree), changed };
  } catch (e) {
    // nothing half-built stays behind: the dir this call made goes, an empty dir it was given is emptied again
    if (made) rmSync(out, { recursive: true, force: true });
    else for (const f of readdirSync(out)) rmSync(join(out, f), { recursive: true, force: true });
    throw e;
  }
}

export async function runReadiness({ root = process.cwd(), out, keep = false, devRef = null, crawlFrom = null, catchUpFrom = null, now = () => new Date(), log = console.log, deps = {} } = {}) {
  const d = { run, runLogged, cloneAt, npmCi, hasSplitter, applySplit, sliceOneEquivalence, treeHash, resetTree, commitMigration, rehearseRollback, servedEquivalence,
    docsAndPackage, listTargets, fetchHeads, mergeCheck, listRoutes, authStatus,
    codeFiles, deadCode, largestFiles, featureNames, movedByFeature,
    scripts: (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts,
    catchUpAll: (o) => catchUpAll({ d: catchUpDeps, ...o }), ...deps };
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
    const ref = devRef ?? 'origin/dev';
    const shaRun = d.run('git', ['-C', root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
    if (shaRun.code !== 0) throw fatal(devRef ? `unknown --dev-ref ${ref}` : 'origin/dev does not resolve to a commit');
    const sha = shaRun.stdout.trim();
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
    const parity = (a, b, dir, { quick = false } = {}) => {
      const r = d.runLogged(process.execPath, ['--disable-warning=ExperimentalWarning', join(TOOL_ROOT, 'tools/parity.mjs'), 'run', '--a', `tree:${a}`, '--b', `tree:${b}`, '--out', join(out, dir), ...(quick ? ['--quick'] : [])], E(`${dir}.log`));
      const rep = JSON.parse(readFileSync(join(out, dir, 'report.json'), 'utf8'));
      return { ok: r.code === 0 && rep.pass && (quick || rep.timingGated), rep, evidence: [ev(`${dir}/report.md`, `${dir}/report.md`), ev(`${dir}.log`, `evidence/${dir}.log`)] };
    };

    const base = join(trees, 'base'); const mig = join(trees, 'migrated');
    let plan = null; let migration = null; let parityRep = null; let deadDev = null; let deadMig = null;
    let largest = {}; let features = []; let baselineRows = []; const openRows = []; const flaky = []; let gateFailed = false;
    await step(1, 'gh-auth', 'gh auth status', () => { const a = d.authStatus(d.run); writeFileSync(E('gh-auth.log'), `${a.detail}\n`); return { ...a, evidence: [ev('gh-auth.log', 'evidence/gh-auth.log')] }; });
    let splitterMissing = false; let ceiling = null; let acceptedDeltas = null;
    const noTree = () => (splitterMissing ? 'no migrated tree: no splitter on the dev commit (see split-check)' : 'no migrated tree (dry-run-repeatable failed)');
    const needMigration = () => { if (!migration) throw new Error(noTree()); };
    await step(2, 'split-check', 'scratch clones; split-by-feature --check --stats on the dev commit', () => {
      d.cloneAt(d.run, root, sha, base);
      if (!d.hasSplitter(base)) {
        splitterMissing = true;
        writeFileSync(E('split-check.log'), `tools/split-by-feature.mjs is not in ${sha}: the #919 tooling is not merged into dev\n`);
        return { ok: false, detail: `${SPLITTER_MISSING} ${sha.slice(0, 9)} (the #919 tooling is not merged into dev)`, evidence: [ev('split-check.log', 'evidence/split-check.log')] };
      }
      d.npmCi(d.runLogged, base, E('npm-ci-base.log'));
      d.cloneAt(d.run, root, sha, mig); d.npmCi(d.runLogged, mig, E('npm-ci-migrated.log'));
      const r = d.runLogged(process.execPath, ['tools/split-by-feature.mjs', '--check', '--stats', '--root', base], E('split-check.log'), { cwd: base });
      // the reason in parentheses is optional: a dev commit's older splitter prints the line without it
      const gate = r.text.match(/after the split: (\d+) lines — spike gate (passed|FAILED)(?: \(([^)]*)\))?/);
      gateFailed = gate?.[2] === 'FAILED';
      const why = gate?.[3] ?? 'no reason printed';
      const detail = gateFailed ? `spike gate FAILED: ${why}` : gate ? `covered; spike gate passed (${gate[1]} lines; ${why})` : `exit ${r.code}`;
      return { ok: r.code === 0, detail, evidence: [ev('split-check.log', 'evidence/split-check.log')] };
    });
    await step(3, 'dry-run-repeatable', 'build the migrated tree twice', async () => {
      if (splitterMissing) throw new Error('not run: no splitter on the dev commit (see split-check)');
      const first = await d.applySplit(d.run, mig); plan = first.plan; ceiling = first.ceiling ?? null; const h1 = d.treeHash(d.run, mig);
      d.resetTree(d.run, mig, sha); await d.applySplit(d.run, mig); const h2 = d.treeHash(d.run, mig);
      migration = d.commitMigration(d.run, mig);
      writeFileSync(E('dry-run.log'), `tree hash 1: ${h1}\ntree hash 2: ${h2}\nmigration commit: ${migration}\n`
        + `ui/server.mjs after the split: ${plan.stats?.serverLinesAfter} lines (ceiling ${ceiling}); pinned routes: ${plan.stats?.pinnedRoutes}\n`
        + `files:\n${[...plan.files.keys()].sort().join('\n')}\n`);
      deadDev = d.deadCode(d.codeFiles(base)); deadMig = d.deadCode(d.codeFiles(mig));
      largest = { dev: d.largestFiles(base), migrated: d.largestFiles(mig) };
      features = d.movedByFeature(plan.files, d.featureNames(plan.files));
      writeFileSync(E('moved.json'), JSON.stringify({ features, largest, deadDev, deadMig }, null, 2));
      return { ok: h1 === h2, detail: h1 === h2 ? `same tree hash ${h1.slice(0, 9)} both times` : `tree hashes differ: ${h1.slice(0, 9)} vs ${h2.slice(0, 9)}`, evidence: [ev('dry-run.log', 'evidence/dry-run.log')] };
    });
    await step(4, 'equivalence', 'served CSS, index.html, route table and slice 1 equivalence', async () => {
      needMigration();
      const r = await d.servedEquivalence(base, mig, d.listRoutes);
      const eq = await d.sliceOneEquivalence(base, mig);
      writeFileSync(E('equivalence.json'), JSON.stringify({ ...r, sliceOne: { equal: eq.equal, problems: eq.problems, probes: eq.probes, routes: eq.routes } }, null, 2));
      writeFileSync(E('accepted-deltas.json'), JSON.stringify(eq.acceptedDeltas, null, 2) + '\n');
      acceptedDeltas = eq.acceptedDeltas;     // only after its file exists: Risks links it whenever this is set
      const ok = r.ok && eq.equal;
      return { ok, detail: ok ? `CSS bytes, index.html bytes and ${r.routeCount[0]} routes identical; ${eq.probes} served probes and the route table equal; ${acceptedDeltas.length} accepted deltas (see Risks)`
        : `css ${r.css}, html ${r.html}, routes ${r.routes}; slice 1: ${eq.problems.length} problems${eq.problems[0] ? ` (${eq.problems[0]})` : ''}`,
        evidence: [ev('equivalence.json', 'evidence/equivalence.json'), ev('accepted-deltas.json', 'evidence/accepted-deltas.json')] };
    });
    await step(5, 'docs-and-package', 'design-system.md, feature-files.md and npm pack of the migrated tree', () => {
      needMigration();
      const r = d.docsAndPackage(d.run, mig, plan); writeFileSync(E('docs-and-package.json'), JSON.stringify(r, null, 2));
      return { ok: r.ok, detail: r.ok ? `docs name the new locations; npm pack lists ui/routes/ and ${r.dirs.length} feature folders` : `design ${r.designOk}, feature-files ${r.featureFiles}, ${r.notListed.length} unlisted, ${r.notPacked.length} unpacked`, evidence: [ev('docs-and-package.json', 'evidence/docs-and-package.json')] };
    });
    await step(6, 'suite-migrated', `npm test on the migrated tree (${SUITE_NOTE})`, () => {
      needMigration(); const s = suite(mig, 'suite-migrated'); flaky.push(...Array(s.fails - s.unlisted.length).fill('suite-migrated')); return s;
    });
    const treeOf = (dir, rev = 'HEAD') => d.run('git', ['-C', dir, 'rev-parse', `${rev}^{tree}`]).stdout.trim();
    // the differential crawl, dev vs migrated; verify:919 row h's crawl is reused only when its A and first B are these trees
    const crawl = () => {
      const rep = crawlFrom && existsSync(join(crawlFrom, 'report.json')) ? JSON.parse(readFileSync(join(crawlFrom, 'report.json'), 'utf8')) : null;
      const usable = rep && rep.a?.tree === treeOf(base) && rep.bs?.[0]?.tree === treeOf(mig);
      if (usable) cpSync(crawlFrom, join(out, 'crawl'), { recursive: true, filter: (src) => !/[\\/](records\.ndjson|dom|png|a1|a2|b\d+)([\\/]|$)/.test(src.slice(crawlFrom.length)) });
      else d.runLogged(process.execPath, ['--disable-warning=ExperimentalWarning', join(TOOL_ROOT, 'tools/parity.mjs'), 'crawl', '--a', `tree:${base}`, '--b', `tree:${mig}`, '--out', join(out, 'crawl')], E('crawl.log'));
      const r = JSON.parse(readFileSync(join(out, 'crawl', 'report.json'), 'utf8'));
      return { ok: r.pass === true, reused: !!usable, r };
    };
    await step(7, 'parity', 'parity and the differential crawl: dev vs the migrated tree', () => {
      needMigration(); const p = parity(base, mig, 'parity'); parityRep = p.rep;
      const c = crawl();
      const pd = p.ok ? 'PASS: 0 route, visual and flow differences, timings within 10%' : `FAIL: ${p.rep.routeDiffs.length} route diffs, ${p.rep.visualDiffs?.length ?? 0} visual, ${p.rep.failedFlows.length} flows`;
      return { ok: p.ok && c.ok, detail: `${pd}; crawl ${c.ok ? 'PASS' : 'FAIL'}: ${crawlSummary(c.r)}${c.reused ? ' (verify:919 row h, same trees)' : ''}`,
        evidence: [...p.evidence, ev('crawl/report.md', 'crawl/report.md'), ...(c.reused ? [] : [ev('crawl.log', 'evidence/crawl.log')])] };
    });
    await step(8, 'open-prs', 'open PRs and dependabot branches against dev and the migrated tree; the catch-up dry run', async () => {
      needMigration();
      const listed = d.listTargets(d.run, { repo: REPO, remoteUrl, cwd: mig });
      const gone = new Set(d.fetchHeads(d.run, mig, remoteUrl, listed).map(keyOf));   // closed or deleted since the listing
      const targets = listed.filter((t) => !gone.has(keyOf(t)));
      const vanished = gone.size ? `; ${gone.size} gone before the fetch: ${[...gone].join(', ')}` : '';
      for (const t of targets) { const dev = d.mergeCheck(d.run, mig, sha, t.ref); const split = d.mergeCheck(d.run, mig, migration, t.ref); openRows.push({ ...t, dev, split, action: actionFor(t, { dev, split }) }); }
      const problems = openPrsProblems(targets, openRows);
      // the catch-up dry run per target (verify:919 row j's is reused when its M^ and M tree are this run's)
      const reused = catchUpFrom && existsSync(catchUpFrom) ? JSON.parse(readFileSync(catchUpFrom, 'utf8')) : null;
      const usable = reused && reused.mParent === sha && reused.mTree === treeOf(mig, migration);
      const caught = usable ? reused.rows : await d.catchUpAll({ root, out: join(trees, 'catch-up'), targets, headsRepo: mig,
        ctx: { mParent: sha, m: migration, mRepo: mig, devRepo: mig, devRef: migration, splitter: base, devTree: mig }, log: say });
      writeFileSync(E('catch-up.json'), JSON.stringify({ reused: !!usable, rows: caught }, null, 2));
      for (const r of openRows) r.catchUp = (({ verdict, reasons }) => ({ verdict, reasons }))(caught.find((c) => c.key === keyOf(r)) ?? { verdict: 'not run', reasons: ['no catch-up row'] });
      // #1049 is expected open; if it was closed or merged, say so instead of passing silently
      const noExpress = openRows.some((t) => EXPRESS5.test(t.title)) ? '' : '; note: no open express 5 PR (#1049 closed or merged?)';
      if (noExpress) say(`note: no open express 5 PR in the table (#1049 closed or merged?)`);
      writeFileSync(E('open-prs.json'), JSON.stringify({ targets: targets.length, gone: [...gone], problems, rows: openRows }, null, 2));
      const works = openRows.filter((t) => t.catchUp.verdict === 'works').length;
      return { ok: problems.length === 0, detail: problems.length ? problems[0] : `${openRows.length} PRs and branches, ${openRows.filter((t) => t.split.conflict).length} conflict after the split; catch-up: ${works} work, ${openRows.length - works} need a hand fix or did not run${usable ? ' (verify:919 row j, same trees)' : ''}${vanished}${noExpress}`,
        evidence: [ev('open-prs.json', 'evidence/open-prs.json'), ev('catch-up.json', 'evidence/catch-up.json')] };
    });
    // D9: with an empty diff the reverted tree is dev's own, so the suite and a quick parity suffice (no e2e: verify:919
    // row i and the CI job firefox-e2e run those)
    await step(9, 'rollback', 'revert the migration; the diff, the suite and a quick parity again', () => {
      needMigration();
      const r = d.rehearseRollback(d.run, mig, sha, migration);
      writeFileSync(E('rollback-diff.log'), `left by the suite and parity, removed before the revert:\n${r.cleaned || '(nothing)'}\ngit revert ${migration} → ${r.reverted}\ngit diff --stat ${sha} ${r.reverted}:\n${r.diff || '(empty)'}\ngit status --porcelain:\n${r.status || '(clean)'}\n`);
      const s = suite(mig, 'suite-reverted'); const p = parity(base, mig, 'parity-reverted', { quick: true });
      return { ok: r.ok && s.ok && p.ok,
        detail: `diff ${r.diff ? 'NOT empty' : 'empty'}; suite ${s.ok ? 'green' : 'red'}; quick parity ${p.ok ? 'PASS' : 'FAIL'}${gateFailed ? ` (${GATE_NOTE})` : ''} — ${ROLLBACK_NOTE}`,
        evidence: [ev('rollback-diff.log', 'evidence/rollback-diff.log'), ...s.evidence, ...p.evidence] };
    });
    await step(10, 'baseline', 'baseline comparison', () => {
      if (!deadDev || !parityRep) throw new Error(splitterMissing ? noTree() : 'needs the migrated tree and the parity report');
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
    // only with a migration commit: dry-run.log is written after it, and Risks must never link a missing file
    const raisesFile = join(mig, 'tools/split-by-feature/size-caps-raises.json');
    const ceilingRaises = migration && existsSync(raisesFile) ? JSON.parse(readFileSync(raisesFile, 'utf8')) : [];
    if (ceilingRaises.length) writeFileSync(E('size-caps-raises.json'), JSON.stringify(ceilingRaises, null, 2) + '\n');
    const risks = migration && plan?.stats ? { acceptedDeltas: acceptedDeltas ?? [], serverLines: plan.stats.serverLinesAfter, ceiling, pins: plan.stats.pinnedRoutes, ceilingRaises,
      evidence: [...(acceptedDeltas ? [ev('accepted-deltas.json', 'evidence/accepted-deltas.json')] : []), ev('dry-run.log', 'evidence/dry-run.log'),
        ...(ceilingRaises.length ? [ev('size-caps-raises.json', 'evidence/size-caps-raises.json')] : [])],
      ...(acceptedDeltas ? {} : { note: 'accepted deltas not measured (the equivalence row failed)' }) } : undefined;
    const report = buildReport({ repo: REPO, sha, ref, generatedAt, toolCommit, checks, openPrs: openRows, baseline: { rows: baselineRows },
      moved: { features, largest }, risks,
      inputs: { ...runbookInputs(existsSync(join(TOOL_ROOT, 'docs/split-by-feature.md')) ? readFileSync(join(TOOL_ROOT, 'docs/split-by-feature.md'), 'utf8') : ''), flaky } });
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
  if ((report.devCommit.ref ?? 'origin/dev') !== 'origin/dev') throw new Error(`refusing to post: the report is a rehearsal on ${report.devCommit.ref}, not origin/dev`);
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
    if (a.cmd === 'run') return (await runReadiness({ out: a.out, keep: a.keep, devRef: a.devRef, crawlFrom: a.crawlFrom, catchUpFrom: a.catchUpFrom, log })).report.verdict.value === 'go' ? 0 : 1;
    if (a.cmd === 'post') { postFrom({ out: a.out, log }); return 0; }
    const { tree, commit, changed } = await splitAt({ rev: a.rev, splitterRev: a.splitterRev, out: a.out });
    log(`readiness: split ${changed.length} files; ${tree} is at ${commit}`); return 0;
  } catch (e) {
    if (e.fatal) { err(`readiness: cannot start: ${e.message}`); return 3; }
    err(`readiness: ${e.message}`); return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
