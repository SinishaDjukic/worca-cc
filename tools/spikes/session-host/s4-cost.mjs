#!/usr/bin/env node
// S4 (session-groups plan, Task 5): total_cost_usd across --resume, child spend, kills and --max-budget-usd.
// Owner-run: WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s4-cost.mjs
import { join } from 'node:path';
import { estimateCost, liveCostRates } from '../../../src/core/config.mjs';
import { HAIKU, assistantMessages, childCall, hostAgentCalls, isMain, spikeContext, sumUsage, summarize, toolResult,
  verdict } from './lib.mjs';

const FLAGS = ['--model', HAIKU, '--max-turns', '4', '--forward-subagent-text', '--allowedTools', 'Agent,Read'];
const files = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `f${String(from + i).padStart(2, '0')}.txt`);
const ask = (type, brief) => `Call the Agent tool once with subagent_type "${type}" and prompt "${brief}". Then reply DONE.`;
const DEFS = {
  s4m: { description: 'reads files, then asks one investigator', model: HAIKU, tools: ['Read', 'Agent'],
    prompt: 'Read every file the brief names with the Read tool. Then call the Agent tool once with subagent_type "worca-investigator" '
      + 'and prompt "Read f04.txt and summarise it in one line." Then reply with one line.' },
  'worca-investigator': { description: 'read-only investigator', model: HAIKU, tools: ['Read', 'Grep', 'Glob'],
    prompt: 'You are a read-only investigator. Answer in one line.' },
  s4r: { description: 'reads files', model: HAIKU, tools: ['Read'], prompt: 'Read every file the brief names, one Read call per file, in order. Then reply DONE.' },
  s4t: { description: 'trivial', model: HAIKU, tools: [], prompt: 'Reply OK.' },
};

