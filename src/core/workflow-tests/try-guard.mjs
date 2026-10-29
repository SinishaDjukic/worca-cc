// src/core/workflow-tests/try-guard.mjs
// Nothing leaves a test try (plans/workflow-tests-part3a-plan.md D45, D56). This file is three things:
//   - guardDecision(command): whether a shell command would push, open a pull request or an issue, change a remote,
//     publish a package or send a web request that writes; pure;
//   - the PreToolUse Bash hook every try's agents carry (engines/claude.mjs buildSettingsPayload): a hit is written to the
//     try's connector-calls.ndjson (WORCA_TRY_GUARD_LOG) and denied with exit 2;
//   - the CLI behind the gh / glab / az stand-ins on a try's PATH (try-guard-env.mjs): it writes the call down and answers
//     "Not sent: this is a test." with exit 1.
// Only node: built-ins: the hook runs on every Bash call of every try.
//
// The decision reads a command the way a shell would, closely enough that the usual ways around a word list are seen
// through: wrappers and their options (sudo -u x, env -i K=V, timeout 5, nice -n 5, xargs -n1, stdbuf -oL, …), nested
// shells (bash -lc, sh -ec, cmd /c, powershell -Command; an -EncodedCommand cannot be read and is denied), eval and
// { …; } groups, $( ) and backticks, a git alias for push given with -c, curl's run-together short flags. A heredoc's body is
// data, not commands (only its $( ) and backticks run, when its word is unquoted), unless a shell reads it.
// It is one layer of four: the stand-ins, the git env and the deny rules hold without it (try-guard-env.mjs).
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NOT_SENT_TEXT = 'Not sent: this is a test.';   // = mcp/mock-connector.mjs NOT_SENT (the test pins them equal)
export const TRY_GUARD_LOG_ENV = 'WORCA_TRY_GUARD_LOG';
export const FORGE_CLIS = Object.freeze({ gh: 'GitHub CLI', glab: 'GitLab CLI', az: 'Azure CLI' });
const READ_VERBS = new Set(['view', 'list', 'status', 'diff', 'checks', 'show']);
/** Words that only introduce the command after them. */
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'builtin']);
/** Commands that run the command among their arguments, after options of their own. */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'exec', 'time', 'nohup', 'timeout', 'nice', 'ionice', 'stdbuf', 'xargs', 'setsid', 'chrt', 'taskset']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'mksh', 'fish']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const PUBLISHERS = new Set(['npm', 'yarn', 'pnpm']);
/** Every first word guardDecision acts on: a wrapper's arguments are searched for these. */
const GUARDED = new Set(['git', 'curl', 'wget', 'eval', 'cmd', ...Object.keys(FORGE_CLIS), ...SHELLS, ...POWERSHELLS, ...PUBLISHERS, ...WRAPPERS]);
const GIT_OPT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const SPLIT = new Set([';', '&', '|', '(', ')', '`']);
const WRITE_METHOD_RE = /^(post|put|patch|delete)$/i;
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MAX_DEPTH = 6;
/** curl short options that take a value (d, F, T and X are read before these). */
const CURL_VALUE_SHORT = new Set('AbcCDeEHKmoPQrtuUwxyYz'.split(''));
/** Inside double quotes a backslash escapes only these (bash); elsewhere it stays, as in "C:\Program Files". */
const DQ_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);

/** The $( ) and backtick commands in a text (an unquoted heredoc's body runs them). */
function substitutions(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] === '$' && text[i + 1] === '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < text.length; j += 1) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')') { depth -= 1; if (depth === 0) break; }
      }
      out.push(text.slice(i + 2, j));
      i = j;
      continue;
    }
    if (text[i] === '`') {
      const e = text.indexOf('`', i + 1);
      if (e < 0) break;
      out.push(text.slice(i + 1, e));
      i = e;
    }
  }
  return out;
}

/**
 * A shell line read into commands: `segments` are the words of each command (split at ; & | ( ) ` and newlines outside
 * quotes, quotes removed, `# comments` dropped); `heredocs` are the bodies of `<<WORD` / `<<-WORD` heredocs, which are
 * not commands. The $( ) and backticks of an unquoted heredoc's body are added to `segments` (they run). A heredoc whose
 * end word never comes was no heredoc (`$((1<<2))`): its lines stay commands.
 * @returns {{segments: string[][], heredocs: {body: string, quoted: boolean}[]}}
 */
