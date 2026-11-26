// test/shared-app-boot-conversions.test.mjs — the UI test files moved onto test/helpers/shared-app-boot.mjs: each
// boots the app through useSharedApp only, keeps its tests, and has left the suite guard's offender list.
//
// The proof by running them (each file whole, then each of its tests alone) takes minutes, so it is opt-in:
//   WORCA_EACH_ALONE=1 node --test test/shared-app-boot-conversions.test.mjs
// (`node --test`, not tools/test.mjs: the runner stops a file after 300 s.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listTestNames } from '../tools/test-each-alone.mjs';

// The speed-up tool owns the sibling rule. Loaded this way so a tool that does not load fails only the tests that need it.
const speedup = await import('../tools/ui-boot-speedup.mjs').catch((error) => ({ error }));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELPER = './helpers/shared-app-boot.mjs';
const FIRST = 'test/ui-running-detail.test.mjs';
// The files converted first (the six largest, then the fallbacks), with the number of tests each had before.
const BASELINE = {
  [FIRST]: 94,
  'test/ui-history-detail-tabs.test.mjs': 53,
  'test/ui-history-shipit.test.mjs': 57,
  'test/ui-workflows-app.test.mjs': 114,
  'test/ui-one-model.test.mjs': 36,
  'test/ui-marketplace-marketplaces.test.mjs': 35,
  'test/ui-ask-side-shell.test.mjs': 53,
  'test/ui-run-artifacts.test.mjs': 43,
  'test/ui-projects-view.test.mjs': 39,
  'test/ui-project-add.test.mjs': 37,
  // The batches' other files: each one's runtime count (`ℹ tests N` of `node tools/test.mjs FILE`) before its batch,
  // so tests made in a loop, and subtests, count one each.
  'test/run-page-flag-off-golden.test.mjs': 5,
  'test/ui-ask-form-panel.test.mjs': 5,
  'test/ui-chat-home-app.test.mjs': 21,
  'test/ui-chat-run-controls.test.mjs': 22,
  'test/ui-cost-breakdown.test.mjs': 10,
  'test/ui-folder-run-history.test.mjs': 18,
  'test/ui-folder-run-running.test.mjs': 19,
  'test/ui-group-page-route.test.mjs': 33,
  'test/ui-history-base-check.test.mjs': 25,
  'test/ui-history-detail-diff.test.mjs': 26,
  'test/ui-history-detail.test.mjs': 48,
  'test/ui-limit-reset.test.mjs': 20,
  'test/ui-log-filter-session.test.mjs': 11,
  'test/ui-newpipeline-shape-link.test.mjs': 7,
  'test/ui-no-project-run-page.test.mjs': 11,
  'test/ui-plan-panel.test.mjs': 16,
  'test/ui-question-panel.test.mjs': 4,
  'test/ui-question-shaping.test.mjs': 13,
  'test/ui-question-workflow.test.mjs': 6,
  'test/ui-question.test.mjs': 10,
  'test/ui-run-checklists.test.mjs': 2,
  'test/ui-run-presets-save.test.mjs': 6,
  'test/ui-run-rerun-form.test.mjs': 19,
  'test/ui-run-sessions-tray.test.mjs': 8,
  'test/ui-run-sessions-view.test.mjs': 24,
  'test/ui-run-tags.test.mjs': 25,
  'test/ui-running-auto.test.mjs': 6,
  'test/ui-running-card.test.mjs': 2,
  'test/ui-session-step-line.test.mjs': 6,
  'test/ui-shape-app-wiring.test.mjs': 55,
  'test/ui-skills-run-detail.test.mjs': 3,
  'test/ui-skills-run-picker.test.mjs': 3,
};

