// src/core/ask/file-deps.mjs
// Worca's read-only file tools for Codex chats (cascading-settings-design.md D13, §4.6): read_file, grep, glob.
// A locked-down chat (every engine but Claude: Codex, Copilot, Gemini CLI, Qwen Code) has no file tool of its own, so these are its ONLY view of the disk. The reader itself is
// file-reader.mjs; this module adds the chat's roots under the Worca home (plus, for a turn with set skills, that
// message's skill mount, and for a Design chat its design's work/ folder and project, Design P8 L8.10). Present in the
// MCP child only for a locked-down chat (WORCA_ASK_ENGINE names its engine); a Claude chat keeps its native Read/Grep/Glob.
import { existsSync, realpathSync } from 'node:fs';
import { join, isAbsolute, resolve, dirname, basename } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { isWithin } from '../fs-scope.mjs';
import { DESIGN_ID_RE } from '../design/ids.mjs';
import { createAskFileReader } from './file-reader.mjs';
import { lockedChatEngine } from '../model-env.mjs';
import { ENGINES, chatEnginesTaking } from '../../shared/engine-switch.mjs';

export { AskFileError, ASK_FILE_LIMITS, createAskFileReader } from './file-reader.mjs';

const THREAD_RE = /^ask_[0-9a-f]{8}$/;
const MESSAGE_RE = /^askm_[0-9a-f]{8}$/;
const DESIGN_OUTSIDE = "outside this chat's files";
const SKILLS_OUTSIDE = "outside this chat's worktrees, attachments and memory and this turn's skills";

const realOr = (p) => { try { return realpathSync(p); } catch { return p; } };   // a missing path keeps its text
const normalAbs = (p) => typeof p === 'string' && isAbsolute(p) && resolve(p) === p;

/** A project root a Design chat may read: a direct child of worca's default projects folder (`<home>/projects`), or a
 *  folder neither inside the home nor holding it. Judged on the text and on the real paths (the reader follows links),
 *  so a link to a folder above the home, or from the projects folder into the home, is refused. */
function projectRootOk(home, p) {
  const fits = (hm, q) => dirname(q) === join(hm, 'projects') || (!isWithin(q, hm) && !isWithin(hm, q));
  const homes = [home, realOr(home)];
  return [p, realOr(p)].every((q) => homes.every((hm) => fits(hm, q)));
}

/** A Design chat's roots (Design P8 L8.10): `design.workDir` only when it is exactly `<home>/design/<design id>/work`
 *  (else the whole design is dropped), then `design.projectDir` when projectRootOk. Anything but a plain object is none. */
function designRootsOf(home, design) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return [];
  const w = design.workDir;
  const p = design.projectDir;
  if (!normalAbs(w) || !DESIGN_ID_RE.test(basename(dirname(w))) || w !== join(home, 'design', basename(dirname(w)), 'work')) return [];
  return normalAbs(p) && projectRootOk(home, p) ? [w, p] : [w];
}

/** The roots a Codex chat may read: its worktrees, its attachments, the memory mount — and, for a turn with set skills
 *  (#635), `skillRoot`: that message's mount. Only a path that is exactly `<home>/ask/<this thread>/skills/<message id>`
 *  is taken, never the thread's whole skills folder or another chat's; anything else is dropped. A Design chat's
 *  `design` roots ({workDir, projectDir?}, designRootsOf) go FIRST, so grep and glob without a path search work/. */
export function askFileRoots({ home = worcaHome(), threadId, skillRoot = null, design = null } = {}) {
  if (typeof threadId !== 'string' || !THREAD_RE.test(threadId)) return [];
  const roots = [...designRootsOf(home, design), join(home, 'ask', threadId, 'wt'), join(home, 'ask', threadId, 'att'), join(home, 'ask', 'memory')];
  if (typeof skillRoot === 'string' && isAbsolute(skillRoot) && resolve(skillRoot) === skillRoot
    && dirname(skillRoot) === join(home, 'ask', threadId, 'skills') && MESSAGE_RE.test(basename(skillRoot))) roots.push(skillRoot);
  return roots;
}

/** WORCA_ASK_DESIGN_ROOTS (ask/spawn.mjs buildMcpConfig): JSON, or null when it is absent or does not parse. */
function designFromEnv(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** The MCP child's file bundle: present only for a locked-down chat, whose own file tools are off (the parent sets
 *  WORCA_ASK_ENGINE in the child's env). */
export function defaultFileDeps({ threadId = null, env = process.env, signal = null } = {}) {
  if (!env || !lockedChatEngine(env.WORCA_ASK_ENGINE)) return {};
  // chatImages / chatPdfs: whether this chat's engine forwards an image / a PDF block of a tool result to its model
  // (read_attachment and read_file send them); mediaElsewhere names the chats that do, for the note when it does not.
  const chat = ENGINES[env.WORCA_ASK_ENGINE].chat;
  const home = worcaHome();
  const design = designFromEnv(env.WORCA_ASK_DESIGN_ROOTS);
  const skillRoot = env.WORCA_ASK_SKILL_ROOT || null;
  // The reader pins every root to its real path now (createAskFileReader). A design root missing now is dropped, so a
  // folder that appears under its name later (a link an agent planted on a shared volume) is never one.
  const missing = new Set(designRootsOf(home, design).filter((p) => !existsSync(p)));
  const roots = askFileRoots({ home, threadId, skillRoot, design }).filter((r) => !missing.has(r));
  // The refusal names what the chat can read, from the roots askFileRoots KEPT (never from the env being set).
  const outsideText = !roots.length ? undefined : designRootsOf(home, design).length ? DESIGN_OUTSIDE
    : skillRoot && roots.at(-1) === skillRoot ? SKILLS_OUTSIDE : undefined;
  return { engine: env.WORCA_ASK_ENGINE, chatImages: chat.images === true, chatPdfs: chat.pdfs === true,
    mediaElsewhere: (what) => `${chatEnginesTaking(what)} chats can`,
    files: createAskFileReader({ roots, ...(outsideText ? { outsideText } : {}), signal }) };
}
