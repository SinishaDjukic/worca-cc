// test/compose-auth.test.mjs
// docker/compose.auth.yml + docker/oauth2-proxy.yaml (docs/auth.md): oauth2-proxy in front of
// worca, the ID token in X-Worca-Identity, worca's WORCA_IDENTITY_* set from the same .env values
// the proxy reads. The proxy's file and the Helm chart's rendering of it (templates/auth.yaml)
// must agree on everything but the values, so the two deployments behave the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// What oauth2-proxy does to its alpha config before parsing it (a8m/envsubst: unset -> empty).
const envsubst = (text, env) => text.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => env[k] ?? '');
const ENV = {
  WORCA_OIDC_CLIENT_ID: 'worca', WORCA_OIDC_CLIENT_SECRET: 's3cret~x.y', WORCA_OIDC_SCOPE: 'openid email profile',
  WORCA_AUTH_ALLOWED_GROUPS: 'team-a,team-b', WORCA_OIDC_ISSUER_URL: 'https://idp.example.com/realms/w',
  WORCA_OIDC_JWKS_URL: 'https://idp.example.com/realms/w/protocol/openid-connect/certs',
  WORCA_OIDC_EMAIL_CLAIM: 'email', WORCA_OIDC_TEAMS_CLAIM: 'roles',
};
const proxyConfig = (env = ENV) => YAML.parse(envsubst(read('docker/oauth2-proxy.yaml'), env));

test('oauth2-proxy.yaml: one upstream (worca, Host passed, WebSockets), the ID token as X-Worca-Identity, the values from the environment', () => {
  const cfg = proxyConfig();
  assert.deepEqual(cfg.upstreamConfig.upstreams, [{ id: 'worca', path: '/', uri: 'http://worca:4317', passHostHeader: true, proxyWebSockets: true }]);
  assert.deepEqual(cfg.injectRequestHeaders, [{ name: 'X-Worca-Identity', values: [{ claimSource: { claim: 'id_token' } }] }]);
  const [p] = cfg.providers;
  assert.equal(p.clientSecret, 's3cret~x.y');
  assert.deepEqual(p.allowedGroups, ['team-a', 'team-b']);
  assert.equal(p.oidcConfig.groupsClaim, 'roles');
  assert.equal(p.oidcConfig.insecureSkipNonce, false);
  assert.deepEqual(proxyConfig({ ...ENV, WORCA_AUTH_ALLOWED_GROUPS: '' }).providers[0].allowedGroups, [], 'empty: everyone the provider signs in');
});

