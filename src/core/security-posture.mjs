// src/core/security-posture.mjs — the instance's security posture as Worca's own server process sees it
// (GET /api/security/posture: Settings › General › Security, the setup assistant's "Where agents run" in a box;
// docs/security-overview.md). `worca container status` (src/cli/container-hardened.mjs) reads the running box from
// the host through docker; this module never calls docker. It reads the process environment the compose files set
// and a few facts the caller passes in, and says "unknown" for what only the host can see.
//
// Pure apart from boxImageInside's spec lookup, which the caller injects.
import { brokerEnabled } from './broker-client.mjs';
import { agentIdentity } from './agent-user.mjs';
import { readEgressPolicy } from './egress-proxy.mjs';
import { sidecarConfigured } from './egress-sidecar-client.mjs';
import { detectDeployment } from './deployment.mjs';

/** compose.hardened.yml sets WORCA_BOX=hardened on Worca's container (the label alone is invisible from inside). */
export const BOX_VAR = 'WORCA_BOX';
/** compose.image.yml passes the box image's tag (WORCA_IMAGE in the container .env) to Worca. */
export const BOX_IMAGE_VAR = 'WORCA_BOX_IMAGE';
/** The box image's Dockerfile (box-image.mjs renderBoxDockerfile) records each project's spec hash it was built for. */
export const BOX_IMAGE_PROJECTS_VAR = 'WORCA_BOX_IMAGE_PROJECTS';
export const REBUILD_COMMAND = 'worca container build';
const SIDECAR_PROXY = 'http://egress:3128';

/** True inside the hardened box (docs/hardened-box.md). */
export function isHardenedBox(env = process.env) {
  return String(env[BOX_VAR] || '').trim().toLowerCase() === 'hardened';
}

/** Add project in the hardened box: clone only (POST /api/projects, /bulk and the chat's add card refuse a folder). */
export const HARDENED_CLONE_ONLY_TEXT = 'In the hardened box, add a project by cloning it from its remote (Clone from URL). A folder here is on the box\'s own disk, not on your machine.';

/** native | container | hardened | hosted: where this Worca runs. */
export function whereWorcaRuns(env = process.env, { remoteMode = false } = {}) {
  if (isHardenedBox(env)) return 'hardened';
  const d = detectDeployment(env, { remoteMode });
  return d === 'local' ? 'native' : d;
}

const STATUS_VALUE = Object.freeze({ on: 'On', off: 'Off', unknown: 'Unknown' });
export const WHERE_LABEL = Object.freeze({ native: 'Native install', container: 'Container', hardened: 'Hardened box', hosted: 'Hosted' });

/** `key=sha256:…,key=sha256:…` → [{ key, specHash }] (junk entries dropped). */
export function parseBoxImageProjects(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    return i > 0 ? { key: s.slice(0, i), specHash: s.slice(i + 1) } : null;
  }).filter((p) => p && /^sha256:[0-9a-f]{64}$/.test(p.specHash));
}

/**
 * The box image this container runs, as far as Worca inside it can tell: the tag compose passed and, per project the
 * image was built for, whether its spec still matches. A newer base image is visible only on the host
 * (`worca container build --status`). null when the box does not run a built image.
 * @param {{env?: object, specHashOf?: (key: string) => string|null}} o
 * @returns {null | {image: string, state: 'current'|'stale'|'unknown', reasons: string[], command: string, note: string}}
 */
export function boxImageInside({ env = process.env, specHashOf = () => null } = {}) {
  const image = String(env[BOX_IMAGE_VAR] || '').trim();
  if (!image) return null;
  const note = `A newer base image shows only on the host: ${REBUILD_COMMAND} --status.`;
  const projects = parseBoxImageProjects(env[BOX_IMAGE_PROJECTS_VAR]);
  if (!projects.length) return { image, state: 'unknown', reasons: ['the image does not say which project specs it was built from'], command: REBUILD_COMMAND, note };
  const reasons = [];
  for (const p of projects) {
    let now = null;
    try { now = specHashOf(p.key); } catch { now = null; }
    if (!now) reasons.push(`project ${p.key} no longer has an environment spec`);
    else if (now !== p.specHash) reasons.push(`project ${p.key} changed its environment spec`);
  }
  return { image, state: reasons.length ? 'stale' : 'current', reasons, command: REBUILD_COMMAND, note };
}

/**
 * One row per protection. status: on | off | unknown; detail is one plain sentence.
 * @param {object} o
 * @param {object} [o.env]
 * @param {boolean} [o.remoteMode]
 * @param {string} [o.execEnvDefault]     the saved default execution environment ('local' when unset)
 * @param {string} [o.execEnvLabel]       its label ("Local sandbox (Docker)")
 * @param {object|null} [o.proxy]         proxyHost.status() (state, upstream, login, managed, sidecar), or null
 * @param {(key: string) => string|null} [o.specHashOf]
 * @returns {{where: string, whereLabel: string, rows: {id: string, label: string, status: string, value: string, detail: string}[],
 *   execEnv: {name: string, label: string, sandboxed: boolean}, boxImage: object|null}}
 */
