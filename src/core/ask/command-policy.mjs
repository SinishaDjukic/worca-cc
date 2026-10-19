// src/core/ask/command-policy.mjs
// Ask agent mode (#574): the rails every command Ask runs passes BEFORE a key is typed. A rail
// against mistakes and naive prompt injection, not a sandbox: obfuscated text can pass it
// (docs/terminal.md "Chat"). Pure: the caller gives the folder, homes, host PID and port.
import { isAbsolute, relative, resolve } from 'node:path';
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
];
// ASK_DENY_RULES anchors these at ~/ only: a project's own .claude/, .docker/, .kube/ and .npmrc are
// ordinary files (every worca worktree has .claude/rules). Refused only under the user's home.
const HOME_ONLY = ['.claude', '.docker', '.kube', '.npmrc'].map(reEsc).join('|');

function namesHomeOnly(text, { cwd, userHome }) {
  const home = userHome && userHome !== '/' ? userHome.replace(/\/+$/, '') : null;
  const roots = ['~', '\\$HOME', '\\$\\{HOME\\}', ...(home ? [reEsc(home)] : [])].join('|');
  if (new RegExp(`(?:${roots})/+(?:${HOME_ONLY})(?![\\w-])`).test(text)) return true;
  // A bare name where the shell is (or goes) in the home: `cd ~ && cat .claude/…`, or a session opened there.
  const atHome = !!home && !!cwd && cwd.replace(/\/+$/, '') === home;
  const cdHome = new RegExp(`(?:^|[;&|(]\\s*)cd(?:\\s+["']?(?:${roots})/*["']?)?\\s*(?:$|[;&|)])`).test(text);
  return (atHome || cdHome) && new RegExp(`(?:^|[\\s/'"=<>])(?:${HOME_ONLY})(?![\\w-])`).test(text);
}

/**
 * Shell-ish words per command segment. Quoted spans are masked while splitting (so `-m "a; rm -rf /"` is one
 * word, never a segment) and then restored WITHOUT their quotes, so a quoted rm/push target is still checked.
 */
