// src/core/ask/composer-deps.mjs
// The composer chat's tool family (Workflows view, D10/D11). Present ONLY on a composer thread
// (ask_threads.mode = 'composer'): the child reads the thread row, exactly as it reads the pin. The canvas
// the browser sent with this turn's message (ask_threads.composer) is loaded ONCE into a WORKING COPY — one
// MCP child per turn — and every edit is simulated on it with the shared canvas-ops vocabulary, so later
// calls see earlier ones. Drafted agents/scripts (this turn's, and the ones the browser still holds
// unsaved) join the ports function. Nothing here writes to disk: drafts are saved by the user, from a card.
import { getThread } from './store.mjs';
import { loadAgentRegistry, normalizeMeta } from '../agent-registry.mjs';
import { listScripts } from '../script-store.mjs';
import { readAgent, keyFromName, AGENT_KEY_RE } from '../agent-store.mjs';
import { sourceFileFor, assertKeyAllowed } from '../script-store.mjs';
import { readWorkflow, GRAPH_DEFAULT_WORKFLOW, GRAPH_MEMORY_DEFRAG_WORKFLOW, MEMORY_DEFRAG_WORKFLOW_ID } from '../workflows.mjs';
import { validateMetaV2 } from '../../shared/graph/agent-meta.mjs';
import { normalizeScriptMeta, SCRIPT_KEY_RE, SCRIPT_COLORS } from '../../shared/graph/script-meta.mjs';
import { normalizeCases, CASES_VERSION } from '../../shared/graph/script-cases.mjs';
import { portsFnFor, portsOf } from '../../shared/graph/ports.mjs';
import { normalizeTemplate } from '../../shared/graph/template.mjs';
import { validateGraph, CANVAS_WARNING_CODES } from '../../shared/graph/validate.mjs';
import { classifyLoops } from '../../shared/graph/loops.mjs';
import { applyCanvasOps, buildGraph, newRealErrors } from '../../shared/graph/canvas-ops.mjs';
import { summarizeCanvas, CANVAS_BLOCK_END } from '../../shared/graph/canvas-summary.mjs';
import { composerCardFrom } from './composer-payload.mjs';

const AGENT_COLORS = ['green', 'peach', 'red', 'blue', 'violet', 'amber'];
const RUNNERS = ['producer', 'verifier', 'clarifier'];
const RUNTIMES = ['node', 'shell', 'python'];
const EMPTY = { id: '', name: '', version: 2, domain: '', nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };
const DEFAULT_IO = { getThread, loadAgentRegistry, listScripts, readAgent, readWorkflow };
const str = (v, n = 500) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);   // "toString" is not a taken key
const issue = (e) => ({ code: e.code, message: e.message, ...(e.nodeId ? { nodeId: e.nodeId } : {}) });
const isDraft = (reg, key) => has(reg, key) && reg[key].origin === 'draft';
// The Windows device stems the script store refuses (script-store.mjs WIN_DEVICE_RE, not exported): an agent is a file
// `<key>.md` too. The tools test pins this list against assertKeyAllowed.
const WIN_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** The [composer canvas] block for a thread's stored canvas (the server puts it in the turn prompt). */
export async function composerPromptBlock(thread, io = DEFAULT_IO) {
  const c = thread && thread.composer;
  if (!c || !c.graph) return `[composer canvas]\n(no canvas came with this message)\n${CANVAS_BLOCK_END}`;
  const { agents, scripts } = await registries(io, c.drafts);
  return summarizeCanvas(c.graph, portsFnFor(agents, scripts), { selection: c.selection || null });
}