// The batches that have landed, each by its helper family. A later batch appends its entry (and its BASELINE counts).
const BATCHES = {
  'run-page and history families': [
    'test/run-page-flag-off-golden.test.mjs',
    'test/ui-ask-form-panel.test.mjs',
    'test/ui-chat-home-app.test.mjs',
    'test/ui-chat-run-controls.test.mjs',
    'test/ui-cost-breakdown.test.mjs',
    'test/ui-folder-run-history.test.mjs',
    'test/ui-folder-run-running.test.mjs',
    'test/ui-group-page-route.test.mjs',
    'test/ui-history-base-check.test.mjs',
    'test/ui-history-detail-diff.test.mjs',
    'test/ui-history-detail.test.mjs',
    'test/ui-limit-reset.test.mjs',
    'test/ui-log-filter-session.test.mjs',
    'test/ui-newpipeline-shape-link.test.mjs',
    'test/ui-no-project-run-page.test.mjs',
    'test/ui-one-model.test.mjs',
    'test/ui-plan-panel.test.mjs',
    'test/ui-question-panel.test.mjs',
    'test/ui-question-shaping.test.mjs',
    'test/ui-question-workflow.test.mjs',
    'test/ui-question.test.mjs',
    'test/ui-run-checklists.test.mjs',
    'test/ui-run-presets-save.test.mjs',
    'test/ui-run-rerun-form.test.mjs',
    'test/ui-run-sessions-tray.test.mjs',
    'test/ui-run-sessions-view.test.mjs',
    'test/ui-run-tags.test.mjs',
    'test/ui-running-auto.test.mjs',
    'test/ui-running-card.test.mjs',
    'test/ui-session-step-line.test.mjs',
    'test/ui-shape-app-wiring.test.mjs',
    'test/ui-skills-run-detail.test.mjs',
    'test/ui-skills-run-picker.test.mjs',
  ],
};

const topLevel = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `test/${f}`);
const parsed = new Map();
const parse = (file) => {
  if (!parsed.has(file)) parsed.set(file, acorn.parse(readFileSync(join(ROOT, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }));
  return parsed.get(file);
};
const imports = (file) => parse(file).body.filter((n) => n.type === 'ImportDeclaration');
const usesHelper = (file) => file !== 'test/shared-app-boot.test.mjs'
  && readFileSync(join(ROOT, file), 'utf8').includes('shared-app-boot.mjs') && imports(file).some((n) => n.source.value === HELPER);

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) for (const c of v) walk(c, visit);
    else walk(v, visit);
  }
}

const offenders = () => JSON.parse(readFileSync(join(ROOT, 'test', 'suite-guard-offenders.json'), 'utf8')).perTestBoot;

// A converted file, and the files its tests moved to when they need other load-time state (test/NAME-WHAT.test.mjs).
// A sibling boots through the shared helper, is neither one of slice 11's files (read from the committed record, since
// CI checkouts are shallow) nor a BASELINE key, and belongs only to the longest converted stem it starts with.
let siblingInputs = null;
function siblings(file) {
  if (!siblingInputs) {
    assert.ok(!speedup.error, `tools/ui-boot-speedup.mjs loads: ${speedup.error?.message}`);
    const record = JSON.parse(readFileSync(join(ROOT, 'test', 'ui-boot-speedup.json'), 'utf8'));
    siblingInputs = {
      converted: speedup.convertedFiles(record, offenders(), (f) => existsSync(join(ROOT, f))),
      excluded: new Set([...record.files, ...Object.keys(BASELINE)]),
    };
  }
  return speedup.siblingsOf(file, siblingInputs.converted, topLevel, usesHelper, siblingInputs.excluded);
}
const family = (file) => [file, ...siblings(file)];
const testCount = (file) => parse(file).body.filter((s) => {
  const call = s.type === 'ExpressionStatement' ? (s.expression.type === 'AwaitExpression' ? s.expression.argument : s.expression) : null;
  return call?.type === 'CallExpression' && call.callee.type === 'Identifier' && ['test', 'it'].includes(call.callee.name);
}).length;

const convertedCandidates = () => Object.keys(BASELINE).filter(usesHelper);
const converted = () => topLevel.filter(usesHelper);

// The test/helpers/*-boot.mjs exports that import app.js themselves (boot() too, matched by its helper's name).
const HELPER_BOOTS = ['bootApp', 'bootDetail', 'bootChat', 'bootGitApp'];

