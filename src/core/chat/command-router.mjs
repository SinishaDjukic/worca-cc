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

import { parseCommand, MENTION_TOKEN } from './parser.mjs';
import { DIRECTIONS_CLOSED, DIRECTION_MAX_CHARS } from '../directions.mjs';
import { BOOKEND_EXECUTION_IDS } from '../../shared/graph/constants.mjs';
import { createAllowlistGuard, parseIdList } from './allowlist.mjs';
import { runRef, fmtRunCost, fmtMs } from './renderers.mjs';
import { promptFields, parseAnswerLine } from '../../shared/forms/project.mjs';
import { giveUpOption, describePauseReason, pauseConsequences } from '../failure-policy.mjs';
import { chatActor } from '../identity.mjs';
import { SWITCH_ENGINES, engineLabel, engineList, engineRefusalFor } from '../../shared/engine-switch.mjs';

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
  '**Worca chat commands**',
  '`/runs` — live runs · `/last` — latest finished pipeline',
  '`/status [*ref]` — run detail · `/cost [*ref]` — run cost',
  `\`/pause [*ref]\` · \`/stop [*ref]\` · \`/resume [*ref] [${SWITCH_ENGINES.join('|')}]\` (an engine continues the run on it)`,
  '`/approve [*ref]` — at a gate: no more cycles, continue · on a recovery prompt: retry · on an Auto proposal: accept',
  '`/retry [*ref]` — at a gate: run another cycle',
  '`/abort [*ref]` — give up on a recovery prompt (pauses the run; nothing is discarded)',
  '`/cancel [*ref]` — cancel an Auto workflow proposal (stops the run) or give up on a recovery prompt',
  '`/answer [*ref] <n|text> [| …]` — answer clarify questions (option number, or text for free-text); on an Auto proposal, the change you want',
  '`/answer [*ref] field=value [| field2=a,b]` — answer a form (escape a literal `|`, `,`, `=` or `:` with `\\`)',
  '`/direct [*ref] <text>` — push a direction to a live run (non-blocking; the next step reads it)',
  '`/projects` · `/use <name>` — scope commands to one project',
  '`/mute 30m|2h|1d` · `/unmute` — silence notifications for this chat',
  '`/whoami` · `/help`',
  '_`*ref` is a run-id suffix, e.g. `*2951`; omit it when only one run is live._',
].join('\n');

const LIVE = new Set(['running', 'starting', 'pausing']);

// Mentions BEFORE the command ("@bot /direct …", "<@U0123> /direct …"), and a
// consumed ref behind any mentions that follow it — built from the parser's own
// token so the two cannot disagree about what a mention is.
const LEADING_MENTIONS_RE = new RegExp(`^\\s*(?:${MENTION_TOKEN}\\s+)*`);
const LEADING_REF_RE = new RegExp(`^((?:${MENTION_TOKEN}\\s+)*)\\*\\S+\\s*`);

// A refused command from a chat worca NOTIFIES is answered, once per window: that
// chat already receives worca content, so naming its own id leaks nothing, and a
// silent drop there looked exactly like "the bot never got my /approve".
// Any other chat stays silent — deny-by-default fails closed.
const REFUSAL_HINT_EVERY_MS = 10 * 60 * 1000;

// Runs that can still READ a direction — LIVE plus the two SETTLED states resume
// accepts, which is what the inbox exists for: resume replays directions.ndjson.
//
// `interrupted` belongs here for the same reason `paused` does, and leaving it out
// was the drift this comment claimed to prevent. reconcileStaleRunning stamps
// every dead-owner run `interrupted` on server restart (artifacts.mjs), resumeRun
// explicitly accepts it (ui/server.mjs: `!== 'paused' && !== 'interrupted'`), and
// postDirection gates on the DENYLIST DIRECTIONS_CLOSED = {done,error,stopped} —
// so after any restart the UI filed a direction (201, replayed on resume) while
// /direct answered "No running or paused runs." for the very same row.
//
// Still an allowlist, not `!DIRECTIONS_CLOSED.has(s)` — a run whose status is
// empty or unknown must not become directable by default — but the filter keeps
// the two surfaces from disagreeing about the states both actually name.
// How far back /direct will recognise a run id. History is the only place a run
// from before the last server restart still exists, and the whole table is not
// worth scanning on a chat command — but the horizon is real, so it is named
// rather than buried as a literal at the call site.
const DIRECT_REF_HISTORY = 500;

