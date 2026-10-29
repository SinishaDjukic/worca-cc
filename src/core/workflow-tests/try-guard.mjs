// src/core/workflow-tests/try-guard.mjs
// Nothing leaves a test try (plans/workflow-tests-part3a-plan.md D45, D56). This file is three things:
//   - guardDecision(command): whether a shell command would push, open a pull request or an issue, change a remote,
//     publish a package or send a web request that writes; pure;
//   - the PreToolUse hook every try's agents carry on Bash and PowerShell (engines/claude.mjs buildSettingsPayload): a hit
//     is written to the try's connector-calls.ndjson (WORCA_TRY_GUARD_LOG) and denied: with a structured PreToolUse
//     answer (permissionDecision "deny", exit 0) when the harness confirmed the CLI reads one (WORCA_TRY_GUARD_JSON=1), so
//     the agent reads only the reason; else, and whenever that answer cannot be written, stderr and exit 2;
//   - the CLI behind the gh / glab / az stand-ins on a try's PATH (try-guard-env.mjs): it writes the call down and answers
//     "Not sent: this is a test." with exit 1.
// Only node: built-ins: the hook runs on every Bash call of every try.
//
// The decision reads a command the way a shell would, closely enough that the usual ways around a word list are seen
// through: wrappers and their options (sudo -u x, env -i K=V, timeout 5, nice -n 5, xargs -n1, find -exec, watch, flock,
// parallel, script -c, npx, Start-Process, …), nested shells (bash -lc, sh -ec, cmd /c and Git Bash's cmd //c,
// powershell -Command; an -EncodedCommand cannot be read and is denied), WSL (wsl / wsl.exe with its options, wslg, the
// distro launchers' `run` / -c; WSL's own git and gh sit outside every env layer but WSLENV), eval and { …; } groups,
// $( ), backticks and <( ), $'…' quoting, NAME=value set earlier in the line, a git alias for push given with -c, curl's
// run-together short flags, PowerShell's and httpie's web writes. A heredoc's body is data, not commands (only its $( )
// and backticks run, when its word is unquoted), unless a shell reads it; so is a pipe or a here-string, unless a shell
// reads it: then a quoted literal is read as commands, and input that cannot be read is denied when it carries a guarded
// word (always, when WSL reads it). A command nested deeper than MAX_DEPTH, or one whose name is an expansion that carries
// a push / publish / web write, is denied as unreadable.
// It is one layer of four: the stand-ins, the git env and the deny rules hold without it (try-guard-env.mjs).
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NOT_SENT_TEXT = 'Not sent: this is a test.';   // = mcp/mock-connector.mjs NOT_SENT (the test pins them equal)
export const TRY_GUARD_LOG_ENV = 'WORCA_TRY_GUARD_LOG';
/** '1' when the CLI reads a structured PreToolUse deny (try-guard-env.mjs TRY_GUARD_MIN_CLAUDE); else stderr + exit 2. */
export const TRY_GUARD_JSON_ENV = 'WORCA_TRY_GUARD_JSON';
export const FORGE_CLIS = Object.freeze({ gh: 'GitHub CLI', glab: 'GitLab CLI', az: 'Azure CLI' });
/** The agent tools the hook reads: Claude Code's Bash, and its PowerShell tool on Windows. */
export const SHELL_TOOLS = Object.freeze(['Bash', 'PowerShell']);
const READ_VERBS = new Set(['view', 'list', 'status', 'diff', 'checks', 'show']);
/** Words that only introduce the command after them. */
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'builtin']);
/** Commands that run the command among their arguments, after options of their own. */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'exec', 'time', 'nohup', 'timeout', 'nice', 'ionice', 'stdbuf', 'xargs', 'setsid', 'chrt', 'taskset',
  'find', 'watch', 'flock', 'parallel', 'script', 'su', 'npx', 'pnpx', 'bunx', 'start-process', 'saps', 'start',
  'invoke-command', 'icm', 'start-job', 'sajb', 'start-threadjob', 'foreach-object', '%', 'measure-command', 'corepack']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'mksh', 'fish', 'csh', 'tcsh']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const WSLS = new Set(['wsl', 'wslg']);