/** USD of one usage object at a model's live rates; null when unpriceable. */
export function price(usage, model) {
  const rates = usage && model ? liveCostRates(model) : null;
  return rates ? estimateCost(usage, rates) : null;
}
const tokens = (u) => (u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0) : 0);
const pricedSeen = (frames) => assistantMessages(frames).reduce((s, m) => s + (price(m.usage, m.model ?? HAIKU) ?? 0), 0);

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S4', args, { log });
  const cwd = ctx.scratch('work');
  for (const f of files(1, 20)) ctx.file(join(cwd, f), `${f}\n${'Lorem ipsum dolor sit amet, spike filler. '.repeat(60)}\n`);
  const base = { cwd, agentsFile: ctx.agents(DEFS), extraArgs: FLAGS };
  const t1 = await ctx.turn('turn 1', { ...base, prompt: ask('s4m', `Read ${files(1, 3).join(', ')}.`) });
  const sid = t1.sessionId ?? '<session-1>';
  const t2 = await ctx.turn('turn 2', { ...base, resume: sid, prompt: ask('s4m', `Read ${files(5, 7).join(', ')}.`) });
  const C1 = t1.result?.total_cost_usd ?? null;
  const C2 = t2.result?.total_cost_usd ?? null;
  const t3 = await ctx.turn('turn 3', { ...base, resume: sid, prompt: ask('s4t', 'go'),
    extraArgs: [...FLAGS, '--max-budget-usd', C2 != null ? (C2 / 2).toFixed(4) : '<C2/2>'] });
  const t4 = await ctx.turn('turn 4', { ...base, prompt: ask('s4r', `Read ${files(1, 20).join(', ')}.`),
    extraArgs: [...FLAGS, '--max-budget-usd', '0.02'] });
  const abort = new AbortController();
  let timer = null;
  const t5 = await ctx.turn('turn 5', { ...base, prompt: ask('s4r', `Read ${files(1, 10).join(', ')}.`), signal: abort.signal,
    onFrame: (f) => { if (f.parent_tool_use_id && !timer) timer = setTimeout(() => abort.abort(), 5000); } });
  clearTimeout(timer);
  const t6 = await ctx.turn('turn 6', { ...base, resume: t5.sessionId ?? '<session-5>', prompt: ask('s4t', 'go') });
  if (ctx.dry) return;

  const member = childCall(t2.frames, 's4m');
  const childUsage = member.result?.meta?.usage ?? null;
  const childUsd = price(childUsage, member.result?.meta?.resolvedModel ?? HAIKU);
  const hostUsage = sumUsage(assistantMessages(t2.frames, null).map((m) => m.usage));
  const hostModel = t2.frames.find((f) => f.type === 'system' && f.subtype === 'init' && !f.parent_tool_use_id)?.model ?? HAIKU;
  const hostUsd = price(hostUsage, hostModel);
  const investigatorsUsd = member.call
    ? summarize(t2.frames).agentCalls.filter((c) => c.parent === member.call.id)
      .reduce((s, c) => { const m = toolResult(t2.frames, c.id)?.meta; return s + (price(m?.usage, m?.resolvedModel ?? HAIKU) ?? 0); }, 0)
    : 0;
  const delta = C1 != null && C2 != null ? C2 - C1 : null;
  const r4 = childCall(t4.frames, 's4r').result;
  const r6 = childCall(t6.frames, 's4t').result;
  const U5 = pricedSeen(t5.frames);
  // The abort fired while turn 5 was still running (the timer is cleared as soon as the turn returns). The exit signal
  // alone misses a CLI that traps SIGTERM and exits with a code.
  const killed = abort.signal.aborted;
  const facts = {
    C1, C2,
    cumulativeAcrossResume: delta != null && delta > 0,
    childUsagePresent: (childUsage?.input_tokens ?? 0) > 0,
    includesChildSpend: delta != null && childUsd != null ? delta >= childUsd - 0.0005 : null,
    // "host input" = Σ the host's own assistant-message usage; all four token kinds count (cache reads dominate).
    resultUsageIsHostOnly: t2.result?.usage && childUsage ? tokens(t2.result.usage) < tokens(hostUsage) + tokens(childUsage) : null,
    hostPricedShare: delta && hostUsd != null ? hostUsd / delta : null,
    estimateRatio: delta && hostUsd != null && childUsd != null && delta - hostUsd > 0 ? (childUsd + investigatorsUsd) / (delta - hostUsd) : null,
    budgetSubtype: t3.result?.subtype ?? null,
    budgetStoppedBeforeAgent: hostAgentCalls(t3.frames).length === 0,
    budgetExitCode: t3.exitCode,
    childStoppedByBudget: t4.result?.subtype === 'error_max_budget_usd' && !(r4 && !r4.isError),
    killedAfterChildFrame: killed,
    killExit: { code: t5.exitCode, signal: t5.signal },
    U5,
    // Both need the kill to have landed mid-turn with priced usage seen; otherwise they prove nothing (D18).
    resumeAfterDanglingToolUse: killed ? t6.exitCode === 0 && Boolean(r6 && !r6.isError) : null,
    costRestoredAfterKill: killed && U5 > 0 && t6.result?.total_cost_usd != null ? t6.result.total_cost_usd - pricedSeen(t6.frames) >= 0.8 * U5 : null,
  };
  // Only a budget stop counts: an unrelated early error must not set HOST_BUDGET_IS_CUMULATIVE (D18).
  facts.budgetCountsSessionTotal = facts.budgetStoppedBeforeAgent && /budget/i.test(facts.budgetSubtype ?? '');
  // Every term is compared with true: a null fact (no evidence) fails the verdict. It must never print pass:null, which
  // Convention 6 reads as a skip and which leaves the exit code at 0 (D25).
  verdict('S4', facts.cumulativeAcrossResume && facts.includesChildSpend === true && facts.childUsagePresent
    && facts.resumeAfterDanglingToolUse === true, facts, { log });
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
