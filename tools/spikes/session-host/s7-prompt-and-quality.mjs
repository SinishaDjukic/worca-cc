#!/usr/bin/env node
// S7a (session-groups plan, Task 7): does a definition `prompt` replace Claude Code's default system prompt, and does
// the child see CLAUDE.md and the environment? Measured through a loopback proxy (sizes and marker hits only), plus a
// 3-trial smoke A/B on task A of fixtures/s7-repo. Owner-run, first-party API only (the proxy rides ANTHROPIC_BASE_URL):
//   WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s7-prompt-and-quality.mjs
import cp from 'node:child_process';
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from '../../../src/core/phases.mjs';
import { HAIKU, SONNET, assistantMessages, childCall, childEnv, isMain, median, recordingProxy, spikeContext, summarize,
  verdict } from './lib.mjs';

/** C4. Task 31 exports the same constant from src/core/engines/session-dispatch.mjs (run 4); keep them equal. */
export const BRIEF_DIVIDER = '\n\n<!-- worca: step brief -->\n\n';
const CHILD_PROMPT = 'Begin your step.';                                           // C4
const FIXTURE = fileURLToPath(new URL('./fixtures/s7-repo/', import.meta.url));
const IMPLEMENTER = fileURLToPath(new URL('../../../agents/worca-cc-implementer.md', import.meta.url));
const DEFAULT_MARKERS = ['You are Claude Code', 'TodoWrite'];                     // Claude Code's default system prompt
const MARKERS = [...DEFAULT_MARKERS, 'MARK-CLAUDEMD-7', 'gitStatus', '<env>', 'worca: step brief'];
// The self-report question goes in the Agent call's prompt (the child's first user message), never in the definition:
// a definition that names TodoWrite would put the marker into the child's system itself (D21).
const PROBE_ASK = 'Reply OK. Then, on a new line, answer only yes or no: does your system prompt mention the TodoWrite tool?';
const TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
const TRIALS = 3;
const dispatch = (type, brief = CHILD_PROMPT) => `Call the Agent tool once with subagent_type "${type}" and prompt "${brief}". Then reply DONE.`;

/**
 * rev 3: the control's system holds a default marker and the child's does not. Only markers the definition prompt does
 * not carry itself count, and without a recorded request or a default marker in the control the answer is null (D21).
 */
export function replacesDefaultFrom(child, control, definition) {
  const defaults = DEFAULT_MARKERS.filter((m) => !definition.includes(m));
  const has = (r) => defaults.some((m) => r.markersInSystem.includes(m));
  return child && control && has(control) ? !has(child) : null;
}

/**
 * A fresh git copy of the fixture under the spike's out dir (never run in place: this repo's .claude/ would load).
 * Exported for Task 52 (S7b), whose trials need the same committed copies (D14).
 */
export function copyRepo(ctx, name) {
  const dir = join(ctx.out, `repo-${name}`);
  if (ctx.dry) return dir;
  cpSync(FIXTURE, dir, { recursive: true });
  const git = (...a) => cp.execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=worca spike', '-c', 'user.email=spike@worca.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 's7-repo fixture');
  return dir;
}

