// test/stillhet-gates.test.mjs — tools/stillhet-gates.mjs: the baseline can only shrink, and every gate has a baseline entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GATES, BASELINES, checkBaseline, findingsOf, launchFailure } from '../tools/stillhet-gates.mjs';

test('checkBaseline: a finding outside the baseline is new, an entry no longer reported is stale', () => {
  assert.deepEqual(checkBaseline(['a', 'b'], ['a']), { added: ['b'], stale: [] });
  assert.deepEqual(checkBaseline(['a'], ['a', 'gone']), { added: [], stale: ['gone'] });
  assert.deepEqual(checkBaseline([], []), { added: [], stale: [] });
});

test('findingsOf: unique, trimmed, sorted output lines', () => {
  assert.deepEqual(findingsOf(' b \n\na\nb\n'), ['a', 'b']);
});

test('findingsOf: a gate’s count and summary lines are not findings', () => {
  assert.deepEqual(findingsOf('1714 checks · \na journey breaks\n   light/1280: pausing moves it everywhere\n'), ['a journey breaks', 'light/1280: pausing moves it everywhere']);
  assert.deepEqual(findingsOf('35348 clicks · \ndead (1)\n   #x'), ['#x', 'dead (1)']);
  assert.deepEqual(findingsOf('colour: 1 off-palette, 0 under contrast, 0 faint rings\n  hue  .x  #f00 · runs'), ['hue  .x  #f00 · runs']);
  assert.deepEqual(findingsOf('ok   #chat a → b\nFAIL #runs c → d'), ['FAIL #runs c → d']);
  assert.deepEqual(findingsOf('settings/x reads y  (with z)\n\n1 sentences read wrong, in 400 readings'), ['settings/x reads y  (with z)']);
});

test('findingsOf: a crash is one finding, named by its error line, never its stack frames', () => {
  const crash = 'file:///g/worca-sweep.mjs:30\n  throw x;\n\nTypeError: Cannot read properties of null (reading \'x\')\n    at file:///g/worca-sweep.mjs:30:5\n    at async run (node:internal/x:1:1)\n\nNode.js v26.5.0\n';
  assert.deepEqual(findingsOf(crash), ["crashed: TypeError: Cannot read properties of null (reading 'x')"]);
});

test('launchFailure: names the line that says a gate could not start, null when it ran', () => {
  assert.equal(launchFailure('x\n  browserType.launch: Executable doesn\'t exist at /p/chrome\n'), "browserType.launch: Executable doesn't exist at /p/chrome");
  assert.equal(launchFailure("Error: Cannot find package 'playwright'"), "Error: Cannot find package 'playwright'");
  assert.equal(launchFailure('settings/models: misaligned'), null);
});

test('the baselines file names exactly the six gates, each a list of strings', () => {
  const b = JSON.parse(readFileSync(BASELINES, 'utf8'));
  assert.deepEqual(Object.keys(b).sort(), [...GATES].sort());
  for (const list of Object.values(b)) assert.ok(Array.isArray(list) && list.every((x) => typeof x === 'string'));
});

test('against the app (STILLHET_TARGET) a gate does not rebuild the shared bundles: the runner built them once', async () => {
  const { buildBundles } = await import('../plans/rail/prototype/gates/target.mjs');
  const { statSync, existsSync: has } = await import('node:fs');
  const css = new URL('../ui/public/stillhet/app.css', import.meta.url);
  const before = has(css) ? statSync(css).mtimeMs : null;
  const was = process.env.STILLHET_TARGET;
  process.env.STILLHET_TARGET = 'http://127.0.0.1:1';
  try { buildBundles(); } finally { if (was === undefined) delete process.env.STILLHET_TARGET; else process.env.STILLHET_TARGET = was; }
  assert.equal(has(css) ? statSync(css).mtimeMs : null, before);
});

test('main: an invalid --workers returns 2 before reading baselines, building or starting the app', async () => {
  const { main } = await import('../tools/stillhet-gates.mjs');
  let built = 0, started = 0;
  const code = await main(['--workers', '0'], { build: async () => { built++; }, startApp: async () => { started++; } });
  assert.equal(code, 2);
  assert.equal(built + started, 0);
});

test('main: --workers and --units-json reach the click-check gate only; without them it gets no arguments', async () => {
  const { main } = await import('../tools/stillhet-gates.mjs');
  const seen = async (argv) => {
    const calls = {};
    const was = console.log; console.log = () => {};
    try {
      await main(argv, { build: async () => {}, startApp: async () => ({ base: 'http://127.0.0.1:1', stop: async () => {} }), runGate: async (gate, _env, args) => { calls[gate] = args; return { code: 0, out: '' }; } });
    } finally { console.log = was; }
    return calls;
  };
  const split = await seen(['--workers', '3', '--units-json', 'u.json']);
  assert.deepEqual(split['click-check'], ['--workers', '3', '--units-json', 'u.json']);
  for (const g of GATES.filter((x) => x !== 'click-check')) assert.deepEqual(split[g], [], g);
  assert.deepEqual((await seen(['--only', 'click-check', '--workers=2']))['click-check'], ['--workers', '2']);
  const plain = await seen([]);
  for (const g of GATES) assert.deepEqual(plain[g], [], g);
});

test('findingsOf: a merged split click-check report gives the same findings as the single walk', () => {
  const single = '512 clicks · \na dead control (2)\n   index.html 1280 #runs: Open\n   pulse.html 375 now: Mark';
  const merged = ['512 clicks · ', 'a dead control (2)', '   index.html 1280 #runs: Open', '   pulse.html 375 now: Mark'].join('\n');
  assert.deepEqual(findingsOf(merged), findingsOf(single));
  assert.deepEqual(findingsOf(single), ['a dead control (2)', 'index.html 1280 #runs: Open', 'pulse.html 375 now: Mark']);
});
