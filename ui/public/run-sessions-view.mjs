// ui/public/run-sessions-view.mjs — the run page's Sessions tab (session groups, Task 58; spec §6.5, 05 §6). One card per
// session: who ran it (engine, mode, main agent, the host session id), what each step cost (a stacked bar, the hand-offs
// hatched), every turn, and whether the figures add up; then a dashed "Outside sessions" card for the steps that started
// their own harness session, with the reason. Data: GET /api/runs/:id/sessions (Task 54), the run's ledger rows and its
// manifest. A live run refetches after a trace record (a `sessionHost` frame), at most every LIVE_TTL_MS. DOM builders
// only: every text goes through textContent.
import { fmtUsd, fmtDur, sessionReasonText, decorFromState } from './graph/run-decor.mjs';
import { engineLabel, engineReportsCost } from '../../src/shared/engine-switch.mjs';
import { manifestTemplate, manifestPortsFn } from '../../src/shared/graph/manifest.mjs';
import { sessionsOf } from '../../src/shared/graph/sessions.mjs';
import { BOOKEND_EXECUTION_IDS, KEYED_KINDS } from '../../src/shared/graph/constants.mjs';

const LIVE_TTL_MS = 2000;
const CACHE_MAX = 20;   // runs kept; the least recently painted one goes first
const cache = new Map();   // runId -> { at (last settled fetch), data, inflight, live }, oldest use first

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;   // cents, as run-decor.mjs rounds the tray
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tok = (n) => (!finite(n) ? '0' : n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`);
const turnNo = (turnId) => String(turnId ?? '').split(':').pop() || '?';
const MODE_TEXT = { subagents: 'Sub-agents', shared: 'One conversation', separate: 'Separate sessions' };
/** A summary's status as the card says it: [word, status-dot colour]. */
const STATE = { busy: ['Running', 'is-peach is-pulse'], idle: ['Between turns', 'is-grey'], cold: ['Not started', 'is-grey-ring'], paused: ['Paused', 'is-amber'],
  separate: ['Separate sessions', 'is-grey-ring'], done: ['Done', 'is-green'], stopped: ['Stopped', 'is-red'], error: ['Failed', 'is-red'] };
/** A run that is over while its session's last record says it was working (no `close`: the server stopped mid-turn). */
const OVER = { interrupted: ['Interrupted', 'is-red'], stopped: ['Stopped', 'is-red'], error: ['Failed', 'is-red'], paused: ['Paused', 'is-amber'],
  done: ['Done', 'is-green'] };
const HISTORY_WORDS = { rotate: 'rotated to a fresh host', restart: 'restarted fresh', resume: 'resumed', pause: 'paused', degrade: 'runs as separate sessions' };
/** One history entry in words: a reason that only repeats the kind (a pause record's `pause`) is dropped, and no
 *  connector dangles without one (the CLI's historyText, correction 29). */
function historyWords(h) {
  const reason = h.reason && h.reason !== h.kind ? sessionReasonText(h.reason) : '';
  const word = HISTORY_WORDS[h.kind] || h.kind;
  if (!reason) return word;
  return h.kind === 'resume' ? `${word} after ${reason}` : h.kind === 'degrade' ? `${word} — ${reason}` : `${word} (${reason})`;
}
/** A summary status that is not a close: the session was still working when its last record was written. */
const WORKING = new Set(['busy', 'idle', 'cold', 'paused']);

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
/** `10:46`: a local 24-hour clock ('' when unreadable). */
function hhmm(iso) {
  if (typeof iso !== 'string' || !iso) return '';            // new Date(null) is 1970, not "unknown"
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}
/** `$0.65` / `—`: unknown is a dash, never $0.00. */
const usdOr = (v, known = true) => (known && finite(v) ? fmtUsd(v) : '—');
/** Two figures that differ only past the cent print with four decimals, so a failed check never reads "$0.65 vs $0.65". */
function usdPair(a, b) {
  const f = (x, d) => (finite(x) ? `$${x.toFixed(d)}` : 'unknown');
  return f(a, 2) === f(b, 2) && finite(a) && finite(b) && a !== b ? [f(a, 4), f(b, 4)] : [f(a, 2), f(b, 2)];
}
const shortId = (id) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

/** The tab shows when the run has a session: a summary in its state, or a session in its manifest. */
export function sessionsTabVisible(state) {
  return sessionCount(state) > 0;
}
/** The tab's badge: the number of sessions, or null. */
export function sessionsBadge(state) {
  const n = sessionCount(state);
  return n ? String(n) : null;
}
function sessionCount(state) {
  if (!state || typeof state !== 'object') return 0;
  const sids = new Set(state.sessionHosts && typeof state.sessionHosts === 'object' ? Object.keys(state.sessionHosts) : []);
  for (const s of manifestSessions(state.stepper)) sids.add(s.sid);
  return sids.size;
}
const specsMemo = new WeakMap();   // stepper -> its sessions (the tab signature, the badge and the outside rows ask per frame)
function manifestSessions(stepper) {
  const nodes = stepper && stepper.graph && Array.isArray(stepper.graph.nodes) ? stepper.graph.nodes : [];
  if (!nodes.some((n) => n && n.config && n.config.session != null)) return [];   // ungrouped: nothing derived
  if (!specsMemo.has(stepper)) specsMemo.set(stepper, sessionsOf(manifestTemplate(stepper), manifestPortsFn(stepper)));
  return specsMemo.get(stepper);
}

/** The members in bar order (the summary's, else the order they first ran), only those with a priced turn: a member that
 *  has not run, or whose turn has no cost record yet, is no $0.00 share (the mock lists the members with turns). */
function membersOf(session, rows) {
  const out = Array.isArray(session.members) ? [...session.members] : [];
  for (const r of rows) if (r.nodeId && !out.includes(r.nodeId)) out.push(r.nodeId);
  return out.filter((id) => rows.some((r) => r.nodeId === id && finite(r.memberUsd)));
}

/** One session's card. `engineCost`: the engine reports a cost (else every figure is a dash). `runStatus` + `live`: a run
 *  that is over shows its own end on a session whose last record says it was still working. `logLevel`: the level of
 *  the Logs tab the Log buttons open (null: no Log button, the run has no log). `runEngine`: the engine when the trace
 *  lost its open line. `membersUsd`: the session's cost as its tray says it (Σ its members' rows, `membersUsdOf`); the
 *  trace's own sum when absent. `outsideUsd`: the part of it the trace never saw (`outsideUsdOf`). `tray`: the session's
 *  tray (run-decor.mjs `decor.sessions[sid]`): its time, and its `done` on a live session whose host is idle. */
export function renderSessionCard(session, { doc, labelOf = (id) => id, engineCost = true, runStatus = null, live = true, logLevel = 'advanced', runEngine = null, membersUsd = null, outsideUsd = null, tray = null } = {}) {
  const s = session || {};
  const rows = Array.isArray(s.turnRows) ? s.turnRows : [];
  const card = el(doc, 'article', 'rs-card');
  card.dataset.sessionId = s.sid || '';
  const name = (id) => labelOf(id) || id || '—';

  // Head: the state, the label, how it ran, the host session id (copyable) and the totals.
  const head = el(doc, 'div', 'rs-head');
  const title = el(doc, 'div', 'rs-title');
  // No close yet: on a run that is over, its end (a pause the run was stopped from included); on a live run, done once
  // the tray says so (every member done and no loop coming back, correction 57), though the host stays open to the end.
  const settled = live && !!tray && tray.status === 'done' && (s.status === 'idle' || s.status === 'cold');
  const [word, dot] = (!live && WORKING.has(s.status) && runStatus ? OVER[runStatus] || ['Ended', 'is-grey-ring'] : null)
    || (settled ? STATE.done : null) || STATE[s.status] || [s.status ? String(s.status) : 'Not started', 'is-grey-ring'];
  const stillWorking = live && WORKING.has(s.status) && !settled;
  const state = el(doc, 'span', 'rs-state');
  const d = el(doc, 'i', `status-dot ${dot}`);
  d.setAttribute('aria-hidden', 'true');
  state.append(d, doc.createTextNode(word));
  title.append(state, el(doc, 'b', null, s.label || 'One session'));
  const meta = el(doc, 'div', 'rs-meta');
  const engineOf = s.engine || runEngine;
  const how = [MODE_TEXT[s.mode] || 'Mode unknown', s.mode !== 'separate' ? s.transport : null, engineOf ? engineLabel(engineOf) : null,
    s.mode === 'subagents' ? `main agent ${s.hostModel || 'default model'}` : null].filter(Boolean).join(' · ');
  meta.appendChild(el(doc, 'span', null, how));
  if (s.hostSessionId) {
    const host = el(doc, 'span', null, 'host session ');
    host.appendChild(el(doc, 'code', null, shortId(String(s.hostSessionId))));
    if (s.hostEpoch > 1) host.appendChild(doc.createTextNode(` (epoch ${s.hostEpoch})`));
    const copy = el(doc, 'button', 'btn btn-sm btn-quiet rs-copy', 'Copy id');
    copy.type = 'button';
    copy.dataset.copy = String(s.hostSessionId);
    copy.title = 'Copy the host session id';
    meta.append(host, copy);
  }
  // The tray's figures (Σ the members' rows): a member run outside a host turn (a runtime degrade, ×N slices, a session
  // separate from the start) books its cost and time only on its row. The part the trace never saw is named when the
  // session had a turn.
  const durMs = tray && finite(tray.durMs) ? tray.durMs : rows.reduce((a, r) => a + (finite(r.durationMs) ? r.durationMs : 0), 0);
  const totalUsd = finite(membersUsd) ? membersUsd : s.costUsd;
  const outside = engineCost && finite(outsideUsd) && outsideUsd >= 0.01 && (s.turns ?? 0) > 0 ? ` · incl. ${fmtUsd(outsideUsd)} outside the host` : '';
  const total = el(doc, 'div', 'rs-total');
  total.append(el(doc, 'span', 'rs-total-v', usdOr(totalUsd, engineCost)), el(doc, 'span', 'rs-total-s',
    `${plural(s.turns ?? rows.length, 'turn')} · ${fmtDur(durMs)}${outside}`));
  head.append(title, meta, total);
  card.appendChild(head);
  if (s.mode === 'separate' && s.modeReason) card.appendChild(el(doc, 'p', 'rs-why', `Its steps ran as separate sessions: ${sessionReasonText(s.modeReason)}.`));

  // The stacked bar: one segment per member (its share of the session cost), then the hand-offs, hatched.
  if (engineCost && finite(s.costUsd) && s.costUsd > 0) {
    const members = membersOf(s, rows);
    const parts = members.map((id) => ({ label: name(id), usd: rows.filter((r) => r.nodeId === id).reduce((a, r) => a + (finite(r.memberUsd) ? r.memberUsd : 0), 0) }));
    if (finite(s.hostOverheadUsd) && s.hostOverheadUsd > 0) parts.push({ label: 'Hand-offs', usd: s.hostOverheadUsd, hand: true });
    const bar = el(doc, 'div', 'rs-bar');
    bar.setAttribute('role', 'img');
    const legend = el(doc, 'div', 'rs-legend');
    const words = [];
    parts.forEach((p, i) => {
      const pct = Math.round((p.usd / s.costUsd) * 100);
      const seg = el(doc, 'span', p.hand ? 'rs-hand' : `rs-seg rs-seg-${i % 4}`);
      seg.style.width = `${Math.max(0, (p.usd / s.costUsd) * 100).toFixed(2)}%`;
      seg.title = `${p.label} ${fmtUsd(p.usd)} (${pct}%)`;
      bar.appendChild(seg);
      const key = el(doc, 'span');
      key.append(el(doc, 'i', p.hand ? 'rs-hand' : `rs-seg rs-seg-${i % 4}`), doc.createTextNode(`${p.label} ${fmtUsd(p.usd)}`));
      legend.appendChild(key);
      words.push(`${p.label} ${fmtUsd(p.usd)}`);
    });
    bar.setAttribute('aria-label', `Cost split: ${words.join(', ')}`);
    card.append(bar, legend);
  }

  // Every turn (spec §6.5).
  if (rows.length) {
    const wrap = el(doc, 'div', 'table-wrap rs-turns-wrap');
    const table = el(doc, 'table', 'table rs-turns');
    const COLS = ['Turn', 'Step', 'Attempt', 'Started', 'Duration', 'Tokens in/out/cache', 'Cost', 'Source', 'Verdict', 'Open'];
    const NUM = new Set(['Attempt', 'Duration', 'Tokens in/out/cache', 'Cost']);
    const tr = el(doc, 'tr');
    for (const c of COLS) { const th = el(doc, 'th', NUM.has(c) ? 'num' : null, c === 'Open' ? '' : c); if (c === 'Open') th.appendChild(el(doc, 'span', 'sr-only', 'Open')); tr.appendChild(th); }
    const thead = el(doc, 'thead');
    thead.appendChild(tr);
    const tbody = el(doc, 'tbody');
    for (const r of rows) {
      const t = r.tokens;
      const known = engineCost && r.costSource !== 'none' && (finite(r.memberUsd) || finite(r.hostOverheadUsd));
      const cost = known ? (finite(r.memberUsd) ? r.memberUsd : 0) + (finite(r.hostOverheadUsd) ? r.hostOverheadUsd : 0) : null;
      const verdict = r.verdict ? (finite(r.issues) && r.issues > 0 ? `${r.verdict} · ${plural(r.issues, 'issue')}` : r.verdict) : '—';
      const cells = [turnNo(r.turnId), name(r.nodeId), r.attempt ?? '—', hhmm(r.startedAt) || '—', finite(r.durationMs) ? fmtDur(r.durationMs) : '—',
        t ? `${tok(t.in)} / ${tok(t.out)} / ${tok((t.cr || 0) + (t.cw || 0))}` : '—', usdOr(cost), r.costSource || '—', verdict];
      const row = el(doc, 'tr');
      cells.forEach((v, i) => {
        const td = el(doc, 'td', NUM.has(COLS[i]) ? 'num' : i === 1 ? 'table-main' : null, String(v));
        td.dataset.label = COLS[i];
        row.appendChild(td);
      });
      const costCell = row.children[6];
      if (known) {
        const parts = [`step ${finite(r.memberUsd) ? fmtUsd(r.memberUsd) : 'unknown'} + hand-off ${finite(r.hostOverheadUsd) ? fmtUsd(r.hostOverheadUsd) : 'unknown'}`];
        if (finite(r.carriedUsd) && r.carriedUsd > 0) parts.push(`it also carried ${fmtUsd(r.carriedUsd)} of a cut turn, booked on that turn's row`);
        costCell.title = parts.join('; ');
      }
      if (r.watchdog && r.watchdog.code) row.children[8].title = `watchdog: ${r.watchdog.code}`;
      const links = el(doc, 'td', 'rs-links');
      links.dataset.label = 'Open';
      const which = `${name(r.nodeId)}, turn ${turnNo(r.turnId)}`;
      const link = (text, attr, value, tip, aria, level) => {
        const b = el(doc, 'button', 'btn btn-sm btn-quiet', text);
        b.type = 'button';
        b.dataset[attr] = String(value);
        b.title = tip;
        b.setAttribute('aria-label', aria);
        if (level) b.dataset.minLevel = level;
        links.appendChild(b);
        return b;
      };
      if (r.executionId && logLevel) link('Log', 'logExec', r.executionId, 'This step\'s lines in the run log', `Log of ${which}`, logLevel).dataset.nodeId = r.nodeId || '';
      if (r.memberAgentId) link('Sub-agent', 'subagent', r.memberAgentId, 'This step\'s sub-agent on the Agents tab', `Sub-agent of ${which}`, 'expert');
      if (r.memberTranscriptId) link('Copy transcript id', 'transcript', r.memberTranscriptId, 'The id of the sub-agent\'s own transcript in the host session', `Copy the transcript id of ${which}`);
      row.appendChild(links);
      tbody.appendChild(row);
    }
    table.append(thead, tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
  }

  // Whether it adds up (the mock's three words): every failed check, the harness figure first (the harness figure is what
  // was booked); a check that failed with no figures to show (the host's close says so, its failed record was lost:
  // correction 54); else no cost to compare on this engine, the checks still coming on a live session, or reconciled
  // (only a report that says so: `ok` is true | false | null). A trace nothing was checked on (unreadable, no valid line)
  // or a session that ran no host turn (separate, or one that ended before its first) says nothing; a live one still
  // waiting for its first turn says the checks are coming.
  const rec = el(doc, 'div', 'rs-reconcile');
  const mism = s.reconcile && Array.isArray(s.reconcile.mismatches) ? s.reconcile.mismatches : [];
  const okWord = s.reconcile ? s.reconcile.ok : null;
  const checked = !(s.reconcile && s.reconcile.ok === null) && ((s.turns ?? 0) > 0 || stillWorking);
  if (!mism.length && okWord === false) {
    const bad = el(doc, 'span', 'rs-bad', '⚠ not reconciled');
    bad.title = 'The host\'s close says the figures did not add up; the failed check was not recorded.';
    rec.appendChild(bad);
  } else if (!mism.length && checked) {
    if (!engineCost) rec.appendChild(el(doc, 'span', 'rs-na', 'no cost from this engine · tokens only'));
    else if (stillWorking) rec.appendChild(el(doc, 'span', 'rs-na', 'reconciles after each turn'));
    else if (okWord === true) {
      const ok = el(doc, 'span', 'rs-ok', '✓ reconciled');   // glyph-ok: the check's status word; Task 58 pins this text
      ok.title = 'The steps and the hand-offs add up to the harness total.';
      rec.appendChild(ok);
    }
  }
  for (const m of mism) {
    const [a, b] = usdPair(m.harnessUsd, m.otherUsd);
    rec.appendChild(el(doc, 'span', 'rs-bad', m.method === 'epoch' ? `⚠ host epoch: harness ${a} vs booked ${b}` : `⚠ ${m.turnId}: harness ${a} vs ${m.method} ${b}`));
  }
  if (mism.length) rec.title = 'The harness figure is the one booked; a mismatch never changes a booking.';
  card.appendChild(rec);
  const g = s.integrity || {};
  const skipped = (g.torn || 0) + (g.invalid || 0);
  if (g.unreadable) card.appendChild(el(doc, 'p', 'rs-integrity', 'This session\'s trace could not be read.'));
  else if (skipped || g.seqGaps) {
    const parts = [skipped ? `${plural(skipped, 'line')} could not be read and ${skipped === 1 ? 'is' : 'are'} not shown` : '', g.seqGaps ? `its numbering has ${plural(g.seqGaps, 'gap')}` : ''];
    card.appendChild(el(doc, 'p', 'rs-integrity', `In this session's trace, ${parts.filter(Boolean).join('; ')}.`));
  }

  // History: rotations, restarts, resumes, pauses and a degrade (not the one the why line above already says: a session
  // separate from the start; nor, for a session that never had a host, the resume or restart every restore writes for
  // it; the CLI drops them too).
  const repeats = (h) => s.mode === 'separate' && !(s.turns > 0) && h.kind === 'degrade' && (h.reason ?? null) === (s.modeReason ?? null);
  const never = s.mode === 'separate' && s.hostSessionId == null && !(s.turns > 0);
  const hist = (Array.isArray(s.history) ? s.history : []).filter((h) => !repeats(h) && !(never && (h.kind === 'resume' || h.kind === 'restart')));
  if (hist.length) {
    const ul = el(doc, 'ul', 'rs-history');
    for (const h of hist) {
      const when = hhmm(h.ts);
      ul.appendChild(el(doc, 'li', null, `${when ? `${when} · ` : ''}${historyWords(h)}`));
    }
    card.appendChild(ul);
  }
  return card;
}

