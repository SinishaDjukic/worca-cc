// FEAT-1: the MCP servers a run loads OUTSIDE the registry that an agent can be given by name — exactly the member sources
// mergeMcpConfigs reads: the project's `.mcp.json` (group 'project') and the project's LOCAL scope in `~/.claude.json`
// (group 'personal'; the default scope of `claude mcp add`). The top-level `~/.claude.json` `mcpServers` and the root layer are
// not member sources, so a run never provides the former and the latter is not choosable (both pass through untouched).
// `approval` is 'approved' for everything the run provides. Only in single (non-workspace) mode, and only for a server (either scope) that
// is identical to the committed copy, can it be 'unapproved' / 'disabled': that is the one case the run drops (attachCommittedMcp), so the
// catalog does not offer it (heldCommittedMcp). The catalog, run-check and the run planner share this function.
// `members`: [{ dir, workMode, committedDir? }] — workMode is the member's ('git' | 'folder'), used for the local-scope key and the git
// flag; committedDir is the run's worktree / folder copy (harness only — before a run it does not exist yet).
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readMcpFile, heldCommittedMcp, localScopeServers } from './run-context.mjs';

export async function listNativeMcpServers({ members = [], homeDir = homedir(), single = false, managed } = {}) {   // `managed`: test seam of mcpjsonApproval
  const ms = [...new Map(members.map((m) => [m.dir, m])).values()].sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  const rows = new Map();
  // First row wins, except that a provided ('approved') row replaces a held one: a same-named server of another scope or member IS provided.
  const add = (name, group, approval) => {
    const cur = rows.get(name);
    if (!cur || (cur.approval !== 'approved' && approval === 'approved')) rows.set(name, { name, group, approval });
  };
  const per = [];
  for (const m of ms) {
    const project = (await readMcpFile(join(m.dir, '.mcp.json'))).servers || {};
    const personal = await localScopeServers(m.dir, homeDir, m.workMode);
    const held = single ? await heldCommittedMcp(m.dir, homeDir, { workMode: m.workMode, committedDir: m.committedDir, managed }) : null;
    per.push({ project, personal, held });
  }
  for (const p of per) for (const n of Object.keys(p.project).sort()) add(n, 'project', p.held?.project.get(n) ?? 'approved');
  for (const p of per) for (const n of Object.keys(p.personal)) add(n, 'personal', p.held?.personal.get(n) ?? 'approved');
  return [...rows.values()];
}