export function securityPosture({ env = process.env, remoteMode = false, execEnvDefault = 'local', execEnvLabel = null,
  proxy = null, specHashOf = () => null } = {}) {
  const where = whereWorcaRuns(env, { remoteMode });
  const rows = [];
  const row = (id, label, status, detail, value) => rows.push({ id, label, status, value: value || STATUS_VALUE[status], detail });

  row('where', 'Where Worca runs', where === 'native' ? 'off' : 'on', {
    native: 'Directly on this machine, as your user: agents can reach what you can.',
    container: 'In a container: agents see only its volumes and what is mounted into it.',
    hardened: 'In the hardened box: no host folder is mounted, projects are cloned into its volume.',
    hosted: 'On a hosted server, behind an identity proxy.',
  }[where], WHERE_LABEL[where]);

  if (brokerEnabled(env)) row('broker', 'Credential broker', 'on', 'The broker holds the model key; Worca and its agents hold none.');
  else row('broker', 'Credential broker', 'off', 'The model key or sign-in is on this machine, where agents run.');

  const agent = agentIdentity(env);
  if (agent) row('agents', 'Agent users', 'on', `Agents run as ${agent.user}: they cannot read Worca's settings, database or environment.`);
  else row('agents', 'Agent users', 'off', where === 'native' ? 'Agents run as your user.' : "Agents run as Worca's own user.");

  const policy = readEgressPolicy(env);
  const viaSidecar = [env.HTTPS_PROXY, env.https_proxy].some((v) => String(v || '').startsWith(SIDECAR_PROXY));
  if (policy.enforced) row('network', 'Outbound network', 'on', policy.mode === 'block' ? 'Worca\'s egress proxy allows every host but the deny list.' : `Allow-list: Worca's egress proxy lets through ${policy.allow.length || 'the listed'} hosts.`, policy.mode === 'block' ? 'Deny list' : 'Allow-list');
  else if (where === 'hardened') row('network', 'Outbound network', 'on', 'Allow-list: the box has no route out; the egress sidecar lets through the listed hosts. worca container status checks it from the host.', 'Allow-list');
  else if (viaSidecar) row('network', 'Outbound network', 'unknown', 'Through the egress sidecar. Whether it runs an allow-list shows only on the host: worca container status.', 'Sidecar');
  else row('network', 'Outbound network', 'off', 'Agents can reach any host.', 'Open');

  const p = proxy && typeof proxy === 'object' ? proxy : null;
  if (sidecarConfigured(env) || p?.sidecar) {
    if (p && p.state === 'error') row('proxy', 'Proxy login', 'unknown', `In the egress sidecar, which did not answer${p.error ? `: ${p.error}` : ''}.`, 'Sidecar');
    else if (p && p.managed) row('proxy', 'Proxy login', 'on', 'In the egress sidecar, managed by the operator. Worca never holds it.', 'Operator');
    else row('proxy', 'Proxy login', 'on', p && !p.upstream ? 'No corporate proxy: the egress sidecar relays direct.' : 'In the egress sidecar. Worca never holds it.', 'Sidecar');
  } else if (!p) row('proxy', 'Proxy login', 'unknown', 'Not checked.');
  else if (!p.upstream || p.state === 'off' || p.state === 'not-configured') row('proxy', 'Proxy login', 'on', 'No corporate proxy.', 'No proxy');
  else if (p.login) row('proxy', 'Proxy login', 'on', `On this machine, in Worca's local proxy (${p.login.label || 'saved login'}). Agents get a local proxy address, never the login.`, 'This machine');
  else row('proxy', 'Proxy login', 'on', `The proxy ${p.upstream} needs no saved login.`, 'No login');

  const name = typeof execEnvDefault === 'string' && execEnvDefault ? execEnvDefault : 'local';
  const label = execEnvLabel || (name === 'local' ? 'Local' : name);
  const sandboxed = name !== 'local' || where !== 'native';
  row('exec-env', 'Default execution environment', sandboxed ? 'on' : 'off',
    name !== 'local' ? `${label}: each run's agents work in their own sandbox.`
      : where === 'native' ? 'Local: agents run on this machine, not sandboxed.' : `Local: agents run inside this ${WHERE_LABEL[where].toLowerCase()}.`, label);

  const boxImage = where === 'native' || where === 'hosted' ? null : boxImageInside({ env, specHashOf });
  return { where, whereLabel: WHERE_LABEL[where], rows, execEnv: { name, label, sandboxed }, boxImage };
}