/** The steps that started their own harness session (05 §6, the mock's dashed card): one row per execution outside a
 *  host turn (a composite's slices as one row), with the reason. `rows` are the run's ledger rows. A session member's
 *  row carries its `sid` and `label`: its cost is in that session's card. */
export function outsideRows(state, report) {
  const st = state || {};
  const stepper = st.stepper || null;
  const nodes = new Map((stepper && stepper.graph && Array.isArray(stepper.graph.nodes) ? stepper.graph.nodes : []).map((n) => [n.id, n]));
  const sidOf = new Map();
  for (const spec of manifestSessions(stepper)) for (const id of spec.members) sidOf.set(id, spec);
  const bySid = new Map(((report && report.sessions) || []).map((x) => [x.sid, x]));
  const out = [];
  const parents = new Map();
  for (const r of Array.isArray(st.steps) ? st.steps : []) {
    if (!r || !r.executionId || BOOKEND_EXECUTION_IDS.includes(r.executionId)) continue;
    const node = nodes.get(r.nodeId);
    if (!node || !KEYED_KINDS.includes(node.kind) || node.kind === 'script') continue;   // flow cards and scripts start no harness
    if (r.session && r.session.sid) continue;                                            // it ran inside a host turn
    const spec = sidOf.get(r.nodeId) || null;
    const live = spec && st.sessionHosts && typeof st.sessionHosts === 'object' ? st.sessionHosts[spec.sid] : null;
    const summary = live || (spec ? bySid.get(spec.sid) : null);                         // the live summary first: fresh every frame
    // A hosted member's execution binds to its host before it spends anything: one with no stamp is waiting for its host,
    // or never started (queued when the run stopped).
    if (spec && summary && summary.mode !== 'separate' && r.kind !== 'task') continue;
    // A member outside its host: a composite's slices never go through one (D2); else its session ran separate.
    const why = !spec ? null : r.kind === 'task' ? 'tasks run on their own in v1'
      : (summary && summary.mode === 'separate' && summary.modeReason && sessionReasonText(summary.modeReason)) || 'its session ran as separate sessions';
    // Unknown stays unknown (a dash): a running step has no cost yet and its time is booked when it ends.
    const usd = finite(r.costUsd) ? r.costUsd : null;
    const ms = r.status === 'start' || r.status === 'running' ? null : (Number(r.activeMs) || 0);
    if (r.kind === 'task' && r.parentExecutionId) {
      const p = parents.get(r.parentExecutionId);
      if (p) { p.sessions += 1; p.ms = addKnown(p.ms, ms); p.usd = addKnown(p.usd, usd); continue; }
      const row = { nodeId: r.nodeId, executionId: r.parentExecutionId, run: `cycle ${r.ordinal ?? 1} · tasks`, sessions: 1, ms, usd, why, ...inSession(spec, summary) };
      parents.set(r.parentExecutionId, row);
      out.push(row);
      continue;
    }
    out.push({ nodeId: r.nodeId, executionId: r.executionId, run: `cycle ${r.ordinal ?? r.cycle ?? 1}`, sessions: 1, ms, usd, why, ...inSession(spec, summary) });
  }
  return out;
}

