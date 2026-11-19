// src/core/workflow-tests/try-spawn.mjs — workflow tests 3a/3b: the Pretend-try pieces of a Claude spawn, moved out of
// engines/claude.mjs (file split; it keeps the call sites): the try's parts of the --settings payload (the try guard's
// hook and deny rules, D56; the carried sign-in and the person's own guards, D71/D81), the settings canary (Task 5 fix
// review, concern 8), and the sweep of staging folders a killed Worca left behind (Task 5, M2).
import { closeSync, constants as fsConstants, existsSync, lstatSync, openSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeEmit } from '../engines/spawn.mjs';
import { tryGuardHookEntry, withTryDeny, settingsCanaryHookEntry, SETTINGS_CANARY_PREFIX, SETTINGS_IGNORED_FILE, SETTINGS_IGNORED_TEXT } from './try-guard-env.mjs';
import { signInSettingsOf, safetySettingsOf, CARRY_WARNING_PREFIX } from './try-carry.mjs';

/** M8 (security review): the permission rules as the payload carries them: only `allow` / `ask` / `deny`, each a list of
 *  strings (other entries dropped), in their given order; null when nothing is left. A wrong-typed `permissions` value
 *  would make the CLI drop the whole settings file, as C1's sandbox does. */
export function permissionListsOf(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null;
  const out = {};
  for (const [k, v] of Object.entries(rules)) {
    if ((k === 'allow' || k === 'ask' || k === 'deny') && Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
  }
  return Object.keys(out).length ? out : null;
}

/** buildSettingsPayload's (engines/claude.mjs) try parts. `tg`: the try guard's PreToolUse hook (D56), or null; `rules`: the
 *  permission rules the payload carries: with a try guard its deny rules added, the person's own deny rules (D81) after
 *  Worca's and the try guard's (deduplicated: they only add blocks), as permission lists (M8); `safety` / `signIn`: the
 *  person's guards and the carried sign-in helpers (D71), or null; `top`: the settings keys they set (the helpers, the
 *  sandbox as given: readUserSafety has already laid the checkout's project and local sandbox over the person's, D81a). */
export function tryPayloadParts(permissionRules, { tryGuard = null, signInSettings = null, safetySettings = null } = {}) {
  const tg = tryGuard ? tryGuardHookEntry() : null;
  const rules0 = tg ? withTryDeny(permissionRules) : permissionRules;
  const safety = safetySettingsOf(safetySettings);
  const rules = permissionListsOf(safety && safety.deny.length
    ? { ...(rules0 && typeof rules0 === 'object' ? rules0 : {}), deny: [...new Set([...(rules0 && Array.isArray(rules0.deny) ? rules0.deny : []), ...safety.deny])] }
    : rules0);
  const signIn = signInSettingsOf(signInSettings);
  return { tg, rules, safety, signIn, top: { ...(signIn ?? {}), ...(safety && safety.sandbox ? { sandbox: safety.sandbox } : {}) } };
}

/** Adds the try guard's hook `tg` (tryPayloadParts) to `settings` (changed in place) beside the host guard; nothing when
 *  null. As the A8 read guard, the user's settings cannot switch it off. A Pretend try's canary (`tryGuard.canary`, named by
 *  settingsCanary) adds its SessionStart hook, which proves the file was read (concern 8). */
export function addTryHooks(settings, tg, tryGuard) {
  if (!tg) return;
  settings.hooks = settings.hooks ?? {};
  settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), tg];
  settings.disableAllHooks = false;
  if (typeof tryGuard.canary === 'string' && tryGuard.canary) {
    settings.hooks.SessionStart = [...(settings.hooks.SessionStart ?? []), settingsCanaryHookEntry(tryGuard.canary)];
  }
}

/** D71, D81: whether a spawn's settings must go in a file even when its argv fits (planClaudeInvocation): a carried sign-in
 *  helper or the person's own guards. */
export const carriesFileSettings = (opts) => !!(signInSettingsOf(opts.signInSettings) || safetySettingsOf(opts.safetySettings));

/** planClaudeInvocation's plan when only the settings move to a file (carriesFileSettings, and the argv fits): the prompt and
 *  the system prompt stay inline (not the GH #380 staging); `files` (the agents file, if any) gets `<dir>/settings.json`.
 *  `buildArgs`: buildClaudeArgs. */
export function settingsFilePlan({ opts, dir, files, payload, inlineLength, buildArgs }) {
  const settingsFile = join(dir, 'settings.json');
  return { args: buildArgs(opts, { settingsFile }), stdin: null, files: [...files, { path: settingsFile, content: JSON.stringify(payload.settings) }], staged: false, inlineLength };
}