/** A WSL distro's own launcher (ubuntu.exe, ubuntu2204.exe, debian.exe, …): `run <command>` and `-c <command>` run it. */
const LAUNCHER_RE = /^(ubuntu[0-9.]*|debian|kali|kali-linux|opensuse-[a-z0-9.-]+|sles-[a-z0-9.-]+|fedora[a-z0-9.-]*|almalinux[a-z0-9.-]*|oraclelinux[a-z0-9._-]*|archlinux|alpine|pengwin)$/;
const PS_WEB = new Set(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm']);
const HTTPIE = new Set(['http', 'https', 'xh', 'xhs']);
const NPM_LIKE = new Set(['npm', 'yarn', 'pnpm', 'bun']);
/** `npm run x` (and its aliases) runs the project's own script x: a script named publish is not `npm publish`. */
const RUN_SCRIPT = new Set(['run', 'run-script', 'rum', 'urn']);
/** Publishers beyond npm's family: name → whether these words (no options) publish. */
const PUBLISH_OTHER = {
  cargo: (n) => n.includes('publish'), twine: (n) => n.includes('upload'), gem: (n) => n[0] === 'push',
  poetry: (n) => n.includes('publish'), uv: (n) => n[0] === 'publish', hatch: (n) => n[0] === 'publish', flit: (n) => n[0] === 'publish',
  deno: (n) => n[0] === 'publish', dotnet: (n) => n[0] === 'nuget' && n[1] === 'push',
};
/** `--dry-run` sends nothing (git push, npm / pnpm / yarn / bun publish, cargo, uv and poetry publish). */
const DRY_RUN_OK = new Set([...NPM_LIKE, 'cargo', 'uv', 'poetry']);
const dryRun = (args) => args.some((a) => /^--dry-run(=true)?$/.test(a));
/** Every server name guardDecision gives a publish (guard-calls.mjs lists them as "publish a package"). */
export const PUBLISH_SERVERS = Object.freeze([...NPM_LIKE, ...Object.keys(PUBLISH_OTHER)]);
/** Other registry tools: name → whether these words (no options) send to a registry. */
const IMAGE_OTHER = {
  buildah: (n) => n[0] === 'push', crane: (n) => ['push', 'copy', 'cp'].includes(n[0]), helm: (n) => n[0] === 'push',
  skopeo: (n) => n[0] === 'copy' && /^docker:\/\//.test(n[n.length - 1] || ''),
};
/** Container tools whose push sends an image to a registry (guard-calls.mjs: "push an image"). */
export const IMAGE_SERVERS = Object.freeze(['docker', 'podman', 'nerdctl', ...Object.keys(IMAGE_OTHER)]);
/** Every first word guardDecision acts on: a wrapper's arguments are searched for these. */
const GUARDED = new Set(['git', 'curl', 'wget', 'eval', 'iex', 'invoke-expression', 'cmd', ...Object.keys(FORGE_CLIS), ...SHELLS, ...POWERSHELLS, ...WSLS, ...PS_WEB, ...HTTPIE,
  ...PUBLISH_SERVERS, ...IMAGE_SERVERS, ...WRAPPERS]);
const isGuarded = (b) => GUARDED.has(b) || LAUNCHER_RE.test(b);
const GIT_OPT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const SPLIT = new Set([';', '&', '|', '(', ')']);
/** A request method that only reads; any other method named (POST, PUT, PATCH, DELETE, MERGE, PROPPATCH, …) writes. */
const READ_METHOD_RE = /^(get|head|options|trace|connect|default)$/i;
const isWriteMethod = (v) => { const m = String(v ?? '').trim(); return m !== '' && /^[A-Za-z_-]+$/.test(m) && !READ_METHOD_RE.test(m); };
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
export const MAX_DEPTH = 6;
/** curl short options that take a value (d, F, T and X are read before these). */
const CURL_VALUE_SHORT = new Set('AbcCDeEHKmoPQrtuUwxyYz'.split(''));
/** Inside double quotes a backslash escapes only these (bash); elsewhere it stays, as in "C:\Program Files". */
const DQ_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);
/** A command that can send (in a text we cannot read as commands). */
// Not in a URL (`https://…`, `git://…`): the word must not run on into ':' or '/'.
const GUARD_CMD_RE = /(^|[^\w.:/-])(git|gh|glab|az|curl|wget|npm|yarn|pnpm|bun|npx|corepack|cargo|twine|gem|poetry|docker|podman|http|https|xh|iwr|irm|invoke-webrequest|invoke-restmethod|wsl)(\.exe)?(?=$|[^\w:/-])/i;
/** What a sending command does (push, publish, a pull request, a web write). */
const ACTION_RE = /(^|[^\w-])(push|publish|send-?email|upload)(?=$|[^\w-])|(^|\s)(pr|mr|issue|api|release)\s+[\w-]|(^|[^\w-])(post|put|patch|delete)(?=$|[^\w-])|--data(-binary|-raw|-urlencode|-ascii)?(?![\w-])|--form(?![\w-])|--json(?![\w-])|--method(?![\w-])|(^|\s)-X\s*[A-Za-z]/i;
/** An expansion-named command is unreadable only when its own words push / publish / send mail, or name a method with a URL. */
/** Fix 3: also a forge verb as its first word (`"$GH" pr create`), or a data flag or an httpie write method with a URL. */
const FORGE_VERBS = new Set(['pr', 'mr', 'issue', 'release', 'repo', 'api', 'gist', 'snippet', 'secret', 'variable', 'workflow', 'label']);
const EXPANSION_SENDS = (w) => {
  if (w.some((x) => ['push', 'publish', 'send-email'].includes(x))) return true;
  // The first word, or the second after an option's value (`"$GH" --repo x/y pr create`).
  if (w.filter((x) => !String(x).startsWith('-')).slice(0, 2).some((x) => FORGE_VERBS.has(x))) return true;
  if (!w.some((x) => /^https?:\/\//i.test(x))) return false;
  return w.some((x) => /^(-X.*|--request(=.*)?|-Method(:.*)?|--method(=.*)?)$/i.test(x)
    || /^(-d.*|--data.*|-F|--form(=.*)?|-T|--upload-file(=.*)?|--json(=.*)?)$/.test(x)
    || /^(POST|PUT|PATCH|DELETE)$/.test(x));
};
/** Words a command written as an expansion leaves behind as a command of its own (`` `which git` push ``). */
const ACTION_WORDS = new Set(['push', 'publish', 'send-email', 'upload']);
/** Commands that turn their input into other text: what they hand a shell cannot be read here. */
const DECODERS = new Set(['base64', 'base32', 'basenc', 'xxd', 'od', 'openssl', 'uudecode', 'gunzip', 'zcat', 'gzip', 'bzip2', 'bunzip2', 'bzcat', 'xz', 'unxz', 'xzcat',
  'zstd', 'unzstd', 'rev', 'tr', 'sed', 'awk', 'gawk', 'perl', 'python', 'python3', 'py', 'node', 'ruby', 'php', 'iconv', 'certutil']);
/** .NET calls that send a body from PowerShell. */
const PS_DOTNET_WRITE_RE = /\.(Upload(String|Data|File|Values)(Async|TaskAsync)?|(Post|Put|Patch|Delete|Send)Async)\s*\(/i;

/** The command inside $( ), <( ) or backticks that starts at text[0] (its opening), and where it ends; null unterminated. */
function enclosed(text, i) {
  if (text[i] === '`') {
    const e = text.indexOf('`', i + 1);
    return e < 0 ? null : { inner: text.slice(i + 1, e), end: e + 1 };
  }
  let depth = 0;
  let q = null;
  for (let j = i + 1; j < text.length; j += 1) {
    const c = text[j];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') j += 1; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '\\') { j += 1; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return { inner: text.slice(i + 2, j), end: j + 1 }; }
  }
  return null;
}

/** The $( ) and backtick commands in a text (an unquoted heredoc's body runs them). */
function substitutions(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if ((text[i] === '$' && text[i + 1] === '(') || text[i] === '`') {
      const e = enclosed(text, i);
      if (!e) { if (text[i] === '`') break; out.push(text.slice(i + 2)); break; }
      if (!(text[i] === '$' && e.inner.startsWith('('))) out.push(e.inner);   // $(( )) is arithmetic
      i = e.end - 1;
    }
  }
  return out;
}

const ANSI_C = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
/** bash's $'…': the text between the quotes (from i, just after the opening quote) and where it ends. */
function ansiC(s, i) {
  let out = '';
  while (i < s.length && s[i] !== "'") {
    if (s[i] !== '\\' || i + 1 >= s.length) { out += s[i]; i += 1; continue; }
    const c = s[i + 1];
    let m;
    if (ANSI_C[c] != null) { out += ANSI_C[c]; i += 2; }
    else if ((m = /^x([0-9a-fA-F]{1,2})/.exec(s.slice(i + 1)))) { out += String.fromCharCode(parseInt(m[1], 16)); i += 1 + m[0].length; }
    else if ((m = /^u([0-9a-fA-F]{1,4})/.exec(s.slice(i + 1))) || (m = /^U([0-9a-fA-F]{1,8})/.exec(s.slice(i + 1)))) {
      try { out += String.fromCodePoint(parseInt(m[1], 16)); } catch { /* out of range: nothing */ }
      i += 1 + m[0].length;
    } else if ((m = /^[0-7]{1,3}/.exec(s.slice(i + 1)))) { out += String.fromCharCode(parseInt(m[0], 8) & 0xff); i += 1 + m[0].length; }
    else if (c === 'c' && i + 2 < s.length) { out += String.fromCharCode(s.charCodeAt(i + 2) & 0x1f); i += 3; }
    else { out += `\\${c}`; i += 2; }
  }
  return { text: out, end: i + 1 };
}

/**
 * A shell line read into commands: `segments` are the words of each command (split at ; & | ( ) and newlines outside
 * quotes, quotes removed, $'…' decoded, `# comments` dropped); `heredocs` are the bodies of `<<WORD` / `<<-WORD` heredocs,
 * which are not commands; `meta[i]` says how segment i gets its input: `piped` (a `|` or `|&` from segment i - 1, also
 * across a newline after the `|`), `here` (its `<<<` here-strings) and `procs` (the commands of its `<( )`, whose output
 * it reads as a file named /dev/fd/63). A $( ), <( ) or backtick stays in its word as written (`$(which git)`) and its
 * command is added to `segments` (it runs), as are the $( ) and backticks of an unquoted heredoc's body. A heredoc whose
 * end word never comes was no heredoc (`$((1<<2))`): its lines stay commands.
 * @returns {{segments: string[][], heredocs: {body: string, quoted: boolean}[], meta: {piped: boolean, here: string[], procs: string[]}[]}}
 */
export function parseShell(command) {
  const segments = [];
  const meta = [];
  const heredocs = [];
  let words = [];
  let cur = '';
  let has = false;
  let quote = null;
  let pending = [];
  let piped = false;
  let hereNext = false;
  let here = [];
  let procs = [];
  const subs = [];
  const endWord = () => {
    if (has) { if (hereNext) { here.push(cur); hereNext = false; } else words.push(cur); }
    cur = ''; has = false;
  };
  const endSeg = () => {
    endWord();
    hereNext = false;
    if (words.length) { segments.push(words); meta.push({ piped, here, procs }); piped = false; here = []; procs = []; }
    words = [];
  };
  const merge = (r) => { segments.push(...r.segments); meta.push(...r.meta); heredocs.push(...r.heredocs); };
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
    if (ch === '$' && s[i + 1] === "'") { const a = ansiC(s, i + 2); cur += a.text; has = true; i = a.end; continue; }
    if (ch === '$' && s[i + 1] === '"') { i += 1; continue; }   // $"…" is "…"
    if (ch === "'" || ch === '"') { quote = ch; has = true; i += 1; continue; }
    if (ch === '\\' && i + 1 < n) { if (s[i + 1] !== '\n') { cur += s[i + 1]; has = true; } i += 2; continue; }
    if (ch === '#' && !has) { while (i < n && s[i] !== '\n') i += 1; continue; }
    // $( ), backticks and <( ) >( ): their command runs; the word keeps them as written.
    if ((ch === '$' && s[i + 1] === '(') || ch === '`' || ((ch === '<' || ch === '>') && s[i + 1] === '(')) {
      const e = enclosed(s, ch === '`' ? i : i);
      if (e) {
        const arith = ch === '$' && e.inner.startsWith('(');
        if (!arith) subs.push(e.inner);
        if (ch === '<' || ch === '>') { if (ch === '<') procs.push(e.inner); endWord(); cur = '/dev/fd/63'; }
        else cur += s.slice(i, e.end);
        has = true;
        i = e.end;
        continue;
      }
      if (ch === '`') { cur += ch; has = true; i += 1; continue; }   // PowerShell's escape, or an unclosed one
    }
    if (ch === '<' && s[i + 1] === '<' && s[i + 2] === '<') { endWord(); hereNext = true; i += 3; continue; }
    if (ch === '<' && s[i + 1] === '<') {
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
        else merge(parseShell(body));
      }
      pending = [];
      continue;
    }
    // 2>&1, >&2, &>file: a redirection, not a background &.
    if (ch === '&' && (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>')) { cur += ch; has = true; i += 1; continue; }
    if (ch === '|') {
      endSeg();
      if (s[i + 1] === '|') { piped = false; i += 2; continue; }   // ||
      piped = true;
      i += s[i + 1] === '&' ? 2 : 1;   // | and |&
      continue;
    }
    if (SPLIT.has(ch)) {
      endSeg();
      if (ch !== '(') piped = false;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) { endWord(); i += 1; continue; }
    cur += ch;
    has = true;
    i += 1;
  }
  endSeg();
  for (const inner of subs) merge(parseShell(inner));
  for (const h of heredocs.slice()) if (!h.quoted) for (const inner of substitutions(h.body)) merge(parseShell(inner));
  return { segments, heredocs, meta };
}

/** The words of each command in a shell line (parseShell's segments). */
export const shellSegments = (command) => parseShell(command).segments;

/** A command word's program name: no folder, no .exe/.cmd/.bat/.ps1, no @version (`npx npm@10 publish`). */
const bin = (w) => String(w).split(/[\\/]/).pop().toLowerCase().replace(/(?<=.)@[^@]*$/, '').replace(/\.(exe|cmd|bat|ps1)$/, '');
const nonOptions = (args) => args.filter((a) => !String(a).startsWith('-'));
/** "pr create", "issue comment", "repos pr", …: a forge CLI's first two words. */
export const cliTool = (args) => nonOptions(args).slice(0, 2).join(' ');
/** A word as a POSIX shell would need it quoted to stay one word. */
const shQuote = (w) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(w) ? w : `'${String(w).replaceAll("'", "'\\''")}'`);
/** PowerShell's backtick escapes removed (`n and `t become whitespace), as PowerShell reads them. */
export const stripPsEscapes = (text) => String(text ?? '').replace(/`([\s\S])/g, (_m, c) => ({ n: '\n', t: '\t', r: '\r', 0: '', a: '', b: '', f: '', v: '', e: '' }[c] ?? c));

const deny = (server, tool, label, argv = []) => ({ server, tool, argv, readOnly: false, label });
/** Denied because the guard cannot read what would run. */
const unreadable = (label, argv = []) => deny('shell', 'unreadable', label, argv);
const tooDeep = (argv = []) => deny('shell', 'too deep', 'command, nested too deeply to read', argv);

/** Words run again as a shell line, both as the words they are (quoted again) and as text joined back together
 *  (cmd /c "a & b" reads its text again): a hit in either is a hit. */
function reparse(words, depth, { win = false } = {}) {
  const w = words.filter((x) => x !== '');
  if (!w.length) return null;
  const quoted = w.map(shQuote).join(' ');
  const plain = w.join(' ');
  const texts = [quoted, plain];
  // cmd and PowerShell read a backslash as itself ("C:\Program Files\Git\cmd\git.exe" push), not as an escape.
  if (win && plain.includes('\\')) texts.push(plain.replaceAll('\\', '/'));
  let first = null;
  for (const t of [...new Set(texts)]) {
    const d = guardDecision(t, depth + 1);
    if (d && d.tool !== 'unreadable') return d;   // one that names what it does wins over an unreadable one
    first = first || d;
  }
  return first;
}

/** git push's options that take the next word as their value. */
const GIT_PUSH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
function gitPushDryRun(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--') break;
    if (GIT_PUSH_VALUE.has(a)) { i += 1; continue; }
    if (a === '-n' || /^--dry-run(=true)?$/.test(a)) return true;
  }
  return false;
}

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
  // `git push --dry-run` / `-n` sends nothing; only a word of its own counts, never the value of -o / --repo / ….
  if (sub === 'push') return gitPushDryRun(args.slice(i + 1)) ? null : { server: 'git', tool: 'push', argv: args.slice(i + 1) };
  if ((sub === 'subtree' || sub === 'lfs') && args[i + 1] === 'push') return { server: 'git', tool: `${sub} push`, argv: args.slice(i + 2) };
  if (sub === 'send-email') return { server: 'git', tool: 'send-email', argv: args.slice(i + 1) };
  if (sub === 'remote' && (args[i + 1] === 'add' || args[i + 1] === 'set-url')) return { server: 'git', tool: `remote ${args[i + 1]}`, argv: args.slice(i + 2) };
  if (aliasPush) return { server: 'git', tool: 'push', argv: args.slice(i + 1) };
  // `git $cmd`, `git $(echo push)`: the subcommand is an expansion; it cannot be read.
  if (/[$`]/.test(sub)) return unreadable('git command, whose subcommand Worca cannot read', args);
  return null;
}

