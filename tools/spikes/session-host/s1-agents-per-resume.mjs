#!/usr/bin/env node
// S1 (session-groups plan, Task 2): does a different `--agents <file>` take effect on each `--resume`?
// Owner-run (spends money): WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s1-agents-per-resume.mjs
// Agents run only `--dry`, which prints the five turns' argv and spawns nothing.
import { HAIKU, bigPrompt, childCall, hostAgentCalls, isMain, spikeContext, verdict } from './lib.mjs';

const NEVER = '00000000-0000-4000-8000-000000000000';          // a session id that never existed (turn 4)
const FLAGS = ['--model', HAIKU, '--max-turns', '4', '--forward-subagent-text'];
const ask = (type) => `Call the Agent tool once with subagent_type "${type}" and prompt "go". Then reply DONE.`;

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S1', args, { log });
  const cwd = ctx.scratch('work');
  const a = ctx.agents({ 'spike-a': { description: 'answers ALPHA', prompt: 'Reply with exactly ALPHA.', tools: [] } });
  const b = ctx.agents({ 'spike-b': { description: 'answers BRAVO', prompt: bigPrompt(65536, 'Reply with exactly BRAVO.'), tools: [] } });
  const t1 = await ctx.turn('turn 1', { cwd, prompt: ask('spike-a'), agentsFile: a, extraArgs: FLAGS });
  const sid = t1.sessionId ?? '<session-1>';
  const t2 = await ctx.turn('turn 2', { cwd, prompt: ask('spike-b'), resume: sid, agentsFile: b, extraArgs: FLAGS });
  const t3 = await ctx.turn('turn 3', { cwd, prompt: ask('spike-a'), resume: sid, agentsFile: b, extraArgs: FLAGS });
  const t4 = await ctx.turn('turn 4', { cwd, prompt: 'Reply OK.', resume: NEVER, extraArgs: FLAGS });
  const t5 = await ctx.turn('turn 5', { cwd, resume: sid, agentsFile: b, extraArgs: FLAGS,
    prompt: 'Call the Agent tool once with ONLY subagent_type "spike-b" and prompt "go" — no description parameter. Then reply DONE.' });
  if (ctx.dry) return;

  const r2 = childCall(t2.frames, 'spike-b').result;
  const r3 = childCall(t3.frames, 'spike-a').result;
  const five = childCall(t5.frames, 'spike-b');
  const calls = [t1, t2, t3].flatMap((t) => hostAgentCalls(t.frames));
  const newDefinitionUsed = Boolean(r2 && !r2.isError && r2.text.includes('BRAVO'));
  const missingDescriptionTested = Boolean(five.call) && !five.call.inputKeys.includes('description');
  const facts = {
    newDefinitionUsed,
    bigDefinitionUsed: newDefinitionUsed,                    // the same check, recorded so a size limit shows by name
    oldDefinitionCallable: Boolean(r3 && !r3.isError && r3.text.includes('ALPHA')),
    sameSessionId: Boolean(t1.sessionId) && t1.sessionId === t2.sessionId && t2.sessionId === t3.sessionId,
    vanishedText: [t4.stderr, t4.result?.result ?? ''].join(' ').replace(/\s+/g, ' ').trim().slice(0, 200),
    descriptionSent: calls.length ? calls.every((c) => c.inputKeys.includes('description')) : null,   // no call: no evidence (D25)
    missingDescriptionTested,
    // Only a call that really lacked description: another turn-5 error must not seed INVALID_INPUT_RE.
    missingDescriptionText: missingDescriptionTested && five.result?.isError ? five.result.text.slice(0, 200) : null,
  };
  verdict('S1', facts.newDefinitionUsed && facts.sameSessionId, facts, { log });
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
