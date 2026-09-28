// src/core/ask/clone-deps.mjs
// Binds clone-proposal.mjs to the real projects folder and registry. The MCP child gets
// `clones.validateChange` (validate only, for the model's self-correction; it never sees a
// GitHub credential, so its card has no GitHub line); the parent turn re-validates with
// `validateCloneProposal`, whose card names how the clone authenticates.
import { getProjectsRoot } from '../settings.mjs';
import { listProjects } from '../projects.mjs';
import { githubMode } from '../deployment.mjs';
import { createCloneValidator, githubLabel } from './clone-proposal.mjs';

/** The parent's validator: the card carries the GitHub line (deployment.mjs, never a secret). */
export const validateCloneProposal = createCloneValidator({
  projectsRoot: () => getProjectsRoot(),
  listProjects: () => listProjects(),
  github: (host) => githubLabel(githubMode(process.env), { host, appId: (process.env.WORCA_GH_APP_ID || '').trim() || null }),
});

/** The MCP child's bundle. */
export function defaultCloneDeps() {
  return {
    clones: {
      validateChange: createCloneValidator({ projectsRoot: () => getProjectsRoot(), listProjects: () => listProjects() }),
    },
  };
}
