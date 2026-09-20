// src/core/ask/source-deps.mjs
// The plugin task-source dependency bundle of the Ask Worca tools (source-spec.mjs): the ONE module
// that calls a task-source connector on the tools' behalf. tools.mjs imports nothing.
//   • the MCP child: deps.sources.* behind list_task_sources, find_tasks and get_task — the same two
//     read ops (listTasks, getTask) the New pipeline pane may drive, nothing else;
//   • the parent: turn.mjs verifies a proposed task with lookupTask (title + link for the card).
// Tasks are fetched through the plugin shim, so a connector runs in its own scrubbed child process
// with its own secrets — the model never sees a token, only the task text (untrusted DATA).
import { listTaskSources } from '../sources.mjs';
import { callSource } from '../plugin-shim.mjs';
import { listProfileIds } from '../plugin-config.mjs';
import { resolveProfile } from '../source-bindings.mjs';
import { readWorkspace } from '../workspaces.mjs';
import { shapeSources, shapeTask } from './source-spec.mjs';

/** A read op against one source; `profile` resolved by the caller. */
export function sourceCall({ plugin, sourceId, op, args, profile }) {
  if (op !== 'listTasks' && op !== 'getTask') throw new Error(`op "${op}" is not allowed from Ask Worca`);
  return callSource({ plugin, sourceId, op, args, profile: profile || undefined, timeoutMs: 20000, logger: () => {} });
}

/** The parent's task check (proposal.mjs lookupTask). */
export const lookupTask = ({ plugin, sourceId, taskId, profile }) => sourceCall({ plugin, sourceId, op: 'getTask', args: { id: taskId }, profile });

function safeIds(plugin) { try { return listProfileIds(plugin); } catch { return []; } }

/** The installed plugin sources, each multi-profile one with its profile ids. */
export function installedSources() {
  return listTaskSources().filter((s) => s.type === 'plugin')
    .map((s) => (s.multiProfile ? { ...s, profiles: safeIds(s.plugin) } : s));
}

export function defaultSourceDeps() {
  return {
    taskSourceShapes: { shapeSources, shapeTask },
    sources: {
      list: installedSources,
      /** The profile to call a multi-profile source with, for a project / workspace scope. */
      async resolve({ plugin, sourceId, projectKey = null, workspaceId = null }) {
        const available = safeIds(plugin);
        if (workspaceId) {
          let memberKeys = [];
          try { memberKeys = (await readWorkspace(workspaceId))?.projectKeys || []; } catch { memberKeys = []; }
          return resolveProfile({ scopeType: 'workspace', scopeKey: workspaceId, memberKeys, plugin, sourceId, available });
        }
        if (projectKey) return resolveProfile({ scopeType: 'project', scopeKey: projectKey, plugin, sourceId, available });
        return available.length === 1 ? { profile: available[0], via: 'only' } : { profile: null, via: 'none', candidates: available };
      },
      call: sourceCall,
    },
  };
}
