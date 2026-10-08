// src/core/ask/deny-rules.mjs
// Ask Worca's deny list — ONE list for both engines (cascading-settings-design.md D13, §4.6). A Claude chat
// hands it to the CLI as permission rules (spawn.mjs); a Codex chat has no permission engine, so worca's own
// file tools (file-deps.mjs) check every path against the SAME rules through askPathDenied below — the two
// engines cannot drift.
import { homedir } from 'node:os';

// Deny beats allow, and the chat's worktrees live INSIDE the home
// (<home>/ask/<thread>/wt/…), so the home cannot be denied as a whole: worca's
// own state is enumerated instead — everything under the home except ask/.
// Path rules are `//` (filesystem root) or `~/` anchored; worcaHome() is never
// interpolated (its characters would be read as glob). `.worca-cc` is the home's
// conventional basename (a differently named WORCA_HOME simply does not match
// the home-relative denies — exactly as the old blanket deny did not).
export const ASK_DENY_RULES = Object.freeze([
  'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill',
  'Read(//**/worca-cc.db*)',           // the DB (+ -wal/-shm/backups), wherever the home is
  'Read(//**/worca.db*)',              // the pre-rename DB file, still present on older homes
  'Read(//**/secrets.json)',           // plugins/*/data/secrets.json and any other
  'Read(//**/.env*)',
  'Read(//**/.worca-cc/settings.json)',
  'Read(//**/.worca-cc/store/**)',     // run store: transcripts, logs, artifacts
  'Read(//**/.worca-cc/runs/**)',      // pipeline checkouts + per-run logs (run diffs come through get_run_diff, filtered)
  'Read(//**/.worca-cc/plugins/**)',
  'Read(//**/.worca-cc/tmp/**)',       // the chat's own scratch cwd (per-turn mcp-*.json)
  'Read(//**/.worca-cc/logs/**)',      // ask-web.jsonl: every thread's fetched URLs
  'Read(//**/.worca-cc/mcp/**)',       // the MCP registry: servers, sets, secrets, tests (MCP registry §5.5.4)
  'Read(//**/.worca-cc/skills/**)',    // the skill library (skills registry §2b-7); a turn reads only its own mount under ask/<thread>/
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
  'Read(~/.gnupg/**)',
  'Read(~/.kube/**)',
  'Read(~/.docker/**)',
  'Read(~/.claude/**)',                // Claude Code's own credentials + session transcripts
  'Read(~/.netrc)',
  'Read(~/.npmrc)',
  'Read(~/.config/gh/**)',
  'Read(//proc/**)',                   // the server's own environment (/proc/<pid>/environ holds its GitHub and model tokens)
]);

/** The same denies minus the run store and checkouts, for a read of ONE run: the night decider and the Auto
 *  classifier read the run's checkout (under .worca-cc/runs) and its plans (in the store). */
