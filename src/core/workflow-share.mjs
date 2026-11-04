// src/core/workflow-share.mjs
// "Share this workflow with another Worca user" (issue #421): the JSON round
// trip. ONE validate-then-save path for a v2 graph that arrives from outside
// the running composer, shared by POST /api/workflows (the composer's Save),
// POST /api/workflows/import-json, `worca workflow import` and the plugin exporter,
// so the CLI and the server can never disagree about what a legal graph is.
//
// Public surface:
//   exportGraphJson(id)                -> { version:2, name, domain, nodes, wires, canvas?, codeGraph?, sessions? }
//   saveGraphWorkflow(body, opts)      -> composer semantics: keeps a legal `id`, 409 on a minted collision (opts.origin; opts.confirmScripts = Ask's graph card, D18's rule over the list it showed)
//   importGraphWorkflow(body, opts)    -> import semantics: id/origin ignored, name suffixed on collision
//   listScriptNodes(graph, scripts)    -> the command/code values an import must show first (D18)
//   scriptNodesConfirmed(shown, list)  -> the shown list holds exactly those values (Ask's graph card, D10)
//   formatScriptNodes(list)            -> SCRIPT_IMPORT_NOTICE + those values, for the CLI
//   nodeDefaultsError(raw, models, at) -> '' | reason  (per-node tunables vs the project-less catalog)
//
// Errors carry `.code` so surfaces map them to HTTP / exit codes:
//   BAD_REQUEST | INVALID_GRAPH (+ .errors/.warnings/.summary) | RESERVED_NAME |
//   ID_TAKEN (+ .id) | NOT_FOUND | UNSUPPORTED | SCRIPTS_UNCONFIRMED (+ .scriptNodes)

import { listModels } from './config.mjs';
import { EFFORTS, ALL_EFFORTS, subagentModelIssue } from './model-env.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from './agent-registry.mjs';
import { loadScriptRegistry } from './script-registry.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
import { validateGraph, AGENT_TUNABLES } from '../shared/graph/validate.mjs';
import { effectiveScriptParams, CONFIRM_PARAM_TYPES } from '../shared/graph/script-meta.mjs';
import { pickTemplateExtras } from '../shared/graph/template.mjs';
import { readWorkflow, writeGraphWorkflow } from './workflows.mjs';

/** How many `Name (n)` retries an import makes before giving up. */
export const SUFFIX_CAP = 20;

function err(message, code, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }

/** D18: the one sentence the CLI prints and the Import dialog shows above the commands. */
export const SCRIPT_IMPORT_NOTICE = "These commands run on this machine with worca's privileges when the workflow runs.";

/** The script nodes an import must show first (D18): every node whose EFFECTIVE
 *  params include a command- or code-typed value, with those values. */
export function listScriptNodes(graph, scripts) {
  const out = [];
  for (const n of Array.isArray(graph?.nodes) ? graph.nodes : []) {
    if (!n || n.kind !== 'script' || !n.key) continue;
    const meta = scripts?.[n.key];
    if (!meta) continue;                                          // V4 reports it; nothing to show
    const values = effectiveScriptParams(meta, n.config);
    const params = {};
    for (const p of meta.params || []) {
      if (CONFIRM_PARAM_TYPES.includes(p.type) && typeof values[p.id] === 'string') params[p.id] = values[p.id];
    }
    if (Object.keys(params).length) out.push({ nodeId: n.id, key: n.key, displayName: meta.displayName || n.key, runtime: meta.runtime, params });
  }
  return out;
}

/** One (node, param, value) row per confirmed value, sorted: the identity of a script-node list. A row whose node id
 *  or value is no string (an untrusted body) keeps a null there, so it never equals a derived row. */
function scriptValueRows(list) {
  const rows = [];
  for (const n of Array.isArray(list) ? list : []) {
    const params = n && typeof n === 'object' && n.params && typeof n.params === 'object' && !Array.isArray(n.params) ? n.params : {};
    for (const [id, value] of Object.entries(params)) {
      rows.push(JSON.stringify([typeof n.nodeId === 'string' ? n.nodeId : null, id, typeof value === 'string' ? value : null]));
    }
  }
  return rows.sort().join('\n');
}