function trialRow(repo, t) {
  const test = cp.spawnSync('npm', ['test'], { cwd: repo, env: childEnv(), stdio: 'ignore', timeout: 300_000 });
  return { passes: test.status === 0, toolErrors: summarize(t.frames).toolResults.filter((r) => r.isError).length,
    turns: assistantMessages(t.frames).length, usd: t.result?.total_cost_usd ?? null };
}
const armSummary = (rows) => ({ passes: rows.filter((r) => r.passes).length, toolErrors: median(rows.map((r) => r.toolErrors)),
  turns: median(rows.map((r) => r.turns)), usd: median(rows.map((r) => r.usd)) });

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S7a', args, { log });
  if (!ctx.dry && [process.env.CLAUDE_CODE_USE_VERTEX, process.env.CLAUDE_CODE_USE_BEDROCK].some((v) => /^(1|true)$/i.test(v ?? ''))) {
    throw new Error('S7a records requests through ANTHROPIC_BASE_URL, which Vertex/Bedrock routing bypasses: unset CLAUDE_CODE_USE_VERTEX / CLAUDE_CODE_USE_BEDROCK');
  }
  // Exactly what an ungrouped implementer step sends: loadAgentFile keeps the whole file, frontmatter included
  // (src/core/workflows.mjs loadAgentFile), and the executor hands it to buildSystemPrompt (no tool instruction here).
  const system = buildSystemPrompt('', readFileSync(IMPLEMENTER, 'utf8'));
  const probeDefinition = `${system}${BRIEF_DIVIDER}Reply OK.`;                   // rev 3, verbatim
  const planA = readFileSync(join(FIXTURE, 'PLAN-A.md'), 'utf8');
  const proxy = ctx.dry ? { url: 'http://127.0.0.1:<port>', requests: () => [], close: async () => {} }
    : await recordingProxy({ markers: MARKERS });
  const env = { ANTHROPIC_BASE_URL: proxy.url };
  try {
    const probe = copyRepo(ctx, 'probe');
    const n0 = proxy.requests().length;
    const host = await ctx.turn('probe host', { cwd: probe, env, prompt: dispatch('s7probe', PROBE_ASK),
      agentsFile: ctx.agents({ s7probe: { description: 'the s7 probe step', model: HAIKU, prompt: probeDefinition } }),
      extraArgs: ['--model', HAIKU, '--max-turns', '4', '--forward-subagent-text'] });
    const n1 = proxy.requests().length;
    await ctx.turn('probe control', { cwd: probe, env, prompt: 'Reply OK.',
      extraArgs: ['--append-system-prompt', system, '--model', HAIKU, '--max-turns', '2'] });
    const n2 = proxy.requests().length;
    const rows = { process: [], subagent: [] };
    for (let i = 1; i <= TRIALS; i++) {
      const repo = copyRepo(ctx, `process-${i}`);
      const t = await ctx.turn(`trial process ${i}`, { cwd: repo, prompt: planA,
        extraArgs: ['--append-system-prompt', system, '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS.join(','), '--model', SONNET] });
      if (!ctx.dry) rows.process.push(trialRow(repo, t));
    }
    for (let i = 1; i <= TRIALS; i++) {
      const repo = copyRepo(ctx, `subagent-${i}`);
      const t = await ctx.turn(`trial subagent ${i}`, { cwd: repo, prompt: dispatch('s7-impl'),
        agentsFile: ctx.agents({ 's7-impl': { description: 'the implementer step', model: SONNET, tools: [...TOOLS, 'TodoWrite'],
          prompt: `${system}${BRIEF_DIVIDER}${planA}` } }),
        extraArgs: ['--model', SONNET, '--permission-mode', 'acceptEdits', '--allowedTools', ['Agent', ...TOOLS].join(','),
          '--max-turns', '4', '--forward-subagent-text'] });
      if (!ctx.dry) rows.subagent.push(trialRow(repo, t));
    }
    if (ctx.dry) return;

    const reqs = proxy.requests();
    const hit = (r, m) => r.markersInSystem.includes(m) || r.markersInMessages.includes(m);
    const child = reqs.slice(n0, n1).find((r) => hit(r, 'worca: step brief')) ?? null;
    // The control's main request is the one carrying the appended system prompt: the largest system of its requests.
    const control = reqs.slice(n1, n2).reduce((a, r) => (!a || r.systemBytes > a.systemBytes ? r : a), null);
    const probeChild = childCall(host.frames, 's7probe');
    const lastLine = (probeChild.result?.text ?? '').trim().split('\n').at(-1) ?? '';
    const facts = {
      replacesDefault: replacesDefaultFrom(child, control, probeDefinition),
      replacesDefaultSelfReport: /\bno\b/i.test(lastLine) ? true : /\byes\b/i.test(lastLine) ? false : null,
      seesClaudeMd: child ? hit(child, 'MARK-CLAUDEMD-7') : null,
      seesEnvironment: child ? hit(child, 'gitStatus') || hit(child, '<env>') : null,
      childInitTools: probeChild.frames.find((f) => f.type === 'system' && f.subtype === 'init')?.tools ?? null,
      systemBytes: { child: child?.systemBytes ?? null, control: control?.systemBytes ?? null },
      smoke: { process: armSummary(rows.process), subagent: armSummary(rows.subagent), trials: TRIALS },
    };
    verdict('S7a', Boolean(child && control), facts, { log });
  } finally { await proxy.close(); }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
