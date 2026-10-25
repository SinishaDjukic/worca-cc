// test/opencode-plugin-guard.test.mjs — OpenCode 1.18 loads `.opencode/plugin(s)/*.js` from its project folder and each
// folder above it (up to the repository's top, or `/` outside one) although OPENCODE_DISABLE_PROJECT_CONFIG=1 and
// --pure are set (test/fixtures/opencode/README.md). worca refuses the spawn instead (audit 3.1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opencodePluginDirs, runOpencodeProcess } from '../src/core/engines/opencode.mjs';
import { fakeOpencode } from './helpers/fake-opencode.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const POSIX = { skip: process.platform === 'win32' ? 'POSIX fake binary' : false };
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-oc-plugins-')); dirs.push(d); return d; };
const plugin = (dir, sub = 'plugin') => { mkdirSync(join(dir, '.opencode', sub), { recursive: true }); writeFileSync(join(dir, '.opencode', sub, 'p.js'), ''); };

test('opencodePluginDirs: the project folder and each folder above it, up to the repository\'s top', () => {
  const top = tmp();
  const repo = join(top, 'repo'); const step = join(repo, 'pkg', 'app');
  mkdirSync(join(repo, '.git'), { recursive: true }); mkdirSync(step, { recursive: true });
  plugin(top);                         // above the repository: OpenCode stops at the folder holding .git
  assert.deepEqual(opencodePluginDirs(step), []);
  plugin(step); plugin(join(repo, 'pkg'), 'plugins'); plugin(repo);
  assert.deepEqual(opencodePluginDirs(step), [
    join(step, '.opencode', 'plugin'), join(repo, 'pkg', '.opencode', 'plugins'), join(repo, '.opencode', 'plugin')]);
});

test('opencodePluginDirs: outside a repository every folder up to the root counts; a link counts too', () => {
  const top = tmp();
  const deep = join(top, 'a', 'b');
  mkdirSync(deep, { recursive: true });
  mkdirSync(join(top, '.opencode'));
  symlinkSync(join(top, 'nowhere'), join(top, '.opencode', 'plugins'));
  assert.deepEqual(opencodePluginDirs(deep), [join(top, '.opencode', 'plugins')]);
});

test('a run step and a chat are refused while a plugin folder exists; OpenCode never starts', POSIX, async () => {
  const cwd = tmp(); mkdirSync(join(cwd, '.git'));
  plugin(cwd);
  const fake = fakeOpencode(tmp(), 'done');
  await assert.rejects(runOpencodeProcess({ cwd, bin: fake.bin, prompt: 'go', model: 'anthropic/x' }), /would load the plugin code in .*\.opencode\/plugin/);
  await assert.rejects(runOpencodeProcess({ cwd, bin: fake.bin, prompt: 'go', model: 'anthropic/x', askLockdown: true, sandbox: 'read-only' }), /would load the plugin code/);
  assert.equal(fake.record(), null, 'opencode never ran');
  rmSync(join(cwd, '.opencode'), { recursive: true });
  assert.equal((await runOpencodeProcess({ cwd, bin: fake.bin, prompt: 'go', model: 'anthropic/x' })).text, 'done');
});
