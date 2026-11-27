// tools/quarantine.mjs and .github/workflows/quarantine.yml: the one machine-read quarantine list
// (test/quarantine.json), its check, the non-blocking runner, the pass-rate history and the job summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(ROOT, 'tools', 'quarantine.mjs');
const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
// Imported per test, so a missing module fails each case on its own instead of the whole file.
const Q = () => import('../tools/quarantine.mjs');

const KIND_MSG = 'not a test file (test/NAME.test.mjs), Playwright spec (e2e/extension/NAME.spec.mjs) or CDP proof (tools/verify-NAME-cdp.mjs)';
const ok = (path) => ({ path, reason: 'flaky under load', exitCondition: 'passes 20 quarantine runs' });
const ctx = (extra = {}) => ({ exists: () => true, tiers: { slow: ['test/orchestrator-*.test.mjs', 'test/git-sync.test.mjs'], keepFast: ['test/orchestrator-guardrails.test.mjs'] }, ...extra });

/** A fixture repo root: test/tiers.json, test/quarantine.json, a package.json and the given files. */
function fixture(entries, files = {}, scripts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worca-cc-quarantine-'));
  const put = (rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  put('test/tiers.json', JSON.stringify({ slow: [], keepFast: [] }));
  put('test/quarantine.json', JSON.stringify({ entries }));
  put('package.json', JSON.stringify({ name: 'fixture', scripts }));
  for (const [rel, body] of Object.entries(files)) put(rel, body);
  return root;
}
const cli = (args, env = {}) => spawnSync(process.execPath, [TOOL, ...args],
  { cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, GITHUB_STEP_SUMMARY: undefined, ...env } });
const PASS = "import { test } from 'node:test';\ntest('green', () => {});\n";
const FAIL = "import { test } from 'node:test';\ntest('red', () => { throw new Error('red'); });\n";

// ── the list and its check ──────────────────────────────────────────────────────────────────

test('constants: QUARANTINE_FILE is test/quarantine.json, HISTORY_MAX is 30; the shipped list parses', async () => {
  const { QUARANTINE_FILE, HISTORY_MAX, readQuarantine } = await Q();
  assert.equal(QUARANTINE_FILE, 'test/quarantine.json');
  assert.equal(HISTORY_MAX, 30);
  assert.ok(existsSync(join(ROOT, 'test', 'quarantine.json')), 'test/quarantine.json ships');
  assert.ok(Array.isArray(readQuarantine(ROOT)));
});

test('entryKind: test file, Playwright spec and CDP proof by path alone; anything else is null', async () => {
  const { entryKind } = await Q();
  assert.equal(entryKind('test/ui-ask-side-shell.test.mjs'), 'test');
  assert.equal(entryKind('e2e/extension/popup.spec.mjs'), 'spec');
  assert.equal(entryKind('tools/verify-theme-cdp.mjs'), 'proof');
  for (const p of ['test/sub/x.test.mjs', 'test/*.test.mjs', 'tools/verify-x.mjs', 'e2e/extension/sub/x.spec.mjs', 'x/test/a.test.mjs'])
    assert.equal(entryKind(p), null, p);
});

