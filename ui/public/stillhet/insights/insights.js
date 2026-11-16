// Insights on Rail (Wave 3): one feature; its bar holds its sub-features, grouped. Every page says the answer in a sentence
// (the PlaceHead), draws one chart (bars unless you ask otherwise, look.chart-play), says what it shows in one sentence of
// pickers, lists breakdown rows that open their tasks and ends with the composer. The numbers come from insights-model.js.
(function () {
  const R = window.RailUI, M = window.RailInsightsModel;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const AS = { bars: 'bars', lines: 'lines', running: 'running total', table: 'table' };
  const AGAINST = { none: 'no comparison', before: 'the period before', budget: 'the budget' };
  const HINT = 'Drag across to narrow';
  const TEAM_EMPTY = 'No project shares its team numbers yet';   // D3: turning sharing on stays in the project's settings
  const ALIAS = { saved: 'time-saved', outcomes: 'ends', time: 'merge' };   // old links to what the page used to be called
  const views = [{ id: 'v1', name: 'By client, then workflow', sub: 'spend', st: { by: 'client', then: 'workflow' } }, { id: 'v2', name: 'Monthly for finance', sub: 'spend', st: { by: 'costcenter', when: 'last month', as: 'table' } }];
  const states = {};
  const unchecked = new Set();   // live: a state from a link or a saved view, checked once against the data it reads (ledger row 3)
  let arg = 'spend', menu = '', bar = null, page = null, seq = 3, back = '', applied = '', retry = null, taskId = '', focusRow = '';   // taskId: a teammate's task, read only (#1310 D2)
  // the live kind (slice 10 D9): every read goes through RailInsightsLive (live/insights-live.mjs); the demo's seed otherwise
  const isLive = () => window.RailAdapter?.kind === 'live';
  const LIVE = () => (isLive() ? window.RailInsightsLive || null : null);
  const viewList = () => (isLive() ? LIVE()?.views() || [] : views);   // D18: live, the views this browser keeps
  // D11, D12: live, a page is in the bar, search and has only while dev has its figure (no budget, no tag key: not yet)
  const offered = (s) => !isLive() || LIVE()?.offered(s.id) === true;
  const pathOf = (a) => String(a || '').split('?')[0];
  const DRAGGED = 'worca-rail.insights-dragged';
  let dragged = false;   // the hint is quiet once you have narrowed a chart
  try { dragged = localStorage.getItem(DRAGGED) === '1'; } catch { /* remembering is a nicety */ }
  const team = () => R.shows('expert');
  const subOf = (a) => { const v = viewList().find((x) => x.id === a), s = M.SUB[v ? v.sub : a]; return s && (!s.team || team()) ? s : M.SUB.spend; };
  const key = () => (viewList().some((v) => v.id === arg) || (M.SUB[arg] && subOf(arg).id === arg) ? arg : 'spend');
  function stateOf(k = key()) {
    if (!states[k]) { const v = viewList().find((x) => x.id === k); states[k] = { ...M.defaults(subOf(k)), ...(v ? v.st : {}), filter: [...(v?.st?.filter || [])] }; if (v && isLive()) unchecked.add(k); }
    return states[k];
  }
  const NEEDS_YOU = R.runState('question').word, barGroup = (s) => (s.count ? NEEDS_YOU : s.group);   // what has a count needs you, first in the bar (list.bar-model)
  // ---- the bar: the SideMenu, a distinct icon for each question, no money in it ----
  function barHtml() {
    const k = key(), item = (id, label, icon, count) => ({ label, icon, count, current: id === k, attrs: { 'data-in-go': id } });
    const groups = [NEEDS_YOU, 'Cost', 'Value', 'Quality', 'Flow', 'Team'].flatMap((g) => { const items = M.SUBS.filter((s) => barGroup(s) === g && (!s.team || team()) && offered(s)).map((s) => item(s.id, s.title, s.icon, s.count)); return items.length ? [{ title: g, items }] : []; });
    const mine = viewList();
    return R.sideMenu({ label: 'Insights', groups: [...groups, ...(mine.length ? [{ title: 'Your views', items: mine.map((v) => item(v.id, v.name, 'sliders')) }] : [])] });
  }
  // ---- the sentence ----
  const simple = () => !R.shows('advanced');   // workspaces start at Advanced
  const dimsNow = (sub, st) => M.dimsOf(sub.src, st).filter((d) => d !== 'workspace' || !simple());
  const pick = (dims) => M.DIM_GROUPS.flatMap(([h, l]) => { const on = l.filter(([d]) => dims.includes(d)); return on.length ? [{ header: h }, ...on.map(([id, text]) => ({ id, text }))] : []; });
  // the team scopes (list.sentence-scope): a single choice that replaces the read, offered with 2 or more
  const scopesOf = (sub) => (sub.team && (sub.src.scopes || []).length > 1 ? sub.src.scopes : []);
  const scopeNow = (sub, st) => scopesOf(sub).find((x) => x.id === st.scope) || scopesOf(sub)[0];
  function filterItems(sub, st) {
    // people only when there are 2 or more (list.sentence-person); live, Chat, Requirements and Design narrow nothing
    const can = (d) => sub.src.rows[d] && (d !== 'workspace' || !simple()) && (d !== 'person' || sub.src.rows[d].length > 1) && !(sub.src.live && d === 'origin');
    const items = M.FILTERS.filter(can).flatMap((d) => [{ header: M.DIM[d] }, ...sub.src.rows[d].filter((r) => !r.other).map((r) => ({ id: `${d}:${r.name}`, text: r.name, checked: st.filter.includes(`${d}:${r.name}`) }))]);
    const scopes = scopesOf(sub), on = scopeNow(sub, st);
    return [...(scopes.length ? [{ header: 'team' }, ...scopes.map((x) => ({ id: `scope:${x.id}`, text: x.name, checked: x === on }))] : []), { id: 'all', text: 'everything', checked: !st.filter.length }, ...items];
  }
  const filterWord = (st, sub) => (st.filter.length ? R.namesWord(st.filter.map((k) => k.slice(k.indexOf(':') + 1))) : sub && scopesOf(sub).length ? `the ${scopeNow(sub, st).name} team` : 'everything');
  // live: the whole period's days (the from and to pickers), and where the read's from and to fall in them
  const wholeOf = (sub, st) => (sub.src.live ? sub.src.whole || { labels: sub.src.labels, days: sub.src.days, last: sub.src.last } : null);
  const atDay = (w, iso, end) => { if (!iso || !w.days.length) return end ? w.days.length - 1 : 0; const i = end ? w.days.map((d) => d <= iso).lastIndexOf(true) : w.last.findIndex((d) => d >= iso); return i < 0 ? (end ? 0 : w.days.length - 1) : i; };
  function againsts(sub, st, c) { return ['none', ...(c.P ? ['before'] : []), ...(sub.budget && st.when === 'this month' ? ['budget'] : [])]; }
  function sentence(sub, st, c) {
    const dims = dimsNow(sub, st);
    const part = (word, id, text, items, extra = {}) => ({ word, id, text, items, ...extra });
    const w = wholeOf(sub, st), days = w ? w.labels : M.compute(sub, { ...st, narrow: null }).labels, [fromAt, toAt] = w ? [atDay(w, st.from, false), atDay(w, st.to, true)] : st.narrow || [0, days.length - 1], dayItems = (cur, ok) => days.map((d, i) => ({ id: String(i), text: d, checked: i === cur })).filter((_, i) => ok(i));
    const check = (list, cur) => list.map((v) => ({ id: v, text: v, checked: v === cur }));
    const start = [
      part('Showing', 'in-what', sub.noun, M.SUBS.filter((s) => s.group === sub.group && (!s.team || team())).map((s) => ({ id: s.id, text: s.noun, checked: s.id === sub.id })), { tip: 'What it shows' }),
      part('by', 'in-by', M.DIM[st.by], [...pick(dims).map((it) => (it.header ? it : { ...it, checked: it.id === st.by })), ...(dims.some((d) => d !== st.by && !M.TIME.has(d)) ? [{ sep: true }, { id: '+then', text: st.then ? `Then by ${M.DIM[st.then]}` : 'Then by' }] : [])], { tip: 'What it is broken down by' }),
      ...(st.then ? [part('then', 'in-then', M.DIM[st.then], [...pick(dims.filter((d) => d !== st.by)).map((it) => (it.header ? it : { ...it, checked: it.id === st.then })), { sep: true }, { id: 'none', text: 'No second level' }], { tip: 'The level under it' })] : []),
      part('', 'in-when', st.custom ? 'custom' : c.timeWord, [...check(M.WHEN, st.narrow || st.from ? '' : st.when), { id: 'custom', text: 'custom', checked: !!st.custom }], { tip: 'When' }),
      ...(st.custom ? [part('from', 'in-from', days[fromAt], dayItems(fromAt, (i) => i <= toAt), { tip: 'The first day' }), part('to', 'in-to', days[toAt], dayItems(toAt, (i) => i >= fromAt), { tip: 'The last day' })] : []),
    ];
    const clear = st.narrow || (sub.src.live && st.from && !st.custom) ? R.button({ label: 'Back to the whole period', iconOnly: true, kind: 'quiet', icon: R.icon('x', 11), cls: 'ch-clear', attrs: { 'data-in-clear': '' } }) : '';
    const rest = [
      part('of', 'in-of', filterWord(st, sub), filterItems(sub, st), { tip: 'Which of it' }),
      ...(sub.forms.length < 2 ? [] : [part('as', 'in-as', AS[st.as], sub.forms.filter((f) => f !== 'lines' || !noLines(sub, st)).map((f) => ({ id: f, text: AS[f], checked: f === st.as })), { tip: 'How it is drawn' }),
      part(st.against === 'none' ? 'with' : 'against', 'in-vs', AGAINST[st.against], againsts(sub, st, c).map((v) => ({ id: v, text: AGAINST[v], checked: v === st.against })), { tip: 'What it is set against' })]),
    ];
    const open = { open: menu, chevron: R.icon('chevron', 10) };
    const words = (l, cls = '') => R.listSentence({ parts: l, ...open, menuCls: cls });
    return `<div class="list-sentence">${words(start.slice(0, 1))} ${words(start.slice(1, 2), ' is-two-cols')} ${st.then ? words([start[2]], ' is-two-cols') : ''} ${words(start.filter((p) => ['in-when', 'in-from', 'in-to'].includes(p.id)))}${clear} ${words(rest.slice(0, 1), ' is-two-cols')} ${words(rest.slice(1))}</div>`;
  }
  // ---- the chart ----
  // what the chart shows when the rows are by something else, and a budget's pace while it is the whole month (look.chart-play)
  const paceOf = (sub, st) => (sub.budget && st.against !== 'budget' && st.when === 'this month' && !st.narrow && !st.from && !st.filter.length ? sub.budget / 30 : 0);
  // the chart follows "by" (look.chart-play): over time, by day; by week or month, a bar for each; by something else, each period cut by it,
  // or, a rate that cannot be cut, a bar for each row. Set against something, it is the whole over time, and its caption says so
  const compared = (st) => st.against !== 'none';
  const axisIsRows = (sub, st) => !compared(st) && st.by !== 'day' && (M.TIME.has(st.by) || !!sub.den);
  const noLines = (sub, st) => !compared(st) && !!sub.den && !M.TIME.has(st.by);   // a line across projects would join what has no order
  const stacks = (sub, st, c) => !compared(st) && !M.TIME.has(st.by) && !sub.den && c.rows.length > 1 && !!c.dayCut;   // live: dev's facts cut by "by" (F-G-fid-14); a source with no cut draws whole bars and says so
  const byWord = (st) => (st.by === 'why' ? 'reason' : M.DIM[st.by].replace(/ \(.*/, ''));
  // each period cut by the top rows of "by": a period's parts add up to the period, a row's parts over the periods to the row
  // F-FM2-04 (look.chart-play): a name keeps its shade on the page however the view changes; a new name takes a free one
  const shades = new Map();
  function shaded(parts) {
    const used = new Set();
    for (const p of parts) { const k = shades.get(p.label); if (k != null && !used.has(k)) { p.shade = k; used.add(k); } }
    for (const p of parts) if (p.shade == null) { let k = 0; while (used.has(k)) k++; p.shade = k; used.add(k); shades.set(p.label, k); }
    return parts;
  }
  function partsOf(sub, c) {
    const keep = c.rows.length > 4 ? 3 : 4, top = c.rows.slice(0, keep), rest = c.rows.slice(keep), weights = [...top, ...(rest.length ? [{ name: 'Other', [sub.num]: M.sum(rest.map((r) => r[sub.num])) }] : [])];
    const named = top.map((r) => c.dayCut.names.indexOf(r.name));   // the model's cut: the same whatever the drag; what is not on top is Other
    const perDay = c.dayCut.perDay.map((d) => [...named.map((k) => d[k]), ...(rest.length ? [M.sum(d.filter((_, k) => !named.includes(k)))] : [])]);
    return weights.map((r, k) => ({ label: r.name, values: perDay.map((d) => d[k]), texts: perDay.map((d) => sub.text(d[k])) }));
  }
  function captionOf(sub, st, c) {
    const per = ['last month', 'this quarter'].includes(st.when) ? 'week' : ['all time', 'this year'].includes(st.when) ? 'month' : 'day', pace = paceOf(sub, st);
    if (sub.caption) return sub.caption;
    if (axisIsRows(sub, st)) return [`By ${byWord(st)}`, sub.note].filter(Boolean).join('. ');
    if (compared(st) && st.by !== 'day') return `All of it per ${per}, against ${AGAINST[st.against]}; by ${byWord(st)} in the rows below`;
    if (sub.note) return `Per ${per}, all together. ${sub.note}`;
    const allows = pace && st.as !== 'bars' && st.as !== 'lines' ? `, the budget allows ${M.usd(pace)}` : '';   // drawn, the line names it
    if (M.TIME.has(st.by)) return pace ? `You average ${M.usd(c.v / c.days)} a day${allows}` : '';
    const by = stacks(sub, st, c) ? `, by ${byWord(st)}` : c.rows.length > 1 && !c.dayCut ? `, all together; by ${byWord(st)} in the rows below` : '';   // look.chart-play: parts not known
    return `Per ${per}${by}${pace ? ` · you average ${M.usd(c.v / c.days)}${allows}` : ''}`;
  }
  // Who spends where (look.heat-grid): people by the top values of "by", in ink shades; its cells open nothing
  function heatHtml(sub, st, c) {
    const g = sub.src.heat?.[st.by];
    if (!g) return '';
    const tasks = (n) => `${n} ${n === 1 ? 'task' : 'tasks'}`;
    return R.heatGrid({ label: `${sub.title} by ${M.DIM[st.by]}, ${c.timeWord}`, rows: g.rows, columns: g.columns, max: g.max, off: "The whole team's numbers: Tasks lists your own",
      cells: g.cells.map((row) => row.map((x) => ({ value: x.value, text: x.value ? `${M.usd(x.value)}, ${tasks(x.runs)}` : '' }))) });
  }
  function chartHtml(sub, st, c) {
    if (sub.src.heat) return heatHtml(sub, st, c);
    const rowAxis = axisIsRows(sub, st), rate = (r) => (sub.den ? (r[sub.den] ? r[sub.num] / r[sub.den] : null) : r[sub.num]);
    const axis = rowAxis ? c.rows.map((r) => r.name) : c.labels, values = rowAxis ? c.rows.map(rate) : c.points, tasksAt = rowAxis ? c.rows.map((r) => r.tasks) : c.F.tasks, before = st.against === 'before' && !rowAxis ? c.before : null;
    const label = `${sub.title} by ${rowAxis ? M.DIM[st.by] : 'day'}, ${c.timeWord}`, hint = !rowAxis && axis.length > 2 && !dragged ? HINT : '', cur = !rowAxis && !sub.den && c.whole && st.when === 'this month' ? axis.length - 1 : -1;   // a day's rate is not a day in progress: no darker bar
    const caption = captionOf(sub, st, c), parts = stacks(sub, st, c) ? shaded(partsOf(sub, c)) : null;
    const taskField = sub.src.fields.includes('tasks') ? 'tasks' : '';
    const taskWords = (i) => (taskField ? `${tasksAt[i]} ${tasksAt[i] === 1 ? 'task' : 'tasks'}` : ''), reasonOf = () => (sub.team ? "The whole team's numbers: Tasks lists your own" : `Tasks narrow by project, time or status, not by ${byWord(st)}`);
    const pointAt = (v, i) => { const off = targetOf(sub, st, c, i) ? '' : sub.closed || reasonOf(); return { value: v ?? 0, text: v == null ? 'none' : sub.text(v), diff: before ? R.diffWords(v, before[i], sub.text) : '', off, note: off ? [taskWords(i), off].filter(Boolean).join(' · ') : rowAxis && M.TIME.has(st.by) ? taskWords(i) : taskField ? `${taskWords(i)}, opens them` : 'Opens its tasks' }; };
    const bars = axis.map((l, i) => ({ label: l, ...pointAt(values[i], i) }));
    if (st.as === 'table') {
      if (!parts && !before) return '';   // the rows below are this table: one table, not the same figures twice
      const when = { id: 'day', label: rowAxis ? `${M.DIM[st.by][0].toUpperCase()}${M.DIM[st.by].slice(1)}` : 'When' }, cell = (i) => (values[i] == null ? 'none' : sub.text(values[i]));
      const columns = parts ? [when, ...parts.map((p, k) => ({ id: `p${k}`, label: p.label, num: true })), { id: 'v', label: 'All', num: true }] : [when, { id: 'v', label: sub.noun, num: true }, ...(before ? [{ id: 'b', label: 'The period before', num: true }, { id: 'd', label: 'Difference', num: true }] : [])];
      return `<div class="in-table">${R.table({ label, columns, rows: axis.map((l, i) => ({ day: l, v: cell(i), ...(parts ? Object.fromEntries(parts.map((p, k) => [`p${k}`, p.texts[i]])) : { b: before?.[i] == null ? '' : sub.text(before[i]), d: bars[i].diff }) })) })}</div>`;
    }
    const pace = rowAxis ? 0 : paceOf(sub, st), paceLine = pace ? { value: pace, text: `Budget pace ${M.usd(pace)} a day` } : null;
    if (st.as === 'running' || st.as === 'lines') {
      const running = st.as === 'running', acc = (l) => { let t = 0; return l.map((v) => { t += v || 0; return t; }); };
      if (parts) {
        const say = (i) => parts.map((p) => `${p.label} ${sub.text(running ? acc(p.values)[i] : p.values[i])}`).join(' · ');
        const series = parts.map((p, k) => ({ label: p.label, part: p.shade ?? k, points: axis.map((_, i) => { const v = running ? acc(p.values)[i] : p.values[i]; return { ...(k ? {} : pointAt(values[i], i)), value: v, text: k ? sub.text(v) : (running ? sub.text(acc(values)[i]) : sub.text(values[i])), diff: '', note: k ? '' : `${say(i)} · ${pointAt(values[i], i).note}` }; }) }));
        return R.lineChart({ label, labels: axis, series, limit: st.as === 'lines' ? paceLine : null, current: cur, hint, caption });
      }
      const now = running ? acc(values) : values, was = before ? (running ? acc(before) : before) : null;
      const labels = running && st.against === 'budget' && c.whole && !c.live ? Array.from({ length: 30 }, (_, i) => `Nov ${i + 1}`) : axis;
      const main = labels.map((_, i) => (i < now.length && now[i] != null ? { ...pointAt(values[i], i), value: now[i], text: sub.text(now[i]), diff: running ? '' : pointAt(values[i], i).diff } : null));
      const series = [{ label: running ? 'Running total' : sub.title, points: main }];
      if (was) series.push({ label: 'The period before', dashed: true, points: labels.map((_, i) => (i < was.length && was[i] != null ? { value: was[i], text: sub.text(was[i]) } : null)) });
      let limit = st.as === 'lines' ? paceLine : null;
      if (st.against === 'budget') {
        limit = { value: sub.budget, text: `Budget ${M.usd(sub.budget)}` };
        if (c.whole && !c.live) { const lastAt = now.length - 1, pace = Math.round((now[lastAt] / now.length) * 30); series.push({ label: `On pace for ${M.usd(pace)}`, dashed: true, points: labels.map((_, i) => (i < lastAt ? null : { value: now[lastAt] + ((pace - now[lastAt]) * (i - lastAt)) / (29 - lastAt), text: sub.text(now[lastAt] + ((pace - now[lastAt]) * (i - lastAt)) / (29 - lastAt)) })) }); }
      }
      return R.lineChart({ label, labels, series, limit, current: cur, hint, caption });
    }
    return R.barChart({ label, bars, current: cur, play: true, hint, caption, limit: paceLine, parts });
  }
  // ---- the rows ----
  // what Tasks can narrow to from a row or a bar (RailRunsList.filter): a project, a stretch of time, how they ended; null when it cannot
  const SHOW_OF = { Finished: 'finished' };
  const isDates = (label) => /^(Jul|Aug|Sep|Oct|Nov)( \d+(-\d+)?)?$/.test(label);
  const rangeOf = M.rangeOf;
  // this chart's stretch, when it is not the plain month: a drag, or another period, travels with the click
  const md = (iso) => +iso.slice(5, 7) * 100 + +iso.slice(8, 10);   // RailRunsList.filter's range: month and day
  const within = (c) => {
    if (c.live) return c.st.from || !['this month', 'all time'].includes(c.st.when) ? (c.src.days.length ? { range: { from: md(c.src.days[0]), to: md(c.src.last[c.src.last.length - 1]), label: c.timeWord } } : {}) : {};
    const range = M.rangeIn(c.labels, c.st); return range ? { range } : {};
  };
  function tasksOf(c, st, name, parent = '') {
    if (c.sub.team) return null;   // the whole team's numbers: Tasks lists your own
    const ofs = st.filter.filter((k) => k.startsWith('project:')), project = ofs.length === 1 ? ofs[0].slice(8) : undefined, one = project ? { project } : {};
    if (st.by === 'project' && name !== 'Other') return { project: parent || name, ...within(c) };
    if (st.then === 'project' && parent && name !== 'Other') return { project: name, ...within(c) };
    if (M.TIME.has(st.by) && isDates(parent || name)) return { range: rangeOf([parent || name]), ...one };
    if (st.by === 'status' && SHOW_OF[parent || name]) return { show: SHOW_OF[parent || name], ...one, ...within(c) };
    if (c.live && st.by === 'person' && !parent) return { person: name, ...within(c) };   // live: the Tasks list narrows by who started it
    return null;
  }
  const targetOf = (sub, st, c, i) => (axisIsRows(sub, st) ? tasksOf(c, st, c.rows[i].name) : tasksOf(c, { ...st, by: 'day', then: '' }, c.labels[i]));   // what a bar opens: null when it opens nothing
  const cellsOf = (sub, c, r) => [...(sub.noShare ? [] : [r.share ?? `${r.sharePct}%`]), ...sub.cols.map(([, get]) => get(r, c))];   // live: dev's formatShare
  const columns = (sub) => [...(sub.noShare ? [] : [{ label: sub.shareLabel || 'Share' }]), ...sub.cols.map(([label], i) => ({ label, narrow: i < (sub.noShare ? 2 : 1) }))];
  // #1310: on By person a person's row opens their work in place (list.row-opens-in-place), one at a time
  const personRows = (c) => c.sub.id === 'team' && c.st.by === 'person' && !!window.RailInsightsWork;
  const isPerson = (c, r, parent) => personRows(c) && !parent && !r.other && !r.kind && r.name !== 'Other' && !/^No /.test(r.name);
  function rowsHtml(sub, c) {
    const opens = (r, i) => { const open = c.st.open === r.name; return { id: `in-work-${i}`, open, label: `${r.name}'s work`, ...(open ? window.RailInsightsWork.detail(c, r.name, c.st, c.st.shown || window.RailInsightsWork.FIRST) : {}) }; };
    const rowOf = (r, parent, s, i) => {
      if (isPerson(c, r, parent)) return { name: r.name, cells: cellsOf(sub, c, r), sub: s, opens: opens(r, i), attrs: { 'data-in-person': r.name, title: `Shows ${r.name}'s work` } };
      const f = r.other || r.kind ? null : tasksOf(c, c.st, r.name, parent); return { name: r.name, cells: cellsOf(sub, c, r), sub: s, quiet: /^No /.test(r.name) || r.name === 'Other' || !!r.other || !!r.kind, attrs: f ? { 'data-in-row': JSON.stringify(f), title: `Opens Tasks, narrowed to ${parent ? `${parent}, ` : ''}${r.name}` } : { disabled: true, title: c.sub.team ? "The whole team's numbers: Tasks lists your own" : sub.closed || `Tasks narrow by project, time or status, not by ${byWord(c.st)}` } };
    };
    return R.figureRows({ label: `By ${M.DIM[c.st.by]}`, columns: columns(sub), rows: c.rows.flatMap((r, i) => [rowOf(r, '', false, i), ...(r.kids || []).map((k) => rowOf(k, r.name, true, i))]) });
  }
  function actions(sub, st, c) {
    const tag = sub.id === 'untagged' || (M.SUB[sub.id]?.src === M.SUB.spend.src && st.by === 'client');   // the money pages, demo or live
    const noClient = sub.id === 'untagged' ? c.T.tasks : c.rows.find((r) => r.name === 'No client' || (c.live && r.kind === 'none'))?.tasks;   // live: dev's Unallocated row
    return `<div class="in-acts">${tag && noClient ? `${R.button({ label: `Tag these ${noClient} tasks`, attrs: { 'data-in-tag': noClient } })}${R.button({ label: 'Set a default for a project', kind: 'quiet', attrs: { 'data-in-default': '' } })}` : ''}${R.button({ label: 'Download CSV', kind: 'quiet', attrs: { 'data-in-csv': '' } })}${R.button({ label: 'Save this view', kind: 'quiet', attrs: { 'data-in-save': '' } })}</div>`;
  }
  function pageHtml(sub, st, c) {
    const plain = st.when === 'this month' && !st.narrow && !st.from && !st.filter.length;
    const scope = st.narrow || st.from ? (c.days === 1 ? 'on this day' : `in these ${c.days} days`) : st.when === 'all time' ? 'in all' : st.when;
    const word = sub.wordAlways ? sub.wordAlways(c) : plain ? sub.word(c) : `${sub.text(c.v)} ${scope}`;
    const why = sub.whyAlways ? sub.whyAlways(c) : st.against === 'before' ? M.cmp(c, sub) : plain ? sub.why(c) : '';   // no comparison asked for: none in the headline; sub.why never compares
    const pace = sub.pace && plain;   // over budget at this pace: Advisory, in ink (look.alert-ladder); live: the words of D10 (no budget, or under it: no pace)
    const head = R.placeHead({ center: arg === 'spend' ? null : { label: 'Insights', to: 'insights' }, title: viewList().find((v) => v.id === arg)?.name || sub.title, mark: pace ? R.kindMark({ kind: 'figure', tone: 'ok', icon: sub.icon, title: sub.pace }) : R.kindMark({ kind: 'plugin', icon: sub.icon }), tone: pace ? 'ok' : '', word: pace ? sub.pace : word, why: pace ? [word, ...why.split(' · ').filter((x) => !/on pace for/i.test(x))].join(' · ') : why, menu: R.moreMenu({ id: 'in-more', label: `More for ${sub.title}`, icon: R.icon('more', 16), open: menu === 'in-more', items: [{ id: 'link', text: 'Copy a link', help: 'To this page, as you narrowed it' }] }) });
    const stands = sub.id === 'why' ? `<p class="in-stands">A small change to try: <b>web-app</b> ${esc(M.STANDS.why.outcome)}</p><p class="in-stands">${esc(M.STANDS.why.because)}</p><div class="in-acts">${R.button({ label: 'Try Opus 5.5 on web-app', attrs: { 'data-in-try': '' } })}</div><p class="wf-ed-m">Try starts a new chat for you to send; nothing changes until you do. You can switch back to Sonnet 5.5 at any time.</p>` : sub.id === 'review' ? `<p class="in-stands">What stands out: <b>web-app</b> ${esc(M.STANDS.review)}</p><div class="in-acts">${R.button({ label: 'Ask why web-app goes back', attrs: { 'data-in-ask': '' } })}</div>` : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${sentence(sub, st, c)}${chartHtml(sub, st, c)}${st.as === 'table' && (stacks(sub, st, c) || (st.against === 'before' && !axisIsRows(sub, st))) ? '' : rowsHtml(sub, c)}${stands}${actions(sub, st, c)}</div></div><div class="convo-dock" id="in-dock"></div></div>`;
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'insights';   // the page area is shared by every place: draw only while this one is open
  // the live kind's list states (D8): loading, failed with Try again, and the team pages' empty state
  function listStateHtml(sub, r) {
    const state = r.state === 'loading' ? 'loading' : r.state === 'failed' ? 'failed' : 'empty';
    return `<div class="rail-locked">${R.placeHead({ center: { label: 'Insights', to: 'insights' }, title: sub.title })}${R.listState({ state, noun: sub.noun, title: r.state === 'failed' ? `Could not load ${sub.title}: ${r.text}` : '', text: r.text || '', retry: r.state === 'failed' ? { 'data-in-retry': '' } : null })}</div>`;
  }
  // live: the page's live sub (the design's SUB with dev's figures); a state its source lacks falls back to the defaults
  function liveSub(sub, st) {
    if (!LIVE()) return { state: 'loading' };
    let r = LIVE().page(sub.id, st);
    if (r.state !== 'ready') return r;
    const dims = dimsNow(r.sub, st);
    if (!dims.includes(st.by)) { st.by = M.defaults(r.sub).by; r = LIVE().page(sub.id, st); }
    if (st.then && !dimsNow(r.sub, st).includes(st.then)) { st.then = ''; r = LIVE().page(sub.id, st); }
    if (unchecked.has(key()) && st.filter.length) {   // an of= the live data lacks (a link, a saved view): opened without it, said once
      const all = LIVE().page(sub.id, { ...st, filter: [] });
      if (all.state !== 'ready') return r;
      const has = (k) => { const at = k.indexOf(':'); return (all.sub.src.rows[k.slice(0, at)] || []).some((x) => !x.other && x.name === k.slice(at + 1)); };
      const gone = st.filter.filter((k) => !has(k));
      if (gone.length) { st.filter = st.filter.filter(has); r = LIVE().page(sub.id, st); say(`Opened without ${R.namesWord(gone.map((k) => k.slice(k.indexOf(':') + 1)))}: not in this data`); }
    }
    unchecked.delete(key());
    return r;
  }
  function draw() {
    if (!bar || !page || !here()) return;
    let sub = subOf(arg);
    const st = stateOf();
    retry = null;
    if (isLive()) {
      const r = liveSub(sub, st);
      if (r.state !== 'ready') { retry = r.retry || null; bar.innerHTML = barHtml(); page.innerHTML = listStateHtml(sub, r); return; }
      sub = r.sub;
    } else {   // the demo kind opens the same list states from the address (?state=loading, failed; empty on a team page)
      const ls = window.RailDemoState?.list;
      if (ls === 'loading' || ls === 'failed' || (ls === 'empty' && sub.team)) { bar.innerHTML = barHtml(); page.innerHTML = listStateHtml(sub, { state: ls, text: ls === 'empty' ? TEAM_EMPTY : ls === 'failed' ? 'Worca is not answering' : '' }); return; }
    }
    if (simple()) { if (st.by === 'workspace') st.by = 'project'; if (st.then === 'workspace') st.then = ''; st.filter = st.filter.filter((k) => !k.startsWith('workspace:')); }
    if (st.as === 'lines' && noLines(sub, st)) st.as = 'bars';
    if (st.by !== 'person') st.open = null;   // I6: the open row closes when "by" leaves person
    const c = M.compute(sub, st);
    if (taskId && sub.id === 'team' && window.RailInsightsWork) { bar.innerHTML = barHtml(); page.innerHTML = window.RailInsightsWork.task(c, taskId, st, st.open || ''); page.querySelector('[data-in-back]')?.focus({ preventScroll: true }); return; }
    const had = keyOf(document.activeElement);
    const scroll = page.querySelector('.convo-scroll')?.scrollTop || 0, draft = page.querySelector('#in-dock [data-composer-t]')?.value || '';
    bar.innerHTML = barHtml();
    page.innerHTML = pageHtml(sub, st, c);
    window.RailConversation?.dock(document.getElementById('in-dock'), { kind: 'question', title: sub.title, chat: '' });
    const scroller = page.querySelector('.convo-scroll'); if (scroller) scroller.scrollTop = scroll;
    const box = page.querySelector('#in-dock [data-composer-t]'); if (box && draft) box.value = draft;
    R.watchChart(page.querySelector('[data-chart]'), {
      open: (i) => { const f = targetOf(sub, st, c, i); if (f) window.RailRunsList.filter(f); },
      narrow: axisIsRows(sub, st) ? undefined : (a, b) => { if (c.live) { st.from = c.src.days[a]; st.to = c.src.last[b]; } else { const base = st.narrow ? st.narrow[0] : 0; st.narrow = [base + a, base + b]; }   /* live: a re-read over the dragged days (D7) */ menu = ''; dragged = true; try { localStorage.setItem(DRAGGED, '1'); } catch { /* remembering is a nicety */ } draw(); },
    });
    if (back) { page.querySelector(`[data-menu="${back}"]`)?.focus({ preventScroll: true }); back = ''; }
    else if (focusRow) { personRow(focusRow)?.focus({ preventScroll: true }); focusRow = ''; }
    else if (had) page.querySelector(had)?.focus({ preventScroll: true });   // a live answer redrew the open row: focus stays where it was
  }
  // what to focus again after a redraw: a control of the open row, by its own hook
  const q = (v) => String(v).replace(/["\\]/g, '\\$&');   // a value inside an attribute selector
  const HOOKS = ['data-in-person', 'data-in-work', 'data-in-work-url', 'data-fr-hide', 'data-in-more', 'data-in-work-retry'];
  function keyOf(el) {
    if (!el || !page || !page.contains(el)) return '';
    if (el.matches('.tt-end')) { const row = el.closest('.tt-row'); return row ? `[data-tt-row="${q(row.dataset.ttRow)}"] .tt-end` : ''; }
    const h = HOOKS.find((k) => el.hasAttribute(k));
    return h ? `[${h}="${q(el.getAttribute(h))}"]` : '';
  }
  const personRow = (name) => page.querySelector(`[data-in-person="${q(name)}"]`);
  function closeWork(st) { const name = st.open; st.open = null; st.shown = 0; focusRow = name || ''; draw(); }
  function choose(id, v) {
    const sub = subOf(arg), st = stateOf();
    if (id === 'in-what') { menu = ''; if (v !== sub.id) window.RailShell.go(`insights/${v}`); else draw(); return; }
    if (id === 'in-by') {
      if (v === '+then') { st.then = st.then || dimsNow(sub, st).find((d) => d !== st.by && !M.TIME.has(d)) || ''; menu = 'in-then'; draw(); return; }
      st.by = v; if (st.then === v) st.then = '';
    }
    if (id === 'in-then') st.then = v === 'none' ? '' : v;
    if (id === 'in-when') {
      st.narrow = null; st.custom = v === 'custom'; st.from = st.to = null;
      const live = isLive() ? liveSub(sub, st) : null, w = live?.sub ? wholeOf(live.sub, st) : null;
      if (st.custom && w) { st.when = 'this month'; st.from = w.days[0] || null; st.to = w.last[w.last.length - 1] || null; if (!st.from) st.custom = false; }   // live: a re-read over the days (D7)
      else if (st.custom) { st.when = 'this month'; st.narrow = [0, M.compute(sub, st).labels.length - 1]; } else st.when = v;
      if (st.against === 'budget' && st.when !== 'this month') st.against = 'none';
      if (st.against === 'before' && st.when === 'all time') { st.against = 'none'; }
      if (!dimsNow(sub, st).includes(st.by)) st.by = 'day';   // weeks and months of this month do not exist in another period
    }
    const w = isLive() ? wholeOf(liveSub(sub, st).sub || sub, st) : null;
    if (id === 'in-from') { if (w) st.from = w.days[+v]; else st.narrow = [+v, st.narrow[1]]; }
    if (id === 'in-to') { if (w) st.to = w.last[+v]; else st.narrow = [st.narrow[0], +v]; }
    if (id === 'in-of' && v.startsWith('scope:')) { st.scope = v.slice(6); st.filter = []; back = id; menu = ''; draw(); return; }   // one team at a time: a new read
    if (id === 'in-of') {
      if (v === 'all') st.filter = [];
      else st.filter = st.filter.includes(v) ? st.filter.filter((k) => k !== v) : [...st.filter, v];
      draw(); return;   /* tick several: the menu stays open */
    }
    if (id === 'in-as') { st.as = v; if (v === 'bars') st.against = 'none'; if (v === 'lines' && st.against === 'budget') st.against = 'none'; }
    if (id === 'in-vs') { st.against = v; if (v === 'budget') st.as = 'running'; else if (v === 'before' && st.as !== 'running' && st.as !== 'table') st.as = 'lines'; else if (v === 'none' && st.as === 'running' && !sub.forms.includes('running')) st.as = 'bars'; }
    back = id; menu = ''; draw();
  }
  function download(text, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
    a.click(); URL.revokeObjectURL(a.href);
  }
  function csv(sub, st) {
    // live (D24): dev's own Cost report CSV over the page's facts; the team pages have no stats answer: the rows as drawn
    const own = isLive() ? LIVE()?.csv(sub.id, st, { byLabel: M.DIM[st.by], thenByLabel: st.then ? M.DIM[st.then] : '' }) : null;
    if (own) { const count = own.split(/\r?\n/).filter(Boolean).length - 1; download(own, `insights-${sub.id}.csv`); say(`Downloaded ${sub.title}, ${count} ${count === 1 ? 'row' : 'rows'}`); return; }
    const c = M.compute(sub, st, true), q = (t) => `"${String(t).replace(/"/g, '""')}"`, head = [M.DIM[st.by], ...(st.then ? [M.DIM[st.then]] : []), ...(sub.noShare ? [] : ['Share']), ...sub.cols.map(([l]) => l)];
    const rows = c.rows.flatMap((r) => (r.kids ? r.kids.map((k) => [r.name, k.name, ...cellsOf(sub, c, k)]) : [[r.name, ...cellsOf(sub, c, r)]]));
    // live, the rows as drawn go through dev's CSV writer (its formula guard: teammates' names cross into this file)
    const text = isLive() && LIVE()?.rowsCsv ? LIVE().rowsCsv(head, rows) : [head, ...rows].map((l) => l.map(q).join(',')).join('\n');
    download(text, `insights-${sub.id}.csv`);
    say(`Downloaded ${sub.title}, ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`);
  }
  function save(sub, st) {
    const dflt = M.defaults(sub), c = M.compute(sub, st), name = [`${sub.title} by ${M.DIM[st.by]}${st.then ? `, then ${M.DIM[st.then]}` : ''}, ${c.timeWord}`, st.filter.length ? `of ${filterWord(st, sub)}` : '', st.as !== dflt.as ? `as ${AS[st.as]}` : '', st.against !== dflt.against ? `against ${AGAINST[st.against]}` : ''].filter(Boolean).join(', ');   // the whole state, so two different views never share a name
    if (viewList().some((v) => v.name === name)) { say(`${name} is already in Your views`); return; }
    const copy = { ...st, filter: [...st.filter], narrow: st.narrow ? [...st.narrow] : null };
    if (isLive()) {   // D18: this browser keeps it
      const id = `v${Date.now().toString(36)}`, got = LIVE()?.saveView({ id, name, sub: sub.id, st: copy });
      if (!got?.ok) { say(got?.text || `Could not save ${name}: your browser did not keep it`); return; }
      bar.innerHTML = barHtml();
      say(`Saved ${name} to Your views`, () => { LIVE()?.dropView(id); if (here()) bar.innerHTML = barHtml(); });
      return;
    }
    const id = `v${seq++}`;
    views.push({ id, name, sub: sub.id, st: copy }); bar.innerHTML = barHtml();
    say(`Saved ${name} to Your views`, () => { views.splice(views.findIndex((v) => v.id === id), 1); if (here()) bar.innerHTML = barHtml(); });
  }
  // Copy a link (act.copy-link): the page as you narrowed it, only what differs from its defaults; no request is sent
  function copyLink(sub, st) {
    const text = `${location.origin}${location.pathname}#${M.linkOf(sub.id, st)}`, no = () => say('Could not copy the link: your browser did not allow it');
    try { Promise.resolve(navigator.clipboard.writeText(text)).then(() => say(`Copied a link to ${sub.title}`), no); } catch { no(); }
  }
  // Set a default for a project: the project with the most tasks without a client, in what the open page shows. Live it
  // reads nothing: Missing cost tags has its own project rows; Spend by client peeks at the answer it already drew
  function topUntagged(shown, st) {
    const top = (rows) => [...(rows || [])].filter((k) => !k.kind && !k.other).sort((a, b) => b.tasks - a.tasks)[0]?.name || '';
    if (!isLive()) return top(M.SUB.untagged.src.rows.project);
    if (!shown.src?.live) return '';
    if (shown.id === 'untagged') return top(shown.src.rows.project);
    const src = LIVE()?.peek(shown.id, { ...st, by: 'client', then: 'project' });
    const none = src?.rows.client?.find((x) => x.kind === 'none');
    return none ? top(src.kids[none.name]) : '';
  }
  function wire(b, pg) {
    bar = b; page = pg;
    bar.addEventListener('click', (e) => { if (!here()) return; const hit = e.target.closest('[data-in-go]'); if (hit) window.RailShell.go(`insights/${hit.dataset.inGo}`); });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit;
      const sub = subOf(arg), st = stateOf();
      if (on('[data-in-clear]')) { st.narrow = null; st.custom = false; st.from = st.to = null; menu = ''; draw(); return; }
      if (on('[data-in-retry]')) { if (retry) retry(); draw(); return; }
      const shown = isLive() ? liveSub(sub, st).sub || sub : sub;
      if (on('[data-in-csv]')) { csv(shown, st); return; }
      if (on('[data-in-save]')) { save(shown, st); return; }
      if (on('[data-in-try]')) { window.RailConversation?.handOver({ project: 'web-app', about: { kind: 'Project', name: 'web-app' }, ph: "Try Opus 5.5 for web-app's coding step?" }); return; }
      if (on('[data-in-ask]')) { window.RailConversation?.handOver({ project: 'web-app', about: { kind: 'Project', name: 'web-app' }, ph: 'Why does review send web-app back so often?' }); return; }
      if ((hit = on('[data-in-tag]'))) { window.RailConversation?.handOver({ about: { kind: 'Insights', name: [sub.title, st.filter.length ? `of ${filterWord(st, shown)}` : '', M.compute(shown, st).timeWord].filter(Boolean).join(', ') }, ph: `How should the ${hit.dataset.inTag} tasks without a client be tagged?` }); return; }
      if (on('[data-in-default]')) {
        const top = topUntagged(shown, st), p = isLive() ? (window.RailProjects?.all() || []).find((x) => (x.name || x.id) === top) : { id: top };
        if (!top || !p) return;
        window.RailProjects.editTags(p.id); say(`${top} has the most untagged tasks`); return;
      }
      if ((hit = on('[data-in-row]'))) { window.RailRunsList.filter(JSON.parse(hit.dataset.inRow)); return; }
      // #1310: a person's work, in place
      if ((hit = on('[data-in-person]'))) { const name = hit.dataset.inPerson; st.open = st.open === name ? null : name; st.shown = 0; focusRow = name; draw(); return; }
      if (on('[data-fr-hide]')) { closeWork(st); return; }
      if (on('[data-in-more]')) { st.shown = Infinity; draw(); page.querySelectorAll('.fr-detail .tt-open')[window.RailInsightsWork.FIRST]?.focus({ preventScroll: true }); return; }
      if (on('[data-in-work-retry]')) { LIVE()?.retryWork(); draw(); return; }
      if (on('[data-in-back]')) { focusRow = st.open || ''; window.RailShell.go('insights/team'); return; }
      if ((hit = on('[data-in-work]'))) { const own = hit.dataset.inOwn; window.RailShell.go(own ? `run/${own}` : `insights/team?task=${encodeURIComponent(hit.dataset.inWork)}`); return; }   // D3: yours opens your task; a teammate's, read only
      if ((hit = on('[data-in-work-url]'))) { window.open(hit.dataset.inWorkUrl, '_blank', 'noopener'); return; }   // work outside Worca: its pull request
      if ((hit = on('[data-in-pr]'))) { say(`Opens ${hit.dataset.inPr} at its host`); return; }   // D13: the demo's PRs have no host
      if ((hit = on('[data-pick]'))) { const t = hit.dataset.pick, at = t.indexOf('|'); choose(t.slice(0, at), t.slice(at + 1)); return; }
      if ((hit = on('[data-menu-pick]'))) { menu = ''; if (hit.dataset.menuPick === 'in-more|link') copyLink(shown, st); draw(); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    // Esc in the open row: a mark's card first (D8), then the detail itself, focus back on the row (docs/rail/keyboard.md)
    page.addEventListener('keydown', (e) => {
      if (!here() || e.key !== 'Escape' || !e.target.closest('.fr-detail')) return;
      const lane = e.target.closest('.tt-end') && e.target.closest('.tt-lane');
      e.preventDefault(); e.stopPropagation();
      if (lane && !lane.hasAttribute('data-card-off')) { lane.setAttribute('data-card-off', ''); return; }
      closeWork(stateOf());
    });
    const cardBack = (e) => { if (e.target.closest?.('.tt-end')) e.target.closest('.tt-lane')?.removeAttribute('data-card-off'); };   // leaving the mark brings its card back next time
    page.addEventListener('focusout', cardBack); page.addEventListener('mouseout', cardBack);
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop, #route-place .pz-pick', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.insights = {
    sample: 'spend',
    redraw: () => draw(),
    spendOf: (project) => { Object.assign(stateOf('spend'), { filter: [`project:${project}`], narrow: null, when: 'this month', from: null, to: null, custom: false }); window.RailShell.go('insights/spend'); },   // a project's $ this month opens Spend narrowed to it, this month
    search: (q) => [...M.SUBS.filter((s) => (!s.team || team()) && offered(s)).map((s) => ({ label: s.title, where: `Insights · ${barGroup(s)}`, hash: `insights/${s.id}` })), ...viewList().map((v) => ({ label: v.name, where: 'Insights · Your views', hash: `insights/${v.id}` }))].filter((x) => x.label.toLowerCase().includes(q)),
    // a link carries its state after `?` (act.copy-link); live, a page dev has no figure for is not found (D12)
    has: (a0) => {
      const a = ALIAS[pathOf(a0)] || pathOf(a0), s = M.SUB[a];
      if (viewList().some((v) => v.id === a)) return true;
      if (!s) return false;
      if (!isLive()) return true;
      const off = LIVE()?.offered(a);
      return off == null ? true : off;   // not known yet (the live layer, the budget or the tag keys unread): wait
    },
    needs: (a) => { const s = M.SUB[ALIAS[pathOf(a)] || pathOf(a)]; return s?.team && !team() ? { min: 'expert', name: s.title } : null; },   // nav.locked: a Team page's own line, never Spend in its place
    show: ({ bar: b, page: pg, arg: a = '' }) => {
      if (b !== bar) wire(b, pg);
      const at = a.indexOf('?'), next = ALIAS[pathOf(a)] || pathOf(a) || 'spend';
      if (arg !== next) menu = '';
      arg = next;
      const query = at >= 0 ? a.slice(at + 1) : '', task = /(?:^|&)task=([^&]*)/.exec(query);
      try { taskId = task ? decodeURIComponent(task[1]) : ''; } catch { taskId = ''; }
      const onlyTask = task && query.split('&').filter(Boolean).length === 1;   // D2: a task address keeps the page's own state (the open person)
      if (at >= 0 && !onlyTask && a !== applied && M.SUB[next]) { applied = a; states[next] = M.stateOfLink(query, M.SUB[next], { live: isLive() }); if (isLive()) unchecked.add(next); }   // a link's state, once
      draw();
    },
  };
})();
