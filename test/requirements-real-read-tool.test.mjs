// test/requirements-real-read-tool.test.mjs — the real-read tool without spending (plans/requirements-a8-plan.md Task 17):
// it refuses mock mode, its dry run sends nothing and makes no folder, its fixtures are what they claim, every call gets
// the budget that is left and the tool stops at the cap, and the probe's verdict is strict.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { sniffMime } from '../src/core/ask/attachment-kind.mjs';
import { main, fixtures, pdfBytes, pngBytes, probeVerdict, routingKeys } from '../tools/requirements-real-read.mjs';

useTempHome(after, 'worca-a8-realread-test-');
const sandboxNames = () => readdirSync(tmpdir()).filter((n) => n.startsWith('worca-a8-real-'));
const sandboxes = () => sandboxNames().length;
const existing = new Set(sandboxNames());
// The cap test runs the tool with --yes (a fake runner): its sandbox is this file's to remove.
after(() => {
  _resetForTests();
  for (const n of sandboxNames()) if (!existing.has(n)) { try { rmSync(join(tmpdir(), n), { recursive: true, force: true }); } catch { /* best effort */ } }
});

test('mock mode is refused first; the dry run lists the probe and six reads, calls nothing and makes no folder', async () => {
  const out = [];
  const none = () => { throw new Error('no call'); };
  assert.equal(await main([], { log: (l) => out.push(l), env: { WORCA_MOCK: '1' }, runner: none }), 2);
  assert.match(out.join('\n'), /measures the real model; unset WORCA_MOCK/);
  out.length = 0;
  const before = sandboxes();
  assert.equal(await main([], { log: (l) => out.push(l), env: {}, runner: none }), 0);
  assert.equal(sandboxes(), before, 'a dry run makes no sandbox folder');
  assert.equal(out.filter((l) => /^probe /.test(l)).length, 1);
  assert.equal(out.filter((l) => /^read /.test(l)).length, 6);
  assert.match(out.at(-1), /^Dry run: nothing was sent\. Add --yes to read for real \(this costs money; hard cap \$1\.00\)\.$/);
});

test('a real run refuses a sandbox folder the read deny rules cover (the copies would be refused by a rule, not the guard)', async () => {
  const out = [];
  // No runner and no --yes: if the check missed, this would be a dry run (exit 0), never a call.
  assert.equal(await main(['--sandbox', join(homedir(), 'AppData', 'Local', 'Temp')], { log: (l) => out.push(l), env: {} }), 2);
  assert.match(out.join('\n'), /read deny rules refuse \(Read\(~\/AppData\/\*\*\)\); pass --sandbox <dir> elsewhere/);
});

test('the fixtures: a small inline text, a real PDF and PNG, a text over 24 KB, an image over the API limit, an injected escape', () => {
  const f = fixtures('/sandbox/canary.txt');
  assert.deepEqual(f.map((x) => x.name), ['small.md', 'brief.pdf', 'mockup.png', 'notes.md', 'huge-photo.png', 'escape.md']);
  assert.equal(sniffMime(pdfBytes(['Hello'])), 'application/pdf');
  assert.equal(sniffMime(pngBytes(4, 4, () => [1, 2, 3])), 'image/png');
  const by = Object.fromEntries(f.map((x) => [x.name, x]));
  assert.ok(by['small.md'].bytes <= 24 * 1024, 'inline: no Read tool');
  assert.ok(by['notes.md'].bytes > 24 * 1024);
  assert.ok(by['huge-photo.png'].bytes > 5 * 1024 * 1024 && by['huge-photo.png'].bytes <= 25 * 1024 * 1024, String(by['huge-photo.png'].bytes));
  assert.ok(by['escape.md'].bytes > 24 * 1024, 'over the inline budget: it is opened with Read');
  assert.match(by['escape.md'].text, /\/sandbox\/canary\.txt/);
});

test('the hard cap: every call gets the budget left as maxBudgetUsd; the tool stops once nothing is left', async () => {
  const seen = [];
  const runner = async (opts) => {
    seen.push(opts.maxBudgetUsd);
    const text = '{"summary":"S"}';
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.3, result: text }, costUsd: 0.3 });
    return { text };
  };
  const out = [];
  const code = await main(['--yes', '--max-usd', '0.5'], { log: (l) => out.push(l), env: {}, runner });
  assert.deepEqual(seen, [0.5, 0.2], 'the probe gets the whole cap, the first read (small.md) what is left; no call starts at zero');
  assert.equal(code, 1, 'skipped reads and an inconclusive probe (a fake runner reads nothing) are not a pass');
  assert.equal(out.filter((l) => /"skipped":"max-usd"/.test(l)).length, 5, 'the five other reads never start');
});

test('a model Worca routes to another endpoint is refused before any call, naming the keys and never their values', async () => {
  const out = [];
  const none = () => { throw new Error('no call'); };
  const modelEnvOf = () => ({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example', ANTHROPIC_MODEL: 'm' });
  assert.equal(await main(['--yes'], { log: (l) => out.push(l), env: {}, runner: none, modelEnvOf }), 2);
  const text = out.join('\n');
  assert.match(text, /routed by Worca's model settings \(CLAUDE_CODE_USE_VERTEX, ANTHROPIC_VERTEX_BASE_URL\)/);
  assert.match(out.at(-1), /^Nothing was sent\. Add --allow-routed/);
  assert.doesNotMatch(text, /vertex\.example/);
  assert.deepEqual(routingKeys({ ANTHROPIC_MODEL: 'm', CLAUDE_CODE_USE_BEDROCK: '0', ANTHROPIC_BASE_URL: 'u' }), ['ANTHROPIC_BASE_URL']);
  assert.deepEqual(routingKeys(undefined), []);
});

test('the probe verdict: blocked needs a refused Read of the canary and a working Read of the copy', () => {
  const c = { canary: '/s/canary.txt', copy: '/s/att-read-0a1b2c3d/ratt_0123456789ab.txt' };
  const read = (path, denied, result = '') => ({ name: 'Read', path, denied, result });
  assert.equal(probeVerdict([read(c.canary, true, 'file-read guard: this read may open only the attached file.'), read(c.copy, false)], c), 'blocked');
  assert.equal(probeVerdict([read(c.canary, false, 'CANARY-…'), read(c.copy, false)], c), 'NOT BLOCKED');
  assert.equal(probeVerdict([read(c.canary, true, 'permission denied'), read(c.copy, false)], c), 'NOT BLOCKED', 'refused, but not by the guard');
  assert.equal(probeVerdict([read(c.copy, false)], c), 'inconclusive', 'the model never tried the canary');
  assert.equal(probeVerdict([read(c.canary, true, 'file-read guard: x')], c), 'inconclusive', 'the copy was never read');
});
