// src/core/gitea-credentials.mjs
// Gitea credentials: the host-list shape of gitea-family-credentials.mjs under the WORCA_GITEA_ prefix.
import { makeHostListCredentials } from './gitea-family-credentials.mjs';

const c = makeHostListCredentials('GITEA');
export const giteaHosts = c.hosts;
export const readGiteaCredentials = c.read;
export const giteaEnv = c.gitEnv;
export const giteaAuthHeader = c.authHeader;
export const giteaConfigured = c.configured;
export const giteaCredentialWarnings = c.warnings;
