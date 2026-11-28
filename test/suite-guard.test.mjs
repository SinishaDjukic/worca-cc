// test/suite-guard.test.mjs — the suite regression guard: a new test file may not boot ui/public/app.js inside
// each test, nor cost more than 20 s (test/timings.json), and today's per-test-boot files sit on a shrink-only list.
// Rule tests on in-memory fixtures first, then the live check on this tree (the style of test/issue-number-names.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUDGET_S, LIST_FILE, helperBoots, classify, checkSuite, resolveBase, readRepo } from '../tools/suite-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ── fixtures ────────────────────────────────────────────────────────────────
const HEAD = [
  "import { test, it, describe, before, beforeEach } from 'node:test';",
  "import { fileURLToPath, pathToFileURL } from 'node:url';",
  "const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));",
].join('\n');
const BOOT = 'await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);';

// A file whose n tests each boot app.js directly.
const perTest = (n) => HEAD + '\n' + Array.from({ length: n }, (_, i) => `test('t${i}', async () => { ${BOOT} });`).join('\n');
// A file that boots once for every test (the s13 target shape).
const sharedBoot = HEAD + `\nbefore(async () => { ${BOOT} });\n` + Array.from({ length: 5 }, (_, i) => `test('t${i}', () => {});`).join('\n');

const HELPERS = new Map([
  ['test/helpers/run-page-boot.mjs', [
    "import { fileURLToPath, pathToFileURL } from 'node:url';",
    "const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));",
    'export async function bootApp() { ' + BOOT + ' return {}; }',
    'export const helloRun = (ctx) => ctx;',
  ].join('\n')],
  ['test/helpers/chat-panel-boot.mjs', [
    "import { fileURLToPath, pathToFileURL } from 'node:url';",
    "const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));",
    'export const ok = (body) => Promise.resolve({ ok: true, json: async () => body });',
    'export const bootChat = async (opts) => { ' + BOOT + ' return opts; };',
  ].join('\n')],
  // A helper that wraps another helper's boot (as test/helpers/chat-links-boot.mjs does).
  ['test/helpers/chat-links-boot.mjs', [
    "import { bootChat, ok } from './chat-panel-boot.mjs';",
    'export const PK = "app-0000aaaa";',
    'export async function boot(opts = {}) { return bootChat({ ...opts, arms: () => ok({}) }); }',
  ].join('\n')],
  // A helper that only re-exports another helper's boot.
  ['test/helpers/chat-reexport-boot.mjs', "export { bootChat } from './chat-panel-boot.mjs';"],
  // A helper that imports another module with a cache-bust query: not a boot.
  ['test/helpers/models-view-boot.mjs', [
    "import { pathToFileURL } from 'node:url';",
    "export async function loadView(p) { return import(pathToFileURL(p + '/ui/public/models-view.mjs').href + `?b=${Date.now()}`); }",
  ].join('\n')],
]);

const boots = () => helperBoots(HELPERS);
const cls = (src, path = 'test/ui-fixture.test.mjs') => classify(path, src, boots());

// ── classifier: helperBoots ─────────────────────────────────────────────────
test('BUDGET_S is 20 s and the list lives in test/suite-guard-offenders.json', () => {
  assert.equal(BUDGET_S, 20);
  assert.equal(LIST_FILE, 'test/suite-guard-offenders.json');
});

test('helperBoots: a helper export holding a cache-busted app.js import boots; its other exports do not', () => {
  const b = boots();
  assert.ok(b.get('test/helpers/run-page-boot.mjs')?.has('bootApp'));
  assert.equal(b.get('test/helpers/run-page-boot.mjs').has('helloRun'), false);
  assert.ok(b.get('test/helpers/chat-panel-boot.mjs')?.has('bootChat'));
  assert.equal(b.get('test/helpers/chat-panel-boot.mjs').has('ok'), false);
});

test('helperBoots: a helper wrapping another helper\'s boot, or re-exporting it, boots too (fixed point)', () => {
  const b = boots();
  assert.ok(b.get('test/helpers/chat-links-boot.mjs')?.has('boot'));
  assert.equal(b.get('test/helpers/chat-links-boot.mjs').has('PK'), false);
  assert.ok(b.get('test/helpers/chat-reexport-boot.mjs')?.has('bootChat'));
  assert.equal(b.get('test/helpers/models-view-boot.mjs')?.has('loadView') ?? false, false);
});

