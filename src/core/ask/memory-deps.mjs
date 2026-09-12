// src/core/ask/memory-deps.mjs
// The dep bundle of the memory tools (agent-memory-design.md §9.1; P2 amendment B3) — reads AND
// writes under ONE namespaced sub-object, exactly like worktree-deps.mjs / comment-deps.mjs.
// Deliberately separate from tool-deps.mjs, whose source is pinned read-only. Everything goes
// through src/core/memory-store.mjs (validation, frontmatter repair, caps, snapshots, counters),
// so the MCP path and the REST path share one writer. Also the Ask prompt's index renderer.
import {
  memoryRoot, GLOBAL_SCOPE, projectScope, listMemory, readMemory, writeMemory, removeMemory,
  renderMemoryFile, renderMemoryIndex,
} from '../memory-store.mjs';
import { withStoreLock } from '../memory-sync.mjs';
import { memoryCaps } from '../settings.mjs';
import { listProjects } from '../projects.mjs';
import { getThread } from './store.mjs';

/** The Ask intro (B4): Ask has no mount and its Read tool is confined to worktrees, so the block
 *  points at read_memory / remember / forget instead of at paths. Sections are labelled by scope. */
export const ASK_MEMORY_INDEX_INTRO =
  'Durable rules and preferences kept across runs and chats. Read one with read_memory({ scope, name }) when its ' +
  'hook matters to the answer; do not read all of them. Save or change one only through remember / forget (rule 13).';

/** {key, name, path} for a registered project key, or null. */
async function projectByKey(key) {
  if (typeof key !== 'string' || !key) return null;
  const p = (await listProjects()).find((x) => x && x.key === key);
  return p ? { key: p.key, name: p.name || '', path: p.path } : null;
}

export function defaultMemoryDeps({ threadId }) {
  const source = `ask:${threadId || 'unknown'}`;
  return {
    memory: {
      projectByKey,
      /** The page-following (unpinned) project of this thread, or null — tool-deps' pinnedScope
       *  covers the pinned case. B30: the context the panel sends carries `projectDir` on the New,
       *  Running and Projects pages and `projectKey` only on History detail, so this mirrors
       *  resolveAskContext (ui/server.mjs) and resolves either through the registry. */
      contextProjectKey: async () => {
        if (!threadId) return null;
        let c = null;
        try { c = getThread(threadId)?.context ?? null; } catch { return null; }
        if (!c || c.pinned === true) return null;
        if (typeof c.projectKey === 'string' && c.projectKey) return c.projectKey;
        if (typeof c.projectDir === 'string' && c.projectDir) {
          try {
            const p = (await listProjects()).find((x) => x && x.path === c.projectDir);   // the match resolveAskContext uses
            return p ? p.key : null;
          } catch { return null; }
        }
        return null;
      },
      list: (scope) => listMemory(memoryRoot(), scope),
      read: (scope, name) => readMemory(memoryRoot(), scope, name),
      /** Compose + write one file. Omitted description/paths keep the existing file's values (an
       *  omission never erases); `append` joins the bodies with one blank line (replace on a new
       *  file). Read-compose-write under the store lock (I2-#13) so two turns of THIS process
       *  cannot lose an append; a concurrent MCP child or a run's sync-back is not covered — that
       *  race is a Non-goal, and the pre-write snapshot keeps the losing version. */
      remember: (scope, { name, body, description, paths, mode = 'replace' }) => withStoreLock(memoryRoot(), async () => {
        const existing = await readMemory(memoryRoot(), scope, name);
        const meta = {
          name,
          description: description == null ? (existing?.meta.description || '') : String(description),
          paths: paths == null ? (existing?.meta.paths || []) : paths,
          extra: existing?.meta.extra || {},
        };
        const nextBody = mode === 'append' && existing ? `${existing.body.trimEnd()}\n\n${String(body).trim()}\n` : String(body);
        const r = await writeMemory(memoryRoot(), scope, name, renderMemoryFile(meta, nextBody), { source, caps: memoryCaps() });
        return { created: r.created, bytes: r.bytes };
      }),
      forget: (scope, name) => removeMemory(memoryRoot(), scope, name, { source }),
    },
  };
}

/** The `## Worca memory` block for the Ask system prompt (§9.2): global + the given project. '' on
 *  ANY failure — the prompt is never broken by the store — and '' when every section is empty
 *  (B33: an upgrade with no memory leaves today's prompts byte-identical). Byte-stable until
 *  memory changes. */
export async function askMemoryIndex({ projectKey = null, projectName = null } = {}) {
  try {
    const caps = memoryCaps();
    const sections = [{ label: 'Global', dir: 'scope "global"', entries: await listMemory(memoryRoot(), GLOBAL_SCOPE) }];
    if (projectKey) sections.push({ label: `Project ${projectName || projectKey}`, dir: 'scope "project"', entries: await listMemory(memoryRoot(), projectScope(projectKey)) });
    if (sections.every((s) => !s.entries.length)) return '';
    return renderMemoryIndex(sections, { maxBytes: caps.indexMaxBytes, hookMaxChars: caps.hookMaxChars, intro: ASK_MEMORY_INDEX_INTRO }).text;
  } catch { return ''; }
}