async function registries(io, drafts = []) {
  // The browser's canvas registry is GET /api/agents WITHOUT ?all=1 (server.mjs, §6.6): workspace-only agents are
  // not placeable there, so they are not placeable here. Their keys stay TAKEN (`reserved`): the stores refuse them.
  const all = io.loadAgentRegistry();
  const agents = {};
  const reserved = new Set();
  for (const [k, m] of Object.entries(all)) { if (m && m.scope === 'workspace-only') reserved.add(k); else agents[k] = m; }
  const scripts = Object.fromEntries((await io.listScripts()).map((s) => [s.key, s]));
  for (const d of Array.isArray(drafts) ? drafts : []) {
    if (d.kind === 'agent' && !has(agents, d.key)) { const m = normalizeMeta({ metaVersion: 2, ...d.meta, key: d.key, agentFile: `${d.key}.md` }, { warn: () => {} }); if (m) agents[d.key] = { ...m, origin: 'draft' }; }
    if (d.kind === 'script' && !has(scripts, d.key)) { const n = normalizeScriptMeta({ metaVersion: 2, ...d.meta, key: d.key }); if (n.meta && !n.errors.length) scripts[d.key] = { ...n.meta, origin: 'draft' }; }
  }
  return { agents, scripts, reserved };
}

export function defaultComposerDeps({ threadId, io = DEFAULT_IO } = {}) {
  let thread = null;
  // Fail CLOSED: an unreadable thread row may be a composer thread, so the turn keeps the composer allowlist (and,
  // with no composer bundle, no canvas tools) — never the full Ask toolset with propose_run.
  try { thread = threadId ? io.getThread(threadId) : null; } catch { return { askMode: 'composer' }; }
  if (!thread || thread.mode !== 'composer') return {};
  let work = null;                 // {tpl, agents, scripts, reserved:Set<key>, drafts:Set<key>, selection}
  async function load() {
    if (work) return work;
    const c = thread.composer || {};
    const { agents, scripts, reserved } = await registries(io, c.drafts);
    work = { tpl: normalizeTemplate(c.graph || EMPTY), agents, scripts, reserved, drafts: new Set((c.drafts || []).map((d) => d.key)), selection: c.selection || null };
    return work;
  }
  /** A draft whose card would pass COMPOSER_LIMITS.card never reaches the dock (composerCardFrom returns null), yet the
   *  model would be told it exists: refuse it here, with the very function that builds the card. */
  const fitsCard = (tool, out) => composerCardFrom(`mcp__worca__${tool}`, out, thread.composer) !== null;
  const portsFn = () => portsFnFor(work.agents, work.scripts);
  const report = (tpl) => {
    const r = validateGraph(tpl, portsFn());
    return {
      todo: r.errors.filter((e) => e.incomplete).length,
      errors: r.errors.filter((e) => !e.incomplete).map(issue),
      warnings: r.warnings.filter((w) => CANVAS_WARNING_CODES.includes(w.code)).map(issue),
    };
  };
  /** A drafted card's `then`: place it ($new) and wire it on a COPY — it lands only when the user saves the draft.
   *  `pf` is the ports function WITH the draft (the draft is not in the working registry yet). */
  function simulateThen(then, kind, key, pf) {
    if (!then || typeof then !== 'object') return null;
    const ops = [{ op: 'add_node', ref: '$new', kind, key, ...(then.near ? { near: then.near } : {}) }, ...(Array.isArray(then.ops) ? then.ops : [])];
    const before = validateGraph(work.tpl, pf);
    const r = applyCanvasOps(work.tpl, ops, { portsFn: pf });
    if (!r.ok) return { ok: false, error: `then: ${r.error}` };
    const broke = newRealErrors(before, validateGraph(r.tpl, pf));
    if (broke.length) return { ok: false, error: `then would leave the graph invalid — ${broke.slice(0, 3).map((e) => e.message).join('; ')}` };
    return { ok: true, ops: r.applied };
  }

  return {
    askMode: 'composer',
    composer: {
      async canvas() {
        await load();
        const pf = portsFn();
        const t = work.tpl;
        const inbound = new Map(t.wires.map((w) => [`${w.to.node}.${w.to.port}`, w.from]));
        const loops = classifyLoops(t, pf).loopWireIds;
        return {
          workflow: { id: t.id || null, name: t.name || '', domain: t.domain || '' },
          selection: work.selection,
          nodes: t.nodes.map((n) => {
            const p = portsOf(pf, n);
            return { id: n.id, kind: n.kind, ...(n.key ? { key: n.key } : {}), title: (p.meta && p.meta.displayName) || n.key || n.kind,
              x: n.x, y: n.y, config: n.config,
              inputs: p.inputs.map((q) => ({ id: q.id, type: q.type, required: q.required !== false && !q.synthetic, ...(q.loop ? { loop: true } : {}), ...(q.expands ? { expands: true } : {}), from: inbound.get(`${n.id}.${q.id}`) || null })),
              outputs: p.outputs.map((q) => ({ id: q.id, type: q.type, when: q.when || 'always', to: t.wires.filter((w) => w.from.node === n.id && w.from.port === q.id).map((w) => w.to) })) };
          }),
          wires: t.wires.map((w) => ({ id: w.id, from: w.from, to: w.to, loop: loops.has(w.id), ...(w.config && w.config.maxCycles ? { maxCycles: w.config.maxCycles } : {}) })),
          ...report(t),
          drafts: [...work.drafts],
        };
      },
      async edit({ ops, summary }) {
        await load();
        // An unsaved draft is in the WORKING registry (its own then, build_workflow) but not in the browser's: a
        // canvas-edit card placing it would be refused when the dock applies it. It reaches the canvas through its card
        // ("Save & add to canvas" runs its then) or inside a build_workflow (Apply saves it first).
        const unsaved = (Array.isArray(ops) ? ops : []).find((o) => o && o.op === 'add_node' && typeof o.key === 'string' && work.drafts.has(o.key));
        if (unsaved) return { ok: false, error: `"${unsaved.key}" is an unsaved draft — edit_canvas cannot place it until the user saves it. Put its placement and wiring in the draft's then (draft it again with then), or use it inside build_workflow.` };
        const before = validateGraph(work.tpl, portsFn());
        const r = applyCanvasOps(work.tpl, ops, { portsFn: portsFn() });
        if (!r.ok) return { ok: false, error: r.error };
        const broke = newRealErrors(before, validateGraph(r.tpl, portsFn()));
        if (broke.length) return { ok: false, error: `that change would leave the graph invalid — ${broke.slice(0, 3).map((e) => e.message).join('; ')}. The canvas is unchanged.` };
        work.tpl = r.tpl;
        return { ok: true, summary, ops: r.applied, added: r.added, removed: r.removed, ...report(r.tpl) };
      },
      async build({ name, domain, reasoning, nodes, wires }) {
        await load();
        const r = buildGraph({ nodes, wires }, { portsFn: portsFn() });
        if (!r.ok) return r;
        const rep = report(r.tpl);
        if (rep.errors.length) return { ok: false, error: `the workflow is not valid — ${rep.errors.slice(0, 3).map((e) => e.message).join('; ')}` };
        const loops = classifyLoops(r.tpl, portsFn()).loopWireIds;
        const keyed = r.tpl.nodes.filter((n) => n.key);
        return {
          ok: true, name, domain: domain || '', reasoning,
          workflow: { nodes: r.tpl.nodes, wires: r.tpl.wires },
          counts: { agents: keyed.filter((n) => n.kind === 'agent').length, scripts: keyed.filter((n) => n.kind === 'script').length, loops: loops.size },
          loops: r.tpl.wires.filter((w) => loops.has(w.id)).map((w) => ({ from: w.from.node, to: w.to.node, max: (w.config && w.config.maxCycles) || 3 })),
          drafts: [...new Set(keyed.filter((n) => work.drafts.has(n.key)).map((n) => n.key))],
          todo: rep.todo, warnings: rep.warnings,
        };
      },
      async draftAgent(input) {
        await load();
        const displayName = str(input.displayName, 60);
        if (!displayName) return { ok: false, error: 'displayName is required' };
        const key = keyFromName(displayName);
        if (!AGENT_KEY_RE.test(key)) return { ok: false, error: 'the name needs letters' };
        // createAgent's Save looks the key up on a plain object (loadAgentRegistry()[key]): "constructor" or "toString"
        // reads as an agent that already exists, so every Save of this draft would answer 409.
        if (key in Object.prototype) return { ok: false, error: `"${key}" is a reserved name — pick another name` };
        if (WIN_DEVICE_RE.test(key)) return { ok: false, error: `"${key}" is a reserved device name on Windows — pick another name` };
        // macOS and Windows filesystems are case-INSENSITIVE: "CodeReviewer" (codereviewer) and "Code Reviewer" (codeReviewer)
        // are two keys but ONE <key>.md / <key>.meta.json, and createAgent's Save would overwrite the other agent without a word.
        const twin = [...Object.keys(work.agents), ...work.reserved].find((k) => k !== key && k.toLowerCase() === key.toLowerCase());
        if (twin) return { ok: false, error: `an agent "${twin}" already exists — agent keys differ only in case, and one file holds both on macOS and Windows; pick another name` };
        // Agents and scripts share ONE key namespace (the script registry drops a script whose key an agent holds), so
        // only an AGENT draft may be drafted again under its key — never a script, a saved agent or a workspace-only one.
        if (has(work.scripts, key) || work.reserved.has(key) || (has(work.agents, key) && !isDraft(work.agents, key))) return { ok: false, error: `an agent or script "${key}" already exists — use it, or pick another name` };
        const runnerType = RUNNERS.includes(input.runnerType) ? input.runnerType : 'producer';
        const meta = {
          metaVersion: 2,                                                    // validateMetaV2 refuses a sidecar without it
          key, displayName, description: str(input.description, 300), color: AGENT_COLORS.includes(input.color) ? input.color : 'blue',
          runnerType, domain: str(input.domain, 40) || 'general', order: 99,      // createAgent's default order, set BEFORE its gate too
          inputs: Array.isArray(input.inputs) ? input.inputs : [], outputs: Array.isArray(input.outputs) ? input.outputs : [],
          ...(input.fanOut === true ? { fanOut: true } : {}), ...(input.asksQuestions === true ? { asksQuestions: true } : {}),
          ...(input.sideEffect === 'code' || input.sideEffect === 'memory' ? { sideEffect: input.sideEffect } : {}),
          ...(runnerType === 'verifier' ? { verdict: { filename: str(input.verdictFilename, 80) || `${key}-cycle{cycle}.json` } } : {}),
        };
        const errs = validateMetaV2({ ...meta, agentFile: `${key}.md` }).errors;
        if (errs.length) return { ok: false, error: errs.join('; ') };
        const norm = normalizeMeta({ ...meta, agentFile: `${key}.md` }, { warn: () => {} });
        if (!norm) return { ok: false, error: 'invalid agent metadata' };
        const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
        if (prompt.length < 40) return { ok: false, error: 'prompt must be the complete system prompt (markdown)' };
        const markdown = `---\nname: ${key}\ndescription: ${JSON.stringify(oneLine(meta.description))}\ntools: Read, Write, Edit, Bash, Grep, Glob, Skill\nmodel: inherit\n---\n\n${prompt}\n`;
        // `then` is simulated with the draft in a COPY of the registry; the draft joins the working registry only
        // when the whole call succeeds — a refused draft (no card reaches the browser) must not be placeable.
        const drafted = { ...work.agents, [key]: { ...norm, origin: 'draft' } };
        const then = simulateThen(input.then, 'agent', key, portsFnFor(drafted, work.scripts));
        if (then && !then.ok) return then;
        const out = { ok: true, draft: { key, meta, markdown }, then: then ? { ops: then.ops } : null };
        if (!fitsCard('draft_agent', out)) return { ok: false, error: 'the draft is too large for its card — shorten the prompt' };
        work.agents = drafted;
        work.drafts.add(key);
        return out;
      },
      async draftScript(input) {
        await load();
        const displayName = str(input.displayName, 60);
        if (!displayName) return { ok: false, error: 'displayName is required' };
        const key = str(input.key, 64) || keyFromName(displayName);
        if (!SCRIPT_KEY_RE.test(key)) return { ok: false, error: `"${key}" is not a usable script key` };
        // createScript's own gates, so the card's Save cannot refuse a draft this accepted: reserved keys in any case and
        // Windows device names (assertKeyAllowed), a case twin (one file on macOS and Windows), the shared namespace.
        try { assertKeyAllowed(key); } catch (e) { return { ok: false, error: e.message }; }
        const twin = Object.keys(work.scripts).find((k) => k !== key && k.toLowerCase() === key.toLowerCase());
        if (twin) return { ok: false, error: `a script "${twin}" already exists — script keys differ only in case; pick another key` };
        if (has(work.agents, key) || work.reserved.has(key) || (has(work.scripts, key) && !isDraft(work.scripts, key))) return { ok: false, error: `the key "${key}" is taken — pick another` };
        const source = typeof input.source === 'string' ? input.source : '';
        if (!source.trim()) return { ok: false, error: 'source is required' };
        const runtime = RUNTIMES.includes(input.runtime) ? input.runtime : 'node';
        // A shell FILE runs `<key>.sh` on macOS/Linux and `<key>.cmd` on Windows (docs/scripts.md "All three operating
        // systems"): without a win32 variant the saved script cannot run on a Windows host. Same rule as createScript.
        const sourceWin32 = typeof input.sourceWin32 === 'string' && input.sourceWin32.trim() ? input.sourceWin32 : '';
        if (sourceWin32 && runtime !== 'shell') return { ok: false, error: 'sourceWin32 is only legal on the shell runtime' };
        // The sidecar's own fields, named as "Scripts you can create" teaches them — verdict {filename}, timeoutMs,
        // exitCodes (shell) — and checked by normalizeScriptMeta below. A gate whose verdict is dropped is clean every run.
        const meta = {
          metaVersion: 2,                                                    // the script validator refuses a sidecar without it
          key, displayName, description: str(input.description, 300), runtime,
          file: sourceFileFor(key, runtime),                                 // node/python/shell programs live in a file (script-store)
          color: SCRIPT_COLORS.includes(input.color) ? input.color : 'teal', domain: str(input.domain, 40) || 'general',
          params: Array.isArray(input.params) ? input.params : [], inputs: Array.isArray(input.inputs) ? input.inputs : [],
          outputs: Array.isArray(input.outputs) ? input.outputs : [],
          ...(input.verdict != null ? { verdict: input.verdict } : {}),
          ...(input.timeoutMs != null ? { timeoutMs: input.timeoutMs } : {}),
          ...(input.exitCodes != null ? { exitCodes: input.exitCodes } : {}),
        };
        const n = normalizeScriptMeta(meta);
        if (n.errors.length || !n.meta) return { ok: false, error: n.errors.join('; ') || 'invalid script metadata' };
        // The draft carries the normalised forms: a verdict is exactly {filename}, exit codes are deduplicated.
        if (n.meta.verdict) meta.verdict = n.meta.verdict;
        if (n.meta.exitCodes) meta.exitCodes = n.meta.exitCodes;
        let cases = [];
        if (Array.isArray(input.cases) && input.cases.length) {
          const c = normalizeCases({ version: CASES_VERSION, cases: input.cases }, n.meta);
          if (c.errors.length) return { ok: false, error: `cases: ${c.errors.join('; ')}` };
          cases = c.cases;
        }
        const drafted = { ...work.scripts, [key]: { ...n.meta, origin: 'draft' } };
        const then = simulateThen(input.then, 'script', key, portsFnFor(work.agents, drafted));
        if (then && !then.ok) return then;
        const out = { ok: true, draft: { key, meta, source, ...(sourceWin32 ? { sourceWin32 } : {}), cases }, then: then ? { ops: then.ops } : null };
        if (!fitsCard('draft_script', out)) return { ok: false, error: 'the draft is too large for its card — shorten the program or its cases' };
        work.scripts = drafted;
        work.drafts.add(key);
        return out;
      },
      async getAgent(key) {
        const a = await io.readAgent(String(key || ''));
        if (!a) return { ok: false, error: `no agent "${key}"` };
        return { ok: true, meta: a.meta, markdown: String(a.markdown || '').slice(0, 16384) };
      },
      async getWorkflow(id) {
        const wf = id === 'wf_default' ? GRAPH_DEFAULT_WORKFLOW : id === MEMORY_DEFRAG_WORKFLOW_ID ? GRAPH_MEMORY_DEFRAG_WORKFLOW : await io.readWorkflow(String(id || ''));
        if (!wf) return { ok: false, error: `no workflow "${id}"` };
        return { ok: true, id: wf.id, name: wf.name, domain: wf.domain || '', nodes: wf.nodes || [], wires: wf.wires || [] };
      },
    },
  };
}
