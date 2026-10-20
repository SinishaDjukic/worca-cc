// src/core/ask/project-deps.mjs
// Binds project-proposal.mjs to the real registry and projects folder — the ONE module that touches the
// registry for the project card (tools.mjs imports nothing). The MCP child gets `projectChanges.validateChange`
// (validate only, for the model's self-correction; in the classic child gitAvailable() reads the forwarded
// WORCA_GIT, P0); the parent turn re-validates with `validateProjectProposal` and mints the card; the card
// route applies it with `applyProjectChange`, behind the user's click.
import { createProject, addProjectFolder, ProjectAddError } from '../project-create.mjs';
import { createProjectChangeValidator } from './project-proposal.mjs';

/** The parent's validator (dry runs only: nothing is created or registered). */
export const validateProjectProposal = createProjectChangeValidator({
  createProject: (i) => createProject(i),
  addProjectFolder: (i) => addProjectFolder(i),
});

/**
 * Apply a project card's change: create → createProject({ name, useGit }); add → addProjectFolder({ name, path, useGit }).
 * @param {{change?:{kind:string, name?:string, path?:string, useGit?:boolean}}} card
 * @param {{createProject?:Function, addProjectFolder?:Function}} [io]  test seams; default the real ones
 * @returns {Promise<{ok:true, project:object}>}
 * @throws {ProjectAddError}
 */
export async function applyProjectChange(card, io = {}) {
  const ch = (card && card.change) || {};
  const useGit = ch.useGit === true;
  if (ch.kind === 'create') {
    const { project } = await (io.createProject || createProject)({ name: ch.name, useGit });
    return { ok: true, project };
  }
  if (ch.kind === 'add') {
    const { project } = await (io.addProjectFolder || addProjectFolder)({ name: ch.name, path: ch.path, useGit });
    return { ok: true, project };
  }
  throw new ProjectAddError('INVALID', 'kind must be "create" or "add"');
}

/** The MCP child's bundle. */
export function defaultProjectDeps() {
  return {
    projectChanges: {
      validateChange: createProjectChangeValidator({ createProject: (i) => createProject(i), addProjectFolder: (i) => addProjectFolder(i) }),
    },
  };
}
