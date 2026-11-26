// src/core/workflow-parts.mjs
// The agents and scripts a graph uses, each with a content hash (plans/workflow-tests-plan.md D6): an edit in the
// Library changes the hash, so the Versions page can say "changed since v4". Reads only; never throws (a missing
// file hashes as empty).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canon } from '../shared/graph/diff-graphs.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { loadScriptRegistry } from './script-registry.mjs';
import { readScript } from './script-store.mjs';

// I1: only what defines behaviour is hashed, so the hash is portable (another install, an nvm switch, a moved
// WORCA_HOME, an export in Part 4): the key, the origin, the agent's markdown text (its frontmatter included) or the
// script's source, and the sidecar fields that change what a run does. Never an absolute path (agentPath, scriptPath,
// scriptsDir, commandResolved), never a display-only field (displayName, description, color, icon, order, domain,
// portSummary, placeable, progressStage), and not humanEffort (a savings estimate) or metaVersion (the sidecar format).
// `frontmatter` is left out: it is parsed from the markdown text, which is hashed whole.
export const AGENT_HASH_FIELDS = Object.freeze(['key', 'origin', 'runnerType', 'scope', 'fanOut', 'asksQuestions', 'questionsLocked',
  'questionsDefault', 'promptHints', 'requiresSkills', 'requiresAssets', 'inputs', 'outputs', 'verdict', 'ask', 'sideEffect',
  'wantsRequest', 'needsRepo', 'workspaceFanOut', 'workspaceStrategy', 'workspaceVariantOf', 'mockRole']);
export const SCRIPT_HASH_FIELDS = Object.freeze(['key', 'origin', 'runtime', 'file', 'command', 'timeoutMs', 'params', 'ports',
  'defaultPorts', 'inputs', 'outputs', 'verdict', 'mock']);
// Every other meta field, with why it is left out. test/workflow-fingerprint.test.mjs (N2) fails on a field of a
// built-in agent or script that is in neither list, so a new behaviour field cannot be silently left out of the hash.
export const AGENT_HASH_EXCLUDED = Object.freeze({
  displayName: 'display only',
  description: 'display only (an edit in the frontmatter is in the hashed markdown text)',
  descriptionDerived: 'computed display marker',
  color: 'display only',
  icon: 'display only',
  order: 'palette order, display only',
  domain: 'organisational tag, display only',
  portSummary: 'derived text of inputs/outputs, which are hashed',
  placeable: 'palette visibility, not run behaviour',
  progressStage: 'run page progress label, display only',
  humanEffort: 'a savings estimate for Statistics, not run behaviour',
  metaVersion: 'the sidecar format, not behaviour',
  agentFile: 'the file name; its text is hashed',
  agentPath: 'absolute path, install-specific',
  frontmatter: 'parsed from the markdown text, which is hashed whole',
});
export const SCRIPT_HASH_EXCLUDED = Object.freeze({
  displayName: 'display only',
  description: 'display only',
  color: 'display only',
  icon: 'display only',
  order: 'palette order, display only',
  domain: 'organisational tag, display only',
  portSummary: 'derived text of the ports, which are hashed',
  placeable: 'palette visibility, not run behaviour',
  metaVersion: 'the sidecar format, not behaviour',
  scriptPath: 'absolute path, install-specific (the source is hashed)',
  scriptsDir: 'absolute path, install-specific',
  commandResolved: 'command with absolute paths, install-specific (command is hashed)',
});
const pick = (meta, fields) => (meta && typeof meta === 'object' ? Object.fromEntries(fields.filter((f) => meta[f] !== undefined).map((f) => [f, meta[f]])) : null);

const defaultScriptSource = async (key) => {
  const s = await readScript(key);
  return s ? `${s.source ?? ''}\u0000${s.sourceWin32 ?? ''}` : '';
};

/**
 * @param {{nodes?: Array}} graph
 * @param {{registry?: object, scripts?: object, readText?: (path: string) => Promise<string>, scriptSource?: (key: string) => Promise<string>}} [deps]
 * @returns {Promise<Array<{kind: 'agent'|'script', key: string, origin: string|null, hash: string}>>}
 */
export async function workflowParts(graph, { registry, scripts, readText = (p) => readFile(p, 'utf8'), scriptSource = defaultScriptSource } = {}) {
  const reg = registry && typeof registry === 'object' ? registry : loadAgentRegistry();
  const scr = scripts && typeof scripts === 'object' ? scripts : loadScriptRegistry({ agentKeys: Object.keys(reg) });
  const seen = new Map();
  for (const n of Array.isArray(graph?.nodes) ? graph.nodes : []) {
    if (!n || (n.kind !== 'agent' && n.kind !== 'script') || typeof n.key !== 'string' || !n.key) continue;
    const id = `${n.kind}:${n.key}`;
    if (seen.has(id)) continue;
    const meta = n.kind === 'agent' ? reg[n.key] : scr[n.key];
    let body = '';
    try {
      body = n.kind === 'agent' ? (meta && meta.agentPath ? await readText(meta.agentPath) : '') : await scriptSource(n.key);
    } catch { body = ''; }
    const hash = createHash('sha256').update(canon(pick(meta, n.kind === 'agent' ? AGENT_HASH_FIELDS : SCRIPT_HASH_FIELDS))).update('\u0000').update(String(body ?? '')).digest('hex').slice(0, 16);
    seen.set(id, { kind: n.kind, key: n.key, origin: (meta && meta.origin) || null, hash });
  }
  return [...seen.values()].sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : a.kind + a.key > b.kind + b.key ? 1 : 0));
}