/** Ask's graph card (D10): `shown` — the list the card showed and its Save posts — holds exactly the values `derived`
 *  (listScriptNodes over the real registry) holds, in any order. Display fields (key, name, runtime) do not count. */
export function scriptNodesConfirmed(shown, derived) {
  return Array.isArray(shown) && scriptValueRows(shown) === scriptValueRows(derived);
}

/** The CLI block: the notice, then one indented value per command/code param. */
export function formatScriptNodes(list) {
  const lines = [SCRIPT_IMPORT_NOTICE];
  for (const n of list) {
    for (const [id, value] of Object.entries(n.params)) {
      lines.push(`- ${n.displayName} (${n.nodeId}, ${n.runtime}) ${id}:`);
      for (const l of String(value).split('\n')) lines.push(`    ${l}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Validate one node-defaults block against the project-less catalog. Returns an
 * error message, or '' when the block is acceptable. Mirrors setStep's rules so a
 * workflow default can never name something a per-project override could not.
 * (Moved here from ui/server.mjs so the CLI import applies the same gate.)
 */
export function nodeDefaultsError(raw, models, where) {
  if (raw == null) return '';
  if (typeof raw !== 'object' || Array.isArray(raw)) return `defaults for ${where} must be an object`;
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const effort = typeof raw.effort === 'string' ? raw.effort.trim() : '';
  const entry = model ? models.find((m) => m.id === model) : null;
  if (model && !entry) return `unknown model "${model}"`;
  // subagentModel is a fixed alias enum, NOT a catalog id: validated via the
  // shared helper so a typo is a 400 with the same message every writer uses.
  const subIssue = subagentModelIssue(raw.subagentModel);
  if (subIssue) return subIssue;
  if (!effort) return '';
  if (!ALL_EFFORTS.includes(effort)) return `unknown effort "${effort}"`;
  if (!entry) return 'select a model before choosing an effort';
  if (!entry.efforts.includes(effort)) return `model "${model}" does not support effort "${effort}"`;
  return '';
}

/**
 * The shareable form of a saved v2 workflow: the STORED row (not the resolved
 * graph the Claude Code exporter snapshots — that one applies workspace-variant
 * substitution and drops `canvas`). No id, origin or timestamps: the importer
 * mints an id. Per-node `config` stays; project-layer overrides never ride along.
 * @param {string} id
 */
export async function exportGraphJson(id) {
  const tpl = await readWorkflow(id);
  if (!tpl) throw err(`workflow not found: ${id}`, 'NOT_FOUND');
  if (tpl.auto) throw err('the Auto entry has no graph to export — it is decided per run', 'UNSUPPORTED');
  if (tpl.version !== 2) {
    throw err(`workflow ${id} is a v1 template — open and save it in the Workflows view first`, 'UNSUPPORTED');
  }
  const out = {
    version: 2,
    name: tpl.name,
    domain: tpl.domain || 'general',
    nodes: Array.isArray(tpl.nodes) ? tpl.nodes : [],
    wires: Array.isArray(tpl.wires) ? tpl.wires : [],
  };
  Object.assign(out, pickTemplateExtras(tpl, out.nodes));
  return out;
}

/** Filename stem for a shared workflow: the id without its `wf_` prefix. */
export function workflowFileSlug(id) {
  const stem = String(id || '').replace(/^wf_/, '');
  return stem.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
}

/**
 * The V4 "unknown agent" issues folded into ONE actionable line, or null when
 * the errors carry none. A workflow that references agents the recipient does
 * not have is useless without them — which is what the plugin format is for.
 * @param {Array<{code:string, message:string}>} errors
 */
export function summarizeUnknownAgents(errors) {
  const keys = [];
  for (const e of errors || []) {
    if (e?.code !== 'V4') continue;
    const m = /unknown agent "([^"]+)"/.exec(String(e.message || ''));
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }
  if (!keys.length) return null;
  return `this workflow references ${keys.length} agent${keys.length === 1 ? '' : 's'} not installed here `
    + `(${keys.join(', ')}) — ask its author to share it as a plugin `
    + '(worca workflow export <id> --format plugin), which bundles them';
}

/** Body -> the graph the validator and the store see. `keepId` is the composer's
 *  re-save of a loaded row; an import never trusts an id from a file. */
function prepareGraph(body, { keepId, name }) {
  if (Number(body?.version) !== 2) {
    throw err('v1 pipeline templates are no longer accepted — save a graph (version 2)', 'BAD_REQUEST');
  }
  const override = typeof name === 'string' ? name.trim() : '';
  const graph = {
    id: keepId && typeof body.id === 'string' ? body.id : undefined,
    name: override || (typeof body.name === 'string' ? body.name.trim() : ''),
    domain: typeof body.domain === 'string' ? body.domain : undefined,
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    wires: Array.isArray(body.wires) ? body.wires : [],
    ...pickTemplateExtras(body, Array.isArray(body.nodes) ? body.nodes : []),
  };
  if (!graph.name) throw err('name is required', 'BAD_REQUEST');
  return graph;
}

/** Catalog + structural validation. Throws BAD_REQUEST / INVALID_GRAPH; returns the warnings and the script registry it used. */
async function validateForSave(graph, { registry, scripts, agentsDir }) {
  // Catalog validation FIRST: a v2 node's `config` IS its defaults block (§4),
  // so a value the per-project override could not name must not ride in
  // through a template save. Only AGENT_TUNABLES are handed to nodeDefaultsError —
  // topology keys (awaitAll, arity, planStoreSeed) never are.
  const models = await listModels('');
  for (const n of graph.nodes) {
    if (!n || n.kind !== 'agent' || !n.config || typeof n.config !== 'object') continue;
    const picked = Object.fromEntries(AGENT_TUNABLES.filter((k) => k in n.config).map((k) => [k, n.config[k]]));
    const bad = nodeDefaultsError(picked, models, `node "${n.id}"`);
    if (bad) throw err(bad, 'BAD_REQUEST');
  }
  const reg = registry || loadAgentRegistry(agentsDir || DEFAULT_AGENTS_DIR);
  const scr = scripts && typeof scripts === 'object' ? scripts : loadScriptRegistry({ agentKeys: Object.keys(reg) });
  const { errors, warnings } = validateGraph({ ...graph, version: 2 }, registryPortsFn(reg, scr));
  // The message stays the composer's verbatim 'invalid graph' (app.js renders
  // the issue list); `summary` is the one-line V4 fold for the CLI and the
  // import button, which have no issue list to show.
  if (errors.length) throw err('invalid graph', 'INVALID_GRAPH', { errors, warnings, summary: summarizeUnknownAgents(errors) });
  return { warnings, scripts: scr };
}

/**
 * The composer's Save. A legal `id` in the body is a re-save of that row; a
 * body without one mints wf_<slug(name)> and REFUSES to land on a live row
 * (ID_TAKEN carries the id so the dialog can offer rename/overwrite). `origin`
 * is the caller's, never the body's: the API route passes none (a re-save keeps
 * the row's own), Ask's graph card passes 'auto'. `confirmScripts` (Ask's graph
 * card) applies the import's D18/P10 rule, bound to what the card showed: a graph
 * carrying a command/code value is refused (SCRIPTS_UNCONFIRMED + .scriptNodes)
 * unless `acceptScripts` is the list the card showed, holding exactly the values
 * re-derived here (scriptNodesConfirmed) — a yes/no flag confirms nothing. The
 * composer's Save passes neither: its canvas shows them.
 * @returns {Promise<{workflow: object, warnings: Array}>}
 * @throws code 'SCRIPTS_UNCONFIRMED' (`.scriptNodes`) — nothing was written
 */
export async function saveGraphWorkflow(body, { registry, agentsDir, origin = null, confirmScripts = false, acceptScripts = null } = {}) {
  const graph = prepareGraph(body || {}, { keepId: true });
  const { warnings, scripts } = await validateForSave(graph, { registry, agentsDir });
  if (confirmScripts === true) {
    const scriptNodes = listScriptNodes(graph, scripts);
    if (scriptNodes.length && !scriptNodesConfirmed(acceptScripts, scriptNodes)) {
      throw err(`this workflow runs commands on this machine (${scriptNodes.map((n) => `${n.displayName} · ${n.nodeId}`).join(', ')}) — review them on the card, then save again`,
        'SCRIPTS_UNCONFIRMED', { scriptNodes });
    }
  }
  const workflow = await writeGraphWorkflow(typeof origin === 'string' && origin ? { ...graph, origin } : graph, { rejectCollision: true });
  return { workflow, warnings };
}

const SUFFIX_RE = /\s\((\d+)\)$/;

/**
 * Import a shared graph into the library. The file's id/origin are ignored (the
 * importer mints), `name` overrides the file's name, and a collision with a live
 * row retries as `Name (2)`, `Name (3)`… up to SUFFIX_CAP — never overwrite.
 * @param {object} body  the exportGraphJson shape
 * @param {{name?: string, registry?: object, scripts?: object, agentsDir?: string, dryRun?: boolean, acceptScripts?: boolean}} [opts]
 *   dryRun: validate and list the script nodes (D18) WITHOUT writing — the Import
 *   dialog and the CLI confirm from this before the real import.
 *   acceptScripts: the caller SHOWED the user every command/code value and the user
 *   agreed. Anything but the literal `true` refuses a graph that carries one (P10):
 *   the default is the safe one, so a caller that never heard of scripts cannot
 *   import a command by accident.
 * @returns {Promise<{workflow: object|null, warnings: Array, requestedName: string, renamed: boolean, scriptNodes: Array}>}
 * @throws code 'SCRIPTS_UNCONFIRMED' (`.scriptNodes`) — nothing was written
 */
export async function importGraphWorkflow(body, { name, registry, scripts, agentsDir, dryRun = false, acceptScripts = false } = {}) {
  const graph = prepareGraph(body || {}, { keepId: false, name });
  const { warnings, scripts: scr } = await validateForSave(graph, { registry, scripts, agentsDir });
  const scriptNodes = listScriptNodes(graph, scr);
  const requestedName = graph.name;
  if (dryRun) return { workflow: null, warnings, requestedName, renamed: false, scriptNodes };
  if (scriptNodes.length && acceptScripts !== true) {
    throw err(`this workflow runs commands on this machine (${scriptNodes.map((n) => `${n.displayName} · ${n.nodeId}`).join(', ')}) — review them, then import again with the scripts accepted`,
      'SCRIPTS_UNCONFIRMED', { scriptNodes });
  }
  const m = SUFFIX_RE.exec(requestedName);
  const base = m ? requestedName.slice(0, m.index) : requestedName;
  let n = m ? Number(m[1]) : 1;
  let candidate = requestedName;
  for (let attempt = 0; attempt <= SUFFIX_CAP; attempt++) {
    try {
      const workflow = await writeGraphWorkflow({ ...graph, name: candidate }, { rejectCollision: true });
      return { workflow, warnings, requestedName, renamed: candidate !== requestedName, scriptNodes };
    } catch (e) {
      if (e?.code === 'RESERVED_NAME') {
        throw err(`${e.message} (pass a different name to import it)`, 'RESERVED_NAME');
      }
      if (e?.code !== 'ID_TAKEN') throw e;
      n += 1;
      candidate = `${base} (${n})`;
    }
  }
  throw err(`could not find a free name for "${requestedName}" after ${SUFFIX_CAP} tries — pass --name`, 'ID_TAKEN');
}