const addKnown = (a, b) => (a == null ? b : b == null ? a : a + b);
const inSession = (spec, summary) => (spec ? { sid: spec.sid, label: (summary && summary.label) || spec.settings.label || 'One session' } : {});

export function renderOutsideCard(rows, { doc, labelOf = (id) => id, engineCost = true } = {}) {
  const card = el(doc, 'article', 'rs-card rs-out');
  const head = el(doc, 'div', 'rs-head');
  const title = el(doc, 'div', 'rs-title');
  title.appendChild(el(doc, 'b', null, 'Outside sessions'));
  const meta = el(doc, 'div', 'rs-meta');
  // A session member's run (separate, degraded, ×N slices) is listed with its reason, but its cost is in its session's
  // card (the tray's figure): this card's total is only what no card above counts, so the totals on the page add up.
  const own = rows.filter((r) => !r.sid);
  const members = own.length < rows.length;
  meta.appendChild(el(doc, 'span', null, `Steps that started their own harness session${rows.some((r) => r.why) ? ', with the reason' : ''}.${members ? ' A session\'s steps count in its card\'s total.' : ''}`));
  const total = el(doc, 'div', 'rs-total');
  total.append(el(doc, 'span', 'rs-total-v', usdOr(own.length ? own.reduce((a, r) => addKnown(a, r.usd), null) : 0, engineCost)), el(doc, 'span', 'rs-total-s', plural(rows.reduce((a, r) => a + r.sessions, 0), 'session')));
  head.append(title, meta, total);
  card.appendChild(head);
  const wrap = el(doc, 'div', 'table-wrap');
  const table = el(doc, 'table', 'table rs-outside');
  const COLS = ['Step', 'Run', 'Sessions', 'Time', 'Cost', 'Why outside'];
  const NUM = new Set(['Sessions', 'Time', 'Cost']);
  const tr = el(doc, 'tr');
  for (const c of COLS) tr.appendChild(el(doc, 'th', NUM.has(c) ? 'num' : null, c));
  const thead = el(doc, 'thead');
  thead.appendChild(tr);
  const tbody = el(doc, 'tbody');
  for (const r of rows) {
    const row = el(doc, 'tr');
    [labelOf(r.nodeId) || r.nodeId, r.run, String(r.sessions), r.ms == null ? '—' : fmtDur(r.ms), usdOr(r.usd, engineCost), r.why || 'not in a session'].forEach((v, i) => {
      const td = el(doc, 'td', NUM.has(COLS[i]) ? 'num' : i === 0 ? 'table-main' : null, v);
      td.dataset.label = COLS[i];
      row.appendChild(td);
    });
    if (r.sid && engineCost && finite(r.usd)) row.children[4].title = `Counted in the total of ${r.label}`;
    tbody.appendChild(row);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  card.appendChild(wrap);
  return card;
}

/** A session's member rows (the run's ledger rows of its members), and its cost as its tray says it (run-decor.mjs
 *  `decorateSessions`, correction 43): Σ its members' ledger rows, each to the cent as its card shows it, null while no
 *  row has a figure (the card then shows the trace's own sum). */
function memberRows(state, session) {
  const steps = state && Array.isArray(state.steps) ? state.steps : [];
  const spec = manifestSessions(state && state.stepper).find((x) => x.sid === session.sid);
  const mine = new Set(spec ? spec.members : (Array.isArray(session.members) ? session.members : []));
  return steps.filter((r) => r && mine.has(r.nodeId) && finite(r.costUsd));
}
export function membersUsdOf(state, session) {
  const priced = memberRows(state, session);
  return priced.length ? round2(priced.reduce((a, r) => a + round2(r.costUsd), 0)) : null;
}
/** The part of a session's cost its trace never saw (its members' runs outside a host turn): Σ the members' rows as
 *  booked (never the per-card cents, whose rounding is no spend) minus the trace's sum. Live, the run's summary is the
 *  newest trace sum, and a turn being booked (its rows first, its trace records after) shows none. null without a figure. */
function outsideUsdOf(state, session, live) {
  const priced = memberRows(state, session);
  if (!priced.length) return null;
  const now = live && state && state.sessionHosts && typeof state.sessionHosts === 'object' ? state.sessionHosts[session.sid] : null;
  if (now && now.status === 'busy') return null;
  const traceUsd = now && finite(now.costUsd) ? now.costUsd : session.costUsd;
  return round2(priced.reduce((a, r) => a + r.costUsd, 0) - (finite(traceUsd) ? traceUsd : 0));
}

/** Fill the tab: a card per session, then the steps outside them. `opts`: { labelOf, engine, state, live, logLevel,
 *  trays } (`trays`: run-decor.mjs `decor.sessions`, the run page's own; derived from `state` when absent). */
export function paintSessions(sec, report, { labelOf = (id) => id, engine = null, state = null, live = false, logLevel = 'advanced', trays = null } = {}) {
  const doc = sec.ownerDocument;
  const sessions = report && Array.isArray(report.sessions) ? report.sessions : [];
  const engineCost = engineReportsCost(engine || (sessions[0] && sessions[0].engine) || null);
  const runStatus = state && typeof state.status === 'string' ? state.status : null;
  const trayOf = trays || (state && manifestSessions(state.stepper).length ? decorFromState(state, { live, now: Date.now() }).sessions : {});
  const list = el(doc, 'div', 'rs-list');
  for (const s of sessions) {
    list.appendChild(renderSessionCard(s, { doc, labelOf, engineCost, runStatus, live, logLevel, runEngine: engine, membersUsd: membersUsdOf(state, s),
      outsideUsd: outsideUsdOf(state, s, live), tray: trayOf[s.sid] || null }));
  }
  if (!sessions.length) list.appendChild(el(doc, 'p', 'empty-line', live ? 'No session has started in this run yet.' : 'No session of this run left a trace.'));
  const outside = state ? outsideRows(state, report) : [];
  if (outside.length) list.appendChild(renderOutsideCard(outside, { doc, labelOf, engineCost }));
  sec.replaceChildren(list);
}

/** What of the run the cards read besides the report: a new state frame with the same rows (and the same tray states,
 *  the live summaries' status and sum) repaints nothing. */
const stateSig = (st, trays) => (st ? [st.status, ...(Array.isArray(st.steps) ? st.steps : []).map((r) => (r ? `${r.executionId}|${r.status}|${r.session ? r.session.sid : ''}|${r.queued ? 1 : 0}|${r.activeMs || 0}|${r.costUsd || 0}` : '')),
  ...Object.entries(trays || {}).map(([sid, t]) => `${sid}:${t && t.status}`),
  ...Object.entries(st.sessionHosts && typeof st.sessionHosts === 'object' ? st.sessionHosts : {}).map(([sid, h]) => `${sid}=${h && h.status}|${h && h.costUsd}`)].join('\n') : '');

/**
 * The tab's paint: the cached report at once, then a fetch when none was made, or (live) when a trace record was written
 * since the last one (`seq`, the run's count of `sessionHost` frames; without it, any frame) and that one is older than
 * LIVE_TTL_MS, with one trailing fetch LIVE_TTL_MS after a skipped live call that had news (the records of a turn's end
 * arrive in a burst). A failed fetch is not cached: the next paint asks again. `runId` is the pipeline id (GET
 * /api/runs/:id/sessions keys on it). Resolves to the report (or null). The Running page calls this on every frame (token
 * frames included): the DOM is rebuilt only when the report's CONTENT or what the cards read of the run changed (every
 * fetch parses a new object), so a click or a focus survives.
 */
export function paintSessionsTab(sec, opts = {}) {
  const { runId, state = null, live = false, labelOf, engine = null, logLevel = 'advanced', seq, trays = null, fetchImpl = globalThis.fetch } = opts;
  if (!sec || !runId) return Promise.resolve(null);
  sec.__rsOpts = opts;                                         // the trailing look paints with the newest call's options
  const c = cache.get(runId) || { at: 0, data: null, inflight: null, live: false, failed: false };
  cache.delete(runId);   // re-insert: Map order is the use order
  cache.set(runId, c);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  const sig = `${live}|${stateSig(state, trays)}`;
  const paint = (data) => {
    if (!data) {
      if (c.failed && !c.data) sec.replaceChildren(el(sec.ownerDocument, 'p', 'empty-line', 'The sessions could not be loaded. Open the tab again to retry.'));
      return;
    }
    if (sec.__rsData === data && sec.__rsSig === sig) return;
    sec.__rsData = data;
    sec.__rsSig = sig;
    paintSessions(sec, data, { labelOf, engine, state, live, logLevel, trays });
  };
  if (c.data) paint(c.data);
  else if (!sec.firstChild) sec.appendChild(el(sec.ownerDocument, 'p', 'empty-line', 'Loading the sessions…'));
  const fetchOnce = () => {
    const asked = seq;
    return Promise.resolve()
      .then(() => fetchImpl(`/api/runs/${encodeURIComponent(runId)}/sessions`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        c.failed = !data;
        if (data) {
          c.seq = asked;
          const text = JSON.stringify(data);
          if (text !== c.text) { c.data = data; c.text = text; }   // the same report keeps its object: nothing repaints
        }
        return c.data;
      })
      .catch(() => { c.failed = true; return c.data; })
      .finally(() => { c.at = Date.now(); c.live = live; });
  };
  const news = seq === undefined || seq !== c.seq;             // a failed fetch leaves c.seq: it is asked again
  const stale = !c.at || (live ? news && Date.now() - c.at > LIVE_TTL_MS : (c.live || c.failed));
  const trailing = () => {                                      // one more look after the burst a call skipped
    if (sec.__rsTrailing) return;
    sec.__rsTrailing = setTimeout(() => {
      sec.__rsTrailing = null;
      if (sec.isConnected && !sec.hidden) paintSessionsTab(sec, sec.__rsOpts);   // a tab not shown asks on its next frame
    }, Math.max(0, LIVE_TTL_MS - (Date.now() - c.at)) + 1);
    sec.__rsTrailing.unref?.();
  };
  if (!stale) {
    if (live && news) trailing();
    return Promise.resolve(c.data);
  }
  const settle = (p) => { c.inflight = p; p.finally(() => { if (c.inflight === p) c.inflight = null; }); };
  if (!c.inflight) {
    c.inflightLive = live;
    settle(fetchOnce());
  } else if (c.inflightLive && !live) {
    // The run ended while a live fetch was out: it may hold the report from before the close, so ask once more after it.
    c.inflightLive = false;
    settle(c.inflight.then(() => fetchOnce()));
  } else if (live && seq !== undefined) {
    // A trace record written while a fetch was out: that fetch may predate it (the turn's end comes as a burst of records,
    // and a run waiting for a person sends no next frame), so look once more after it.
    c.inflight.then(() => { if (seq !== c.seq) trailing(); });
  }
  return c.inflight.then((data) => { paint(data); return data; });
}

/** @internal tests */
export function _resetSessionsCache() { cache.clear(); }
