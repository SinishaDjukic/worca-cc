// src/core/engines/mock.mjs
// The offline mock engine: deterministic role writers keyed by the MOCK_* marker
// protocol (see the header of src/core/claude-runner.mjs). Spawns nothing.
import { writeFile, mkdir, appendFile, readFile, access, readdir } from 'node:fs/promises';
import { constants as FS, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
// The offline classifier and the shape normalizer the mock ask role answers
// propose_workflow with — both pure (no DB, no spawn).
import { mockShapeFor } from '../auto/recipes.mjs';
import { normalizeShape } from '../../shared/graph/assemble.mjs';
import { extractText, extractResultCost } from './claude.mjs';
import { writeMockSurvey, writeMockUsage, writeMockSynthesis } from '../workspace-scan-mock.mjs';
import { safeEmit } from './spawn.mjs';

export const MOCK_SPAWN_LOG_MAX = 500;
export const mockSpawnLog = [];
export function recordMockSpawn({ engine, sandbox, model } = {}) {
  mockSpawnLog.push({ engine: engine || 'claude', sandbox: sandbox ?? null, model: model ?? null });
  if (mockSpawnLog.length > MOCK_SPAWN_LOG_MAX) mockSpawnLog.splice(0, mockSpawnLog.length - MOCK_SPAWN_LOG_MAX);
}

// ── Mock execution ───────────────────────────────────────────────────────────

/**
 * Parse "KEY: value" markers from the prompt (preferred) and systemPrompt.
 */
function parseMarkers(prompt, systemPrompt) {
  const markers = {};
  const scan = (txt) => {
    if (!txt) return;
    for (const line of String(txt).split(/\r?\n/)) {
      const m = line.match(/^\s*(MOCK_[A-Z_]+)\s*:\s*(.*)$/);
      if (m) {
        const key = m[1];
        if (markers[key] === undefined) markers[key] = m[2].trim();
      }
    }
  };
  scan(prompt);
  scan(systemPrompt);
  return markers;
}

/** Parse a MOCK_*_FORM marker's one-line JSON, or null. A malformed marker must
 *  degrade to the canned body, never throw inside the mock. */
function tryParseMockJson(raw) {
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

async function ensureDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function exists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Emit a canned log line and yield to the event loop. */
async function emitLog(onEvent, text) {
  safeEmit(onEvent, { type: 'assistant', text, raw: { mock: true, text } });
  // Let consumers process the event; keeps mock async-realistic.
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * The roles the offline mock runner can SERVE — one per arm of the role switch
 * below (the `ask` arm is the Ask-Worca assistant, not a writer role). Exported
 * because three consumers need the vocabulary and none of them may hard-code it:
 * meta v2 validation (an unknown `mockRole` is a warning + drop), GET /api/agents
 * (the Agents view's role picker) and the graph executor's mock-role chain.
 * test/mock-writer-roles.test.mjs parses the switch and pins the lockstep.
 */
export const MOCK_WRITER_ROLES = new Set([
  'clarify', 'planner-plan', 'refiner', 'decomposer', 'implementer', 'reviewer', 'plan-review',
  'workspace-scan', 'agent-gen', 'workspace-reviewer', 'manual-tests-checklist', 'manual-web-ui-testing', 'memory-defrag',
  'generic-producer', 'generic-verifier', 'deck-builder', 'deck-audit', 'deck-export',
  'workspace-usage', 'workspace-synth',
]);

/** Named so the executor's mock-role chain and the switch cannot drift apart. */
export const MOCK_ROLE_CLARIFY = 'clarify';
export const MOCK_ROLE_DECOMPOSER = 'decomposer';

/** The memory defragmenter's role, exported like the other two named roles (the switch below
 *  still uses the literal string: mock-writer-roles.test.mjs parses the switch arms). */
export const MOCK_ROLE_MEMORY_DEFRAG = 'memory-defrag';

/**
 * The mock-fan-out roles (mirror the orchestrator's FANOUT_ELIGIBLE intent): the
 * roles whose real runs may spawn sub-agents. Keyed by the MOCK_ROLE strings.
 */
const MOCK_FANOUT_ROLES = new Set([
  'planner-plan', 'refiner', 'implementer', 'plan-review',
  'workspace-reviewer', 'workspace-scan', 'workspace-usage',
]);

/**
 * Emit a couple of fake sub-agent spawn (assistant.tool_use Agent) + finish
 * (user.tool_result) events for a fan-out-eligible role so the offline mock
 * exercises the sub-agent lifecycle indicator. No-op for other roles. The ids are
 * role-namespaced so concurrent mock nodes never collide on a tool_use id.
 */
async function emitMockSubAgents(role, onEvent, signal) {
  if (!MOCK_FANOUT_ROLES.has(role)) return;
  const labels = ['investigate area A', 'investigate area B'];
  const types = ['general-purpose', 'Explore'];   // exercise both a built-in and a named type
  const ids = labels.map((_, i) => `mock_${role}_${i + 1}`);

  // (1) MAIN-agent skill + MCP-tool use (no parent_tool_use_id) -> the step/group
  // header gets a blue `skill:graphify` pill AND a green three-part
  // `mcp:playwright:browser_snapshot` pill, so an offline run exercises BOTH pill
  // kinds on the header row, not just the sub-agent rows (§7.6).
  safeEmit(onEvent, {
    type: 'assistant',
    raw: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: `mock_${role}_skill`, name: 'Skill', input: { skill: 'graphify' } },
      { type: 'tool_use', id: `mock_${role}_mcp`, name: 'mcp__plugin_playwright_playwright__browser_snapshot', input: {} },
    ] } },
  });
  // (2) Spawns (one assistant event carrying both Agent tool_use blocks).
  safeEmit(onEvent, {
    type: 'assistant',
    raw: { type: 'assistant', message: { content: ids.map((id, i) => ({
      type: 'tool_use', id, name: 'Agent', input: { description: labels[i], subagent_type: types[i] },
    })) } },
  });
  await new Promise((r) => setTimeout(r, 0));
  abortIfNeeded(signal);
  // (3) The FIRST sub-agent uses a skill + TWO tools of the SAME MCP server (child
  // stream: parent_tool_use_id). Two tools on one server is the §7.1 granularity
  // change made visible offline: it yields TWO pills where it used to yield one.
  safeEmit(onEvent, {
    type: 'assistant',
    raw: { type: 'assistant', parent_tool_use_id: ids[0], message: { content: [
      { type: 'tool_use', id: `${ids[0]}_s1`, name: 'Skill', input: { skill: 'brainstorming' } },
      { type: 'tool_use', id: `${ids[0]}_s2`, name: 'mcp__plugin_playwright_playwright__browser_navigate', input: { url: 'http://localhost' } },
      { type: 'tool_use', id: `${ids[0]}_s3`, name: 'mcp__plugin_playwright_playwright__browser_click', input: { ref: 'e1' } },
    ] } },
  });
  await new Promise((r) => setTimeout(r, 0));
  abortIfNeeded(signal);
  // (4) Matching tool_result finishes.
  for (const id of ids) {
    safeEmit(onEvent, {
      type: 'user',
      raw: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } },
    });
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ── Ask Worca mock role (ask-worca-design.md §6.7) ───────────────────────────

/** Emit a raw stream-json frame through the SAME envelope runClaudeProcess uses (the rl 'line' handler above). */
function emitRaw(onEvent, raw) {
  const cost = extractResultCost(raw);
  const text = extractText(raw);
  safeEmit(onEvent, { type: raw.type, raw, text: text || undefined, ...(cost != null ? { costUsd: cost } : {}) });
}

const ASK_CONTEXT_BLOCK_RE = /\[worca context\][\s\S]*?\[\/worca context\]\s*/;

/**
 * The offline Ask Worca assistant: frames in the shapes probed on claude 2.1.239
 * (system/init → message_start → text deltas → assistant blocks → tool_use /
 * tool_result pairs → message_delta → result), chosen from the USER text so
 * tests control the scenario. Never touches the filesystem, never reads prompt
 * markers, never spawns the MCP child. The limit / failure scenarios emit their
 * `result` frame and then REJECT exactly like the real CLI (exit 1, empty stderr).
 */
