#!/usr/bin/env node
// tools/split-catch-up.mjs — #919: the runbook's PR catch-up recipe (docs/split-by-feature.md) as one command. Never pushes and
// never touches a branch: every step runs in marked scratch clones under OUT, and the caught-up commit stays there.
//   npm run split:catch-up -- BRANCH [--out DIR] [--m SHA] [--tests related|none] [--parity quick|none]
//     without --m, M is the tag feature-split/after and M^ the tag feature-split/before (docs/split-by-feature.md, D1 and D7)
//   npm run split:catch-up -- --all [--out DIR] [--m SHA]     every open PR and dependabot branch: split, 3-way apply, related tests
//   npm run split:catch-up -- --fixture [--out DIR]           the fixture "old" PR (a route, a CSS rule, a markup line), quick parity
// Exit 0 works (every target; a single BRANCH also when quick parity only warns), 1 needs a hand fix, 2 bad arguments, 3 could not start.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, runLogged } from './readiness/proc.mjs';
import { cloneAt, npmCi, applySplit, commitMigration } from './readiness/trees.mjs';
import { listTargets, fetchHeads, keyOf, EXPRESS5 } from './readiness/open-prs.mjs';
import { REPO } from './readiness/gh.mjs';
import { code } from './readiness/report.mjs';
import { relatedTests } from './test-related.mjs';
import { unlistedFailures, parseFailures } from './flaky-register.mjs';
import { makeFixturePr, checkFixture } from './split-catch-up/fixture.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = [process.execPath, '--disable-warning=ExperimentalWarning'];
export const M_SUBJECT = /^Split large files by feature \(#919\)/;
export const TAG_BEFORE = 'feature-split/before';   // dev before the migration commit: M^
export const TAG_AFTER = 'feature-split/after';     // dev after it: M
const IDENT = ['-c', 'user.name=worca catch-up', '-c', 'user.email=catch-up@worca.invalid'];
const USAGE = 'usage: npm run split:catch-up -- BRANCH | --all | --fixture [--out DIR] [--m SHA] [--tests related|none] [--parity quick|none]'
  + ` (without --m: M = tag ${TAG_AFTER}, M^ = tag ${TAG_BEFORE})`;
const fatal = (msg) => Object.assign(new Error(msg), { fatal: true });
const slug = (s) => String(s).replace(/[^\w.-]+/g, '-').slice(0, 60);
const must = (r, what) => { if (r.code !== 0) throw new Error(`${what}: exit ${r.code}: ${r.stderr.trim().split('\n')[0]}`); return r.stdout; };
// The monoliths and where the split puts their pieces (tools/readiness/trees.mjs MOVED).
const SPLIT_HOME = { 'ui/server.mjs': /^ui\/routes\/[a-z0-9-]+\/(?!index\.mjs$)[a-z0-9-]+\.mjs$/, 'ui/public/style.css': /^ui\/public\/[a-z0-9-]+\/[a-z0-9-]+\.css$/,
  'ui/public/index.html': /^ui\/public\/[a-z0-9-]+\/[a-z0-9-]+\.html$/ };

export const defaultDeps = {
  run, runLogged, cloneAt, npmCi, applySplit, commitMigration, relatedTests, listTargets, fetchHeads,
  parity: (a, b, o) => {
    const r = runLogged(NODE[0], [NODE[1], join(TOOL_ROOT, 'tools/parity.mjs'), 'run', '--a', `tree:${a}`, '--b', `tree:${b}`, '--out', o, '--quick'], `${o}.log`);
    const f = join(o, 'report.json');
    return { code: r.code, rep: existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null };
  },
  register: (dir) => JSON.parse(readFileSync(join(dir, 'test/flaky-register.json'), 'utf8')),   // no exported loader; as split-verify.mjs
};

export function parseArgs(argv) {
  const VALUED = ['--out', '--m', '--tests', '--parity'];
  const o = { tests: 'related' }; const pos = []; let all = false; let fixture = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (VALUED.includes(a)) {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value; ${USAGE}`);
      o[a.slice(2)] = v; i += 1;
    } else if (a === '--all') all = true;
    else if (a === '--fixture') fixture = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}; ${USAGE}`);
    else pos.push(a);
  }
  if (!['related', 'none'].includes(o.tests)) throw new Error(`--tests must be related or none; ${USAGE}`);
  if (o.parity && !['quick', 'none'].includes(o.parity)) throw new Error(`--parity must be quick or none; ${USAGE}`);
  if (pos.length > 1) throw new Error(`one branch at a time (got ${pos.length}); ${USAGE}`);
  if ([pos.length === 1, all, fixture].filter(Boolean).length !== 1) throw new Error(USAGE);
  if (all) return { mode: 'all', ...o, parity: o.parity ?? 'none' };
  if (fixture) return { mode: 'fixture', ...o, parity: o.parity ?? 'quick' };
  return { mode: 'branch', branch: pos[0], ...o, parity: o.parity ?? 'quick' };
}

