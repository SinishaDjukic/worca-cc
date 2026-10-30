// src/core/ask/chat-folder.mjs
// A locked-down chat's own folder under the shared scratch dir (<worcaHome>/tmp/ask): <scratch>/<engine>/<name>. In
// pool mode the scratch dir is writable by every agent user (docker/entrypoint.sh: 3770, group worca-share), and Gemini
// CLI, Goose and OpenCode run code they find in their cwd (workspace settings hooks, `.agents/plugins/*/hooks`,
// `.opencode/plugin(s)/*.js`). So both levels are made here with modes of worca's choosing and must then be real folders
// worca owns (agent-user.mjs assertOwnFolders, V10): never a link, never one another user made first. A relayed chat
// runs as the person's agent user, so its folder is then opened to that user's group (shareWithAgent).
import { chmodSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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

// A chat whose engine keeps no folder of its own runs in the shared scratch dir itself, and Claude Code loads project
// settings from its cwd there (`--setting-sources project`, ask/spawn.mjs): `.claude/settings.json` (hooks, which run
// commands) and `CLAUDE.md`. In pool mode every agent user may add entries to that dir (3770, group worca-share), so one
// that planted either would reach every other person's Claude chat. Worca holds both names itself instead: a folder and
// an empty file it owns that nobody else may write, which the sticky bit stops anyone renaming or replacing (audit
// 3.2b). A stopgap: the full fix gives Claude chats a folder of their own, which moves Claude Code's session store and so
// breaks --resume of every existing thread until a migration is decided.
const HELD = Object.freeze([{ name: '.claude', dir: true }, { name: 'CLAUDE.md', dir: false }]);

/** Whether `dir` holds an entry another user made (a link counts as worca's own only when worca made it). */
function foreignInside(dir, uid) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.uid !== uid) return p;
    if (st.isDirectory()) { const f = foreignInside(p, uid); if (f) return f; }
  }
  return null;
}

/**
 * Make (or check) the scratch dir's held entries: `.claude/` (0755) and an empty `CLAUDE.md` (0444), both worca's. Run at
 * boot and before every chat or helper call in `scratchDir` itself. Throws when one is a link, the wrong type, another
 * user's, a hard link or not empty (the file), or holds another user's entry (the folder): no chat then runs there.
 * Ownership is not checked where the platform has no uids (Windows: no agent users either).
 * @param {string} scratchDir @param {{uid?: number|null}} [o]
 */
export function holdScratchEntries(scratchDir, { uid = process.getuid?.() ?? null } = {}) {
  for (const { name, dir } of HELD) {
    const p = join(scratchDir, name);
    try {
      if (dir) mkdirSync(p, { mode: 0o755 }); else writeFileSync(p, '', { flag: 'wx', mode: 0o444 });
    } catch (err) { if (err?.code !== 'EEXIST') throw err; }
    const st = lstatSync(p);
    const what = dir ? 'folder' : 'empty file';
    const fail = (why) => new Error(`${p} is not worca's own ${what} (${why}): no chat runs in ${scratchDir} while it is there. `
      + 'Remove it; worca makes its own at the next start or chat.');
    if (st.isSymbolicLink()) throw fail('a link');
    if (dir ? !st.isDirectory() : !st.isFile()) throw fail(dir ? 'not a folder' : 'not a file');
    if (uid == null) continue;
    if (st.uid !== uid) throw fail('another user\'s');
    if (!dir && st.nlink !== 1) throw fail('a hard link');
    // Closed first, then checked: what is in it now is all it can hold (every chat checks again).
    chmodSync(p, dir ? 0o755 : 0o444);
    if (!dir && lstatSync(p).size !== 0) throw fail('not empty');
    const foreign = dir ? foreignInside(p, uid) : null;
    if (foreign) throw fail(`it holds ${foreign}, another user's`);
  }
}
