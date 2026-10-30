#!/usr/bin/env node
// S3 (session-groups plan, Task 4): do children follow the host's --allowedTools / --tools, worca's deny rules and
// the host guard, and can a PreToolUse hook tell the main thread from a sub-agent? Local CLI and the Docker pin.
// Owner-run: WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s3-child-permissions.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClaudeArgs } from '../../../src/core/claude-runner.mjs';
import { CLIS, childCall, cliText, isMain, spikeContext, summarize, toolResult, verdict } from './lib.mjs';

const DENY = 'Bash(echo s3-denied*)';
const GUARD_RE = /host guard: blocked/;                             // src/core/host-guard.mjs evaluateKillCommand
// A deny rule's refusal (CLI 2.1.293–2.1.308): `Permission to use Bash with command <cmd> has been denied.`. Anchored, it
// matches none of the no-grant wordings (`This command requires approval`, `Claude requested permissions to use …`,
// the don't-ask and `IMPORTANT:` variants), a hook block (`PreToolUse:Bash hook error: …`) or a failed command.
const DENY_RE = /^Permission to use [\w.-]+ (?:with (?:command )?[\s\S]+ )?has been denied\.$/;
const CHILD = { s3c: { description: 's3 child', prompt: 'Do exactly what the brief says with your tools, then reply DONE.', tools: ['Bash', 'Write'] } };
const dispatch = (task) => `call the Agent tool once with subagent_type "s3c" and prompt "${task}". Then reply DONE.`;
// Appends the tool name and the hook input's TOP-LEVEL KEY NAMES (never values), one JSON line per call (D11).
const KEYS_HOOK = [
  "let d = '';",
  "process.stdin.on('data', (c) => { d += c; }).on('end', () => {",
  "  try { const j = JSON.parse(d); require('fs').appendFileSync(process.env.S3E_KEYS, JSON.stringify({ tool: j.tool_name ?? null, keys: Object.keys(j).sort() }) + '\\n'); } catch {}",
  '});',
].join('\n');

/** The Bash tool_uses (id and command) whose parent is `parent` (null = the host). */
function bashCalls(frames, parent) {
  return frames.filter((f) => f.type === 'assistant' && (f.parent_tool_use_id ?? null) === parent)
    .flatMap((f) => (Array.isArray(f.message?.content) ? f.message.content : []))
    .filter((b) => b.type === 'tool_use' && b.name === 'Bash').map((b) => ({ id: b.id, command: String(b.input?.command ?? '') }));
}

/**
 * Turn c's deny facts (review M2). `hostWrote` / `childWrote`: whether s3c-host.txt / s3c.txt exist after the turn.
 * `denyMatchesHost` is false when the host's file appeared, true only when a host Bash call was refused in deny-rule
 * wording, else null (a failed command or a no-grant refusal is not the rule). `denyReachesChildren` is null unless
 * the rule matched the host and the child attempted Bash; then true when a child Bash call was refused in the host's
 * own refusal wording (each command masked), even if the child then made its file another way (it holds Write; a Bash
 * rule does not cover Write), else false when the child's file appeared. A child refused for having no grant (turn a
 * measures whether --allowedTools reaches children) or by anything else reads null (D10).
 * The CLI embeds `command.trim()`, so the trimmed command is masked too. For a piped command it embeds only the denied
 * segment without its redirections: masking then fails and the fact reads null (safe; mind it if the probe changes).
 */
export function denyFacts(frames, { hostWrote, childWrote }) {
  const shape = (call) => {
    const r = toolResult(frames, call.id);
    const text = (r?.text ?? '').replace(/<\/?tool_use_error>/g, '').trim();
    if (!r?.isError || !DENY_RE.test(text)) return null;
    return [call.command, call.command.trim()].filter(Boolean).reduce((s, cmd) => s.split(cmd).join('<command>'), text);
  };
  const host = bashCalls(frames, null);
  const hostShapes = host.map(shape).filter(Boolean);
  const denyMatchesHost = !host.length ? null : hostWrote ? false : hostShapes.length ? true : null;
  const { call } = childCall(frames, 's3c');
  const child = call ? bashCalls(frames, call.id) : [];
  const refused = child.some((x) => hostShapes.includes(shape(x)));
  const denyReachesChildren = denyMatchesHost !== true || !child.length ? null : refused ? true : childWrote ? false : null;
  return { denyMatchesHost, denyReachesChildren };
}

