// src/core/ask/command-policy.mjs
// Ask agent mode (#574): the rails every command Ask runs passes BEFORE a key is typed. A rail
// against mistakes and naive prompt injection, not a sandbox: obfuscated text can pass it
// (docs/terminal.md "Chat"). Pure: the caller gives the folder, homes, host PID and port.
import { isAbsolute, relative, resolve, win32, posix } from 'node:path';
import { evaluateKillCommand } from '../host-guard.mjs';
import { SPAWN_ENV_BASE } from '../claude-runner.mjs';

export const COMMAND_MAX_CHARS = 4000;

const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Mirrors ASK_DENY_RULES (spawn.mjs). Matched ANYWHERE in the text, quotes included: a quoted path
// ("$HOME/.ssh/id_rsa", '/Users/me/.aws/credentials') is still a read of it.
const PROTECTED = [
  /\.worca-cc\b/, /\bworca(?:-cc)?\.db/, /\bsecrets\.json\b/, /(?:^|[\s/'"=<>])\.env[\w.-]*/,
  /(?:^|[\s/'"=<>~])\.ssh\b/, /(?:^|[\s/'"=<>~])\.aws\b/, /(?:^|[\s/'"=<>~])\.gnupg\b/,
  /(?:^|[\s/'"=<>~])\.netrc\b/, /\.config\/gh\b/, /(?:^|[\s'"=<>])\/proc\//,
  // The corporate proxy login (an NT hash), Docker secrets and the egress sidecar's data folder (its default path).
  /\bproxy-login\.json/, /(?:^|[\s'"=<>]|\/var)\/run\/secrets\b/, /(?:^|[\s'"=<>])\/worca\/egress\b/,
];
// ASK_DENY_RULES anchors these at ~/ only: a project's own .claude/, .docker/, .kube/ and .npmrc are
// ordinary files (every worca worktree has .claude/rules). Refused only under the user's home.
const HOME_ONLY = ['.claude', '.docker', '.kube', '.npmrc'].map(reEsc).join('|');

// Windows (Git Bash): `\` separates folders too (C:\Users\me\.ssh), and NTFS ignores case.
const PROTECTED_WIN = [
  /\.worca-cc\b/i, /\bworca(?:-cc)?\.db/i, /\bsecrets\.json\b/i, /(?:^|[\s/\\'"=<>])\.env[\w.-]*/i,
  /(?:^|[\s/\\'"=<>~])\.ssh\b/i, /(?:^|[\s/\\'"=<>~])\.aws\b/i, /(?:^|[\s/\\'"=<>~])\.gnupg\b/i,
  /(?:^|[\s/\\'"=<>~])\.netrc\b/i, /\.config[\\/]+gh\b/i, /(?:^|[\s'"=<>])\/proc\//,
  /\bproxy-login\.json/i,
];

const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

// ── system secret folders, by path shape (not by spelling) ───────────────────────────────────────────────────────────
// THIS IS A GUARD ON THE CHAT'S OWN COMMANDS, NOT THE SECURITY BOUNDARY. The boundary is file permissions, agent users
// and the egress sidecar (the login never sits where an agent can read it). The guard turns away a chat command that
// names Docker secrets (/run/secrets, under /var/run and /private/var/run too), the egress sidecar's data folder
// (/worca/egress or WORCA_EGRESS_DATA_DIR) or a proxy-login.json, however the path is spelled. The classes it handles:
//   - spelling: `/+`, `.` and `..` (normalised), quotes and backslashes (removed), brace groups (expanded, capped:
//     past BRACE_CAP alternatives the command is refused);
//   - globs on any segment and on the file name, matched with the shell's own rules (a leading dot is never matched by
//     a wildcard, as with dotglob off) by a linear matcher; a lone `*` (`ls *`, `rm -rf *`) is a folder listing, not a
//     name: it is let through, and `.worca-cc` itself, the folder that holds the login, is refused by name and by glob;
//   - variables: $PWD / ${PWD} / $OLDPWD (the session folder), $HOME / ${HOME} / ~ (the home), and NAME=value set in the
//     command itself are substituted; every other $NAME, ${…}, $(…) and `…` stands for "any path" (a wildcard), so it
//     never skips the check, and a command substitution's own text is checked as a command too (capped: SUBST_CAP);
//   - cd / pushd chains: a relative word is resolved from every folder the command can reach, in order;
//   - redirections and here-strings (`< x`, `0<x`, `<<< "$(…)"`): their words are ordinary words;
//   - recursive readers (find, tar, cp, rsync, scp, zip, grep, rg, ag, xargs) given a PARENT of a protected folder
//     (`/`, `/run`, `/worca`, the home, the Worca home): refused. A glob name in the session folder (`cat p*.json`)
//     is allowed: the session folder is a project or a run, which holds no login.
// Not covered, on purpose: a program that builds a path at run time (a script, `python -c`, `node -e`), and a symlink
// made earlier pointing at a protected folder. Those are what file permissions and agent users are for.
const SECRET_SEGMENTS = Object.freeze([['run', 'secrets'], ['worca', 'egress']]);
const SECRET_NAMES = Object.freeze(['proxy-login.json']);
const SECRET_DIRS = Object.freeze(['.worca-cc']);
const PROTECTED_LOCATIONS = Object.freeze(['/run/secrets', '/var/run/secrets', '/private/var/run/secrets', '/worca/egress']);
const RECURSIVE_READERS = new Set(['find', 'tar', 'cp', 'rsync', 'scp', 'zip', '7z', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'xargs']);
const PREFIX_WORDS = new Set(['sudo', 'env', 'command', 'nice', 'nohup', 'time', 'exec', 'builtin']);
const GLOB_CHARS = /[*?[\]]/;
const BRACE_CAP = 64;
const SUBST_CAP = 32;
const ANY = '\u0000';   // stands for "any path" (an unknown expansion) until the word becomes glob text
/** One word's brace alternatives (`a{b,c}d` → abd, acd), or null when they would pass BRACE_CAP (the caller then
 *  refuses the command: fail closed). The work is bounded by the cap: the pending list never grows past it. */
function braceExpand(word) {
  const out = []; const todo = [word];
  while (todo.length) {
    const w = todo.shift();
    const m = /\{([^{}]*,[^{}]*)\}/.exec(w);
    if (!m) { out.push(w); continue; }
    const alts = m[1].split(',');
    if (out.length + todo.length + alts.length > BRACE_CAP) return null;
    for (const alt of alts) todo.push(w.slice(0, m.index) + alt + w.slice(m.index + m[0].length));
  }
  return out;
}
/** One glob unit of `g` at `i` against the character `c`: [length of the unit, matched]. `[...]` / `[!...]` sets. */
function unitAt(g, i, c) {
  if (g[i] === '?') return [1, c !== undefined];
  if (g[i] === '[') {
    const j = g.indexOf(']', i + 2);
    if (j > 0) {
      const neg = g[i + 1] === '!' || g[i + 1] === '^';
      const set = g.slice(i + (neg ? 2 : 1), j);
      let hit = false;
      for (let k = 0; k < set.length; k += 1) {
        if (set[k + 1] === '-' && k + 2 < set.length) { if (c >= set[k] && c <= set[k + 2]) hit = true; k += 2; } else if (set[k] === c) hit = true;
      }
      return [j - i + 1, c !== undefined && hit !== neg];
    }
  }
  return [1, g[i] === c];
}
/** Does the glob segment `g` (*, ?, [...]) match the literal `name`? Linear two-pointer matching with one backtrack
 *  point (the last `*`), no RegExp: a run of stars costs nothing more. A wildcard never matches a leading dot. */
function segMatches(g, name) {
  if (!GLOB_CHARS.test(g)) return g === name;
  if (name[0] === '.' && g[0] !== '.') return false;
  let gi = 0; let ni = 0; let star = -1; let mark = 0;
  while (ni < name.length) {
    if (gi < g.length && g[gi] === '*') { while (g[gi] === '*') gi += 1; star = gi; mark = ni; continue; }
    if (gi < g.length) { const [len, ok] = unitAt(g, gi, name[ni]); if (ok) { gi += len; ni += 1; continue; } }
    if (star < 0) return false;
    mark += 1; ni = mark; gi = star;
  }
  while (g[gi] === '*') gi += 1;
  return gi === g.length;
}
/** True when the segments hold `want` as consecutive segments (glob-aware). An ANY segment matches anything. */
const segOk = (g, w) => g === '*' ? w[0] !== '.' : segMatches(g, w);
function holdsSegments(segs, want) {
  for (let i = 0; i + want.length <= segs.length; i += 1) if (want.every((w, k) => segOk(segs[i + k], w))) return true;
  return false;
}
/** The segments of an absolute path written with globs. */
const segsOf = (abs) => posix.normalize(abs).split('/').filter(Boolean);
const isLoneStar = (g) => /^\*+$/.test(g);

/** `$(…)` and backtick spans, innermost first, become ANY; their text joins the list of commands to check. null past
 *  SUBST_CAP (refused). */
function liftSubstitutions(text) {
  const inner = [];
  let s = String(text); let n = 0;
  for (;;) {
    const m = /\$\(([^()]*)\)|`([^`]*)`/.exec(s);
    if (!m) break;
    if ((n += 1) > SUBST_CAP) return null;
    inner.push(m[1] ?? m[2]);
    s = s.slice(0, m.index) + ANY + s.slice(m.index + m[0].length);
  }
  return { text: s, inner };
}
/** A command's segments (split on ; & | and newlines), each its words: unquoted, unescaped, split on blanks and < > ( ). */
const segmentsOfCommand = (text) => String(text).split(/;|&&?|\|\|?/).map((seg) => seg.split(/[\s<>()]+/).filter(Boolean)
  .map((w) => w.replace(/\\(.)/g, '$1').replace(/['"]/g, '')).filter(Boolean)).filter((ws) => ws.length);

/** Substitute the known variables and ~; every other expansion becomes ANY. */
function expandWord(w, vars, { cwd, home }) {
  let out = w;
  if (out === '~' || out.startsWith('~/')) out = home ? home + out.slice(1) : ANY + out.slice(1);
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$\{[^}]*\}|\$[0-9@*#?$!-]/g, (_, a, b) => {
    const name = a || b;
    if (!name) return ANY;
    if (name === 'PWD' || name === 'OLDPWD') return cwd;
    if (name === 'HOME') return home || ANY;
    return Object.hasOwn(vars, name) ? vars[name] : ANY;
  });
  return out;
}
/** ANY → a wildcard segment: a word starting with it is "any absolute path". */
const globText = (w) => (w.startsWith(ANY) ? `/*${w.slice(1)}` : w).replace(/\u0000/g, '*');

/**
 * True when the command names a protected system secret path (see the header above). Pure; bounded by the command's
 * length (COMMAND_MAX_CHARS), BRACE_CAP and SUBST_CAP.
 * @param {string} command
 * @param {{cwd?: string, home?: string|null, worcaHome?: string|null, egressDataDir?: string|null}} [o]
 */
export function namesSystemSecretPath(command, { cwd = '/', home = null, worcaHome = null, egressDataDir = null } = {}) {
  const session = posix.resolve('/', String(cwd || '/').replace(/\\/g, '/'));
  const homeDir = typeof home === 'string' && home.startsWith('/') ? posix.normalize(home).replace(/\/+$/, '') || '/' : null;
  const egressSegs = typeof egressDataDir === 'string' && egressDataDir.trim().length > 1 ? segsOf(egressDataDir.trim()) : null;
  const targets = [...SECRET_SEGMENTS, ...(egressSegs && egressSegs.length ? [egressSegs] : [])];
  const locations = [...PROTECTED_LOCATIONS, ...(egressSegs && egressSegs.length ? [`/${egressSegs.join('/')}`] : []),
    ...(typeof worcaHome === 'string' && worcaHome.startsWith('/') ? [posix.normalize(worcaHome)] : [])].map(segsOf);

  // Every command to check: the line, then the text of each command substitution in it.
  const lifted = liftSubstitutions(command);
  if (!lifted) return true;
  const texts = [lifted.text, ...lifted.inner];

  const insideSession = (abs) => abs === session || abs.startsWith(session === '/' ? '/' : `${session}/`);
  const bad = (abs) => {
    const segs = segsOf(abs);
    if (targets.some((t) => holdsSegments(segs, t))) return true;
    // `.worca-cc` written as a glob (its literal name is refused by PROTECTED above).
    if (segs.some((g) => GLOB_CHARS.test(g) && !isLoneStar(g) && SECRET_DIRS.some((d) => segMatches(g, d)))) return true;
    const last = segs[segs.length - 1];
    if (!last || isLoneStar(last) || !SECRET_NAMES.some((n) => segOk(last, n))) return false;
    // A protected name: literal anywhere; a glob only outside the session folder (a project or a run holds no login).
    return !GLOB_CHARS.test(last) || !insideSession(posix.dirname(posix.normalize(abs)));
  };
  /** `abs` is a protected location or a parent of one (glob-aware). */
  const ancestor = (abs) => { const a = segsOf(abs); return locations.some((l) => a.length <= l.length && a.every((g, i) => segOk(g, l[i]))); };

  for (const text of texts) {
    const segments = segmentsOfCommand(text);
    const vars = {};
    const dirs = [session];
    const xargs = segments.some((ws) => ws.includes('xargs'));
    for (const words of segments) {
      // Leading NAME=value assignments (and `export NAME=value`) set variables for the rest of the line.
      let i = 0;
      if (words[0] === 'export' || words[0] === 'declare' || words[0] === 'local') i = 1;
      for (; i < words.length; i += 1) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(words[i]);
        if (!m) break;
        vars[m[1]] = expandWord(m[2], vars, { cwd: dirs[dirs.length - 1], home: homeDir });
        const v = globText(vars[m[1]]);
        if (v.includes('/') && bad(v.startsWith('/') ? v : posix.join(dirs[dirs.length - 1], v))) return true;
      }
      while (i < words.length && PREFIX_WORDS.has(words[i])) i += 1;
      const cmd = words[i] ? words[i].split('/').pop() : '';
      const recursive = RECURSIVE_READERS.has(cmd) || xargs;
      if ((cmd === 'cd' || cmd === 'pushd') && words[i + 1] !== undefined && words[i + 1] !== '-') {
        const alts = braceExpand(globText(expandWord(words[i + 1], vars, { cwd: dirs[dirs.length - 1], home: homeDir })));
        if (!alts) return true;
        for (const t of alts) dirs.push(posix.resolve(dirs[dirs.length - 1], t));
      } else if ((cmd === 'cd' || cmd === 'pushd') && words[i + 1] === undefined && homeDir) dirs.push(homeDir);
      for (let k = i; k < words.length; k += 1) {
        const raw = words[k];
        const alts = braceExpand(globText(expandWord(raw, vars, { cwd: dirs[dirs.length - 1], home: homeDir })));
        if (!alts) return true;   // too many alternatives to check: refused, never waved through
        for (const w of alts) {
          const pathLike = w.includes('/') || GLOB_CHARS.test(w) || SECRET_NAMES.includes(w) || targets.some((t) => t.includes(w))
            || w === '.' || w === '..';
          const abs = w.startsWith('/') ? [w] : dirs.map((d) => posix.join(d, w));
          if (pathLike && abs.some(bad)) return true;
          // A recursive reader given a parent of a protected folder (`find /`, `tar c /run`, `cp -r ~ …`).
          if (recursive && k > i && !w.startsWith('-') && abs.some((p) => ancestor(posix.normalize(p)))) return true;
        }
        // A protected root written with quotes, braces or a wildcard is refused outright, whatever it expands to.
        const plain = raw.replace(/\/+/g, '/');
        if (/^\/(?:(?:private\/)?var\/)?run\b|^\/worca\b/.test(plain) && /[*?[\]{}$`]/.test(plain)) return true;
      }
    }
  }
  return false;
}
/** Rooted without a drive (/tmp, \x): Git's own MSYS root, never the session folder; `//server` (UNC) is not one. */
const DRIVELESS = /^[\\/](?![\\/])/;
/** `/c/x` (Git Bash) → `C:/x`; anything else as written. */
const fromMsys = (p) => String(p).replace(/^\/([A-Za-z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`).replace(/^([A-Za-z]:)$/, '$1/');
/** A regex source for the drive path `p` in each form a Git Bash line may use: C:\x\y, C:/x/y, /c/x/y (use flag i). */
function winPathSource(p) {
  const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(p);
  const parts = m[2].split(/[\\/]+/).filter(Boolean).map(reEsc);
  return `(?:${m[1]}:|/${m[1]})${parts.map((x) => `[\\\\/]+${x}`).join('')}`;
}
const sameWinPath = (a, b) => {
  const n = (p) => win32.normalize(fromMsys(p)).replace(/\\+$/, '').toLowerCase();
  return n(a) === n(b);
};
/** The command name: basename, and on Windows `\` too and no `.exe` (rm.exe, C:\…\rm.exe → rm). */
const cmdName = (word, win) => (win ? String(word || '').split(/[\\/]/).pop().replace(/\.exe$/i, '') : String(word || '').split('/').pop());

function namesHomeOnly(text, { cwd, userHome, win = false }) {
  const S = win ? '[\\\\/]' : '/';
  const flags = win ? 'i' : '';
  const home = userHome && userHome !== '/' ? userHome.replace(win ? /[\\/]+$/ : /\/+$/, '') : null;
  const homeSrc = home ? (win && DRIVE_PATH.test(userHome) ? winPathSource(home) : reEsc(home)) : null;
  const roots = ['~', '\\$HOME', '\\$\\{HOME\\}', ...(homeSrc ? [homeSrc] : [])].join('|');
  if (new RegExp(`(?:${roots})${S}+(?:${HOME_ONLY})(?![\\w-])`, flags).test(text)) return true;
  // A bare name where the shell is (or goes) in the home: `cd ~ && cat .claude/…`, or a session opened there.
  const atHome = !!home && !!cwd && (win ? sameWinPath(cwd, home) : cwd.replace(/\/+$/, '') === home);
  const cdHome = new RegExp(`(?:^|[;&|(]\\s*)cd(?:\\s+["']?(?:${roots})${S}*["']?)?\\s*(?:$|[;&|)])`, flags).test(text);
  return (atHome || cdHome) && new RegExp(`(?:^|[\\s${win ? '\\\\' : ''}/'"=<>])(?:${HOME_ONLY})(?![\\w-])`, flags).test(text);
}

/**
 * Shell-ish words per command segment. Quoted spans are masked while splitting (so `-m "a; rm -rf /"` is one
 * word, never a segment) and then restored WITHOUT their quotes, so a quoted rm/push target is still checked.
 * Windows: bash keeps a backslash inside double quotes unless it precedes `" \ $ \``, and Windows paths are written that way.
 */
function segmentsOf(s, win = false) {
  const spans = [];
  const unescape = win ? (b) => b.replace(/\\(["\\$`])/g, '$1') : (b) => b.replace(/\\(.)/g, '$1');
  const masked = s.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_, a, b) => {
    spans.push(a ?? unescape(b));
    return `\u0000${spans.length - 1}\u0000`;
  });
  // A command substitution is its own segment (checked as a command) AND leaves a `$` word where it stood: an
  // rm target built from one (`rm -rf $(pwd)/..`) is unknown, so it counts as outside the folder.
  return masked.replace(/\$\(|`/g, (m) => ` $SUBST ${m}`).split(/\|\||&&|;|\||&|\$\(|`|[(){}]/)
    .map((x) => x.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/\u0000(\d+)\u0000/g, (_, i) => spans[Number(i)])));
}
// Wrappers that run the next word as the command; their own options (and a count or duration) are skipped.
const WRAPPERS = new Set(['env', 'command', 'builtin', 'nohup', 'time', 'exec', 'xargs', 'nice', 'timeout', 'stdbuf', 'ionice']);
/** The command's words without its wrappers and VAR=x prefixes; xargs = the targets come from stdin (unknown). */
function skipPrefix(t, win = false) {
  let i = 0; let xargs = false;
  while (i < t.length) {
    if (/^\w+=/.test(t[i])) { i += 1; continue; }
    const w = cmdName(t[i], win);
    if (!WRAPPERS.has(w)) break;
    if (w === 'xargs') xargs = true;
    i += 1;
    while (i < t.length && (t[i].startsWith('-') || /^\d+(?:\.\d+)?[smhd]?$/.test(t[i]))) i += 1;
  }
  return { tokens: t.slice(i), xargs };
}

/** The session folder (and anything under it) becomes `.`/`./x`: a run worktree is itself under the worca home. */
function relativize(text, cwd, win = false) {
  if (!cwd || cwd === '/') return text;
  if (win) {
    if (!DRIVE_PATH.test(cwd)) return text;
    const dir = cwd.replace(/[\\/]+$/, '');
    if (!/^[A-Za-z]:[\\/]+[^\\/]/.test(dir)) return text;       // a drive root would swallow every `C:`
    return text.replace(new RegExp(`(?<![\\w.:\\\\/-])${winPathSource(dir)}(?=[\\\\/]|$|[\\s'";&|)<>])`, 'gi'), '.');
  }
  const dir = cwd.replace(/\/+$/, '');
  return text.replace(new RegExp(`${reEsc(dir)}(?=/|$|[\\s'";&|)<>])`, 'g'), '.');
}

const POSIX_PATHS = { win: false, isAbsolute, relative, resolve, norm: (p) => p, unknown: () => false };
/** Windows: `/c/x` is `C:/x`; a rooted path without a drive (/tmp) is Git's own root, so unknown (= outside). */
const WIN_PATHS = {
  win: true, isAbsolute: (p) => win32.isAbsolute(p), relative: (a, b) => win32.relative(a, b), resolve: (a, b) => win32.resolve(a, b),
  norm: fromMsys, unknown: (p) => DRIVELESS.test(p),
};

/** `dir` = where the shell is when rm runs (null: unknown, after a `cd ~` or `cd $X`); `root` = the session folder. */
function rmOutside(tokens, dir, root, xargs, P = POSIX_PATHS) {
  const flags = tokens.filter((t) => t.startsWith('-'));
  if (!flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive')) return false;
  if (xargs) return true;                                       // targets read from stdin
  return tokens.filter((t) => !t.startsWith('-')).some((t) => {
    if (/^[~$]/.test(t) || t === '/*') return true;               // a bare `*` expands inside the folder: allowed
    const w = P.norm(t);
    if (P.unknown(w)) return true;
    if (!dir && !P.isAbsolute(w)) return true;
    const abs = P.isAbsolute(w) ? w : P.resolve(dir, w);
    const rel = P.relative(root, abs);
    return rel === '' || rel.startsWith('..') || P.isAbsolute(rel);
  });
}

// git's global options before the subcommand; these take a value as the next word.
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/** The subcommand words of gh, glab or az: up to the first option, past gh's `-R o/r` (`gh issue -R o/r delete 1`). */
function cliWords(rest) {
  const words = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '-R' || rest[i] === '--repo') i += 1;
    else if (rest[i].startsWith('--repo=')) continue;
    else if (rest[i].startsWith('-')) break;
    else words.push(rest[i]);
  }
  return words;
}

/** gh and glab: a delete, an API delete or forced ref, going public, and an admin merge past branch protection. */
function codeHostHardToUndo(base, rest) {
  const words = cliWords(rest);
  const cmd = words.slice(0, 2).join(' ');
  if (words[0] !== 'search' && words.slice(0, 3).includes('delete')) return `${base} delete`;
  if (cmd === 'repo edit' && rest.some((t, i) => t === '--visibility=public' || (t === '--visibility' && rest[i + 1] === 'public'))) return `${base} repo edit --visibility public`;
  if (cmd === 'pr merge' && rest.includes('--admin')) return `${base} pr merge --admin`;
  if (cmd === 'gist create' && rest.some((t) => t === '--public' || t === '-p')) return `${base} gist create --public`;
  if (words[0] !== 'api') return null;
  const method = rest.flatMap((t, i) => {
    const m = /^(?:-X|--method=?)(.*)$/.exec(t);
    return m ? [m[1] || rest[i + 1] || ''] : [];
  });
  if (method.some((m) => m.toUpperCase() === 'DELETE')) return `${base} api DELETE`;
  if (rest.some((t) => /^(?:-[fF]|--(?:raw-)?field=)?(?:force=true|visibility=public|private=false)$/i.test(t))) return `${base} api force or visibility change`;
  return null;
}

function hardToUndo({ tokens, xargs }, dir, root, depth, P = POSIX_PATHS) {
  const [cmd, ...rest] = tokens;
  const base = cmdName(cmd, P.win);
  if (base === 'sudo' || base === 'doas') return base;
  if (/^mkfs/.test(base)) return 'mkfs';
  if (['shutdown', 'reboot', 'halt', 'poweroff'].includes(base)) return base;
  if (base === 'dd' && rest.some((t) => /^of=\/dev\//.test(t))) return 'dd to a device';
  if (base === 'rm' && rmOutside(rest, dir, root, xargs, P)) return 'rm -r outside the session folder';
  // `bash -c "…"` / `eval "…"`: the string is a command line of its own.
  if (SHELLS.has(base)) {
    const c = rest.findIndex((t) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t));
    if (c >= 0 && rest[c + 1]) return hardToUndoIn(rest[c + 1], dir, root, depth + 1, P);
  }
  if (base === 'eval' && rest.length) return hardToUndoIn(rest.join(' '), dir, root, depth + 1, P);
  if (base === 'gh' || base === 'glab') return codeHostHardToUndo(base, rest);
  if (base === 'az' && cliWords(rest).includes('delete')) return 'az delete';
  if (base === 'git') {
    let j = 0;
    while (j < rest.length && rest[j].startsWith('-')) j += GIT_VALUE_OPTS.has(rest[j]) ? 2 : 1;
    if (rest[j] !== 'push') return null;
    const args = rest.slice(j + 1);
    if (args.some((a) => ['--force', '-f', '--mirror', '--delete', '-d'].includes(a) || a.startsWith('--force-with-lease') || /^-[a-zA-Z]*f/.test(a))) return 'git push --force/--delete';
    if (args.some((a) => /^\+/.test(a) || /^:/.test(a))) return 'git push +ref/:ref';
  }
  return null;
}

/** Each segment in order, following `cd` so a later rm's relative target resolves where the shell then is. */
function hardToUndoIn(text, dir, root, depth = 0, P = POSIX_PATHS) {
  if (depth > 3) return 'nested shells';
  let at = dir;
  for (const seg of segmentsOf(text, P.win)) {
    const words = skipPrefix(seg, P.win);
    if (words.tokens[0] === 'cd') {
      const to = words.tokens.find((t, i) => i > 0 && !t.startsWith('-'));
      const w = to ? P.norm(to) : null;
      at = !to || /^[~$]/.test(to) || to === '-' || P.unknown(w) || !at && !P.isAbsolute(w) ? null : P.resolve(at || '/', w);
      continue;
    }
    const why = hardToUndo(words, at, root, depth, P);
    if (why) return why;
  }
  return null;
}

/**
 * null = allow; else the reason the model reads (and the card shows).
 * @param {string} command
 * @param {{cwd:string, home?:string|null, userHome?:string|null, hostPid?:number, serverPort?:number|null, platform?:string}} ctx
 *   home = the worca home; userHome = the shell's $HOME (what `~` expands to); platform = the shell's OS
 *   (default: Windows rules when cwd is a drive path)
 */
export function checkAskCommand(command, { cwd, home = null, userHome = null, hostPid, serverPort = null, platform = null,
  egressDataDir = process.env.WORCA_EGRESS_DATA_DIR || null } = {}) {
  const win = platform ? platform === 'win32' : DRIVE_PATH.test(cwd || '');
  const P = win ? WIN_PATHS : POSIX_PATHS;
  const raw = String(command ?? '').trim();
  if (!raw) return 'The command is empty.';
  if (/[\r\n]/.test(raw)) return 'Send one line per command: join steps with && or ;, or write a script file first.';
  if (raw.length > COMMAND_MAX_CHARS) return `The command is longer than ${COMMAND_MAX_CHARS} characters.`;
  const kill = evaluateKillCommand(raw, hostPid);
  if (kill) return kill;
  const local = relativize(raw, cwd, win);                      // the session folder is never "protected"
  const namesWorcaHome = !home ? false
    : win && DRIVE_PATH.test(home) ? new RegExp(`(?<![\\w.:\\\\/-])${winPathSource(home.replace(/[\\/]+$/, ''))}`, 'i').test(local)
      : local.includes(home);
  // An egress sidecar data folder set elsewhere than /worca/egress (WORCA_EGRESS_DATA_DIR) is protected the same way.
  const egressDir = typeof egressDataDir === 'string' && egressDataDir.trim().length > 1 ? egressDataDir.trim().replace(/[\\/]+$/, '') : null;
  const namesEgressDir = !!egressDir && local.includes(egressDir);
  if ((win ? PROTECTED_WIN : PROTECTED).some((re) => re.test(local)) || namesWorcaHome || namesEgressDir || namesHomeOnly(local, { cwd, userHome, win })) {
    return 'That command names a protected path (Worca\'s own files or credentials). Ask cannot read or change them.';
  }
  // Matched anywhere (inside `bash -c "…"` or `$(…)` too): gh keeps its OAuth token outside ~/.config/gh (the keychain).
  if (/\bgh\s+auth\s+(?:token\b|status\b[^;&|]*\s(?:-t|--show-token)\b)/.test(raw)) {
    return 'That command prints a GitHub credential (gh auth token). Ask cannot read credentials.';
  }
  if (serverPort && new RegExp(`(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]):${serverPort}\\b`).test(raw)) {
    return "That command calls Worca's own API. Ask uses its tools for Worca, never the HTTP API.";
  }
  const why = hardToUndoIn(local, cwd, cwd, 0, P);
  if (why) return `Hard-to-undo commands are blocked for Ask (${why}). Ask the user to run it in the terminal.`;
  // Last: a system secret folder by path shape (a guard on the chat's commands, not the boundary; see its header).
  if (namesSystemSecretPath(raw, { cwd: win ? '/' : cwd, home: win ? null : userHome, worcaHome: win ? null : home, egressDataDir: egressDir })) {
    return 'That command names a protected path (Worca\'s own files or credentials). Ask cannot read or change them.';
  }
  return null;
}

// What Git Bash and the tools it starts need on Windows (SPAWN_ENV_BASE has PATH/HOME only): none is a secret.
const WIN_ENV = ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'TEMP', 'TMP',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'NUMBER_OF_PROCESSORS'];

/** The env Ask's shells start from: the Ask child's scrub base + the ssh agent, never a model or server token. */
export function askCommandEnv(base = process.env, platform = process.platform) {
  const env = {};
  for (const k of [...SPAWN_ENV_BASE, 'SSH_AUTH_SOCK', ...(platform === 'win32' ? WIN_ENV : [])]) if (typeof base[k] === 'string') env[k] = base[k];
  return env;
}