// Every way a file could still boot the app itself, or release the shared window after one of its tests.
function ownBoots(file) {
  const ast = parse(file);
  const vars = new Map();
  walk(ast, (n) => { if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) vars.set(n.id.name, n.init); });
  const found = [];
  const bootImports = new Set(HELPER_BOOTS);
  for (const i of imports(file)) {
    for (const s of i.specifiers) {
      const name = s.imported?.name;
      if (name === 'boot' && /-boot\.mjs$/.test(i.source.value)) bootImports.add(s.local.name);
      else if (bootImports.has(name)) bootImports.add(s.local.name);
    }
  }
  walk(ast, (n) => {
    if (n.type === 'ImportExpression') {
      const strings = [];
      const seen = new Set();
      const collect = (root) => walk(root, (c) => {
        if (c.type === 'Literal' && typeof c.value === 'string') strings.push(c.value);
        else if (c.type === 'TemplateElement') strings.push(c.value.raw);
        else if (c.type === 'Identifier' && vars.has(c.name) && !seen.has(c.name)) { seen.add(c.name); collect(vars.get(c.name)); }
      });
      collect(n.source);
      if (strings.some((s) => /(^|[/\\])app\.js([?#]|$)/.test(s))) found.push('imports app.js');
    }
    if (n.type !== 'CallExpression') return;
    const callee = n.callee.type === 'Identifier' ? n.callee.name : n.callee.type === 'MemberExpression' ? n.callee.property.name : null;
    const imported = n.callee.type === 'Identifier' ? bootImports.has(callee) : HELPER_BOOTS.includes(callee);
    // A local function may keep the name boot(); only the helpers' boots are refused.
    if (imported && !(n.callee.type === 'Identifier' && vars.has(callee))) found.push(`calls ${callee}()`);
    if (callee === 'useDomRelease' && n.arguments[0]?.name === 'afterEach') found.push('calls useDomRelease(afterEach)');
  });
  return [...new Set(found)];
}

test('R-arch-2: test/ui-running-detail.test.mjs boots the app once, through useSharedApp, and keeps its 94 tests', () => {
  assert.ok(usesHelper(FIRST), `${FIRST} imports useSharedApp from ${HELPER}`);
  for (const file of family(FIRST)) {
    assert.ok(usesHelper(file), `${file} imports useSharedApp`);
    const calls = parse(file).body.filter((s) => {
      let hit = 0;
      walk(s, (n) => { if (n.type === 'CallExpression' && n.callee.name === 'useSharedApp') hit++; });
      return hit > 0;
    });
    assert.equal(calls.length, 1, `${file}: one useSharedApp(…) call, at module top`);
    assert.ok(['VariableDeclaration', 'ExpressionStatement', 'ExportNamedDeclaration'].includes(calls[0].type), `${file}: not inside a function or a test`);
    assert.deepEqual(ownBoots(file), [], `${file} boots only through the shared helper`);
  }
  const total = family(FIRST).reduce((n, f) => n + testCount(f), 0);
  assert.equal(total, BASELINE[FIRST], `${total} tests across ${family(FIRST).join(', ')}; it had ${BASELINE[FIRST]}`);
});

test('at least 5 of the largest per-test-boot files are converted, ui-running-detail among them', () => {
  const done = convertedCandidates();
  assert.ok(done.includes(FIRST), `converted: ${done.join(', ') || 'none'}`);
  assert.ok(done.length >= 5, `${done.length} converted: ${done.join(', ') || 'none'}`);
});

test('every converted file boots the app through useSharedApp only', () => {
  const files = converted();
  assert.ok(files.length > 0, `no test file imports ${HELPER}`);
  const problems = files.flatMap((f) => ownBoots(f).map((p) => `${f} ${p}`));
  assert.deepEqual(problems, []);
});

test('every converted file keeps at least as many tests as it had, its sibling files included', () => {
  const files = convertedCandidates();
  assert.ok(files.length > 0, 'no listed file is converted yet');
  for (const file of files) {
    const total = family(file).reduce((n, f) => n + testCount(f), 0);
    assert.equal(total, BASELINE[file], `${file}: ${total} tests, it had ${BASELINE[file]}`);
  }
});

test('every converted file has left the suite guard\'s offender list', () => {
  const list = join(ROOT, 'test', 'suite-guard-offenders.json');
  assert.ok(existsSync(list), 'test/suite-guard-offenders.json is here (the suite regression guard is merged in)');
  const listed = new Set(JSON.parse(readFileSync(list, 'utf8')).perTestBoot);
  const files = converted();
  assert.ok(files.length >= 5, `${files.length} converted files`);
  assert.deepEqual(files.filter((f) => listed.has(f)), []);
});

// ── the batches ─────────────────────────────────────────────────────────────
const batchFiles = () => Object.values(BATCHES).flat();
// The boot names a file imports from a helper (the adapters' own functions are bound to local consts instead).
const importedBoots = (file) => imports(file).flatMap((i) => i.specifiers
  .filter((s) => HELPER_BOOTS.includes(s.imported?.name) || (s.imported?.name === 'boot' && /-boot\.mjs$/.test(i.source.value)))
  .map((s) => `imports ${s.imported.name} from ${i.source.value}`));

test('batch 1 is the 33 run-page and history files, each with its test count in BASELINE', () => {
  const batch = BATCHES['run-page and history families'];
  assert.equal(new Set(batch).size, 33);
  assert.equal(new Set(batchFiles()).size, batchFiles().length, 'no file is in two batches');
  assert.deepEqual(batchFiles().filter((f) => !(f in BASELINE) || !topLevel.includes(f)), []);
});

test('every file of every landed batch boots through useSharedApp only, keeps its tests and left the offender list', () => {
  const listed = new Set(offenders());
  const problems = [];
  for (const file of batchFiles()) {
    if (listed.has(file)) problems.push(`${file} is still on the offender list`);
    if (!usesHelper(file)) problems.push(`${file} does not import useSharedApp from ${HELPER}`);
    for (const p of importedBoots(file)) problems.push(`${file} ${p}`);
    const files = family(file);
    for (const f of files) for (const p of ownBoots(f)) problems.push(`${f} ${p}`);
    const total = files.reduce((n, f) => n + testCount(f), 0);
    if (total !== BASELINE[file]) problems.push(`${file}: ${total} top-level tests across its family, it had ${BASELINE[file]}`);
  }
  assert.deepEqual(problems, []);
});

test('R-arch-7: every batch file and sibling imports useSharedApp from the helper and calls it once, at module top', () => {
  const problems = [];
  for (const file of batchFiles().flatMap(family)) {
    const imported = imports(file).some((i) => i.source.value === HELPER && i.specifiers.some((s) => s.imported?.name === 'useSharedApp'));
    if (!imported) problems.push(`${file} does not import useSharedApp from ${HELPER}`);
    let calls = 0;
    walk(parse(file), (n) => { if (n.type === 'CallExpression' && n.callee.name === 'useSharedApp') calls++; });
    // at module top: `const app = useSharedApp(…)` or a bare `useSharedApp(…)`, never inside a function or a test
    const top = parse(file).body.flatMap((s) => {
      const node = s.type === 'ExportNamedDeclaration' ? s.declaration : s;
      if (node?.type === 'VariableDeclaration') return node.declarations.map((d) => d.init);
      return node?.type === 'ExpressionStatement' ? [node.expression] : [];
    }).filter((n) => n?.type === 'CallExpression' && n.callee.name === 'useSharedApp').length;
    if (calls !== 1 || top !== 1) problems.push(`${file}: ${calls} useSharedApp(…) call(s), ${top} at module top; want exactly 1, at module top`);
  }
  assert.deepEqual(problems, []);
});

test('every test of a batch file and its siblings is a top-level test with a unique literal name, so it can run alone', () => {
  const problems = [];
  for (const file of batchFiles().flatMap(family)) {
    const { dynamic, duplicates, suites } = listTestNames(readFileSync(join(ROOT, file), 'utf8'));
    if (dynamic.length) problems.push(`${file}: tests in a loop, block or function, or with a computed name, at line(s) ${dynamic.join(', ')}`);
    if (duplicates.length) problems.push(`${file}: test names used more than once: ${duplicates.join(', ')}`);
    if (suites.length) problems.push(`${file}: describe/suite calls at line(s) ${suites.join(', ')}`);
  }
  assert.deepEqual(problems, []);
});

test('the offender list holds at most the 158 files left after batch 1', () => {
  assert.ok(offenders().length <= 158, `${offenders().length} files are still listed`);
});

test('a sibling file counts only for the longest converted stem it starts with, and only when it boots through the shared helper', () => {
  const listed = new Set(offenders());
  const cases = [
    ['test/ui-cost-breakdown.test.mjs', 'test/ui-cost-breakdown-session.test.mjs'],
    ['test/ui-question.test.mjs', 'test/ui-question-delegate.test.mjs'],
    ['test/ui-history-detail.test.mjs', 'test/ui-history-detail-tabs-deep-link.test.mjs'],
  ];
  for (const [file, stranger] of cases) {
    assert.ok(topLevel.includes(stranger), `${stranger} exists`);
    assert.ok(!listed.has(file), `${file} is converted, so the rule applies to it`);
    assert.ok(!family(file).includes(stranger), `${stranger} is not a sibling of ${file}`);
  }
  assert.ok(family('test/ui-history-detail-tabs.test.mjs').includes('test/ui-history-detail-tabs-deep-link.test.mjs'),
    'the deep-link file counts for ui-history-detail-tabs');
});

// ── the run proof (opt-in) ──────────────────────────────────────────────────
const skip = !process.env.WORCA_EACH_ALONE && 'set WORCA_EACH_ALONE=1 to run the converted files whole and test by test';
const node = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, FORCE_COLOR: undefined, ...extraEnv },
  });
  return { status: r.status, out: r.stdout + r.stderr };
};

