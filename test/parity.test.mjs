// test/parity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { packJsonPaths } from '../tools/check-pack.mjs';
import { parseArgs, main, compareDirs } from '../tools/parity.mjs';
import { chromePath } from '../tools/parity/flows.mjs';
import { EXPECTED_SHOTS, FLOW_NAMES } from '../tools/parity/compare.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

test('parseArgs: run needs --a and --b; flags default off', () => {
  assert.deepEqual(parseArgs(['run', '--a', 'tree:.', '--b', 'tree:.', '--out', '/o']),
    { cmd: 'run', a: 'tree:.', b: 'tree:.', out: '/o', quick: false, gateTimings: true });
  assert.equal(parseArgs(['run', '--a', 'x', '--b', 'y', '--out', '/o', '--no-timing-gate']).gateTimings, false);
  assert.throws(() => parseArgs(['run', '--a', 'tree:.']), /--b/);
});

function fakeSnapshotDir(dir, colour, { bootMs = [1], samples = bootMs.length } = {}) {
  mkdirSync(join(dir, 'shots'), { recursive: true });
  const shots = [];
  for (let i = 0; i < EXPECTED_SHOTS; i += 1) {
    const file = join(dir, 'shots', `${i}.png`);
    writeFileSync(file, encodePNG(2, 2, new Uint8Array(12).fill(i === 0 ? colour : 0)));
    shots.push({ page: `p${i >> 1}`, theme: i % 2 ? 'dark' : 'light', file });
  }
  const route = { method: 'GET', path: '/api/a', status: 200, shape: '{}', volatile: false };
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({ target: 'tree:x', kind: 'tree', shots,
    routes: { signedIn: [route], signedOut: [{ ...route, status: 401, problem: null }] },
    flows: FLOW_NAMES.map((name) => ({ name, ok: true, ms: 1 })),
    timings: { samples, bootMs, pageLoadMs: {} } }));
}

test('parseArgs crawl: --b repeats, docker is refused, --b is required', () => {
  const o = parseArgs(['crawl', '--a', 'tree:.', '--b', 'tree:x', '--b', 'package:.', '--out', 'o']);
  assert.deepEqual([o.cmd, o.a, o.bs, o.workers, o.control, o.keep], ['crawl', 'tree:.', ['tree:x', 'package:.'], 8, true, false]);
  assert.equal(parseArgs(['crawl', '--a', 'tree:.', '--b', 'tree:x', '--out', 'o', '--no-control', '--workers', '8']).control, false);
  assert.throws(() => parseArgs(['crawl', '--a', 'tree:.', '--b', 'docker:img', '--out', 'o']), /crawl supports tree: and package: targets/);
  assert.throws(() => parseArgs(['crawl', '--a', 'tree:.', '--out', 'o']), /crawl needs --b/);
});

test('compareDirs: one changed colour is a visual difference with a diff PNG and fails', () => {
  const out = mkdtempSync(join(tmpdir(), 'parity-cmp-'));
  fakeSnapshotDir(join(out, 'a'), 0); fakeSnapshotDir(join(out, 'b'), 200);
  const r = compareDirs(join(out, 'a'), join(out, 'b'), out);
  assert.equal(r.visualDiffs.length, 1);
  assert.ok(existsSync(r.visualDiffs[0].diff));
  assert.equal(r.pass, false);
});

test('compareDirs: a shot missing on either side is reported, not thrown', () => {
  const out = mkdtempSync(join(tmpdir(), 'parity-cmp-'));
  fakeSnapshotDir(join(out, 'a'), 0); fakeSnapshotDir(join(out, 'b'), 0);
  rmSync(join(out, 'a', 'shots', '0.png'));
  const snapB = JSON.parse(readFileSync(join(out, 'b', 'snapshot.json'), 'utf8'));
  snapB.shots.push({ page: 'extra', theme: 'light', file: snapB.shots[0].file });
  writeFileSync(join(out, 'b', 'snapshot.json'), JSON.stringify(snapB));
  const r = compareDirs(join(out, 'a'), join(out, 'b'), out);
  assert.deepEqual(r.visualDiffs.map((v) => `${v.page}/${v.theme}: ${v.note}`).sort(),
    ['extra/light: missing in A', 'p0/light: missing in A']);
  assert.equal(r.pass, false);
});