// ── classifier: classify ────────────────────────────────────────────────────
test('classify: 3 tests that each import app.js through appPath with ?b= offend, bootingTests 3', () => {
  assert.deepEqual(cls(perTest(3)), { offends: true, bootingTests: 3 });
});

test('classify: 2 tests calling bootApp from ./helpers/run-page-boot.mjs offend', () => {
  const src = "import { test } from 'node:test';\nimport { bootApp } from './helpers/run-page-boot.mjs';\n" +
    "test('a', async () => { await bootApp(); });\ntest('b', async () => { await bootApp(); });";
  assert.equal(cls(src).offends, true);
});

test('classify: 2 tests calling a helper that wraps another helper\'s boot offend (chat-links-boot shape)', () => {
  const src = "import { test } from 'node:test';\nimport { boot } from './helpers/chat-links-boot.mjs';\n" +
    "test('a', async () => { await boot(); });\ntest('b', async () => { await boot({ url: 'x' }); });";
  assert.equal(cls(src).offends, true);
});

test('classify: a re-exported boot used in 2 tests offends', () => {
  const src = "import { test } from 'node:test';\nimport { bootChat } from './helpers/chat-reexport-boot.mjs';\n" +
    "test('a', async () => { await bootChat(); });\ntest('b', async () => { await bootChat(); });";
  assert.equal(cls(src).offends, true);
});

test('classify: a local setup() wrapper around bootApp, called from 2 tests, offends', () => {
  const src = "import { test } from 'node:test';\nimport { bootApp } from './helpers/run-page-boot.mjs';\n" +
    'async function setup() { const ctx = await bootApp(); return ctx; }\n' +
    "test('a', async () => { await setup(); });\ntest('b', async () => { await setup(); });";
  assert.equal(cls(src).offends, true);
});

test('classify: a renamed import { bootApp as boot } called from 2 tests offends', () => {
  const src = "import { test } from 'node:test';\nimport { bootApp as boot } from './helpers/run-page-boot.mjs';\n" +
    "test('a', async () => { await boot(); });\ntest('b', async () => { await boot(); });";
  assert.equal(cls(src).offends, true);
});

test('classify: a local const boot = async () => … (ui-running-detail shape) called from 2 it() calls offends', () => {
  const src = HEAD + `\nconst boot = async () => { ${BOOT} };\n` +
    "describe('d', () => { it('a', async () => { await boot(); }); it('b', async () => { await boot(); }); });";
  assert.equal(cls(src).offends, true);
});

test('classify: .only/.skip variants and t.test subtests count as tests', () => {
  const variants = HEAD + `\ntest.skip('a', async () => { ${BOOT} });\ntest.only('b', async () => { ${BOOT} });`;
  assert.equal(cls(variants).offends, true);
  const subtests = HEAD + `\ntest('outer', async (t) => {\n  await t.test('a', async () => { ${BOOT} });\n  await t.test('b', async () => { ${BOOT} });\n});`;
  assert.equal(cls(subtests).offends, true);
});

test('classify: a boot in beforeEach offends even with 1 test', () => {
  const src = HEAD + `\nbeforeEach(async () => { ${BOOT} });\ntest('only one', () => {});`;
  assert.equal(cls(src).offends, true);
});

test('classify: test() calls generated in a for…of loop, or an array-method callback, whose callback boots offend', () => {
  const loop = HEAD + `\nfor (const n of ['a', 'b']) {\n  test(n, async () => { ${BOOT} });\n}`;
  assert.equal(cls(loop).offends, true);
  const each = HEAD + `\n['a', 'b'].forEach((n) => test(n, async () => { ${BOOT} }));`;
  assert.equal(cls(each).offends, true);
});

test('classify: a local test factory holding one booting test(), called 3 times, offends', () => {
  const src = HEAD + `\nfunction cases(name) {\n  test(name, async () => { ${BOOT} });\n}\ncases('a');\ncases('b');\ncases('c');`;
  assert.equal(cls(src).offends, true);
});

