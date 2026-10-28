// test/requirements-real-read-tool.test.mjs — the real-read tool without spending (design §8 "Real reads"):
// it refuses mock mode, its dry run sends nothing and makes no folder, its fixtures are what they claim, every call gets
// the budget that is left and the tool stops at the cap, and the probe's verdict is strict.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { sniffMime } from '../src/core/ask/attachment-kind.mjs';
import { main, fixtures, pdfBytes, pngBytes, probeVerdict, routingKeys, userSettingsRoutingKeys, settingsFileRoutingKeys, managedSettingsPaths } from '../tools/requirements-real-read.mjs';

useTempHome(after, 'worca-a8-realread-test-');
const sandboxNames = () => readdirSync(tmpdir()).filter((n) => n.startsWith('worca-a8-real-'));
const sandboxes = () => sandboxNames().length;
const existing = new Set(sandboxNames());
const none = () => { throw new Error('no call'); };
// A home without Claude Code settings, so no test reads this machine's ~/.claude.
const noClaude = mkdtempSync(join(tmpdir(), 'worca-a8-rr-none-'));
after(() => rmSync(noClaude, { recursive: true, force: true }));
// No managed settings either (a path that does not exist), so no test reads this machine's managed-settings.json.
const noManaged = [join(noClaude, 'managed-settings.json')];
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
  const code = await main(['--yes', '--max-usd', '0.5'], { log: (l) => out.push(l), env: {}, home: noClaude, managedPaths: noManaged, runner });
  assert.deepEqual(seen, [0.5, 0.2], 'the probe gets the whole cap, the first read (small.md) what is left; no call starts at zero');
  assert.equal(code, 1, 'skipped reads and an inconclusive probe (a fake runner reads nothing) are not a pass');
  assert.equal(out.filter((l) => /"skipped":"max-usd"/.test(l)).length, 5, 'the five other reads never start');
});

test('a model Worca routes to another endpoint is refused before any call, naming the keys and never their values', async () => {
  const out = [];
  const none = () => { throw new Error('no call'); };
  const modelEnvOf = () => ({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example', ANTHROPIC_MODEL: 'm' });
  assert.equal(await main(['--yes'], { log: (l) => out.push(l), env: {}, home: noClaude, managedPaths: noManaged, runner: none, modelEnvOf }), 2);
  const text = out.join('\n');
  assert.match(text, /routed by Worca's model settings \(CLAUDE_CODE_USE_VERTEX, ANTHROPIC_VERTEX_BASE_URL\)/);
  assert.match(out.at(-1), /^Nothing was sent\. Add --allow-routed/);
  assert.doesNotMatch(text, /vertex\.example/);
  assert.deepEqual(routingKeys({ ANTHROPIC_MODEL: 'm', CLAUDE_CODE_USE_BEDROCK: '0', ANTHROPIC_BASE_URL: 'u' }), ['ANTHROPIC_BASE_URL']);
  assert.deepEqual(routingKeys(undefined), []);
});

test('routing from this shell\'s environment is refused before any call (and before the sandbox), keys only', async () => {
  for (const env of [{ CLAUDE_CODE_USE_VERTEX: '1' }, { CLAUDE_CODE_USE_BEDROCK: 'true' }, { ANTHROPIC_BASE_URL: 'https://gw.example' },
    { ANTHROPIC_VERTEX_PROJECT_ID: 'acme-prj' }, { ANTHROPIC_BEDROCK_BASE_URL: 'https://br.example' }]) {
    const out = [];
    const before = sandboxes();
    assert.equal(await main(['--yes'], { log: (l) => out.push(l), env, home: noClaude, managedPaths: noManaged, runner: none }), 2, JSON.stringify(env));
    const text = out.join('\n');
    assert.match(text, new RegExp(`routed by this shell's environment \\(${Object.keys(env)[0]}\\)`));
    for (const v of Object.values(env)) if (v.length > 4) assert.doesNotMatch(text, new RegExp(v.replace(/[.]/g, '\\.')), 'never a value');
    assert.match(out.at(-1), /^Nothing was sent\. Add --allow-routed/);
    assert.equal(sandboxes(), before, 'refused before the sandbox is made');
  }
  // off values do not route
  const out = [];
  assert.equal(await main([], { log: (l) => out.push(l), env: { CLAUDE_CODE_USE_VERTEX: '0' }, home: noClaude, runner: none }), 0, 'a dry run');
});

test('routing in Claude Code\'s user settings env (CLAUDE_CONFIG_DIR, else ~/.claude) is refused before any call, keys only', async () => {
  const home = mkdtempSync(join(tmpdir(), 'worca-a8-rr-home-'));
  const conf = mkdtempSync(join(tmpdir(), 'worca-a8-rr-conf-'));
  try {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_PROJECT_ID: 'acme-secret-prj', OTHER: 'x' } }));
    const out = [];
    assert.equal(await main(['--yes'], { log: (l) => out.push(l), env: {}, home, managedPaths: noManaged, runner: none }), 2);
    assert.match(out.join('\n'), /routed by Claude Code's user settings \(CLAUDE_CODE_USE_VERTEX, ANTHROPIC_VERTEX_PROJECT_ID\)/);
    assert.doesNotMatch(out.join('\n'), /acme-secret-prj/);
    // CLAUDE_CONFIG_DIR wins over the home folder: an empty one there means no routing from the settings
    writeFileSync(join(conf, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_MODEL: 'm' } }));
    assert.deepEqual(userSettingsRoutingKeys({ env: { CLAUDE_CONFIG_DIR: conf }, home }), []);
    writeFileSync(join(conf, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://gw.example' } }));
    assert.deepEqual(userSettingsRoutingKeys({ env: { CLAUDE_CONFIG_DIR: conf }, home }), ['ANTHROPIC_BASE_URL']);
    writeFileSync(join(conf, 'settings.json'), '{ not json');
    assert.deepEqual(userSettingsRoutingKeys({ env: { CLAUDE_CONFIG_DIR: conf }, home }), ['settings.json (unreadable)'], 'unknown is refused, not guessed');
    assert.deepEqual(userSettingsRoutingKeys({ env: {}, home: noClaude }), [], 'no settings file: nothing routes');
    // --allow-routed lets it through to the next check (here the fake runner, capped)
    const seen = [];
    const runner = async (opts) => { seen.push(opts.maxBudgetUsd); return { text: '{"summary":"S"}' }; };
    await main(['--yes', '--allow-routed', '--probe-only', '--max-usd', '0.1'], { log: () => {}, env: { CLAUDE_CODE_USE_VERTEX: '1' }, home, managedPaths: noManaged, runner, modelEnvOf: () => ({}) });
    assert.deepEqual(seen, [0.1], 'allowed: the probe ran');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(conf, { recursive: true, force: true });
  }
});