/** The exact --settings payload worca sends for a guarded spawn with one deny rule. */
export function worcaSettings() {
  const argv = buildClaudeArgs({ prompt: 'x', permissionMode: 'acceptEdits', hostGuard: true, permissionRules: { deny: [DENY] } });
  const i = argv.indexOf('--settings');
  if (i < 0 || !argv[i + 1].includes('host-guard')) throw new Error('S3 needs the host guard hook: unset WORCA_HOST_GUARD (or set it to 1)');
  return argv[i + 1];
}

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S3', args, { log });
  const settings = worcaSettings();
  const pid = String(process.pid);                    // `kill -0` on a live pid is harmless even if the guard misses
  for (const { label, bin } of CLIS) {
    const cwd = ctx.scratch(`repo-${label}`, { git: true });
    const base = { bin, cwd, agentsFile: ctx.agents(CHILD) };
    const keysFile = join(cwd, 's3e.keys');
    const hook = ctx.file(join(cwd, 's3e-hook.cjs'), KEYS_HOOK);
    const hookSettings = JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `"${process.execPath}" "${hook}"` }] }] } });
    const guarded = ['--permission-mode', 'acceptEdits', '--allowedTools', 'Agent,Bash', '--settings', settings, '--max-turns', '6'];
    const a = await ctx.turn(`${label} a`, { ...base, prompt: `First ${dispatch('Use the Write tool to create s3a.txt containing a.')}`,
      extraArgs: ['--allowedTools', 'Agent', '--max-turns', '4'] });
    const b = await ctx.turn(`${label} b`, { ...base, prompt: `First ${dispatch('Use the Write tool to create s3b.txt containing b.')}`,
      extraArgs: ['--tools', 'Agent', '--allowedTools', 'Agent,Bash,Write', '--max-turns', '4'] });
    const c = await ctx.turn(`${label} c`, { ...base, extraArgs: guarded,
      prompt: `First run the Bash command \`echo s3-denied > s3c-host.txt\` yourself; if it is refused, carry on. Then ${dispatch('Run the Bash command: echo s3-denied > s3c.txt')}` });
    const d = await ctx.turn(`${label} d`, { ...base, env: { WORCA_HOST_GUARD: '1', WORCA_HOST_PID: pid }, extraArgs: guarded,
      prompt: `First ${dispatch(`Run the Bash command: kill -0 ${pid}`)}` });
    const e = await ctx.turn(`${label} e`, { ...base, env: { S3E_KEYS: keysFile },
      extraArgs: ['--allowedTools', 'Agent,Bash', '--settings', hookSettings, '--max-turns', '6'],
      prompt: `First run the Bash command \`true\` yourself. Then ${dispatch('Run the Bash command: true')}` });
    if (ctx.dry) continue;

    const has = (f) => existsSync(join(cwd, f));
    const childCalls = (t, name) => { const { call } = childCall(t.frames, 's3c'); return call ? summarize(t.frames).toolCalls.filter((x) => x.parent === call.id && x.name === name) : []; };
    const hostCalls = (t, name) => summarize(t.frames).toolCalls.filter((x) => x.parent === null && x.name === name);
    const deny = denyFacts(c.frames, { hostWrote: has('s3c-host.txt'), childWrote: has('s3c.txt') });
    const guardCalls = childCalls(d, 'Bash');
    const lines = existsSync(keysFile) ? readFileSync(keysFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const bash = lines.filter((l) => l.tool === 'Bash');
    // Both calls must be in the frames, or two host lines could pass for a host/child pair.
    const sawBoth = hostCalls(e, 'Bash').length > 0 && childCalls(e, 'Bash').length > 0;
    const [hostLine, childLine] = sawBoth && bash.length >= 2 ? [bash[0], bash.at(-1)] : [null, null];
    const onlyChild = childLine ? childLine.keys.filter((k) => !hostLine.keys.includes(k)) : [];
    const facts = {
      cli: cliText(bin, ['--version']).trim().split('\n')[0],
      // a/b: null when the child never tried; only `false` (the file WAS written) can select HOST_TOOLS_MODE 'agent-only'.
      allowedToolsReachChildren: childCalls(a, 'Write').length ? !has('s3a.txt') : null,
      toolsFlagRestrictsChildren: childCalls(b, 'Write').length ? !has('s3b.txt') : null,
      // true only with evidence: the rule refused the host, and the child's attempt was refused in the same words (D10).
      ...deny,
      hostGuardReachesChildren: guardCalls.length
        ? guardCalls.some((x) => { const r = toolResult(d.frames, x.id); return Boolean(r?.isError && GUARD_RE.test(r.text)); }) : null,
      hookSeesAgentContext: childLine ? onlyChild.length > 0 || hostLine.keys.some((k) => !childLine.keys.includes(k)) : null,
      hookContextField: onlyChild.length ? onlyChild.join(',') : null,
    };
    verdict('S3', true, facts, { log });                 // pass = the script completed; the facts drive the decision
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