const DIRECTABLE = new Set([...LIVE, 'paused', 'interrupted'].filter((s) => !DIRECTIONS_CLOSED.has(s)));

/**
 * Resolve which run a command targets (resolveRunId port: wildcard suffix,
 * disambiguation, no-arg single-active default).
 * @returns {{run?:object, row?:object, error?:object}} run = live entry summary,
 *          row = history row (when not live); error = NormalizedMessage reply
 */
function resolveTarget(arg, live, rows, { wantLive = false, targetable = LIVE, noun = 'live' } = {}) {
  // wantLive commands (/pause /stop /approve /answer…) must never bind to a
  // finished entry still parked in the runs Map. `targetable` says which statuses
  // count: /direct widens it to include `paused`, whose inbox resume replays.
  if (wantLive) live = live.filter((r) => targetable.has(String(r.status || '')));
  const suffix = String(arg || '').replace(/^\*/, '').trim();
  if (!suffix) {
    const active = live.filter((r) => targetable.has(String(r.status || '')));
    const pool = active.length ? active : live;
    if (pool.length === 1) return { run: pool[0] };
    if (pool.length === 0) return { error: reply(`No ${noun} runs. \`/runs\` lists them, \`/last\` shows the latest finished one.`, 'warning') };
    return { error: disambiguate(pool.map((r) => ({ id: r.runId, title: r.title, status: r.status }))) };
  }
  const liveHits = live.filter((r) => String(r.runId).endsWith(suffix) || String(r.pipelineId || '').endsWith(suffix));
  if (liveHits.length === 1) return { run: liveHits[0] };
  if (liveHits.length > 1) return { error: disambiguate(liveHits.map((r) => ({ id: r.runId, title: r.title, status: r.status }))) };
  if (wantLive) return { error: reply(`No ${noun} run matches \`*${suffix}\`.`, 'warning') };
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
 * @param {{actions:object, chatContext:object, logger?:(l:string,m:string)=>void,
 *          onRefused?:(ev:{plugin:string, channelId:string, platform:string, chatId:string, command:string})=>void,
 *          now?:()=>number}} deps
 * actions: listRuns(), runState(runId), pendingQuestion(runId),
 *          answer(runId, id, payload), stop(runId), pause(runId),
 *          stopPaused(pipelineId) -> {ok:true}|{ok:false, error},
 *          resume(pipelineId), history({limit}), listProjects(),
 *          listScheduled?() -> [{id, title, runAt, status, projectDir, workspaceName?}] (optional)
 */
export function createCommandRouter({ actions, chatContext, logger = () => {}, onRefused = () => {}, now = Date.now }) {
  const lastHintAt = new Map();   // "plugin/channelId:chatId" -> ms

  function refuse({ plugin, channelId, platform, channelConfig, msg }, command) {
    const chatId = String(msg.chatId);
    try { onRefused({ plugin, channelId, platform, chatId, command }); }
    catch (err) { logger('error', `chat onRefused observer failed: ${err?.message || err}`); }
    if (!parseIdList(channelConfig?.notifyChatIds).includes(chatId)) return null;
    const key = `${plugin}/${channelId}:${chatId}`;
    const t = now();
    if (t - (lastHintAt.get(key) ?? -Infinity) < REFUSAL_HINT_EVERY_MS) return null;
    lastHintAt.set(key, t);
    return reply([
      `This chat gets worca notifications but is not allowed to send commands, so \`/${command}\` was ignored.`,
      `To control runs from here, add \`${chatId}\` to **Allowed chat IDs** in worca → Marketplace → ${plugin} → Settings.`,
    ].join('\n'), 'warning');
  }

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
      // Scheduled runs (tickets, not pipelines): the next few, scoped like the live list.
      const scope = projectOf(chatKey);
      let soon = [];
      try {
        soon = (typeof actions.listScheduled === 'function' ? actions.listScheduled() : [])
          .filter((t) => !scope || lastPathSegment(t.projectDir) === scope)
          .slice(0, 5);
      } catch { soon = []; }
      const sched = soon.map((t) => `\u{1F552} ${t.status === 'missed' ? '**missed** · ' : ''}${t.title || 'Scheduled run'} · ${t.when || t.runAt}`);
      if (!live.length && !sched.length) return reply('No live runs. `/last` shows the latest finished pipeline.');
      const lines = live.length ? ['**Live runs:**', ...live.map(runLine)] : ['No live runs.'];
      if (sched.length) lines.push('', '**Scheduled:**', ...sched);
      return reply(lines.join('\n'));
    },

    last: async () => {
      const rows = await actions.history({ limit: 1 });
      if (!rows.length) return reply('No pipelines yet.');
      const r = rows[0];
      const bits = [runLine({ ...r, runId: r.id })];
      const cost = fmtRunCost(r.runEngine, r.totalCostUsd);
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
          ...(fmtRunCost(r.runEngine, r.totalCostUsd) ? [`   **Cost:** ${fmtRunCost(r.runEngine, r.totalCostUsd)}`] : []),
          ...(r.pauseReason ? [`   **Pause reason:** ${describePauseReason(r.pauseReason) || r.pauseReason}`] : []),
          ...(r.pauseDetail ? [`   **${pauseConsequences(r.pauseReason).severity === 'error' ? 'Error' : 'Cause'}:** ${r.pauseDetail}`] : []),
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
        const cost = fmtRunCost(state.runEngine, state.totalCostUsd);
        if (cost) lines.push(`   **Cost:** ${cost}`);
      }
      const pq = actions.pendingQuestion(r.runId);
      if (pq) {
        const ref = runRef(r.runId);
        lines.push(pq.kind === 'form'
          ? `   ❓ waiting on the \`${pq.form}\` form — \`/answer ${ref} <field>=<value>\``
          : pq.kind === 'workflow'
            ? `   ❓ waiting on you to accept the proposed workflow — \`/approve ${ref}\` · \`/answer ${ref} <what to change>\` · \`/cancel ${ref}\``
            : `   ❓ waiting on you — \`/approve ${ref}\` or \`/answer ${ref} <n>\``);
      }
      return reply(lines.join('\n'));
    },

    cost: async ({ chatKey, args }) => {
      const t = resolveTarget(args[0], scopedRuns(chatKey), await actions.history({ limit: 50 }));
      if (t.error) return t.error;
      if (t.row) return reply(`\`${runRef(t.row.id)}\` cost: ${fmtRunCost(t.row.runEngine, t.row.totalCostUsd) || '$0.00'}`);
      const state = actions.runState(t.run.runId);
      return reply(`\`${runRef(t.run.runId)}\` cost so far: ${fmtRunCost(state?.runEngine, state?.totalCostUsd) || '$0.00'}`);
    },

    pause: async ({ chatKey, args, actor }) => {
      const t = resolveTarget(args[0], scopedRuns(chatKey), [], { wantLive: true });
      if (t.error) return t.error;
      await actions.pause(t.run.runId, actor);
      return reply(`⏸ Pausing \`${runRef(t.run.runId)}\` — resume from the UI or \`/resume ${runRef(t.run.runId)}\`.`, 'warning');
    },

    stop: async ({ chatKey, args, actor }) => {
      const live = scopedRuns(chatKey);
      const t = resolveTarget(args[0], live, [], { wantLive: true });
      if (!t.error) {
        await actions.stop(t.run.runId, actor);
        return reply(`⏹ Stopping \`${runRef(t.run.runId)}\` (${String(t.run.title || '').slice(0, 50)}).`, 'warning');
      }
      // Not live: a PAUSED run is stopped through its saved row — by an explicit ref only, so
      // a bare /stop never reaches past the live runs to discard parked work. An interrupted
      // run is never stopped: it stays resumable.
      const suffix = String(args[0] || '').replace(/^\*/, '').trim();
      if (!suffix) return t.error;                     // `/stop` and `/stop *` are both bare
      // A ref several live runs match is answered with the choice, never with a paused run.
      if (live.some((r) => LIVE.has(String(r.status || ''))
        && (String(r.runId).endsWith(suffix) || String(r.pipelineId || '').endsWith(suffix)))) return t.error;
      // Candidates by pipeline id: a paused run this server holds (`/runs` lists it by its RUN
      // ref, so match that too), then the History rows (paused and interrupted).
      const byId = new Map();
      for (const r of live) {
        if (r.status !== 'paused' || !r.pipelineId) continue;
        if (String(r.runId).endsWith(suffix) || String(r.pipelineId).endsWith(suffix)) {
          byId.set(r.pipelineId, { id: r.pipelineId, title: r.title, status: 'paused' });
        }
      }
      // A History row is in reach only inside the chat's `/use` scope, as the live runs are.
      const scope = projectOf(chatKey);
      const inScope = (r) => !scope || lastPathSegment(r.projectDir) === scope || (r.projectNames || []).includes(scope);
      for (const r of await actions.history({ limit: 50 })) {
        if ((r.status === 'paused' || r.status === 'interrupted') && inScope(r) && String(r.id).endsWith(suffix) && !byId.has(r.id)) {
          byId.set(r.id, { id: r.id, title: r.title, status: r.status });
        }
      }
      const rows = [...byId.values()];
      if (!rows.length) return t.error;
      if (rows.length > 1) return disambiguate(rows.map((r) => ({ id: r.id, title: r.title, status: r.status })));
      const row = rows[0];
      if (row.status === 'interrupted') {
        return reply(`\`${runRef(row.id)}\` is interrupted — it stays resumable: \`/resume ${runRef(row.id)}\`.`, 'warning');
      }
      const out = await actions.stopPaused(row.id, actor);
      if (out?.ok) return reply(`⏹ Stopped \`${runRef(row.id)}\` (${String(row.title || '').slice(0, 50)}).`, 'warning');
      return reply(`Could not stop \`${runRef(row.id)}\`: ${out?.error || 'unknown error'}`, 'error');
    },

    resume: async ({ args, actor }) => {
      // `/resume [*ref] [engine]`: an engine name (either position) continues the run on
      // that engine instead of its saved one; anything else is the run reference.
      const engineArg = args.find((a) => SWITCH_ENGINES.includes(String(a).toLowerCase()));
      const engine = engineArg ? String(engineArg).toLowerCase() : null;
      const refs = args.filter((a) => a !== engineArg);
      if (refs.length > 1) return reply(`Unknown engine \`${refs[1]}\` — use ${engineList(SWITCH_ENGINES, (e) => e)}.`, 'warning');
      const ref = refs[0];
      // Resolve against PAUSED/INTERRUPTED history rows (resume works across
      // restarts); a live match means it's already running.
      const rows = (await actions.history({ limit: 50 })).filter((r) => r.status === 'paused' || r.status === 'interrupted');
      let t = resolveTarget(ref, [], rows);
      if (t.error) {
        if (!ref && rows.length > 1) {
          return disambiguate(rows.map((r) => ({ id: r.id, title: r.title, status: r.status })));
        }
        if (!ref && !rows.length) return reply('Nothing is paused.', 'warning');
        if (ref || rows.length !== 1) return t.error;
        t = { row: rows[0] };            // exactly one paused row, bare /resume: take it
      }
      const out = engine ? await actions.resume(t.row.id, actor, { engine }) : await actions.resume(t.row.id, actor);
      const on = engine ? ` on ${engineLabel(engine)}` : '';
      if (out?.ok) return reply(`▶️ Resuming \`${runRef(t.row.id)}\`${on} — ${String(t.row.title || '').slice(0, 50)}`);
      // The engine gate's consent is a UI checkbox, never a chat word: the refusal sends the person there.
      const why = out?.code === 'engine-refused' ? engineRefusalFor(out.error, 'chat') : out?.error;
      return reply(`Could not resume \`${runRef(t.row.id)}\`${on}: ${why || 'unknown error'}`, 'error');
    },

    approve: async (env) => answerDecision(env, 'approve'),
    retry: async (env) => answerDecision(env, 'retry'),
    abort: async (env) => answerDecision(env, 'abort'),
    cancel: async (env) => answerDecision(env, 'cancel'),

    answer: async ({ chatKey, args, actor }) => {
      const t = resolveTarget(args[0] && args[0].startsWith('*') ? args[0] : '', scopedRuns(chatKey), [], { wantLive: true });
      if (t.error) return t.error;
      const pq = actions.pendingQuestion(t.run.runId);
      if (!pq) return reply(`\`${runRef(t.run.runId)}\` is not waiting on a question.`, 'warning');
      const formRef = runRef(t.run.runId);
      if (pq.kind === 'workflow') {
        const hasRefArg = !!(args[0] && args[0].startsWith('*'));
        const change = (hasRefArg ? args.slice(1) : args).join(' ').trim();
        if (!change) return reply(`Say what to change: \`/answer ${formRef} <what to change>\` — or \`/approve ${formRef}\` to accept, \`/cancel ${formRef}\` to cancel.`, 'warning');
        await actions.answer(t.run.runId, pq.id, { decision: 'revise', text: change }, actor);
        return reply(`✏️ \`${formRef}\` — asked Auto to revise the workflow: “${change.slice(0, 120)}”`, 'success');
      }
      if (pq.kind === 'form') {
        // Spec §8: `/answer <ref> field=value | field2=a,b`. The grammar itself —
        // escapes, type-driven comma splitting, `id:verdict[:note]` for a
        // review-list, the bare positional — is P1's parseAnswerLine (rulings X7,
        // X8). What lives here is the ref, the refusal, the usage line and the
        // gate-3 reply. Gate 3 THROWS INVALID_ANSWER (X2) and leaves the ask open.
        if (pq.surface === 'web') {
          return reply(`\`${formRef}\` is waiting on the \`${pq.form}\` form, which is answered in the worca web UI.`, 'warning');
        }
        const fields = promptFields(pq);
        const hasRefArg = !!(args[0] && args[0].startsWith('*'));
        const line = (hasRefArg ? args.slice(1) : args).join(' ').trim();
        const example = fields.filter((f) => !f.when).slice(0, 3)
          .map((f) => `${f.field}=${f.type === 'array' ? '<a,b>' : '<value>'}`).join(' | ')
          || '<field>=<value>';
        const usage = () => reply(
          `Reply: \`/answer ${formRef} ${example}\`\nSeparate fields with \`|\`, list values with \`,\`, escape a literal \`|\`, \`,\`, \`=\` or \`:\` with \`\\\`.`,
          'warning');
        if (!line) return usage();
        const parsed = parseAnswerLine(line, pq, fields.length === 1 ? { bareField: fields[0].field } : {});
        if (parsed.errors.length) {
          return reply(['Could not read that answer:',
            ...parsed.errors.map((e) => `• ${e.path ? `\`${e.path}\`: ` : ''}${e.message}`),
            '', `Reply: \`/answer ${formRef} ${example}\``].join('\n'), 'warning');
        }
        try {
          await actions.answer(t.run.runId, pq.id, { values: parsed.values }, actor);
        } catch (err) {
          if (!err || err.code !== 'INVALID_ANSWER') throw err;   // the handler's catch owns everything else
          return reply([`\`${formRef}\` — that answer was rejected:`,
            ...(Array.isArray(err.errors) ? err.errors : []).map((e) => `• ${e.path ? `\`${e.path}\`: ` : ''}${e.message}`),
            '', 'The question is still open.'].join('\n'), 'warning');
        }
        return reply(`✅ Answered the \`${pq.form}\` form on \`${formRef}\`.`, 'success');
      }
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
      await actions.answer(t.run.runId, pq.id, { answers }, actor);
      return reply(`✅ Answered ${questions.length} question${questions.length === 1 ? '' : 's'} on \`${ref}\`.`, 'success');
    },

    // /direct [*ref] <free text> — a non-blocking direction for a live run. The
    // text is sliced off msg.text, not rebuilt from args: parseCommand collapses
    // whitespace and drops @mentions, and a direction must arrive verbatim.
    direct: async ({ chatKey, args, msg, platform }) => {
      // A ref is only a ref if it NAMES one of this chat's live runs. Shape alone
      // is not enough to tell one from ordinary prose: `*never*` has a trailing
      // asterisk, but `*please remove* the roadmap` opens with a bare `*please`
      // that is perfectly id-shaped, and consuming it dropped the direction with
      // "No live run matches `*please`". Resolving first costs nothing — the
      // suffix either matches a live run or the whole line is the direction.
      const scoped = scopedRuns(chatKey);
      // At least four characters: run ids are hex, so a single-letter emphasis
      // opener matched one in sixteen by accident — `/direct *a bit shorter`
      // resolved a ref `*a`, stripped it, and handed the agent "bit shorter".
      const token = args[0] && args[0].startsWith('*') ? args[0].slice(1).trim() : '';
      const suffix = token.length >= 4 ? token : '';
      // Matched against EVERY run in scope, not just the live ones. Those are two
      // different answers: a token naming no run at all is prose (`*please
      // remove* the roadmap`), while a token naming a run that exists but is not
      // live is a ref the user got wrong — and resolveTarget's `wantLive` says so.
      // Testing only live runs conflated them, so a stale ref fell through to "no
      // ref given" and filed the direction against whichever run WAS live, with
      // the literal `*a1b2c3d4` still sitting in the text the next agent reads.
      // Recognised against the runs worca can still SEE — the live Map plus a window
      // of History — not just the ones in scope:
      // `runs` is scopedRuns(chatKey) — the active project's entries still in the
      // server's in-memory Map — so a ref naming a real run outside that set read as
      // prose and the command fell through to the no-ref path, filing against
      // whichever run happened to be live with the literal `*a1b2c3d4` still in the
      // text. Reachable with `/use projA` while reffing projB, and for any run from
      // before the last server restart (the Map is empty after one; History is not).
      // An id-shaped token matching nothing in that window stays prose, which is the
      // decision the `*deadbeef99` case above encodes. The window is finite, so a
      // ref older than it still reads as prose — the residual case, and the reason
      // the resolver below is what actually refuses: a recognised ref that names no
      // DIRECTABLE run errors rather than retargeting. Only queried when the first
      // token is ref-shaped, so an ordinary /direct costs nothing.
      // History is read only when it can CHANGE the answer: to tell a real ref from
      // prose, or when nothing in the Map is directable (after a restart, the paused
      // run the inbox exists for lives only in the DB). An ordinary `/direct <text>`
      // with a run live — the common form — reads none of it. The previous comment
      // claimed this while the fetch ran unconditionally, so the guard bought
      // nothing and every /direct paid a 500-row query first.
      const anyLiveDirectable = scoped.some((r) => DIRECTABLE.has(String(r.status || '')));
      const history = (suffix || !anyLiveDirectable)
        ? await actions.history({ limit: DIRECT_REF_HISTORY })
        : [];
      const known = suffix ? [...actions.listRuns(), ...history] : [];
      // A paused run that has LEFT the in-memory Map — any server restart — is
      // still directable: postDirection resolves it from the DB and resume replays
      // the inbox, which is why the HTTP route accepts it. Widening recognition
      // alone (last round) only changed the error text; the run has to be in the
      // TARGET set too, or chat still refuses what the route files. Same status
      // filter, so a finished row stays refused.
      const scope = projectOf(chatKey);
      const inScope = (r) => !scope || lastPathSegment(r.projectDir) === scope
        || (r.projectNames || []).includes(scope);
      const fromHistory = history
        .filter((r) => DIRECTABLE.has(String(r.status || '')) && inScope(r)
          && !scoped.some((x) => x.runId === r.id || x.pipelineId === r.id))
        .map((r) => ({ runId: r.id, pipelineId: r.id, title: r.title, status: r.status, projectDir: r.projectDir }));
      const runs = [...scoped, ...fromHistory];
      const hasRef = !!suffix && known.some((x) => String(x.runId || x.id || '').endsWith(suffix)
        || String(x.pipelineId || '').endsWith(suffix));
      const t = resolveTarget(hasRef ? args[0] : '', runs, [], { wantLive: true, targetable: DIRECTABLE, noun: 'running or paused' });
      if (t.error) return t.error;
      // parseCommand drops @mentions ANYWHERE in the text, so `@bot /direct …`
      // dispatches here — but anchoring the slice on `/direct` at position 0 left
      // the mention AND the command literal inside the direction, and that string
      // is what renderDirectionsBlock puts in the next agent's prompt. Addressing
      // the bot by name is the normal form in a group channel, which is exactly
      // where /direct is used. Strip leading mentions first.
      // Strip mentions that come BEFORE the command ("@bot /direct …", the normal
      // group-channel addressing form parseCommand already tolerates), and
      // nothing after it. A mention following the command cannot be told apart
      // from the direction's own subject, and deleting that is the worse error:
      // "/direct @alice should sign off on slide 3" must not reach the agent as
      // "should sign off on slide 3". A leading bot handle left in the text is
      // noise; a deleted subject changes what the direction says.
      const raw = String(msg.text || '')
        .replace(LEADING_MENTIONS_RE, '')
        .replace(/^\/direct(?:@\S+)?\s*/i, '');
      // The consumed ref is not always the first token of `raw`: parseCommand
      // strips mentions ANYWHERE, so `/direct @bot *a1b2c3d4 …` makes `*a1b2c3d4`
      // args[0] while `raw` still opens with `@bot`. Step over any mentions to
      // reach the ref and delete only the ref — putting them back with `$1`,
      // because a mention after the command may be the direction's subject and
      // deleting that is the worse error.
      const text = (hasRef ? raw.replace(LEADING_REF_RE, '$1') : raw).trim();
      if (!text) return reply('Usage: `/direct [*ref] <what to change>`', 'warning');
      // appendDirection silently slices at DIRECTION_MAX_CHARS, and the HTTP twin
      // 400s rather than let that happen quietly. Without this, chat confirmed a
      // pasted over-long direction as "recorded" while the agent got a sentence cut
      // off mid-word — the exact divergence DIRECTIONS_CLOSED was extracted to end.
      if (text.length > DIRECTION_MAX_CHARS) {
        return reply(`That direction is ${text.length} characters; the limit is ${DIRECTION_MAX_CHARS}. `
          + 'Shorten it — a truncated direction reaches the agent cut off mid-sentence.', 'warning');
      }
      // postDirection throws RUN_FINISHED when the run settles between resolving it
      // and posting — reachable simply by timing, since /direct targets live AND
      // paused runs — and the actions wrapper throws on a run that has left the Map.
      // Uncaught, both reached the router's generic wrapper as "Command failed: …",
      // while the `!rec` path below already answers this shape of problem properly.
      let rec;
      try {
        rec = await actions.direct(t.run.runId, text, platform);
      } catch (err) {
        if (err && err.code === 'RUN_FINISHED') {
          return reply(`\`${runRef(t.run.runId)}\` has finished — a direction posted now would never be read.`, 'warning');
        }
        if (err && /unknown runId/.test(String(err.message || ''))) {
          return reply(`\`${runRef(t.run.runId)}\` is no longer running. \`/runs\` lists what is.`, 'warning');
        }
        throw err;
      }
      // No record = the row could not be resolved (a run launched but not yet
      // seen a `state` event still carries its UUID, not its pipeline id). The
      // HTTP twin 404s on the same null; reporting success here would tell the
      // user a direction was filed that no step will ever read.
      if (!rec) {
        return reply(`Could not file that direction for \`${runRef(t.run.runId)}\` — the run is not addressable yet. Try again in a moment.`, 'warning');
      }
      return reply(`Direction **${rec.id}** recorded for \`${runRef(t.run.runId)}\` — the next step will see it.`, 'success');
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

  async function answerDecision({ chatKey, args, actor }, verb) {
    const t = resolveTarget(args[0], scopedRuns(chatKey), [], { wantLive: true });
    if (t.error) return t.error;
    const ref = runRef(t.run.runId);
    const pq = actions.pendingQuestion(t.run.runId);
    if (!pq) {
      return reply(`\`${ref}\` is not waiting on a decision.${verb === 'cancel' ? ` \`/stop ${ref}\` stops the run.` : ''}`, 'warning');
    }
    const givingUp = verb === 'abort' || verb === 'cancel';
    let payload;
    let what;
    if (pq.kind === 'gate') {
      if (givingUp) {
        return reply(`Gates have no ${verb} — \`/approve ${ref}\` continues without another cycle, `
          + `\`/retry ${ref}\` runs another cycle, \`/stop ${ref}\` stops the run.`, 'warning');
      }
      payload = { decision: verb === 'approve' ? 'continue' : 'another' };
      what = payload.decision === 'continue' ? 'approved — continuing' : 'sent back for another cycle';
    } else if (pq.kind === 'recovery') {
      // /abort and /cancel are the give-up choice; what it does (pause or abort) is
      // the row's option (failure-policy.mjs) — the option id is the wire decision.
      payload = { decision: givingUp ? giveUpOption(pq.recovery?.options).id : 'retry' };
      what = payload.decision === 'retry' ? 'retrying' : payload.decision === 'abort' ? 'aborting the run' : 'pausing the run';
    } else if (pq.kind === 'workflow') {
      // An Auto proposal (orchestrator _autoAsk): the web card's own payloads —
      // sanitizeProposalAnswer fills name/nodes from the proposal on accept.
      if (verb === 'retry') {
        return reply(`To change the proposed workflow, say what to change: \`/answer ${ref} <what to change>\`.`, 'warning');
      }
      payload = { decision: verb === 'approve' ? 'accept' : 'cancel' };
      what = payload.decision === 'accept' ? 'workflow accepted — the run continues' : 'workflow proposal cancelled — the run stops';
    } else {
      return reply(`\`${ref}\` is waiting on ${pq.kind} — use \`/answer ${ref} <n>\`.`, 'warning');
    }
    await actions.answer(t.run.runId, pq.id, payload, actor);
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
      const parsed = parseCommand(msg.text);
      if (!guard.isAllowed({ platform, chatId: msg.chatId })) {
        // Chatter in a watched group is never a refusal; a command is — tell the
        // observer (Settings shows it) and maybe the chat (refuse()).
        return parsed ? refuse({ plugin, channelId, platform, channelConfig, msg }, parsed.command) : null;
      }
      if (!parsed) return null; // non-commands are never interpreted
      const handler = Object.hasOwn(handlers, parsed.command) ? handlers[parsed.command] : null;
      const chatKey = `${platform}:${msg.chatId}`;
      if (!handler) return reply(`Unknown command \`/${parsed.command}\` — \`/help\` lists commands.`, 'warning');
      // Who sent it, as attribution TEXT ("ada via Slack"): the platform's display name or
      // user id, never a sign-in identity. Actions that change a run record it.
      const meta = msg.meta && typeof msg.meta === 'object' ? msg.meta : {};
      const actor = chatActor({ platform, userName: meta.username || meta.name || meta.userName || null, userId: msg.userId });
      try {
        return await handler({ chatKey, platform, plugin, channelId, msg, args: parsed.args, actor });
      } catch (err) {
        logger('error', `chat command /${parsed.command} failed: ${err?.message || err}`);
        return reply(`Command failed: ${String(err?.message || err).slice(0, 200)}`, 'error');
      }
    },
  };
}
