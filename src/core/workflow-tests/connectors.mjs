// src/core/workflow-tests/connectors.mjs
// Connectors in a workflow test (plans/workflow-tests-part2-plan.md D35). Pretend: every server a try would load is
// swapped for a local stand-in (../mcp/mock-connector.mjs) under the same name, offering the tools the connector's last
// passing Test recorded; a server Worca has no tools for is switched off. Also: the Test a version dialog's notes per
// connector (board 30), what one try would have sent (board 31), and the claude.ai connector names Worca has seen.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readMcpStore } from '../mcp/store.mjs';
import { MOCK_CONNECTOR_PATH } from '../mcp/mock-connector.mjs';
import { findPipelineRowById, runDirForRow } from '../artifacts.mjs';
import { worcaHome } from '../projects.mjs';
import { resolveRunEngine } from '../settings-cascade.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { CLAUDE_AI_RE, plainName, serverName } from '../../shared/workflow-tests/connector-name.mjs';
import { selectRunEngine } from '../engines/index.mjs';
import { guardCall } from './guard-calls.mjs';
import { createRedactor } from '../redact.mjs';

// Task 5 (M13): the stand-ins and the try guard write the calls raw (they hold no secret list); what Worca shows of them is
// redacted like the transcript: broker tokens always, in keys and values at any depth (the spawn's own secrets are redacted
// in the file when the spawn ends, claude.mjs redactTryLog). The arguments themselves stay: they are what board 31 shows.
const brokerTokensOut = createRedactor([]).deep;

export { CONNECTOR_MODES } from './store.mjs';
export const CONNECTOR_CALLS_FILE = 'connector-calls.ndjson';
export const PREVIEW_CHARS = 80;
const CALLS_MAX = 200;
const seenFile = () => join(worcaHome(), 'workflow-tests', 'seen-connectors.json');
const NO_TOOLS_WHY = 'Worca has no list of its tools; test it once in Connectors.';
const FILE_SERVER_WHY = "Worca can't pretend for servers from a project file.";

/** Board 30's line for a server from a project file (`.mcp.json` / worca's root config): Connectors cannot Test it. */
export const fileServerOffLine = (name) => `${name} is switched off: ${FILE_SERVER_WHY}`;
/** Board 30's line for steps on another engine (user decision 2026-10-27: pretend stays allowed, the dialog warns):
 *  `--strict-mcp-config` and the claude.ai belt are Claude Code's, so that engine's own MCP settings still load. */
export const engineNoteLine = (label) => `Steps on ${label} can still use connectors from ${label}'s own settings. Pretend can't stop those.`;

export function standInDef(name, toolsFile, logFile) {
  return { type: 'stdio', command: process.execPath, args: [MOCK_CONNECTOR_PATH, '--server', name, '--tools', toolsFile, '--log', logFile] };
}

/** The tools a registry copy's stand-in offers: its current, passing Test's list; null when it gets no stand-in. */
function standInTools(copy, tests) {
  const test = copy && !copy.untested ? tests[`${copy.setId}|${copy.serverId}`] : null;
  return test && test.ok === true && Array.isArray(test.tools) && test.tools.length ? test.tools : null;
}

/** The registry copies that get a stand-in on a pretend try (the rule pretendServers applies), in their order. */
export function pretendCopies(copies, tests) {
  return (Array.isArray(copies) ? copies : []).filter((c) => standInTools(c, tests || {}));
}

/**
 * A registry layer ({copies, servers, …}: a resolveRegistry result) as a pretend try would load it, for a check that
 * runs before the try's mcp.json exists (run-harness.mjs `_engineMcpGate` / `_engineEarlyRefusal`): only the copies
 * that get a stand-in, each with a stand-in's (stdio) definition. Writes nothing.
 * @param {{copies?: object[], servers?: object}|null} layer
 * @param {{store?: object}} [o] `store` = readMcpStore()'s snapshot (a test seam)
 */
export async function pretendLayer(layer, { store = null } = {}) {
  if (!layer) return layer;
  const snapshot = store || await readMcpStore();
  const copies = pretendCopies(layer.copies, (snapshot && snapshot.tests) || {});
  return { ...layer, copies, servers: Object.fromEntries(copies.map((c) => [c.name, standInDef(c.name, '', '')])) };
}

/**
 * A pretend try's servers (run-context.mjs `mcpStandIn`): each one a stand-in under its own name, or switched off.
 * @param {{servers: Record<string, object>, copies: Array<{name: string, setId: string, serverId: string, untested: boolean}>}} layer
 *   every server the try would load, and the registry copies among them
 * @param {{pipelineDir: string, store?: object}} o `store` = readMcpStore()'s snapshot (a test seam)
 */
