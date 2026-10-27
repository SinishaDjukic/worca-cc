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

export { CONNECTOR_MODES } from './store.mjs';
export const CONNECTOR_CALLS_FILE = 'connector-calls.ndjson';
export const PREVIEW_CHARS = 80;
const CALLS_MAX = 200;
const CLAUDE_AI_RE = /^claude[ ._]ai[ _]/i;
const seenFile = () => join(worcaHome(), 'workflow-tests', 'seen-connectors.json');

export function standInDef(name, toolsFile, logFile) {
  return { type: 'stdio', command: process.execPath, args: [MOCK_CONNECTOR_PATH, '--server', name, '--tools', toolsFile, '--log', logFile] };
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
    const test = copy && !copy.untested ? tests[`${copy.setId}|${copy.serverId}`] : null;
    const tools = test && test.ok === true && Array.isArray(test.tools) && test.tools.length ? test.tools : null;
    if (!tools) { off.push({ name, why: 'Worca has no list of its tools; test it once in Connectors.' }); continue; }
    await mkdir(dir, { recursive: true });
    n += 1;
    const toolsFile = join(dir, `${String(n).padStart(2, '0')}-${name.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
    await writeFile(toolsFile, JSON.stringify(tools), 'utf8');
    out[name] = standInDef(name, toolsFile, join(pipelineDir, CONNECTOR_CALLS_FILE));
    pretend.push(name);
  }
  return { servers: out, off, pretend };
}

/** "claude.ai Google Drive" / "claude_ai_Google_Drive" → "Google Drive". */
export const plainClaudeAiName = (name) => String(name).replace(CLAUDE_AI_RE, '').replace(/_/g, ' ').trim() || String(name);

/**
 * Board 30's notes. `copies` = the registry copies a run without a project would start (server.mjs mcpRunPreview), each
 * with `untested`; `userScope` = the `~/.claude.json` servers; `claudeAi` = the names seen (N2); `scripts` = the names of
 * the workflow's script steps.
 */
export function connectorNotes({ copies = [], userScope = [], claudeAi = [], scripts = [] } = {}) {
  return {
    pretend: copies.filter((c) => !c.untested).map((c) => c.name).sort(),
    off: [
      ...claudeAi.map((name) => ({ name: plainClaudeAiName(name), reason: 'claude-ai' })),
      ...copies.filter((c) => c.untested).map((c) => ({ name: c.name, reason: 'no-tools' })),
      ...userScope.filter((n) => !copies.some((c) => c.name === n)).map((name) => ({ name, reason: 'own-settings' })),
    ],
    scripts: [...new Set(scripts)],
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
export function sentCall(e) {
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
    try { const v = JSON.parse(line); if (v && typeof v.tool === 'string') out.push(v); } catch { /* a torn line */ }
  }
  return out;
}

/** Board 31: what one pretend try would have sent, and the reads its stand-ins answered (N3). */
export async function wouldHaveSent(pipelineId) {
  const sent = [];
  const reads = new Map();
  for (const e of await readConnectorCalls(pipelineId)) {
    if (e.readOnly === true) { const s = String(e.server || ''); reads.set(s, (reads.get(s) || 0) + 1); continue; }
    sent.push(sentCall(e));
  }
  return { sent, reads: [...reads].map(([server, n]) => ({ server, n })) };
}
