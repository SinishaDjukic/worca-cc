#!/usr/bin/env node
// S8b (session-groups plan, Task 8): can a finished child be continued (questions round)? Informational: v1 ships cold.
// Owner-run: WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s8b-continue-child.mjs
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { HAIKU, childCall, isMain, spikeContext, verdict } from './lib.mjs';

const FLAGS = ['--model', HAIKU, '--max-turns', '6', '--forward-subagent-text'];

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S8b', args, { log });
  const cwd = ctx.scratch('work');
  // The word reaches ONLY the first child: it reads it from a file deleted before turn 2 and never says it. The host's
  // transcript and a fresh re-dispatch cannot produce it, so only a continued child can (D15).
  const word = ctx.dry ? '<word>' : `S8-${randomBytes(4).toString('hex').toUpperCase()}`;
  const secret = ctx.file(join(cwd, 'secret.txt'), `${word}\n`);
  const agentsFile = ctx.agents({ s8: { description: 'remembers what it read', model: HAIKU, tools: ['Read'],
    prompt: 'Follow the brief exactly. Never repeat what you read unless a follow-up message asks for it.' } });
  const t1 = await ctx.turn('turn 1', { cwd, agentsFile, extraArgs: [...FLAGS, '--allowedTools', 'Agent,Read'],
    prompt: 'Call the Agent tool once with subagent_type "s8" and prompt "Read secret.txt with the Read tool and remember the word in it. '
      + 'Reply only DONE; do not repeat the word." Then reply DONE.' });
  if (!ctx.dry) rmSync(secret, { force: true });
  const first = childCall(t1.frames, 's8');
  const agentId = first.result?.meta?.agentId ?? '<agent-id>';
  const t2 = await ctx.turn('turn 2', { cwd, agentsFile, resume: t1.sessionId ?? '<session-1>',
    extraArgs: [...FLAGS, '--allowedTools', 'Agent,Read,SendMessage'],
    prompt: `Continue the sub-agent you ran in your previous turn (agent id ${agentId}); do not start a new one. `
      + 'Ask it: "What was the word in secret.txt?" Then reply with its answer.' });
  if (ctx.dry) return;

  const leaked = Boolean(first.result?.text.includes(word));
  const hostToolUses = t2.frames.filter((f) => f.type === 'assistant' && !f.parent_tool_use_id)
    .flatMap((f) => f.message?.content ?? []).filter((b) => b.type === 'tool_use');
  const cont = hostToolUses.find((b) => JSON.stringify(b.input ?? {}).includes(agentId)) ?? null;
  verdict('S8b', true, {
    childFinished: Boolean(first.result && !first.result.isError),
    wordLeakedToHost: leaked,
    continueTool: cont?.name ?? null,
    continuedRemembers: !leaked && JSON.stringify(t2.frames).includes(word),
  }, { log });
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
