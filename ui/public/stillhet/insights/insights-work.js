// A person's work on Insights › By person (#1310): the open row's detail (a TimeTrack of their tasks on the page's own
// days) and a teammate's task, read only (TaskView). Live, the data is RailInsightsLive.work and .task (dev's Timeline
// items, live/work-map.mjs); in the demo it is RailInsightsModel.workOf and .workTask. Built only from the library.
(function () {
  const R = window.RailUI, M = window.RailInsightsModel;
  const isLive = () => window.RailAdapter?.kind === 'live';
  const K = () => (isLive() ? window.RailInsightsLive || null : M);   // the words: live/work-map.mjs, or the demo's equal copy
  const FIRST = 6;   // D9: rows shown before Show N more
  const legend = () => R.markLegend({ items: [{ line: 'solid', text: 'Agent working, first run to last' }, { line: 'dashed', text: 'Waiting for review' }, { mark: R.gitMark({ status: 'merged' }), text: 'Merged' }, { mark: R.gitMark({ status: 'open' }), text: 'Open' }, { mark: R.gitMark({ status: 'closed' }), text: 'Closed' }] });
  // D3: yours when this Worca knows one of its runs (live/work-map.mjs isOwn); your newest local run opens
  const ownRun = (it) => (isLive() ? [...it.runs].reverse().find((r) => window.RailWorld?.find?.(r.id))?.id || '' : '');
  function dataOf(c, name, st) {
    if (!isLive()) return { state: 'ready', ...M.workOf(name, c.labels, c.rows.find((r) => r.name === name)?.tasks || 0), pr: { state: 'ready', why: '' } };
    const L = K();
    return L ? L.work(name, st) : { state: 'loading', items: [], counts: {}, axis: null, pr: { state: 'pending', why: '' } };
  }
  function rowOf(it, a) {
    const fx = (t) => (t - a.start) / (a.end - a.start), n = it.prNumber != null ? `#${it.prNumber}` : '';
    const end = it.end ? { status: it.end.status, x: R.trackX(it.end.at, a.start, a.end), url: it.prUrl, label: `${n || 'Pull request'} ${it.end.status}, opens the pull request`, attrs: it.prUrl ? {} : { 'data-in-pr': n || 'the pull request' } } : null;
    const own = ownRun(it);
    const attrs = it.runId ? { 'data-in-work': it.runId, 'data-in-own': own || null, title: own ? 'Opens your task' : 'Opens it, read only' } : { 'data-in-work-url': it.prUrl || null, 'data-in-pr': it.prUrl ? null : n, title: 'Opens the pull request' };
    return { id: it.key, mark: R.kindMark({ kind: 'task', tone: it.tone, size: 18 }), title: it.title, sub: [it.project, n].filter(Boolean).join(' · '), label: `${it.title}, ${it.word}`, attrs,
      bar: R.workBar({ work: it.work.map(fx), wait: it.wait ? it.wait.map(fx) : null, end, card: end ? K().cardOf(it) : null }) };
  }
  /** The open row's head (markup) and body: the head line, then the TimeTrack, the legend and Show N more. */
  function detail(c, name, st, shown = FIRST) {
    const d = dataOf(c, name, st), when = c.timeWord;
    if (d.state !== 'ready') return { head: `<b>${R.esc(`${name}'s work, ${when}`)}</b>`, body: R.listState({ state: 'loading', noun: `${name}'s work` }) };
    const h = K().workHead(name, when, d.counts, d.pr);
    const retry = d.pr.state === 'failed' ? ` ${R.button({ label: 'Try again', kind: 'quiet', attrs: { 'data-in-work-retry': '' } })}` : '';
    const head = `<b>${R.esc(h.title)}</b>${h.line ? ` · ${R.esc(h.line)}` : ''}${retry}`;
    if (!d.items.length || !d.axis) return { head, body: R.emptyState({ title: `No tasks in ${when}` }) };
    const a = d.axis, rows = d.items.slice(0, shown).map((it) => rowOf(it, a));
    return { head, body: R.timeTrack({ label: h.title, ...R.dayTicks(a.start, a.end), rows, legend: legend(), more: d.items.length > shown ? { n: d.items.length - shown, attrs: { 'data-in-more': '' } } : null }) };
  }
  /** A teammate's task (D2, thing.read-only): loading, the view, or gone. */
  function task(c, runId, st, who = '') {
    const r = isLive() ? (K() ? K().task(runId, st) : { state: 'loading' }) : { state: 'ready', item: M.workTask(runId, c.labels, st.by === 'person' ? c.rows : undefined) };
    const wrap = (h) => `<div class="convo"><div class="convo-scroll"><div class="convo-col">${h}</div></div></div>`;
    if (r.state !== 'ready') return wrap(R.listState({ state: 'loading', noun: 'task' }));
    if (!r.item) return wrap(R.emptyState({ title: "This task is no longer in the team's records", actions: R.button({ label: 'Back to By person', kind: 'quiet', attrs: { 'data-in-back': '' } }) }));
    const v = K().taskViewOf(r.item);
    return wrap(R.taskView({ back: { label: `By person › ${who || r.item.actor}`, attrs: { 'data-in-back': '' } }, mark: R.kindMark({ kind: 'task', tone: v.tone }), title: v.title, meta: v.meta, state: v.state, figures: v.figures, pr: v.pr && v.pr.url ? v.pr : null, runs: v.runs }));
  }
  window.RailInsightsWork = { detail, task, FIRST };
})();