export function findMigration(run, root, ref = 'origin/dev') {
  const r = run('git', ['-C', root, 'log', '--first-parent', '--format=%H%x09%s', ref]);
  if (r.code !== 0) return null;
  const hit = r.stdout.split('\n').map((l) => l.split('\t')).find(([, s]) => M_SUBJECT.test(s ?? '') && !/readiness dry run/.test(s));
  return hit?.[0] ?? null;
}

export function movedOf(original, carried) {
  return original.map((from) => ({ from, to: [...(carried.includes(from) ? [from] : []), ...(SPLIT_HOME[from] ? carried.filter((p) => SPLIT_HOME[from].test(p)) : [])] }));
}

export function ownRoutes(patch) {
  const out = new Set();
  for (const l of patch.split('\n')) if (l.startsWith('+') && !l.startsWith('+++')) {
    for (const m of l.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`](\/api\/[^'"`]+)/g)) out.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return out;
}

/**
 * M, M^ and "latest dev". Without --m, M is the tag feature-split/after (else the newest freeze-day subject on origin/dev)
 * and M^ the tag feature-split/before (else M's parent). A given or found M is real (dev = origin/dev). With none, this is a rehearsal: M^ = HEAD (it must
 * carry the splitter), M = HEAD's split under OUT/m, and that tree is also the splitter, latest dev and the parity A side.
 * Callers that already hold a split (split:verify, readiness) pass `ctx` instead.
 */