function segmentsOf(s) {
  const spans = [];
  const masked = s.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_, a, b) => {
    spans.push(a ?? b.replace(/\\(.)/g, '$1'));
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
function skipPrefix(t) {
  let i = 0; let xargs = false;
  while (i < t.length) {
    if (/^\w+=/.test(t[i])) { i += 1; continue; }
    const w = t[i].split('/').pop();
    if (!WRAPPERS.has(w)) break;
    if (w === 'xargs') xargs = true;
    i += 1;
    while (i < t.length && (t[i].startsWith('-') || /^\d+(?:\.\d+)?[smhd]?$/.test(t[i]))) i += 1;
  }
  return { tokens: t.slice(i), xargs };
}

/** The session folder (and anything under it) becomes `.`/`./x`: a run worktree is itself under the worca home. */
function relativize(text, cwd) {
  if (!cwd || cwd === '/') return text;
  const dir = cwd.replace(/\/+$/, '');
  return text.replace(new RegExp(`${reEsc(dir)}(?=/|$|[\\s'";&|)<>])`, 'g'), '.');
}

/** `dir` = where the shell is when rm runs (null: unknown, after a `cd ~` or `cd $X`); `root` = the session folder. */
function rmOutside(tokens, dir, root, xargs) {
  const flags = tokens.filter((t) => t.startsWith('-'));
  if (!flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive')) return false;
  if (xargs) return true;                                       // targets read from stdin
  return tokens.filter((t) => !t.startsWith('-')).some((t) => {
    if (/^[~$]/.test(t) || t === '/*') return true;               // a bare `*` expands inside the folder: allowed
    if (!dir && !isAbsolute(t)) return true;
    const abs = isAbsolute(t) ? t : resolve(dir, t);
    const rel = relative(root, abs);
    return rel === '' || rel.startsWith('..') || isAbsolute(rel);
  });
}

// git's global options before the subcommand; these take a value as the next word.
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

function hardToUndo({ tokens, xargs }, dir, root, depth) {
  const [cmd, ...rest] = tokens;
  const base = String(cmd || '').split('/').pop();
  if (base === 'sudo' || base === 'doas') return base;
  if (/^mkfs/.test(base)) return 'mkfs';
  if (['shutdown', 'reboot', 'halt', 'poweroff'].includes(base)) return base;
  if (base === 'dd' && rest.some((t) => /^of=\/dev\//.test(t))) return 'dd to a device';
  if (base === 'rm' && rmOutside(rest, dir, root, xargs)) return 'rm -r outside the session folder';
  // `bash -c "…"` / `eval "…"`: the string is a command line of its own.
  if (SHELLS.has(base)) {
    const c = rest.findIndex((t) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t));
    if (c >= 0 && rest[c + 1]) return hardToUndoIn(rest[c + 1], dir, root, depth + 1);
  }
  if (base === 'eval' && rest.length) return hardToUndoIn(rest.join(' '), dir, root, depth + 1);
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
function hardToUndoIn(text, dir, root, depth = 0) {
  if (depth > 3) return 'nested shells';
  let at = dir;
  for (const seg of segmentsOf(text)) {
    const words = skipPrefix(seg);
    if (words.tokens[0] === 'cd') {
      const to = words.tokens.find((t, i) => i > 0 && !t.startsWith('-'));
      at = !to || /^[~$]/.test(to) || to === '-' || !at && !isAbsolute(to) ? null : resolve(at || '/', to);
      continue;
    }
    const why = hardToUndo(words, at, root, depth);
    if (why) return why;
  }
  return null;
}

/**
 * null = allow; else the reason the model reads (and the card shows).
 * @param {string} command
 * @param {{cwd:string, home?:string|null, userHome?:string|null, hostPid?:number, serverPort?:number|null}} ctx
 *   home = the worca home; userHome = the shell's $HOME (what `~` expands to)
 */
export function checkAskCommand(command, { cwd, home = null, userHome = null, hostPid, serverPort = null } = {}) {
  const raw = String(command ?? '').trim();
  if (!raw) return 'The command is empty.';
  if (/[\r\n]/.test(raw)) return 'Send one line per command: join steps with && or ;, or write a script file first.';
  if (raw.length > COMMAND_MAX_CHARS) return `The command is longer than ${COMMAND_MAX_CHARS} characters.`;
  const kill = evaluateKillCommand(raw, hostPid);
  if (kill) return kill;
  const local = relativize(raw, cwd);                           // the session folder is never "protected"
  if (PROTECTED.some((re) => re.test(local)) || (home && local.includes(home)) || namesHomeOnly(local, { cwd, userHome })) {
    return 'That command names a protected path (Worca\'s own files or credentials). Ask cannot read or change them.';
  }
  // Matched anywhere (inside `bash -c "…"` or `$(…)` too): gh keeps its OAuth token outside ~/.config/gh (the keychain).
  if (/\bgh\s+auth\s+(?:token\b|status\b[^;&|]*\s(?:-t|--show-token)\b)/.test(raw)) {
    return 'That command prints a GitHub credential (gh auth token). Ask cannot read credentials.';
  }
  if (serverPort && new RegExp(`(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]):${serverPort}\\b`).test(raw)) {
    return "That command calls Worca's own API. Ask uses its tools for Worca, never the HTTP API.";
  }
  const why = hardToUndoIn(local, cwd, cwd);
  return why ? `Hard-to-undo commands are blocked for Ask (${why}). Ask the user to run it in the terminal.` : null;
}

/** The env Ask's shells start from: the Ask child's scrub base + the ssh agent, never a model or server token. */
export function askCommandEnv(base = process.env) {
  const env = {};
  for (const k of [...SPAWN_ENV_BASE, 'SSH_AUTH_SOCK']) if (typeof base[k] === 'string') env[k] = base[k];
  return env;
}
