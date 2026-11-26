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
  const note = 'A newer base image shows only on the host.';
  const projects = parseBoxImageProjects(env[BOX_IMAGE_PROJECTS_VAR]);
  if (!projects.length) return { image, state: 'unknown', reasons: ['the image does not say which project specs it was built from'], summary: 'The image does not say which specs it was built from.', command: REBUILD_COMMAND, note };
  const reasons = [];
  for (const p of projects) {
    let now = null;
    try { now = specHashOf(p.key); } catch { now = null; }
    if (!now) reasons.push(`project ${p.key} no longer has an environment spec`);
    else if (now !== p.specHash) reasons.push(`project ${p.key} changed its environment spec`);
  }
  const summary = !reasons.length ? 'Built from the environment specs the projects have now.'
    : reasons.length === 1 ? 'A project changed its environment spec since the build.' : `${reasons.length} projects changed their environment spec since the build.`;
  return { image, state: reasons.length ? 'stale' : 'current', reasons, summary, command: REBUILD_COMMAND, note };
}

/**
 * One row per protection. status: on | off | unknown (what Worca can tell); value: the chip's words, the same on every
 * surface; tone: the chip's colour by the design system's meaning (docs/design-system.md, Colour): `ok` (green) a
 * protection that is active, `neutral` (grey) a plain value or a choice, `attention` (amber) only where someone must
 * act (a protection this setup should have is off, the sidecar does not answer, a stale image). detail is one plain
 * sentence; `title` holds what is not plain words (an address, a raw error) for a tooltip.
 * @param {object} o
 * @param {object} [o.env]
 * @param {boolean} [o.remoteMode]
 * @param {string} [o.execEnvDefault]     the saved default execution environment ('local' when unset)
 * @param {string} [o.execEnvLabel]       its label ("Local sandbox (Docker)")
 * @param {object|null} [o.proxy]         proxyHost.status() (state, upstream, login, managed, sidecar), or null
 * @param {(key: string) => string|null} [o.specHashOf]
 * @returns {{where: string, whereLabel: string, rows: {id: string, label: string, status: string, value: string, tone: string,
 *   detail: string, title?: string}[], execEnv: {name: string, label: string, sandboxed: boolean}, boxImage: object|null}}
 */
export function securityPosture({ env = process.env, remoteMode = false, execEnvDefault = 'local', execEnvLabel = null,
  proxy = null, specHashOf = () => null } = {}) {
  const where = whereWorcaRuns(env, { remoteMode });
  const boxed = where !== 'native';
  const rows = [];
  const row = (id, label, status, detail, value, tone, title) =>
    rows.push({ id, label, status, value: value || STATUS_VALUE[status], tone, detail, ...(title ? { title } : {}) });
  // In the hardened box these protections are part of the setup: one that is off needs someone.
  const missing = where === 'hardened' ? 'attention' : 'neutral';

  row('where', 'Where Worca runs', boxed ? 'on' : 'off', {
    native: 'Directly on this machine, as your user. Agents can reach what you can.',
    container: 'In a container. Agents see only its volumes and what is mounted into it.',
    hardened: 'In the hardened box. No host folder is mounted; projects are cloned into its volume.',
    hosted: 'On a hosted server, behind an identity proxy.',
  }[where], WHERE_LABEL[where], 'neutral');

  if (brokerEnabled(env)) row('broker', 'Credential broker', 'on', 'The broker holds the model key. Worca and its agents hold none.', 'On', 'ok');
  else row('broker', 'Credential broker', 'off', 'The model key or sign-in is on this machine, where agents run.', 'Off', missing);

  const agent = agentIdentity(env);
  if (agent) row('agents', 'Agent users', 'on', "Agents run under their own user. They cannot read Worca's settings, database or environment.", 'On', 'ok', `User ${agent.user}`);
  else row('agents', 'Agent users', 'off', boxed ? "Agents run as Worca's own user." : 'Agents run as your user.', 'Off', missing);

  const policy = readEgressPolicy(env);
  const viaSidecar = [env.HTTPS_PROXY, env.https_proxy].some((v) => String(v || '').startsWith(SIDECAR_PROXY));
  if (policy.enforced) {
    row('network', 'Outbound network', 'on', policy.mode === 'block' ? "Worca's egress proxy lets through every host but the deny list."
      : "Worca's egress proxy lets through the listed hosts only.", policy.mode === 'block' ? 'Deny list' : 'Allow-list', 'ok',
    policy.mode === 'block' ? null : `${policy.allow.length} hosts`);
  } else if (where === 'hardened') row('network', 'Outbound network', 'on', 'The box has no route out. The egress sidecar lets through the listed hosts.', 'Allow-list', 'ok', 'worca container status checks it from the host');
  else if (viaSidecar) row('network', 'Outbound network', 'unknown', 'Through the egress sidecar. Whether it keeps an allow-list shows only on the host.', 'Sidecar', 'neutral', 'worca container status');
  else row('network', 'Outbound network', 'off', 'Agents can reach any host.', 'Open', 'neutral');

  const p = proxy && typeof proxy === 'object' ? proxy : null;
  if (sidecarConfigured(env) || p?.sidecar) {
    if (p && p.state === 'error') row('proxy', 'Proxy login', 'unknown', 'The egress sidecar does not answer, so Worca cannot tell. Check that it runs.', 'No answer', 'attention', p.error || null);
    else if (p && p.managed && p.state === 'needs-login') row('proxy', 'Proxy login', 'on', 'The proxy rejected the login. The operator must replace the login file.', 'Rejected', 'attention');
    else if (p && p.managed) row('proxy', 'Proxy login', 'on', 'In the egress sidecar, managed by the operator. Worca never holds it.', 'Operator', 'ok');
    else if (p && !p.upstream) row('proxy', 'Proxy login', 'on', 'No corporate proxy. The egress sidecar connects directly.', 'No proxy', 'neutral');
    else row('proxy', 'Proxy login', 'on', 'In the egress sidecar. Worca never holds it.', 'Sidecar', 'ok');
  } else if (!p) row('proxy', 'Proxy login', 'unknown', 'Not checked.', 'Unknown', 'neutral');
  else if (!p.upstream || p.state === 'off' || p.state === 'not-configured') row('proxy', 'Proxy login', 'on', 'No corporate proxy.', 'No proxy', 'neutral');
  else if (p.login) row('proxy', 'Proxy login', 'on', "On this machine, in Worca's local proxy. Agents get its address, never the login.", 'This machine', 'neutral', p.login.label || null);
  else row('proxy', 'Proxy login', 'on', 'The corporate proxy needs no saved login.', 'No login', 'neutral', p.upstream);

  const name = typeof execEnvDefault === 'string' && execEnvDefault ? execEnvDefault : 'local';
  const label = execEnvLabel || (name === 'local' ? 'Local' : name);
  const sandboxed = name !== 'local' || boxed;
  row('exec-env', 'Default execution environment', sandboxed ? 'on' : 'off',
    name !== 'local' ? "Each run's agents work in their own sandbox."
      : boxed ? `Agents run inside this ${WHERE_LABEL[where].toLowerCase()}.` : 'Agents run on this machine, not sandboxed.',
    label, name !== 'local' ? 'ok' : 'neutral');

  const boxImage = where === 'native' || where === 'hosted' ? null : boxImageInside({ env, specHashOf });
  return { where, whereLabel: WHERE_LABEL[where], rows, execEnv: { name, label, sandboxed }, boxImage };
}
