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
  const ALIAS = { saved: 'time-saved', outcomes: 'ends', time: 'merge' };   // old links to what the page used to be called
  const views = [{ id: 'v1', name: 'By client, then workflow', sub: 'spend', st: { by: 'client', then: 'workflow' } }, { id: 'v2', name: 'Monthly for finance', sub: 'spend', st: { by: 'costcenter', when: 'last month', as: 'table' } }];
  const states = {};
  let arg = 'spend', menu = '', bar = null, page = null, seq = 3, back = '';
  const DRAGGED = 'worca-rail.insights-dragged';
  let dragged = false;   // the hint is quiet once you have narrowed a chart
  try { dragged = localStorage.getItem(DRAGGED) === '1'; } catch { /* remembering is a nicety */ }
  const team = () => R.shows('expert');
  const subOf = (a) => { const v = views.find((x) => x.id === a), s = M.SUB[v ? v.sub : a]; return s && (!s.team || team()) ? s : M.SUB.spend; };
  const key = () => (views.some((v) => v.id === arg) || (M.SUB[arg] && subOf(arg).id === arg) ? arg : 'spend');
  function stateOf(k = key()) {
    if (!states[k]) { const v = views.find((x) => x.id === k); states[k] = { ...M.defaults(subOf(k)), ...(v ? v.st : {}) }; }
    return states[k];
  }
  const NEEDS_YOU = R.runState('question').word, barGroup = (s) => (s.count ? NEEDS_YOU : s.group);   // what has a count needs you, first in the bar (list.bar-model)
  // ---- the bar: the SideMenu, a distinct icon for each question, no money in it ----
  function barHtml() {
    const k = key(), item = (id, label, icon, count) => ({ label, icon, count, current: id === k, attrs: { 'data-in-go': id } });
    const groups = [NEEDS_YOU, 'Cost', 'Value', 'Quality', 'Flow', 'Team'].flatMap((g) => { const items = M.SUBS.filter((s) => barGroup(s) === g && (!s.team || team())).map((s) => item(s.id, s.title, s.icon, s.count)); return items.length ? [{ title: g, items }] : []; });
    return R.sideMenu({ label: 'Insights', groups: [...groups, ...(views.length ? [{ title: 'Your views', items: views.map((v) => item(v.id, v.name, 'sliders')) }] : [])] });
  }
  // ---- the sentence ----
  const simple = () => !R.shows('advanced');   // workspaces start at Advanced
  const dimsNow = (sub, st) => M.dimsOf(sub.src, st).filter((d) => d !== 'workspace' || !simple());
  const pick = (dims) => M.DIM_GROUPS.flatMap(([h, l]) => { const on = l.filter(([d]) => dims.includes(d)); return on.length ? [{ header: h }, ...on.map(([id, text]) => ({ id, text }))] : []; });
  function filterItems(sub, st) {
    const items = M.FILTERS.filter((d) => sub.src.rows[d] && (d !== 'workspace' || !simple())).flatMap((d) => [{ header: M.DIM[d] }, ...sub.src.rows[d].map((r) => ({ id: `${d}:${r.name}`, text: r.name, checked: st.filter.includes(`${d}:${r.name}`) }))]);
    return [{ id: 'all', text: 'everything', checked: !st.filter.length }, ...items];
  }
  const filterWord = (st) => (st.filter.length ? R.namesWord(st.filter.map((k) => k.slice(k.indexOf(':') + 1))) : 'everything');
  function againsts(sub, st, c) { return ['none', ...(c.P ? ['before'] : []), ...(sub.budget && st.when === 'this month' ? ['budget'] : [])]; }
  function sentence(sub, st, c) {
    const dims = dimsNow(sub, st);
    const part = (word, id, text, items, extra = {}) => ({ word, id, text, items, ...extra });
    const days = M.compute(sub, { ...st, narrow: null }).labels, [fromAt, toAt] = st.narrow || [0, days.length - 1], dayItems = (cur, ok) => days.map((d, i) => ({ id: String(i), text: d, checked: i === cur })).filter((_, i) => ok(i));
    const check = (list, cur) => list.map((v) => ({ id: v, text: v, checked: v === cur }));
    const start = [
      part('Showing', 'in-what', sub.noun, M.SUBS.filter((s) => s.group === sub.group && (!s.team || team())).map((s) => ({ id: s.id, text: s.noun, checked: s.id === sub.id })), { tip: 'What it shows' }),
      part('by', 'in-by', M.DIM[st.by], [...pick(dims).map((it) => (it.header ? it : { ...it, checked: it.id === st.by })), ...(dims.some((d) => d !== st.by && !M.TIME.has(d)) ? [{ sep: true }, { id: '+then', text: st.then ? `Then by ${M.DIM[st.then]}` : 'Then by' }] : [])], { tip: 'What it is broken down by' }),
      ...(st.then ? [part('then', 'in-then', M.DIM[st.then], [...pick(dims.filter((d) => d !== st.by)).map((it) => (it.header ? it : { ...it, checked: it.id === st.then })), { sep: true }, { id: 'none', text: 'No second level' }], { tip: 'The level under it' })] : []),
      part('', 'in-when', st.custom ? 'custom' : c.timeWord, [...check(M.WHEN, st.narrow ? '' : st.when), { id: 'custom', text: 'custom', checked: !!st.custom }], { tip: 'When' }),
      ...(st.custom ? [part('from', 'in-from', days[fromAt], dayItems(fromAt, (i) => i <= toAt), { tip: 'The first day' }), part('to', 'in-to', days[toAt], dayItems(toAt, (i) => i >= fromAt), { tip: 'The last day' })] : []),
    ];
    const clear = st.narrow ? R.button({ label: 'Back to the whole period', iconOnly: true, kind: 'quiet', icon: R.icon('x', 11), cls: 'ch-clear', attrs: { 'data-in-clear': '' } }) : '';
    const rest = [
      part('of', 'in-of', filterWord(st), filterItems(sub, st), { tip: 'Which of it' }),
      part('as', 'in-as', AS[st.as], sub.forms.filter((f) => f !== 'lines' || !noLines(sub, st)).map((f) => ({ id: f, text: AS[f], checked: f === st.as })), { tip: 'How it is drawn' }),
      part(st.against === 'none' ? 'with' : 'against', 'in-vs', AGAINST[st.against], againsts(sub, st, c).map((v) => ({ id: v, text: AGAINST[v], checked: v === st.against })), { tip: 'What it is set against' }),
    ];
    const open = { open: menu, chevron: R.icon('chevron', 10) };
    const words = (l, cls = '') => R.listSentence({ parts: l, ...open, menuCls: cls });
    return `<div class="list-sentence">${words(start.slice(0, 1))} ${words(start.slice(1, 2), ' is-two-cols')} ${st.then ? words([start[2]], ' is-two-cols') : ''} ${words(start.filter((p) => ['in-when', 'in-from', 'in-to'].includes(p.id)))}${clear} ${words(rest.slice(0, 1), ' is-two-cols')} ${words(rest.slice(1))}</div>`;
  }
  // ---- the chart ----
  // what the chart shows when the rows are by something else, and a budget's pace while it is the whole month (look.chart-play)
  const paceOf = (sub, st) => (sub.budget && st.against !== 'budget' && st.when === 'this month' && !st.narrow && !st.filter.length ? sub.budget / 30 : 0);
  // the chart follows "by" (look.chart-play): over time, by day; by week or month, a bar for each; by something else, each period cut by it,
  // or, a rate that cannot be cut, a bar for each row. Set against something, it is the whole over time, and its caption says so
  const compared = (st) => st.against !== 'none';
  const axisIsRows = (sub, st) => !compared(st) && st.by !== 'day' && (M.TIME.has(st.by) || !!sub.den);
  const noLines = (sub, st) => !compared(st) && !!sub.den && !M.TIME.has(st.by);   // a line across projects would join what has no order
  const stacks = (sub, st, c) => !compared(st) && !M.TIME.has(st.by) && !sub.den && c.rows.length > 1;
  const byWord = (st) => (st.by === 'why' ? 'reason' : M.DIM[st.by].replace(/ \(.*/, ''));
  // each period cut by the top rows of "by": a period's parts add up to the period, a row's parts over the periods to the row
  function partsOf(sub, c) {
    const keep = c.rows.length > 4 ? 3 : 4, top = c.rows.slice(0, keep), rest = c.rows.slice(keep), weights = [...top, ...(rest.length ? [{ name: 'Other', [sub.num]: M.sum(rest.map((r) => r[sub.num])) }] : [])];
    const named = top.map((r) => c.dayCut.names.indexOf(r.name));   // the model's cut: the same whatever the drag; what is not on top is Other
    const perDay = c.dayCut.perDay.map((d) => [...named.map((k) => d[k]), ...(rest.length ? [M.sum(d.filter((_, k) => !named.includes(k)))] : [])]);
    return weights.map((r, k) => ({ label: r.name, values: perDay.map((d) => d[k]), texts: perDay.map((d) => sub.text(d[k])) }));
  }
  function captionOf(sub, st, c) {
    const per = st.when === 'last month' ? 'week' : st.when === 'all time' ? 'month' : 'day', pace = paceOf(sub, st);
    if (axisIsRows(sub, st)) return [`By ${byWord(st)}`, sub.note].filter(Boolean).join('. ');
    if (compared(st) && st.by !== 'day') return `All of it per ${per}, against ${AGAINST[st.against]}; by ${byWord(st)} in the rows below`;
    if (sub.note) return `Per ${per}, all together. ${sub.note}`;
    const allows = pace && st.as !== 'bars' && st.as !== 'lines' ? `, the budget allows ${M.usd(pace)}` : '';   // drawn, the line names it
    if (M.TIME.has(st.by)) return pace ? `You average ${M.usd(c.v / c.days)} a day${allows}` : '';
    const by = stacks(sub, st, c) ? `, by ${byWord(st)}` : '';
    return `Per ${per}${by}${pace ? ` · you average ${M.usd(c.v / c.days)}${allows}` : ''}`;
  }
  function chartHtml(sub, st, c) {
    const rowAxis = axisIsRows(sub, st), rate = (r) => (sub.den ? (r[sub.den] ? r[sub.num] / r[sub.den] : null) : r[sub.num]);
    const axis = rowAxis ? c.rows.map((r) => r.name) : c.labels, values = rowAxis ? c.rows.map(rate) : c.points, tasksAt = rowAxis ? c.rows.map((r) => r.tasks) : c.F.tasks, before = st.against === 'before' && !rowAxis ? c.before : null;
    const label = `${sub.title} by ${rowAxis ? M.DIM[st.by] : 'day'}, ${c.timeWord}`, hint = !rowAxis && axis.length > 2 && !dragged ? HINT : '', cur = !rowAxis && !sub.den && c.whole && st.when === 'this month' ? axis.length - 1 : -1;   // a day's rate is not a day in progress: no darker bar
    const caption = captionOf(sub, st, c), parts = stacks(sub, st, c) ? partsOf(sub, c) : null;
    const taskField = sub.src.fields.includes('tasks') ? 'tasks' : '';
    const taskWords = (i) => (taskField ? `${tasksAt[i]} ${tasksAt[i] === 1 ? 'task' : 'tasks'}` : ''), reasonOf = () => (sub.team ? "The whole team's numbers: Tasks lists your own" : `Tasks narrow by project, time or status, not by ${byWord(st)}`);
    const pointAt = (v, i) => { const off = targetOf(sub, st, c, i) ? '' : reasonOf(); return { value: v ?? 0, text: v == null ? 'none' : sub.text(v), diff: before ? R.diffWords(v, before[i], sub.text) : '', off, note: off ? [taskWords(i), off].filter(Boolean).join(' · ') : rowAxis && M.TIME.has(st.by) ? taskWords(i) : taskField ? `${taskWords(i)}, opens them` : 'Opens its tasks' }; };
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
        const series = parts.map((p, k) => ({ label: p.label, part: k, points: axis.map((_, i) => { const v = running ? acc(p.values)[i] : p.values[i]; return { ...(k ? {} : pointAt(values[i], i)), value: v, text: k ? sub.text(v) : (running ? sub.text(acc(values)[i]) : sub.text(values[i])), diff: '', note: k ? '' : `${say(i)} · ${pointAt(values[i], i).note}` }; }) }));
        return R.lineChart({ label, labels: axis, series, limit: st.as === 'lines' ? paceLine : null, current: cur, hint, caption });
      }
      const now = running ? acc(values) : values, was = before ? (running ? acc(before) : before) : null;
      const labels = running && st.against === 'budget' && c.whole ? Array.from({ length: 30 }, (_, i) => `Nov ${i + 1}`) : axis;
      const main = labels.map((_, i) => (i < now.length && now[i] != null ? { ...pointAt(values[i], i), value: now[i], text: sub.text(now[i]), diff: running ? '' : pointAt(values[i], i).diff } : null));
      const series = [{ label: running ? 'Running total' : sub.title, points: main }];
      if (was) series.push({ label: 'The period before', dashed: true, points: labels.map((_, i) => (i < was.length && was[i] != null ? { value: was[i], text: sub.text(was[i]) } : null)) });
      let limit = st.as === 'lines' ? paceLine : null;
      if (st.against === 'budget') {
        limit = { value: sub.budget, text: `Budget ${M.usd(sub.budget)}` };
        if (c.whole) { const lastAt = now.length - 1, pace = Math.round((now[lastAt] / now.length) * 30); series.push({ label: `On pace for ${M.usd(pace)}`, dashed: true, points: labels.map((_, i) => (i < lastAt ? null : { value: now[lastAt] + ((pace - now[lastAt]) * (i - lastAt)) / (29 - lastAt), text: sub.text(now[lastAt] + ((pace - now[lastAt]) * (i - lastAt)) / (29 - lastAt)) })) }); }
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
  const within = (c) => { const range = M.rangeIn(c.labels, c.st); return range ? { range } : {}; };
  function tasksOf(c, st, name, parent = '') {
    if (c.sub.team) return null;   // the whole team's numbers: Tasks lists your own
    const ofs = st.filter.filter((k) => k.startsWith('project:')), project = ofs.length === 1 ? ofs[0].slice(8) : undefined, one = project ? { project } : {};
    if (st.by === 'project' && name !== 'Other') return { project: parent || name, ...within(c) };
    if (st.then === 'project' && parent && name !== 'Other') return { project: name, ...within(c) };
    if (M.TIME.has(st.by) && isDates(parent || name)) return { range: rangeOf([parent || name]), ...one };
    if (st.by === 'status' && SHOW_OF[parent || name]) return { show: SHOW_OF[parent || name], ...one, ...within(c) };
    return null;
  }
  const targetOf = (sub, st, c, i) => (axisIsRows(sub, st) ? tasksOf(c, st, c.rows[i].name) : tasksOf(c, { ...st, by: 'day', then: '' }, c.labels[i]));   // what a bar opens: null when it opens nothing
  const cellsOf = (sub, c, r) => [...(sub.noShare ? [] : [`${r.sharePct}%`]), ...sub.cols.map(([, get]) => get(r, c))];
  const columns = (sub) => [...(sub.noShare ? [] : [{ label: sub.shareLabel || 'Share' }]), ...sub.cols.map(([label], i) => ({ label, narrow: i < (sub.noShare ? 2 : 1) }))];
  function rowsHtml(sub, c) {
    const rowOf = (r, parent, s) => { const f = tasksOf(c, c.st, r.name, parent); return { name: r.name, cells: cellsOf(sub, c, r), sub: s, quiet: /^No /.test(r.name) || r.name === 'Other', attrs: f ? { 'data-in-row': JSON.stringify(f), title: `Opens Tasks, narrowed to ${parent ? `${parent}, ` : ''}${r.name}` } : { disabled: true, title: c.sub.team ? "The whole team's numbers: Tasks lists your own" : `Tasks narrow by project, time or status, not by ${byWord(c.st)}` } }; };
    return R.figureRows({ label: `By ${M.DIM[c.st.by]}`, columns: columns(sub), rows: c.rows.flatMap((r) => [rowOf(r, '', false), ...(r.kids || []).map((k) => rowOf(k, r.name, true))]) });
  }
  function actions(sub, st, c) {
    const tag = sub.id === 'untagged' || (sub.src === M.SUB.spend.src && st.by === 'client');
    const noClient = sub.id === 'untagged' ? c.T.tasks : c.rows.find((r) => r.name === 'No client')?.tasks;
    return `<div class="in-acts">${tag && noClient ? `${R.button({ label: `Tag these ${noClient} tasks`, attrs: { 'data-in-tag': noClient } })}${R.button({ label: 'Set a default for a project', kind: 'quiet', attrs: { 'data-in-default': '' } })}` : ''}${R.button({ label: 'Download CSV', kind: 'quiet', attrs: { 'data-in-csv': '' } })}${R.button({ label: 'Save this view', kind: 'quiet', attrs: { 'data-in-save': '' } })}</div>`;
  }
  function pageHtml(sub, st, c) {
    const plain = st.when === 'this month' && !st.narrow && !st.filter.length;
    const scope = st.narrow ? (c.days === 1 ? 'on this day' : `in these ${c.days} days`) : st.when === 'all time' ? 'in all' : st.when;
    const word = sub.wordAlways ? sub.wordAlways(c) : plain ? sub.word(c) : `${sub.text(c.v)} ${scope}`;
    const why = sub.whyAlways ? sub.whyAlways(c) : st.against === 'before' ? M.cmp(c, sub) : plain ? sub.why(c) : '';   // no comparison asked for: none in the headline; sub.why never compares
    const pace = sub.pace && plain;   // over budget at this pace: Advisory, in ink (look.alert-ladder)
    const head = R.placeHead({ center: arg === 'spend' ? null : { label: 'Insights', to: 'insights' }, title: views.find((v) => v.id === arg)?.name || sub.title, mark: pace ? R.kindMark({ kind: 'figure', tone: 'ok', icon: sub.icon, title: sub.pace }) : R.kindMark({ kind: 'plugin', icon: sub.icon }), tone: pace ? 'ok' : '', word: pace ? sub.pace : word, why: pace ? [word, ...why.split(' · ').filter((x) => !/on pace for/i.test(x))].join(' · ') : why, menu: R.moreMenu({ id: 'in-more', label: `More for ${sub.title}`, icon: R.icon('more', 16), open: menu === 'in-more', items: [{ id: 'link', text: 'Copy a link', help: 'To this page, as you narrowed it' }] }) });
    const stands = sub.id === 'why' ? `<p class="in-stands">A small change to try: <b>web-app</b> ${esc(M.STANDS.why.outcome)}</p><p class="in-stands">${esc(M.STANDS.why.because)}</p><div class="in-acts">${R.button({ label: 'Try Opus 5.5 on web-app', attrs: { 'data-in-try': '' } })}</div><p class="wf-ed-m">Try starts a new chat for you to send; nothing changes until you do. You can switch back to Sonnet 5.5 at any time.</p>` : sub.id === 'review' ? `<p class="in-stands">What stands out: <b>web-app</b> ${esc(M.STANDS.review)}</p><div class="in-acts">${R.button({ label: 'Ask why web-app goes back', attrs: { 'data-in-ask': '' } })}</div>` : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${sentence(sub, st, c)}${chartHtml(sub, st, c)}${st.as === 'table' && (stacks(sub, st, c) || (st.against === 'before' && !axisIsRows(sub, st))) ? '' : rowsHtml(sub, c)}${stands}${actions(sub, st, c)}</div></div><div class="convo-dock" id="in-dock"></div></div>`;
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'insights';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    const sub = subOf(arg), st = stateOf();
    if (simple()) { if (st.by === 'workspace') st.by = 'project'; if (st.then === 'workspace') st.then = ''; st.filter = st.filter.filter((k) => !k.startsWith('workspace:')); }
    if (st.as === 'lines' && noLines(sub, st)) st.as = 'bars';
    const c = M.compute(sub, st);
    const scroll = page.querySelector('.convo-scroll')?.scrollTop || 0, draft = page.querySelector('#in-dock [data-composer-t]')?.value || '';
    bar.innerHTML = barHtml();
    page.innerHTML = pageHtml(sub, st, c);
    window.RailConversation?.dock(document.getElementById('in-dock'), { kind: 'question', title: sub.title, chat: '' });
    const scroller = page.querySelector('.convo-scroll'); if (scroller) scroller.scrollTop = scroll;
    const box = page.querySelector('#in-dock [data-composer-t]'); if (box && draft) box.value = draft;
    R.watchChart(page.querySelector('[data-chart]'), {
      open: (i) => { const f = targetOf(sub, st, c, i); if (f) window.RailRunsList.filter(f); },
      narrow: axisIsRows(sub, st) ? undefined : (a, b) => { const base = st.narrow ? st.narrow[0] : 0; st.narrow = [base + a, base + b]; menu = ''; dragged = true; try { localStorage.setItem(DRAGGED, '1'); } catch { /* remembering is a nicety */ } draw(); },
    });
    if (back) { page.querySelector(`[data-menu="${back}"]`)?.focus({ preventScroll: true }); back = ''; }
  }
  function choose(id, v) {
    const sub = subOf(arg), st = stateOf();
    if (id === 'in-what') { menu = ''; if (v !== sub.id) window.RailShell.go(`insights/${v}`); else draw(); return; }
    if (id === 'in-by') {
      if (v === '+then') { st.then = st.then || dimsNow(sub, st).find((d) => d !== st.by && !M.TIME.has(d)) || ''; menu = 'in-then'; draw(); return; }
      st.by = v; if (st.then === v) st.then = '';
    }
    if (id === 'in-then') st.then = v === 'none' ? '' : v;
    if (id === 'in-when') {
      st.narrow = null; st.custom = v === 'custom';
      if (st.custom) { st.when = 'this month'; st.narrow = [0, M.compute(sub, st).labels.length - 1]; } else st.when = v;
      if (st.against === 'budget' && st.when !== 'this month') st.against = 'none';
      if (st.against === 'before' && st.when === 'all time') { st.against = 'none'; }
      if (!dimsNow(sub, st).includes(st.by)) st.by = 'day';   // weeks and months of this month do not exist in another period
    }
    if (id === 'in-from') st.narrow = [+v, st.narrow[1]];
    if (id === 'in-to') st.narrow = [st.narrow[0], +v];
    if (id === 'in-of') {
      if (v === 'all') st.filter = [];
      else st.filter = st.filter.includes(v) ? st.filter.filter((k) => k !== v) : [...st.filter, v];
      draw(); return;   /* tick several: the menu stays open */
    }
    if (id === 'in-as') { st.as = v; if (v === 'bars') st.against = 'none'; if (v === 'lines' && st.against === 'budget') st.against = 'none'; }
    if (id === 'in-vs') { st.against = v; if (v === 'budget') st.as = 'running'; else if (v === 'before' && st.as !== 'running' && st.as !== 'table') st.as = 'lines'; else if (v === 'none' && st.as === 'running' && !sub.forms.includes('running')) st.as = 'bars'; }
    back = id; menu = ''; draw();
  }
  function csv(sub, st) {
    const c = M.compute(sub, st, true), q = (t) => `"${String(t).replace(/"/g, '""')}"`, head = [M.DIM[st.by], ...(st.then ? [M.DIM[st.then]] : []), ...(sub.noShare ? [] : ['Share']), ...sub.cols.map(([l]) => l)];
    const lines = [head.map(q).join(',')];
    let count = 0;
    for (const r of c.rows) {
      if (r.kids) for (const k of r.kids) { lines.push([r.name, k.name, ...cellsOf(sub, c, k)].map(q).join(',')); count += 1; }
      else { lines.push([r.name, ...cellsOf(sub, c, r)].map(q).join(',')); count += 1; }
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: `insights-${sub.id}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
    say(`Downloaded ${sub.title}, ${count} ${count === 1 ? 'row' : 'rows'}`);
  }
  function save(sub, st) {
    const dflt = M.defaults(sub), c = M.compute(sub, st), name = [`${sub.title} by ${M.DIM[st.by]}${st.then ? `, then ${M.DIM[st.then]}` : ''}, ${c.timeWord}`, st.filter.length ? `of ${filterWord(st)}` : '', st.as !== dflt.as ? `as ${AS[st.as]}` : '', st.against !== dflt.against ? `against ${AGAINST[st.against]}` : ''].filter(Boolean).join(', ');   // the whole state, so two different views never share a name
    if (views.some((v) => v.name === name)) { say(`${name} is already in Your views`); return; }
    const id = `v${seq++}`, copy = { ...st, filter: [...st.filter], narrow: st.narrow ? [...st.narrow] : null };
    views.push({ id, name, sub: sub.id, st: copy }); bar.innerHTML = barHtml();
    say(`Saved ${name} to Your views`, () => { views.splice(views.findIndex((v) => v.id === id), 1); if (here()) bar.innerHTML = barHtml(); });
  }
  function wire(b, pg) {
    bar = b; page = pg;
    bar.addEventListener('click', (e) => { if (!here()) return; const hit = e.target.closest('[data-in-go]'); if (hit) window.RailShell.go(`insights/${hit.dataset.inGo}`); });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit;
      const sub = subOf(arg), st = stateOf();
      if (on('[data-in-clear]')) { st.narrow = null; st.custom = false; menu = ''; draw(); return; }
      if (on('[data-in-csv]')) { csv(sub, st); return; }
      if (on('[data-in-save]')) { save(sub, st); return; }
      if (on('[data-in-try]')) { window.RailConversation?.handOver({ project: 'web-app', about: { kind: 'Project', name: 'web-app' }, ph: "Try Opus 5.5 for web-app's coding step?" }); return; }
      if (on('[data-in-ask]')) { window.RailConversation?.handOver({ project: 'web-app', about: { kind: 'Project', name: 'web-app' }, ph: 'Why does review send web-app back so often?' }); return; }
      if ((hit = on('[data-in-tag]'))) { window.RailConversation?.handOver({ about: { kind: 'Insights', name: [sub.title, st.filter.length ? `of ${filterWord(st)}` : '', M.compute(sub, st).timeWord].filter(Boolean).join(', ') }, ph: `How should the ${hit.dataset.inTag} tasks without a client be tagged?` }); return; }
      if (on('[data-in-default]')) { const top = [...M.SUB.untagged.src.rows.project].sort((a, b) => b.tasks - a.tasks)[0].name; window.RailProjects.editTags(top); say(`${top} has the most untagged tasks`); return; }
      if ((hit = on('[data-in-row]'))) { window.RailRunsList.filter(JSON.parse(hit.dataset.inRow)); return; }
      if ((hit = on('[data-pick]'))) { const t = hit.dataset.pick, at = t.indexOf('|'); choose(t.slice(0, at), t.slice(at + 1)); return; }
      if ((hit = on('[data-menu-pick]'))) { menu = ''; if (hit.dataset.menuPick.startsWith('in-more|')) say(window.RailWould('copy a link to this page')); draw(); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop, #route-place .pz-pick', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.insights = {
    sample: 'spend',
    spendOf: (project) => { stateOf('spend').filter = [`project:${project}`]; stateOf('spend').narrow = null; window.RailShell.go('insights/spend'); },   // a project's $ opens Spend narrowed to it
    search: (q) => [...M.SUBS.filter((s) => !s.team || team()).map((s) => ({ label: s.title, where: `Insights · ${barGroup(s)}`, hash: `insights/${s.id}` })), ...views.map((v) => ({ label: v.name, where: 'Insights · Your views', hash: `insights/${v.id}` }))].filter((x) => x.label.toLowerCase().includes(q)),
    has: (a) => !!ALIAS[a] || !!M.SUB[a] || views.some((v) => v.id === a),
    needs: (a) => { const s = M.SUB[ALIAS[a] || a]; return s?.team && !team() ? { min: 'expert', name: s.title } : null; },   // nav.locked: a Team page's own line, never Spend in its place
    show: ({ bar: b, page: pg, arg: a }) => { if (b !== bar) wire(b, pg); const next = ALIAS[a] || a || 'spend'; if (arg !== next) menu = ''; arg = next; draw(); },
  };
})();
