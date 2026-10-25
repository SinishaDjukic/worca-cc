// test/cli-setup.test.mjs
// `worca setup --from FILE` (src/cli/setup.mjs, D16, AC-5.8): applies the file with one settings write and asks
// only for the questions it leaves out; a refused file exits 2 with the field named.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const home = mkdtempSync(join(tmpdir(), 'worca-cli-setup-'));
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(home, { recursive: true, force: true });
});
const { cmdSetup, CLI_QUESTIONS } = await import('../src/cli/setup.mjs');
const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const settingsPath = join(home, '.worca-cc', 'settings.json');
const stdin = (text) => { const s = new PassThrough(); s.end(text); return s; };
const run = async (argv, text = '') => {
  const lines = []; const errs = []; const asked = [];
  const prompt = { write: (q) => { asked.push(q); return true; } };
  const code = await cmdSetup(argv, { out: (s) => lines.push(s), err: (s) => errs.push(s), input: stdin(text), prompt,
    catalog: async () => [{ id: 'claude-opus-5-5', harnesses: ['claude'] }], claudeAuth: async () => 'signed-in' });
  return { code, lines, errs, asked };
};
const file = (obj) => { const p = join(home, `t-${Math.random().toString(36).slice(2)}.json`); writeFileSync(p, JSON.stringify(obj)); return p; };
// Every test starts from an empty settings.json, so none depends on what an earlier test wrote (qa-2-7).
const fresh = (text = '{}') => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(settingsPath, text); };

test('AC-5.8: applies the file and asks only for what it leaves out', async () => {
  fresh();
  const p = file({ schema: 1, fields: {
    'setup.uiLevel': { kind: 'default', value: 'advanced' }, 'setup.runEngine': { kind: 'default', value: 'claude' },
    'cost.pipelineLimitUsd': { kind: 'default', value: 8 },
    'models.roles': { kind: 'default', value: { claude: { deep: { model: 'claude-opus-5-5', effort: 'high' } } } },
  } });
  const left = CLI_QUESTIONS.filter((q) => !['work.uiLevel', 'work.runEngine', 'work.pipelineCostLimitUsd', 'models.modelRoles.claude.deep'].includes(q.key));
  const r = await run(['--from', p], `${'\n'.repeat(left.length)}y\n`);
  assert.equal(r.code, 0, r.errs.join('\n'));
  assert.equal(r.asked.length, left.length + 1);                         // the left-out questions, then the confirm
  assert.deepEqual(r.asked.slice(0, -1).map((q) => q.split(' [')[0]), left.map((q) => q.label));
  assert.equal(r.asked.at(-1), 'Apply these changes? [y/N] ');
  assert.ok(r.lines.includes('  Per-run limit ($): not set → 8'), r.lines.join('\n'));
  const s = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(s.uiLevel, 'advanced'); assert.equal(s.pipelineCostLimitUsd, 8);
  assert.deepEqual(s.modelRoles.claude.deep, { model: 'claude-opus-5-5', effort: 'high' });
  assert.match(r.lines.at(-1), /^Applied \d+ settings from /);
});

test('a "no" at the confirm writes nothing and exits 1', async () => {
  fresh();
  const p = file({ schema: 1, fields: { 'setup.uiLevel': { kind: 'default', value: 'expert' } } });
  const left = CLI_QUESTIONS.filter((q) => q.key !== 'work.uiLevel');
  const r = await run(['--from', p], `${'\n'.repeat(left.length)}n\n`);
  assert.equal(r.code, 1); assert.ok(r.lines.includes('Nothing changed.'));
  assert.equal(readFileSync(settingsPath, 'utf8'), '{}');
});

test('a role the file names but no source serves is not asked again', async () => {
  fresh();
  const p = file({ schema: 1, fields: { 'models.roles': { kind: 'default', value: { claude: { quick: { model: 'gpt-9' } } } } } });
  const left = CLI_QUESTIONS.filter((q) => q.key !== 'models.modelRoles.claude.quick');
  const r = await run(['--from', p, '--yes']);
  assert.equal(r.code, 0, r.errs.join('\n'));
  assert.ok(r.lines.some((l) => /^Quick jobs: gpt-9 — None of your sources offer it\. Your pick is kept\.$/.test(l)), r.lines.join('\n'));
  const asked = await run(['--from', p], `${'\n'.repeat(left.length)}y\n`);
  assert.equal(asked.asked.some((q) => q.startsWith('Quick jobs model')), false);
});

test('a typed answer for a left-out question is applied; --yes asks nothing', async () => {
  fresh();
  const p = file({ schema: 1, fields: { 'setup.uiLevel': { kind: 'default', value: 'simple' } } });
  const answers = CLI_QUESTIONS.filter((q) => q.key !== 'work.uiLevel').map((q) => (q.key === 'work.totalCostLimitUsd' ? '40' : '')).join('\n');
  assert.equal((await run(['--from', p], `${answers}\ny\n`)).code, 0);
  assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).totalCostLimitUsd, 40);
  const y = await run(['--from', p, '--yes']);
  assert.equal(y.code, 0); assert.equal(y.asked.length, 0);
});

test('a record field prints each changed sub-key before the confirm', async () => {
  fresh('{"sync":{"remote":"upstream"}}');
  const p = file({ schema: 1, fields: { 'setup.sync': { kind: 'default', value: { beforeRun: true, onDiverged: 'ask' } } } });
  const r = await run(['--from', p, '--yes']);
  assert.equal(r.code, 0, r.errs.join('\n'));
  assert.ok(r.lines.includes('  Sync before run · beforeRun: not set → true'), r.lines.join('\n'));
  assert.ok(r.lines.includes('  Sync before run · onDiverged: not set → ask'), r.lines.join('\n'));
  assert.equal(r.lines.some((l) => /remote/.test(l)), false);           // an unchanged sub-key is not listed
});

test('AC-5.5 in the CLI: a refused file exits 2, names the field and writes nothing', async () => {
  fresh('{"uiLevel":"simple"}');
  const p = file({ schema: 1, fields: {}, providers: { copilot: { githubToken: 'gho_x' } } });
  const r = await run(['--from', p]);
  assert.equal(r.code, 2);
  assert.match(r.errs.join('\n'), /“providers”/);
  assert.equal(readFileSync(settingsPath, 'utf8'), '{"uiLevel":"simple"}');
});

test('bare `worca setup` prints help and exits 2; the CLI dispatches setup', async () => {
  fresh();
  assert.equal((await run([])).code, 2);
  const env = { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home };
  delete env.WORCA_HOST_PID; delete env.NODE_TEST_CONTEXT;
  const help = spawnSync(process.execPath, [CLI, 'setup', 'help'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /worca setup --from/);
});