test('readQuarantine: a missing file is an empty list; bad JSON and a missing entries array throw named errors', async () => {
  const { readQuarantine } = await Q();
  const root = mkdtempSync(join(tmpdir(), 'worca-cc-quarantine-read-'));
  try {
    assert.deepEqual(readQuarantine(root), []);
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test', 'quarantine.json'), '{ nope');
    assert.throws(() => readQuarantine(root), /test\/quarantine\.json is not valid JSON/);
    writeFileSync(join(root, 'test', 'quarantine.json'), '{}');
    assert.throws(() => readQuarantine(root), /test\/quarantine\.json: "entries" must be an array/);
    writeFileSync(join(root, 'test', 'quarantine.json'), JSON.stringify({ entries: [ok('test/a.test.mjs')] }));
    assert.deepEqual(readQuarantine(root), [ok('test/a.test.mjs')]);
  } finally { rmSync(root, rmOpts); }
});

test('quarantineProblems: a clean three-kind list has none; each rule gives its one exact message', async () => {
  const { quarantineProblems } = await Q();
  assert.deepEqual(quarantineProblems([ok('test/a.test.mjs'), ok('e2e/extension/b.spec.mjs'), ok('tools/verify-c-cdp.mjs')], ctx()), []);
  // A slow GLOB match is fine (quarantine wins); only a literal slow entry is a problem.
  assert.deepEqual(quarantineProblems([ok('test/orchestrator-x.test.mjs')], ctx()), []);
  const one = (entries, c = ctx()) => quarantineProblems(entries, c);
  assert.deepEqual(one([ok('test/a.test.mjs'), { reason: 'r', exitCondition: 'e' }]), ['entry 2: no path']);
  assert.deepEqual(one([ok('tools/verify-x.mjs')]), [`tools/verify-x.mjs: ${KIND_MSG}`]);
  assert.deepEqual(one([ok('test/gone.test.mjs')], ctx({ exists: () => false })), ['test/gone.test.mjs: no such file']);
  assert.deepEqual(one([{ path: 'test/a.test.mjs', reason: '   ', exitCondition: 'e' }]), ['test/a.test.mjs: no reason']);
  assert.deepEqual(one([{ path: 'test/a.test.mjs', reason: 'r' }]), ['test/a.test.mjs: no exitCondition']);
  assert.deepEqual(one([{ ...ok('test/a.test.mjs'), note: 'x' }]), ['test/a.test.mjs: unknown key "note" (allowed: path, reason, exitCondition)']);
  assert.deepEqual(one([ok('test/a.test.mjs'), ok('test/a.test.mjs')]), ['test/a.test.mjs: listed twice']);
  assert.deepEqual(one([ok('test/orchestrator-guardrails.test.mjs')]), ['test/orchestrator-guardrails.test.mjs: also in test/tiers.json keepFast']);
  assert.deepEqual(one([ok('test/git-sync.test.mjs')]), ['test/git-sync.test.mjs: also a slow entry in test/tiers.json (remove it there)']);
});

test('quarantinedPaths: the paths of one kind, or of every kind', async () => {
  const { quarantinedPaths } = await Q();
  const list = [ok('test/a.test.mjs'), ok('e2e/extension/b.spec.mjs'), ok('tools/verify-c-cdp.mjs')];
  assert.deepEqual([...quarantinedPaths(list, 'test')], ['test/a.test.mjs']);
  assert.deepEqual([...quarantinedPaths(list, 'spec')], ['e2e/extension/b.spec.mjs']);
  assert.deepEqual([...quarantinedPaths(list, 'proof')], ['tools/verify-c-cdp.mjs']);
  assert.deepEqual([...quarantinedPaths(list)].sort(), list.map((e) => e.path).sort());
});

// ── browser entries leave their blocking jobs ───────────────────────────────────────────────

test('proofScriptPath: verify:theme maps to its proof script in the real package.json; an unknown name is null', async () => {
  const { proofScriptPath } = await Q();
  const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(proofScriptPath(scripts, 'verify:theme'), 'tools/verify-theme-cdp.mjs');
  assert.equal(proofScriptPath(scripts, 'verify:no-such-proof'), null);
});

test('skips-proof: exits 0 for a quarantined proof and 1 for one that is not (the cdp loop then runs it)', () => {
  const scripts = {
    'verify:theme': 'node --disable-warning=ExperimentalWarning tools/verify-theme-cdp.mjs',
    'verify:composer': 'node --disable-warning=ExperimentalWarning tools/verify-composer-cdp.mjs',
  };
  const root = fixture([ok('tools/verify-theme-cdp.mjs')],
    { 'tools/verify-theme-cdp.mjs': '', 'tools/verify-composer-cdp.mjs': '' }, scripts);
  try {
    const listed = cli(['skips-proof', 'verify:theme', '--root', root]);
    assert.equal(listed.status, 0, listed.stdout + listed.stderr);
    assert.match(listed.stdout, /verify:theme is quarantined \(test\/quarantine\.json\): it runs in the Quarantined tests workflow/);
    const other = cli(['skips-proof', 'verify:composer', '--root', root]);
    assert.equal(other.status, 1, other.stdout + other.stderr);
  } finally { rmSync(root, rmOpts); }
});

test('specIgnores: one anchored RegExp per spec entry, matching that spec\'s absolute path only; none under WORCA_QUARANTINE_RUN=1', async () => {
  const { specIgnores } = await Q();
  const root = fixture([ok('e2e/extension/flaky.spec.mjs'), ok('test/a.test.mjs')],
    { 'e2e/extension/flaky.spec.mjs': '', 'e2e/extension/steady.spec.mjs': '', 'test/a.test.mjs': '' });
  try {
    const res = specIgnores(root, {});
    assert.equal(res.length, 1);
    assert.ok(res[0] instanceof RegExp);
    assert.ok(res[0].test(join(root, 'e2e/extension/flaky.spec.mjs')));
    assert.ok(!res[0].test(join(root, 'e2e/extension/steady.spec.mjs')));
    assert.ok(!res[0].test(join(root, 'e2e/extension/flaky.spec.mjs') + '.bak'), 'anchored at the end');
    assert.deepEqual(specIgnores(root, { WORCA_QUARANTINE_RUN: '1' }), []);
  } finally { rmSync(root, rmOpts); }
});

test('the extension Playwright config takes testIgnore from the quarantine list', async () => {
  const { readQuarantine, quarantinedPaths } = await Q();
  const cfg = (await import(pathToFileURL(join(ROOT, 'e2e/extension/playwright.config.mjs')).href)).default;
  assert.ok(Array.isArray(cfg.testIgnore), `testIgnore: ${cfg.testIgnore}`);
  assert.equal(cfg.testIgnore.length, quarantinedPaths(readQuarantine(ROOT), 'spec').size);
});

test('ci.yml cdp loop asks skips-proof before it runs each proof', () => {
  const ci = YAML.parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
  const step = ci.jobs.cdp.steps.find((s) => s.name === 'Headless-Chrome UI proofs');
  const run = String(step?.run || '');
  const skip = run.indexOf('node tools/quarantine.mjs skips-proof "$proof"');
  assert.ok(skip >= 0, run);
  assert.ok(skip < run.indexOf('npm run "$proof"'), 'the skip check comes before npm run');
});

// ── history, pass rates and the summary ─────────────────────────────────────────────────────

const rec = (i, results) => ({ runId: String(i), at: `2026-11-${String((i % 28) + 1).padStart(2, '0')}T03:00:00Z`, sha: `s${i}`, event: 'schedule', results });

test('mergeHistory: appends the record, keeps the newest 30 oldest first, and treats a bad history as empty', async () => {
  const { mergeHistory } = await Q();
  let h = null;
  for (let i = 1; i <= 31; i++) h = mergeHistory(h, rec(i, {}));
  assert.equal(h.version, 1);
  assert.equal(h.runs.length, 30);
  assert.deepEqual(h.runs.map((r) => r.runId), Array.from({ length: 30 }, (_, i) => String(i + 2)));
  for (const bad of [null, undefined, 'x', { runs: 'x' }, { version: 1 }]) assert.deepEqual(mergeHistory(bad, rec(9, {})), { version: 1, runs: [rec(9, {})] });
  assert.equal(mergeHistory({ version: 1, runs: [rec(1, {}), rec(2, {})] }, rec(3, {}), 2).runs.map((r) => r.runId).join(), '2,3');
});

test('unionHistories: two diverged sibling histories keep their shared parent once and both distinct runs, sorted by at', async () => {
  const { unionHistories } = await Q();
  const parent = rec(1, { 'test/a.test.mjs': 'pass' });
  const left = { version: 1, runs: [parent, rec(3, { 'test/a.test.mjs': 'fail' })] };
  const right = { version: 1, runs: [parent, rec(2, { 'test/a.test.mjs': 'pass' })] };
  const u = unionHistories([left, right]);
  assert.equal(u.version, 1);
  assert.deepEqual(u.runs.map((r) => r.runId), ['1', '2', '3']);
  // A bad history counts as empty; none at all is an empty history.
  assert.deepEqual(unionHistories([null, 'x', { runs: 'x' }, right]).runs.map((r) => r.runId), ['1', '2']);
  assert.deepEqual(unionHistories([]), { version: 1, runs: [] });
});

test('passRates: passes over runs in which the entry ran; not run counts in neither', async () => {
  const { passRates } = await Q();
  const runs = [
    ...Array.from({ length: 9 }, (_, i) => rec(i, { 'test/a.test.mjs': 'pass' })),
    rec(9, { 'test/a.test.mjs': 'fail' }),
    rec(10, { 'test/a.test.mjs': 'not run' }),
    rec(11, {}),
  ];
  assert.deepEqual(passRates({ version: 1, runs }, ['test/a.test.mjs', 'test/b.test.mjs']),
    { 'test/a.test.mjs': { passed: 9, ran: 10 }, 'test/b.test.mjs': { passed: 0, ran: 0 } });
});

test('renderQuarantineSummary: one row per entry in list order, rates, no runs yet, the empty text and escaped pipes', async () => {
  const { renderQuarantineSummary } = await Q();
  const entries = [{ path: 'test/b.test.mjs', reason: 'a | b', exitCondition: 'c | d' }, ok('test/a.test.mjs')];
  const md = renderQuarantineSummary({
    entries,
    results: { 'test/b.test.mjs': 'pass', 'test/a.test.mjs': 'fail' },
    rates: { 'test/b.test.mjs': { passed: 9, ran: 10 }, 'test/a.test.mjs': { passed: 0, ran: 0 } },
    window: 30,
  });
  assert.match(md, /^## Quarantined tests$/m);
  assert.match(md, /^\| Entry \| This run \| Pass rate \(last 30 runs\) \| Reason \| Exit condition \|$/m);
  const rows = md.split('\n').filter((l) => /test\/[ab]\.test\.mjs/.test(l));
  assert.equal(rows.length, 2, md);
  assert.ok(rows[0].includes('test/b.test.mjs') && rows[1].includes('test/a.test.mjs'), 'list order');
  assert.ok(rows[0].includes('9/10 (90%)') && rows[0].includes('pass'), rows[0]);
  assert.ok(rows[1].includes('no runs yet') && rows[1].includes('fail'), rows[1]);
  assert.ok(rows[0].includes('a \\| b') && rows[0].includes('c \\| d'), rows[0]);
  const empty = renderQuarantineSummary({ entries: [], results: {}, rates: {}, window: 30 });
  assert.match(empty, /^## Quarantined tests$/m);
  assert.match(empty, /No quarantined entries\./);
});

// ── the CLI end to end on a fixture root ────────────────────────────────────────────────────

test('run and report end to end: a passing and a failing entry, exit 0, 3/3 and 0/1 rates, the history holds 3 runs', () => {
  const root = fixture([ok('test/pass.test.mjs'), ok('test/fail.test.mjs')], { 'test/pass.test.mjs': PASS, 'test/fail.test.mjs': FAIL });
  const work = mkdtempSync(join(tmpdir(), 'worca-cc-quarantine-work-'));
  try {
    const list = cli(['list', '--kind', 'test', '--root', root]);
    assert.equal(list.status, 0, list.stderr);
    assert.deepEqual(list.stdout.trim().split('\n').sort(), ['test/fail.test.mjs', 'test/pass.test.mjs']);

    const out = join(work, 'results-tests.json');
    const r = cli(['run', '--kind', 'test', '--out', out, '--root', root]);
    assert.equal(r.status, 0, 'a failing entry never fails the tool\n' + r.stdout + r.stderr);
    const results = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(results['test/pass.test.mjs'].result, 'pass', JSON.stringify(results));
    assert.equal(results['test/fail.test.mjs'].result, 'fail', JSON.stringify(results));
    assert.equal(typeof results['test/pass.test.mjs'].seconds, 'number');

    const hin = join(work, 'qh');
    mkdirSync(hin);
    writeFileSync(join(hin, 'quarantine-history.json'), JSON.stringify({ version: 1, runs: [rec(1, { 'test/pass.test.mjs': 'pass' }), rec(2, { 'test/pass.test.mjs': 'pass' })] }));
    const hout = join(work, 'quarantine-history.json');
    const summary = join(work, 'summary.md');
    writeFileSync(summary, '');
    const rep = cli(['report', '--results', out, '--history-in', hin, '--history-out', hout, '--run-id', '3', '--sha', 'abc', '--event', 'push', '--root', root],
      { GITHUB_STEP_SUMMARY: summary });
    assert.equal(rep.status, 0, rep.stdout + rep.stderr);
    const passRow = rep.stdout.split('\n').find((l) => l.includes('test/pass.test.mjs'));
    const failRow = rep.stdout.split('\n').find((l) => l.includes('test/fail.test.mjs'));
    assert.ok(passRow?.includes('3/3 (100%)'), rep.stdout);
    assert.ok(failRow?.includes('0/1 (0%)'), rep.stdout);
    const history = JSON.parse(readFileSync(hout, 'utf8'));
    assert.equal(history.runs.length, 3);
    assert.deepEqual(history.runs[2].results, { 'test/pass.test.mjs': 'pass', 'test/fail.test.mjs': 'fail' });
    assert.equal(history.runs[2].runId, '3');
    const written = readFileSync(summary, 'utf8');
    assert.match(written, /## Quarantined tests/);
    assert.ok(written.includes('3/3 (100%)') && written.includes('0/1 (0%)'), written);
  } finally { rmSync(root, rmOpts); rmSync(work, rmOpts); }
});

test('report: a spec entry with no spec results file reads not run, and its counts stay the seeded history\'s', () => {
  const root = fixture([ok('test/pass.test.mjs'), ok('e2e/extension/flaky.spec.mjs')], { 'test/pass.test.mjs': PASS, 'e2e/extension/flaky.spec.mjs': '' });
  const work = mkdtempSync(join(tmpdir(), 'worca-cc-quarantine-notrun-'));
  try {
    const out = join(work, 'results-tests.json');
    writeFileSync(out, JSON.stringify({ 'test/pass.test.mjs': { result: 'pass', seconds: 1 } }));
    const hin = join(work, 'qh');
    mkdirSync(hin);
    const spec = 'e2e/extension/flaky.spec.mjs';
    writeFileSync(join(hin, 'quarantine-history.json'), JSON.stringify({ version: 1, runs: [rec(1, { [spec]: 'pass' }), rec(2, { [spec]: 'fail' })] }));
    const rep = cli(['report', '--results', out, '--history-in', hin, '--history-out', join(work, 'h.json'), '--run-id', '3', '--sha', 'abc', '--event', 'schedule', '--root', root]);
    assert.equal(rep.status, 0, rep.stdout + rep.stderr);
    const row = rep.stdout.split('\n').find((l) => l.includes('flaky.spec.mjs'));
    assert.ok(row?.includes('not run'), rep.stdout);
    assert.ok(row.includes('1/2 (50%)'), row);
    assert.equal(JSON.parse(readFileSync(join(work, 'h.json'), 'utf8')).runs[2].results[spec], 'not run');
  } finally { rmSync(root, rmOpts); rmSync(work, rmOpts); }
});

test('report: overlapping runs lose no record: histories in per-run folders of --history-in are unioned by runId', () => {
  const root = fixture([ok('test/pass.test.mjs')], { 'test/pass.test.mjs': PASS });
  const work = mkdtempSync(join(tmpdir(), 'worca-cc-quarantine-union-'));
  try {
    const out = join(work, 'results-tests.json');
    writeFileSync(out, JSON.stringify({ 'test/pass.test.mjs': { result: 'pass', seconds: 1 } }));
    const hin = join(work, 'qh');
    const p = 'test/pass.test.mjs';
    for (const [id, runs] of [['301', [rec(1, { [p]: 'pass' }), rec(3, { [p]: 'fail' })]], ['302', [rec(1, { [p]: 'pass' }), rec(2, { [p]: 'pass' })]]]) {
      mkdirSync(join(hin, id), { recursive: true });
      writeFileSync(join(hin, id, 'quarantine-history.json'), JSON.stringify({ version: 1, runs }));
    }
    const hout = join(work, 'h.json');
    const rep = cli(['report', '--results', out, '--history-in', hin, '--history-out', hout, '--run-id', '9', '--sha', 'abc', '--event', 'push', '--root', root]);
    assert.equal(rep.status, 0, rep.stdout + rep.stderr);
    assert.deepEqual(JSON.parse(readFileSync(hout, 'utf8')).runs.map((r) => r.runId), ['1', '2', '3', '9']);
    assert.ok(rep.stdout.split('\n').find((l) => l.includes(p))?.includes('3/4 (75%)'), rep.stdout);
  } finally { rmSync(root, rmOpts); rmSync(work, rmOpts); }
});

test('an invalid list makes run and report exit 2 with the problem on stderr; an unknown command exits 2', () => {
  const root = fixture([{ path: 'test/a.test.mjs', exitCondition: 'e' }], { 'test/a.test.mjs': PASS });
  const work = mkdtempSync(join(tmpdir(), 'worca-cc-quarantine-bad-'));
  try {
    const run = cli(['run', '--kind', 'test', '--out', join(work, 'r.json'), '--root', root]);
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stderr, /test\/a\.test\.mjs: no reason/);
    const rep = cli(['report', '--results', join(work, 'r.json'), '--history-in', work, '--history-out', join(work, 'h.json'), '--run-id', '1', '--sha', 'a', '--event', 'push', '--root', root]);
    assert.equal(rep.status, 2, rep.stdout + rep.stderr);
    assert.match(rep.stderr, /test\/a\.test\.mjs: no reason/);
    assert.equal(cli(['frobnicate']).status, 2);
  } finally { rmSync(root, rmOpts); rmSync(work, rmOpts); }
});

// ── the workflow ────────────────────────────────────────────────────────────────────────────

const wfText = () => readFileSync(join(ROOT, '.github/workflows/quarantine.yml'), 'utf8');

test('quarantine.yml: dev push, nightly and manual dispatch, never pull_request, no concurrency group', () => {
  const wf = YAML.parse(wfText());
  assert.equal(wf.name, 'Quarantined tests');
  assert.deepEqual(Object.keys(wf.on).sort(), ['push', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(wf.on.push.branches, ['dev']);
  assert.deepEqual(wf.on.schedule, [{ cron: '0 3 * * *' }]);
  assert.equal(wf.concurrency, undefined, 'a shared group would cancel a pending run on dev');
  assert.deepEqual(wf.permissions, { contents: 'read' });
});

test('quarantine.yml: the tail measure job runs the fast tier with --measure-tails, needs nothing, never blocks, and writes the tails to the job summary', () => {
  const wf = YAML.parse(wfText());
  const job = wf.jobs['tail-measure'];
  assert.ok(job, 'job tail-measure');
  assert.equal(job.name, 'tail measure');
  assert.equal(job.needs, undefined);
  assert.equal(job['continue-on-error'], true);
  assert.equal(job.if, "${{ github.event_name != 'push' }}", 'never on a dev push: it holds a runner for up to 90 min');
  assert.equal(job.env?.WORCA_SUITE_GUARD_BASE, 'none', 'the fast tier holds the suite guard test, which needs a base or none');
  const runs = job.steps.map((s) => String(s.run || '')).join('\n');
  assert.ok(runs.includes('npm run test:fast -- --measure-tails'), runs);
  assert.ok(runs.includes('$GITHUB_STEP_SUMMARY'), runs);
  assert.equal(wf.jobs['quarantined-tests']['timeout-minutes'], 90);
});

test('quarantine.yml: the quarantined tests job runs after the spec job unless cancelled, reads actions, runs every kind and keeps the history', async () => {
  const { HISTORY_MAX } = await Q();
  const wf = YAML.parse(wfText());
  const specs = wf.jobs['quarantined-specs'];
  assert.ok(specs, 'job quarantined-specs');
  assert.match(String(specs.container?.image || ''), /^mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}$/);
  assert.ok(String(specs.steps.map((s) => s.run || '').join('\n')).includes('tools/quarantine.mjs list --kind spec'));
  assert.ok(specs.steps.some((s) => String(s.uses || '').startsWith('actions/upload-artifact@') && s.with?.name === 'quarantine-results-specs'));

  const job = wf.jobs['quarantined-tests'];
  assert.ok(job, 'job quarantined-tests');
  assert.equal(job.name, 'quarantined tests');
  assert.equal(job.if, '${{ !cancelled() }}');
  assert.deepEqual([].concat(job.needs), ['quarantined-specs']);
  assert.equal(job.permissions?.actions, 'read');
  assert.equal(job['timeout-minutes'], 90);
  const runs = job.steps.map((s) => String(s.run || '')).join('\n');
  for (const cmd of ['tools/quarantine.mjs run --kind test', 'tools/quarantine.mjs run --kind proof', 'tools/quarantine.mjs report'])
    assert.ok(runs.includes(cmd), cmd);
  assert.ok(runs.includes('gh run download'), 'the previous history is fetched');
  const fetch = job.steps.find((s) => s.name === 'Fetch the pass-rate history');
  assert.ok(!/\bbreak\b/.test(fetch.run), 'every recent history is fetched, not only the newest (overlapping runs)');
  assert.match(fetch.run, /-D "\$RUNNER_TEMP\/qh\/\$id"/, 'each run\'s history lands in its own folder');
  const limit = Number((fetch.run.match(/gh run list\b[^\n]*?\s-L\s+(\d+)/) || [])[1]);
  assert.ok(limit >= HISTORY_MAX, `the fetch looks back at least HISTORY_MAX (${HISTORY_MAX}) runs, got -L ${limit}`);
  const up = job.steps.find((s) => String(s.uses || '').startsWith('actions/upload-artifact@') && s.with?.name === 'quarantine-history');
  assert.ok(up, 'uploads quarantine-history');
  assert.equal(Number(up.with['retention-days']), 90);
  assert.ok(!/continue-on-error/.test(JSON.stringify(job.steps.filter((s) => String(s.run || '').includes('quarantine.mjs report')))),
    'a broken report tool turns the run red');
});

test('ci.yml holds no quarantine job, and the CI gate does not need one', () => {
  const ci = YAML.parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
  for (const [id, j] of Object.entries(ci.jobs)) {
    assert.notEqual(j.name, 'quarantined tests', id);
    assert.ok(!/quarantine/.test(id), id);
  }
  assert.ok(![].concat(ci.jobs['ci-gate'].needs || []).some((n) => /quarantine/.test(n)));
});

test('run --kind proof runs each listed proof and report shows its pass rate', () => {
  const root = fixture([ok('tools/verify-ok-cdp.mjs'), ok('tools/verify-bad-cdp.mjs')], { 'tools/verify-ok-cdp.mjs': 'process.exit(0);\n', 'tools/verify-bad-cdp.mjs': 'process.exit(1);\n' });
  const work = mkdtempSync(join(tmpdir(), 'worca-cc-quarantine-proof-'));
  try {
    const out = join(work, 'results-proofs.json');
    const r = cli(['run', '--kind', 'proof', '--out', out, '--root', root]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const results = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(results['tools/verify-ok-cdp.mjs'].result, 'pass', JSON.stringify(results));
    assert.equal(results['tools/verify-bad-cdp.mjs'].result, 'fail', JSON.stringify(results));
    assert.equal(typeof results['tools/verify-ok-cdp.mjs'].seconds, 'number');
    const hin = join(work, 'qh');
    mkdirSync(hin);
    const rep = cli(['report', '--results', out, '--history-in', hin, '--history-out', join(work, 'h.json'), '--run-id', '1', '--sha', 'abc', '--event', 'push', '--root', root]);
    assert.equal(rep.status, 0, rep.stdout + rep.stderr);
    const okRow = rep.stdout.split('\n').find((l) => l.includes('verify-ok-cdp.mjs'));
    const badRow = rep.stdout.split('\n').find((l) => l.includes('verify-bad-cdp.mjs'));
    assert.ok(okRow?.includes('1/1 (100%)'), rep.stdout);
    assert.ok(badRow?.includes('0/1 (0%)'), rep.stdout);
  } finally { rmSync(root, rmOpts); rmSync(work, rmOpts); }
});