test('classify: one boot in before() shared by 5 tests does not offend (the s13 shape)', () => {
  assert.equal(cls(sharedBoot).offends, false);
});

test('classify: a file with a single booting test does not offend', () => {
  assert.equal(cls(perTest(1)).offends, false);
});

test('classify: a static top-level import of app.js does not offend', () => {
  const src = "import { test } from 'node:test';\nimport '../ui/public/app.js';\ntest('a', () => {});\ntest('b', () => {});";
  assert.equal(cls(src).offends, false);
});

test('classify: a cache-busted dynamic import of another module (models-view.mjs?b=…) does not offend', () => {
  const src = "import { test } from 'node:test';\nimport { pathToFileURL } from 'node:url';\n" +
    "const p = '/x/ui/public/models-view.mjs';\n" +
    "test('a', async () => { await import(pathToFileURL(p).href + `?b=${Math.random()}`); });\n" +
    "test('b', async () => { await import(pathToFileURL(p).href + `?b=${Math.random()}`); });";
  assert.equal(cls(src).offends, false);
  const viaHelper = "import { test } from 'node:test';\nimport { loadView } from './helpers/models-view-boot.mjs';\n" +
    "test('a', async () => { await loadView('/x'); });\ntest('b', async () => { await loadView('/x'); });";
  assert.equal(cls(viaHelper).offends, false);
});

test('classify: unparsable source returns { error }', () => {
  const r = cls("import { test } from 'node:test';\ntest('a', () => { ");
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.length > 0);
});

// ── rules: checkSuite ───────────────────────────────────────────────────────
const L1 = 'test/ui-listed-a.test.mjs';
const L2 = 'test/ui-listed-b.test.mjs';
const OK = 'test/plain.test.mjs';
const list = (...files) => ({ about: 'Per-test app.js boots; shrink-only.', perTestBoot: files });
// A clean tree: two listed offenders and one plain file, all present at the base.
const suite = ({ files = {}, timings = {}, headList = list(L1, L2), base } = {}) => checkSuite({
  files: new Map(Object.entries({ [L1]: perTest(2), [L2]: perTest(3), [OK]: "import { test } from 'node:test';\ntest('a', () => {});", ...files })),
  boots: boots(),
  timings,
  list: headList,
  base: base === undefined ? { ref: 'abc1234', files: new Set([L1, L2, OK]), list: list(L1, L2) } : base,
});

test('checkSuite: a clean tree returns no problem', () => {
  assert.deepEqual(suite(), []);
});

test('A1 (R-qa-3): a new test/ui-new-thing.test.mjs that boots app.js in each test, not listed, fails naming the file', () => {
  const problems = suite({ files: { 'test/ui-new-thing.test.mjs': perTest(3) } });
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^test\/ui-new-thing\.test\.mjs boots ui\/public\/app\.js inside each test/);
});

test('A2 (R-qa-3): a new file timed at 25 s fails; untimed, or timed exactly 20 s, passes; an existing file at 25 s passes', () => {
  const NEW = 'test/slow-new.test.mjs';
  const src = "import { test } from 'node:test';\ntest('a', () => {});";
  const over = suite({ files: { [NEW]: src }, timings: { [NEW]: 25 } });
  assert.equal(over.length, 1, over.join('\n'));
  assert.match(over[0], /test\/slow-new\.test\.mjs is a new test file timed at 25 s/);
  assert.deepEqual(suite({ files: { [NEW]: src } }), []);
  assert.deepEqual(suite({ files: { [NEW]: src }, timings: { [NEW]: 20 } }), []);
  assert.deepEqual(suite({ timings: { [OK]: 25 } }), []);
});

test('A2: a new file the prefilter skipped (source null) is still judged by the time rule', () => {
  const NEW = 'test/slow-skipped.test.mjs';
  const problems = suite({ files: { [NEW]: null }, timings: { [NEW]: 25 } });
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /test\/slow-skipped\.test\.mjs is a new test file timed at 25 s/);
});