function curlWrites(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      if (/^--(data|form|json|upload-file)/.test(a)) return true;
      if (a === '--request') { if (isWriteMethod(args[i + 1])) return true; i += 1; continue; }
      if (a.startsWith('--request=') && isWriteMethod(a.slice(10))) return true;
      continue;
    }
    if (!/^-[A-Za-z]/.test(a)) continue;
    // Short flags run together (-sX POST, -sd a=1): read them one by one up to the first that takes a value.
    for (let k = 1; k < a.length; k += 1) {
      const c = a[k];
      if (c === 'd' || c === 'F' || c === 'T') return true;
      if (c === 'X') {
        if (isWriteMethod(a.slice(k + 1) || args[i + 1])) return true;
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
    if (a === '--method' && isWriteMethod(args[i + 1])) return true;
    if (a.startsWith('--method=') && isWriteMethod(a.slice(9))) return true;
  }
  return false;
}

/** PowerShell options that take a value (-ExecutionPolicy Bypass, -WindowStyle Hidden, …). */
const PS_VALUE_OPTS = new Set(['executionpolicy', 'ep', 'ex', 'windowstyle', 'w', 'outputformat', 'of', 'o', 'inputformat', 'if', 'in', 'version', 'v',
  'configurationname', 'config', 'psconsolefile', 'workingdirectory', 'wd', 'settingsfile', 'settings', 'custompipename']);