test('compareDirs: shots are read from the snapshot dir, so a copied snapshot with a shot removed reports it missing', () => {
  const out = mkdtempSync(join(tmpdir(), 'parity-cmp-'));
  fakeSnapshotDir(join(out, 'a'), 0); fakeSnapshotDir(join(out, 'b'), 0);
  cpSync(join(out, 'a'), join(out, 'copy'), { recursive: true });
  rmSync(join(out, 'copy', 'shots', '1.png'));
  const r = compareDirs(join(out, 'copy'), join(out, 'b'), out);
  assert.deepEqual(r.visualDiffs.map((v) => `${v.page}/${v.theme}: ${v.note}`), ['p0/dark: missing in A']);
});

test('main compare: identical snapshots exit 0; 5 samples with B 30% slower exit 1 (timing gate wired end to end)', async () => {
  const out = mkdtempSync(join(tmpdir(), 'parity-cmp-'));
  fakeSnapshotDir(join(out, 'a'), 0, { bootMs: [1000, 1000, 1000, 1000, 1000] });
  fakeSnapshotDir(join(out, 'b'), 0, { bootMs: [1000, 1000, 1000, 1000, 1000] });
  fakeSnapshotDir(join(out, 'slow'), 0, { bootMs: [1300, 1300, 1300, 1300, 1300] });
  const quiet = { log: () => {} };
  assert.equal(await main(['compare', '--a', join(out, 'a'), '--b', join(out, 'b'), '--out', join(out, 'r1')], quiet), 0);
  assert.equal(await main(['compare', '--a', join(out, 'a'), '--b', join(out, 'slow'), '--out', join(out, 'r2')], quiet), 1);
  assert.equal(JSON.parse(readFileSync(join(out, 'r2', 'report.json'), 'utf8')).timings.boot.pass, false);
  assert.equal(await main(['compare', '--a', join(out, 'a'), '--b', join(out, 'slow'), '--out', join(out, 'r3'), '--no-timing-gate'], quiet), 0);
});

test('npm pack ships no harness file and no flaky register', () => {
  const paths = packJsonPaths(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' }));
  assert.deepEqual(paths.filter((p) => p.startsWith('tools/parity') || p.startsWith('test/')), []);
});

// A child process: only an exiting CLI proves that no server child (or browser) was left alive to hold its event loop.
test('run with a missing Chrome stops every started target and exits 1 instead of hanging', { timeout: 180_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'parity-nochrome-'));
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'tools', 'parity.mjs'),
    'run', '--a', 'tree:.', '--b', 'tree:.', '--out', out, '--quick'],
  { cwd: ROOT, env: { ...process.env, CHROME_BIN: join(out, 'no-chrome') }, encoding: 'utf8', timeout: 150_000, killSignal: 'SIGKILL' });
  assert.equal(r.status, 1, `exit ${r.status} ${r.signal ?? ''}\n${r.stdout}`);
  assert.match(r.stdout, /FAIL \(fatal\)/);
});

let chrome = true; try { chromePath(); } catch { chrome = false; }
const e2e = process.env.WORCA_PARITY_E2E === '1' && chrome;
const skip = !e2e && 'set WORCA_PARITY_E2E=1 (and have Chrome) to run the browser self-run';

test('dev against itself: 0 route, visual and flow differences; 18 shots; signed-out complete; no leaked values', { skip, timeout: 900_000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'parity-out-'));
  const code = await main(['run', '--a', 'tree:.', '--b', 'tree:.', '--out', out, '--quick'], { log: () => {} });
  const r = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.deepEqual([r.routeDiffs.length, r.visualDiffs.length, r.failedFlows.length, r.signedOutProblems.length, r.problems.length], [0, 0, 0, 0, 0]);
  assert.equal(code, 0);   // --quick: timings reported, not gated, so 0 means every other gate passed
  for (const side of ['a', 'b']) {
    const s = JSON.parse(readFileSync(join(out, side, 'snapshot.json'), 'utf8'));
    assert.equal(s.shots.length, 18);
    for (const shot of s.shots) assert.ok(existsSync(shot.file), shot.file);
    assert.ok(s.routes.signedIn.length >= 400, `${s.routes.signedIn.length} signed-in rows`);
    assert.equal(s.routes.signedOut.length, s.routes.signedIn.length);
    assert.equal(s.routes.signedOut.filter((x) => x.status !== 401).length, 2);
    assert.equal(readFileSync(join(out, side, 'snapshot.json'), 'utf8').includes('parity thread'), false, 'seeded title leaked');
  }
});

