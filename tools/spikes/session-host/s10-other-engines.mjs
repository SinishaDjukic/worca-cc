#!/usr/bin/env node
// S10 (session-groups plan, Task 10): Codex, Copilot CLI and OpenCode — two definitions, then a resume with a third,
// written the way each worca adapter writes them. A CLI not on PATH prints a skipped verdict line.
// Owner-run, on a machine with the CLIs: WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/s10-other-engines.mjs
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CODEX_DEFAULT_MODEL, buildCodexArgs, tomlString } from '../../../src/core/engines/codex.mjs';
import { COPILOT_NODE_AGENT, buildCopilotArgs, copilotAgentFile } from '../../../src/core/engines/copilot.mjs';
import { OPENCODE_NODE_AGENT, buildOpencodeArgs } from '../../../src/core/engines/opencode.mjs';
import { cliText, isMain, onPath, spikeContext, verdict } from './lib.mjs';

const ANSWERS = { s10a: 'ALPHA', s10b: 'BRAVO', s10c: 'CHARLIE' };
const promptOf = (name) => `Reply with exactly ${ANSWERS[name]}.`;
const NODE_PROMPT = 'You coordinate sub-agents. Do what the user message asks.';
const T1 = 'Use your sub-agent s10a, then your sub-agent s10b, each with the task "go". Reply with their two answers.';
const T2 = 'Use your sub-agent s10c with the task "go". Reply with its answer.';

// The argv comes from each adapter's own exported builder; only the definitions are the spike's. Models: the adapter's
// default for codex; opencode has none (the adapter refuses a run without one), so the spike names one. The
// SPIKE_*_MODEL variables are spike-only overrides, not worca settings.

// codex — src/core/engines/codex.mjs: each role is `-c agents.<role>.description=… -c agents.<role>.config_file=<toml>`
// passed through buildCodexArgs's `mcp` slot (runCodexProcess :849-854, :862; codexInvestigatorRole :303; no CODEX_HOME/agents
// folder), the TOML key is `developer_instructions` (:307), the prompt goes on stdin (`-`), a resume is
// `exec resume <thread>` (buildCodexArgs :443-464), the id is `thread.started.thread_id` (:626-628).
function codex(ctx, cwd) {
  const model = process.env.SPIKE_CODEX_MODEL || CODEX_DEFAULT_MODEL;
  const roles = (names) => names.flatMap((n) => {
    const file = ctx.file(join(cwd, `${n}.toml`), `developer_instructions = ${tomlString(promptOf(n))}\n`);
    return ['-c', `agents.${n}.description=${tomlString(`spike role ${n}`)}`, '-c', `agents.${n}.config_file=${tomlString(file)}`];
  });
  return {
    turn1: () => ({ argv: buildCodexArgs({ model, sandbox: 'workspace-write', mcp: roles(['s10a', 's10b']) }), env: {} }),
    turn2: (id) => ({ argv: buildCodexArgs({ model, sandbox: 'workspace-write', resumeThreadId: id, mcp: roles(['s10a', 's10b', 's10c']) }), env: {} }),
    sessionId: (frames) => frames.find((f) => f.type === 'thread.started')?.thread_id ?? null,
  };
}

// copilot — src/core/engines/copilot.mjs: `<scratch>/.github/agents/*.agent.md` (copilotAgentFile :269) passed with
// --add-dir (:662), the node agent `worca-node`, a fresh scratch per spawn (:637-646), the prompt on stdin, worca names the
// session (--session-id=, then --resume=; buildCopilotArgs :303-320), COPILOT_AUTO_UPDATE=false (:634).
function copilot(ctx, cwd) {
  const sid = ctx.dry ? '<uuid>' : randomUUID();
  const scratch = (n, names) => {
    const dir = join(cwd, `copilot-${n}`);
    for (const name of [COPILOT_NODE_AGENT, ...names]) {
      ctx.file(join(dir, '.github', 'agents', `${name}.agent.md`), copilotAgentFile({ name,
        description: `spike agent ${name}`, prompt: name === COPILOT_NODE_AGENT ? NODE_PROMPT : promptOf(name) }));
    }
    return dir;
  };
  const argv = (dir, resume) => buildCopilotArgs({ sessionId: sid, resume, agent: COPILOT_NODE_AGENT, addDirs: [dir],
    usageFile: join(dir, 'usage.json') });
  const env = { COPILOT_AUTO_UPDATE: 'false' };
  return {
    turn1: () => ({ argv: argv(scratch(1, ['s10a', 's10b']), false), env }),
    turn2: () => ({ argv: argv(scratch(2, ['s10a', 's10b', 's10c']), true), env }),
    sessionId: (frames) => frames.find((f) => f.type === 'result')?.sessionId ?? null,
  };
}