test('compose.auth.yml: worca verifies the same issuer, client and claims the proxy uses; required values fail loudly', () => {
  const c = read('docker/compose.auth.yml');
  for (const [worcaVar, envVar] of [['WORCA_IDENTITY_ISSUER', 'WORCA_OIDC_ISSUER_URL'], ['WORCA_IDENTITY_JWKS_URL', 'WORCA_OIDC_JWKS_URL'], ['WORCA_IDENTITY_AUDIENCE', 'WORCA_OIDC_CLIENT_ID'], ['WORCA_ALLOWED_HOSTS', 'WORCA_AUTH_HOST']]) {
    assert.match(c, new RegExp(`${worcaVar}: \\$\\{${envVar}:\\?`), `${worcaVar} from ${envVar}, required`);
  }
  assert.match(c, /WORCA_IDENTITY_TEAMS_CLAIM: \$\{WORCA_OIDC_TEAMS_CLAIM:-groups\}/);
  assert.match(c, /WORCA_OIDC_TEAMS_CLAIM: \$\{WORCA_OIDC_TEAMS_CLAIM:-groups\}/, 'the proxy gets the same default');
  assert.match(c, /image: quay\.io\/oauth2-proxy\/oauth2-proxy:\$\{WORCA_OAUTH2_PROXY_TAG:-v\d+\.\d+\.\d+\}/, 'pinned');
  assert.match(c, /"\$\{WORCA_AUTH_BIND:-127\.0\.0\.1\}:/, 'loopback by default');
  assert.match(c, /\n  worca:\n    ports: !reset \[\]\n/, "compose.yml's published port is dropped");
  assert.doesNotMatch(c, /OAUTH2_PROXY_(CLIENT_|PROVIDER\b|SCOPE|ALLOWED_|UPSTREAMS|OIDC_)/, 'no option --alpha-config refuses');
  const helm = read('deploy/helm/worca/values.yaml').match(/repository: oauth2-proxy\/oauth2-proxy\n\s+tag: (v[\d.]+)/)[1];
  assert.match(c, new RegExp(`WORCA_OAUTH2_PROXY_TAG:-${helm.replaceAll('.', '\\.')}\\}`), 'Compose and Helm pin the same proxy');
});

const onPath = (bin) => (process.env.PATH || '').split(delimiter).some((d) => d && existsSync(join(d, bin)));

test('the Helm chart renders the same proxy configuration (structure and constants) as the Compose file', { skip: onPath('helm') ? false : 'helm is not on PATH' }, () => {
  const r = spawnSync('helm', ['template', 'worca', join(ROOT, 'deploy/helm/worca'), '-n', 'ns', '-f', join(ROOT, 'test/fixtures/helm/values-auth.yaml')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const cm = YAML.parseAllDocuments(r.stdout).map((d) => d.toJS()).find((d) => d?.kind === 'ConfigMap' && d.metadata.name === 'worca-auth');
  const helm = YAML.parse(cm.data['oauth2-proxy.yaml']);
  const compose = proxyConfig();
  // Shape: the same keys everywhere, except what only one side has by design.
  const shape = (o, drop = []) => (Array.isArray(o) ? o.map((x) => shape(x, drop)) : o && typeof o === 'object'
    ? Object.fromEntries(Object.keys(o).filter((k) => !drop.includes(k)).sort().map((k) => [k, shape(o[k], drop)])) : typeof o);
  const drop = ['clientSecret', 'clientSecretFile', 'caFiles', 'useSystemTrustStore', 'uri'];
  assert.deepEqual(shape(helm, drop), shape(compose, drop));
  assert.deepEqual(helm.injectRequestHeaders, compose.injectRequestHeaders);
  for (const k of ['provider', 'code_challenge_method', 'id', 'name']) assert.equal(helm.providers[0][k], compose.providers[0][k], k);
  assert.deepEqual(helm.providers[0].oidcConfig.audienceClaims, compose.providers[0].oidcConfig.audienceClaims);
});

test('docker compose renders compose.yml + compose.auth.yml (when Docker is usable)', (t) => {
  const env = { ...process.env, WORCA_PROJECTS: tmpdir(), WORCA_AUTH_HOST: 'worca.example.com', WORCA_OIDC_ISSUER_URL: ENV.WORCA_OIDC_ISSUER_URL,
    WORCA_OIDC_JWKS_URL: ENV.WORCA_OIDC_JWKS_URL, WORCA_OIDC_CLIENT_ID: 'worca', WORCA_OIDC_CLIENT_SECRET: 's', WORCA_AUTH_COOKIE_SECRET: 'x'.repeat(32), WORCA_OIDC_TEAMS_CLAIM: 'roles' };
  const r = spawnSync('docker', ['compose', '-f', 'compose.yml', '-f', 'compose.auth.yml', 'config', '--format', 'json'], { cwd: join(ROOT, 'docker'), encoding: 'utf8', env, timeout: 60000 });
  if (r.error || r.status !== 0) { t.diagnostic(`docker compose is not usable here (${r.error?.message || r.stderr.trim().split('\n').pop()}): not rendered`); return; }
  const svc = JSON.parse(r.stdout).services;
  assert.equal(svc.worca.environment.WORCA_ALLOWED_HOSTS, 'worca.example.com');
  assert.equal(svc.worca.environment.WORCA_IDENTITY_TEAMS_CLAIM, 'roles');
  assert.equal(svc['oauth2-proxy'].environment.WORCA_OIDC_TEAMS_CLAIM, 'roles');
  assert.equal(svc['oauth2-proxy'].environment.OAUTH2_PROXY_REDIRECT_URL, 'https://worca.example.com/oauth2/callback');
  assert.equal(svc['oauth2-proxy'].ports[0].host_ip, '127.0.0.1');
  assert.equal(svc.worca.ports, undefined, "worca's own port is not published: the proxy is the only way in");
  const missing = spawnSync('docker', ['compose', '-f', 'compose.yml', '-f', 'compose.auth.yml', 'config'], { cwd: join(ROOT, 'docker'), encoding: 'utf8', env: { ...env, WORCA_OIDC_CLIENT_ID: '' }, timeout: 60000 });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /WORCA_OIDC_CLIENT_ID/);
});
