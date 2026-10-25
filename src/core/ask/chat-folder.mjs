// src/core/ask/chat-folder.mjs
// A locked-down chat's own folder under the shared scratch dir (<worcaHome>/tmp/ask): <scratch>/<engine>/<name>. In
// pool mode the scratch dir is writable by every agent user (docker/entrypoint.sh: 3770, group worca-share), and Gemini
// CLI, Goose and OpenCode run code they find in their cwd (workspace settings hooks, `.agents/plugins/*/hooks`,
// `.opencode/plugin(s)/*.js`). So both levels are made here with modes of worca's choosing and must then be real folders
// worca owns (agent-user.mjs assertOwnFolders, V10): never a link, never one another user made first. A relayed chat
// runs as the person's agent user, so its folder is then opened to that user's group (shareWithAgent).
import { chmodSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertOwnFolders, shareWithAgent } from '../agent-user.mjs';
import { engineEntry } from '../../shared/engine-switch.mjs';

const SAFE_NAME = /^[A-Za-z0-9_-]{1,128}$/;

const made = (dir, mode) => { try { mkdirSync(dir, { mode }); } catch (err) { if (err?.code !== 'EEXIST') throw err; } };

/**
 * Make (or check) `<scratchDir>/<engine>/<name>` and return its path. Throws when a level is a link, not a folder, or
 * not worca's, or when the chat's folder holds code its CLI would load.
 * @param {string} scratchDir @param {string} engine @param {string} name
 * @param {{agent?: object|null}} [o] `agent`: the agent identity a relayed chat runs as (agent-pool.mjs agentIdentityFor)
 */
export function chatFolder(scratchDir, engine, name, { agent = null } = {}) {
  if (!SAFE_NAME.test(String(engine)) || !SAFE_NAME.test(String(name))) throw new Error(`not a chat folder name: ${engine}/${name}`);
  const engineDir = join(scratchDir, engine);
  const dir = join(engineDir, name);
  // Each level is checked, and given worca's mode, before anything is made below it: a link planted first is never
  // written through, and once the engine folder is 0711 (others pass through it, never list or write it; an older
  // worca made it with the umask's group bits) nobody else can swap the chat's folder inside it.
  made(engineDir, 0o711);
  assertOwnFolders(engineDir, scratchDir);
  chmodSync(engineDir, 0o711);
  made(dir, 0o700);
  assertOwnFolders(dir, scratchDir);
  chmodSync(dir, 0o700);
  // What the engine's CLI loads from its cwd (catalog chat.cwdCode). Only worca and the chat's own agent can write into
  // the chat's folder; a chat still never runs on such code.
  const cwdCode = engineEntry(engine)?.chat?.cwdCode || [];
  const loaded = readdirSync(dir).filter((n) => cwdCode.includes(n));
  if (loaded.length) throw new Error(`${dir} holds ${loaded.join(', ')}, which ${engine} would run: a chat never runs on it`);
  if (agent) shareWithAgent(dir, agent, { writable: true, stopAt: scratchDir });
  return dir;
}
