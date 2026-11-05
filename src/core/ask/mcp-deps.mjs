// src/core/ask/mcp-deps.mjs
// The MCP-server dependency bundle of the Ask Worca tools (docs/mcp-servers.md "Chat"): the ONE module that reads
// worca's MCP registry on the tools' behalf (tools.mjs may not import anything), plus the card's validator and its
// apply. Read paths go through views.mjs (which never exposes a secret value); writes go through the same store
// calls as the Settings routes (ui/routes/mcp-servers/servers.mjs), each of which re-validates under the registry lock.
//   • the MCP child (mcp-stdio.mjs): deps.mcpServers.* behind list_mcp_servers and propose_mcp_change (validate only);
//   • the parent: turn.mjs re-validates a proposal with validateMcpChange, and the cards route applies a confirmed
//     card with applyMcpChange.
// Applying never adds a server to a set: the user turns it on on Connectors › MCP servers.
import { viewContext, buildCatalogView, buildSetsView, buildSetView, manualNameTaken } from '../mcp/views.mjs';
import { addManualServer, editManualServer, removeServerEverywhere } from '../mcp/store.mjs';
import { retestServers } from '../mcp/test.mjs';
import { getEngine } from '../engines/index.mjs';
import { describeUnattachableMcp } from '../engines/capabilities.mjs';
import { ENGINE_NAMES, engineLabel } from '../../shared/engine-switch.mjs';
import { createMcpChangeValidator, describeForChat, keepMasked, MCP_PAGE } from './mcp-proposal.mjs';
import { discoverMcpConfigs, homeConfigsAllowed } from '../mcp/discover.mjs';
import { listProjects } from '../projects.mjs';
import { listWorkspaces } from '../workspaces.mjs';
import { projectKey as projectKeyOf } from '../store.mjs';
import { createMcpImportValidator, discoveryView } from './mcp-import.mjs';

/** Which run engines can attach a server of this shape: each adapter's own unattachableMcp rule (the one
 *  askEngineSwitchPlan and mcpForEngine apply). Claude, Cursor, Gemini, OpenCode and Qwen attach every transport. */
export function enginesFor(name, def, io = {}) {
  const engineOf = io.getEngine ?? getEngine;
  const probe = { [name]: def.type === 'stdio' ? { command: 'x' } : { url: 'https://x.invalid/' } };
  const on = []; const off = [];
  for (const e of ENGINE_NAMES) {
    const fn = engineOf(e)?.unattachableMcp;
    const problems = typeof fn === 'function' ? fn(probe) : [];
    if (problems.length) off.push({ engine: engineLabel(e), reason: describeUnattachableMcp(e, problems) });
    else on.push(engineLabel(e));
  }
  return { on, off };
}

/** Catalog rows the validator reads: the Settings view joined with each entry's definition. */
function catalogEntries(ctx) {
  const byId = new Map(ctx.catalog.map((e) => [e.id, e]));
  return buildCatalogView({ ...ctx, claudeNames: [] }).servers.filter((s) => byId.has(s.id)).map((s) => ({
    id: s.id, source: s.source, name: byId.get(s.id).name, base: s.base, sourceLabel: s.sourceLabel,
    def: byId.get(s.id).def, inSets: s.inSets.map((x) => x.name), tools: s.tools,
    retired: s.retired, pluginDisabled: s.pluginDisabled,
  }));
}

/** serverId → [{set, enabled, secrets?: {LABEL: 'set' | 'not set' | '$MCP_…'}}] over every set (views.mjs memberViews). */
function membership(ctx) {
  const out = new Map();
  for (const s of buildSetsView(ctx).sets) {
    const view = buildSetView(ctx, s.id);
    if (!view) continue;
    for (const m of view.members) {
      const secrets = {};
      for (const f of m.fields || []) {
        if (f.secret) secrets[f.label || f.key] = f.state?.set ? (f.state.env ? `$${f.state.env}` : 'set') : 'not set';
      }
      if (!out.has(m.serverId)) out.set(m.serverId, []);
      out.get(m.serverId).push({ set: s.name, enabled: !!m.enabled, ...(Object.keys(secrets).length ? { secrets } : {}) });
    }
  }
  return out;
}

/** list_mcp_servers: every server in the registry, never a secret value. */
export async function listMcpServers(io = {}) {
  const ctx = await (io.viewContext ?? viewContext)();
  const sets = membership(ctx);
  return {
    servers: catalogEntries(ctx).map((e) => ({
      id: e.id, name: e.base, origin: e.sourceLabel, source: e.source === 'policy' ? 'team' : e.source, editable: e.source === 'manual',
      ...describeForChat(e.def),
      sets: sets.get(e.id) || [],
      engines: enginesFor(e.base, e.def, io),
      tools: e.tools,
      ...(e.retired ? { retired: e.retired } : {}),
      ...(e.pluginDisabled ? { pluginDisabled: true } : {}),
    })),
    howTo: `A server reaches chats and runs only as an enabled member of a set (General, or a set assigned to a project). Secrets are filled in per set on ${MCP_PAGE}.`,
  };
}

