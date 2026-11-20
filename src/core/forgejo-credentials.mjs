// src/core/forgejo-credentials.mjs
// Forgejo credentials: the host-list shape of gitea-family-credentials.mjs under the WORCA_FORGEJO_ prefix.
import { makeHostListCredentials } from './gitea-family-credentials.mjs';

const c = makeHostListCredentials('FORGEJO');
export const forgejoHosts = c.hosts;
export const readForgejoCredentials = c.read;
export const forgejoEnv = c.gitEnv;
export const forgejoAuthHeader = c.authHeader;
export const forgejoConfigured = c.configured;
export const forgejoCredentialWarnings = c.warnings;