test('a user apiKeyHelper and Claude Code\'s managed settings are routing too: refused before any call, keys only', async () => {
  const home = mkdtempSync(join(tmpdir(), 'worca-a8-rr-helper-'));
  const managed = mkdtempSync(join(tmpdir(), 'worca-a8-rr-managed-'));
  try {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: '/usr/local/bin/get-secret-key', env: { ANTHROPIC_MODEL: 'm' } }));
    let out = [];
    assert.equal(await main(['--yes'], { log: (l) => out.push(l), env: {}, home, managedPaths: noManaged, runner: none }), 2);
    assert.match(out.join('\n'), /routed by Claude Code's user settings \(apiKeyHelper\)/);
    assert.doesNotMatch(out.join('\n'), /get-secret-key/);
    // managed settings: the env block and a helper, from the platform's managed file
    const file = join(managed, 'managed-settings.json');
    writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_BEDROCK_BASE_URL: 'https://br.example', HTTP_PROXY: 'p' }, awsAuthRefresh: 'aws sso login' }));
    out = [];
    assert.equal(await main(['--yes'], { log: (l) => out.push(l), env: {}, home: noClaude, managedPaths: [file], runner: none }), 2);
    assert.match(out.join('\n'), /routed by Claude Code's managed settings \(.+managed-settings\.json\) \(ANTHROPIC_BEDROCK_BASE_URL, awsAuthRefresh\)/);
    assert.doesNotMatch(out.join('\n'), /br\.example|aws sso/);
    assert.match(out.at(-1), /^Nothing was sent\. Add --allow-routed/);
    writeFileSync(file, '{ broken');
    assert.deepEqual(settingsFileRoutingKeys(file), ['managed-settings.json (unreadable)']);
    writeFileSync(file, JSON.stringify({ apiKeyHelper: '', env: { ANTHROPIC_MODEL: 'm' } }));
    assert.deepEqual(settingsFileRoutingKeys(file), [], 'an empty helper and a model name route nowhere');
    assert.deepEqual(settingsFileRoutingKeys(join(managed, 'none.json')), []);
    // the platform paths
    assert.deepEqual(managedSettingsPaths('darwin'), ['/Library/Application Support/ClaudeCode/managed-settings.json']);
    assert.deepEqual(managedSettingsPaths('linux'), ['/etc/claude-code/managed-settings.json']);
    assert.deepEqual(managedSettingsPaths('win32'), ['C:\\Program Files\\ClaudeCode\\managed-settings.json', 'C:\\ProgramData\\ClaudeCode\\managed-settings.json']);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(managed, { recursive: true, force: true });
  }
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
