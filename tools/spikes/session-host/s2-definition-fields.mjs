#!/usr/bin/env node
// S2 (session-groups plan, Task 3): per-member model, effort, tools, maxTurns and MCP grants in a definition; what a
// child inherits when the definition omits them; resolvedModel. Local CLI and the Docker pin.
// Owner-run: WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s2-definition-fields.mjs
import { join } from 'node:path';
import { buildEffortArgs } from '../../../src/core/engines/claude.mjs';
import { CLIS, HAIKU, SONNET, assistantMessages, childCall, cliText, isMain, recordingProxy, spikeContext, summarize,
  toolResult, verdict } from './lib.mjs';

const PROBED = ['TodoWrite', 'Glob', 'Grep', 'LS', 'ExitPlanMode'];       // permission-free candidates (C32)
const MARK = 'MARK-S2BARE';                                               // finds the s2bare child's API request (D9)
const HOST_MARK = 'MARK-S2HOST';                                          // finds the s2bare host's own request (D9)
const ask = (type, extra = '') => `Call the Agent tool once with subagent_type "${type}" and prompt "go"${extra}. Then reply DONE.`;
// A stdio MCP server with one tool, `echo` (JSON-RPC 2.0, newline-delimited).
const MCP_ECHO = [
  "const rl = require('readline').createInterface({ input: process.stdin });",
  "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
  "rl.on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; }",
  "  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spike', version: '1.0.0' } } });",
  "  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', description: 'Echo the text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });",
  "  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String((m.params && m.params.arguments && m.params.arguments.text) || '') }] } });",
  "  else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });",
  '});',
].join('\n');

// The s2 child is asked for 5 turns of work, Bash first: with maxTurns 2 honoured it stops after 2 assistant messages,
// and a child that holds Bash tries it in its first message (D20).
const S2_FILES = ['s2-1.txt', 's2-2.txt', 's2-3.txt'];
const S2_PROMPT = 'First run the Bash command `echo s2`. Then read s2-1.txt, s2-2.txt and s2-3.txt with the Read tool, one call per '
  + 'message, waiting for each result. Then reply with your model id.';
const initTools = (frames) => frames.find((f) => f.type === 'system' && f.subtype === 'init')?.tools ?? null;
const starts = (v, p) => typeof v === 'string' && v.startsWith(p);
const hit = (r) => r.markersInSystem.includes(MARK) || r.markersInMessages.includes(MARK);
/** Tri-state: null when there is no evidence, so a missing result never reads as a decisive false (D18). */
const startsOrNull = (v, p) => (typeof v === 'string' ? v.startsWith(p) : null);

/**
 * The `s2` child's `tools` and `maxTurns` facts from the host turn's frames. Each is null unless the child left
 * evidence (D20, D25): `toolsRestrict` needs the child's init tool list or a tool call of its own. `maxTurnsHonoured`
 * is false when the child wrote more than 2 assistant messages, and true only when it wrote exactly 2 and the second
 * ended on a tool call (work was left and the cap stopped it). A child that stopped by itself tested nothing.
 * A `true` from a child that never ran would keep the field out of dropDefinitionFields.
 */