/** A PowerShell option name as written (-Command, -c, -enc, /Command:x), lowercased, or null. */
const psOption = (a) => (/^[-/]/.test(a) ? a.replace(/^[-/]+/, '').split(':')[0].toLowerCase() : null);
/** Invoke-WebRequest / Invoke-RestMethod (and PowerShell 5.1's curl / wget aliases of them): a method that writes, or a
 *  body, a file or a form sent. `min` is the shortest abbreviation read (3 for curl / wget, whose own short options
 *  must not be taken for PowerShell's). */
function psWebWrites(args, min = 1) {
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    if (!a.startsWith('-')) continue;
    const o = a.replace(/^-+/, '').split(':')[0].toLowerCase();
    const inline = a.includes(':') ? a.slice(a.indexOf(':') + 1) : null;
    const value = inline ?? args[i + 1];
    if (o.length >= Math.max(min, 2) && 'method'.startsWith(o) && isWriteMethod(value)) return true;
    if (o.length >= Math.max(min, 3) && 'custommethod'.startsWith(o) && isWriteMethod(value)) return true;
    if (o.length >= min && ('body'.startsWith(o) || 'infile'.startsWith(o) || o === 'form')) return true;
  }
  return false;
}

const HTTPIE_VALUE = new Set(['-a', '--auth', '-A', '--auth-type', '-o', '--output', '--session', '--session-read-only', '--verify', '--cert', '--cert-key',
  '--cert-key-pass', '--proxy', '-p', '--print', '-P', '--history-print', '-s', '--style', '--pretty', '--timeout', '--max-redirects', '--max-headers',
  '--format-options', '--response-charset', '--response-mime', '--boundary', '--ssl', '--ciphers', '--default-scheme', '--unix-socket']);
const HTTP_METHODS = /^(get|head|options|trace|connect|post|put|patch|delete|merge|purge|propfind|proppatch|mkcol|copy|move|lock|unlock|search|report)$/i;
/** An httpie request item that sends data (key=value, key:=json, key@file, key=@file, key:=@file); a header (key:value)
 *  or a query parameter (key==value) does not. The separator that comes first decides, as httpie reads it. */
function httpieDataItem(item) {
  let best = null;
  for (const sep of [':=@', '=@', '==', ':=', '=', '@', ':']) {
    const k = item.indexOf(sep);
    if (k > 0 && (best == null || k < best.k || (k === best.k && sep.length > best.sep.length))) best = { k, sep };
  }
  return !!best && !['==', ':'].includes(best.sep);
}
/** httpie / xh: `http POST url`, `http url a=1` (a JSON or form body), `--raw`, or input piped in (httpie sends it). */
function httpieWrites(args, piped) {
  const pos = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--offline') return false;   // builds the request and prints it; nothing is sent
    if (a === '--raw' || a.startsWith('--raw=')) return true;
    if (a.startsWith('-') && a !== '-') { if (HTTPIE_VALUE.has(a)) i += 1; continue; }
    pos.push(a);
  }
  if (!pos.length) return false;
  let k = 0;
  if (pos.length > 1 && HTTP_METHODS.test(pos[0])) { if (isWriteMethod(pos[0])) return true; k = 1; }
  if (pos.slice(k + 1).some(httpieDataItem)) return true;
  return !!piped && !args.includes('--ignore-stdin') && !args.includes('-I');
}

/** WSL: `wsl [-d distro] [-u user] [--cd dir] [--shell-type t] [--system] [--] <command line>` and `wsl -e <program> …`.
 *  Returns the words that run ({words, exec}; none for a bare `wsl`) or null for `wsl --list`, `wsl --shutdown`, …. */
function wslCommand(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '~') continue;   // `wsl ~ …`: start in the home folder; options and the command still follow
    if (a === '--') return { words: args.slice(i + 1), exec: false };
    if (a === '-e' || a === '--exec') return { words: args.slice(i + 1), exec: true };
    if (['-d', '--distribution', '-u', '--user', '--cd', '--shell-type', '--distribution-id'].includes(a)) { i += 1; continue; }
    if (/^--(distribution|user|cd|shell-type|distribution-id)=/.test(a) || a === '--system') continue;
    if (a.startsWith('-')) return null;   // --list, --install, --shutdown, --status, … run no command
    return { words: args.slice(i), exec: false };
  }
  return { words: [], exec: false };   // a bare wsl: a shell that reads its input
}

const DOCKER_GLOBAL_VALUE = new Set(['--context', '-c', '--host', '-H', '--config', '--log-level', '-l', '--tlscacert', '--tlscert', '--tlskey', '--url', '--connection', '--root', '--runroot']);
const COMPOSE_VALUE = new Set(['-f', '--file', '-p', '--project-name', '--env-file', '--profile', '--project-directory', '--ansi', '--progress', '--parallel']);
/** docker / podman: `push`, `image push`, `manifest push`, `compose push`, `build` / `buildx build|bake` with `--push`
 *  or a registry output. Each sends an image to a registry. */
