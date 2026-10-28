// src/core/ask/action-deps.mjs
// worca Chat P2 (U1, R6–R10): the PARENT's half of the chat's act-then-undo tools. The MCP child validated what the
// model asked for (tools.mjs); this applies it with the same in-process functions the HTTP routes call — never a
// loopback request — and hands back the card the turn adds to the reply: a revertible receipt, a run-stop warning or
// a pull-request offer. revert() and stop() are the cards route's half. Every effect comes in through deps
// (ui/server.mjs wires the real ones), so this module does no I/O of its own.
import { receiptCard } from './receipt.mjs';
import { RUN_SWITCH_OPTIONS } from '../../shared/away-mode/labels.mjs';

const SETTLED = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
const FINISHED = new Set(['done', 'stopped', 'error']);
const AWAY_WORDS = Object.freeze({ auto: 'Following away hours', here: "I'm back", on: "I'm away now", off: 'Paused' });
const RUN_SWITCH_WORDS = Object.freeze(Object.fromEntries(RUN_SWITCH_OPTIONS.map((o) => [o.value, o.label])));
const STATUS_WORDS = Object.freeze({ running: 'Running', paused: 'Paused', interrupted: 'Interrupted', pausing: 'Pausing', starting: 'Starting' });
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const msg = (err) => String((err && err.body && err.body.error) || (err && err.message) || err || 'unknown error');
const parseObj = (v) => { if (v && typeof v === 'object') return v; try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const nightOf = (entry) => (entry && entry.orch && entry.orch.state && entry.orch.state.night && entry.orch.state.night.override) || 'auto';
/** A resume refusal only the user's own click gets past (resumeRun's confirmation gates, R8). */
const needsUser = (err) => {
  const b = (err && err.body) || {};
  return !!(b.needsOverride || b.needsPolicyAck || b.needsPolicyOverride || ['engine-refused', 'base-moved', 'base-missing'].includes(b.code));
};
/** The feature branch a stop warning names: a workspace run keeps one per member (workspace_meta). */
const featureOf = (row) => (row && row.target === 'workspace'
  ? (Object.values(parseObj(row.workspace_meta).branches || {}).find((b) => b && b.feature) || {}).feature
  : parseObj(row && row.branch).feature) || '';

export function createChatActionHost({
  settings, liveRun, findRow, pauseRun, resumeRun, stopRun, stopPausedPipeline, postDirection,
  scheduleVerb, getSchedule, awaySwitchFor, awayStatusFor, prState, prCardFacts,
  serial = (fn) => fn(),          // the settings write queue (ui/server.mjs): set_away_now writes settings.json too
}) {
  /** A run by the child's id (a live UUID or an 8-hex pipeline id): its live entry, its row and what to call it. */
  function runOf(id) {
    const key = String(id || '');
    const live = key ? (liveRun(key) || null) : null;
    const row = (live && live.pipelineId ? findRow(live.pipelineId) : null) || (key ? findRow(key) : null) || null;
    const pipelineId = (live && live.pipelineId) || (row && row.id) || null;
    return { live, row, pipelineId, title: (live && live.title) || (row && row.title) || pipelineId || key,
      status: String((live && live.status) || (row && row.status) || '') };
  }
  const applied = (card) => ({ ok: true, block: { state: 'applied', card } });
  const proposed = (card) => ({ ok: true, block: { state: 'proposed', card } });
  const notice = (text) => ({ ok: false, notice: text });
  const runReceipt = (kind, run, before, after, liveId) => receiptCard({ kind, label: 'Run', target: { runId: liveId || null, pipelineId: run.pipelineId, title: run.title },
    before: STATUS_WORDS[before] || before, after: STATUS_WORDS[after] || after, raw: { before, after }, revertible: true });

  /** One validated request from the child (turn.mjs _onChatAction). Re-checks the run against NOW (Review Focus 2). */
  async function apply(req, { actor = 'local' } = {}) {
    const kind = req && req.kind;
    if (kind === 'setting') {
      let r;
      try { r = await settings.apply({ id: req.id, scope: req.scope, projectKey: req.projectKey || null, value: req.value }); }
      catch (err) { return notice(`Could not change ${req.id}: ${msg(err)}`); }
      if (r && r.ok && r.card) return applied(r.card);
      if (r && r.ok && r.unchanged) return notice(r.notice);
      return notice(`Could not change ${req.id}: ${(r && r.error) || 'unknown error'}`);
    }
    if (kind === 'schedule-pause' || kind === 'schedule-resume') {
      const s = (req && req.schedule) || {};
      if (!s.id) return notice('Could not show the schedule change');
      const pause = kind === 'schedule-pause';
      return applied(receiptCard({ kind, label: 'Schedule', target: { scheduleId: s.id, title: s.title || s.id },
        before: pause ? 'Active' : 'Paused', after: pause ? 'Paused' : 'Active', raw: { before: pause ? 'active' : 'paused', after: pause ? 'paused' : 'active' }, revertible: true }));
    }
    const run = runOf(req && req.runId);
    if (!run.pipelineId && !run.live) return notice(`Could not find run ${clip(req && req.runId, 40)}`);
    if (kind === 'pause') {
      if (run.status !== 'running') return notice(`Could not pause ${run.title}: it is ${run.status || 'not running'}`);
      if (!run.live) return notice(`Could not pause ${run.title}: it was not started here`);   // a CLI run, or another server's
      try { await pauseRun(run.live.id, actor); } catch (err) { return notice(`Could not pause ${run.title}: ${msg(err)}`); }
      return applied(runReceipt('pause', run, 'running', 'paused', run.live.id));
    }
    if (kind === 'resume') {
      if (run.status !== 'paused' && run.status !== 'interrupted') return notice(`Could not resume ${run.title}: it is ${run.status || 'unknown'}`);
      let r;
      // baseCheck: like every Resume button (app.js resumeBody) — a moved or missing base needs the user's say-so.
      try { r = await resumeRun(run.pipelineId, { by: actor, baseCheck: true }); }
      catch (err) { return notice(`Could not resume ${run.title}: ${msg(err)}${needsUser(err) ? ' — press Resume on the run card to confirm.' : ''}`); }
      return applied(runReceipt('resume', run, run.status, 'running', r && r.runId));
    }
    if (kind === 'stop') {
      if (run.row && run.row.archived_at) return notice(`${run.title} is archived — restore it from History first`);
      if (run.status === 'interrupted') return notice(`${run.title} is interrupted: it stays resumable and can't be stopped`);
      if (FINISHED.has(run.status)) return notice(`${run.title} is already ${run.status}`);
      // stop() can end a live run here or a paused one from its row — never a run another process is driving.
      if (!run.live && run.status !== 'paused') return notice(`Could not stop ${run.title}: it was not started here`);
      return proposed({ type: 'run-stop', runId: run.live ? run.live.id : null, pipelineId: run.pipelineId, title: run.title, branch: featureOf(run.row), status: run.status });
    }
    if (kind === 'direction') {
      const text = String((req && req.text) || '').trim();
      if (!text) return notice('Could not send the direction: it is empty');
      if (FINISHED.has(run.status)) return notice(`${run.title} is already ${run.status}: a direction would never be read`);
      let rec;
      try {
        // A live run takes it straight (review P2-5: a run still starting may have no saved row for postDirection yet);
        // otherwise the saved run's inbox, which a paused run reads when it resumes.
        // Source 'chat': the run records it as coming from the chat (lead call 7; P3's directions route posts the same).
        rec = run.live && run.live.orch && typeof run.live.orch.direct === 'function'
          ? await run.live.orch.direct(text, 'chat')
          : await postDirection(run.pipelineId, text, 'chat');
      } catch (err) {
        // run-harness.mjs direct() before createPipeline returned: the run has nowhere to keep it yet.
        if (/no pipeline dir yet/.test(msg(err))) return notice(`Could not send the direction to ${run.title}: it has no saved record yet — try again in a moment`);
        return notice(`Could not send the direction to ${run.title}: ${msg(err)}`);
      }
      if (!rec) return notice(`Could not send the direction to ${run.title}: it has no saved record yet — try again in a moment`);
      return applied(receiptCard({ kind: 'direction', label: 'Direction', target: { runId: run.live ? run.live.id : null, pipelineId: run.pipelineId, title: run.title },
        before: '', after: clip(text, 280), raw: { before: null, after: { id: rec.id || null } }, revertible: false }));
    }
    if (kind === 'pull-request') {
      if (!run.row) return notice(`Could not offer a pull request for ${run.title}: it has no saved record yet`);
      if (run.row.archived_at) return notice(`${run.title} is archived — restore it from History first`);
      if (!FINISHED.has(run.status)) return notice(`${run.title} is ${run.status}: a pull request is for a finished run`);
      const pr = run.row.target !== 'workspace' ? prState(run.row.id) : null;
      if (pr && pr.url) return notice(`${run.title} already has a pull request: ${pr.url}`);
      let facts;
      try { facts = await prCardFacts(run.row); } catch (err) { return notice(`Could not offer a pull request for ${run.title}: ${msg(err)}`); }
      if (!facts || !facts.branch) return notice(`${run.title} has no feature branch to create a PR from`);
      return proposed({ type: 'pull-request', ...facts });
    }
    return notice('Could not do that: unknown action');
  }

  /** set_away_now / set_run_away_mode (the turn's awaySwitch dep): the switch as before, plus a receipt when it changed. */
  function awaySwitch(req, o = {}) { return serial(() => awaySwitchNow(req, o)); }
  async function awaySwitchNow(req, { actor = 'local', person = null } = {}) {
    const sw = awaySwitchFor(person);
    if (req && req.kind === 'global') {
      const before = awayStatusFor(person);
      const r = await sw(req, { actor });
      if (!r || !r.ok) return r;
      const after = awayStatusFor(person);
      if (before === after) return r;
      return { ...r, receipt: receiptCard({ kind: 'away-now', label: 'Away mode', target: {}, before: AWAY_WORDS[before] || before, after: AWAY_WORDS[after] || after,
        raw: { before, after, person: person || null }, revertible: true }) };
    }
    if (req && req.kind === 'run') {
      const entry = liveRun(String(req.runId || ''));
      const before = nightOf(entry);
      const r = await sw(req, { actor });
      if (!r || !r.ok || !entry) return r;
      const after = nightOf(entry);
      if (before === after) return r;
      return { ...r, receipt: receiptCard({ kind: 'run-away', label: 'Away mode on this run', target: { runId: entry.id, pipelineId: entry.pipelineId || null, title: entry.title || entry.id },
        before: RUN_SWITCH_WORDS[before] || before, after: RUN_SWITCH_WORDS[after] || after, raw: { before, after }, revertible: true }) };
    }
    return sw(req, { actor });
  }

  const changed = () => ({ ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
  const failed = (error) => ({ ok: false, code: 'REVERT_FAILED', error });
  const reverted = (card, to = card.before) => ({ ok: true, notice: `Reverted: ${card.label}${card.target && card.target.title ? ` (${card.target.title})` : ''} back to ${to}` });

  /** The cards route's Revert (R6): re-read, refuse a value that moved on, write raw.before through the original path. */
  async function revert(card, { actor = 'local', viewer = null } = {}) {
    if (!card || card.revertible !== true) return { ok: false, code: 'NOT_REVERTIBLE', error: 'This change cannot be reverted' };
    const raw = card.raw || {};
    const t = card.target || {};
    switch (card.kind) {
      case 'setting': return settings.revert(card);
      case 'pause': {
        const run = runOf(t.pipelineId || t.runId);
        if (run.status === 'pausing') return failed('The run is still pausing — try again in a moment');
        if (run.status !== 'paused') return changed();
        try { await resumeRun(run.pipelineId, { by: actor, baseCheck: true }); }
        catch (err) { return failed(`${msg(err)}${needsUser(err) ? ' — press Resume on the run card to confirm' : ''}`); }
        return reverted(card);
      }
      case 'resume': {
        const run = runOf(t.pipelineId || t.runId);
        if (run.status === 'starting') return failed('The run is still starting — try again in a moment');
        if (run.status !== 'running' || !run.live) return changed();
        try { await pauseRun(run.live.id, actor); } catch (err) { return failed(msg(err)); }
        return reverted(card, STATUS_WORDS.paused);           // an interrupted run, resumed then paused, is Paused now
      }
      case 'away-now': return serial(async () => {
        const person = raw.person || null;
        // A person's own switch is theirs to put back: an ownerless (legacy) thread is reached by every signed-in person.
        if (person && viewer && String(viewer).toLowerCase() !== String(person).toLowerCase()) return { ok: false, code: 'NOT_REVERTIBLE', error: 'This change cannot be reverted' };
        if (awayStatusFor(person) !== raw.after) return changed();
        const r = await awaySwitchFor(person)({ kind: 'global', toggle: raw.before }, { actor });
        return r && r.ok ? reverted(card) : failed((r && r.error) || 'Away mode did not change');
      });
      case 'run-away': {
        const entry = liveRun(String(t.pipelineId || t.runId || ''));
        // A run that finished since can no longer change its switch (setNightOverride refuses): changed, not a failed write.
        if (!entry || FINISHED.has(String(entry.status)) || nightOf(entry) !== raw.after) return changed();
        const r = await awaySwitchFor(null)({ kind: 'run', runId: entry.id, mode: raw.before }, { actor });
        return r && r.ok ? reverted(card) : failed((r && r.error) || 'Away mode on this run did not change');
      }
      case 'schedule-pause':
      case 'schedule-resume': {
        const s = getSchedule(t.scheduleId);
        if (!s || s.status !== raw.after) return changed();
        const r = await scheduleVerb(raw.after === 'paused' ? 'resume' : 'pause', s.id, {}, { by: actor });
        return r && r.status === 200 ? reverted(card) : failed((r && r.body && r.body.error) || 'the schedule did not change');
      }
      default: return { ok: false, code: 'NOT_REVERTIBLE', error: 'This change cannot be reverted' };
    }
  }

  /** The run-stop card's "Stop run" (R7): the same split POST /api/stop makes — a live run stops in place, a paused
   *  run settles from its saved row; an interrupted one is never stopped. */
  async function stop(card, { actor = 'local' } = {}) {
    const run = runOf(card && (card.pipelineId || card.runId));
    if (run.status === 'interrupted') return { ok: false, code: 'INTERRUPTED', error: "An interrupted run can't be stopped — it stays resumable" };
    if (FINISHED.has(run.status)) return { ok: false, code: 'FINISHED', error: `The run is already ${run.status}` };
    try {
      if (run.live && (!SETTLED.has(run.status) || run.status === 'paused')) await stopRun(run.live.id, actor);
      else if (run.pipelineId) await stopPausedPipeline(run.pipelineId, actor);
      else return { ok: false, code: 'NOT_FOUND', error: 'The run is gone' };
    } catch (err) { return { ok: false, code: (err && err.code) || 'ERROR', error: msg(err) }; }
    return { ok: true };
  }

  return { apply, revert, stop, awaySwitch };
}