export function parseShell(command) {
  const segments = [];
  const heredocs = [];
  let words = [];
  let cur = '';
  let has = false;
  let quote = null;
  let pending = [];
  const subs = [];
  const endWord = () => { if (has) words.push(cur); cur = ''; has = false; };
  const endSeg = () => { endWord(); if (words.length) segments.push(words); words = []; };
  const s = String(command ?? '');
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (quote) {
      // "…$(git push)…" and "…`git push`…" run inside double quotes too.
      if (quote === '"' && ((ch === '$' && s[i + 1] === '(') || ch === '`')) {
        const inner = substitutions(s.slice(i))[0];
        if (inner != null) subs.push(inner);
      }
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < n && DQ_ESCAPES.has(s[i + 1])) cur += s[++i];
      else cur += ch;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; i += 1; continue; }
    if (ch === '\\' && i + 1 < n) { if (s[i + 1] !== '\n') { cur += s[i + 1]; has = true; } i += 2; continue; }
    if (ch === '#' && !has) { while (i < n && s[i] !== '\n') i += 1; continue; }
    if (ch === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      endWord();
      let j = i + 2;
      const strip = s[j] === '-';
      if (strip) j += 1;
      while (j < n && (s[j] === ' ' || s[j] === '\t')) j += 1;
      let delim = '';
      let quoted = false;
      while (j < n && !/[\s;&|()<>`]/.test(s[j])) {
        const c = s[j];
        if (c === "'" || c === '"') {
          quoted = true;
          const e = s.indexOf(c, j + 1);
          const stop = e < 0 ? n : e;
          delim += s.slice(j + 1, stop);
          j = stop + 1;
          continue;
        }
        if (c === '\\') { quoted = true; if (j + 1 < n) delim += s[j + 1]; j += 2; continue; }
        delim += c;
        j += 1;
      }
      if (delim) pending.push({ delim, strip, quoted });
      i = j;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      endSeg();
      i += 1;
      if (ch === '\r' && s[i] === '\n') i += 1;
      for (const h of pending) {
        const lines = [];
        let ended = false;
        while (i < n) {
          let e = s.indexOf('\n', i);
          if (e < 0) e = n;
          const line = s.slice(i, e).replace(/\r$/, '');
          i = e + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) { ended = true; break; }
          lines.push(line);
        }
        const body = lines.join('\n');
        if (ended) heredocs.push({ body, quoted: h.quoted });
        else segments.push(...parseShell(body).segments);
      }
      pending = [];
      continue;
    }
    if (SPLIT.has(ch)) { endSeg(); i += 1; continue; }
    if (/\s/.test(ch)) { endWord(); i += 1; continue; }
    cur += ch;
    has = true;
    i += 1;
  }
  endSeg();
  for (const inner of subs) segments.push(...parseShell(inner).segments);
  for (const h of heredocs) if (!h.quoted) for (const inner of substitutions(h.body)) segments.push(...parseShell(inner).segments);
  return { segments, heredocs };
}

/** The words of each command in a shell line (parseShell's segments). */
export const shellSegments = (command) => parseShell(command).segments;

const bin = (w) => String(w).split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
const nonOptions = (args) => args.filter((a) => !String(a).startsWith('-'));
/** "pr create", "issue comment", "repos pr", …: a forge CLI's first two words. */
export const cliTool = (args) => nonOptions(args).slice(0, 2).join(' ');

function gitDecision(args) {
  let i = 0;
  let aliasPush = false;
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i];
    const cv = a === '-c' ? args[i + 1] : (a.startsWith('-c') && a.length > 2 && !a.startsWith('--') ? a.slice(2) : null);
    // `git -c alias.ship=push ship`: an alias given on the command line that pushes.
    if (typeof cv === 'string' && /^alias\./i.test(cv) && /\bpush\b/.test(cv.slice(cv.indexOf('=') + 1))) aliasPush = true;
    i += GIT_OPT_VALUE.has(a) ? 2 : 1;
  }
  const sub = args[i];
  if (sub == null) return null;
  if (sub === 'push') return { server: 'git', tool: 'push', argv: args.slice(i + 1) };
  if ((sub === 'subtree' || sub === 'lfs') && args[i + 1] === 'push') return { server: 'git', tool: `${sub} push`, argv: args.slice(i + 2) };
  if (sub === 'send-email') return { server: 'git', tool: 'send-email', argv: args.slice(i + 1) };
  if (sub === 'remote' && (args[i + 1] === 'add' || args[i + 1] === 'set-url')) return { server: 'git', tool: `remote ${args[i + 1]}`, argv: args.slice(i + 2) };
  if (aliasPush) return { server: 'git', tool: 'push', argv: args.slice(i + 1) };
  return null;
}

function curlWrites(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      if (/^--(data|form|json|upload-file)/.test(a)) return true;
      if (a === '--request') { if (WRITE_METHOD_RE.test(args[i + 1] || '')) return true; i += 1; continue; }
      if (a.startsWith('--request=') && WRITE_METHOD_RE.test(a.slice(10))) return true;
      continue;
    }
    if (!/^-[A-Za-z]/.test(a)) continue;
    // Short flags run together (-sX POST, -sd a=1): read them one by one up to the first that takes a value.
    for (let k = 1; k < a.length; k += 1) {
      const c = a[k];
      if (c === 'd' || c === 'F' || c === 'T') return true;
      if (c === 'X') {
        if (WRITE_METHOD_RE.test(a.slice(k + 1) || args[i + 1] || '')) return true;
        if (k === a.length - 1) i += 1;
        break;
      }
      if (CURL_VALUE_SHORT.has(c)) { if (k === a.length - 1) i += 1; break; }
    }
  }
  return false;
}

function wgetWrites(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (/^--(post-data|post-file|body-data|body-file)/.test(a)) return true;
    if (a === '--method' && WRITE_METHOD_RE.test(args[i + 1] || '')) return true;
    if (a.startsWith('--method=') && WRITE_METHOD_RE.test(a.slice(9))) return true;
  }
  return false;
}

/** A PowerShell option name as written (-Command, -c, -enc, /Command:x), lowercased, or null. */
const psOption = (a) => (/^[-/]/.test(a) ? a.replace(/^[-/]+/, '').split(':')[0].toLowerCase() : null);

/** One command's words (no leading assignment or keyword). */
function commandDecision(w, depth) {
  const b = bin(w[0]);
  const args = w.slice(1);
  if (WRAPPERS.has(b)) return wrapperDecision(b, args, depth);
  if (SHELLS.has(b)) {
    // -c alone or among other one-letter flags (bash -lc, sh -ec): the command is the next word that is no option.
    const k = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    if (k < 0) return null;
    const cmd = args.slice(k + 1).find((a) => !a.startsWith('-'));
    return cmd != null ? guardDecision(cmd, depth + 1) : null;
  }
  if (b === 'cmd') {
    const k = args.findIndex((a) => /^\/[ck]/i.test(a));
    if (k < 0) return null;
    return guardDecision([args[k].slice(2), ...args.slice(k + 1)].join(' '), depth + 1);
  }
  if (POWERSHELLS.has(b)) {
    for (let k = 0; k < args.length; k += 1) {
      const o = psOption(args[k]);
      if (o == null) continue;
      // An encoded command cannot be read here: it is stopped like any other way out.
      if (o === 'e' || o === 'ec' || (o.length >= 2 && 'encodedcommand'.startsWith(o))) return { server: 'PowerShell', tool: 'shell', argv: args, readOnly: false };
      if (o === 'c' || (o.length >= 3 && 'command'.startsWith(o))) return guardDecision(args.slice(k + 1).join(' '), depth + 1);
      if (o === 'f' || (o.length >= 2 && 'file'.startsWith(o))) return null;
    }
    // No -Command: the first word that is no option starts the command (an option's value may come first).
    for (let k = 0; k < args.length; k += 1) {
      if (psOption(args[k]) != null) continue;
      const d = guardDecision(args.slice(k).join(' '), depth + 1);
      if (d) return d;
    }
    return null;
  }
  if (b === 'eval') return guardDecision(args.join(' '), depth + 1);
  if (b === 'git') { const d = gitDecision(args); return d ? { ...d, readOnly: false } : null; }
  if (FORGE_CLIS[b]) return { server: FORGE_CLIS[b], tool: cliTool(args), argv: args, readOnly: READ_VERBS.has(nonOptions(args)[1] || '') };
  // `publish` anywhere among the words: npm --registry x publish, yarn npm publish, pnpm -r publish.
  if (PUBLISHERS.has(b) && nonOptions(args).includes('publish')) return { server: b, tool: 'publish', argv: args, readOnly: false };
  if ((b === 'curl' && curlWrites(args)) || (b === 'wget' && wgetWrites(args))) return { server: 'web', tool: 'request', argv: args, readOnly: false };
  return null;
}

/** A wrapper (sudo -u x …, env -i K=V …, timeout 5 …, xargs -n1 …): every later word that starts a guarded command is
 *  read as one, so an option of the wrapper that takes a value never hides the command. `env -S "…"` is re-read. */
function wrapperDecision(b, args, depth) {
  if (b === 'env') {
    for (let k = 0; k < args.length; k += 1) {
      const a = args[k];
      const v = a === '-S' || a === '--split-string' ? args[k + 1] : a.startsWith('--split-string=') ? a.slice(15) : /^-S./.test(a) ? a.slice(2) : null;
      if (v != null) { const d = guardDecision(v, depth + 1); if (d) return d; }
    }
  }
  for (let j = 0; j < args.length; j += 1) {
    if (!GUARDED.has(bin(args[j]))) continue;
    const d = commandDecision(args.slice(j), depth + 1);
    if (d) return d;
  }
  return null;
}

/** @returns {null | {server: string, tool: string, argv: string[], readOnly: boolean}} */
export function guardDecision(command, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  const { segments, heredocs } = parseShell(command);
  let shellReads = false;
  for (const words of segments) {
    let i = 0;
    while (i < words.length && (ASSIGN_RE.test(words[i]) || KEYWORDS.has(words[i]))) i += 1;
    if (i >= words.length) continue;
    const d = commandDecision(words.slice(i), depth);
    if (d) return d;
    if (words.some((x) => { const b = bin(x); return SHELLS.has(b) || POWERSHELLS.has(b) || b === 'cmd'; })) shellReads = true;
  }
  // `bash <<EOF … EOF`: a shell reads the heredoc, so its body is commands after all.
  if (shellReads) for (const h of heredocs) { const d = guardDecision(h.body, depth + 1); if (d) return d; }
  return null;
}

/** One attempt, as connector-calls.ndjson holds a call ({ts, server, tool, arguments, readOnly}), marked `guard`. */
export function guardEntry(d, command, ts = new Date().toISOString()) {
  return { ts, server: d.server, tool: d.tool,
    arguments: { command: String(command).slice(0, 4000), argv: (d.argv || []).slice(0, 60).map((a) => String(a).slice(0, 2000)) },
    readOnly: !!d.readOnly, guard: true };
}

/** What the agent is told. It starts with the stand-ins' words, so an agent sees the same answer either way. */
export const guardReason = (d) => `${NOT_SENT_TEXT} Worca stopped this ${d.server === 'web' ? 'web request' : `${d.server} ${d.tool}`.trim()}: a test try never sends anything outside Worca.`;

/** Arguments as a Windows program reads its command line (quotes group, \" is a quote, backslashes count before one). */
export function windowsArgv(text) {
  const out = [];
  let cur = '';
  let has = false;
  let quoted = false;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\') {
      let n = 0;
      while (s[i] === '\\') { n += 1; i += 1; }
      if (s[i] === '"') { cur += '\\'.repeat(Math.floor(n / 2)); if (n % 2) { cur += '"'; has = true; continue; } i -= 1; continue; }
      cur += '\\'.repeat(n); has = true; i -= 1; continue;
    }
    if (ch === '"') {
      if (quoted && s[i + 1] === '"') { cur += '"'; i += 1; continue; }
      quoted = !quoted; has = true; continue;
    }
    if (!quoted && (ch === ' ' || ch === '\t')) { if (has) out.push(cur); cur = ''; has = false; continue; }
    cur += ch; has = true;
  }
  if (has) out.push(cur);
  return out;
}

/** The arguments the .cmd stand-in wrote (`rem #<args>#`, echoed into a file), or [] when the file is missing. */
export function argsFromFile(file) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  try { rmSync(file, { force: true }); } catch { /* the .cmd deletes it too */ }
  const a = text.indexOf('#');
  const b = text.lastIndexOf('#');
  return a >= 0 && b > a ? windowsArgv(text.slice(a + 1, b)) : [];
}

function record(entry) {
  const file = process.env[TRY_GUARD_LOG_ENV];
  if (!file) return;
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify(entry)}\n`); } catch { /* the deny still holds */ }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--stand-in') {
    const name = String(argv[1] || '');
    const args = argv[2] === '--args-file' ? argsFromFile(String(argv[3] || '')) : argv.slice(2);
    record(guardEntry({ server: FORGE_CLIS[name] || name, tool: cliTool(args), argv: args, readOnly: READ_VERBS.has(nonOptions(args)[1] || '') },
      [name, ...args].join(' ')));
    process.stderr.write(`${NOT_SENT_TEXT}\n`);
    process.exit(1);
  }
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let command = '';
    try {
      const payload = JSON.parse(raw);
      if (payload?.tool_name !== 'Bash') process.exit(0);
      command = String(payload?.tool_input?.command ?? '');
    } catch { process.exit(0); }   // a malformed payload must not brick Bash; the env layers still hold
    const d = guardDecision(command);
    if (!d) process.exit(0);
    record(guardEntry(d, command));
    process.stderr.write(`${guardReason(d)}\n`);
    process.exit(2);
  });
}