export async function pretendServers({ servers = {}, copies = [] } = {}, { pipelineDir, store = null } = {}) {
  const snapshot = store || await readMcpStore();
  const tests = (snapshot && snapshot.tests) || {};
  const out = {};
  const off = [];
  const pretend = [];
  const dir = join(pipelineDir, 'connectors');
  let n = 0;
  for (const name of Object.keys(servers).sort()) {
    const copy = copies.find((c) => c.name === name) || null;
    const tools = standInTools(copy, tests);
    if (!tools) {
      off.push(copy ? { name, reason: 'no-tools', why: NO_TOOLS_WHY } : { name, reason: 'file-server', why: FILE_SERVER_WHY });
      continue;
    }
    await mkdir(dir, { recursive: true });
    n += 1;
    const toolsFile = join(dir, `${String(n).padStart(2, '0')}-${name.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
    await writeFile(toolsFile, JSON.stringify(tools), 'utf8');
    out[name] = standInDef(name, toolsFile, join(pipelineDir, CONNECTOR_CALLS_FILE));
    pretend.push(name);
  }
  return { servers: out, off, pretend };
}

/** "claude.ai Google Drive" / "claude_ai_Google_Drive" → "Google Drive": the shared plain name (connector-name.mjs), so
 *  every page names a connector the same way; the raw name when nothing is left. */
export const plainClaudeAiName = (name) => (plainName(name) ? serverName(name) : String(name));

/**
 * The engines a workflow's agent steps run on, as engine ids. A run has ONE engine for every step (workflows.mjs
 * resolveGraph `engine`, the run's `claude.engine`), so this is `runEngine` — by default what a run without a project
 * resolves (settings `run.engine`) — when the graph has an agent step, and [] for scripts and flow cards only.
 * @param {{nodes?: Array<{kind?: string}>}} graph
 * @param {{runEngine?: string|null}} [o]
 */
export function stepEngines(graph, { runEngine = null } = {}) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  if (!nodes.some((n) => n && n.kind === 'agent')) return [];
  // Checked as a run checks it (server.mjs runEngineOpts → selectRunEngine), so the note names the engine the try runs
  // on; one a try could not start on ('mock', an unknown name) names none.
  let engine;
  try {
    engine = selectRunEngine(typeof runEngine === 'string' && runEngine ? runEngine : (resolveRunEngine({}).engine || 'claude'));
  } catch { engine = 'claude'; }
  return [engine];
}

/**
 * The workflow's script steps by name (the Library's display name, else the key), and the ones the free quick check
 * runs for real: the quick check is a mock run, and a mock run mocks a script step only when it has a mock of its own
 * (the card's `config.mock`, else the Library entry's; shared/graph/script-meta.mjs scriptNodeCtx, script-runner.mjs).
 * @returns {{names: string[], quick: string[]}}
 */
export function scriptSteps(graph, registry = {}) {
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const names = [];
  const quick = [];
  for (const n of graph && Array.isArray(graph.nodes) ? graph.nodes : []) {
    if (!n || n.kind !== 'script') continue;
    const meta = (registry && registry[n.key]) || {};
    const name = meta.displayName || n.key || 'script';
    names.push(name);
    const cfg = isObj(n.config) ? n.config : {};
    if (!isObj(cfg.mock) && !isObj(meta.mock)) quick.push(name);
  }
  return { names, quick };
}

/**
 * Board 30's notes. `copies` = the registry copies a run without a project would start (server.mjs mcpRunPreview), each
 * with `untested`; `fileServers` = the servers from a project file it would load (no Test exists for them);
 * `userScope` = the `~/.claude.json` servers; `claudeAi` = the names seen (N2); `scripts` = the names of the workflow's
 * script steps; `engines` = the engine ids its steps run on (stepEngines). `engines` out = the display names of the
 * engines other than Claude, one engineNoteLine each. `mode` 'real' = the test uses the real connectors, so `pretend` is [].
 */
export function connectorNotes({ copies = [], fileServers = [], userScope = [], claudeAi = [], scripts = [], quickScripts = [], engines = [],
  mode = 'pretend' } = {}) {
  const isCopy = (n) => copies.some((c) => c.name === n);
  const files = [...new Set(fileServers)].filter((n) => !isCopy(n)).sort();
  return {
    // A Real test loads the real connectors: nothing is pretended.
    pretend: mode === 'real' ? [] : copies.filter((c) => !c.untested).map((c) => c.name).sort(),
    off: [
      ...claudeAi.map((name) => ({ name: plainClaudeAiName(name), reason: 'claude-ai' })),
      ...copies.filter((c) => c.untested).map((c) => ({ name: c.name, reason: 'no-tools' })),
      ...files.map((name) => ({ name, reason: 'file-server' })),
      // One name, one line: a ~/.claude.json server a copy or a project file also names is listed there.
      ...[...new Set(userScope)].filter((n) => !isCopy(n) && !files.includes(n)).map((name) => ({ name, reason: 'own-settings' })),
    ],
    scripts: [...new Set(scripts)],
    // The script steps the free quick check runs for real too (scriptSteps `quick`): the dialog's caution counts it.
    quickScripts: [...new Set(quickScripts)],
    engines: [...new Set(engines.filter((e) => typeof e === 'string' && e && e !== 'claude'))].map(engineLabel),
  };
}

/** The servers of `~/.claude.json` (user scope), which Claude Code loads by itself; a pretend try's strict config drops them (N1). */
export function userScopeServerNames(home = homedir()) {
  try {
    const m = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers;
    return m && typeof m === 'object' && !Array.isArray(m) ? Object.keys(m).sort() : [];
  } catch { return []; }
}

/** N2: remember the claude.ai connector names a run's start-up listed (the CLI's init `mcp_servers`). Never throws. */
export function noteSeenServers(list) {
  try {
    const names = (Array.isArray(list) ? list : []).map((s) => (s && typeof s.name === 'string' ? s.name : '')).filter((x) => CLAUDE_AI_RE.test(x));
    if (!names.length) return;
    const have = seenClaudeAiServers();
    const next = [...new Set([...have, ...names])].sort().slice(0, 100);
    if (next.length === have.length) return;
    mkdirSync(join(worcaHome(), 'workflow-tests'), { recursive: true });
    writeFileSync(seenFile(), `${JSON.stringify({ claudeAi: next })}\n`, 'utf8');
  } catch { /* a note only */ }
}

export function seenClaudeAiServers() {
  try {
    const v = JSON.parse(readFileSync(seenFile(), 'utf8'));
    return Array.isArray(v.claudeAi) ? v.claudeAi.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

const words = (id) => String(id || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());

/** "post_message" → "post a message", "create_issue" → "create an issue", "list_channels" → "list channels". */
export function humanizeTool(id) {
  const w = words(id);
  if (!w.length) return 'use a tool';
  if (w.length === 2 && !/s$/.test(w[1])) return `${w[0]} ${/^[aeiou]/.test(w[1]) ? 'an' : 'a'} ${w[1]}`;
  return w.join(' ');
}

/** What a call makes, for board 31's count ("1 message, 1 issue"); a one-word tool is a "call". */
export function nounOf(id) {
  const w = words(id);
  return w.length > 1 ? w.at(-1) : 'call';
}

const TEXT_KEYS = ['text', 'message', 'body', 'content', 'comment', 'description', 'summary', 'title'];
const TO_KEYS = ['channel', 'to', 'recipient', 'project', 'space', 'repo'];
const keyed = (args) => new Map(Object.entries(args && typeof args === 'object' && !Array.isArray(args) ? args : {}).map(([k, v]) => [k.toLowerCase(), v]));
const firstString = (map, keys) => { for (const k of keys) { const v = map.get(k); if (typeof v === 'string' && v.trim()) return v; } return null; };

/** One call as board 31 lists it. `preview` = the first 80 characters of its main text; `full` = all of it. */
export function sentCall(e, { forgeOf } = {}) {
  if (e && e.guard === true) return guardCall(e, { forgeOf });   // 3a D68: what the outward guard stopped
  const args = e && e.arguments;
  const map = keyed(args);
  const longest = [...map.values()].filter((v) => typeof v === 'string' && v.trim()).sort((x, y) => y.length - x.length)[0] ?? null;
  const text = firstString(map, TEXT_KEYS) ?? longest;
  const flat = (text ?? JSON.stringify(args ?? {})).replace(/\s+/g, ' ').trim();
  return {
    server: String((e && e.server) || ''), tool: humanizeTool(e && e.tool), toolId: String((e && e.tool) || ''), noun: nounOf(e && e.tool),
    to: firstString(map, TO_KEYS),
    preview: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat,
    full: text ?? JSON.stringify(args ?? {}, null, 2),
  };
}

/** The calls a try's stand-ins wrote down (at most 200; a torn last line is skipped). [] for a try without a log. */
export async function readConnectorCalls(pipelineId) {
  const row = pipelineId ? findPipelineRowById(pipelineId) : null;
  if (!row) return [];
  let text = '';
  try { text = await readFile(join(await runDirForRow(row), CONNECTOR_CALLS_FILE), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || out.length >= CALLS_MAX) continue;
    try { const v = JSON.parse(line); if (v && typeof v.tool === 'string') out.push(brokerTokensOut(v)); } catch { /* a torn line */ }
  }
  return out;
}

/** Board 31: what one pretend try would have sent, and the reads its stand-ins answered (N3). */
export async function wouldHaveSent(pipelineId, { forgeOf } = {}) {
  const sent = [];
  const reads = new Map();
  for (const e of await readConnectorCalls(pipelineId)) {
    // A call the outward guard stopped is an attempt even when it only reads (gh pr view): it never reached the forge.
    if (e.readOnly === true && e.guard !== true) { const s = String(e.server || ''); reads.set(s, (reads.get(s) || 0) + 1); continue; }
    sent.push(sentCall(e, { forgeOf }));
  }
  return { sent, reads: [...reads].map(([server, n]) => ({ server, n })) };
}