export function definitionFacts(frames, type = 's2') {
  const c = childCall(frames, type);
  const tools = initTools(c.frames);
  const calls = summarize(c.frames).toolCalls;
  const turns = assistantMessages(c.frames).length;
  const last = c.frames.filter((f) => f.type === 'assistant').at(-1);
  const endsOnToolCall = Array.isArray(last?.message?.content) && last.message.content.some((b) => b.type === 'tool_use');
  return {
    toolsRestrict: !c.call || (tools === null && !calls.length) ? null : !(tools ?? []).includes('Bash')
      && calls.filter((x) => x.name === 'Bash').every((x) => toolResult(frames, x.id)?.isError === true),
    maxTurnsHonoured: turns > 2 ? false : turns === 2 && endsOnToolCall ? true : null,
    childToolsWithList: tools,
  };
}

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S2', args, { log });
  const proxy = ctx.dry ? { url: 'http://127.0.0.1:<port>', requests: () => [], close: async () => {} }
    : await recordingProxy({ markers: [MARK, HOST_MARK] });
  try {
    for (const { label, bin } of CLIS) {
      const cwd = ctx.scratch(`work-${label}`);
      const fwd = ctx.dry || cliText(bin, ['--help']).includes('--forward-subagent-text') ? ['--forward-subagent-text'] : [];
      const mcpConfig = ctx.file(join(cwd, 'mcp.json'),
        JSON.stringify({ mcpServers: { spike: { type: 'stdio', command: process.execPath, args: ['-e', MCP_ECHO] } } }));
      // One control: no --model (records the CLI default) and only Read allowed (which probed tools run without a grant).
      const control = await ctx.turn(`${label} control`, { bin, cwd, extraArgs: ['--allowedTools', 'Read', '--max-turns', '8'],
        prompt: 'Call each of these tools once, in this order, skipping any you do not have: TodoWrite (one item "s2"), Glob (pattern "*"), '
          + 'Grep (pattern "s2"), LS (path "."), ExitPlanMode (plan "s2"). Then reply DONE.' });
      for (const f of S2_FILES) ctx.file(join(cwd, f), `${f}\n`);
      const s2 = await ctx.turn(`${label} s2`, { bin, cwd, prompt: ask('s2'),
        agentsFile: ctx.agents({ s2: { description: 's2 probe', prompt: S2_PROMPT, tools: ['Read'], model: HAIKU, effort: 'low', maxTurns: 2 } }),
        // The host's own cap (8) stays above the child's work, so only the definition's maxTurns can stop the child.
        extraArgs: ['--model', SONNET, '--allowedTools', 'Agent,Read,Bash', '--max-turns', '8', ...fwd] });
      const before = proxy.requests().length;
      const bare = await ctx.turn(`${label} s2bare`, { bin, cwd, prompt: `${ask('s2bare')} ${HOST_MARK}`, env: { ANTHROPIC_BASE_URL: proxy.url },
        agentsFile: ctx.agents({ s2bare: { description: 's2bare probe', prompt: `${MARK}. Reply with your model id.` } }),
        extraArgs: ['--model', HAIKU, ...buildEffortArgs('low'), '--max-turns', '4', ...fwd] });
      const bareRequests = proxy.requests().slice(before);
      const pin = await ctx.turn(`${label} s2pin`, { bin, cwd, prompt: ask('s2pin', ' and model "sonnet"'),
        agentsFile: ctx.agents({ s2pin: { description: 's2pin probe', prompt: 'Reply with your model id.', model: HAIKU } }),
        extraArgs: ['--model', HAIKU, '--max-turns', '4', ...fwd] });
      const mcp = await ctx.turn(`${label} s2m`, { bin, cwd, prompt: ask('s2m'),
        agentsFile: ctx.agents({ s2m: { description: 's2m probe', prompt: 'Call the mcp__spike__echo tool once with text "s2m", then reply DONE.',
          tools: ['mcp__spike'] } }),
        extraArgs: ['--mcp-config', mcpConfig, '--allowedTools', 'Agent,mcp__spike__echo', '--max-turns', '4', ...fwd] });
      if (ctx.dry) continue;

      const c2 = childCall(s2.frames, 's2');
      const cb = childCall(bare.frames, 's2bare');
      const cp2 = childCall(pin.frames, 's2pin');
      const cm = childCall(mcp.frames, 's2m');
      const controlModel = control.frames.find((f) => f.type === 'system' && f.subtype === 'init' && !f.parent_tool_use_id)?.model ?? null;
      const ranClean = new Set(summarize(control.frames).toolCalls
        .filter((c) => c.parent === null && PROBED.includes(c.name) && toolResult(control.frames, c.id)?.isError === false)
        .map((c) => c.name));
      const childToolsWithoutList = initTools(cb.frames);
      const reqChild = bareRequests.find(hit) ?? null;
      const reqHost = bareRequests.find((r) => r.markersInMessages.includes(HOST_MARK) && !hit(r)) ?? null;
      const childModels = assistantMessages(c2.frames).map((m) => m.model).filter(Boolean);
      const bareResolved = cb.result?.meta?.resolvedModel;
      const th = (r) => JSON.stringify(r?.thinking ?? null);
      const facts = {
        cli: cliText(bin, ['--version']).trim().split('\n')[0],
        forwardFlag: fwd.length > 0,
        // The child's own messages; resolvedModel only when none were forwarded (a CLI without --forward-subagent-text).
        modelHonoured: childModels.length ? childModels.some((m) => starts(m, HAIKU)) : starts(c2.result?.meta?.resolvedModel, HAIKU),
        resolvedModelReported: typeof c2.result?.meta?.resolvedModel === 'string',
        effortAccepted: /Invalid --agents/i.test(s2.stderr) ? false : c2.call ? true : null,
        hostEffortFlagAccepted: !/unknown option/i.test(bare.stderr),
        ...definitionFacts(s2.frames),                     // toolsRestrict, maxTurnsHonoured, childToolsWithList (D20)
        // null = no evidence (no control model, the CLI default is itself Haiku, or no resolvedModel); unknown counts as
        // "inherits" in CHILD_INHERITS_PARENT, so only a measured false may turn it off (D18).
        modelInheritsParentWhenOmitted: !controlModel || starts(controlModel, HAIKU) ? null : startsOrNull(bareResolved, HAIKU),
        effortInheritsParentWhenOmitted: !reqChild || !reqHost || (th(reqChild) === 'null' && th(reqHost) === 'null') ? null : th(reqChild) === th(reqHost),
        effortEvidence: { requests: bareRequests.length, host: reqHost && { model: reqHost.model, thinking: reqHost.thinking, bodyKeys: reqHost.bodyKeys },
          child: reqChild && { model: reqChild.model, thinking: reqChild.thinking, bodyKeys: reqChild.bodyKeys } },
        childToolsWithoutList,
        // Only the PROBED tools that ran without an error AND that an unrestricted child holds (D8) — never Bash/Write.
        permissionFreeTools: PROBED.filter((t) => ranClean.has(t) && (childToolsWithoutList ?? PROBED).includes(t)).sort(),
        taskCallModelOverridesDefinition: cp2.call?.inputKeys.includes('model') ? startsOrNull(cp2.result?.meta?.resolvedModel, 'claude-sonnet') : null,
        // false ⇒ Task 31 drops `tools` for members with MCP grants, so it needs a child that ran (D18).
        mcpGrantInTools: !cm.call ? null : summarize(cm.frames).toolCalls.some((c) => c.name === 'mcp__spike__echo')
          || (initTools(cm.frames) ?? []).includes('mcp__spike__echo'),
      };
      verdict('S2', facts.modelHonoured, facts, { log });
    }
  } finally { await proxy.close(); }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
