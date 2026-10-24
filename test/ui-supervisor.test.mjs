// test/ui-supervisor.test.mjs
// The `worca ui` loop around ui/server.mjs (issue #841): plain exits, the update handoff, install
// failure, a pre-1.14 target, junk requests, the spin guard, a stop during the install and the dry
// run. startServer and install are scripted fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { superviseUi } from '../src/core/ui-supervisor.mjs';
import { UPDATE_EXIT_CODE } from '../src/core/ui-update.mjs';

function rig({ exits, install = async () => ({ ok: true, output: '' }), record = { state: 'requested', from: '1.14.0', to: '1.15.0', port: 4317 } }) {
  const starts = []; const writes = []; const logs = []; let rec = record;
  return {
    starts, writes, logs, get rec() { return rec; },
    opts: {
      startServer: async () => { starts.push(rec?.state ?? null); return exits.shift() ?? 0; },
      install: async (v, o) => { writes.push({ install: v }); return install(v, o); },
      readRecord: () => rec,
      writeRecord: (r) => { rec = r; writes.push(r.state); },
      log: (s) => logs.push(s),
      now: () => '2026-10-23T12:00:00.000Z',
    },
  };
}

test('a plain exit ends the loop with that code; no install', async () => {
  const r = rig({ exits: [143] });
  assert.equal(await superviseUi(r.opts), 143);
  assert.equal(r.starts.length, 1);
});

test('update: install, then start the server again (new code), then return its exit', async () => {
  const r = rig({ exits: [UPDATE_EXIT_CODE, 0] });
  assert.equal(await superviseUi(r.opts), 0);
  assert.deepEqual(r.writes, ['installing', { install: '1.15.0' }, 'installed']);
  assert.equal(r.starts.length, 2);
  assert.equal(r.rec.autoRestart, true);
});

test('install failure: records reason + output, starts the previous version again', async () => {
  const r = rig({ exits: [UPDATE_EXIT_CODE, 0], install: async () => ({ ok: false, reason: 'npm could not write to /x (EACCES)', output: 'npm error code EACCES' }) });
  assert.equal(await superviseUi(r.opts), 0);
  assert.equal(r.rec.state, 'failed');
  assert.equal(r.rec.reason, 'npm could not write to /x (EACCES)');
  assert.equal(r.rec.output, 'npm error code EACCES');
  assert.equal(r.starts.length, 2, 'the old server starts again');
  assert.match(r.logs.join('\n'), /Starting Worca 1\.14\.0 again/);
});

test('target older than 1.14.0: installs, does not start again, prints the start command with the port', async () => {
  const r = rig({ exits: [UPDATE_EXIT_CODE], record: { state: 'requested', from: '1.14.0', to: '1.13.1', port: 4400 } });
  assert.equal(await superviseUi(r.opts), 0);
  assert.equal(r.starts.length, 1);
  assert.equal(r.rec.state, 'installed');
  assert.equal(r.rec.autoRestart, false);
  assert.match(r.logs.join('\n'), /worca ui --port 4400/);
});

test('exit 75 with no valid request restarts as-is, without npm; a junk version is never installed', async () => {
  for (const record of [null, { state: 'installing', to: '1.15.0' }, { state: 'requested', to: '1.15.0; rm -rf /' }]) {
    const r = rig({ exits: [UPDATE_EXIT_CODE, 0], record });
    assert.equal(await superviseUi(r.opts), 0);
    assert.equal(r.writes.some((w) => w.install), false);
    assert.equal(r.starts.length, 2);
  }
});

test('repeated exit 75 with no valid request stops after 3 tries instead of spinning', async () => {
  const r = rig({ exits: [UPDATE_EXIT_CODE, UPDATE_EXIT_CODE, UPDATE_EXIT_CODE, 0], record: null });
  assert.equal(await superviseUi(r.opts), 1);
  assert.equal(r.starts.length, 3);
});

test('a signal during the install stops the loop and records the stop', async () => {
  const ac = new AbortController();
  const r = rig({ exits: [UPDATE_EXIT_CODE, 0], install: async () => { ac.abort(); return { ok: false, reason: 'npm failed', output: '' }; } });
  assert.equal(await superviseUi({ ...r.opts, signal: ac.signal }), 130);
  assert.equal(r.rec.state, 'failed');
  assert.match(r.rec.reason, /stopped/);
  assert.equal(r.starts.length, 1);
});

test('dry run skips npm and restarts', async () => {
  const r = rig({ exits: [UPDATE_EXIT_CODE, 0] });
  await superviseUi({ ...r.opts, dryRun: true });
  assert.equal(r.writes.some((w) => w.install), false);
  assert.equal(r.rec.state, 'installed');
});
