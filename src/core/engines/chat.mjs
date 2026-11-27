// src/core/engines/chat.mjs
// The chat descriptors (engines/chat-descriptor.mjs) of the adapters that export one: how Chat (Ask Worca) runs locked
// down on each engine other than Claude. ask/turn.mjs, ask/models.mjs, ask/spawn.mjs, ask/prompt.mjs and ask/suggest.mjs
// read them; none of them names an engine. CHAT_ENGINES is derived from the adapters — those whose descriptor has a
// lockdown — and it must equal model-env.mjs ASK_ENGINES (engine-switch.mjs `chat`, which the browser and settings
// read and which may not import an adapter): this module refuses to load when they disagree, when an adapter's
// descriptor has no flag there (or a flag no descriptor), and when a descriptor's attachments disagree with the flag.
// A descriptor without a lockdown (Cursor) is wired and stays off: chatDescriptor() returns it, CHAT_ENGINES leaves it out.
import { listEngines } from './index.mjs';
import { ENGINES } from '../../shared/engine-switch.mjs';
import { ASK_ENGINES, envFlag } from '../model-env.mjs';
import { cliNotInstalled, configuredClaudeBin } from '../cli-resolve.mjs';
import { CLAUDE_CLI } from './cli-specs.mjs';

export { chatCostCapRefusal, chatEngineGate } from './chat-descriptor.mjs';

const DESCRIPTORS = new Map(listEngines().filter((a) => a.chat).map((a) => [a.name, a.chat]));

/** The engines a chat runs on: Claude, then every adapter whose chat descriptor has a lockdown, in engine order. */
export const CHAT_ENGINES = Object.freeze(['claude', ...Object.keys(ENGINES).filter((e) => DESCRIPTORS.has(e) && DESCRIPTORS.get(e).lockdown())]);

for (const e of Object.keys(ENGINES)) {
  if (e !== 'claude' && !!ENGINES[e].chat !== DESCRIPTORS.has(e)) throw new Error(`engines/chat.mjs: ${e} ${DESCRIPTORS.has(e) ? 'exports a chat descriptor but engine-switch.mjs gives it no chat flag' : 'has a chat flag in engine-switch.mjs but its adapter exports no chat descriptor'}`);
}

if (JSON.stringify(CHAT_ENGINES) !== JSON.stringify(ASK_ENGINES)) {
  throw new Error(`engines/chat.mjs: the adapters with a chat descriptor (${CHAT_ENGINES.join(', ')}) differ from engine-switch.mjs's chat engines (${ASK_ENGINES.join(', ')})`);
}
for (const d of DESCRIPTORS.values()) {
  const flag = ENGINES[d.engine].chat;
  if (flag.images !== d.images || flag.pdfs !== d.pdfs) throw new Error(`engines/chat.mjs: ${d.engine}'s chat attachments differ from engine-switch.mjs`);
}

/** The chat descriptor of `engine`, or null (Claude, an engine without Chat, anything else). */
export function chatDescriptor(engine) {
  return DESCRIPTORS.get(engine) || null;
}

/** Every chat descriptor, in engine order. */
export function chatDescriptors() {
  return CHAT_ENGINES.filter((e) => e !== 'claude').map((e) => DESCRIPTORS.get(e));
}

/** The binary a chat on `engine` runs: Claude's configured one (engines/claude.mjs spawnFailure), else its descriptor's;
 *  null for any other engine. */
export function chatEngineBin(engine) {
  if (engine === 'claude') { try { return configuredClaudeBin(); } catch { return null; } }
  return chatDescriptor(engine)?.bin() || null;
}

/** Why `engine`'s CLI is not on this machine (a few stat()s of its configured binary, never a spawn), or null: found, or
 *  no answer. Mock mode (the server's own rule: WORCA_MOCK, else ORCH_MOCK) has every engine, as engines/readiness.mjs
 *  reports it. The chat model picker leaves such an engine out (ask/models.mjs `notReady`), and the setup dialog says it
 *  (GET /api/engines/:name/setup). */
export function chatEngineNotInstalled(engine) {
  if (envFlag('WORCA_MOCK', 'ORCH_MOCK')) return null;
  try {
    if (engine === 'claude') return cliNotInstalled(configuredClaudeBin(), CLAUDE_CLI, 'Claude Code');
    return chatDescriptor(engine)?.notInstalled() || null;
  } catch { return null; }
}
