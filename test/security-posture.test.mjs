// test/security-posture.test.mjs — src/core/security-posture.mjs: the posture Worca's own server process can see
// (Settings › General › Security, #1619), the hardened-box switch, the box image read from inside, and the box
// image's ENV line (box-image.mjs renderBoxDockerfile). Pure: env objects only, no docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityPosture, whereWorcaRuns, isHardenedBox, boxImageInside, parseBoxImageProjects, HARDENED_CLONE_ONLY_TEXT } from '../src/core/security-posture.mjs';
import { renderBoxDockerfile, boxImageProjectsValue } from '../src/core/exec-env/box-image.mjs';
import { normalizeEnvSpec } from '../src/core/exec-env/env-spec.mjs';
import { detectBuiltins } from '../src/core/actions/builtins.mjs';

const H1 = `sha256:${'a'.repeat(64)}`;
const H2 = `sha256:${'b'.repeat(64)}`;
const rowOf = (p, id) => p.rows.find((r) => r.id === id);
const HARDENED = { WORCA_BOX: 'hardened', WORCA_CONTAINER: '1', WORCA_DATA_DIR: '/data', WORCA_BROKER_URL: 'http://broker:8080',
  WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/data/agent-home', HTTPS_PROXY: 'http://egress:3128', WORCA_EGRESS_API_URL: 'http://egress:3129' };

test('whereWorcaRuns: native, container, hardened (WORCA_BOX wins), hosted', () => {
  assert.equal(whereWorcaRuns({}), 'native');
  assert.equal(whereWorcaRuns({ WORCA_CONTAINER: '1' }), 'container');
  assert.equal(whereWorcaRuns({ WORCA_CONTAINER: '1', WORCA_BOX: 'hardened' }), 'hardened');
  assert.equal(whereWorcaRuns({}, { remoteMode: true }), 'hosted');
  assert.equal(isHardenedBox({ WORCA_BOX: ' Hardened ' }), true);
  assert.equal(isHardenedBox({ WORCA_BOX: 'plain' }), false);
  assert.match(HARDENED_CLONE_ONLY_TEXT, /clon/);
});

test('a native install: nothing on, Local says not sandboxed, no box image', () => {
  const p = securityPosture({ env: {}, proxy: { state: 'not-configured' } });
  assert.equal(p.where, 'native');
  assert.equal(p.whereLabel, 'Native install');
  assert.deepEqual(p.rows.map((r) => r.id), ['where', 'broker', 'agents', 'network', 'proxy', 'exec-env']);
  assert.equal(rowOf(p, 'broker').status, 'off');
  assert.equal(rowOf(p, 'agents').status, 'off');
  assert.equal(rowOf(p, 'network').value, 'Open');
  assert.equal(rowOf(p, 'proxy').value, 'No proxy');
  assert.equal(rowOf(p, 'exec-env').status, 'off');
  assert.match(rowOf(p, 'exec-env').detail, /not sandboxed/);
  assert.deepEqual(p.execEnv, { name: 'local', label: 'Local', sandboxed: false });
  assert.equal(p.boxImage, null);
});

test('a native install with a Docker default and a saved proxy login on this machine', () => {
  const p = securityPosture({ env: {}, execEnvDefault: 'docker', execEnvLabel: 'Local sandbox (Docker)',
    proxy: { state: 'ready', upstream: 'proxy.acme.example:8080', login: { label: 'ACME\\ann' } } });
  assert.equal(rowOf(p, 'exec-env').status, 'on');
  assert.equal(rowOf(p, 'exec-env').value, 'Local sandbox (Docker)');
  assert.equal(p.execEnv.sandboxed, true);
  assert.equal(rowOf(p, 'proxy').value, 'This machine');
  assert.match(rowOf(p, 'proxy').detail, /ACME\\ann/);
});

test('the hardened box: broker, agent users, the allow-list and the sidecar login all on', () => {
  const p = securityPosture({ env: HARDENED, proxy: { sidecar: true, state: 'ready', upstream: 'proxy.acme.example:8080' } });
  assert.equal(p.where, 'hardened');
  for (const id of ['where', 'broker', 'agents', 'network', 'proxy']) assert.equal(rowOf(p, id).status, 'on', id);
  assert.equal(rowOf(p, 'network').value, 'Allow-list');
  assert.equal(rowOf(p, 'proxy').value, 'Sidecar');
  assert.match(rowOf(p, 'agents').detail, /worca-agent/);
  assert.match(rowOf(p, 'exec-env').detail, /inside this hardened box/);
});

test('the sidecar: managed by the operator, or not answering (unknown)', () => {
  assert.equal(rowOf(securityPosture({ env: HARDENED, proxy: { sidecar: true, managed: true, state: 'needs-login', upstream: 'p:1' } }), 'proxy').value, 'Operator');
  const down = rowOf(securityPosture({ env: HARDENED, proxy: { sidecar: true, state: 'error', error: 'connect ECONNREFUSED' } }), 'proxy');
  assert.equal(down.status, 'unknown');
  assert.match(down.detail, /ECONNREFUSED/);
});

test('a plain container through the sidecar: the allow-list is unknown from inside', () => {
  const p = securityPosture({ env: { WORCA_CONTAINER: '1', HTTPS_PROXY: 'http://egress:3128' } });
  assert.equal(p.where, 'container');
  assert.equal(rowOf(p, 'network').status, 'unknown');
  assert.equal(rowOf(p, 'proxy').status, 'unknown', 'no proxy status passed and no sidecar API: not checked');
});

test("Worca's own egress policy (WORCA_EGRESS_MODE) is an allow-list or a deny list", () => {
  assert.equal(rowOf(securityPosture({ env: { WORCA_EGRESS_MODE: 'allow', WORCA_EGRESS_ALLOW: 'github.com,.acme.example' } }), 'network').value, 'Allow-list');
  assert.equal(rowOf(securityPosture({ env: { WORCA_EGRESS_MODE: 'block' } }), 'network').value, 'Deny list');
});

test('boxImageInside: none, unknown without the ENV line, current, stale', () => {
  assert.equal(boxImageInside({ env: {} }), null);
  assert.equal(boxImageInside({ env: { WORCA_BOX_IMAGE: 'worca-box:0123456789ab' } }).state, 'unknown');
  const env = { WORCA_BOX_IMAGE: 'worca-box:0123456789ab', WORCA_BOX_IMAGE_PROJECTS: `acme-web=${H1},acme-api=${H2}` };
  const cur = boxImageInside({ env, specHashOf: (k) => ({ 'acme-web': H1, 'acme-api': H2 })[k] });
  assert.equal(cur.state, 'current');
  assert.equal(cur.command, 'worca container build');
  const stale = boxImageInside({ env, specHashOf: (k) => (k === 'acme-web' ? H2 : null) });
  assert.equal(stale.state, 'stale');
  assert.deepEqual(stale.reasons, ['project acme-web changed its environment spec', 'project acme-api no longer has an environment spec']);
  // In a container the posture carries it; a native install never does.
  assert.equal(securityPosture({ env: { ...env, WORCA_CONTAINER: '1' }, specHashOf: () => H1 }).boxImage.image, 'worca-box:0123456789ab');
  assert.equal(securityPosture({ env }).boxImage, null);
});

test('parseBoxImageProjects drops junk; boxImageProjectsValue round-trips and renderBoxDockerfile writes the ENV line', () => {
  assert.deepEqual(parseBoxImageProjects(`a=${H1}, bad, b=sha256:short, =${H2}`), [{ key: 'a', specHash: H1 }]);
  const value = boxImageProjectsValue([{ key: 'acme-web', specHash: H1 }, { key: 'x y', specHash: H2 }]);
  assert.equal(value, `acme-web=${H1}`);
  const spec = normalizeEnvSpec({ tools: [{ name: 'node', version: '22.19.0' }], apt: [] });
  const withProjects = renderBoxDockerfile({ base: 'ghcr.io/worca-org/worca:1.21.0', spec, projects: [{ key: 'acme-web', specHash: spec.hash }] });
  assert.match(withProjects, new RegExp(`^ENV WORCA_BOX_IMAGE_PROJECTS="acme-web=${spec.hash}"$`, 'm'));
  assert.doesNotMatch(renderBoxDockerfile({ base: 'ghcr.io/worca-org/worca:1.21.0', spec }), /WORCA_BOX_IMAGE_PROJECTS/);
});

test('the hardened box offers no editor, terminal or file manager, a saved command line included', () => {
  const env = { PATH: '/usr/bin', WORCA_BOX: 'hardened', DISPLAY: ':0' };
  const d = detectBuiltins({ platform: 'linux', env, exists: () => true, overrides: { editor: 'code {folder}' } });
  assert.deepEqual([d.editor, d.terminal, d.fileManager], [null, null, null]);
  assert.ok(detectBuiltins({ platform: 'linux', env: { ...env, WORCA_BOX: '' }, exists: () => true }).editor);
});
