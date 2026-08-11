// src/core/workflows.mjs
// Global workflow-template store (v2 graphs) + the resolve layer the graph engine
// runs on.
//
// Templates are TOPOLOGY ONLY — nodes + wires, by node id. The whole flat
// template lives in the `workflows.graph` column as JSON; the row's own
// id/name/domain columns stay authoritative on read. Per-project model/effort
// data is the run-config in config.mjs and per-wire loop budgets live in
// config_workflow_wires; both are merged in by resolveGraph.
//
// Reads never throw: a missing/corrupt/foreign-id row yields []/null (loudly —
// a dropped row is warned about, never silently swallowed).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getDb, prepare, tx } from './db.mjs';
import { worcaHome } from './projects.mjs';
import { projectKey } from './store.mjs';
import { resolveRunConfig, readConfig } from './config.mjs';
import { slugify } from './artifacts.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from './graph/builtin-workflows.mjs';
import { portsFnFor } from './graph/fixtures.mjs';
import { classifyLoops, resolveOrOutType } from './graph/ports.mjs';

/**
 * Default loop budget when neither the per-project overlay nor the wire itself
 * sets one. Matches the Composer's per-loop input default, so an unset loop wire
 * runs 3 cycles.
 */
const DEFAULT_MAX_CYCLES = 3;

/** Local domain guard (mirrors agent-registry DOMAIN_RE). workflows.mjs deliberately
 *  does not import the registry, so a one-line constant is cheaper than a new coupling.
 *  Unlike the registry's normalizeDomain, this .trim()s — store input may carry
 *  whitespace from a prompt. Absent/malformed → the VISIBLE 'general' default. */
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/;
function normDomain(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return DOMAIN_RE.test(v) ? v : 'general';
}

/** Default location of the agent prompt markdown files (mirrors orchestrator.mjs). */
const DEFAULT_AGENTS_DIR = new URL('../../agents/', import.meta.url).pathname;

/**
 * Read an agent prompt file and pull its declared tools from YAML frontmatter.
 * Returns { prompt, tools }. A missing file => { prompt:'', tools:[] } (fails
 * safe; the executor already tolerates an empty agent body). The frontmatter
 * `tools:` line is a comma-separated list (matches agents/*.md convention).
 * @param {string} agentsDir
 * @param {string|null} agentFile
 * @param {string|null} [agentPath]
 * @returns {Promise<{prompt:string, tools:string[]}>}
 */
async function loadAgentFile(agentsDir, agentFile, agentPath = null) {
  if (!agentFile && !agentPath) return { prompt: '', tools: [] };
  let text = '';
  try {
    // Layered registry: the meta's stamped absolute agentPath (built-in OR user
    // layer) wins; the classic agentsDir+agentFile join is the fallback for
    // hand-built registries (tests) and a vanished user .md.
    text = await readFile(agentPath || join(agentsDir, agentFile), 'utf8');
  } catch {
    if (agentPath && agentFile) {
      try { text = await readFile(join(agentsDir, agentFile), 'utf8'); } catch { return { prompt: '', tools: [] }; }
    } else {
      return { prompt: '', tools: [] };
    }
  }
  return { prompt: text, tools: parseFrontmatterTools(text) };
}

