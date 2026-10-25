// ui/public/run-telemetry-view.mjs — Run telemetry (Labs flag, docs/run-telemetry.md) on the run
// page's Agents tab: one line of figures and a context-over-time chart per agent card, and one
// line of Worca's own save / live-update figures above the cards. Data: GET /api/runs/:id/telemetry
// (summarised server-side). The Running detail repaints its cards on every live frame, so the data
// is cached per run and refetched at most every LIVE_TTL_MS; paint fills the slots it finds.
import { flagOn, chip } from './flags.mjs';
import { ctxLevel, ctxTrigger, fmtWindow, kTok } from './ask-meter.mjs';

const LIVE_TTL_MS = 5000;
const MISSING_TTL_MS = 30_000;   // a live run that recorded nothing (flag off when it started): ask rarely
const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 320, H = 48, PAD = 2;

const cache = new Map();   // runId -> { at (last settled fetch), data, inflight }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function telemetryOn(doc) { return flagOn('runTelemetry', doc); }

/** "1.2s", "4m 12s", "1h 3m"; '' for nothing. */
export function fmtMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1000) return `${Math.round(n)}ms`;
  const s = n / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtBytes(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The figures of one step, as display strings (pure; tested). */
export function stepFigures(st) {
  if (!st) return [];
  const out = [];
  const win = fmtWindow(st.window);
  if (st.peak != null) {
    const pct = st.window ? ` (${Math.round((st.peak / st.window) * 100)}%)` : '';
    out.push({ text: `context peak ${kTok(st.peak)}${win ? ` / ${win}` : ''}${pct}`, level: ctxLevel(st.peak, st.window),
      title: `Largest prompt one call sent. Final call: ${kTok(st.final ?? 0)}.${st.windowFrom === 'default' ? ' Window assumed (the model lists none).' : ''}` });
  } else if (st.sessionInput != null) {
    out.push({ text: `session input ${kTok(st.sessionInput)}`,
      title: 'This engine reports usage only at the end of a session: the input of every call added up, not a context size.' });
  }
  if (st.perCall) out.push({ text: plural(st.calls, 'call') });
  if (st.sessions > 1) out.push({ text: plural(st.sessions, 'session'), title: 'Retries, resumes and question rounds each run a session.' });
  const time = [st.startupMs ? `start ${fmtMs(st.startupMs)}` : '', st.modelMs ? `model ${fmtMs(st.modelMs)}` : '', st.toolMs ? `tools ${fmtMs(st.toolMs)}` : ''].filter(Boolean);
  if (time.length) out.push({ text: time.join(' · '), title: 'Start: until the agent\'s first event. Model: waiting for each call (approximate). Tools: tool run times added up; tools that ran in parallel each count, so the parts can add up to more than the step took.' });
  if (st.cacheShare != null) out.push({ text: `cache ${Math.round(st.cacheShare * 100)}%`, title: 'Share of all prompt tokens read from the prompt cache.' });
  if (st.toolErrors) out.push({ text: plural(st.toolErrors, 'tool error') });
  if (st.retries) out.push({ text: plural(st.retries, 'retry', 'retries'), level: 'warn' });
  if (st.compactions?.length) out.push({ text: plural(st.compactions.length, 'compaction'), level: 'warn', title: 'The context was summarised and started again.' });
  if (st.subCalls) out.push({ text: `sub-agents ${plural(st.subCalls, 'call')}${st.subPeak ? ` · peak ${kTok(st.subPeak)}` : ''}` });
  return out;
}

/** Harness figures for the line above the cards (pure; tested). */
export function harnessFigures(h) {
  if (!h || !h.windows) return [];
  const out = [];
  if (h.persists) out.push(`${plural(h.persists, 'save')} · avg ${fmtMs(h.persistAvgMs) || '0ms'} · max ${fmtMs(h.persistMaxMs) || '0ms'} · ${Math.round(h.rowsPerPersist || 0)} rows each`);
  if (h.emits) out.push(`${plural(h.emits, 'live update')} · avg ${fmtBytes(h.emitAvgBytes)} · max ${fmtBytes(h.emitMaxBytes)}`);
  if (h.lagMaxMs != null) out.push(`event loop delay p99 ≤ ${fmtMs(h.lagP99MaxMs) || '0ms'} · max ${fmtMs(h.lagMaxMs) || '0ms'}`);
  return out;
}

function el(doc, tag, attrs = {}, ns = null) {
  const n = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** The context-over-time chart: the series, the window (dashed), where compaction starts (dotted). */
export function contextChart(doc, st) {
  const pts = Array.isArray(st?.series) ? st.series : [];
  if (!st?.perCall || pts.length < 2) return null;     // end-of-session sums are no context over time
  const xMax = Math.max(1, pts[pts.length - 1][0]);
  const trigger = ctxTrigger(st.window);
  const yMax = Math.max(st.window || 0, ...pts.map((p) => p[1])) || 1;
  const x = (v) => PAD + (v / xMax) * (W - 2 * PAD);
  const y = (v) => H - PAD - (v / yMax) * (H - 2 * PAD);
  const svg = el(doc, 'svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'tel-chart', role: 'img',
    'aria-label': `Context over time: peak ${kTok(st.peak ?? 0)}${st.window ? ` of ${fmtWindow(st.window)}` : ''}` }, SVG_NS);
  const line = (y0, cls) => svg.appendChild(el(doc, 'line', { x1: PAD, x2: W - PAD, y1: y0, y2: y0, class: cls }, SVG_NS));
  if (st.window) line(y(st.window), 'tel-win');
  if (trigger && trigger !== st.window) line(y(trigger), 'tel-trig');
  for (const c of st.compactions || []) {
    if (c.sub) continue;
    const cx = x(Math.min(xMax, Math.max(0, c.at)));
    svg.appendChild(el(doc, 'line', { x1: cx, x2: cx, y1: PAD, y2: H - PAD, class: 'tel-compact' }, SVG_NS));
  }
  let d = '';
  pts.forEach((p, i) => { d += `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`; });
  svg.appendChild(el(doc, 'path', { d, class: 'tel-line' }, SVG_NS));
  return svg;
}

/** The empty slot a card carries; `paintTelemetry` fills it. '' while the flag is off. */
export function telemetrySlotHtml(stepKey, doc) {
  if (!telemetryOn(doc) || !stepKey) return '';
  return `<div class="ag-tel" data-flag="runTelemetry" data-tel-step="${esc(stepKey)}" hidden></div>`;
}

function fillSlot(slot, st) {
  const doc = slot.ownerDocument;
  slot.textContent = '';
  if (!st) { slot.hidden = true; return; }
  slot.hidden = false;
  const line = doc.createElement('div');
  line.className = 'tel-figs';
  for (const f of stepFigures(st)) {
    const s = doc.createElement('span');
    s.className = `tel-fig mono${f.level === 'warn' || f.level === 'high' ? ` is-${f.level}` : ''}`;
    s.textContent = f.text;
    if (f.title) s.title = f.title;
    line.appendChild(s);
  }
  slot.appendChild(line);
  const chart = contextChart(doc, st);
  if (chart) slot.appendChild(chart);
}

function fill(sec, data) {
  if (!sec.isConnected) return;
  for (const slot of sec.querySelectorAll('[data-tel-step]')) fillSlot(slot, data?.steps?.[slot.getAttribute('data-tel-step')] || null);
  let head = sec.querySelector(':scope > .tel-harness');
  const figs = harnessFigures(data?.harness);
  if (!figs.length) { if (head) head.remove(); return; }
  if (!head) {
    const doc = sec.ownerDocument;
    head = doc.createElement('div');
    head.className = 'tel-harness hint';
    head.dataset.flag = 'runTelemetry';
    const tx = doc.createElement('span');
    tx.className = 'tel-harness-tx mono';
    head.appendChild(tx);
    chip(head, doc);
    const c = head.querySelector('.flag-chip');
    if (c) head.prepend(c);                 // the chip leads, so a long line wraps under it, not around it
    sec.insertBefore(head, sec.firstChild);
  }
  head.querySelector('.tel-harness-tx').textContent = `Worca: ${figs.join(' — ')}`;
}

/**
 * Fill every telemetry slot in `sec` from the cache, then refetch when the copy is stale.
 * @param {Element} sec  @param {string} runId  @param {{live?:boolean, fetchImpl?:typeof fetch}} [o]
 */
export function paintTelemetry(sec, runId, { live = false, fetchImpl = globalThis.fetch } = {}) {
  if (!sec || !runId || !telemetryOn(sec.ownerDocument)) return Promise.resolve(null);
  const c = cache.get(runId) || { at: 0, data: null, inflight: null, live: false };
  cache.set(runId, c);
  if (c.data) fill(sec, c.data);
  // Never fetched; live and older than its TTL; or a finished run's first paint after a live copy (the
  // last lines and the end record came later). A 404 or a failed fetch counts as fetched.
  const ttl = c.data ? LIVE_TTL_MS : MISSING_TTL_MS;
  const stale = !c.at || (live ? Date.now() - c.at > ttl : c.live);
  if (!stale) return Promise.resolve(c.data);
  if (!c.inflight) {
    c.inflight = Promise.resolve()
      .then(() => fetchImpl(`/api/runs/${encodeURIComponent(runId)}/telemetry`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) c.data = data; return c.data; })
      .catch(() => c.data)
      .finally(() => { c.at = Date.now(); c.live = live; c.inflight = null; });
  }
  return c.inflight.then((data) => { if (data) fill(sec, data); return data; });
}

/** @internal tests */
export function _resetTelemetryCache() { cache.clear(); }
