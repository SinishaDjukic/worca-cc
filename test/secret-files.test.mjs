// test/secret-files.test.mjs
// The boot check for every secret file Worca reads while agents run under their own users (src/core/secret-files.mjs):
// mode 0600 and Worca's own owner, else one refusal line that names the file and the fix. Each reader records the
// file it read once: the egress sidecar's secret, the GitHub App key (and the broker secret, test/broker-secret-seal).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

import { secretFileProblem, secretFileRefusals, recordSecretFile, recordedSecretFile, _resetSecretFiles, BOX_SECRET_FILES } from '../src/core/secret-files.mjs';
import { sealEgressSecret, _resetSealedEgressSecret, sidecarApiConfig } from '../src/core/egress-sidecar-client.mjs';
import { sealGithubAppKey, _resetSealedGithubAppKey, loadAppConfig } from '../src/core/github-app.mjs';

const dir = mkdtempSync(join(tmpdir(), 'worca-secret-files-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const AGENTS = { WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/data/agent-home' };
const SECRET = 's'.repeat(40);
const posix = process.platform === 'win32' ? 'POSIX modes' : false;
const saved = {};
beforeEach(() => {
  _resetSecretFiles(); _resetSealedEgressSecret(); _resetSealedGithubAppKey();
  for (const k of ['WORCA_EGRESS_SECRET', 'WORCA_EGRESS_SECRET_FILE', 'WORCA_EGRESS_API_URL', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_GH_APP_ID', 'WORCA_GH_APP_KEY_FILE']) {
    if (!(k in saved)) saved[k] = process.env[k];
    delete process.env[k];
  }
});
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

test('secretFileProblem: 0600 and Worca\'s own owner pass; group or other bits, or another owner, refuse with the fix', () => {
  assert.equal(secretFileProblem('X_FILE', { path: '/run/secrets/x', mode: 0o600, uid: 1000 }, 1000), null);
  assert.equal(secretFileProblem('X_FILE', { path: '/run/secrets/x', mode: 0o400, uid: 1000 }, 1000), null);
  const world = secretFileProblem('X_FILE', { path: '/run/secrets/x', mode: 0o644, uid: 1000 }, 1000);
  assert.match(world, /^X_FILE is readable by its group or by others \(mode 0644\): \/run\/secrets\/x\. Agents run under their own users/);
  assert.match(world, /chown 1000:1000 \/run\/secrets\/x && chmod 600 \/run\/secrets\/x/);
  assert.match(secretFileProblem('X_FILE', { path: '/x', mode: 0o640, uid: 1000 }, 1000), /readable by its group/);
  assert.match(secretFileProblem('X_FILE', { path: '/x', mode: 0o620, uid: 1000 }, 1000), /writable by its group or by others \(mode 0620\)/);
  assert.match(secretFileProblem('X_FILE', { path: '/x', mode: 0o600, uid: 0 }, 1000), /owned by uid 0, not by the user Worca runs as \(uid 1000\)/);
  assert.equal(secretFileProblem('X_FILE', { path: '/x', error: 'ENOENT' }, 1000), null, 'an unreadable file fails in its own reader');
  assert.equal(secretFileProblem('X_FILE', null, 1000), null);
  assert.deepEqual([...BOX_SECRET_FILES], ['WORCA_BROKER_SECRET_FILE', 'WORCA_EGRESS_SECRET_FILE', 'WORCA_GH_APP_KEY_FILE']);
});

test('secretFileRefusals: only while agent users are on, for the recorded files', () => {
  recordSecretFile('WORCA_EGRESS_SECRET_FILE', '/run/secrets/e', { stat: () => ({ mode: 0o100644, uid: 1000 }) });
  recordSecretFile('WORCA_GH_APP_KEY_FILE', '/run/secrets/k', { stat: () => ({ mode: 0o100600, uid: 1000 }) });
  assert.equal(secretFileRefusals({ env: {}, uid: 1000 }).length, 0, 'no agent users: no one to keep out');
  const r = secretFileRefusals({ env: AGENTS, uid: 1000 });
  assert.equal(r.length, 1);
  assert.match(r[0], /^WORCA_EGRESS_SECRET_FILE is readable/);
  assert.deepEqual(secretFileRefusals({ env: AGENTS, uid: 1000, names: ['WORCA_GH_APP_KEY_FILE'] }), []);
});

test('the egress secret file: read once, out of the environment, and refused at boot when agents could read it', { skip: posix }, () => {
  const file = join(dir, 'egress_secret');
  writeFileSync(file, SECRET); chmodSync(file, 0o644);
  Object.assign(process.env, AGENTS, { WORCA_EGRESS_SECRET_FILE: file, WORCA_EGRESS_SECRET: '', WORCA_EGRESS_API_URL: 'http://egress:3129' });
  sealEgressSecret();
  assert.equal(process.env.WORCA_EGRESS_SECRET_FILE, undefined, 'no child learns the path');
  assert.equal(process.env.WORCA_EGRESS_SECRET, undefined);
  assert.equal(sidecarApiConfig().secret, SECRET);
  assert.equal(recordedSecretFile('WORCA_EGRESS_SECRET_FILE').mode, 0o644);
  assert.match(secretFileRefusals().join('\n'), /WORCA_EGRESS_SECRET_FILE is readable by its group or by others \(mode 0644\)/);

  _resetSecretFiles(); chmodSync(file, 0o600);
  process.env.WORCA_EGRESS_SECRET_FILE = file;
  sealEgressSecret();
  assert.deepEqual(secretFileRefusals(), [], '0600, owned by this process: boots');
});

test('the GitHub App key file: read once at boot, then used from memory; refused when agents could read it', { skip: posix }, () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const file = join(dir, 'gh_app_key.pem');
  writeFileSync(file, privateKey.export({ type: 'pkcs1', format: 'pem' })); chmodSync(file, 0o640);
  Object.assign(process.env, AGENTS, { WORCA_GH_APP_ID: '12345', WORCA_GH_APP_KEY_FILE: file });
  sealGithubAppKey();
  assert.match(secretFileRefusals().join('\n'), /WORCA_GH_APP_KEY_FILE is readable by its group or by others \(mode 0640\)/);
  rmSync(file);
  assert.equal(loadAppConfig().appId, '12345', 'the key read at boot is used; the file is not read again');
  assert.throws(() => loadAppConfig({ WORCA_GH_APP_ID: '1', WORCA_GH_APP_KEY_FILE: join(dir, 'other.pem') }), /cannot read WORCA_GH_APP_KEY_FILE/, 'another path is its own file');
  delete process.env.WORCA_AGENT_USER;
  assert.deepEqual(secretFileRefusals(), [], 'no agent users: nothing to refuse');
});