/** Extract a comma-separated `tools:` list from leading --- YAML frontmatter. */
function parseFrontmatterTools(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!m) return [];
  const line = m[1].split(/\r?\n/).find((l) => /^tools\s*:/.test(l));
  if (!line) return [];
  return line
    .replace(/^tools\s*:/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Absolute path to ~/.worca-cc/workflows (honors WORCA_HOME via projects.mjs). */
export function workflowsDir() {
  return join(worcaHome(), 'workflows');
}

/** A workflow id is a stem; reject anything that could escape a path-built store
 *  (path separators, "..", dots, spaces). Valid ids are wf_<slug> / wf_default. */
const SAFE_WORKFLOW_ID = /^[A-Za-z0-9_-]+$/;
function isSafeWorkflowId(id) { return typeof id === 'string' && SAFE_WORKFLOW_ID.test(id); }

/** The columns every read selects: the graph JSON plus the authoritative metadata. */
const ROW_COLUMNS = 'id, name, version, domain, graph, created_at, updated_at, origin';

/**
 * Map a version-2 workflows row to the flat template object, or null when the
 * row cannot be trusted. The `graph` column is parsed and its `id` is ASSERTED
 * against the row's own id: a hand-edited or mis-migrated row would otherwise
 * resolve under a foreign identity. Reads never throw (the module contract), so
 * a rejected row is warned about and dropped instead.
 * @param {object} r  a workflows row selected with ROW_COLUMNS
 * @returns {object|null}
 */
function rowToTpl(r) {
  if (Number(r.version) !== 2) {
    return null;                            // a leftover v1 row is not a template
  }
  let parsed;
  try { parsed = JSON.parse(r.graph); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn(`[workflows] "${r.id}": the graph column is missing or unparseable — row ignored`);
    return null;
  }
  if (parsed.id !== r.id) {
    console.warn(
      `[workflows] "${r.id}": the graph column carries id "${parsed.id}" — row ignored ` +
      '(hand-edited or mis-migrated; re-save the template to repair it)',
    );
    return null;
  }
  const tpl = {
    ...parsed,
    id: r.id,                               // row columns are authoritative
    name: r.name,
    version: 2,
    domain: r.domain || 'general',          // pre-migration NULL → 'general'
    origin: r.origin || null,               // 'plugin:<name>' provenance; NULL = user-created
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
    wires: Array.isArray(parsed.wires) ? parsed.wires : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  return tpl;
}

/** Read + validate one stored template row. Unsafe id / missing / not-v2 => null. */
function readRaw(id) {
  if (!isSafeWorkflowId(id)) return null; // SECURITY: reject path-traversal / unsafe ids
  getDb();
  const r = prepare(`SELECT ${ROW_COLUMNS} FROM workflows WHERE id = ?`).get(id);
  return r ? rowToTpl(r) : null;
}

/**
 * Persist a v2 graph template. Stamps a wf_<slug> id (from the name) when
 * missing, version 2, createdAt (preserved across re-saves) and a fresh
 * updatedAt. The FULL flat template is JSON-encoded into the `graph` column, so
 * the column parses straight back into a validateGraph-ready object; the v1
 * `steps`/`feedbacks` columns are blanked. Never mutates the input.
 * @param {object} tpl { id?, name, version?, domain?, nodes, wires, canvas?, createdAt? }
 * @returns {Promise<object>} the stored template
 * @throws {Error} when `version` is present and is not 2
 */
export async function writeWorkflow(tpl) {
  if (!tpl || typeof tpl !== 'object') throw new Error('workflow template must be an object');
  if (tpl.version !== undefined && Number(tpl.version) !== 2) {
    throw new Error(`unsupported workflow version ${tpl.version}: only version 2 graph templates are stored`);
  }
  const now = new Date().toISOString();
  const name = (typeof tpl.name === 'string' && tpl.name.trim()) || 'Untitled';
  const id = (typeof tpl.id === 'string' && tpl.id.trim()) || `wf_${slugify(name)}`;
  const nodes = Array.isArray(tpl.nodes) ? tpl.nodes : [];
  const wires = Array.isArray(tpl.wires) ? tpl.wires : [];
  const domain = normDomain(tpl.domain);

  getDb();
  // Preserve the original createdAt if this id already exists (re-save).
  const existing = isSafeWorkflowId(id)
    ? prepare('SELECT created_at FROM workflows WHERE id = ?').get(id)
    : null;
  const createdAt =
    (typeof tpl.createdAt === 'string' && tpl.createdAt) ||
    (existing && existing.created_at) ||
    now;

  // The persisted document deliberately omits updatedAt: the row column is
  // restamped on every save and would go stale inside the JSON. createdAt stays,
  // matching the shape the V17 re-seed writes.
  const graph = { id, name, version: 2, domain, createdAt, nodes, wires };
  if (tpl.canvas && typeof tpl.canvas === 'object') graph.canvas = tpl.canvas; // view state, engine-ignored

  tx(() => {
    prepare(`
      INSERT INTO workflows (id, name, version, domain, graph, steps, feedbacks, created_at, updated_at)
      VALUES (?, ?, 2, ?, ?, '[]', '[]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, version = 2, domain = excluded.domain,
        graph = excluded.graph, steps = '[]', feedbacks = '[]',
        updated_at = excluded.updated_at
    `).run(id, name, domain, JSON.stringify(graph), createdAt, now);
  });
  return { ...graph, updatedAt: now };
}

/**
 * Read a template by id. Returns the built-in GRAPH_DEFAULT_WORKFLOW for
 * "wf_default"; otherwise the stored v2 row, or null when absent/corrupt/
 * unsafe-id/not-v2.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function readWorkflow(id) {
  if (id === GRAPH_DEFAULT_WORKFLOW.id) return GRAPH_DEFAULT_WORKFLOW;
  return readRaw(id);
}

/**
 * List user templates (NOT the built-in default — callers prepend it), newest
 * first by createdAt. Rows that are not trustworthy v2 graphs are dropped.
 * Empty store => []. Never throws.
 * @returns {Promise<object[]>}
 */
export async function listWorkflows() {
  getDb();
  const rows = prepare(`SELECT ${ROW_COLUMNS} FROM workflows ORDER BY created_at DESC, id`).all();
  return rows
    .filter((r) => r.id !== GRAPH_DEFAULT_WORKFLOW.id)
    .map(rowToTpl)
    .filter(Boolean);
}

/**
 * Delete a saved template by id. Refuses the built-in default (false) and unsafe
 * ids (false). Returns false when no row exists; true on removal.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteWorkflow(id) {
  if (id === GRAPH_DEFAULT_WORKFLOW.id) return false; // built-in default is undeletable
  if (!isSafeWorkflowId(id)) return false;            // SECURITY: reject unsafe ids
  getDb();
  let changed = 0;
  tx(() => {
    changed = prepare('DELETE FROM workflows WHERE id = ?').run(id).changes;
  });
  return changed > 0;
}

/**
 * The ONE shared port synthesis applied to a LIVE agent registry: agent nodes get
 * their meta ports plus the synthesized universal `await` gate input appended
 * last, and task/end/and/or/combine get their flow ports.
 *
 * Exported because callers that validate a template which is NOT in the DB yet
 * (the server save route, plugin import) cannot go through resolveGraph — and
 * without a synthesizing portsFn the seeds' `pass -> checklist.await` wires fail
 * V5. It is literally `portsFnFor` over the registry: there is exactly one
 * authored synthesis (graph/fixtures.mjs), never a private copy.
 *
 * @param {Record<string,object>} registry  loadAgentRegistry() output
 * @returns {(node:object) => (object|undefined)}
 */
export function registryPortsFn(registry) {
  return portsFnFor(registry && typeof registry === 'object' ? registry : {});
}

// ── generic workspace substitution ───────────────────────────────────────────

/** Layer precedence for competing workspace variants: builtin > user > plugin.
 *  A hand-built registry entry with no origin sorts with the plugin layer — it is
 *  the weakest claim, and the tie is then broken by `order` and finally the key,
 *  so the winner never depends on object insertion order. */
function layerRank(meta) {
  const origin = String(meta?.origin || '');
  if (origin === 'builtin') return 0;
  if (origin === 'user') return 1;
  return 2;
}

/** The comparable signature of ONE port: exactly the fields the spec pins
 *  (id, type, and the required/loop/expands/when flags). Renderer hints (`as`),
 *  filenames and stores are deliberately NOT compared — a workspace variant
 *  writes to its own files by design. */
function portSignature(port, side) {
  const sig = { id: port?.id ?? null, type: port?.type ?? null };
  if (side === 'inputs') {
    sig.required = port?.required !== false;
    sig.loop = !!port?.loop;
    sig.expands = !!port?.expands;
  } else {
    sig.when = port?.when || 'always';
  }
  return sig;
}

/** The META port signature of an agent entry (the synthesized `await` input is
 *  added ABOVE this layer and is never part of the comparison). */
function metaSignature(meta) {
  return {
    inputs: (Array.isArray(meta?.inputs) ? meta.inputs : []).map((p) => portSignature(p, 'inputs')),
    outputs: (Array.isArray(meta?.outputs) ? meta.outputs : []).map((p) => portSignature(p, 'outputs')),
    verdict: !!meta?.verdict,
  };
}

/**
 * Build the workspace-variant map: agent key -> the winning variant's meta.
 *
 * The constraints live HERE, not in the registry, because they are only
 * meaningful against a target: a variant must be workspace-only and its META
 * port signature must deep-equal its target's, or a workspace run would silently
 * change the graph's wiring contract. Both are asserted for EVERY declared
 * variant on every resolve — a broken pair is a misconfiguration that must not
 * wait for the one run that happens to place the target node.
 *
 * @param {Record<string,object>} reg
 * @returns {Map<string,object>} target key -> winning variant meta
 * @throws {Error} on a non-workspace-only variant or a port-signature mismatch
 */
function workspaceVariants(reg) {
  const byTarget = new Map();
  for (const key of Object.keys(reg).sort()) {                // deterministic scan order
    const meta = reg[key];
    const target = meta && typeof meta.workspaceVariantOf === 'string' ? meta.workspaceVariantOf : '';
    if (!target) continue;
    if (meta.scope !== 'workspace-only') {
      throw new Error(
        `agent "${key}" declares workspaceVariantOf "${target}" but its scope is ` +
        `"${meta.scope ?? 'project'}" — a workspace variant must be scope "workspace-only"`,
      );
    }
    const targetMeta = reg[target];
    if (!targetMeta) {
      // Nothing to substitute (e.g. a plugin ships a variant of an agent that is
      // not installed): inert, but never silent.
      console.warn(`[workflows] workspace variant "${key}" targets unknown agent "${target}" — ignored`);
      continue;
    }
    const mine = JSON.stringify(metaSignature(meta));
    const theirs = JSON.stringify(metaSignature(targetMeta));
    if (mine !== theirs) {
      throw new Error(
        `workspace variant "${key}" does not match the port signature of "${target}": ` +
        `${mine} vs ${theirs}`,
      );
    }
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(meta);
  }

  const winners = new Map();
  for (const [target, candidates] of byTarget) {
    candidates.sort((a, b) =>
      layerRank(a) - layerRank(b)
      || (Number(a.order) || 0) - (Number(b.order) || 0)
      || String(a.key).localeCompare(String(b.key)));
    const [winner, ...losers] = candidates;
    for (const l of losers) {
      console.warn(
        `[workflows] workspace variant "${l.key}" of "${target}" loses to "${winner.key}" ` +
        `(layer ${l.origin || 'unknown'} / order ${l.order}) — not substituted`,
      );
    }
    winners.set(target, winner);
  }
  return winners;
}

// ── resolve ──────────────────────────────────────────────────────────────────

/** First value that is not undefined (an explicit `false` still wins). */
const firstDefined = (...vals) => vals.find((v) => v !== undefined);

/**
 * Read this project's per-wire loop budgets for one workflow.
 * @returns {Map<string,number>} wire id -> maxCycles (only sane positive ints)
 */
function readWireBudgets(projectDir, workflowId) {
  getDb();
  const rows = prepare(
    'SELECT wire_id, max_cycles FROM config_workflow_wires WHERE project_key = ? AND workflow_id = ?'
  ).all(projectKey(projectDir), workflowId);
  const out = new Map();
  for (const r of rows) {
    const n = Math.floor(Number(r.max_cycles));
    if (Number.isInteger(n) && n > 0) out.set(r.wire_id, n);
  }
  return out;
}

/**
 * Merge a stored v2 template + the project's run-config + the agent registry into
 * everything the graph engine needs to run it:
 *
 *   {
 *     template,   // a mutable CLONE: agent keys substituted for a workspace run,
 *                 // loop wires carrying their resolved maxCycles
 *     ports,      // the synthesizing portsFn (meta ports + the universal `await`
 *                 // gate + the flow-card table), with or.out carrying its
 *                 // RESOLVED payload type
 *     nodeCtx,    // per-node run context, keyed by node id
 *   }
 *
 * Precedence, per node: the per-project overlay (config_workflow_nodes, keyed by
 * node id) > the template's own `node.config` > the legacy per-role config
 * (config.mjs `steps`, keyed by the AUTHORED agent key) > the sidecar default.
 * Model/effort stay `undefined` when nothing is configured — the orchestrator
 * folds the global fallback in at dispatch.
 *
 * Per-wire loop budgets: the overlay (config_workflow_wires) > the wire's own
 * `config.maxCycles` > DEFAULT_MAX_CYCLES, merged onto LOOP WIRES ONLY (a budget
 * on any other wire is a V13 error).
 *
 * Workspace runs substitute generically: any registry entry declaring
 * `workspaceVariantOf === node.key` replaces that node's key (see
 * workspaceVariants for the constraints and the layer precedence).
 *
 * @param {string} projectDir
 * @param {string} workflowId
 * @param {Record<string,object>} registry  loadAgentRegistry() output
 * @param {string} [agentsDir]  override for tests; defaults to ../../agents
 * @param {{ isWorkspace?: boolean }} [opts]
 * @returns {Promise<{template:object, ports:Function, nodeCtx:Record<string,object>}>}
 * @throws {Error} unknown workflow id, a placeable:false agent as a node, or a
 *                 broken workspace variant declaration
 */
export async function resolveGraph(projectDir, workflowId, registry, agentsDir = DEFAULT_AGENTS_DIR, opts = {}) {
  const stored = await readWorkflow(workflowId);
  if (!stored) throw new Error(`workflow not found: ${workflowId}`);
  const reg = registry && typeof registry === 'object' ? registry : {};
  const isWorkspace = !!(opts && opts.isWorkspace);

  // Asserted on EVERY resolve, workspace or not: a broken variant declaration is
  // a misconfiguration, and the run that trips over it must not be the one that
  // happens to place the target node.
  const variants = workspaceVariants(reg);

  // GRAPH_DEFAULT_WORKFLOW is deep-frozen and stored templates are shared reads;
  // everything below mutates, so work on a clone.
  const template = structuredClone(stored);
  const nodes = Array.isArray(template.nodes) ? template.nodes : [];

  const { nodes: nodeCfg } = await resolveRunConfig(projectDir, workflowId);
  const roleCfg = (await readConfig(projectDir)).steps || {};

  const nodeCtx = {};
  for (const node of nodes) {
    if (node.kind !== 'agent') {
      nodeCtx[node.id] = { nodeId: node.id, kind: node.kind, key: null, config: node.config || {} };
      continue;
    }
    const templateKey = node.key;
    const key = isWorkspace ? (variants.get(templateKey)?.key ?? templateKey) : templateKey;
    node.key = key;                                        // the scheduler runs the SUBSTITUTED graph
    const meta = reg[key] || {};
    if (meta.placeable === false) {
      throw new Error(`agent "${key}" declares placeable: false and cannot be a workflow node`);
    }
    const { prompt, tools } = await loadAgentFile(agentsDir, meta.agentFile ?? null, meta.agentPath ?? null);
    const overlay = nodeCfg[node.id] || {};
    const cfg = node.config || {};
    // The legacy per-role layer is keyed by the AUTHORED key, so a substituted
    // workspace variant still inherits the user's settings for the node they drew.
    const role = roleCfg[templateKey] || {};

    nodeCtx[node.id] = {
      nodeId: node.id,
      kind: 'agent',
      key,
      templateKey,
      meta,
      runnerType: meta.runnerType || 'producer',
      agentFile: meta.agentFile ?? null,
      agentPrompt: prompt,
      promptHints: typeof meta.promptHints === 'string' ? meta.promptHints : '',
      tools,
      config: cfg,
      model: firstDefined(overlay.model, cfg.model, role.model),
      effort: firstDefined(overlay.effort, cfg.effort, role.effort),
      fanOut: !!firstDefined(overlay.fanOut, cfg.fanOut, role.fanOut, meta.fanOut, false),
      // Per-agent user questions: unsupported is ALWAYS off; locked ignores every
      // override; else overlay > node config > role > sidecar default.
      askQuestions: !meta.asksQuestions
        ? false
        : (meta.questionsLocked
            ? !!meta.questionsDefault
            : !!firstDefined(overlay.askQuestions, cfg.askQuestions, role.askQuestions, meta.questionsDefault, false)),
      awaitAll: !!cfg.awaitAll,
      duplicateKey: false,                                 // filled in below
    };
  }

  // DUPLICATE-KEY RULE: two agent nodes sharing one RESOLVED key make every
  // `store: 'run'` output and verdict of those nodes carry a `<nodeId>-` prefix,
  // so a second instance of a verifier cannot clobber the first's files.
  const keyCounts = new Map();
  for (const ctx of Object.values(nodeCtx)) {
    if (ctx.kind !== 'agent') continue;
    keyCounts.set(ctx.key, (keyCounts.get(ctx.key) || 0) + 1);
  }
  for (const ctx of Object.values(nodeCtx)) {
    if (ctx.kind === 'agent') ctx.duplicateKey = (keyCounts.get(ctx.key) || 0) > 1;
  }

  // The or card's declared `any` output resolves to the payload type its wiring
  // actually carries, so the run monitor and the composer preview render md/json/
  // void dots without re-deriving it. Resolution itself runs over the DECLARED
  // ports (basePorts), which is what lets chained or cards walk through.
  const basePorts = registryPortsFn(reg);
  const ports = (node) => {
    const resolved = basePorts(node);
    if (!resolved || node.kind !== 'or') return resolved;
    const type = resolveOrOutType(node, template, basePorts) || 'any';
    return { ...resolved, outputs: resolved.outputs.map((o) => (o.id === 'out' ? { ...o, type } : o)) };
  };

  // Per-wire loop budgets. Only LOOP wires carry one: V13 rejects a budget
  // anywhere else, so a stale overlay row on a plain wire is ignored.
  const { loopWires } = classifyLoops(template, ports);
  const budgets = readWireBudgets(projectDir, workflowId);
  for (const wire of Array.isArray(template.wires) ? template.wires : []) {
    if (!loopWires.has(wire.id)) continue;
    const declared = Math.floor(Number(wire.config?.maxCycles));
    const fallback = Number.isInteger(declared) && declared > 0 ? declared : DEFAULT_MAX_CYCLES;
    wire.config = { ...(wire.config || {}), maxCycles: budgets.get(wire.id) ?? fallback };
  }

  return { template, ports, nodeCtx };
}

// ── the UI manifest ──────────────────────────────────────────────────────────

/** Palette names for the engine's flow cards (spec §4). Agent cards use their
 *  registry displayName instead. */
const FLOW_LABEL = { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' };

/** The manifest projection of one input port: identity, payload type and the
 *  three flags the monitor/composer render from (the synthesized `await` gate is
 *  an ordinary entry here — it is what the run monitor anchors its wires to). */
function manifestInput(port) {
  return {
    id: port.id,
    type: port.type,
    required: port.required !== false,
    loop: !!port.loop,
    expands: !!port.expands,
  };
}

/** The manifest projection of one output port. On an `or` card `type` is already
 *  the RESOLVED payload type — resolveGraph's portsFn did that, so nothing
 *  downstream re-derives it. */
function manifestOutput(port) {
  return { id: port.id, type: port.type, when: port.when || 'always' };
}

/**
 * Build the run-monitor manifest (spec §8 manifest v2) from a resolveGraph
 * result. This is the snapshot persisted into `pipelines.stepper` and replayed
 * by the Running/History views, so it has to be self-sufficient: every node
 * carries its resolved ports (agents including the synthesized `await` gate,
 * and/or/end included as real graph nodes), and every wire carries its loop flag
 * plus the resolved budget. Preflight and Done stay UI chrome — bookends, not
 * graph nodes; the End card is a graph node and is NOT a replacement for them.
 *
 * Pure and defensive: a half-built resolve yields an empty graph rather than a
 * throw, because this runs on the persistence path of a live run.
 *
 * @param {{template:object, ports:Function, nodeCtx:Record<string,object>}} resolved
 * @returns {{version:2, graph:{nodes:object[], wires:object[]}, bookends:{preflight:boolean, done:boolean}}}
 */
export function buildGraphManifest(resolved) {
  const template = resolved && typeof resolved.template === 'object' && resolved.template
    ? resolved.template
    : { nodes: [], wires: [] };
  const ports = typeof resolved?.ports === 'function' ? resolved.ports : () => undefined;
  const nodeCtx = resolved?.nodeCtx && typeof resolved.nodeCtx === 'object' ? resolved.nodeCtx : {};
  const nodes = Array.isArray(template.nodes) ? template.nodes : [];
  const wires = Array.isArray(template.wires) ? template.wires : [];

  const { loopWires } = classifyLoops(template, ports);
  // A node "cycles" when a loop wire lands on it — the v1 stepper's `cycles` flag,
  // now derived from the wires instead of a feedback list.
  const loopTargets = new Set(wires.filter((w) => loopWires.has(w.id)).map((w) => w?.to?.node));

  return {
    version: 2,
    graph: {
      nodes: nodes.map((node) => {
        const ctx = nodeCtx[node.id] || {};
        const meta = ctx.meta || {};
        const resolvedPorts = ports(node) || {};
        const key = node.kind === 'agent' ? (ctx.key || node.key || '') : null;
        return {
          id: node.id,
          kind: node.kind,
          key,
          label: node.kind === 'agent' ? (meta.displayName || key) : (FLOW_LABEL[node.kind] || node.kind),
          color: meta.color || '',
          sub: meta.description || '',
          x: node.x,
          y: node.y,
          model: ctx.model || '',
          effort: ctx.effort || '',
          loop: loopTargets.has(node.id),
          ports: {
            inputs: (resolvedPorts.inputs || []).map(manifestInput),
            outputs: (resolvedPorts.outputs || []).map(manifestOutput),
          },
        };
      }),
      wires: wires.map((wire) => {
        const loop = loopWires.has(wire.id);
        return {
          id: wire.id,
          from: { node: wire.from?.node, port: wire.from?.port },
          to: { node: wire.to?.node, port: wire.to?.port },
          loop,
          // Budgets exist on loop wires only (V13); resolveGraph already merged
          // the overlay in, so this is the number the scheduler will enforce.
          ...(loop ? { maxCycles: Number(wire.config?.maxCycles) || DEFAULT_MAX_CYCLES } : null),
        };
      }),
    },
    bookends: { preflight: true, done: true },
  };
}