// opencode — src/core/engines/opencode.mjs: the config is inline in OPENCODE_CONFIG_CONTENT, and each agent's prompt
// is a `{file:<scratch>/<name>.md}` reference (:540-568, env :582), the prompt on stdin, `-s <ses_…>` to resume
// (buildOpencodeArgs :237-244), the id is the first event's sessionID (:299-301).
function opencode(ctx, cwd) {
  const model = process.env.SPIKE_OPENCODE_MODEL || 'anthropic/claude-haiku-4-5';
  const promptRef = (name, text) => `{file:${ctx.file(join(cwd, 'opencode-prompts', `${name}.md`), `${text}\n`)}}`;
  const env = (names) => ({
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: {
      [OPENCODE_NODE_AGENT]: { mode: 'primary', description: 'spike node', prompt: promptRef(OPENCODE_NODE_AGENT, NODE_PROMPT),
        permission: { task: { '*': 'deny', ...Object.fromEntries(names.map((n) => [n, 'allow'])) } } },
      ...Object.fromEntries(names.map((n) => [n, { mode: 'subagent', description: `spike agent ${n}`, prompt: promptRef(n, promptOf(n)) }])),
      general: { disable: true }, explore: { disable: true } } }),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_SHARE: '1', PWD: cwd,
  });
  return {
    turn1: () => ({ argv: buildOpencodeArgs({ agent: OPENCODE_NODE_AGENT, model }), env: env(['s10a', 's10b']) }),
    turn2: (id) => ({ argv: buildOpencodeArgs({ agent: OPENCODE_NODE_AGENT, model, sessionId: id }), env: env(['s10a', 's10b', 's10c']) }),
    sessionId: (frames) => frames.find((f) => typeof f.sessionID === 'string')?.sessionID ?? null,
  };
}

const ENGINES = [['codex', codex], ['copilot', copilot], ['opencode', opencode]];

export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const ctx = spikeContext('S10', args, { log });
  for (const [engine, make] of ENGINES) {
    if (!onPath(engine)) { verdict(`S10-${engine}`, null, { skipped: 'not installed' }, { log }); continue; }
    const cwd = ctx.scratch(engine, { git: true });
    const e = make(ctx, cwd);
    const t1 = await ctx.run(`${engine} turn 1`, { bin: engine, cwd, ...e.turn1(), input: T1 });
    const id1 = e.sessionId(t1.frames);
    const t2 = await ctx.run(`${engine} turn 2`, { bin: engine, cwd, ...e.turn2(id1 ?? '<session-1>'), input: T2 });
    if (ctx.dry) continue;
    const said = (t) => JSON.stringify(t.frames);
    const facts = {
      engine,
      version: cliText(engine, ['--version']).trim().split('\n')[0],
      multipleDefinitions: said(t1).includes('ALPHA') && said(t1).includes('BRAVO'),
      perDispatchDefinitionOnResume: said(t2).includes('CHARLIE'),
      resumeWorks: t2.exitCode === 0 && id1 !== null && e.sessionId(t2.frames) === id1,
      // Evidence fields: no stable cross-engine signal yet; the owner reads them from the saved frames (Task 68).
      liveChildStream: null,
      childCostReported: null,
    };
    verdict(`S10-${engine}`, facts.multipleDefinitions && facts.perDispatchDefinitionOnResume && facts.resumeWorks, facts, { log });
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 2; });