test('A3 (R-qa-3): removing an offender list entry passes; adding one fails', () => {
  // L2 converted to one boot in before() and taken off the list.
  assert.deepEqual(suite({ files: { [L2]: sharedBoot }, headList: list(L1) }), []);
  const NEW = 'test/ui-new-thing.test.mjs';
  const added = suite({ files: { [NEW]: perTest(2) }, headList: list(L1, L2, NEW) });
  assert.equal(added.length, 1, added.join('\n'));
  assert.match(added[0], /^test\/ui-new-thing\.test\.mjs was added to test\/suite-guard-offenders\.json/);
  assert.match(added[0], /abc1234/);
});

test('checkSuite: a listed file that no longer boots per test must leave the list', () => {
  const problems = suite({ files: { [L2]: sharedBoot } });
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^test\/ui-listed-b\.test\.mjs is on test\/suite-guard-offenders\.json but no longer boots app\.js per test: remove it from the list/);
});

test('checkSuite: a listed file that is gone returns "no longer exists"', () => {
  const problems = checkSuite({
    files: new Map([[L1, perTest(2)]]), boots: boots(), timings: {}, list: list(L1, L2),
    base: { ref: 'abc1234', files: new Set([L1, L2]), list: list(L1, L2) },
  });
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^test\/ui-listed-b\.test\.mjs .*no longer exists: remove it from the list/);
});

test('checkSuite: renaming a listed offender fails: the file must be converted first', () => {
  const RENAMED = 'test/ui-listed-c.test.mjs';
  const base = { ref: 'abc1234', files: new Set([L1, L2]), list: list(L1, L2) };
  const files = new Map([[L1, perTest(2)], [RENAMED, perTest(3)]]);
  // The new path added to the list next to the old one.
  const listed = checkSuite({ files, boots: boots(), timings: {}, list: list(L1, L2, RENAMED), base }).join('\n');
  assert.match(listed, /test\/ui-listed-b\.test\.mjs .*no longer exists/);
  assert.match(listed, /test\/ui-listed-c\.test\.mjs was added to test\/suite-guard-offenders\.json/);
  // A plain git mv with the list untouched.
  const moved = checkSuite({ files, boots: boots(), timings: {}, list: list(L1, L2), base }).join('\n');
  assert.match(moved, /test\/ui-listed-b\.test\.mjs .*no longer exists/);
  assert.match(moved, /test\/ui-listed-c\.test\.mjs boots ui\/public\/app\.js inside each test/);
});

test('checkSuite: an unsorted or duplicated list fails "each file once, sorted"', () => {
  const unsorted = suite({ headList: list(L2, L1) });
  assert.ok(unsorted.some((p) => p.includes('test/suite-guard-offenders.json must list each file once, sorted')), unsorted.join('\n'));
  const dup = suite({ headList: list(L1, L1, L2) });
  assert.ok(dup.some((p) => p.includes('test/suite-guard-offenders.json must list each file once, sorted')), dup.join('\n'));
});

test('checkSuite: a missing list fails "is missing"', () => {
  const problems = suite({ headList: null });
  assert.ok(problems.some((p) => p.includes('test/suite-guard-offenders.json is missing')), problems.join('\n'));
});

test('checkSuite: an unparsable test file that mentions app.js is a parse problem naming it', () => {
  const problems = suite({ files: { 'test/ui-broken.test.mjs': HEAD + "\ntest('a', () => { " } });
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^test\/ui-broken\.test\.mjs could not be parsed: /);
});

test('checkSuite: the first landing (no list at the base) passes with a full list', () => {
  assert.deepEqual(suite({ base: { ref: 'abc1234', files: new Set([L1, L2, OK]), list: null } }), []);
});

