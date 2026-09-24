// How this worca runs, for Ask Worca's context and rules (docs/deploy-railway.md).
//
//   local      a desktop install: the default, and what nothing else says otherwise
//   container  the worca image (WORCA_CONTAINER=1 from docker/Dockerfile, or
//              WORCA_DATA_DIR from a single-volume host) without remote access
//   hosted     remote access is on (WORCA_ALLOWED_HOSTS names a public host):
//              people reach it through an identity proxy, not from this machine
//
// Pure: reads only `env` and the remote-mode flag the server already computed.
import { readGithubCredentials } from './github-credentials.mjs';

const on = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

/** 'local' | 'container' | 'hosted'. */
export function detectDeployment(env = process.env, { remoteMode = false } = {}) {
  if (remoteMode) return 'hosted';
  if (on(env.WORCA_CONTAINER) || String(env.WORCA_DATA_DIR || '').trim()) return 'container';
  return 'local';
}

/** Which GitHub credential worca holds: 'none' | 'single' | 'split' (src/core/github-credentials.mjs).
 *  Names the mode only; never the token. */
export function githubMode(env = process.env) {
  return readGithubCredentials(env).mode;
}

/** The facts Ask Worca's context header shows about this deployment, or null for a
 *  local install (whose header stays exactly as before). */
export function deploymentFacts(env = process.env, { remoteMode = false, projectsRoot = null } = {}) {
  const deployment = detectDeployment(env, { remoteMode });
  if (deployment === 'local') return null;
  return { deployment, projectsRoot: projectsRoot || null, github: githubMode(env) };
}
