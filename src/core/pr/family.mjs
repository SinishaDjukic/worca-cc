// src/core/pr/family.mjs
// The Gitea family's three bindings as one set, for callers that take every forge at once (ui/server.mjs's fork
// refusals and start-up warnings) without importing each binding.
import * as gitea from './gitea.mjs';
import * as forgejo from './forgejo.mjs';
import * as codeberg from './codeberg.mjs';
import { giteaCredentialWarnings } from '../gitea-credentials.mjs';
import { forgejoCredentialWarnings } from '../forgejo-credentials.mjs';

export const FAMILY_PR = Object.freeze({ gitea, forgejo, codeberg });
export const familyForkRefusals = Object.freeze({ gitea: gitea.forkRefusal, forgejo: forgejo.forkRefusal, codeberg: codeberg.forkRefusal });

/** Configuration mistakes a deployment would otherwise find only when a PR call fails, one line each to `log`:
 *  a host-less token or a token for an unlisted host. Names only, never values. */
export function logFamilyCredentialWarnings(log) {
  for (const w of [...giteaCredentialWarnings(), ...forgejoCredentialWarnings()]) log(w);
}
