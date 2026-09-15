// src/core/ask/memory-deps.mjs
// The dep bundle of the memory tools (agent-memory-design.md §9.1; P2 amendment B3) — reads AND
// writes under ONE namespaced sub-object, exactly like worktree-deps.mjs / comment-deps.mjs.
// Deliberately separate from tool-deps.mjs, whose source is pinned read-only. Everything goes
// through src/core/memory-store.mjs (validation, frontmatter repair, caps, snapshots, counters),
// so the MCP path and the REST path share one writer. Also the chat's --add-dir memory mount.
import { join } from 'node:path';
import {
  memoryRoot, listMemory, readMemory, writeMemory, removeMemory, renderMemoryFile, MEMORY_NAME_HELP,
} from '../memory-store.mjs';
import { mountDirs, withStoreLock, refreshMount } from '../memory-sync.mjs';
import { memoryCaps } from '../settings.mjs';
import { listProjects, worcaHome } from '../projects.mjs';
import { PROJECT_KEY_RE } from '../store.mjs';
import { getThread } from './store.mjs';

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

/** `<home>/ask/memory/<projectKey|global>` — the --add-dir base of one scope set. Never the cwd (one
 *  Claude Code project slug for every thread) and never under tmp/ (Read-denied there). `global` is a
 *  safe sentinel: a registry key is `<slug>-<8 hex>` (PROJECT_KEY_RE), so it can never be that word. */
export function askMemoryMountBase(projectKey) { return join(worcaHome(), 'ask', 'memory', projectKey || 'global'); }

/**
 * Refresh the chat's rules mount for one scope set (native-rules revision, D16): global + the
 * given project, written under `<base>/.claude/rules/worca/{global,project}/` — the layout the
 * CLI loads through `--add-dir <base>` + CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 (probes J/J2).
 * The writing is memory-sync's refreshMount (NON-destructive: files written atomically by name,
 * stale ones unlinked, dirs never removed — a turn already spawning on the same mount must not
 * read an empty dir; a file that cannot be written keeps its previous copy and is reported).
 * Serialised under the store lock so it never interleaves with an in-process sync or remember
 * (the MCP child writes from another process; whole-file atomic writes make that harmless).
 * `async` on purpose: the projectKey guard REJECTS rather than throwing at the call site.
 * @returns {Promise<string|null>} the base to pass as --add-dir, or null when the scope set holds
 *   no file (B33: nothing to load ⇒ the spawn stays byte-identical); the mount is emptied then.
 */
export async function refreshAskMemoryMount({ projectKey = null, projectName = null } = {}) {
  // A path segment: refuse anything but a registry-shaped key before a single mkdir (defence in
  // depth — today's only caller passes a resolved key; the shape store.mjs#projectKey produces and
  // the server's memory routes test). The rejection lands in the turn's catch.
  if (projectKey != null && !PROJECT_KEY_RE.test(projectKey)) throw new Error(`refreshAskMemoryMount: invalid projectKey ${JSON.stringify(projectKey)}`);
  const base = askMemoryMountBase(projectKey);
  const dirs = mountDirs({ members: projectKey ? [{ projectKey, projectName }] : [], isWorkspace: false });
  return withStoreLock(memoryRoot(), async () => {
    // Two different failures reach ONE callback: a junk name / unreadable file in the STORE (the
    // listing, `listMemoryDir` → ENAME) and a mount target that could not be written (the rename).
    // Only the second has a "previous copy"; reporting a store name that way would promise a copy
    // that never existed and name a path the user cannot fix by retrying.
    const onError = (p, err) => console.warn(err?.code === 'ENAME'
      ? `[worca-ask] memory: ignoring ${JSON.stringify(p)} — ${MEMORY_NAME_HELP}`
      : `[worca-ask] memory mount: ${p} could not be refreshed (${err?.message || err}); the previous copy (if any) is served this turn`);
    const { files } = await refreshMount({ root: memoryRoot(), mount: join(base, '.claude', 'rules', 'worca'), dirs, onError });
    return files ? base : null;
  });
}
