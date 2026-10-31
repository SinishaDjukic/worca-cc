// tools/readiness/trees.mjs — #919 slice 3: the scratch trees of a readiness run. Shared clones (never worktrees: the
// user's worktree list and refs stay as they are), detached at the dev SHA and marked as scratch. The split itself is
// slice 1's planSplit + writeFiles, loaded from a scratch tree so it is that commit's own code.
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const MARKER = 'worca-readiness-scratch';   // in .git/: written by cloneAt, required by assertScratch
const IDENT = ['-c', 'user.name=worca readiness', '-c', 'user.email=readiness@worca.invalid'];
const must = (r, what) => { if (r.code !== 0) throw new Error(`${what}: exit ${r.code}: ${r.stderr.trim()}`); return r.stdout; };

export function cloneAt(run, root, sha, dir) {
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  must(run('git', ['clone', '--quiet', '--shared', '--no-checkout', root, dir]), 'git clone --shared');
  must(run('git', ['-C', dir, 'checkout', '--quiet', '--detach', sha]), `git checkout ${sha}`);
  writeFileSync(join(dir, '.git', MARKER), `readiness scratch clone of ${sha}\n`);
  return dir;
}

export function npmCi(runLogged, dir, log) {
  const r = runLogged('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], log, { cwd: dir });
  if (r.code !== 0) throw new Error(`npm ci in ${dir}: exit ${r.code}`);
}

/** The split only writes into a marked, detached, clean scratch clone. */
export function assertScratch(run, dir) {
  if (!existsSync(join(dir, '.git', MARKER))) throw new Error(`refusing to split ${dir}: it is not a readiness scratch clone (no .git/${MARKER})`);
  const head = run('git', ['-C', dir, 'symbolic-ref', '-q', 'HEAD']);
  if (head.code === 0) throw new Error(`refusing to split ${dir}: it is on ${head.stdout.trim()}; the split only writes into a detached scratch checkout`);
  if (must(run('git', ['-C', dir, 'status', '--porcelain']), 'git status').trim()) throw new Error(`refusing to split ${dir}: the checkout has changes`);
}

export const hasSplitter = (dir) => existsSync(join(dir, 'tools/split-by-feature.mjs'));

/** `splitter` is the tree whose tools/split-by-feature.mjs runs (default: dir itself). The catch-up recipe passes a
 *  clone at M^, so a PR branch's own copy of the splitter is never executed. */
export async function applySplit(run, dir, { splitter = dir } = {}) {
  assertScratch(run, dir);
  if (!hasSplitter(splitter)) throw new Error(`no splitter: tools/split-by-feature.mjs is not in ${splitter}`);
  const mod = await import(pathToFileURL(join(splitter, 'tools/split-by-feature.mjs')).href);
  mod.assertExpress4(dir);
  const plan = mod.planSplit({ root: dir });
  if (plan.alreadySplit) throw new Error(`${dir} is already split`);
  if (plan.problems.length) throw new Error(`the split plan has ${plan.problems.length} problem(s):\n${plan.problems.join('\n')}`);
  const ceiling = typeof mod.serverCeiling === 'function' ? (mod.serverCeiling(dir) ?? null) : null;   // before the write
  return { plan, ceiling, changed: mod.writeFiles(dir, plan.files) };
}

/** Slice 1's served-output and route-table equivalence, from the migrated tree's own equivalence.mjs. */
export async function sliceOneEquivalence(baseDir, migDir) {
  const { compareTrees } = await import(pathToFileURL(join(migDir, 'tools/split-by-feature/equivalence.mjs')).href);
  const homes = [];
  const home = () => { const h = mkdtempSync(join(tmpdir(), 'readiness-eq-')); homes.push(h); return h; };
  try { return compareTrees(baseDir, migDir, { home }); }
  finally { for (const h of homes) rmSync(h, { recursive: true, force: true }); }
}

export function treeHash(run, dir) {
  must(run('git', ['-C', dir, 'add', '-A']), 'git add -A');
  return must(run('git', ['-C', dir, 'write-tree']), 'git write-tree').trim();
}

/** Back to `sha`; node_modules (ignored) stays, so no second npm ci. */
export function resetTree(run, dir, sha) {
  must(run('git', ['-C', dir, 'reset', '--quiet', '--hard', sha]), 'git reset --hard');
  must(run('git', ['-C', dir, 'clean', '-fdq']), 'git clean');
}

/** Commits the split as one migration commit. applySplit only writes files, so stage everything first. */
export function commitMigration(run, dir) {
  must(run('git', ['-C', dir, 'add', '-A']), 'git add -A');
  must(run('git', ['-C', dir, ...IDENT, 'commit', '--quiet', '-m', 'Split large files by feature (#919): readiness dry run']), 'git commit');
  return must(run('git', ['-C', dir, 'rev-parse', 'HEAD']), 'git rev-parse').trim();
}

/** Procedure A of the runbook on the scratch tree. The suite and parity already ran in this tree, so whatever they left
 *  (untracked files, edits) is recorded in `cleaned` and removed first; ignored files such as node_modules stay. Then
 *  revert the migration commit; the tree must equal the dev SHA. */
export function rehearseRollback(run, dir, sha, migration) {
  const cleaned = must(run('git', ['-C', dir, 'status', '--porcelain']), 'git status');
  resetTree(run, dir, migration);
  must(run('git', ['-C', dir, ...IDENT, 'revert', '--no-edit', migration]), `git revert ${migration}`);
  const reverted = must(run('git', ['-C', dir, 'rev-parse', 'HEAD']), 'git rev-parse').trim();
  const diff = must(run('git', ['-C', dir, 'diff', '--stat', sha, reverted]), 'git diff');
  const status = must(run('git', ['-C', dir, 'status', '--porcelain']), 'git status');
  return { ok: diff === '' && status === '', reverted, diff, status, cleaned };
}

/** Served output of the migrated tree vs the dev tree: CSS bytes, index.html bytes, ordered route table. */
export async function servedEquivalence(baseDir, migDir, list) {
  const { assemble } = await import(pathToFileURL(join(migDir, 'src/core/public-assets.mjs')).href);
  const pub = (d) => join(d, 'ui', 'public');
  const css = assemble('css', 'style.css', pub(migDir)).text === readFileSync(join(pub(baseDir), 'style.css'), 'utf8');
  const html = assemble('html', 'index.html', pub(migDir)).text === readFileSync(join(pub(baseDir), 'index.html'), 'utf8');
  const a = list({ kind: 'tree', root: baseDir }); const b = list({ kind: 'tree', root: migDir });
  const firstDiff = Math.max(a.length, b.length) === 0 ? -1
    : [...Array(Math.max(a.length, b.length)).keys()].find((i) => JSON.stringify(a[i]) !== JSON.stringify(b[i])) ?? -1;
  const routes = firstDiff === -1;
  return { ok: css && html && routes, css, html, routes, routeCount: [a.length, b.length],
    firstDiff: routes ? null : { index: firstDiff, a: a[firstDiff] ?? null, b: b[firstDiff] ?? null } };
}

const MOVED = /^ui\/(?:routes\/[a-z0-9-]+\.mjs|public\/[a-z0-9-]+\/[a-z0-9-]+\.(?:css|html))$/;
/** The migration's own doc and package edits: design-system.md names the :root part, feature-files.md lists every moved
 *  file, and npm pack lists ui/routes/ and every ui/public feature folder. */
export function docsAndPackage(run, migDir, plan) {
  const ds = readFileSync(join(migDir, 'docs/design-system.md'), 'utf8');
  const designOk = !ds.includes('`:root` of `ui/public/style.css`') && /`:root` of `ui\/public\/[a-z0-9-]+\/[a-z0-9-]+\.css`/.test(ds);
  const ffPath = join(migDir, 'docs/feature-files.md');
  const ff = existsSync(ffPath) ? readFileSync(ffPath, 'utf8') : '';
  const moved = [...plan.files].filter(([p, t]) => t !== null && MOVED.test(p) && p !== 'ui/routes/index.mjs').map(([p]) => p).sort();
  const notListed = moved.filter((p) => !ff.includes(`\`${p}\``));
  const pack = JSON.parse(must(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: migDir }), 'npm pack --dry-run'))[0].files.map((f) => f.path);
  const dirs = [...new Set(moved.filter((p) => p.startsWith('ui/public/')).map((p) => `${p.split('/').slice(0, 3).join('/')}/`))].sort();
  const notPacked = ['ui/routes/', ...dirs].filter((d) => !pack.some((f) => f.startsWith(d)));
  return { ok: designOk && !!ff && !notListed.length && !notPacked.length, designOk, featureFiles: !!ff, notListed, notPacked, dirs };
}