function imagePush(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += DOCKER_GLOBAL_VALUE.has(args[i]) ? 2 : 1;
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === 'push') return !dryRun(rest);
  if ((sub === 'image' || sub === 'manifest') && rest[0] === 'push') return true;
  if (sub === 'compose') {
    let k = 0;
    while (k < rest.length && rest[k].startsWith('-')) k += COMPOSE_VALUE.has(rest[k]) ? 2 : 1;
    return rest[k] === 'push' && !dryRun(rest);
  }
  const builds = sub === 'build' || (sub === 'buildx' && ['build', 'bake'].includes(rest[0]));
  return builds && rest.some((a, k) => a === '--push' || /^--push=(true|1)$/.test(a) || /(^|,)(type=registry|push=true)(,|$)/.test(a.replace(/^--output=/, ''))
    || ((a === '--output' || a === '-o') && /(^|,)(type=registry|push=true)(,|$)/.test(rest[k + 1] || '')));
}

/** Start-Process's own parameters (any unambiguous abbreviation): switches, and those that take a value. */
const SP_SWITCHES = ['wait', 'nonewwindow', 'passthru', 'usenewenvironment', 'loaduserprofile'];
const SP_VALUED = ['verb', 'workingdirectory', 'windowstyle', 'redirectstandardinput', 'redirectstandardoutput', 'redirectstandarderror', 'credential', 'environment'];
/** Start-Process / saps / start: the program (-FilePath or the first word) and its -ArgumentList (or the second word),
 *  each item split at commas ('-C','.','push') and at spaces ("-C . push"). Only Start-Process's own parameter names are
 *  dropped, never a value that starts with '-'. */
function startProcessWords(args) {
  const named = (o, list) => o.length >= 2 && list.filter((n) => n.startsWith(o)).length === 1 && list.find((n) => n.startsWith(o));
  let file = null;
  const list = [];
  const pos = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    const o = /^-[A-Za-z]/.test(a) ? a.slice(1).split(':')[0].toLowerCase() : null;
    const inline = o != null && a.includes(':') ? a.slice(a.indexOf(':') + 1) : null;
    const take = () => (inline != null ? inline : args[++i]);
    if (o != null && (['path', 'pspath', 'lp'].includes(o) || (o.length >= 2 && 'filepath'.startsWith(o)))) { file = take(); continue; }
    if (o != null && (o === 'args' || (o.length >= 2 && 'argumentlist'.startsWith(o)))) { const v = take(); if (v != null) list.push(v); continue; }
    if (o != null && named(o, SP_SWITCHES)) continue;
    if (o != null && named(o, SP_VALUED)) { take(); continue; }
    pos.push(a);
  }
  if (file == null) file = pos.shift() ?? null;
  if (!list.length && pos.length) list.push(...pos);
  if (file == null) return [];
  return [file, ...list.flatMap((x) => String(x).split(',')).flatMap((x) => x.trim().split(/\s+/)).filter(Boolean)];
}

/** The value of option `names` (-c x, --command x, --command=x), or null. */
function optValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    for (const n of names) {
      if (args[i] === n) return args[i + 1] ?? null;
      if (n.startsWith('--') && args[i].startsWith(`${n}=`)) return args[i].slice(n.length + 1);
    }
  }
  return null;
}

/** One command's words (no leading assignment or keyword). `ctx.piped`: its input comes from a pipe. */
function commandDecision(w, depth, ctx = {}) {
  if (depth > MAX_DEPTH) return tooDeep(w);
  const b = bin(w[0]);
  const args = w.slice(1);
  if (b === 'command' && args.some((a) => /^-[pvV]*[vV][pvV]*$/.test(a))) return null;   // command -v / -V: a lookup
  if (b === 'find') {
    // find runs only what follows -exec / -execdir / -ok / -okdir, up to its ; or +.
    for (let k = 0; k < args.length; k += 1) {
      if (!/^-(exec|ok)(dir)?$/.test(args[k])) continue;
      let e = k + 1;
      while (e < args.length && args[e] !== ';' && args[e] !== '+') e += 1;
      const d = args[k + 1] != null ? commandDecision(args.slice(k + 1, e), depth + 1) : null;
      if (d) return d;
    }
    return null;
  }
  if (b === 'script' || b === 'flock' || b === 'su') {
    // -c, also run together with other one-letter flags (script -qc), or --command.
    const k = args.findIndex((a) => /^-[A-Za-z]*c$/.test(a));
    const c = k >= 0 ? (args[k + 1] ?? null) : optValue(args, ['--command']);
    if (c != null) { const d = guardDecision(c, depth + 1); if (d) return d; }
    if (b === 'su') return null;
  }
  if (b === 'watch' || b === 'parallel') {
    // Both hand their words to a shell as one line: any tail of them may be that line.
    for (let k = 0; k < args.length; k += 1) { const d = reparse(args.slice(k), depth); if (d) return d; }
  }
  if (b === 'start-process' || b === 'saps' || b === 'start') {
    // Start-Process git -ArgumentList "-C . push" / '-C','.','push': the program and its argument list are one command.
    const words = startProcessWords(args);
    if (words.length) {
      const d = commandDecision(words, depth + 1) || reparse(words, depth, { win: true });
      if (d) return d;
    }
  }
  if (WRAPPERS.has(b)) return wrapperDecision(b, args, depth, ctx);
  if (SHELLS.has(b)) {
    // -c alone or among other one-letter flags (bash -lc, sh -ec): the command is the next word that is no option.
    const k = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    const long = optValue(args, ['--command']);
    if (long != null) return guardDecision(long, depth + 1);
    if (k < 0) return null;
    const cmd = args.slice(k + 1).find((a) => !a.startsWith('-'));
    return cmd != null ? guardDecision(cmd, depth + 1) : null;
  }
  if (b === 'cmd') {
    // cmd /c, /k, and Git Bash's //c (MSYS turns it into /c).
    const k = args.findIndex((a) => /^\/\/?[ck]/i.test(a));
    if (k < 0) return null;
    const first = args[k].replace(/^\/\/?[ck]/i, '');
    return reparse([first, ...args.slice(k + 1)], depth, { win: true });
  }
  if (POWERSHELLS.has(b)) {
    if (PS_DOTNET_WRITE_RE.test(args.join(' '))) return { server: 'web', tool: 'request', argv: args, readOnly: false };
    for (let k = 0; k < args.length; k += 1) {
      const o = psOption(args[k]);
      if (o == null) continue;
      // An encoded command cannot be read here: it is stopped like any other way out.
      if (o === 'e' || o === 'ec' || (o.length >= 2 && 'encodedcommand'.startsWith(o))) return deny('PowerShell', 'shell', 'PowerShell encoded command, which Worca cannot read', args);
      if (o === 'c' || (o.length >= 3 && 'command'.startsWith(o))) return psText(args.slice(k + 1), depth);
      if (o === 'f' || (o.length >= 2 && 'file'.startsWith(o))) return null;
    }
    // No -Command: the first word that is no option starts the command (an option's value may come first).
    for (let k = 0; k < args.length; k += 1) {
      if (psOption(args[k]) != null) continue;
      const d = psText(args.slice(k), depth);
      if (d) return d;
    }
    return null;
  }
  if (WSLS.has(b)) {
    const c = wslCommand(args);
    if (!c || !c.words.length) return null;
    return c.exec ? commandDecision(c.words, depth + 1) || reparse(c.words, depth) : reparse(c.words, depth);
  }
  if (LAUNCHER_RE.test(b)) return args[0] === 'run' || args[0] === '-c' ? reparse(args.slice(1), depth) : null;
  if (b === 'eval' || b === 'iex' || b === 'invoke-expression') return reparse(args, depth);
  if (b === 'git') { const d = gitDecision(args); return d ? { ...d, readOnly: false } : null; }
  if (FORGE_CLIS[b]) return { server: FORGE_CLIS[b], tool: cliTool(args), argv: args, readOnly: READ_VERBS.has(nonOptions(args)[1] || '') };
  if (NPM_LIKE.has(b)) {
    // `publish` anywhere among the words (npm --registry x publish, yarn npm publish, pnpm -r publish), unless the
    // command is `npm run …`: that runs the project's own script, whatever its name.
    const n = nonOptions(args);
    if (n.includes('publish') && !RUN_SCRIPT.has(n[0]) && !dryRun(args)) return { server: b, tool: 'publish', argv: args, readOnly: false };
    return null;
  }
  if (PUBLISH_OTHER[b] && PUBLISH_OTHER[b](nonOptions(args)) && !(DRY_RUN_OK.has(b) && dryRun(args))) return { server: b, tool: 'publish', argv: args, readOnly: false };
  if (IMAGE_SERVERS.includes(b) && (IMAGE_OTHER[b] ? IMAGE_OTHER[b](nonOptions(args)) : imagePush(args))) return { server: b, tool: 'push', argv: args, readOnly: false };
  const web = (b === 'curl' && (curlWrites(args) || psWebWrites(args, 3)))
    || (b === 'wget' && (wgetWrites(args) || psWebWrites(args, 3)))
    || (PS_WEB.has(b) && psWebWrites(args))
    || (HTTPIE.has(b) && httpieWrites(args, ctx.piped));
  if (web) return { server: 'web', tool: 'request', argv: args, readOnly: false };
  return null;
}

