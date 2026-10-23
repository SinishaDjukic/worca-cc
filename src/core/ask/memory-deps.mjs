// src/core/ask/memory-deps.mjs
// The dep bundle of the memory tools (agent-memory-design.md §9.1; P2 amendment B3) — reads AND
// writes under ONE namespaced sub-object, exactly like worktree-deps.mjs / comment-deps.mjs.
// Deliberately separate from tool-deps.mjs, whose source is pinned read-only. Everything goes
// through src/core/memory-store.mjs (validation, frontmatter repair, caps, snapshots, counters),
// so the MCP path and the REST path share one writer. Also the chat's --add-dir memory mount.
import { join } from 'node:path';
import {
  memoryRoot, listMemory, readMemory, writeMemory, removeMemory, renderMemoryFile, MEMORY_NAME_HELP, flattenLine,
} from '../memory-store.mjs';
import { mountDirs, withStoreLock, refreshMount } from '../memory-sync.mjs';
import { memoryCaps } from '../settings.mjs';
import { listProjects, worcaHome } from '../projects.mjs';
import { PROJECT_KEY_RE } from '../store.mjs';
import { mountTeamLayer, refreshTeamLayerSoon, teamListing, readTeamNote } from '../memory-team.mjs';

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
      list: (scope) => listMemory(memoryRoot(), scope),
      read: (scope, name) => readMemory(memoryRoot(), scope, name),
      /** Compose + write one file. Omitted description/paths keep the existing file's values (an
       *  omission never erases); `append` joins the bodies with one blank line (replace on a new
       *  file). Read-compose-write under the store lock (I2-#13) so two turns of THIS process
       *  cannot lose an append; a concurrent MCP child or a run's sync-back is not covered — that
       *  race is a Non-goal, and the pre-write snapshot keeps the losing version. */
      remember: (scope, { name: asked, body, description, paths, mode = 'replace' }) => withStoreLock(memoryRoot(), async () => {
        const local = await readMemory(memoryRoot(), scope, asked);
        // Team memory (phase 1a, D2): with no local copy, a teammate's note of that name IS the note this write changes
        // (read_memory shows it) — an omitted hook or paths keep the team's values and `append` adds under the team's
        // body; the write is then shared and replaces the team version for everyone. Never the team's extras (`author`).
        // Off, or no such team note: null — the behaviour before team memory. A case variant of the team's name writes
        // under the team's spelling: a new spelling would replace the team's note with this fragment (D4, D9).
        const team = !local && scope?.kind === 'project' ? await readTeamNote(scope.projectKey, asked).catch(() => null) : null;
        const name = team ? team.name : asked;
        const existing = local || (team ? { meta: { ...team.meta, extra: {} }, body: team.body } : null);
        const meta = {
          name,
          description: description == null ? (existing?.meta.description || '') : String(description),
          paths: paths == null ? (existing?.meta.paths || []) : paths,
          extra: existing?.meta.extra || {},
        };
        const nextBody = mode === 'append' && existing ? `${existing.body.trimEnd()}\n\n${String(body).trim()}\n` : String(body);
        const caps = memoryCaps(scope && scope.kind === 'project' ? { projectKey: scope.projectKey } : null);
        // D4: an omitted hook keeps the TEAM's whole, as a follow keeps it — clipped to this machine's cap, the write would
        // push the cut hook to everyone (refine cycle 8).
        const teamHook = team && description == null ? flattenLine(team.meta.description || '').trim().length : 0;
        const r = await writeMemory(memoryRoot(), scope, name, renderMemoryFile(meta, nextBody), { source, caps: teamHook > (caps?.hookMaxChars ?? 0) ? { ...caps, hookMaxChars: teamHook } : caps });
        return { name, created: r.created, bytes: r.bytes };
      }),
      // Under the store lock like remember: in relay mode this runs in the server, beside team memory's marker writes
      // (a marker write that read the note before this removal would put it back).
      forget: (scope, name) => withStoreLock(memoryRoot(), () => removeMemory(memoryRoot(), scope, name, { source })),
      /** Team memory (phase 1a): the opted-in project's teammates' notes — read-only views of the last fetch. */
      listTeam: (projectKey) => teamListing(projectKey),
      readTeam: (projectKey, name) => readTeamNote(projectKey, name),
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
    const rules = join(base, '.claude', 'rules', 'worca');
    const { files } = await refreshMount({ root: memoryRoot(), mount: rules, dirs, onError });
    // Team memory (phase 1a): the project's team folder (rules/team/), shadowed by same-named local notes; an opted-out
    // project's folder is emptied. The fetch runs in the background — a turn never waits on the network. A team-layer
    // failure never costs the turn its local memory: thrown from here, the turn's catch would drop the whole mount.
    if (projectKey) refreshTeamLayerSoon(projectKey);
    let team = 0;
    try { team = (await mountTeamLayer({ rules, dirs })).reduce((n, t) => n + t.count, 0); }
    catch (err) { console.warn(`[worca-ask] team memory: team notes not mounted (${err?.message || err}); local memory is served this turn`); }
    return files + team ? base : null;
  });
}
