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
// The decision is try-guard-decision.mjs (how it reads a command: there), over the shell reader try-guard-shell.mjs; this
// file keeps the hook, the stand-ins' CLI and the answers, and re-exports both modules' public names. Only node: built-ins
// and those two siblings: the hook runs on every Bash call of every try.
// It is one layer of four: the stand-ins, the git env and the deny rules hold without it (try-guard-env.mjs).
import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FORGE_CLIS, READ_VERBS, guardDecision, psToolDecision } from './try-guard-decision.mjs';
import { nonOptions, cliTool } from './try-guard-shell.mjs';
export { FORGE_CLIS, PUBLISH_SERVERS, IMAGE_SERVERS, MAX_DEPTH, guardDecision, psToolDecision } from './try-guard-decision.mjs';
export { parseShell, shellSegments, cliTool, stripPsEscapes } from './try-guard-shell.mjs';

export const NOT_SENT_TEXT = 'Not sent: this is a test.';   // = mcp/mock-connector.mjs NOT_SENT (the test pins them equal)
export const TRY_GUARD_LOG_ENV = 'WORCA_TRY_GUARD_LOG';
/** '1' when the CLI reads a structured PreToolUse deny (try-guard-env.mjs TRY_GUARD_MIN_CLAUDE); else stderr + exit 2. */
export const TRY_GUARD_JSON_ENV = 'WORCA_TRY_GUARD_JSON';
/** The agent tools the hook reads: Claude Code's Bash, and its PowerShell tool on Windows. */
export const SHELL_TOOLS = Object.freeze(['Bash', 'PowerShell']);

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
/** Whether node was started with this file. Compared by realpath (final review): node loads the main module from its
 *  realpath, so a path through a symlink or junction (a linked install) would otherwise read as "not main" and the hook
 *  would allow everything. */
function startedAsMain() {
  const arg = process.argv[1];
  if (!arg) return false;
  if (import.meta.url === pathToFileURL(arg).href) return true;
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const real = process.platform === 'win32' ? realpathSync.native : realpathSync;   // round 7: 8.3 short names too
  try { return fold(real(arg)) === fold(real(fileURLToPath(import.meta.url))); } catch { return false; }
}
const isMain = startedAsMain();
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
