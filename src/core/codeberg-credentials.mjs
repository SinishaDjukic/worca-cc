// src/core/codeberg-credentials.mjs
// Codeberg credentials: a fixed Forgejo host, so plain WORCA_CODEBERG_* variables on the family's helper and header.
import { CODEBERG_HOST } from '../shared/codeberg-remote.mjs';
import { roles, stripAllForgeCredentials, withFamilyToken } from './gitea-family-credentials.mjs';

const val = (v) => (typeof v === 'string' ? v.trim() : '');

/** { mode: 'none'|'single'|'split', read, write } — the same role rules as the other forges. */
export function readCodebergCredentials(env = process.env) {
  return roles(val(env.WORCA_CODEBERG_TOKEN) || null, val(env.WORCA_CODEBERG_READ_TOKEN) || null, val(env.WORCA_CODEBERG_WRITE_TOKEN) || null);
}

/** The env for one git call that needs `role` on codeberg.org: every forge credential stripped, the role's token as
 *  the family helper for codeberg.org. */
export function codebergEnv(role, base = process.env) {
  const c = readCodebergCredentials(base);
  return withFamilyToken(stripAllForgeCredentials(base), CODEBERG_HOST, role === 'write' ? c.write : c.read, 'WORCA_CODEBERG_GIT_TOKEN');
}

/** Headers for one REST call to codeberg.org, in the (role, host, env) shape the PR factory expects. null without a token. */
export function codebergAuthHeader(role, host = CODEBERG_HOST, env = process.env) {
  const c = readCodebergCredentials(env);
  const t = role === 'write' ? c.write : c.read;
  return t ? { authorization: `token ${t}` } : null;
}

export const codebergConfigured = (env = process.env) => readCodebergCredentials(env).mode !== 'none';
