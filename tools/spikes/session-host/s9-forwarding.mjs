#!/usr/bin/env node
// S9 (session-groups plan, Task 9): --forward-subagent-text and depth-2 parent_tool_use_id, on the local CLI and the
// Docker pin; an owner run also records the sanitized demux golden test/fixtures/session-host/claude-depth2.ndjson.
// Owner-run: WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s9-forwarding.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClaudeArgs } from '../../../src/core/claude-runner.mjs';
import { CLIS, HAIKU, childCall, cliText, isMain, spikeContext, strip, summarize, verdict } from './lib.mjs';

const FIXTURE = fileURLToPath(new URL('../../../test/fixtures/session-host/claude-depth2.ndjson', import.meta.url));
const MAX_FIXTURE_LINES = 400;
const FWD = '--forward-subagent-text';
const DEFS = {
  s9m: { description: 'dispatches an investigator', model: HAIKU, tools: ['Agent', 'Read', 'Glob'],
    prompt: 'Say in one sentence what you are about to do. Then call the Agent tool once with subagent_type "worca-investigator" '
      + 'and prompt "Use Glob to count the files here and reply with the count." Then reply with its answer.' },
  'worca-investigator': { description: 'read-only investigator', model: HAIKU, tools: ['Read', 'Glob', 'Grep'],
    prompt: 'You are a read-only investigator. Say in one sentence what you will do, then do it and answer in one line.' },
};
const PROMPT = 'Call the Agent tool once with subagent_type "s9m" and prompt "go". Then reply with its answer.';

/** The flags worca adds for sub-agent hook telemetry (WORCA_SUBAGENT_HOOKS=1, read by buildClaudeArgs at call time). */
export function subagentHookArgs() {
  const prev = process.env.WORCA_SUBAGENT_HOOKS;
  process.env.WORCA_SUBAGENT_HOOKS = '1';
  try {
    const argv = buildClaudeArgs({ prompt: 'x', permissionMode: 'default' });
    const s = argv.indexOf('--settings');
    return [...(argv.includes('--include-hook-events') ? ['--include-hook-events'] : []), ...(s >= 0 ? ['--settings', argv[s + 1]] : [])];
  } finally { if (prev === undefined) delete process.env.WORCA_SUBAGENT_HOOKS; else process.env.WORCA_SUBAGENT_HOOKS = prev; }
}

const childTextBlocks = (frames) => frames.filter((f) => f.type === 'assistant' && f.parent_tool_use_id)
  .flatMap((f) => f.message?.content ?? []).filter((b) => b.type === 'text').length;
const hookToolUseId = (f) => { try { return JSON.parse(f.stdout ?? f.output ?? '')?.tool_use_id ?? null; } catch { return null; } };

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S9', args, { log });
  const hooks = subagentHookArgs();
  for (const { label, bin } of CLIS) {
    const cwd = ctx.scratch(`work-${label}`);
    for (const f of ['a.txt', 'b.txt', 'c.txt']) ctx.file(join(cwd, f), `${f}\n`);
    const agentsFile = ctx.agents(DEFS);
    const base = ['--model', HAIKU, '--max-turns', '4', '--allowedTools', 'Agent,Read,Glob', ...hooks];
    const withRun = await ctx.turn(`${label} with`, { bin, cwd, agentsFile, prompt: PROMPT, extraArgs: [...base, FWD] });
    const without = await ctx.turn(`${label} without`, { bin, cwd, agentsFile, prompt: PROMPT, extraArgs: base });
    if (ctx.dry) { ctx.note(`${label}: flagInHelp reads \`${bin} --help\` (live only)`); continue; }

    const member = childCall(withRun.frames, 's9m').call;
    const inv = member ? summarize(withRun.frames).agentCalls.find((c) => c.parent === member.id) ?? null : null;
    const depth2 = member ? withRun.frames.filter((f) => f.parent_tool_use_id && f.parent_tool_use_id !== member.id) : [];
    const retry = withRun.frames.find((f) => f.type === 'system' && f.subtype === 'api_retry') ?? null;
    const facts = {
      cli: cliText(bin, ['--version']).trim().split('\n')[0],
      flagAccepted: !/unknown option/i.test(withRun.stderr),
      flagInHelp: cliText(bin, ['--help']).includes(FWD),
      textForwardedWith: childTextBlocks(withRun.frames),
      textForwardedWithout: childTextBlocks(without.frames),
      depth2ParentIsInvestigator: Boolean(inv) && depth2.length > 0 && depth2.every((f) => f.parent_tool_use_id === inv.id),
      childInitFrame: withRun.frames.some((f) => f.type === 'system' && f.subtype === 'init' && f.parent_tool_use_id),
      hookFramesCarryToolUseId: Boolean(member) && withRun.frames.some((f) => f.type === 'system' && f.subtype === 'hook_response' && hookToolUseId(f) === member.id),
      apiRetrySeen: Boolean(retry),
      apiRetryFramePid: retry?.parent_tool_use_id ?? null,
    };
    // Only a run with the golden's shape (a host Agent call, every depth-2 frame under the investigator) is recorded:
    // Task 30's golden test runs whenever the file exists (D19).
    if (label === 'local' && facts.depth2ParentIsInvestigator) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, withRun.frames.slice(0, MAX_FIXTURE_LINES).map((f) => `${JSON.stringify(strip(f))}\n`).join(''));
    } else if (label === 'local') ctx.note('local run lacks the depth-2 shape: the fixture was not written');
    verdict('S9', facts.flagAccepted && facts.flagInHelp && facts.textForwardedWith > 0 && facts.textForwardedWithout === 0
      && facts.depth2ParentIsInvestigator, facts, { log });
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
