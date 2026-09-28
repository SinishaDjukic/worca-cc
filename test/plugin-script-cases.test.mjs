// test/plugin-script-cases.test.mjs
// The `--run-cases` engine (spec §8.1): a plugin dir's OWN scripts, its shipped
// cases, a scratch cwd — plus the rule that a case with NO expectation still
// fails when the script could not run at all.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { runPluginScriptCases } from '../src/core/plugin-script-cases.mjs';

useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const OK_BODY = "export default async function () {\n  return { outputs: { out: { value: '# ok\\n' } }, summary: 'ok' };\n}\n";
const THROW_BODY = "export default async function () {\n  throw new Error('boom');\n}\n";

function pluginWithScript(key, { body, cases }) {
  const dir = tmp('worca-cc-pcases-');
  const sdir = join(dir, 'scripts');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(sdir, `${key}.mjs`), body);
  writeFileSync(join(sdir, `${key}.meta.json`), JSON.stringify({
    key, metaVersion: 2, displayName: key, runtime: 'node', file: `${key}.mjs`, order: 900,
    inputs: [], outputs: [{ id: 'out', type: 'md', when: 'always', filename: `${key}-cycle{cycle}.md` }],
  }, null, 2) + '\n');
  writeFileSync(join(sdir, `${key}.tests.json`), JSON.stringify({ version: 1, cases }, null, 2) + '\n');
  return dir;
}

test('every shipped case runs; the expectation decides pass, and the tally adds up', async () => {
  const dir = pluginWithScript('greeter', { body: OK_BODY, cases: [
    { id: 'good', name: 'good', cwd: { kind: 'scratch' }, inputs: {}, expect: { verdict: 'clean', fired: ['out'] } },
    { id: 'wrong', name: 'wrong', cwd: { kind: 'scratch' }, inputs: {}, expect: { verdict: 'blocking' } },
    { id: 'bare', name: 'bare', cwd: { kind: 'scratch' }, inputs: {} },
  ] });
  const r = await runPluginScriptCases(dir);
  assert.deepEqual(r.problems, []);
  assert.equal(r.scripts.length, 1);
  assert.equal(r.scripts[0].runtime, 'node');
  assert.deepEqual(r.scripts[0].cases.map((k) => [k.caseId, k.pass, k.checked]),
    [['good', true, true], ['wrong', false, true], ['bare', true, false]]);
  assert.deepEqual([r.passed, r.failed, r.unchecked], [1, 1, 1]);
});

test('a case with NO expectation still fails when the script could not run', async () => {
  const dir = pluginWithScript('broken', { body: THROW_BODY, cases: [
    { id: 'bare', name: 'bare', cwd: { kind: 'scratch' }, inputs: {} },
  ] });
  const r = await runPluginScriptCases(dir);
  const kase = r.scripts[0].cases[0];
  assert.equal(kase.status, 'error');
  assert.equal(kase.pass, false);
  assert.match(kase.diffs.join(' '), /boom/);
  assert.deepEqual([r.passed, r.failed, r.unchecked], [0, 1, 0]);
});

test('a CHECKED case that broke names the reason beside the expectation diff', async () => {
  const dir = pluginWithScript('brokenToo', { body: THROW_BODY, cases: [
    { id: 'checked', name: 'checked', cwd: { kind: 'scratch' }, inputs: {}, expect: { verdict: 'clean' } },
  ] });
  const kase = (await runPluginScriptCases(dir)).scripts[0].cases[0];
  assert.equal(kase.pass, false);
  assert.match(kase.diffs[0], /expected clean, got error/);
  assert.match(kase.diffs.join(' '), /boom/);
});

test('a dir with no scripts/ is an empty, green result', async () => {
  assert.deepEqual(await runPluginScriptCases(tmp('worca-cc-pcases-empty-')),
    { scripts: [], passed: 0, failed: 0, unchecked: 0, stopped: false, problems: [] });
});

// The CLI holds each case's live bench so Ctrl+C / a CI cancel can stop the child
// tree (the script runs in its own process group: the terminal's signal never
// reaches it). A stopped case verified nothing, so it FAILS and ENDS the batch.
const NAP_BODY = "export default async function () {\n  console.log('napping');\n  await new Promise((r) => setTimeout(r, 20000));\n  return { summary: 'never' };\n}\n";

test('a stop fails the running case and ends the batch; onLine names the script and the case', async () => {
  const dir = pluginWithScript('napper', { body: NAP_BODY, cases: [
    { id: 'one', name: 'one', cwd: { kind: 'scratch' }, inputs: {} },
    { id: 'two', name: 'two', cwd: { kind: 'scratch' }, inputs: {} },
  ] });
  let live = null;
  const lines = [];
  const r = await runPluginScriptCases(dir, {
    onBench: (bench) => { live = bench; },
    onLine: (ev) => { lines.push(ev); if (/napping/.test(String(ev.text))) live.stop(); },
  });
  assert.equal(r.stopped, true);
  assert.deepEqual(r.scripts[0].cases.map((k) => [k.caseId, k.status, k.pass]), [['one', 'stopped', false]],
    'an unchecked case that was stopped is NOT a pass, and case two never ran');
  assert.deepEqual([r.passed, r.failed, r.unchecked], [0, 1, 0]);
  const hit = lines.find((ev) => /napping/.test(String(ev.text)));
  assert.deepEqual([hit.key, hit.caseId], ['napper', 'one']);
});

test('a stopped case FAILS even when its expectation is one a cut-short run satisfies', async () => {
  // `{ fired: [] }` names no verdict: a stopped run fired nothing, so evaluateExpect
  // passes it — the row used to read ✓ and the tally "1 passed" beside exit code 2.
  const dir = pluginWithScript('napperQuiet', { body: NAP_BODY, cases: [
    { id: 'quiet', name: 'quiet', cwd: { kind: 'scratch' }, inputs: {}, expect: { fired: [] } },
  ] });
  let live = null;
  const r = await runPluginScriptCases(dir, {
    onBench: (bench) => { live = bench; },
    onLine: (ev) => { if (/napping/.test(String(ev.text))) live.stop(); },
  });
  assert.equal(r.stopped, true);
  const kase = r.scripts[0].cases[0];
  assert.deepEqual([kase.status, kase.checked, kase.pass], ['stopped', true, false]);
  assert.ok(kase.diffs.length > 0, 'the row says why it is red');
  assert.deepEqual([r.passed, r.failed, r.unchecked], [0, 1, 0]);
});

test('a stop requested before the first case runs nothing', async () => {
  const dir = pluginWithScript('napperTwo', { body: NAP_BODY, cases: [
    { id: 'one', name: 'one', cwd: { kind: 'scratch' }, inputs: {} },
  ] });
  const r = await runPluginScriptCases(dir, { stopRequested: () => true });
  assert.deepEqual(r, { scripts: [], passed: 0, failed: 0, unchecked: 0, stopped: true, problems: [] });
});