async function mockAsk({ markers, prompt, cwd, onEvent, signal, resumeSessionId }) {
  const userText = String(prompt ?? '').replace(ASK_CONTEXT_BLOCK_RE, '');
  let card = {};
  try { card = markers.MOCK_ASK_CARD ? JSON.parse(markers.MOCK_ASK_CARD) : {}; } catch { card = {}; }
  if (!card || typeof card !== 'object' || Array.isArray(card)) card = {};
  const fail = /\bMOCK_FAIL\b/.test(userText);
  const maxTurns = /\bMOCK_MAX_TURNS\b/.test(userText);
  const maxBudget = /\bMOCK_MAX_BUDGET\b/.test(userText);
  const slow = /\bMOCK_SLOW\b/.test(userText);
  // P3 (PD11): a workflow-card EVENT is matched first — it contains the words "workflow" and, when thenRun, "run",
  // which would otherwise trip the two arms below. Then the workflow trigger, then the run proposal.
  const wfEvent = /^\s*\[worca event\] workflow card (card_[0-9a-f]{8}) (?:(declined)|saved as (\S+) "([^"]*)"; thenRun=(true|false))/.exec(userText);
  // A metrics-card EVENT, then the metrics trigger — both before the run arm, whose \brun\b would otherwise fire on
  // "include my runs"-style prose (it does not, \b stops at the s, but "propose" would).
  const tmEvent = /^\s*\[worca event\] (?:metrics|policy|model) card (card_[0-9a-f]{8}) (applied|declined|failed)/.exec(userText);
  // The metrics arm wants a CHANGE, not a question: "metrics" plus a verb of intent ("stop recording my metrics",
  // "route ... to the metrics home"). A bare "which workspaces use team metrics?" gets the generic echo answer.
  const metrics = !wfEvent && !tmEvent && /\bmetrics\b/i.test(userText)
    && /\b(?:stop|start|turn|toggle|switch|record\w*|route|change|enable|disable|set)\b/i.test(userText);
  // Scheduled runs (docs/scheduled-runs.md "Ask Worca"): a schedule-card EVENT; a CHANGE to an existing schedule
  // (its id in the text); or a new run to schedule ("schedule …"). All before the run arm, whose \brun\b would fire.
  const scEvent = /^\s*\[worca event\] schedule card (card_[0-9a-f]{8}) (applied|declined|failed)/.exec(userText);
  const scId = /\b(sch_[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(userText);
  const scChange = !wfEvent && !tmEvent && !scEvent && !!scId && /\b(?:run now|move|delete|cancel|edit|change)\b/i.test(userText);
  const scNew = !wfEvent && !tmEvent && !scEvent && !scChange && /\bschedul/i.test(userText);
  // The team-policy arm, the metrics rule: "policy" plus a verb of intent ("raise the policy cap to $30").
  // It proposes an edit of the context project's per-pipeline cap: `$<n>` in the text, else $30.
  const policy = !wfEvent && !tmEvent && !metrics && !scEvent && !scNew && !scChange && /\bpolicy\b/i.test(userText)
    && /\b(?:raise|lower|set|change|edit|make|cap)\b/i.test(userText);
  // A tracker task named by key ("fix jira bug PROJ-123"): the run's task is the issue (mock-source's
  // fixture plugin), and "auto" asks for the Auto workflow. Folds into the schedule and run arms.
  const taskKey = !wfEvent && !tmEvent && !scEvent && /\b(?:issue|ticket|bug|task)\b/i.test(userText) ? /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(userText) : null;
  const wantsAuto = /\bauto\b/i.test(userText);
  const workflow = !wfEvent && !tmEvent && !metrics && !policy && !scNew && !scChange && !taskKey && /\bworkflow\b/i.test(userText);
  const agents = !wfEvent && !tmEvent && /\bagents?\b/i.test(userText);
  // Models (docs/models.md "Ask Worca"): "add a local llama model" proposes a keyless llama.cpp entry; "remove model
  // <id>" its removal. The parent re-validates the INPUT against the real catalog and mints the card.
  const modelAdd = !wfEvent && !tmEvent && !scEvent && /\bllama\b/i.test(userText) && /\b(?:add|register)\b/i.test(userText);
  const modelRemove = !wfEvent && !tmEvent && !scEvent && !modelAdd ? /\bremove model ([A-Za-z0-9._-]+)/i.exec(userText) : null;
  const propose = !wfEvent && !tmEvent && !scEvent && !workflow && !metrics && !policy && !scNew && !scChange && !modelAdd && !modelRemove && (!!taskKey || /\b(propose|start|run)\b/i.test(userText));
  // The proposal both arms send: a brief, or the task reference instead of one.
  const proposal = () => {
    if (!taskKey) return { ...card, ...(wantsAuto ? { workflowId: 'wf_auto' } : {}) };
    const { brief: _brief, ...rest } = card;
    return { ...rest, ...(wantsAuto ? { workflowId: 'wf_auto' } : {}), source: { plugin: 'mock-source', sourceId: 'mock', taskId: taskKey[1] }, note: 'mock: the run reads the issue when it starts' };
  };
  const taskFrames = (MSG) => (taskKey ? [
    atool(MSG, 'toolu_mock_sources', 'mcp__worca__list_task_sources', {}),
    uresult('toolu_mock_sources', JSON.stringify({ sources: [{ plugin: 'mock-source', sourceId: 'mock', displayName: 'Mock Tasks' }] })),
    atool(MSG, 'toolu_mock_find', 'mcp__worca__find_tasks', { plugin: 'mock-source', sourceId: 'mock', search: taskKey[1] }),
    uresult('toolu_mock_find', JSON.stringify({ tasks: [{ id: taskKey[1], title: 'Mock task' }] })),
  ] : []);

  const SID = resumeSessionId || 'mock-session-ask-1';
  const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const firstLine = userText.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const ANSWER = `[mock] ${firstLine.slice(0, 200)}`;
  const init = { type: 'system', subtype: 'init', session_id: SID, cwd, model: 'mock', permissionMode: 'dontAsk',
    tools: ['Task', 'mcp__worca__list_runs', 'mcp__worca__get_run', 'mcp__worca__propose_run', 'mcp__worca__propose_workflow', 'mcp__worca__propose_metrics_change', 'mcp__worca__propose_policy_change', 'mcp__worca__get_away_mode', 'mcp__worca__set_away_now', 'mcp__worca__set_run_away_mode', 'mcp__worca__propose_away_mode_change'],
    mcp_servers: [{ name: 'worca', status: 'connected' }], plugins: [], skills: [], slash_commands: [], agents: [], uuid: 'mock-uuid-init' };
  const mstart = (id) => ({ type: 'stream_event', event: { type: 'message_start', message: { id, model: 'mock', role: 'assistant', content: [], usage: USAGE } }, parent_tool_use_id: null, session_id: SID });
  const delta = (t) => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }, parent_tool_use_id: null, session_id: SID });
  const mdelta = { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: USAGE }, parent_tool_use_id: null, session_id: SID };
  const atext = (id, t) => ({ type: 'assistant', message: { id, model: 'mock', role: 'assistant', content: [{ type: 'text', text: t }], usage: USAGE }, parent_tool_use_id: null, session_id: SID });
  const atool = (id, toolId, name, input, ptu = null) => ({ type: 'assistant', message: { id, model: 'mock', role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input, caller: { type: 'direct' } }], usage: USAGE }, parent_tool_use_id: ptu, session_id: SID });
  const uresult = (toolId, text, ptu = null, extra = {}) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text }] }] }, parent_tool_use_id: ptu, session_id: SID, ...extra });
  const result = (over = {}) => ({ type: 'result', subtype: 'success', is_error: false, duration_ms: 10, duration_api_ms: 8, num_turns: 1, session_id: SID, total_cost_usd: 0,
    usage: USAGE, modelUsage: {}, permission_denials: [], terminal_reason: 'completed', result: ANSWER, ...over });
  const MSG1 = 'msg_mock_ask_1';
  const MSG2 = 'msg_mock_ask_2';

  const frames = [init, mstart(MSG1)];
  if (fail) {
    frames.push(result({ subtype: 'error_during_execution', is_error: true, errors: ['mock failure'], terminal_reason: 'api_error', result: 'mock failure', num_turns: 0 }));
  } else if (maxTurns || maxBudget) {
    frames.push(delta('[mock] '), delta('partial'), atext(MSG1, '[mock] partial'),
      atool(MSG1, 'toolu_mock_1', 'mcp__worca__list_runs', {}), uresult('toolu_mock_1', '[]'));
    frames.push(maxTurns
      ? result({ subtype: 'error_max_turns', is_error: true, errors: ['Reached maximum number of turns (1)'], terminal_reason: 'max_turns', num_turns: 2, stop_reason: 'tool_use', result: undefined })
      : result({ subtype: 'error_max_budget_usd', is_error: true, errors: ['Reached maximum budget ($0.0001)'], terminal_reason: 'budget_exhausted', result: undefined }));
  } else {
    let answerMsg = MSG1;
    if (agents) {
      frames.push(
        atool(MSG1, 'toolu_mock_task', 'Agent', { description: 'count runs', subagent_type: 'general-purpose', prompt: 'count the runs' }),
        atool('msg_mock_child_1', 'toolu_mock_child_1', 'mcp__worca__list_runs', {}, 'toolu_mock_task'),
        uresult('toolu_mock_child_1', '[]', 'toolu_mock_task'),
        uresult('toolu_mock_task', 'count: 0', null, { tool_use_result: {
          status: 'completed', agentId: 'mock-agent-1', agentType: 'general-purpose', content: [{ type: 'text', text: 'count: 0' }],
          resolvedModel: 'mock-haiku', totalDurationMs: 10, totalTokens: 1234, totalToolUseCount: 1,
          usage: { input_tokens: 1000, output_tokens: 234, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        } }),
      );
      answerMsg = MSG2;
    }
    if (workflow) {
      // The result the real MCP child would return (plan PD1) — the parent re-assembles it with the real registry.
      const shape = normalizeShape(mockShapeFor(userText, { humanInLoop: true }));
      const wfInput = { task: userText.slice(0, 2000), projectKey: card.projectKey || null, thenRun: /\brun\b/i.test(userText) };
      frames.push(delta('[mock] '), delta('building '), delta('a workflow'), atext(MSG1, 'Building a workflow card.'),
        atool(MSG1, 'toolu_mock_workflow', 'mcp__worca__propose_workflow', wfInput),
        uresult('toolu_mock_workflow', JSON.stringify({ ok: true, mode: 'task', projectKey: card.projectKey || null, projectName: null, name: shape.name, match: null,
          warnings: [], summary: '', shape, costUsd: 0, fingerprint: 'top-level: (mock)\nhints: mock', note: '', thenRun: wfInput.thenRun })));
      answerMsg = MSG2;
    }
    if (metrics) {
      // The MCP child's validation result (metrics-proposal.mjs): the parent re-validates the INPUT and mints the card,
      // so a mock card always targets the context project's "Include my runs" switch (no git involved when applied).
      const tmInput = { kind: 'record', projectKey: card.projectKey || null, record: false, note: 'mock: stop recording my runs here' };
      frames.push(delta('[mock] '), delta('proposing '), delta('a metrics change'), atext(MSG1, 'Proposing a metrics change card.'),
        atool(MSG1, 'toolu_mock_metrics', 'mcp__worca__propose_metrics_change', tmInput),
        uresult('toolu_mock_metrics', JSON.stringify({ ok: true, card: { type: 'metrics', ...tmInput } })));
      answerMsg = MSG2;
    }
    if (policy) {
      const usd = Number((/\$\s*(\d+(?:\.\d+)?)/.exec(userText) || [])[1] || 30);
      const tpInput = { kind: 'edit', projectKey: card.projectKey || null, set: [{ key: 'cost.pipelineLimitUsd', value: usd, kind: 'soft' }], note: 'mock: change the team per-pipeline cap' };
      frames.push(delta('[mock] '), delta('proposing '), delta('a policy change'), atext(MSG1, 'Proposing a policy change card.'),
        atool(MSG1, 'toolu_mock_policy', 'mcp__worca__propose_policy_change', tpInput),
        uresult('toolu_mock_policy', JSON.stringify({ ok: true, card: { type: 'policy', ...tpInput } })));
      answerMsg = MSG2;
    }
    if (scNew) {
      // The parent re-validates the INPUT with the real validator: "every" in the text makes a weekday series,
      // anything else a one-off two minutes out (short enough to watch the server start it).
      const every = /\bevery\b/i.test(userText);
      const input = { ...proposal(), ...(every ? { every: 'weekdays 02:00' } : { when: '+2m' }) };
      frames.push(...taskFrames(MSG1));
      frames.push(delta('[mock] '), delta('scheduling '), delta('a run'), atext(MSG1, every ? 'Scheduling it every weekday at 02:00.' : 'Scheduling it two minutes from now.'),
        atool(MSG1, 'toolu_mock_preview', 'mcp__worca__preview_schedule', every ? { every: 'weekdays 02:00' } : { when: '+2m' }),
        uresult('toolu_mock_preview', JSON.stringify({ ok: true, kind: every ? 'repeat' : 'once' })),
        atool(MSG1, 'toolu_mock_propose', 'mcp__worca__propose_run', input), uresult('toolu_mock_propose', JSON.stringify({ ok: true })));
      answerMsg = MSG2;
    }
    if (scChange) {
      const t = userText.toLowerCase();
      const action = /run now/.test(t) ? 'run_now' : /\bmove\b/.test(t) ? 'move' : /\bdelete\b/.test(t) ? 'delete' : /\bcancel\b/.test(t) ? 'cancel' : 'edit';
      const input = { id: scId[1], action, ...(action === 'move' ? { when: '+5m' } : action === 'edit' ? { every: 'weekdays 03:00' } : {}), note: 'mock: as asked' };
      frames.push(delta('[mock] '), delta('proposing '), delta('a schedule change'), atext(MSG1, 'Proposing a schedule change card.'),
        atool(MSG1, 'toolu_mock_sched', 'mcp__worca__propose_schedule_change', input), uresult('toolu_mock_sched', JSON.stringify({ ok: true })));
      answerMsg = MSG2;
    }
    if (scEvent) {
      const line = scEvent[2] === 'declined' ? 'Declined — nothing changed.' : scEvent[2] === 'failed' ? 'The change failed; check the error and try again.' : 'Done.';
      frames.push(delta('[mock] '), delta(scEvent[2]), atext(MSG1, line));
      answerMsg = MSG2;
    }
    if (tmEvent) {
      const line = tmEvent[2] === 'declined' ? 'Declined — nothing changed.' : tmEvent[2] === 'failed' ? 'The change failed; check the error and try again.' : 'Applied.';
      frames.push(delta('[mock] '), delta(tmEvent[2]), atext(MSG1, line));
      answerMsg = MSG2;
    }
    if (wfEvent) {
      // Every event arm answers on MSG2: a second atext on MSG1 would REPLACE the first reply's text.
      if (wfEvent[2] === 'declined') {
        frames.push(delta('[mock] '), delta('declined'), atext(MSG1, 'Declined. Want another auto workflow, tell me what to change, or pick a saved workflow?'));
      } else if (wfEvent[5] === 'true') {
        frames.push(delta('[mock] '), delta('proposing '), delta('a run'), atext(MSG1, `Proposing a run with "${wfEvent[4]}".`),
          atool(MSG1, 'toolu_mock_propose', 'mcp__worca__propose_run', { ...card, workflowId: wfEvent[3], brief: `Run with "${wfEvent[4]}"` }),
          uresult('toolu_mock_propose', JSON.stringify({ ok: true })));
      } else {
        frames.push(delta('[mock] '), delta('saved'), atext(MSG1, `Saved "${wfEvent[4]}". Say "run it" when you want a run with it.`));
      }
      answerMsg = MSG2;
    }
    if (modelAdd || modelRemove) {
      const mInput = modelAdd
        ? { kind: 'add_model', model: { id: 'local-llama', label: 'Local llama', upstream: { provider: 'openai', api: 'openai-chat', model: 'qwen', baseUrl: 'http://127.0.0.1:8080/v1', capabilities: { maxPromptTokens: 65536, maxOutputTokens: 8192 } } }, note: 'mock: a local llama.cpp server' }
        : { kind: 'remove_model', id: modelRemove[1], note: 'mock: as asked' };
      frames.push(delta('[mock] '), delta('proposing '), delta('a model change'), atext(MSG1, 'Proposing a model change card.'),
        atool(MSG1, 'toolu_mock_model', 'mcp__worca__propose_model_change', mInput), uresult('toolu_mock_model', JSON.stringify({ ok: true })));
      answerMsg = MSG2;
    }
    if (propose) {
      frames.push(delta('[mock] '), delta('preparing '), delta('a run'), atext(MSG1, 'Preparing a run card.'), ...taskFrames(MSG1),
        atool(MSG1, 'toolu_mock_propose', 'mcp__worca__propose_run', proposal()), uresult('toolu_mock_propose', JSON.stringify({ ok: true })));
      answerMsg = MSG2;
    }
    if (answerMsg !== MSG1) frames.push(mstart(answerMsg));
    frames.push(delta('[mock] '), delta(firstLine.slice(0, 200)), atext(answerMsg, ANSWER), mdelta);
    frames.push(result(agents
      ? { modelUsage: { 'mock-haiku': { inputTokens: 1000, outputTokens: 234, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0, canonicalModel: 'mock-haiku' } } }
      : {}));
  }

  safeEmit(onEvent, { type: 'session', sessionId: SID });
  for (const f of frames) {
    abortIfNeeded(signal);
    emitRaw(onEvent, f);
    await new Promise((r) => setTimeout(r, slow ? 300 : 0));
  }
  abortIfNeeded(signal);
  if (fail || maxTurns || maxBudget) {
    // Probed on 2.1.239: these subtypes exit 1 with EMPTY stderr, so runClaudeProcess rejects with the
    // stdout `result` text (MOCK_FAIL) or 'no stderr' (the limits). turn.mjs (P2) reads the
    // reducer's resultSubtype before classifying the rejection.
    const err = new Error(`claude exited with code 1: ${fail ? 'mock failure' : 'no stderr'}`);
    err.errorClass = null;
    throw err;
  }
  return { text: ANSWER, exitCode: 0 };
}

