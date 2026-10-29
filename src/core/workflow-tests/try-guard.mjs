// src/core/workflow-tests/try-guard.mjs
// Nothing leaves a test try (plans/workflow-tests-part3a-plan.md D45, D56). This file is three things:
//   - guardDecision(command): whether a shell command would push, open a pull request or an issue, change a remote,
//     publish a package or send a web request that writes; pure;
//   - the PreToolUse Bash hook every try's agents carry (engines/claude.mjs buildSettingsPayload): a hit is written to the
//     try's connector-calls.ndjson (WORCA_TRY_GUARD_LOG) and denied with exit 2;
//   - the CLI behind the gh / glab / az stand-ins on a try's PATH (try-guard-env.mjs): it writes the call down and answers
//     "Not sent: this is a test." with exit 1.
// Only node: built-ins: the hook runs on every Bash call of every try.
import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NOT_SENT_TEXT = 'Not sent: this is a test.';   // = mcp/mock-connector.mjs NOT_SENT (the test pins them equal)
export const TRY_GUARD_LOG_ENV = 'WORCA_TRY_GUARD_LOG';
export const FORGE_CLIS = Object.freeze({ gh: 'GitHub CLI', glab: 'GitLab CLI', az: 'Azure CLI' });
const READ_VERBS = new Set(['view', 'list', 'status', 'diff', 'checks', 'show']);
const SKIP = new Set(['sudo', 'env', 'command', 'exec', 'time', 'nohup', 'builtin', 'xargs', 'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const GIT_OPT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const PUBLISHERS = new Set(['npm', 'yarn', 'pnpm']);
const SPLIT = new Set([';', '&', '|', '\n', '\r', '(', ')', '`']);
const WRITE_METHOD_RE = /^(post|put|patch|delete)$/i;

/** The words of each command in a shell line: split at ; & | ( ) ` and newlines outside quotes; quotes removed. */
export function shellSegments(command) {
  const out = [];
  let words = [];
  let cur = '';
  let has = false;
  let quote = null;
  const endWord = () => { if (has) words.push(cur); cur = ''; has = false; };
  const endSeg = () => { endWord(); if (words.length) out.push(words); words = []; };
  const s = String(command ?? '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (SPLIT.has(ch)) { endSeg(); continue; }
    if (/\s/.test(ch)) { endWord(); continue; }
    cur += ch;
    has = true;
  }
  endSeg();
  return out;
}

const bin = (w) => basename(String(w)).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
const nonOptions = (args) => args.filter((a) => !String(a).startsWith('-'));
/** "pr create", "issue comment", "repos pr", …: a forge CLI's first two words. */
export const cliTool = (args) => nonOptions(args).slice(0, 2).join(' ');

function gitDecision(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += GIT_OPT_VALUE.has(args[i]) ? 2 : 1;
  const sub = args[i];
  if (sub === 'push') return { server: 'git', tool: 'push', argv: args.slice(i + 1) };
  if (sub === 'send-email') return { server: 'git', tool: 'send-email', argv: args.slice(i + 1) };
  if (sub === 'remote' && (args[i + 1] === 'add' || args[i + 1] === 'set-url')) return { server: 'git', tool: `remote ${args[i + 1]}`, argv: args.slice(i + 2) };
  return null;
}

function curlWrites(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-X' || a === '--request') { if (WRITE_METHOD_RE.test(args[i + 1] || '')) return true; continue; }
    if (/^-X./.test(a) && WRITE_METHOD_RE.test(a.slice(2))) return true;
    if (a.startsWith('--request=') && WRITE_METHOD_RE.test(a.slice(10))) return true;
    if (/^-[dFT]/.test(a) || /^--(data|form|json|upload-file)/.test(a)) return true;
  }
  return false;
}
const wgetWrites = (args) => args.some((a) => /^--(post-data|post-file|body-data|body-file)/.test(a)
  || (a.startsWith('--method=') && WRITE_METHOD_RE.test(a.slice(9))));

/** @returns {null | {server: string, tool: string, argv: string[], readOnly: boolean}} */
export function guardDecision(command, depth = 0) {
  for (const words of shellSegments(command)) {
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || SKIP.has(words[i]))) i += 1;
    const w = words.slice(i);
    if (!w.length) continue;
    const b = bin(w[0]);
    const args = w.slice(1);
    if (SHELLS.has(b)) {
      const c = args.indexOf('-c');
      if (c >= 0 && args[c + 1] != null && depth < 3) { const d = guardDecision(args[c + 1], depth + 1); if (d) return d; }
      continue;
    }
    if (b === 'git') { const d = gitDecision(args); if (d) return { ...d, readOnly: false }; continue; }
    if (FORGE_CLIS[b]) return { server: FORGE_CLIS[b], tool: cliTool(args), argv: args, readOnly: READ_VERBS.has(nonOptions(args)[1] || '') };
    if (PUBLISHERS.has(b) && nonOptions(args)[0] === 'publish') return { server: b, tool: 'publish', argv: args, readOnly: false };
    if ((b === 'curl' && curlWrites(args)) || (b === 'wget' && wgetWrites(args))) return { server: 'web', tool: 'request', argv: args, readOnly: false };
  }
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
    const args = argv.slice(2);
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