export async function resolveContext({ root, out, m, d }) {
  const sha = (x) => { const r = d.run('git', ['-C', root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${x}^{commit}`]); if (r.code) throw fatal(`unknown revision ${x}`); return r.stdout.trim(); };
  const tag = (t) => { const r = d.run('git', ['-C', root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `refs/tags/${t}^{commit}`]); return r.code ? null : r.stdout.trim(); };
  const found = m ? sha(m) : tag(TAG_AFTER) ?? findMigration(d.run, root);
  if (found) return { rehearsal: false, m: found, mParent: (!m && tag(TAG_BEFORE)) || sha(`${found}^`), mRepo: root, devRepo: root, devRef: sha('origin/dev'), splitter: null, devTree: null };
  const head = sha('HEAD');
  if (d.run('git', ['-C', root, 'cat-file', '-e', `${head}:tools/split-by-feature.mjs`]).code !== 0) throw fatal('no migration commit on origin/dev, and HEAD has no splitter to rehearse with');
  const mDir = d.cloneAt(d.run, root, head, join(out, 'm'));
  d.npmCi(d.runLogged, mDir, join(out, 'npm-ci-m.log'));
  await d.applySplit(d.run, mDir);
  const mSha = d.commitMigration(d.run, mDir);
  // splitter: null → catchUpOne clones M^ (= HEAD) once and splits with it. mDir is already split, and the recipe always
  // splits with M^'s own splitter.
  return { rehearsal: true, m: mSha, mParent: head, mRepo: mDir, devRepo: mDir, devRef: mSha, splitter: null, devTree: mDir };
}

/** A clone at `sha` with node_modules, made once per run (the splitter at M^ for a real M, the dev tree for parity). */
function lazyTree(ctx, key, d, repo, sha, dir) {
  if (!ctx[key]) { ctx[key] = d.cloneAt(d.run, repo, sha, dir); d.npmCi(d.runLogged, ctx[key], `${dir}.npm-ci.log`); }
  return ctx[key];
}

/** A single BRANCH whose quick parity differs from dev: the result is still handed over, with warnings to review. */
export const WORKS_WITH_WARNING = 'works (review parity warning)';
const works = (v) => v === 'works' || v === WORKS_WITH_WARNING;

/** The recipe for one target t = { key, branch, title, head, repo, fork }. Returns its row (verdict, reasons, moved, …). */
export async function catchUpOne({ root, t, ctx, out, tests = 'related', parity = 'none', parityWarns = false, d, log = () => {} }) {
  const W = join(out, slug(t.key)); mkdirSync(W, { recursive: true });
  const row = { key: t.key, branch: t.branch, head: t.head, verdict: 'works', reasons: [], moved: [], tests: null, parity: null };
  const hand = (why) => { row.verdict = 'needs hand fix'; row.reasons.push(why); return row; };
  const step = (s) => log(`${t.key}: ${s}`);
  if (EXPRESS5.test(t.title ?? '')) return hand('express 5 bump: rebase after the migration (runbook)');
  // 1. bring P to M^
  step(`1. merge M^ ${ctx.mParent.slice(0, 9)} into ${t.head?.slice(0, 9)}`);
  const tree = d.cloneAt(d.run, t.repo ?? root, t.head, join(W, 'tree'));
  const mg = d.run('git', ['-C', tree, ...IDENT, 'merge', '--no-edit', '--no-ff', ctx.mParent]);
  if (mg.code !== 0) return hand(`merge with M^ conflicts in: ${d.run('git', ['-C', tree, 'diff', '--name-only', '--diff-filter=U']).stdout.trim().split('\n').join(', ')}`);
  const original = must(d.run('git', ['-C', tree, 'diff', '--name-only', ctx.mParent, 'HEAD']), 'git diff').trim().split('\n').filter(Boolean);
  // 2. split with M^'s splitter (never P's own copy)
  step("2. split with M^'s splitter");
  d.npmCi(d.runLogged, tree, join(W, 'npm-ci-tree.log'));
  const splitter = ctx.splitter ?? lazyTree(ctx, 'splitter', d, root, ctx.mParent, join(out, 'splitter'));
  try { await d.applySplit(d.run, tree, { splitter }); } catch (e) { return hand(`split: ${String(e.message).split('\n').slice(0, 3).join(' · ')}`); }
  const split = d.commitMigration(d.run, tree);
  // 3. P's change in the split layout: M is the split of M^, so diff M..split(P+M^)
  step('3. diff M..split');
  must(d.run('git', ['-C', tree, 'fetch', '--quiet', '--no-tags', ctx.mRepo, ctx.m]), 'git fetch M');
  const patchText = must(d.run('git', ['-C', tree, 'diff', '--binary', ctx.m, split]), 'git diff M');
  const patch = join(W, 'P.patch'); writeFileSync(patch, patchText);
  if (!patchText.trim()) { row.reasons.push('nothing to carry: P has no change beyond M^'); return row; }
  // 4. onto the latest dev, 3-way
  step(`4. apply -3 onto the latest dev ${ctx.devRef.slice(0, 9)}`);
  const applied = d.cloneAt(d.run, ctx.devRepo, ctx.devRef, join(W, 'applied'));
  if (d.run('git', ['-C', applied, 'apply', '-3', '--index', patch]).code !== 0) {
    const un = d.run('git', ['-C', applied, 'diff', '--name-only', '--diff-filter=U']).stdout.trim().split('\n').filter(Boolean);
    return hand(`3-way apply conflicts in: ${un.join(', ') || '(rejected hunks, see P.patch)'}`);
  }
  must(d.run('git', ['-C', applied, ...IDENT, 'commit', '--quiet', '-m', 'catch up with the #919 split']), 'git commit');
  row.caughtUp = must(d.run('git', ['-C', applied, 'rev-parse', 'HEAD']), 'rev-parse').trim(); row.appliedDir = applied;
  const carried = must(d.run('git', ['-C', applied, 'diff', '--name-only', ctx.devRef, 'HEAD']), 'git diff').trim().split('\n').filter(Boolean);
  row.moved = movedOf(original, carried);
  // 5. related tests (a fork's code is never run here)
  if (tests === 'related' && t.fork) row.tests = { ran: false, why: 'fork PR: its code is not run here' };
  else if (tests === 'related') {
    step('5. related tests');
    d.npmCi(d.runLogged, applied, join(W, 'npm-ci-applied.log'));
    const rel = d.relatedTests(applied, carried);
    const args = rel.full ? ['tools/test.mjs'] : ['tools/test.mjs', ...rel.tests];
    const r = rel.full || rel.tests.length ? d.runLogged(process.execPath, args, join(W, 'tests.log'), { cwd: applied }) : { code: 0, text: 'ℹ fail 0\n' };
    const unlisted = unlistedFailures(r.text, d.register(applied));
    row.tests = { ran: true, full: rel.full, files: rel.tests.length, fail: parseFailures(r.text).length, unlisted: unlisted.length, log: 'tests.log' };
    if (unlisted.length) hand(`tests: ${unlisted.length} failures outside the flaky register (first: ${unlisted[0].file})`);
  }
  // 6. quick parity (fixture, or a single branch run): only P's own routes may differ
  if (parity === 'quick') {
    step('6. quick parity: latest dev vs the caught-up tree');
    const devTree = ctx.devTree ?? lazyTree(ctx, 'devTree', d, ctx.devRepo, ctx.devRef, join(out, 'dev'));
    if (tests !== 'related') d.npmCi(d.runLogged, applied, join(W, 'npm-ci-applied.log'));
    const p = d.parity(devTree, applied, join(W, 'parity'));
    const mine = ownRoutes(patchText);
    const foreign = (p.rep?.routeDiffs ?? []).filter((x) => !mine.has(x.route));
    row.parity = { own: (p.rep?.routeDiffs ?? []).length - foreign.length, foreign: foreign.map((x) => x.route), flows: (p.rep?.failedFlows ?? []).map((f) => f.name),
      signedOut: (p.rep?.signedOutProblems ?? []).length, visual: (p.rep?.visualDiffs ?? []).length, report: 'parity/report.md' };
    const report = join(W, 'parity', 'report.md');
    const check = "check they are your PR's own changes";
    const warnings = !p.rep ? [`parity: no report (see ${join(W, 'parity.log')})`] : [
      ...(foreign.length ? [`parity: these routes differ from dev; ${check}: ${foreign.map((x) => x.route).join(', ')} (see ${report})`] : []),
      ...(row.parity.flows.length ? [`parity: ${row.parity.flows.length} failed flows (${row.parity.flows.join(', ')}); ${check} (see ${report})`] : []),
      ...(row.parity.signedOut ? [`parity: ${row.parity.signedOut} signed-out problems; ${check} (see ${report})`] : [])];
    if (parityWarns && warnings.length) { row.warnings = warnings; if (row.verdict === 'works') row.verdict = WORKS_WITH_WARNING; }
    else if (!p.rep) hand('parity: no report');
    else if (warnings.length) hand(`parity: ${foreign.length} route diffs outside P's own routes, ${row.parity.flows.length} failed flows, ${row.parity.signedOut} signed-out problems`);
  }
  log(`${t.key}: ${row.verdict}${row.reasons.length ? ` (${row.reasons.join('; ')})` : ''}`);
  return row;
}

const mTreeOf = (d, ctx) => d.run('git', ['-C', ctx.mRepo, 'rev-parse', `${ctx.m}^{tree}`]).stdout.trim();
const movedText = (moved) => moved.map((m) => `${m.from} → ${m.to.join(', ') || '(nothing)'}`).join('; ');

/** Every open PR and dependabot branch: split, 3-way apply, related tests. Writes OUT/all.json and OUT/report.md. */
export async function catchUpAll({ root, out, ctx, d, log = () => {}, targets = null, headsRepo = null }) {
  mkdirSync(out, { recursive: true });
  let list = targets; let gone = [];
  if (!list) {
    const remoteUrl = must(d.run('git', ['-C', root, 'remote', 'get-url', 'origin']), 'git remote get-url').trim();
    headsRepo = d.cloneAt(d.run, root, ctx.mParent, join(out, 'heads'));
    list = d.listTargets(d.run, { repo: REPO, remoteUrl, cwd: headsRepo });
    gone = d.fetchHeads(d.run, headsRepo, remoteUrl, list);
  }
  const goneKeys = new Set(gone.map(keyOf));
  const rows = [];
  for (const t of list) {
    const key = keyOf(t);
    if (goneKeys.has(key)) { rows.push({ key, branch: t.branch, head: t.head, verdict: 'needs hand fix', reasons: ['branch gone'], moved: [], tests: null, parity: null }); continue; }
    try { rows.push(await catchUpOne({ root, t: { ...t, key, repo: headsRepo }, ctx, out, tests: 'related', parity: 'none', d, log })); }
    catch (e) { rows.push({ key, branch: t.branch, head: t.head, verdict: 'needs hand fix', reasons: [`error: ${String(e.message).split('\n')[0]}`], moved: [], tests: null, parity: null }); }
  }
  writeFileSync(join(out, 'all.json'), JSON.stringify({ mParent: ctx.mParent, m: ctx.m, mTree: mTreeOf(d, ctx), rows }, null, 2) + '\n');
  writeFileSync(join(out, 'report.md'), [`# #919 catch-up dry run: ${rows.length} open PRs and dependabot branches`, '',
    `M^ \`${ctx.mParent}\` · M \`${ctx.m}\`${ctx.rehearsal ? ' (rehearsal: M is the split of M^)' : ''}. Nothing was pushed.`, '',
    '| # | branch | verdict | reasons | moved |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${code(r.key)} | ${code(r.branch)} | ${r.verdict} | ${r.reasons.length ? code(r.reasons.join('; ')) : '—'} | ${r.moved.length ? code(movedText(r.moved)) : '—'} |`), ''].join('\n'));
  return rows;
}

/** The fixture "old" PR on pre-split dev, caught up with quick parity, then checked for where its three edits landed. */
export async function runFixture({ root, out, ctx, d, log = () => {} }) {
  mkdirSync(out, { recursive: true });
  const base = must(d.run('git', ['-C', root, 'merge-base', 'HEAD', 'origin/dev']), 'git merge-base').trim();
  const { dir, head } = makeFixturePr({ run: d.run, cloneAt: d.cloneAt, root, base, dir: join(out, 'fixture-pr') });
  const row = await catchUpOne({ root, t: { key: 'fixture', branch: 'fixture', title: 'fixture', head, repo: dir }, ctx, out, parity: 'quick', d, log });
  if (row.appliedDir) {
    const c = checkFixture(row.appliedDir);
    row.fixture = c;
    for (const p of c.problems) { row.verdict = 'needs hand fix'; row.reasons.push(`fixture: ${p}`); }
  }
  writeFileSync(join(out, 'fixture.json'), JSON.stringify({ base, ...row }, null, 2) + '\n');
  return row;
}

export async function main(argv = process.argv.slice(2), { log = console.log, err = console.error, deps = {}, root = process.cwd() } = {}) {
  let a;
  try { a = parseArgs(argv); } catch (e) { err(e.message); return 2; }
  const d = { ...defaultDeps, ...deps };
  const out = a.out ? resolve(a.out) : mkdtempSync(join(tmpdir(), 'worca-catch-up-'));
  try {
    mkdirSync(out, { recursive: true });
    const ctx = await resolveContext({ root, out, m: a.m, d });
    if (ctx.rehearsal) log(`rehearsal: no migration commit on origin/dev yet; M is the split of HEAD ${ctx.mParent.slice(0, 9)}`);
    let rows;
    if (a.mode === 'all') rows = await catchUpAll({ root, out, ctx, d, log });
    else if (a.mode === 'fixture') rows = [await runFixture({ root, out, ctx, d, log })];
    else {
      const head = must(d.run('git', ['-C', root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${a.branch}^{commit}`]), `unknown branch ${a.branch}`).trim();
      rows = [await catchUpOne({ root, t: { key: a.branch, branch: a.branch, title: a.branch, head, repo: root }, ctx, out, tests: a.tests, parity: a.parity, parityWarns: true, d, log })];
    }
    for (const r of rows) {
      if (r.moved.length) log(`moved: ${movedText(r.moved)}`);
      log(`${r.key}: ${r.verdict}${r.reasons.length ? ` (${r.reasons.join('; ')})` : ''}`);
      for (const w of r.warnings ?? []) log(`warning: ${w}`);
      if (works(r.verdict) && r.appliedDir) {
        log(`nothing was pushed. To take it: git fetch ${r.appliedDir} HEAD && git switch -c ${r.branch}-caught-up FETCH_HEAD`);
      }
    }
    return rows.every((r) => works(r.verdict)) ? 0 : 1;
  } catch (e) {
    if (e.fatal) { err(`split:catch-up: cannot start: ${e.message}`); return 3; }
    err(`split:catch-up: ${e.message}`); return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