function abortIfNeeded(signal) {
  if (signal?.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Offline mock: emits a few log lines and performs role-appropriate writes.
 */
export async function runMock({ cwd, systemPrompt, prompt, onEvent, signal, resumeSessionId, workspaceWriteTargets, permissionMode }) {
  abortIfNeeded(signal);
  // Ask Worca mock role (ask-worca-design.md §6.7): detected from the SYSTEM PROMPT
  // ONLY and dispatched before any prompt-sourced marker is honoured — a chat
  // message containing `MOCK_ASK: /x.json` (or any MOCK_* line) must never reach
  // the MOCK_ASK file-write arm below, and the user text can never pick the role.
  // `dontAsk` is the ask recipe's permission mode and has no legacy caller
  // (spawn.mjs:20), so it takes the ask arm markers or not: a P2 turn that forgot
  // `turn.mock` must not fall through to parseMarkers(prompt)/inferRole, where the
  // chat text alone picks a role that writes to the scratch cwd.
  const sysMarkers = parseMarkers('', systemPrompt);
  if (sysMarkers.MOCK_ROLE === 'ask' || permissionMode === 'dontAsk') {
    return mockAsk({ markers: sysMarkers, prompt, cwd, onEvent, signal, resumeSessionId });
  }
  const m = parseMarkers(prompt, systemPrompt);
  const role = m.MOCK_ROLE || inferRole(prompt, systemPrompt);
  const cycle = Number(m.MOCK_CYCLE || '1') || 1;

  // Pause/Resume parity with the real runner: deterministic per-role session ids,
  // and an assertable log line when a session is re-attached.
  const sessionId = `mock-session-${role || 'unknown'}-c${cycle}`;
  safeEmit(onEvent, { type: 'session', sessionId });
  if (resumeSessionId) await emitLog(onEvent, `[mock] resumed session ${resumeSessionId}`);

  await emitLog(onEvent, `[mock] starting role=${role || 'unknown'} cycle=${cycle}`);
  abortIfNeeded(signal);

  // Ask-then-resume (spec 2026-07-11): asking replaces the role side effects
  // for this invocation; the orchestrator gates the user and resumes. The
  // session event above already fired, so the resume has a session id.
  if (m.MOCK_ASK && permissionMode !== 'dontAsk') {   // belt and braces: dontAsk already took the ask arm above
    await ensureDir(m.MOCK_ASK);
    // MOCK_ASK_FORM (ask-forms §4): a one-line {"form","data"} payload, written
    // verbatim. Unparseable => the canned questions body, so a typo degrades to
    // today's behaviour instead of writing garbage the gate then refuses.
    const formBody = m.MOCK_ASK_FORM ? tryParseMockJson(m.MOCK_ASK_FORM) : null;
    const body = formBody || {
      questions: [{ id: 'q1', question: `Mock question from ${role}?`, options: ['Option A', 'Option B'], allowFreeText: true }],
    };
    await writeFile(m.MOCK_ASK, JSON.stringify(body, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_ASK}`, raw: { mock: true, file: m.MOCK_ASK } });
    safeEmit(onEvent, { type: 'result', costUsd: 0, raw: { mock: true, type: 'result', total_cost_usd: 0 } });
    await emitLog(onEvent, `[mock] ${formBody ? 'form ask' : 'questions'} written; stopping for answers (role=${role})`);
    return { text: '[mock] asked questions', exitCode: 0 };
  }

  let text = `[mock] role ${role} complete`;
  switch (role) {
    case MOCK_ROLE_CLARIFY:
      text = await mockClarify(m, cycle, onEvent);
      break;
    case 'planner-plan':
      text = await mockPlannerPlan(m, onEvent);
      break;
    case 'refiner':
      text = await mockRefiner(m, cycle, onEvent);
      break;
    case MOCK_ROLE_DECOMPOSER:
      text = await mockDecomposer(m, onEvent);
      break;
    case 'implementer':
      text = await mockImplementer(m, cwd, onEvent, workspaceWriteTargets);
      break;
    case 'reviewer':
      text = await mockReviewer(m, cycle, onEvent);
      break;
    case 'plan-review':
      text = await mockPlanReview(m, cycle, onEvent);
      break;
    case 'workspace-scan':
      text = await mockWorkspaceSurvey(m, onEvent);
      break;
    case 'workspace-usage':
      text = await mockWorkspaceUsage(m, onEvent);
      break;
    case 'workspace-synth':
      text = await mockWorkspaceSynth(m, onEvent);
      break;
    case 'agent-gen':
      text = await mockAgentGen(m, onEvent);
      break;
    case 'workspace-reviewer':
      text = await mockWorkspaceReviewer(m, cycle, onEvent);
      break;
    case 'manual-tests-checklist':
      text = await mockManualTestsChecklist(m, onEvent);
      break;
    case 'manual-web-ui-testing':
      text = await mockManualWebUiTesting(m, cycle, onEvent);
      break;
    case 'memory-defrag':
      text = await mockMemoryDefrag(m, systemPrompt, onEvent);
      break;
    case 'generic-producer':
      text = await mockGenericProducer(m, onEvent);
      break;
    case 'generic-verifier':
      // Reuses the reviewer mock: writes MOCK_OUT md + MOCK_JSON verdict with the
      // standard cycle-decreasing severity, so generic loops terminate offline.
      text = await mockReviewer(m, cycle, onEvent);
      break;
    case 'deck-builder':
      text = await mockDeckBuilder(m, onEvent);
      break;
    case 'deck-audit':
      text = await mockDeckAudit(m, cycle, onEvent);
      break;
    case 'deck-export':
      text = await mockDeckExport(m, cycle, onEvent);
      break;
    default:
      await emitLog(onEvent, `[mock] no side effects for unknown role`);
      break;
  }

  abortIfNeeded(signal);
  // Offline sub-agent indicator: for the fan-out-eligible roles, emit a couple of
  // fake Task/Agent spawn tool_use blocks + matching tool_result finishes so
  // `npm run smoke` exercises the sub-agent lifecycle (squares/pill) with no real
  // claude. Shapes mirror the real stream: spawn = assistant.tool_use(Agent) with
  // an id; finish = user.tool_result with that tool_use_id. Non-fan-out roles emit
  // nothing, so their mock output is unchanged.
  await emitMockSubAgents(role, onEvent, signal);
  abortIfNeeded(signal);
  // No model was called, so the truthful spend is $0. Emit a result event the
  // orchestrator attributes to the current phase, so mock/demo runs still show
  // a (zero) per-phase and total cost in the UI.
  safeEmit(onEvent, { type: 'result', costUsd: 0, raw: { mock: true, type: 'result', total_cost_usd: 0 } });
  await emitLog(onEvent, `[mock] done role=${role}`);
  return { text, exitCode: 0 };
}

/** Best-effort role inference if MOCK_ROLE is absent. */
function inferRole(prompt, systemPrompt) {
  const hay = `${prompt}\n${systemPrompt}`.toLowerCase();
  if (hay.includes('clarif')) return 'clarify';
  if (hay.includes('refine')) return 'refiner';
  if (hay.includes('review')) return 'reviewer';
  if (hay.includes('implement')) return 'implementer';
  if (hay.includes('plan')) return 'planner-plan';
  return 'unknown';
}

async function mockClarify(m, cycle, onEvent) {
  const out = m.MOCK_OUT;
  // Ask one question while no answers have been fed back; once the user's prior
  // answers are present (MOCK_PRIOR > 0) report no further questions so the
  // orchestrator's clarify loop terminates naturally. This mirrors the real fix:
  // the loop converges because answers are returned to the planner.
  const hasPrior = Number(m.MOCK_PRIOR || '0') > 0;
  // MOCK_ASK_FORM (ask-forms §4): a one-line {"form","data"} payload, written VERBATIM
  // to the answers port instead of the canned questions — the clarifier's half of the
  // marker (the producer's half is the MOCK_ASK arm in runMock). Unparseable => canned.
  const formBody = m.MOCK_ASK_FORM ? tryParseMockJson(m.MOCK_ASK_FORM) : null;
  const payload = formBody || (hasPrior
    ? { questions: [] }
    : {
        questions: [
          {
            id: 'invalid-input',
            question:
              'How should the feature handle invalid input — fail fast, coerce, or ignore?',
            options: [
              'Fail fast with a clear error',
              'Coerce to a safe default',
              'Ignore and continue',
              'Reject at the boundary', // 4 options — exercises the upper bound
            ],
            // Recommendation fields (normalizeClarify): bars, badge and night mode's weights strategy.
            confidence: [70, 15, 5, 10],
            recommended: 'Fail fast with a clear error',
            allowFreeText: true,
          },
          {
            id: 'delete-behavior',
            question: 'Should delete be a hard delete or a soft delete?',
            options: ['Hard delete', 'Soft delete'], // 2 options — exercises the relaxed floor
            allowFreeText: true,
          },
        ],
      });
  await emitLog(
    onEvent,
    formBody ? '[mock] clarifier asking with a form' : hasPrior
      ? '[mock] planner has no further questions'
      : '[mock] planner asking one clarifying question',
  );
  if (!out) return '[mock] clarify: no MOCK_OUT given';
  await ensureDir(out);
  await writeFile(out, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return JSON.stringify(payload);
}

/** Generic producer mock: deterministic content to MOCK_OUT (json if the path
 *  ends .json, else markdown). Lets user-defined agents run offline with no
 *  bespoke mock branch. */
async function mockGenericProducer(m, onEvent) {
  const out = m.MOCK_OUT;
  await emitLog(onEvent, '[mock] generic producer writing output artifact');
  if (!out) return '[mock] generic-producer: no MOCK_OUT given';
  const body = out.endsWith('.json')
    ? JSON.stringify({ mock: true, note: 'generic artifact' }, null, 2) + '\n'
    : '# Mock artifact\n\nDeterministic generic producer output.\n';
  await ensureDir(out);
  await writeFile(out, body, 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return `[mock] generic artifact written to ${out}`;
}

/** The scope dirs the `## Worca memory` block of a system prompt names (memory-store.mjs
 *  renderMemoryBlock: `<label> — <abs dir>:` lines under the heading; the block is contiguous,
 *  so the first blank line ends it). The mock defragmenter finds its mount exactly the way the
 *  real agent is told to — from its system prompt — so no MOCK marker is needed. Exported for
 *  the parity test against a real renderMemoryBlock output. Both captures are greedy: a project
 *  LABEL may itself contain ` — ` (the renderer's separator is the last one on the line), and a
 *  Windows dir carries a drive colon while the line still ends with `:`. */
export function memoryDirsFromPrompt(systemPrompt) {
  const text = String(systemPrompt || '');
  const at = text.indexOf('## Worca memory');
  if (at === -1) return [];
  const out = [];
  for (const line of text.slice(at).split(/\r?\n/).slice(1)) {
    if (!line.trim()) break;
    const m = line.match(/^(?:Global|Project .*) — (.+):$/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Memory defragment mock (agent-memory-design.md §7.1): in the FIRST scope dir the system
 *  prompt names, fold the second (sorted) file's body into the first and EMPTY it (amendment
 *  B19 — the memory tool set cannot unlink, so this is the path the real agent takes), then
 *  write the report to MOCK_OUT. A defrag run mounts exactly ONE scope dir. */
async function mockMemoryDefrag(m, systemPrompt, onEvent) {
  const out = m.MOCK_OUT;
  const dir = memoryDirsFromPrompt(systemPrompt)[0] || null;
  await emitLog(onEvent, '[mock] memory defragmenter restructuring the mounted scope');
  const lines = ['# Memory defragment report', ''];
  let merged = null;
  if (dir) {
    const files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort();
    if (files.length < 2) {
      lines.push(`- ${dir}: ${files.length} file(s), nothing to merge`);
    } else {
      const [a, b] = files;
      const bodyB = (await readFile(join(dir, b), 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '');
      const text = `${await readFile(join(dir, a), 'utf8')}\n## Merged from ${b.slice(0, -3)}\n\n${bodyB}`;
      await writeFile(join(dir, a), text, 'utf8');
      await writeFile(join(dir, b), '', 'utf8');            // B19: an EMPTIED mount file is a deletion request
      merged = [a, b];
      lines.push(`- ${dir}: merged ${b} into ${a}; emptied ${b} (worca removes it at sync-back)`);
      safeEmit(onEvent, { type: 'tool_use', text: `merged ${join(dir, b)} into ${join(dir, a)}`, raw: { mock: true, file: join(dir, a) } });
    }
  } else {
    lines.push('- no memory scope in the system prompt: nothing to defragment');
  }
  if (out) {
    await ensureDir(out);
    await writeFile(out, `${lines.join('\n')}\n`, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  }
  return merged ? `[mock] memory defragment: merged ${merged[1]} into ${merged[0]}` : '[mock] memory defragment: nothing to merge';
}

/** A 1×1 opaque PNG — enough for a real image/png magic number and a viewer <img>. */
const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const MOCK_KIT_FILES = ['deck-stage.js', 'deck-enhance.js', 'deck-export.js', 'deck-audit.js'];

/** Smallest structurally-valid PDF: one empty page. The golden run asserts the
 *  deliverable EXISTS and is a PDF; it never parses it. */
const MOCK_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 1920 1080]>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

/** Writes deck-manifest.md (MOCK_OUT) plus deck/{deck,proof}.html and stub kit
 *  copies beside it — the subfolder tree the sidecar's extraFiles index. */
async function mockDeckBuilder(m, onEvent) {
  const out = m.MOCK_OUT;
  if (!out) return '[mock] deck-builder: no MOCK_OUT given';
  const pdir = dirname(out);
  const deckDir = join(pdir, 'deck');
  await mkdir(deckDir, { recursive: true });
  const slides = ['Worca cuts review cost', 'Three loops, one gate', 'The ask'];
  const sections = slides.map((t, i) => `  <section data-label="${String(i + 1).padStart(2, '0')} · ${t}"><h1>${t}</h1>${i === 1 ? '<p data-step="1">Reveal one</p>' : ''}</section>`).join('\n');
  const html = (proof) =>
    '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="generator" content="OpenDeck 1.0.0"><title>Mock deck</title>' +
    '<style>section{font-size:48px}h1{font-size:72px}</style></head><body>\n' +
    `<deck-stage width="1920" height="1080"${proof ? ' noscale' : ''}>\n${proof ? sections.replace(/data-step="1"/g, 'data-step="1" class="step-visible"') : sections}\n</deck-stage>\n` +
    '<script type="application/json" id="speaker-notes">["", "", ""]</script>\n' +
    '<script src="deck-stage.js"></script>\n' + (proof ? '<script src="deck-audit.js"></script>\n' : '<script src="deck-enhance.js"></script>\n<script src="deck-export.js"></script>\n') +
    '</body></html>\n';
  await writeFile(join(deckDir, 'deck.html'), html(false), 'utf8');
  await writeFile(join(deckDir, 'proof.html'), html(true), 'utf8');
  for (const f of MOCK_KIT_FILES) await writeFile(join(deckDir, f), `/* mock ${f} */\n`, 'utf8');
  const manifest = '# Deck manifest\nMode: live   Slides: 3   Kit: 1.0.0\nDeck: deck/deck.html   Proof: deck/proof.html\n\n' +
    '| # | Title | Composition | Ground | Steps | Skipped |\n|---|---|---|---|---|---|\n' +
    slides.map((t, i) => `| ${i + 1} | ${t} | statement | dark | ${i === 1 ? 1 : 0} | no |`).join('\n') +
    '\n\n## Changed this cycle\n- first build\n';
  await ensureDir(out);
  await writeFile(out, manifest, 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return `[mock] deck written to ${deckDir}`;
}

/** Writes the two single-file deliverables beside the deck, then a clean
 *  verdict. Mocked as bytes, not built — the offline run proves the pipeline
 *  CARRIES deliverables to the end, which is the check that was missing when a
 *  run finished "clean" having produced neither. */
async function mockDeckExport(m, cycle, onEvent) {
  const jsonPath = m.MOCK_JSON;
  const mdPath = m.MOCK_OUT;
  // Degrade the way mockDeckBuilder does: a graph that wires neither the verdict
  // nor the report port would otherwise throw TypeError out of node:path.
  if (!jsonPath && !mdPath) return '[mock] deck-export: no MOCK_JSON or MOCK_OUT given';
  const pdir = dirname(jsonPath || mdPath);
  const deckDir = join(pdir, 'deck');
  await mkdir(deckDir, { recursive: true });
  const src = await readFile(join(deckDir, 'deck.html'), 'utf8').catch(() => '<!DOCTYPE html>\n');
  // FALLBACK ONLY, mirroring the real agent: the deckBundle card owns the single
  // file, and this step builds one itself only when the card left none — a host
  // with no python interpreter, or a mock run, where the card writes just its
  // report. A real standalone inlines every companion; the mock mirrors the
  // property the golden run asserts, not the bundler's actual output.
  const standalone = join(deckDir, 'deck.standalone.html');
  if (!existsSync(standalone)) {
    await writeFile(standalone,
      src.replace(/<script src="([^"]+)"><\/script>/g, (_m2, f) => `<script>/* inlined ${f} */</script>`), 'utf8');
  }
  await writeFile(join(deckDir, 'deck.pdf'), MOCK_PDF);
  const verdict = { issues: [], summary: '3 slides, 3 PDF pages, standalone has no external refs. task.md named no extra deliverable.' };
  if (jsonPath) { await ensureDir(jsonPath); await writeFile(jsonPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8'); }
  if (mdPath) {
    await ensureDir(mdPath);
    await writeFile(mdPath, `# Deck export — cycle ${cycle}\n\n- deck/deck.pdf — 3 pages\n- deck/deck.standalone.html — self-contained\n\nNo blocking findings.\n`, 'utf8');
  }
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${join(deckDir, 'deck.pdf')}`, raw: { mock: true, file: join(deckDir, 'deck.pdf') } });
  return `[mock] deliverables written to ${deckDir}`;
}

/** Writes shots/s01..s03.png beside the verdict, then the standard
 *  cycle-decreasing verdict (major on cycle 1, suggestion after). */
async function mockDeckAudit(m, cycle, onEvent) {
  const jsonPath = m.MOCK_JSON;
  const mdPath = m.MOCK_OUT;
  // Degrade the way mockDeckBuilder does: a graph that wires neither the verdict
  // nor the report port would otherwise throw TypeError out of node:path.
  if (!jsonPath && !mdPath) return '[mock] deck-audit: no MOCK_JSON or MOCK_OUT given';
  const pdir = dirname(jsonPath || mdPath);
  const shots = join(pdir, 'shots');
  await mkdir(shots, { recursive: true });
  for (let i = 1; i <= 3; i++) await writeFile(join(shots, `s${String(i).padStart(2, '0')}.png`), MOCK_PNG);
  const review = cycle <= 1
    ? { summary: '3 slides audited (mode live). 1 slide with clipped text. Screenshots in shots/.',
        issues: [{ severity: 'major', title: 'Slide 2: clipped text', detail: 'p (scrollWidth 1980 > clientWidth 1840)', location: 'deck/deck.html slide 2 (shots/s02.png)' }] }
    : { summary: '3 slides audited (mode live). No blocking facts. Screenshots in shots/.',
        issues: [{ severity: 'suggestion', title: 'Slide 3 has 4 words', detail: 'below the 30-word budget', location: 'shots/s03.png' }] };
  if (mdPath) {
    await ensureDir(mdPath);
    await writeFile(mdPath, `# Deck audit (cycle ${cycle})\n\n${review.summary}\n\n` + review.issues.map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail}`).join('\n') + '\n', 'utf8');
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

async function mockPlannerPlan(m, onEvent) {
  const out = m.MOCK_OUT;
  const base = m.MOCK_BASE || 'feature';
  await emitLog(onEvent, '[mock] planner writing initial plan with code snippet');
  if (!out) return '[mock] planner-plan: no MOCK_OUT given';
  const md = mockPlanMarkdown(base, 1);
  await ensureDir(out);
  await writeFile(out, md, 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return `[mock] plan written to ${out}`;
}

function mockPlanMarkdown(base, version) {
  return (
    `# Plan: ${base} (v${version})\n\n` +
    `## Overview\n\n` +
    `Deterministic mock plan for "${base}". Implements a small module using TDD.\n\n` +
    `## Steps\n\n` +
    `1. Write a failing test for the core function.\n` +
    `2. Implement the function until the test passes.\n` +
    `3. Refactor for clarity.\n\n` +
    `## Code Snippets\n\n` +
    '```js\n' +
    `// src/feature.mjs\n` +
    `export function feature(input) {\n` +
    `  if (input == null) throw new Error('input required');\n` +
    `  return String(input).trim();\n` +
    `}\n` +
    '```\n\n' +
    '```js\n' +
    `// test/feature.test.mjs\n` +
    `import { feature } from '../src/feature.mjs';\n` +
    `import assert from 'node:assert';\n` +
    `assert.equal(feature('  hi '), 'hi');\n` +
    '```\n\n' +
    `## Clarifications (Q&A)\n\n` +
    `- **Q:** How should the feature handle invalid input?\n` +
    `  - **A:** Fail fast with a clear error\n`
  );
}

async function mockRefiner(m, cycle, onEvent) {
  const out = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  const base = m.MOCK_BASE || 'feature';
  await emitLog(onEvent, `[mock] refiner reviewing plan (cycle ${cycle})`);

  // Seed the -vN plan from the input plan if available, else from template.
  if (out) {
    let body = '';
    if (m.MOCK_IN && (await exists(m.MOCK_IN))) {
      try {
        body = await readFile(m.MOCK_IN, 'utf8');
      } catch {
        body = '';
      }
    }
    if (!body) body = mockPlanMarkdown(base, cycle + 1);
    const refined =
      body +
      `\n## Refinement notes (cycle ${cycle})\n\n` +
      `- Tightened error handling and added an edge-case test.\n`;
    await ensureDir(out);
    await writeFile(out, refined, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  }

  // Cycle 1 has one blocking (major) issue; cycle >=2 has only minor.
  const review =
    cycle <= 1
      ? {
          summary: 'Plan is mostly solid but one major gap remains.',
          issues: [
            {
              severity: 'major',
              title: 'Missing error-path test',
              detail: 'The plan does not test the invalid-input branch.',
              location: 'test/feature.test.mjs',
            },
            {
              severity: 'minor',
              title: 'Naming',
              detail: 'Consider a more descriptive function name.',
              location: 'src/feature.mjs',
            },
          ],
        }
      : {
          summary: 'No blocking issues remain.',
          issues: [
            {
              severity: 'minor',
              title: 'Doc comment',
              detail: 'Add a short JSDoc to the exported function.',
              location: 'src/feature.mjs',
            },
          ],
        };

  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

async function mockDecomposer(m, onEvent) {
  const out = m.MOCK_OUT;
  const tasksDir = m.MOCK_TASKS_DIR;
  if (!out || !tasksDir) return '[mock] decomposer: no MOCK_OUT / MOCK_TASKS_DIR given';
  await mkdir(tasksDir, { recursive: true });
  const phases = [
    { ordinal: 1, tasks: [
      { id: 'p1t1', title: 'Slice one', file: 'tasks/p1-t1-slice-one.md' },
      { id: 'p1t2', title: 'Slice two', file: 'tasks/p1-t2-slice-two.md' },
    ] },
    { ordinal: 2, tasks: [
      { id: 'p2t1', title: 'Slice three', file: 'tasks/p2-t1-slice-three.md' },
    ] },
  ];
  for (const ph of phases) {
    for (const t of ph.tasks) {
      await writeFile(join(tasksDir, t.file.replace(/^tasks\//, '')),
        `# ${t.title}\n\nSelf-contained mock task for phase ${ph.ordinal}.\n`, 'utf8');
    }
  }
  await writeFile(out, JSON.stringify({ phases }, null, 2) + '\n', 'utf8');
  await emitLog(onEvent, `[mock] decomposer wrote ${phases.length} phases`);
  return '[mock] decomposer complete';
}

/**
 * §8.10: the mock's only cwd-dependent role. `workspaceWriteTargets` (threaded
 * runOpts -> runClaude -> runMock -> here) redirects the writes into EVERY member
 * checkout on a detached workspace run, where `cwd` is the run root and therefore no
 * repository: writing there would leave every member clean, commit nothing, and
 * produce an empty patch. Empty/absent targets keep today's exact single-dir
 * behavior — the same `edited …` event and the same returned text — so single-project
 * runs and legacy workspace runs are byte-identical. `ctx.workspace` is NOT available
 * here by design; these absolute paths are the only channel.
 */
async function mockImplementer(m, cwd, onEvent, workspaceWriteTargets) {
  await emitLog(onEvent, '[mock] implementer applying plan via TDD (red-green-refactor)');
  const targets = Array.isArray(workspaceWriteTargets) && workspaceWriteTargets.length
    ? workspaceWriteTargets
    : [cwd];
  // One stamp for the whole invocation, so a multi-member pass is deterministic.
  const stamp = new Date().toISOString();
  const written = [];
  for (const target of targets) {
    const srcDir = join(target, 'src');
    const testDir = join(target, 'test');
    await mkdir(srcDir, { recursive: true });
    await mkdir(testDir, { recursive: true });

    const srcFile = join(srcDir, 'feature.mjs');
    const testFile = join(testDir, 'feature.test.mjs');

    // Append (not overwrite) so repeated fix cycles keep producing a non-empty diff.
    const srcContent =
      `// generated by mock implementer @ ${stamp}\n` +
      `export function feature(input) {\n` +
      `  if (input == null) throw new Error('input required');\n` +
      `  return String(input).trim();\n` +
      `}\n`;
    if (await exists(srcFile)) {
      await appendFile(srcFile, `\n// fix pass @ ${stamp}\n`, 'utf8');
    } else {
      await writeFile(srcFile, srcContent, 'utf8');
    }

    const testContent =
      `// generated by mock implementer @ ${stamp}\n` +
      `import { feature } from '../src/feature.mjs';\n` +
      `import assert from 'node:assert';\n` +
      `assert.equal(feature('  hi '), 'hi');\n` +
      `assert.throws(() => feature(null));\n`;
    if (await exists(testFile)) {
      await appendFile(testFile, `\n// fix pass @ ${stamp}\n`, 'utf8');
    } else {
      await writeFile(testFile, testContent, 'utf8');
    }

    safeEmit(onEvent, { type: 'tool_use', text: `edited ${srcFile} and ${testFile}`, raw: { mock: true } });
    written.push({ srcFile, testFile });
  }
  if (written.length === 1) {
    return `[mock] implemented feature in ${written[0].srcFile} with test ${written[0].testFile}`;
  }
  return `[mock] implemented feature in ${written.length} member checkouts: ` +
    written.map((w) => w.srcFile).join(', ');
}

async function mockReviewer(m, cycle, onEvent) {
  const mdPath = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  await emitLog(onEvent, `[mock] reviewer reviewing git diff (cycle ${cycle})`);

  // Cycle 1: one major. Cycle >=2: only suggestion. Loop terminates by cycle 2.
  const review =
    cycle <= 1
      ? {
          summary: 'Implementation works but a major issue needs a fix.',
          issues: [
            {
              severity: 'major',
              title: 'Unhandled empty-string input',
              detail: 'feature("") returns "" but the plan expects a thrown error.',
              location: 'src/feature.mjs',
            },
          ],
        }
      : {
          summary: 'Looks good. Only a suggestion remains.',
          issues: [
            {
              severity: 'suggestion',
              title: 'Add a usage example',
              detail: 'A short example in the README would help.',
              location: 'README.md',
            },
          ],
        };

  if (mdPath) {
    const md =
      `# Implementation Review (cycle ${cycle})\n\n` +
      `## Summary\n\n${review.summary}\n\n` +
      `## Issues\n\n` +
      review.issues
        .map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`)
        .join('\n') +
      '\n';
    await ensureDir(mdPath);
    await writeFile(mdPath, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${mdPath}`, raw: { mock: true, file: mdPath } });
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

async function mockPlanReview(m, cycle, onEvent) {
  const mdPath = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  await emitLog(onEvent, `[mock] plan reviewer reviewing the plan (cycle ${cycle})`);

  const review =
    cycle <= 1
      ? {
          summary: 'Plan is close but one major gap blocks implementation.',
          issues: [
            {
              severity: 'major',
              title: 'Missing error-path coverage in the plan',
              detail: 'The plan does not specify a test for the invalid-input branch.',
              location: 'Steps / Code Snippets',
            },
          ],
        }
      : {
          summary: 'Plan is correct, complete, and testable.',
          issues: [
            {
              severity: 'suggestion',
              title: 'Add a short rationale',
              detail: 'A one-line rationale per step would aid the reviewer.',
              location: 'Overview',
            },
          ],
        };

  if (mdPath) {
    const md =
      `# Plan Review (cycle ${cycle})\n\n## Summary\n\n${review.summary}\n\n## Issues\n\n` +
      review.issues.map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`).join('\n') +
      '\n';
    await ensureDir(mdPath);
    await writeFile(mdPath, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${mdPath}`, raw: { mock: true, file: mdPath } });
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

/** Mock the Workspace scan's survey stage (wsmap D20; role workspace-scan, the repurposed
 *  workspaceScanner): survey.json off the extract the brief names (MOCK_IN = the survey brief) —
 *  workspace-scan-mock.mjs writeMockSurvey. */
async function mockWorkspaceSurvey(m, onEvent) {
  if (!m.MOCK_OUT) return '[mock] workspace-scan: no MOCK_OUT given';
  const r = await writeMockSurvey({ briefPath: m.MOCK_IN, outPath: m.MOCK_OUT });
  await emitLog(onEvent, `[mock] workspace survey: ${r.investigated} investigated, ${r.skipped} skipped`);
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_OUT}`, raw: { mock: true, file: m.MOCK_OUT } });
  return `[mock] workspace survey written to ${m.MOCK_OUT}`;
}

/** Mock the Workspace scan's usage stage (wsmap D20): usage.json off the catalog the brief names
 *  (MOCK_IN = the usage brief), every candidate confirmed — workspace-scan-mock.mjs writeMockUsage. */
async function mockWorkspaceUsage(m, onEvent) {
  if (!m.MOCK_OUT) return '[mock] workspace-usage: no MOCK_OUT given';
  const r = await writeMockUsage({ briefPath: m.MOCK_IN, outPath: m.MOCK_OUT });
  await emitLog(onEvent, `[mock] workspace usage: ${Object.keys(r.doc.members).length} member(s), ${r.uses} use(s) confirmed`);
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_OUT}`, raw: { mock: true, file: m.MOCK_OUT } });
  return `[mock] workspace usage written to ${m.MOCK_OUT}`;
}

/** Mock the Workspace scan's synthesis stage (wsmap D20): synthesis.json off the map the brief names
 *  (MOCK_IN = the synthesis brief) — workspace-scan-mock.mjs writeMockSynthesis. */
async function mockWorkspaceSynth(m, onEvent) {
  if (!m.MOCK_OUT) return '[mock] workspace-synth: no MOCK_OUT given';
  const r = await writeMockSynthesis({ briefPath: m.MOCK_IN, outPath: m.MOCK_OUT });
  await emitLog(onEvent, `[mock] workspace synthesis: ${Object.keys(r.doc.roles).length} role(s) filled`);
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_OUT}`, raw: { mock: true, file: m.MOCK_OUT } });
  return `[mock] workspace synthesis written to ${m.MOCK_OUT}`;
}

/**
 * Mock the agent builder. Writes a deterministic meta JSON to MOCK_JSON and —
 * ONLY when MOCK_OUT is present (Mode A) — a deterministic agent body to MOCK_OUT.
 * Mode B (user-pasted markdown) omits MOCK_OUT so the mock never writes a body.
 */
async function mockAgentGen(m, onEvent) {
  const name = m.MOCK_BASE || 'Custom Agent';
  await emitLog(onEvent, `DRAFTING agent metadata for ${name}`);
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
  const key = words.length
    ? words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
    : 'customAgent';
  const meta = {
    metaVersion: 2, key, displayName: name, description: `mock-generated agent for ${name}`,
    color: 'amber', runnerType: 'producer', domain: 'general', fanOut: false,
    asksQuestions: true, questionsLocked: false, questionsDefault: false, order: 99,
    inputs: [{ id: 'plan', type: 'md', label: 'Plan' }],
    outputs: [{ id: 'review', type: 'md', filename: 'review-{cycle}.md' }],
  };
  if (m.MOCK_OUT) {
    const md = `# Agent: ${name}\n\nYou are ${name} (deterministic mock body).\n\n`
      + '## Ports\n\n- `plan` (in, md) — the plan to review.\n- `review` (out, md) — the review this agent writes.\n';
    await ensureDir(m.MOCK_OUT);
    await writeFile(m.MOCK_OUT, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_OUT}`, raw: { mock: true, file: m.MOCK_OUT } });
  }
  if (m.MOCK_JSON) {
    await ensureDir(m.MOCK_JSON);
    await writeFile(m.MOCK_JSON, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_JSON}`, raw: { mock: true, file: m.MOCK_JSON } });
  }
  return '[mock] agent draft written';
}

/**
 * Mock the in-pipeline workspace reviewer. Mirrors mockReviewer: the blocking-issue
 * count DECREASES with `cycle` so the workspace review -> implementer loop terminates
 * deterministically. Writes ONE merged review markdown + ONE merged review JSON
 * (the union shape the real synthesizer produces, with projectKey-prefixed locations).
 */
async function mockWorkspaceReviewer(m, cycle, onEvent) {
  const mdPath = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  await emitLog(onEvent, `[mock] workspace reviewer synthesizing per-project reviews (cycle ${cycle})`);

  // Cycle 1: two major issues across two members (a real union). Cycle >=2: only a
  // suggestion. The loop terminates by cycle 2 (no critical/major remain).
  const review =
    cycle <= 1
      ? {
          summary: 'Across the member projects, two major issues need a fix before acceptance.',
          issues: [
            {
              severity: 'major',
              title: 'Unhandled empty-string input',
              detail: 'feature("") returns "" but the plan expects a thrown error.',
              location: 'project-a: src/feature.mjs',
            },
            {
              severity: 'major',
              title: 'Missing contract validation',
              detail: 'The consumer does not validate the provider response shape.',
              location: 'project-b: src/client.mjs',
            },
          ],
        }
      : {
          summary: 'All member projects look good. Only a suggestion remains.',
          issues: [
            {
              severity: 'suggestion',
              title: 'Add a usage example',
              detail: 'A short cross-project example in the README would help.',
              location: 'project-a: README.md',
            },
          ],
        };

  if (mdPath) {
    const md =
      `# Workspace Implementation Review (cycle ${cycle})\n\n` +
      `## Summary\n\n${review.summary}\n\n` +
      `## Issues (union across all member projects)\n\n` +
      review.issues
        .map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`)
        .join('\n') +
      '\n';
    await ensureDir(mdPath);
    await writeFile(mdPath, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${mdPath}`, raw: { mock: true, file: mdPath } });
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

async function mockManualTestsChecklist(m, onEvent) {
  const out = m.MOCK_OUT;
  await emitLog(onEvent, '[mock] manual-tests author drafting checklist');
  if (!out) return '[mock] manual-tests-checklist: no MOCK_OUT given';
  const md =
    `# Manual Test Checklist\n\n` +
    `- [ ] App boots without errors — open the app; expect no console errors.\n` +
    `- [ ] Core flow works — exercise the new feature; expect the documented result.\n` +
    `- [ ] Invalid input is handled — submit bad input; expect a clear error.\n`;
  await ensureDir(out);
  await writeFile(out, md, 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return `[mock] manual checklist written to ${out}`;
}

async function mockManualWebUiTesting(m, cycle, onEvent) {
  const mdPath = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  await emitLog(onEvent, `[mock] manual web UI testing run (cycle ${cycle})`);
  // Cycle 1: one major (a case fails). Cycle >=2: only a suggestion. Terminates by cycle 2.
  const review =
    cycle <= 1
      ? {
          summary: 'One manual case failed in the live UI.',
          issues: [
            {
              severity: 'major',
              title: 'Core flow case failed',
              detail: 'The documented result did not appear when exercising the feature.',
              location: 'manual-tests-checklist.md',
            },
          ],
        }
      : {
          summary: 'All manual cases passed.',
          issues: [
            {
              severity: 'suggestion',
              title: 'Add an accessibility pass',
              detail: 'Consider a keyboard-only walkthrough next time.',
              location: 'manual-tests-checklist.md',
            },
          ],
        };
  if (mdPath) {
    const md =
      `# Manual Web UI Test Result (cycle ${cycle})\n\n## Summary\n\n${review.summary}\n\n## Issues\n\n` +
      review.issues.map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`).join('\n') +
      '\n';
    await ensureDir(mdPath);
    await writeFile(mdPath, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${mdPath}`, raw: { mock: true, file: mdPath } });
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}
