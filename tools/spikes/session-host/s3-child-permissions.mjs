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
const CHILD = { s3c: { description: 's3 child', prompt: 'Do exactly what the brief says with your tools, then reply DONE.', tools: ['Bash', 'Write'] } };
const dispatch = (task) => `call the Agent tool once with subagent_type "s3c" and prompt "${task}". Then reply DONE.`;
// Appends the tool name and the hook input's TOP-LEVEL KEY NAMES (never values), one JSON line per call (D11).
const KEYS_HOOK = [
  "let d = '';",
  "process.stdin.on('data', (c) => { d += c; }).on('end', () => {",
  "  try { const j = JSON.parse(d); require('fs').appendFileSync(process.env.S3E_KEYS, JSON.stringify({ tool: j.tool_name ?? null, keys: Object.keys(j).sort() }) + '\\n'); } catch {}",
  '});',
].join('\n');

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
    const denyMatchesHost = hostCalls(c, 'Bash').length ? !has('s3c-host.txt') : null;
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
      denyMatchesHost,
      // true only with evidence: the rule matched the host, the child attempted the command, and no file appeared (D10).
      denyReachesChildren: denyMatchesHost !== true ? null : childCalls(c, 'Bash').length ? !has('s3c.txt') : null,
      hostGuardReachesChildren: guardCalls.length
        ? guardCalls.some((x) => { const r = toolResult(d.frames, x.id); return Boolean(r?.isError && GUARD_RE.test(r.text)); }) : null,
      hookSeesAgentContext: childLine ? onlyChild.length > 0 || hostLine.keys.some((k) => !childLine.keys.includes(k)) : null,
      hookContextField: onlyChild.length ? onlyChild.join(',') : null,
    };
    verdict('S3', true, facts, { log });                 // pass = the script completed; the facts drive the decision
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