// Runs a file whole through the runner, counting every app.js load of its process from outside the helper.
function runWhole(file) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-app-loads-'));
  try {
    const counter = join(dir, 'count-app-loads.mjs');
    const loads = join(dir, 'loads.txt');
    writeFileSync(loads, '');
    writeFileSync(counter, [
      "import { registerHooks } from 'node:module';",
      "import { appendFileSync } from 'node:fs';",
      'const seen = new Set();',
      'registerHooks({ resolve(specifier, context, nextResolve) {',
      '  const r = nextResolve(specifier, context);',
      '  if (/\\/ui\\/public\\/app\\.js([?#]|$)/.test(r.url) && !seen.has(r.url)) { seen.add(r.url); appendFileSync(process.env.WORCA_APP_LOADS, `${r.url}\\n`); }',
      '  return r;',
      '} });',
    ].join('\n'));
    const r = node([join(ROOT, 'tools', 'test.mjs'), file], {
      WORCA_APP_LOADS: loads,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(counter).href}`].filter(Boolean).join(' '),
    });
    const count = (label) => Number(r.out.match(new RegExp(`ℹ ${label} (\\d+)`))?.[1] ?? NaN);
    return { ...r, tests: count('tests'), pass: count('pass'), loads: readFileSync(loads, 'utf8').split('\n').filter(Boolean).length };
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

// Whole file green with one app boot, then every test of it green on its own. Returns the number of tests proved.
function prove(file) {
  const whole = runWhole(file);
  assert.equal(whole.status, 0, `${file} whole:\n${whole.out.slice(-4000)}`);
  assert.equal(whole.pass, whole.tests, `${file}: pass ${whole.pass} of ${whole.tests}`);
  assert.equal(whole.loads, 1, `${file}: app.js was loaded ${whole.loads} times; expected 1`);
  const alone = node([join(ROOT, 'tools', 'test-each-alone.mjs'), file]);
  assert.equal(alone.status, 0, `${file} each alone:\n${alone.out.slice(-4000)}`);
  const m = alone.out.match(/each alone: (\d+)\/(\d+) passed/);
  assert.ok(m, alone.out.slice(-4000));
  assert.equal(m[1], m[2], alone.out.slice(-4000));
  return Number(m[2]);
}

test('R-arch-2 example (run): ui-running-detail runs its 94 tests with one app boot, and each of the 94 passes alone', { skip, timeout: 1_800_000 }, () => {
  const total = family(FIRST).reduce((n, f) => n + prove(f), 0);
  assert.equal(total, BASELINE[FIRST], `${total} tests proved alone; it had ${BASELINE[FIRST]}`);
});

test('every other converted file passes whole with one app boot, and each of its tests passes alone (run)', { skip, timeout: 10_800_000 }, () => {
  const others = converted().filter((f) => !family(FIRST).includes(f));
  assert.ok(others.length >= 4, `${others.length} other converted files`);
  for (const file of others) assert.equal(prove(file), testCount(file), `${file}: every test was proved`);
});