/** PowerShell text (-Command's words, or the PowerShell tool's command): read as written and with its backtick escapes
 *  removed; a .NET upload is a web write. */
function psText(words, depth) {
  const text = words.join(' ');
  if (PS_DOTNET_WRITE_RE.test(text)) return { server: 'web', tool: 'request', argv: words, readOnly: false };
  // As PowerShell reads it first (escapes gone, backslashes literal), then a script block's body ({ git push }, given to
  // Invoke-Command, ForEach-Object, a variable, …) as commands too, then the words as a POSIX shell would read them.
  // PowerShell arrays (@("push","origin"), @('-C','.','push')) read as their items.
  const stripped = stripPsEscapes(text).replaceAll('\\', '/').replace(/@\(([^()]*)\)/g, ' $1 ');
  const blocks = stripped.replace(/[{}]/g, ' ; ');
  const reads = [() => (stripped !== text ? guardDecision(stripped, depth + 1) : null),
    () => (blocks !== stripped ? guardDecision(blocks, depth + 1) : null), () => reparse(words, depth, { win: true })];
  let first = null;
  for (const read of reads) {
    const d = read();
    if (d && d.tool !== 'unreadable') return d;   // one that names what it does wins over an unreadable one
    first = first || d;
  }
  return first;
}

/** A wrapper (sudo -u x …, env -i K=V …, timeout 5 …, xargs -n1 …): every later word that starts a guarded command is
 *  read as one, so an option of the wrapper that takes a value never hides the command. `env -S "…"` is re-read. */
function wrapperDecision(b, args, depth, ctx) {
  if (b === 'env') {
    for (let k = 0; k < args.length; k += 1) {
      const a = args[k];
      const v = a === '-S' || a === '--split-string' ? args[k + 1] : a.startsWith('--split-string=') ? a.slice(15) : /^-S./.test(a) ? a.slice(2) : null;
      if (v != null) { const d = guardDecision(v, depth + 1); if (d) return d; }
    }
  }
  for (let j = 0; j < args.length; j += 1) {
    if (!isGuarded(bin(args[j]))) continue;
    // xargs adds the words it reads to the command: `echo push | xargs git` runs git push.
    const extra = b === 'xargs' && ctx.input?.text != null ? ctx.input.text.split(/\s+/).filter(Boolean) : [];
    const d = commandDecision([...args.slice(j), ...extra], depth + 1, ctx);
    if (d) return d;
    if (b === 'xargs' && ctx.input && ctx.input.text == null && ACTION_RE.test(ctx.input.raw)) return unreadable('command, which hands xargs words Worca cannot read', args);
  }
  return null;
}

const leading = (words) => { let i = 0; while (i < words.length && (ASSIGN_RE.test(words[i]) || KEYWORDS.has(words[i]))) i += 1; return i; };

/** Whether a command reads commands from its input: a shell with no -c and no script (or -s, -, /dev/stdin), PowerShell
 *  with no -Command or `-Command -`, cmd with no /c, `source /dev/stdin`, a bare WSL or distro launcher. Wrappers in front
 *  are looked through. Returns 'wsl' when WSL reads it, 'shell' for any other shell, else null. */
function stdinReader(words, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  const w = words.slice(leading(words));
  if (!w.length) return null;
  const b = bin(w[0]);
  const args = w.slice(1);
  const stdinFile = (a) => a === '-' || a === '/dev/stdin' || a === '/dev/fd/0' || a === '/dev/fd/63';
  if (SHELLS.has(b)) {
    if (args.some((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a)) || optValue(args, ['--command']) != null) return null;
    if (args.some((a) => /^-[A-Za-z]*s[A-Za-z]*$/.test(a))) return 'shell';
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '-o' || args[i] === '+o' || args[i] === '--rcfile' || args[i] === '--init-file') { i += 1; continue; }
      if (args[i].startsWith('-') && args[i] !== '-') continue;
      return stdinFile(args[i]) ? 'shell' : null;
    }
    return 'shell';
  }
  if ((b === 'source' || b === '.') && stdinFile(args[0])) return 'shell';
  if (b === 'cmd') return args.some((a) => /^\/\/?[ck]/i.test(a)) ? null : 'shell';
  if (POWERSHELLS.has(b)) {
    for (let k = 0; k < args.length; k += 1) {
      const o = psOption(args[k]);
      if (o == null) return null;   // an inline command
      if (PS_VALUE_OPTS.has(o)) { k += 1; continue; }
      if (o === 'c' || (o.length >= 3 && 'command'.startsWith(o)) || o === 'f' || (o.length >= 2 && 'file'.startsWith(o))) return args[k + 1] === '-' ? 'shell' : null;
      if (o === 'e' || o === 'ec' || (o.length >= 2 && 'encodedcommand'.startsWith(o))) return null;
    }
    return 'shell';
  }
  if (b === 'iex' || b === 'invoke-expression') return args.length ? null : 'shell';
  if (WSLS.has(b)) {
    const c = wslCommand(args);
    if (!c) return null;
    if (!c.words.length) return 'wsl';
    return stdinReader(c.words, depth + 1) ? 'wsl' : null;
  }
  if (LAUNCHER_RE.test(b)) {
    if (!args.length) return 'wsl';
    return (args[0] === 'run' || args[0] === '-c') && args.length > 1 && stdinReader(args.slice(1), depth + 1) ? 'wsl' : null;
  }
  if (WRAPPERS.has(b) && b !== 'xargs' && b !== 'find') {
    for (let j = 0; j < args.length; j += 1) {
      const bj = bin(args[j]);
      if (SHELLS.has(bj) || POWERSHELLS.has(bj) || WSLS.has(bj) || bj === 'cmd' || LAUNCHER_RE.test(bj) || bj === 'source') {
        const r = stdinReader(args.slice(j), depth + 1);
        if (r) return r;
      }
    }
  }
  return null;
}