export const RUN_READ_DENY_RULES = Object.freeze(ASK_DENY_RULES.filter((r) => !/\.worca-cc\/(store|runs)\//.test(r)));

const READ_RULE = /^Read\((.+)\)$/;
export const toPosix = (p) => String(p).replace(/\\/g, '/');

/** The path globs of the Read(...) rules, absolute: `//x` is `/x`, `~/x` is under `home`. Tool-only rules carry no path. */
export function askDenyGlobs({ rules = ASK_DENY_RULES, home = homedir() } = {}) {
  const base = toPosix(home).replace(/\/+$/, '');
  const out = [];
  for (const rule of rules) {
    const m = READ_RULE.exec(rule);
    if (!m) continue;
    if (m[1].startsWith('//')) out.push({ rule, glob: m[1].slice(1) });
    else if (m[1].startsWith('~/')) out.push({ rule, glob: `${base}/${m[1].slice(2)}` });
  }
  return out;
}

// Tokens: a literal, `?` (one non-slash), `*` (non-slashes), `**` (anything), `/**/`'s tail `(?:.*/)?`, a final `/**`.
const LIT = 0, ONE = 1, STAR = 2, ANY = 3, DIRS = 4, TAIL = 5;
function globTokens(g) {
  const out = [];
  for (let i = 0; i < g.length; i += 1) {
    if (g.startsWith('/**/', i)) { out.push({ t: LIT, c: '/' }, { t: DIRS }); i += 3; continue; }
    if (g.startsWith('/**', i) && i + 3 === g.length) { out.push({ t: TAIL }); i += 2; continue; }
    if (g.startsWith('**', i)) { out.push({ t: ANY }); i += 1; continue; }
    const c = g[i];
    out.push(c === '*' ? { t: STAR } : c === '?' ? { t: ONE } : { t: LIT, c });
  }
  return out;
}

// A regex `i` flag's own case folding (ECMA-262 Canonicalize, non-unicode mode), one code unit at a time: the
// length never changes, and a non-ASCII unit never folds onto ASCII — so the matcher denies exactly what the regex did.
function foldUnit(c) {
  const u = c.toUpperCase();
  if (u.length !== 1) return c;
  return c.charCodeAt(0) >= 128 && u.charCodeAt(0) < 128 ? c : u;
}
const foldCase = (s) => { let out = ''; for (let i = 0; i < s.length; i += 1) out += foldUnit(s[i]); return out; };

/** A glob over absolute POSIX paths: `**` any depth (a trailing `/**` also matches the folder itself), `*` within one
 *  segment, `?` one character. Case-insensitive where the file system usually is (macOS, Windows): denies more, never less.
 *  Matched by stepping a set of states through the path once (no backtracking), so a glob the model writes — `*a*a*a*…`
 *  — costs time linear in the path, never exponential. Returns `{ test(path) }`. */
export function globMatcher(glob, { caseInsensitive = process.platform === 'darwin' || process.platform === 'win32' } = {}) {
  const fold = caseInsensitive ? foldCase : (s) => s;
  const toks = globTokens(fold(String(glob)));
  const T = toks.length;                       // state T accepts; T+1+i is token i's inner state (DIRS, TAIL)
  const mark = new Int32Array(2 * T + 1);
  let gen = 0;
  const add = (set, s) => {
    if (mark[s] === gen) return;
    mark[s] = gen;
    set.push(s);
    if (s > T) { if (toks[s - T - 1].t === TAIL) add(set, T); return; }
    if (s === T) return;
    const t = toks[s].t;
    if (t === STAR || t === ANY || t === TAIL) add(set, s + 1);
    else if (t === DIRS) { add(set, s + 1); add(set, T + 1 + s); }
  };
  return {
    test(path) {
      const s = fold(String(path));
      gen += 1;
      let cur = [];
      add(cur, 0);
      for (let k = 0; k < s.length && cur.length; k += 1) {
        const c = s[k];
        gen += 1;
        const next = [];
        for (const st of cur) {
          if (st === T) continue;
          if (st > T) {
            const i = st - T - 1;
            add(next, st);
            if (toks[i].t === DIRS && c === '/') add(next, i + 1);
            continue;
          }
          const tk = toks[st];
          if (tk.t === LIT) { if (c === tk.c) add(next, st + 1); }
          else if (tk.t === ONE) { if (c !== '/') add(next, st + 1); }
          else if (tk.t === STAR) { if (c !== '/') add(next, st); }
          else if (tk.t === ANY) add(next, st);
          else if (tk.t === TAIL) { if (c === '/') add(next, T + 1 + st); }
        }
        cur = next;
      }
      return cur.includes(T);
    },
  };
}

const cache = new Map();
function compiled(rules, home) {
  const key = `${home}\u0000${rules.join('\u0000')}`;
  if (!cache.has(key)) cache.set(key, askDenyGlobs({ rules, home }).map(({ rule, glob }) => ({ rule, re: globMatcher(glob) })));
  return cache.get(key);
}

/** The rule that denies `absPath`, or null — the matcher every Codex file tool uses. */
export function askPathDenied(absPath, { rules = ASK_DENY_RULES, home = homedir() } = {}) {
  const p = toPosix(absPath);
  for (const { rule, re } of compiled(rules, home)) if (re.test(p)) return rule;
  return null;
}