/** Task 5 (security review M2): the staging folders' prefix in the OS temp folder, and the age after which a folder is
 *  left over from a spawn Worca no longer runs (Worca was killed before its cleanup); the newest of the folder's and its
 *  files' times counts, so a long spawn whose guard still writes its log keeps its folder. */
export const STAGING_PREFIX = 'worca-claude-';
export const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** M2: remove the staging folders older than `maxAgeMs` in `dir` (never a link, never anything else). Never throws.
 *  @returns {string[]} the folder names removed */
export function sweepStaleStagingDirs({ dir = tmpdir(), maxAgeMs = STAGING_MAX_AGE_MS, now = Date.now() } = {}) {
  const removed = [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.startsWith(STAGING_PREFIX)); } catch { return removed; }
  for (const name of names) {
    const p = join(dir, name);
    try {
      const st = lstatSync(p);
      if (!st.isDirectory()) continue;   // a symlink or junction is not a directory to lstat
      let newest = st.mtimeMs;
      for (const f of readdirSync(p)) { try { newest = Math.max(newest, lstatSync(join(p, f)).mtimeMs); } catch { /* gone */ } }
      if (now - newest < maxAgeMs) continue;
      rmSync(p, { recursive: true, force: true });
      removed.push(name);
    } catch { /* best effort: the next boot tries again */ }
  }
  return removed;
}

/** Re-review 2 (n2): append `text` to `file` in a run folder an agent can write to, never through a link: a symlink (or a
 *  junction) or a hardlink already at that name is refused (thrown), and the open itself does not follow a symlink where the
 *  platform can say so (O_NOFOLLOW; not on Windows, where the lstat is the check). */
function appendNoFollow(file, text) {
  let st = null;
  try { st = lstatSync(file); } catch (e) { if (e && e.code !== 'ENOENT') throw e; }
  if (st && (!st.isFile() || st.nlink > 1)) throw new Error(`refusing to write through a link: ${file}`);
  const fd = openSync(file, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | (fsConstants.O_NOFOLLOW ?? 0), 0o644);
  try { writeSync(fd, text); } finally { closeSync(fd); }
}

/** Re-review 3 (m4): the settings canary's verdict in the run folder `dir`. Appended to SETTINGS_IGNORED_FILE; when a link sits
 *  there (refused, never written through), written to a new file of its own (`wx`: created, never an existing name or a
 *  link), so a planted link cannot keep readTryOutcome from marking the try as Worca's. */
function writeSettingsIgnored(dir, text) {
  try { appendNoFollow(join(dir, SETTINGS_IGNORED_FILE), text); return; } catch { /* a link: a fresh name below */ }
  writeFileSync(join(dir, `settings-ignored-${randomBytes(8).toString('hex')}.ndjson`), text, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
}

/** Task 5 fix review (concern 8): a Pretend try's settings canary, a marker in the try's run folder (beside `tryGuard.logFile`)
 *  its SessionStart hook writes. `path` is null (and every call a no-op) for any other spawn; `tryGuard` is the one to stage
 *  (naming the canary). `saw(evt)`: each stdout event (an init event means the CLI started a session). `verdict()`: a session
 *  that started and ended without the marker ran without Worca's settings file: one carry warning on `onEvent`, and the run
 *  folder marks the try as Worca's problem (readTryOutcome, worcaProblemOf 'settings'); judged once, on EVERY end of a
 *  session that started (re-review 2, n1), before `remove()` takes the marker away. */
export function settingsCanary({ pluginsOff, tryGuard, onEvent }) {
  const path = pluginsOff === true && tryGuard && typeof tryGuard.logFile === 'string' && tryGuard.logFile
    ? join(dirname(tryGuard.logFile), `${SETTINGS_CANARY_PREFIX}${process.pid}-${randomBytes(6).toString('hex')}`) : null;
  let sessionStarted = false;
  let judged = false;
  return {
    path,
    tryGuard: path ? { ...tryGuard, canary: path } : tryGuard,
    saw(evt) { if (evt?.type === 'system' && evt?.subtype === 'init') sessionStarted = true; },
    verdict() {
      if (!path || !sessionStarted || judged) return;
      judged = true;
      try {
        if (existsSync(path)) return;
        writeSettingsIgnored(dirname(tryGuard.logFile), `${JSON.stringify({ ts: new Date().toISOString(), why: 'settings canary missing' })}\n`);
      } catch { /* the warning still says it */ }
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `${CARRY_WARNING_PREFIX}${SETTINGS_IGNORED_TEXT}` });
    },
    /** `fn` (the spawn's onDone), judging first (the cleanup judges too; once). */
    judgeThen(fn) { return (...a) => { this.verdict(); return fn(...a); }; },
    remove() { if (path) { try { rmSync(path, { force: true }); } catch { /* best effort */ } } },
  };
}
