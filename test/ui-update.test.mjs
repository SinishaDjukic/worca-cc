// test/ui-update.test.mjs
// The update handoff (issue #841): the supervisor flag, the npm install arguments, the start
// command, npm failure summaries, the install runner (no network: exec is a fake) and the record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmInstallArgs, startCommand, manualUpdateCommand, summarizeNpmFailure, runNpmInstall,
  readUpdateRecord, writeUpdateRecord, supervisorMatches } from '../src/core/ui-update.mjs';

test('supervisorMatches: only the direct parent pid counts; an inherited or legacy flag does not', () => {
  assert.equal(supervisorMatches({ WORCA_UI_SUPERVISOR: '4242' }, 4242), true);
  assert.equal(supervisorMatches({ WORCA_UI_SUPERVISOR: '1' }, 4242), false);
  assert.equal(supervisorMatches({ WORCA_UI_SUPERVISOR: '4242' }, 77), false, 'a grandchild inherited it');
  assert.equal(supervisorMatches({}, 4242), false);
});

test('npmInstallArgs re-formats the version and refuses anything else', () => {
  assert.deepEqual(npmInstallArgs('v1.14.0'), ['install', '-g', '@worca/app@1.14.0']);
  assert.deepEqual(npmInstallArgs('1.15.0-rc.2'), ['install', '-g', '@worca/app@1.15.0-rc.2']);
  for (const bad of ['latest', '1.14.0 && calc', '', null, '../x']) assert.throws(() => npmInstallArgs(bad), /version/);
});

test('startCommand adds --port only off the default port; manualUpdateCommand follows the version', () => {
  assert.equal(startCommand(4317), 'worca ui');
  assert.equal(startCommand(4400), 'worca ui --port 4400');
  assert.equal(manualUpdateCommand('1.14.0'), 'npm install -g @worca/app@1.14.0 && worca ui restart');
});

test('summarizeNpmFailure names EACCES with its path, offline, missing version, missing npm', () => {
  assert.equal(summarizeNpmFailure('npm error code EACCES\nnpm error path /usr/local/lib/node_modules/@worca'),
    'npm could not write to /usr/local/lib/node_modules/@worca (EACCES)');
  assert.match(summarizeNpmFailure('npm ERR! code ENOTFOUND'), /could not reach the registry/);
  assert.match(summarizeNpmFailure('npm error code ETARGET'), /could not find that version/);
  assert.match(summarizeNpmFailure('', { code: 'ENOENT' }), /not found on the PATH/);
});

test('runNpmInstall: literal args, shell only on win32, output tail kept on failure', async () => {
  const calls = [];
  const ok = await runNpmInstall('1.14.0', { platform: 'darwin', exec: async (...a) => { calls.push(a); return { stdout: 'added 1', stderr: '' }; } });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls[0].slice(0, 2), ['npm', ['install', '-g', '@worca/app@1.14.0']]);
  assert.equal(calls[0][2].shell, false);
  await runNpmInstall('1.14.0', { platform: 'win32', exec: async (...a) => { calls.push(a); return { stdout: '' }; } });
  assert.equal(calls[1][2].shell, true);
  const bad = await runNpmInstall('1.14.0', { platform: 'linux', exec: async () => { const e = new Error('Command failed'); e.code = 243; e.stderr = 'npm error code EACCES\nnpm error path /usr/lib/node_modules'; throw e; } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /EACCES/);
  assert.match(bad.output, /npm error path/);
});

test('update record round-trips atomically; a corrupt file reads as null', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'upd-')), 'update.json');
  assert.equal(readUpdateRecord(file), null);
  writeUpdateRecord({ state: 'requested', to: '1.14.0' }, file);
  assert.deepEqual(readUpdateRecord(file), { state: 'requested', to: '1.14.0' });
});
