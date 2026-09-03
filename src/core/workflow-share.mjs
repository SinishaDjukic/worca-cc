// src/core/workflow-share.mjs
// "Share this workflow with another Worca user" (issue #421): the JSON round
// trip. ONE validate-then-save path for a v2 graph that arrives from outside
// the running composer, shared by POST /api/workflows (the composer's Save),
// POST /api/workflows/import-json, `worca workflow import` and the plugin exporter,
// so the CLI and the server can never disagree about what a legal graph is.
//
// Public surface:
//   exportGraphJson(id)                -> { version:2, name, domain, nodes, wires, canvas? }
//   saveGraphWorkflow(body)            -> composer semantics: keeps a legal `id`, 409 on a minted collision
//   importGraphWorkflow(body, opts)    -> import semantics: id/origin ignored, name suffixed on collision
//   nodeDefaultsError(raw, models, at) -> '' | reason  (per-node tunables vs the project-less catalog)
//
// Errors carry `.code` so surfaces map them to HTTP / exit codes:
//   BAD_REQUEST | INVALID_GRAPH (+ .errors/.warnings/.summary) | RESERVED_NAME |
//   ID_TAKEN (+ .id) | NOT_FOUND | UNSUPPORTED

import { listModels } from './config.mjs';
import { EFFORTS, subagentModelIssue } from './model-env.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from './agent-registry.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
import { validateGraph, AGENT_TUNABLES } from '../shared/graph/validate.mjs';
import { readWorkflow, writeGraphWorkflow } from './workflows.mjs';

/** How many `Name (n)` retries an import makes before giving up. */
export const SUFFIX_CAP = 20;

function err(message, code, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }

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
  if (!EFFORTS.includes(effort)) return `unknown effort "${effort}"`;
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
  if (tpl.version !== 2) {
    throw err(`workflow ${id} is a v1 template — open and save it in the composer first`, 'UNSUPPORTED');
  }
  const out = {
    version: 2,
    name: tpl.name,
    domain: tpl.domain || 'general',
    nodes: Array.isArray(tpl.nodes) ? tpl.nodes : [],
    wires: Array.isArray(tpl.wires) ? tpl.wires : [],
  };
  if (tpl.canvas && typeof tpl.canvas === 'object') out.canvas = tpl.canvas;
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
    ...(body.canvas && typeof body.canvas === 'object' ? { canvas: body.canvas } : {}),
  };
  if (!graph.name) throw err('name is required', 'BAD_REQUEST');
  return graph;
}

/** Catalog + structural validation. Throws BAD_REQUEST / INVALID_GRAPH; returns warnings. */
async function validateForSave(graph, { registry, agentsDir }) {
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
  const portsFn = registryPortsFn(registry || loadAgentRegistry(agentsDir || DEFAULT_AGENTS_DIR));
  const { errors, warnings } = validateGraph({ ...graph, version: 2 }, portsFn);
  if (errors.length) {
    // The message stays the composer's verbatim 'invalid graph' (app.js renders
    // the issue list); `summary` is the one-line V4 fold for the CLI and the
    // import button, which have no issue list to show.
    throw err('invalid graph', 'INVALID_GRAPH', { errors, warnings, summary: summarizeUnknownAgents(errors) });
  }
  return warnings;
}

/**
 * The composer's Save. A legal `id` in the body is a re-save of that row; a
 * body without one mints wf_<slug(name)> and REFUSES to land on a live row
 * (ID_TAKEN carries the id so the dialog can offer rename/overwrite).
 * @returns {Promise<{workflow: object, warnings: Array}>}
 */
export async function saveGraphWorkflow(body, { registry, agentsDir } = {}) {
  const graph = prepareGraph(body || {}, { keepId: true });
  const warnings = await validateForSave(graph, { registry, agentsDir });
  const workflow = await writeGraphWorkflow(graph, { rejectCollision: true });
  return { workflow, warnings };
}

const SUFFIX_RE = /\s\((\d+)\)$/;

/**
 * Import a shared graph into the library. The file's id/origin are ignored (the
 * importer mints), `name` overrides the file's name, and a collision with a live
 * row retries as `Name (2)`, `Name (3)`… up to SUFFIX_CAP — never overwrite.
 * @param {object} body  the exportGraphJson shape
 * @param {{name?: string, registry?: object, agentsDir?: string}} [opts]
 * @returns {Promise<{workflow: object, warnings: Array, requestedName: string, renamed: boolean}>}
 */
export async function importGraphWorkflow(body, { name, registry, agentsDir } = {}) {
  const graph = prepareGraph(body || {}, { keepId: false, name });
  const warnings = await validateForSave(graph, { registry, agentsDir });
  const requestedName = graph.name;
  const m = SUFFIX_RE.exec(requestedName);
  const base = m ? requestedName.slice(0, m.index) : requestedName;
  let n = m ? Number(m[1]) : 1;
  let candidate = requestedName;
  for (let attempt = 0; attempt <= SUFFIX_CAP; attempt++) {
    try {
      const workflow = await writeGraphWorkflow({ ...graph, name: candidate }, { rejectCollision: true });
      return { workflow, warnings, requestedName, renamed: candidate !== requestedName };
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
