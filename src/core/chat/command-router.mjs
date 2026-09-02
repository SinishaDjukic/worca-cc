// src/core/chat/command-router.mjs
// Inbound chat commands -> worca actions (chat-connectivity-design.md §4.6).
// Command surface ported from the pre-1.0 commands/{global,project,control}.js
// re-targeted to 1.0 (live runs Map + pipelines DB), plus the NEW approval
// surface (/approve, /retry, /abort, /answer) the old code lacked. Fleet and
// workspace command families are not ported (no 1.0 counterpart).
//
// Everything with policy weight happens HERE, host-side: allowlist
// (deny-by-default), parsing, run resolution, answer-payload mapping. The
// `actions` capability object is injected by ui/server.mjs over its runs Map;
// this module never imports Express or the orchestrator.

import { parseCommand } from './parser.mjs';
import { BOOKEND_EXECUTION_IDS } from '../../shared/graph/constants.mjs';
import { createAllowlistGuard, parseIdList } from './allowlist.mjs';
import { runRef, fmtUsd, fmtMs } from './renderers.mjs';

const md = (value) => ({ kind: 'markdown', value });
const reply = (text, severity = 'info') => ({ title: null, body: [md(text)], severity });

/** 1.0 pipeline statuses -> emoji (statusEmoji port, re-keyed). */
export function statusEmoji(status) {
  switch (String(status || '')) {
    case 'running': case 'starting': return '🟢';
    case 'done': return '✅';
    case 'error': return '🔴';
    case 'stopped': return '⏹';
    case 'paused': case 'pausing': case 'interrupted': return '⏸';
    default: return '⚪';
  }
}