/** The pinned scope's project folders: the project, or every member of the workspace. No pin: none. */
export async function pinnedProjects(pin, io = {}) {
  if (!pin || typeof pin !== 'object') return [];
  const projects = ((await (io.listProjects ?? listProjects)()) || []).filter((p) => p && typeof p.key === 'string' && typeof p.path === 'string');
  if (pin.projectKey) return projects.filter((p) => p.key === pin.projectKey).map((p) => ({ key: p.key, path: p.path }));
  if (pin.workspaceId) {
    const ws = ((await (io.listWorkspaces ?? listWorkspaces)()) || []).find((w) => w && w.id === pin.workspaceId);
    const keys = new Set((ws?.projectPaths || []).map((p) => projectKeyOf(p)));
    return projects.filter((p) => keys.has(p.key)).map((p) => ({ key: p.key, path: p.path }));
  }
  return [];
}

/** Discovery over this machine (local worca only) and the pinned project(s): discover.mjs's raw result. */
async function discoverRaw(pin, io = {}) {
  return (io.discover ?? discoverMcpConfigs)({ projects: await pinnedProjects(pin, io), homeScope: homeConfigsAllowed(io.env ?? process.env) });
}

/** discover_mcp_servers: other tools' servers, every value masked, each marked inWorca / importable. */
export async function discoverMcpServers({ pin = null } = {}, io = {}) {
  const [disc, ctx] = await Promise.all([discoverRaw(pin, io), (io.viewContext ?? viewContext)()]);
  return discoveryView(disc, catalogEntries(ctx));
}

const registry = {
  catalog: async () => catalogEntries(await viewContext()),
  nameTaken: async (name) => manualNameTaken(await viewContext(), name),
  engines: (name, def) => enginesFor(name, def),
};

/** The authoritative validator, over the real registry (the turn's default; the child's too). */
export const validateMcpChange = createMcpChangeValidator({
  ...registry,
  importChange: createMcpImportValidator({ ...registry, discover: ({ pin }) => discoverRaw(pin) }),
});

/**
 * Apply a CONFIRMED MCP card (cards route, after the user's click). Each store call re-validates under the
 * registry lock. Returns a result the card renders and the event turn quotes; throws on failure.
 */
export async function applyMcpChange(card, io = {}) {
  const c = card.change || {};
  const ctx = await (io.viewContext ?? viewContext)();
  if (card.kind === 'import') {
    // One card, several definitions, added in order under the registry lock each; nothing joins a set.
    const list = Array.isArray(c.servers) ? c.servers : [];
    if (!list.length) throw new Error('nothing to import');
    const catalogNames = ctx.catalog.map((e) => e.name);
    const added = [];
    for (const s of list) {
      try { await (io.add ?? addManualServer)(s.name, s.def, { catalogNames }); }
      catch (err) {
        if (!added.length) throw err;
        throw Object.assign(new Error(`Added ${added.join(', ')}, then could not add ${s.name}: ${err?.message || err}`), { code: err?.code });
      }
      added.push(s.name);
    }
    const one = added.length === 1;
    const have = Array.isArray(card.alreadyPresent) ? card.alreadyPresent.length : 0;
    return { ok: true, serverId: `manual:${added[0]}`, detail: `Added ${added.join(', ')}. ${one ? 'It is' : 'They are'} in no set yet: turn ${one ? 'it' : 'them'} on in a set on ${MCP_PAGE}${have ? ` · ${have} already in worca, not added again` : ''}` };
  }
  if (card.kind === 'add') {
    await (io.add ?? addManualServer)(c.name, c.def, { catalogNames: ctx.catalog.map((e) => e.name) });
    return { ok: true, serverId: `manual:${c.name}`, detail: `Added ${c.name}. It is in no set yet: turn it on in a set on ${MCP_PAGE}` };
  }
  const entry = ctx.catalog.find((e) => e.id === c.serverId);
  if (!entry || entry.source !== 'manual') throw new Error(`no Manual MCP server "${c.name}" any more`);
  // The stale check (change.expect, a digest of the definition the card was made from, D10) runs inside the
  // registry lock (store.mjs), so a Settings save made after the card was minted fails the card instead of being
  // overwritten or removed unseen.
  if (card.kind === 'edit') {
    // The card holds MASK where the chat kept a stored literal it may not show; the digest check under the lock
    // proves `entry.def` is still the definition those literals come from.
    const def = keepMasked(c.def || {}, entry.def);
    if (!def) throw new Error(`${c.name} changed since this card was made — ask the chat again`);
    await (io.edit ?? editManualServer)(c.name, def, { expect: c.expect });
    void (io.retest ?? retestServers)((s) => s === c.serverId);
    return { ok: true, serverId: c.serverId, detail: `Saved ${c.name} · re-testing its sets` };
  }
  if (card.kind === 'remove') {
    await (io.remove ?? removeServerEverywhere)(c.serverId, { expect: c.expect });
    return { ok: true, serverId: c.serverId, detail: `Removed ${c.name}` };
  }
  throw new Error(`unknown MCP change kind "${card.kind}"`);
}

export function defaultMcpServerDeps() {
  return { mcpServers: { list: () => listMcpServers(), discover: (o) => discoverMcpServers(o), validateChange: (inp, o) => validateMcpChange(inp, o) } };
}