/** The text a command writes, when it is a literal the guard can read (echo "…", printf '…', a lone quoted string,
 *  anything given a here-string), else null. */
function literalOf(words, m) {
  if (m && m.here.length) return m.here.some((h) => /[$`]/.test(h)) ? null : m.here.join('\n');
  const w = words.slice(leading(words));
  if (!w.length) return null;
  const b = bin(w[0]);
  let args = w.slice(1);
  if (w.length === 1 && /\s/.test(w[0])) return /[$`]/.test(w[0]) ? null : w[0];   // PowerShell: "git push" | powershell -Command -
  if (b === 'echo' || b === 'write-output' || b === 'write') {
    let escapes = false;
    while (args.length && /^-[neE]+$/.test(args[0])) { if (args[0].includes('e')) escapes = true; args = args.slice(1); }
    const text = args.join(' ');
    if (/[$`]/.test(text) || (escapes && text.includes('\\'))) return null;
    return text;
  }
  if (b === 'printf') {
    const [fmt = '', ...rest] = args;
    if (/[$`]/.test(args.join(' ')) || /\\[0-7xuUc]|%[^s%]/.test(fmt)) return null;
    let k = 0;
    return fmt.replace(/%s|%%/g, (x) => (x === '%%' ? '%' : (rest[k++] ?? ''))).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  }
  return null;
}

/** \x, octal (\0nnn for echo, \nnn for printf), \u / \U and \c: escapes that hide what a text says. */
const ENCODED_RE = /\\(x[0-9a-fA-F]|[0-7]|u[0-9a-fA-F]|U[0-9a-fA-F]|c)/;
/** A text's escapes decoded as bash's echo -e (`echoStyle`, octal as \0nnn) or printf's format (octal as \nnn) does;
 *  `stop` after \c (nothing more is written). */
function decodeEscapes(s, echoStyle) {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '\\' || i + 1 >= s.length) { out += s[i]; continue; }
    const r = s.slice(i + 1);
    let m;
    if (r[0] === 'c') return { text: out, stop: true };
    if ((m = /^x([0-9a-fA-F]{1,2})/.exec(r))) out += String.fromCharCode(parseInt(m[1], 16));
    else if ((m = /^u([0-9a-fA-F]{1,4})/.exec(r)) || (m = /^U([0-9a-fA-F]{1,8})/.exec(r))) { try { out += String.fromCodePoint(parseInt(m[1], 16)); } catch { /* out of range */ } }
    else if ((m = (echoStyle ? /^0([0-7]{0,3})/ : /^([0-7]{1,3})/).exec(r))) out += String.fromCharCode(parseInt(m[1] || '0', 8) & 0xff);
    else if (ANSI_C[r[0]] != null) { out += ANSI_C[r[0]]; m = [r[0]]; }
    else { out += `\\${r[0]}`; m = [r[0]]; }
    i += m[0].length;
  }
  return { text: out, stop: false };
}
/** What `echo -e …` or `printf …` writes when it hides text behind \x / octal / \u / \c escapes (in printf's format or
 *  its %b arguments), decoded; null when it carries none (plain text is literalOf's) or is neither. */