test('checkSuite: with no base, boot and list-hygiene rules run; time and added rules are skipped', () => {
  const NEW = 'test/ui-new-thing.test.mjs';
  const SLOW = 'test/slow-new.test.mjs';
  const problems = suite({
    base: null,
    files: { [NEW]: perTest(2), [SLOW]: "import { test } from 'node:test';\ntest('a', () => {});", [L2]: sharedBoot },
    timings: { [SLOW]: 25 },
    headList: list(L1, L2, 'test/ui-zz-added.test.mjs'),
  }).join('\n');
  assert.match(problems, /test\/ui-new-thing\.test\.mjs boots ui\/public\/app\.js inside each test/);
  assert.match(problems, /test\/ui-listed-b\.test\.mjs is on test\/suite-guard-offenders\.json but no longer boots/);
  assert.doesNotMatch(problems, /timed at/);
  assert.doesNotMatch(problems, /was added/);
});

test('checkSuite: problems come back sorted', () => {
  const problems = suite({ files: { 'test/ui-z.test.mjs': perTest(2), 'test/ui-a.test.mjs': perTest(2) } });
  assert.equal(problems.length, 2);
  assert.deepEqual(problems, [...problems].sort());
});

// ── base resolution: resolveBase ────────────────────────────────────────────
const stubGit = (ok) => (args) => {
  if (!ok(args)) throw new Error(`git ${args.join(' ')} failed`);
  return 'a'.repeat(40);
};

test('resolveBase: WORCA_SUITE_GUARD_BASE=HEAD^1 that resolves returns { ref }', () => {
  const seen = [];
  const r = resolveBase({ WORCA_SUITE_GUARD_BASE: 'HEAD^1', GITHUB_ACTIONS: 'true' }, (args) => { seen.push(args.join(' ')); return 'a'.repeat(40); });
  assert.equal(typeof r.ref, 'string');
  assert.ok(r.ref.length > 0);
  assert.equal(r.skip, undefined);
  assert.ok(seen.some((s) => s.includes('rev-parse') && s.includes('HEAD^1')), seen.join('\n'));
});

test('resolveBase: a WORCA_SUITE_GUARD_BASE that does not resolve throws "is not a commit here"', () => {
  assert.throws(() => resolveBase({ WORCA_SUITE_GUARD_BASE: 'nope', GITHUB_ACTIONS: 'true' }, stubGit(() => false)),
    /WORCA_SUITE_GUARD_BASE=nope is not a commit here/);
});

test('resolveBase: WORCA_SUITE_GUARD_BASE=none skips, naming the variable, even in CI', () => {
  const r = resolveBase({ WORCA_SUITE_GUARD_BASE: 'none', GITHUB_ACTIONS: 'true' }, stubGit(() => true));
  assert.match(r.skip, /WORCA_SUITE_GUARD_BASE=none/);
});

test('resolveBase (R-ops-10): GITHUB_ACTIONS=true without the variable throws "no base commit"', () => {
  assert.throws(() => resolveBase({ GITHUB_ACTIONS: 'true' }, stubGit(() => true)), /no base commit/);
});

test('resolveBase: locally, the merge-base with origin/dev is the base; a failing merge-base skips', () => {
  const r = resolveBase({}, stubGit(() => true));
  assert.equal(typeof r.ref, 'string');
  const skipped = resolveBase({}, stubGit((args) => args[0] !== 'merge-base'));
  assert.match(skipped.skip, /origin\/dev/);
});

// ── live check on this tree ─────────────────────────────────────────────────
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('the repo passes the suite guard', (t) => {
  const base = resolveBase(process.env, git);
  if (base.skip) t.diagnostic(`suite guard: base-dependent rules skipped (${base.skip})`);
  const repo = readRepo(ROOT, base.ref ?? null);
  assert.ok(repo.files.size > 1000, 'readRepo listed the top-level test files');
  assert.deepEqual(checkSuite(repo), []);
});

test('the offender list holds today\'s per-test-boot files', () => {
  const doc = JSON.parse(readFileSync(new URL('suite-guard-offenders.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(doc).sort(), ['about', 'perTestBoot']);
  const files = doc.perTestBoot;
  assert.ok(files.length >= 100, `the list holds ${files.length} files`);
  assert.ok(files.includes('test/ui-runs-view.test.mjs'), 'a local boot() file is listed');
  assert.ok(files.includes('test/ui-chat-links-app.test.mjs'), 'a helper-wrapping-a-helper file is listed');
  assert.deepEqual(files, [...new Set(files)].sort());
});
