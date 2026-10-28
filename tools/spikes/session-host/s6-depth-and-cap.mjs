#!/usr/bin/env node
// S6 (session-groups plan, Task 6): does depth 2 work, and what is the per-session sub-agent cap?
// Owner-run: WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s6-depth-and-cap.mjs
import { readFileSync, realpathSync } from 'node:fs';
import { HAIKU, childCall, hostAgentCalls, isMain, onPath, spikeContext, summarize, toolResult, verdict } from './lib.mjs';

const CAP_ENV = { CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '2' };
const FLAGS = ['--model', HAIKU, '--max-turns', '8', '--forward-subagent-text'];
const DEFS = {
  s6m: { description: 'dispatches an investigator', model: HAIKU, tools: ['Agent', 'Read'],
    prompt: 'Call the Agent tool once with subagent_type "worca-investigator" and prompt "Use Glob to count the files here and reply with the count." Then reply with its answer.' },
  'worca-investigator': { description: 'read-only investigator', model: HAIKU, tools: ['Read', 'Glob', 'Grep'], prompt: 'You are a read-only investigator. Answer in one line.' },
  s6t: { description: 'trivial', model: HAIKU, tools: [], prompt: 'Reply OK.' },
};
const ONE = 'Call the Agent tool once with subagent_type "s6t" and prompt "go". Then reply DONE.';
const THREE = 'Call the Agent tool three times, one after another (wait for each result before the next call), each with subagent_type "s6t" and prompt "go". Then reply DONE.';

/** (c) No-spend probe: the per-session cap default and the concurrent-cap refusal literal, read from the CLI file. */
export function scanCli(path) {
  if (!path) return { capDefault: null, concurrentCapText: null };
  const text = readFileSync(realpathSync(path)).toString('latin1');
  const i = text.indexOf('MAX_SUBAGENTS_PER_SESSION');
  const near = i >= 0 ? text.slice(i, i + 200) : '';
  const n = near.match(/\?\?\s*(\d+)/) ?? near.match(/[=:]\s*(\d+)/);
  const c = text.match(/Concurrent subagent limit reached[^"'`\n]{0,160}/);
  return { capDefault: n ? Number(n[1]) : null, concurrentCapText: c ? c[0].slice(0, 200) : null };
}

const refused = (r) => Boolean(r && (r.isError || /\b(?:limit|cap|maximum)\b/i.test(r.text)));

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S6', args, { log });
  const cwd = ctx.scratch('work');
  const agentsFile = ctx.agents(DEFS);
  const a = await ctx.turn('a', { cwd, agentsFile, extraArgs: FLAGS, prompt: 'Call the Agent tool once with subagent_type "s6m" and prompt "go". Then reply with its answer.' });
  const b0 = await ctx.turn('b0', { cwd, agentsFile, env: CAP_ENV, extraArgs: FLAGS, prompt: THREE });
  const nth = (t, i) => { const c = hostAgentCalls(t.frames).filter((x) => x.type === 's6t')[i]; return c ? toolResult(t.frames, c.id) : null; };
  const third = nth(b0, 2);
  // --dry plans the (b) branch; null when the host never made the third call (no evidence either way).
  const capEnvHonoured = ctx.dry ? true : third ? refused(third) : null;
  let capSpansResumes = null;                                                       // unknown, never false, without (b)
  if (capEnvHonoured) {
    const b1 = await ctx.turn('b turn 1', { cwd, agentsFile, env: CAP_ENV, extraArgs: FLAGS, prompt: ONE });
    const sid = b1.sessionId ?? '<session-b1>';
    const b2 = await ctx.turn('b turn 2', { cwd, agentsFile, env: CAP_ENV, resume: sid, extraArgs: FLAGS, prompt: ONE });
    const b3 = await ctx.turn('b turn 3', { cwd, agentsFile, env: CAP_ENV, resume: sid, extraArgs: FLAGS, prompt: ONE });
    // Evidence only when turns 1 and 2 each made their one call and turn 3's call has a result (D25): a host that
    // skipped a call, or a CLI that hid the Agent tool, says nothing about the cap.
    const made = (t) => hostAgentCalls(t.frames).filter((x) => x.type === 's6t').length;
    const r3 = nth(b3, 0);
    if (!ctx.dry && made(b1) === 1 && made(b2) === 1 && r3) capSpansResumes = refused(r3);
  }
  if (ctx.dry) { ctx.note('(c) capDefault and concurrentCapText read the local claude file (no spawn); skipped in --dry'); return; }

  const member = childCall(a.frames, 's6m').call;
  const inv = member ? summarize(a.frames).agentCalls.find((x) => x.parent === member.id && x.type === 'worca-investigator') ?? null : null;
  const depth2Works = Boolean(inv) && a.frames.some((f) => f.parent_tool_use_id === inv.id);
  const facts = {
    depth2Works,
    depth2ParentId: depth2Works ? inv.id : null,
    capEnvHonoured,
    capRefusalText: capEnvHonoured ? third.text.slice(0, 200) : null,
    capSpansResumes,
    ...scanCli(onPath('claude')),
  };
  verdict('S6', depth2Works, facts, { log });
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