function encodedLiteral(words) {
  const w = words.slice(leading(words));
  const b = bin(w[0] ?? '');
  let args = w.slice(1);
  if (b === 'echo') {
    let escapes = false;
    while (args.length && /^-[neE]+$/.test(args[0])) { if (args[0].includes('e')) escapes = true; args = args.slice(1); }
    const text = args.join(' ');
    return escapes && ENCODED_RE.test(text) ? decodeEscapes(text, true).text : null;
  }
  if (b !== 'printf') return null;
  const [fmt = '', ...rest] = args;
  if (!ENCODED_RE.test(fmt) && !(fmt.includes('%b') && rest.some((a) => ENCODED_RE.test(a)))) return null;
  let out = '';
  let k = 0;
  for (const part of fmt.split(/(%[-+ #0-9.]*[%sbdiouxXfeEgGc])/)) {
    if (/^%.*%$/.test(part)) { out += '%'; continue; }
    if (/^%.*b$/.test(part)) { const r = decodeEscapes(rest[k++] ?? '', true); out += r.text; if (r.stop) return out; continue; }
    if (part.startsWith('%') && part.length > 1) { out += rest[k++] ?? ''; continue; }
    const r = decodeEscapes(part, false);
    out += r.text;
    if (r.stop) return out;
  }
  return out;
}

/** The input a shell-reading command gets (its here-strings, its <( ), the pipeline before it): a hit inside, or a deny
 *  when it cannot be read and carries a guarded word, an action or a decoder (always, when WSL reads it). */
function inputDecision(segs, metas, idx, kind, depth) {
  const m = metas[idx];
  const sources = [];
  for (const h of m.here) sources.push({ text: /[$`]/.test(h) ? null : h, raw: h, decoded: false });
  for (const p of m.procs) {
    const r = parseShell(p);
    sources.push(chainSource(r.segments, r.meta, 0, r.segments.length));
  }
  if (m.piped) {
    let start = idx - 1;
    while (start > 0 && metas[start].piped) start -= 1;
    sources.push(chainSource(segs, metas, start, idx));
  }
  for (const src of sources) {
    if (src.text != null) {
      const d = guardDecision(src.text, depth + 1);
      if (d) return d;
      // Escape-encoded text into a shell: decoded and read above; with nothing found, still denied (it was hidden).
      if (src.encoded) return unreadable('command, which hands a shell escape-encoded input', [src.raw]);
      continue;
    }
    if (kind === 'wsl') return unreadable('command, which hands WSL input Worca cannot read', [src.raw]);
    if (src.decoded || GUARD_CMD_RE.test(src.raw) || ACTION_RE.test(src.raw)) return unreadable('command, which hands a shell input Worca cannot read', [src.raw]);
  }
  return null;
}
/** The text segments [from, to) hand on: a literal producer read through `cat` / `tee` (nothing that changes text). */
function chainSource(segs, metas, from, to) {
  const raw = segs.slice(from, to).map((w) => w.join(' ')).concat(metas.slice(from, to).flatMap((x) => x.here)).join(' | ');
  const decoded = segs.slice(from, to).some((w) => DECODERS.has(bin(w[leading(w)] ?? '')));
  const passThrough = segs.slice(from + 1, to).every((w) => ['cat', 'tee'].includes(bin(w[leading(w)] ?? '')) && w.slice(leading(w) + 1).every((a) => bin(w[leading(w)]) === 'tee' || a === '-'));
  let text = from < to && passThrough ? literalOf(segs[from], metas[from]) : null;
  let encoded = false;
  if (text == null && from < to && passThrough) { const e = encodedLiteral(segs[from]); if (e != null) { text = e; encoded = true; } }
  return { text, raw, decoded: text == null && decoded, encoded };
}

/** NAME=value words set earlier in the line ($NAME and ${NAME} are read with them); `export`/`declare`/… too. */
function substitute(segments) {
  const vars = new Map();
  const sub = (w) => (/\$/.test(w) ? w.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b2) => (vars.has(a || b2) ? vars.get(a || b2) : m)) : w);
  return segments.map((words) => {
    const out = words.map(sub);
    let i = 0;
    if (['export', 'declare', 'local', 'readonly', 'typeset'].includes(out[0])) i = 1;
    for (; i < out.length && ASSIGN_RE.test(out[i]); i += 1) { const e = out[i].indexOf('='); vars.set(out[i].slice(0, e), out[i].slice(e + 1)); }
    return out;
  });
}

/** @returns {null | {server: string, tool: string, argv: string[], readOnly: boolean, label?: string}} */
export function guardDecision(command, depth = 0) {
  if (depth > MAX_DEPTH) return tooDeep([String(command ?? '').slice(0, 200)]);
  const parsed = parseShell(command);
  const { heredocs, meta } = parsed;
  const segments = substitute(parsed.segments);
  const text = String(command ?? '');
  let shellReads = false;
  let fallback = null;
  for (let s = 0; s < segments.length; s += 1) {
    const words = segments[s];
    const i = leading(words);
    if (i >= words.length) continue;
    const w = words.slice(i);
    let input = null;
    if (meta[s].piped) { let start = s - 1; while (start > 0 && meta[start].piped) start -= 1; input = chainSource(segments, meta, start, s); }
    const d = commandDecision(w, depth, { piped: meta[s].piped, input });
    if (d) return d;
    // A command whose name is an expansion (`$(which git) push`, `"$G" push`): unreadable when its own words push,
    // publish or send mail, or name a method with a URL. A bare `push` / `publish` as a command is what is left of
    // `` `which git` push `` once split: unreadable when a sending command is in the line.
    // Kept as a fallback: a command later in the line that can be read names what it does better.
    if (/[$`]/.test(w[0])) {
      if (!fallback && EXPANSION_SENDS(w.slice(1))) fallback = unreadable('command, whose name Worca cannot read', w);
    } else if (!fallback && ACTION_WORDS.has(w[0]) && GUARD_CMD_RE.test(text)) fallback = unreadable('command, whose name Worca cannot read', w);
    const kind = stdinReader(words);
    if (kind && (meta[s].piped || meta[s].here.length || meta[s].procs.length)) {
      const di = inputDecision(segments, meta, s, kind, depth);
      if (di && di.tool !== 'unreadable') return di;
      if (di && !fallback) fallback = di;
    }
    if (words.some((x) => { const b = bin(x); return SHELLS.has(b) || POWERSHELLS.has(b) || b === 'cmd' || WSLS.has(b) || LAUNCHER_RE.test(b); })) shellReads = true;
  }
  // `bash <<EOF … EOF`: a shell reads the heredoc, so its body is commands after all.
  if (shellReads) for (const h of heredocs) { const d = guardDecision(h.body, depth + 1); if (d) return d; }
  return fallback;
}

/** The PowerShell tool's command (Claude Code on Windows): PowerShell text. */
export const psToolDecision = (command) => psText([String(command ?? '')], -1);

/** One attempt, as connector-calls.ndjson holds a call ({ts, server, tool, arguments, readOnly}), marked `guard`. */
export function guardEntry(d, command, ts = new Date().toISOString()) {
  return { ts, server: d.server, tool: d.tool,
    arguments: { command: String(command).slice(0, 4000), argv: (d.argv || []).slice(0, 60).map((a) => String(a).slice(0, 2000)) },
    readOnly: !!d.readOnly, guard: true };
}

/** What the agent is told. It starts with the stand-ins' words, so an agent sees the same answer either way. */
export const guardReason = (d) => `${NOT_SENT_TEXT} Worca stopped this ${d.label || (d.server === 'web' ? 'web request' : `${d.server} ${d.tool}`.trim())}: a test try never sends anything outside Worca.`;

/** The hook's answer to Claude Code (PreToolUse, exit 0): a deny with the reason, which is all the agent reads. */
export const hookDenyOutput = (d) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: guardReason(d) } });


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

/**
 * The hook's deny. With WORCA_TRY_GUARD_JSON=1 (set by the harness only for a Claude Code at or above
 * TRY_GUARD_MIN_CLAUDE, try-guard-env.mjs) a structured PreToolUse answer on stdout and exit 0: the agent reads the reason
 * alone. Otherwise, and whenever that write fails, the reason on stderr and exit 2, which every Claude Code reads as a
 * block. A write is waited for before the exit (a pipe write on Windows is asynchronous).
 */
export function answerDeny(d, { json = process.env[TRY_GUARD_JSON_ENV] === '1', out = process.stdout, err = process.stderr, exit = (c) => process.exit(c) } = {}) {
  let done = false;
  const finish = (code) => { if (!done) { done = true; exit(code); } };
  const block = () => {
    if (done) return;
    try { err.write(`${guardReason(d)}\n`, () => finish(2)); } catch { finish(2); }
  };
  if (!json) { block(); return; }
  try {
    out.once?.('error', block);
    out.write(`${JSON.stringify(hookDenyOutput(d))}\n`, (e) => (e ? block() : finish(0)));
  } catch { block(); }
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
    let tool = '';
    try {
      const payload = JSON.parse(raw);
      tool = String(payload?.tool_name ?? '');
      if (!SHELL_TOOLS.includes(tool)) process.exit(0);
      command = String(payload?.tool_input?.command ?? '');
    } catch { process.exit(0); }   // a malformed payload must not brick Bash; the env layers still hold
    let d;
    try { d = tool === 'PowerShell' ? psToolDecision(command) : guardDecision(command); }
    catch { d = { server: 'shell', tool: 'unreadable', argv: [], readOnly: false, label: 'command, which Worca could not read' }; }   // a guard that fails denies
    if (!d) process.exit(0);
    // From here on nothing may end in an allow: a crash (exit 1) is a non-blocking hook error to Claude Code.
    process.on('uncaughtException', () => { try { process.stderr.write(`${guardReason(d)}\n`); } finally { process.exit(2); } });
    record(guardEntry(d, command));
    answerDeny(d);
  });
}