/** A copy of this tree (node_modules linked) with one edit; `edit(copyRoot)` changes one file. */
function mutatedCopy(edit) {
  const copy = mkdtempSync(join(tmpdir(), 'parity-mut-'));
  cpSync(ROOT, copy, { recursive: true, filter: (src) => !/\/(node_modules|\.git)(\/|$)/.test(src) });
  symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'), 'dir');
  edit(copy);
  return copy;
}
const edit = (file, fn) => { const s = readFileSync(file, 'utf8'); const t = fn(s); assert.notEqual(t, s, `${file} edited`); writeFileSync(file, t); };
async function runAgainst(copy) {
  const out = mkdtempSync(join(tmpdir(), 'parity-out-'));
  const code = await main(['run', '--a', 'tree:.', '--b', `tree:${copy}`, '--out', out, '--quick'], { log: () => {} });
  return { code, r: JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) };
}

// GET /api/diff-comments/counts (ui/server.mjs:7558): one literal line, called by no file under ui/public or src/shared,
// not used by boot (/api/health) or any flow, so renaming it changes the route table and nothing else.
const MUTATED_ROUTE = 'GET /api/diff-comments/counts';

test('route only: a copy tree with one route renamed reports only-in-a and only-in-b, 0 visual differences, exit 1', { skip, timeout: 900_000 }, async () => {
  const copy = mutatedCopy((c) => edit(join(c, 'ui', 'server.mjs'),
    (s) => s.replace("app.get('/api/diff-comments/counts'", "app.get('/api/parity-renamed-counts'")));
  const { code, r } = await runAgainst(copy);
  assert.equal(code, 1);
  assert.ok(r.routeDiffs.some((d) => d.kind === 'only-in-a' && d.route === MUTATED_ROUTE));
  assert.ok(r.routeDiffs.some((d) => d.kind === 'only-in-b' && d.route === 'GET /api/parity-renamed-counts'));
  assert.equal(r.routeDiffs.every((d) => [MUTATED_ROUTE, 'GET /api/parity-renamed-counts'].includes(d.route)), true);
  assert.deepEqual([r.visualDiffs.length, r.failedFlows.length], [0, 0]);
});

test('visual only: one colour on one element (the run status word) is a visual difference on History and the live run only, exit 1', { skip, timeout: 900_000 }, async () => {
  const copy = mutatedCopy((c) => edit(join(c, 'ui', 'public', 'style.css'),
    (s) => `${s}\n.run-status-word{color:#ff0000 !important}\n`));
  const { code, r } = await runAgainst(copy);
  assert.equal(code, 1);
  assert.equal(r.routeDiffs.length, 0);
  assert.ok(r.visualDiffs.length > 0);
  assert.deepEqual([...new Set(r.visualDiffs.map((v) => v.page))].sort(), ['history', 'live-run']);   // both show the run status card
  assert.ok(r.visualDiffs.every((v) => v.pixels > 0 && v.pixels < 1280 * 800 * 0.01), 'a small region, not the whole page');
});

test('CI-image parity is its own workflow, on every PR into dev and every push to dev, with no paths filter', () => {
  const wf = readFileSync(new URL('../.github/workflows/parity-docker.yml', import.meta.url), 'utf8');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(wf, /^on:\n {2}push:\n {4}branches: \[dev\]\n {2}pull_request:\n {4}branches: \[dev\]\n/m);
  assert.match(wf, /^ {4}types: \[opened, synchronize, reopened, edited\]$/m, 'a stacked PR retargeted to dev (edited) runs it too');
  assert.doesNotMatch(wf, /^\s+paths(?:-ignore)?:/m);                       // a required check must never be skipped
  assert.ok(wf.includes('npm run parity -- run --a tree:. --b docker:ghcr.io/sinishadjukic/worca:ci --out "$RUNNER_TEMP/parity-docker" --no-timing-gate'));
  assert.ok(wf.includes('npm run parity -- run --a tree:. --b package:. --out "$RUNNER_TEMP/parity-pkg" --no-timing-gate'));
  assert.ok(!ci.includes('--b docker:'), 'the docker parity runs in one place');
  const pack = (y) => y.slice(y.indexOf('      - name: Pack @worca/app'), y.indexOf('      - uses: docker/setup-buildx-action'));
  assert.ok(pack(wf).length > 100); assert.equal(pack(wf), pack(ci));      // same image inputs, same gha cache key
});