/** "30m" | "2h" | "1d" -> ms (parseDuration port). null on anything else. */
export function parseDuration(str) {
  const m = /^(\d+)([mhd])$/.exec(String(str || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'm' ? n * 60000 : m[2] === 'h' ? n * 3600000 : n * 86400000;
}

const HELP_TEXT = [
  '**worca-cc chat commands**',
  '`/runs` — live runs · `/last` — latest finished pipeline',
  '`/status [*ref]` — run detail · `/cost [*ref]` — run cost',
  '`/pause [*ref]` · `/stop [*ref]` · `/resume [*ref]`',
  '`/approve [*ref]` — continue past a gate · `/retry [*ref]` — another cycle',
  '`/abort [*ref]` — give up on a recovery prompt (pauses the run; nothing is discarded)',
  '`/answer [*ref] <n|text> [| …]` — answer clarify questions (option number, or text for free-text)',
  '`/projects` · `/use <name>` — scope commands to one project',
  '`/mute 30m|2h|1d` · `/unmute` — silence notifications for this chat',
  '`/whoami` · `/help`',
  '_`*ref` is a run-id suffix, e.g. `*2951`; omit it when only one run is live._',
].join('\n');

const LIVE = new Set(['running', 'starting', 'pausing']);

/**
 * Resolve which run a command targets (resolveRunId port: wildcard suffix,
 * disambiguation, no-arg single-active default).
 * @returns {{run?:object, row?:object, error?:object}} run = live entry summary,
 *          row = history row (when not live); error = NormalizedMessage reply
 */
function resolveTarget(arg, live, rows, { wantLive = false } = {}) {
  // wantLive commands (/pause /stop /approve /answer…) must never bind to a
  // finished entry still parked in the runs Map.
  if (wantLive) live = live.filter((r) => LIVE.has(String(r.status || '')));
  const suffix = String(arg || '').replace(/^\*/, '').trim();
  if (!suffix) {
    const active = live.filter((r) => LIVE.has(String(r.status || '')));
    const pool = active.length ? active : live;
    if (pool.length === 1) return { run: pool[0] };
    if (pool.length === 0) return { error: reply('No live runs. `/runs` lists them, `/last` shows the latest finished one.', 'warning') };
    return { error: disambiguate(pool.map((r) => ({ id: r.runId, title: r.title, status: r.status }))) };
  }
  const liveHits = live.filter((r) => String(r.runId).endsWith(suffix) || String(r.pipelineId || '').endsWith(suffix));
  if (liveHits.length === 1) return { run: liveHits[0] };
  if (liveHits.length > 1) return { error: disambiguate(liveHits.map((r) => ({ id: r.runId, title: r.title, status: r.status }))) };
  if (wantLive) return { error: reply(`No live run matches \`*${suffix}\`.`, 'warning') };
  const rowHits = (rows || []).filter((r) => String(r.id).endsWith(suffix));
  if (rowHits.length === 1) return { row: rowHits[0] };
  if (rowHits.length > 1) return { error: disambiguate(rowHits.map((r) => ({ id: r.id, title: r.title, status: r.status }))) };
  return { error: reply(`No run matches \`*${suffix}\`.`, 'warning') };
}

function disambiguate(candidates) {
  const lines = ['Ambiguous — use a longer suffix:'];
  for (const c of candidates.slice(0, 6)) {
    lines.push(`• ${statusEmoji(c.status)} \`${runRef(c.id)}\` ${String(c.title || '').slice(0, 50)}`);
  }
  return reply(lines.join('\n'), 'warning');
}

function runLine(r) {
  const title = String(r.title || '(untitled)').slice(0, 60);
  return `${statusEmoji(r.status)} \`${runRef(r.runId || r.id)}\` ${r.status} — ${title}`;
}

/** Final segment of a host-native path, on either separator ("/x/proj",
 *  "C:\\x\\proj", trailing separator tolerated). Exported for tests. */
export function lastPathSegment(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

/**
 * @param {{actions:object, chatContext:object, logger?:(l:string,m:string)=>void}} deps
 * actions: listRuns(), runState(runId), pendingQuestion(runId),
 *          answer(runId, id, payload), stop(runId), pause(runId),
 *          resume(pipelineId), history({limit}), listProjects()
 */
export function createCommandRouter({ actions, chatContext, logger = () => {} }) {
  const projectOf = (chatKey) => chatContext.get(chatKey).active_project;

  const scopedRuns = (chatKey) => {
    const all = actions.listRuns().filter((r) => (r.kind || 'run') === 'run' || r.kind === 'workspace-run');
    const scope = projectOf(chatKey);
    if (!scope) return all;
    // Last path segment on EITHER separator: projectDir is host-native, so on
    // Windows it is `C:\\…\\proj` and a "/"-only split never matched the scope.
    return all.filter((r) => lastPathSegment(r.projectDir) === scope
      || (r.projectNames || []).includes(scope));
  };

  const handlers = {
    start: async () => reply(HELP_TEXT),
    help: async () => reply(HELP_TEXT),

    whoami: async ({ chatKey, platform, msg }) =>
      reply(`platform: **${platform}** · chat: \`${msg.chatId}\` · key: \`${chatKey}\`\nThis chat is allow-listed for commands.`),

    projects: async () => {
      const projects = await actions.listProjects();
      if (!projects.length) return reply('No projects onboarded.');
      return reply(['**Projects:**', ...projects.map((p) => `• ${p.name}`)].join('\n'));
    },

    use: async ({ chatKey, args }) => {
      if (!args[0]) {
        const cur = projectOf(chatKey);
        return reply(cur ? `Active project: **${cur}** (\`/use -\` to clear)` : 'No active project — commands see all runs. `/use <name>` to scope.');
      }
      if (args[0] === '-') {
        chatContext.set(chatKey, { active_project: null });
        return reply('Cleared — commands see all runs.');
      }
      const projects = await actions.listProjects();
      const hit = projects.find((p) => p.name === args[0]);
      if (!hit) return reply(`Unknown project "${args[0]}". \`/projects\` lists them.`, 'warning');
      chatContext.set(chatKey, { active_project: hit.name });
      return reply(`Active project: **${hit.name}** — /runs, /status now scope to it.`);
    },

    runs: async ({ chatKey }) => {
      const live = scopedRuns(chatKey);
      if (!live.length) return reply('No live runs. `/last` shows the latest finished pipeline.');
      return reply(['**Live runs:**', ...live.map(runLine)].join('\n'));
    },

    last: async () => {
      const rows = await actions.history({ limit: 1 });
      if (!rows.length) return reply('No pipelines yet.');
      const r = rows[0];
      const bits = [runLine({ ...r, runId: r.id })];
      const cost = fmtUsd(r.totalCostUsd);
      if (cost) bits.push(`   **Cost:** ${cost}`);
      const dur = fmtMs(r.totalActiveMs);
      if (dur) bits.push(`   **Active:** ${dur}`);
      return reply(bits.join('\n'));
    },

    status: async ({ chatKey, args }) => {
      const t = resolveTarget(args[0], scopedRuns(chatKey), await actions.history({ limit: 50 }));
      if (t.error) return t.error;
      if (t.row) {
        const r = t.row;
        return reply([runLine({ ...r, runId: r.id }),
          ...(fmtUsd(r.totalCostUsd) ? [`   **Cost:** ${fmtUsd(r.totalCostUsd)}`] : []),
          ...(r.pauseReason ? [`   **Pause reason:** ${r.pauseReason}`] : []),
          ...(r.pauseDetail ? [`   **Error:** ${r.pauseDetail}`] : []),
        ].join('\n'));
      }
      const r = t.run;
      const lines = [runLine(r)];
      const state = actions.runState(r.runId);
      if (state) {
        // `x:` is NOT a bookend filter — every v2 executionId starts with it —
        // so the two BOOKEND rows are named explicitly.
        const ledger = (state.steps || []).filter((s) => !BOOKEND_EXECUTION_IDS.includes(String(s.key || '')));
        const doneSteps = ledger.filter((s) => s.status === 'done').length;
        const nodes = state.stepper?.graph?.nodes || [];
        const active = (state.active || [])
          .map((a) => nodes.find((n) => n.id === a.nodeId)?.label || a.nodeId);
        const activeLabel = active.length === 0 ? '—'
          : (active.length === 1 ? active[0] : `${active.length} agents running`);
        lines.push(`   **Executions:** ${doneSteps}/${ledger.length} done · **Active:** ${activeLabel}`);
        const cost = fmtUsd(state.totalCostUsd);
        if (cost) lines.push(`   **Cost:** ${cost}`);
      }
      const pq = actions.pendingQuestion(r.runId);
      if (pq) lines.push(`   ❓ waiting on you — \`/approve ${runRef(r.runId)}\` or \`/answer ${runRef(r.runId)} <n>\``);
      return reply(lines.join('\n'));
    },

    cost: async ({ chatKey, args }) => {
      const t = resolveTarget(args[0], scopedRuns(chatKey), await actions.history({ limit: 50 }));
      if (t.error) return t.error;
      if (t.row) return reply(`\`${runRef(t.row.id)}\` cost: ${fmtUsd(t.row.totalCostUsd) || '$0.00'}`);
      const state = actions.runState(t.run.runId);
      return reply(`\`${runRef(t.run.runId)}\` cost so far: ${fmtUsd(state?.totalCostUsd) || '$0.00'}`);
    },

    pause: async ({ chatKey, args }) => {
      const t = resolveTarget(args[0], scopedRuns(chatKey), [], { wantLive: true });
      if (t.error) return t.error;
      await actions.pause(t.run.runId);
      return reply(`⏸ Pausing \`${runRef(t.run.runId)}\` — resume from the UI or \`/resume ${runRef(t.run.runId)}\`.`, 'warning');
    },

    stop: async ({ chatKey, args }) => {
      const t = resolveTarget(args[0], scopedRuns(chatKey), [], { wantLive: true });
      if (t.error) return t.error;
      await actions.stop(t.run.runId);
      return reply(`⏹ Stopping \`${runRef(t.run.runId)}\` (${String(t.run.title || '').slice(0, 50)}).`, 'warning');
    },

    resume: async ({ args }) => {
      // Resolve against PAUSED/INTERRUPTED history rows (resume works across
      // restarts); a live match means it's already running.
      const rows = (await actions.history({ limit: 50 })).filter((r) => r.status === 'paused' || r.status === 'interrupted');
      let t = resolveTarget(args[0], [], rows);
      if (t.error) {
        if (!args[0] && rows.length > 1) {
          return disambiguate(rows.map((r) => ({ id: r.id, title: r.title, status: r.status })));
        }
        if (!args[0] && !rows.length) return reply('Nothing is paused.', 'warning');
        if (args[0] || rows.length !== 1) return t.error;
        t = { row: rows[0] };            // exactly one paused row, bare /resume: take it
      }
      const out = await actions.resume(t.row.id);
      if (out?.ok) return reply(`▶️ Resuming \`${runRef(t.row.id)}\` — ${String(t.row.title || '').slice(0, 50)}`);
      return reply(`Could not resume \`${runRef(t.row.id)}\`: ${out?.error || 'unknown error'}`, 'error');
    },

    approve: async (env) => answerDecision(env, 'approve'),
    retry: async (env) => answerDecision(env, 'retry'),
    abort: async (env) => answerDecision(env, 'abort'),

    answer: async ({ chatKey, args }) => {
      const t = resolveTarget(args[0] && args[0].startsWith('*') ? args[0] : '', scopedRuns(chatKey), [], { wantLive: true });
      if (t.error) return t.error;
      const pq = actions.pendingQuestion(t.run.runId);
      if (!pq) return reply(`\`${runRef(t.run.runId)}\` is not waiting on a question.`, 'warning');
      if (pq.kind !== 'clarify' && pq.kind !== 'questions') {
        return reply(`\`${runRef(t.run.runId)}\` is waiting on ${pq.kind} — use \`/approve\` or \`/retry\`.`, 'warning');
      }
      const questions = Array.isArray(pq.questions) ? pq.questions : [];
      const hasRef = !!(args[0] && args[0].startsWith('*'));
      const rest = (hasRef ? args.slice(1) : args).join(' ').trim();
      const ref = runRef(t.run.runId);
      const usage = () => reply(
        `Need ${questions.length} answer${questions.length === 1 ? '' : 's'} — option numbers, or text for free-text questions, separated by \`|\`.\nExample: \`/answer ${ref} ${questions.map((q) => (q.options?.length ? '1' : '<your answer>')).join(' | ')}\``,
        'warning');
      if (!rest) return usage();
      // Parsing spec:
      // 1-question: the whole rest IS the answer — never split (pipes are data).
      // Pure-ordinal back-compat: "1 2 3" iff every question has options and no '|'.
      // Otherwise: pipe-separated, one part per question, in order.
      let parts;
      if (questions.length === 1) {
        parts = [rest];
      } else {
        const tokens = rest.split(/\s+/);
        const allOrdinals = tokens.every((tk) => /^\d+$/.test(tk));
        const everyHasOptions = questions.every((q) => (q.options || []).length > 0);
        parts = allOrdinals && everyHasOptions && !rest.includes('|')
          ? tokens
          : rest.split('|').map((s) => s.trim());
      }
      if (parts.length !== questions.length) return usage();
      const answers = [];
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const opts = Array.isArray(q.options) ? q.options : [];
        const part = parts[i];
        const n = /^\d+$/.test(part) ? Number(part) : null;
        if (opts.length && n !== null) {
          if (n < 1 || n > opts.length) return reply(`Q${i + 1} has options 1–${opts.length}; got ${n}.`, 'warning');
          answers.push({ id: q.id, choice: opts[n - 1] });
        } else if (q.allowFreeText !== false && part) {
          answers.push({ id: q.id, choice: part });   // free text is a choice string (app.js:3717)
        } else if (!opts.length) {
          return reply(`Q${i + 1} needs a written answer — got nothing.`, 'warning');
        } else {
          return reply(`Q${i + 1} takes an option number (1–${opts.length}), not text.`, 'warning');
        }
      }
      await actions.answer(t.run.runId, pq.id, { answers });
      return reply(`✅ Answered ${questions.length} question${questions.length === 1 ? '' : 's'} on \`${ref}\`.`, 'success');
    },

    mute: async ({ chatKey, args }) => {
      const ms = parseDuration(args[0]);
      if (!ms) return reply('Usage: `/mute 30m` · `/mute 2h` · `/mute 1d`', 'warning');
      const until = new Date(Date.now() + ms).toISOString();
      chatContext.set(chatKey, { mute_until: until });
      return reply(`🔇 Notifications muted for ${args[0]} (commands still work). \`/unmute\` to lift.`);
    },

    unmute: async ({ chatKey }) => {
      const { muted_messages: muted } = chatContext.get(chatKey);
      chatContext.set(chatKey, { mute_until: null, muted_messages: 0 });
      return reply(`🔔 Notifications back on${muted ? ` (${muted} suppressed while muted)` : ''}.`);
    },
  };

  async function answerDecision({ chatKey, args }, verb) {
    const t = resolveTarget(args[0], scopedRuns(chatKey), [], { wantLive: true });
    if (t.error) return t.error;
    const pq = actions.pendingQuestion(t.run.runId);
    if (!pq) return reply(`\`${runRef(t.run.runId)}\` is not waiting on a decision.`, 'warning');
    const ref = runRef(t.run.runId);
    let payload;
    if (pq.kind === 'gate') {
      if (verb === 'abort') return reply(`Gates have no abort — \`/approve ${ref}\`, \`/retry ${ref}\`, or \`/stop ${ref}\`.`, 'warning');
      payload = { decision: verb === 'approve' ? 'continue' : 'another' };
    } else if (pq.kind === 'recovery') {
      payload = { decision: verb === 'abort' ? 'pause' : 'retry' };
    } else {
      return reply(`\`${ref}\` is waiting on ${pq.kind} — use \`/answer ${ref} <n>\`.`, 'warning');
    }
    await actions.answer(t.run.runId, pq.id, payload);
    const what = pq.kind === 'gate'
      ? (payload.decision === 'continue' ? 'approved — continuing' : 'sent back for another cycle')
      : (payload.decision === 'retry' ? 'retrying' : 'pausing the run');
    return reply(`✅ \`${ref}\` ${what}.`, 'success');
  }

  return {
    /**
     * @param {{plugin:string, channelId:string, platform:string,
     *          channelConfig:object, msg:{chatId:string,userId:string,text:string,meta?:object}}} ev
     * @returns {Promise<object|null>} NormalizedMessage reply or null (ignore)
     */
    async handleIncoming({ plugin, channelId, platform, channelConfig, msg }) {
      const guard = createAllowlistGuard(parseIdList(channelConfig?.allowedChatIds), {
        debug: (m) => logger('info', m),
      });
      if (!guard.isAllowed({ platform, chatId: msg.chatId })) return null; // silent, fail closed
      const parsed = parseCommand(msg.text);
      if (!parsed) return null; // non-commands are never interpreted
      const handler = Object.hasOwn(handlers, parsed.command) ? handlers[parsed.command] : null;
      const chatKey = `${platform}:${msg.chatId}`;
      if (!handler) return reply(`Unknown command \`/${parsed.command}\` — \`/help\` lists commands.`, 'warning');
      try {
        return await handler({ chatKey, platform, plugin, channelId, msg, args: parsed.args });
      } catch (err) {
        logger('error', `chat command /${parsed.command} failed: ${err?.message || err}`);
        return reply(`Command failed: ${String(err?.message || err).slice(0, 200)}`, 'error');
      }
    },
  };
}
