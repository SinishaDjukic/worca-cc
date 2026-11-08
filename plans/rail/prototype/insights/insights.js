// Insights on Rail (Wave 3): one feature; its bar holds its sub-features, grouped. Every page says the answer in a sentence
// (the PlaceHead), draws one chart (bars unless you ask otherwise, look.chart-play), says what it shows in one sentence of
// pickers, lists breakdown rows that open their tasks and ends with the composer. The numbers come from insights-model.js.
(function () {
  const R = window.RailUI, M = window.RailInsightsModel;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const AS = { bars: 'bars', lines: 'lines', running: 'running total', mix: 'mix', table: 'table' };
  const AGAINST = { none: 'nothing', before: 'the same weekdays before', budget: 'the budget' };
  const HINT = 'Drag across to narrow';
  const ALIAS = { saved: 'time-saved', outcomes: 'ends', time: 'merge' };   // old links to what the page used to be called
  const views = [{ id: 'v1', name: 'By client, then workflow', sub: 'spend', st: { by: 'client', then: 'workflow' } }, { id: 'v2', name: 'Monthly for finance', sub: 'spend', st: { by: 'costcenter', when: 'last month', as: 'table' } }];
  const states = {};
  let arg = 'spend', menu = '', bar = null, page = null, seq = 3, back = '';
  const team = () => R.shows('expert');
  const subOf = (a) => { const v = views.find((x) => x.id === a), s = M.SUB[v ? v.sub : a]; return s && (!s.team || team()) ? s : M.SUB.spend; };
  const key = () => (views.some((v) => v.id === arg) || (M.SUB[arg] && subOf(arg).id === arg) ? arg : 'spend');
  function stateOf(k = key()) {
    if (!states[k]) { const v = views.find((x) => x.id === k); states[k] = { ...M.defaults(subOf(k)), ...(v ? v.st : {}) }; }
    return states[k];
  }
  // ---- the bar: the SideMenu, a distinct icon for each question, no money in it ----
  function barHtml() {
    const k = key(), item = (id, label, icon, count) => ({ label, icon, count, current: id === k, attrs: { 'data-in-go': id } });
    const groups = ['Cost', 'Value', 'Quality', 'Flow', 'Team'].flatMap((g) => { const items = M.SUBS.filter((s) => s.group === g && (!s.team || team())).map((s) => item(s.id, s.title, s.icon, s.count)); return items.length ? [{ title: g, items }] : []; });
    return R.sideMenu({ label: 'Insights', groups: [...groups, ...(views.length ? [{ title: 'Your views', items: views.map((v) => item(v.id, v.name, 'sliders')) }] : [])] });
  }
  // ---- the sentence ----
  const pick = (dims) => M.DIM_GROUPS.flatMap(([h, l]) => { const on = l.filter(([d]) => dims.includes(d)); return on.length ? [{ header: h }, ...on.map(([id, text]) => ({ id, text }))] : []; });
  function filterItems(sub, st) {
    const items = M.FILTERS.filter((d) => sub.src.rows[d]).flatMap((d) => [{ header: M.DIM[d] }, ...sub.src.rows[d].map((r) => ({ id: `${d}:${r.name}`, text: r.name, checked: st.filter.includes(`${d}:${r.name}`) }))]);
    return [{ id: 'all', text: 'everything', checked: !st.filter.length }, ...items];
  }
  const filterWord = (st) => (st.filter.length ? st.filter.map((k) => k.slice(k.indexOf(':') + 1)).join(', ') : 'everything');
  const forms = (sub, st) => sub.forms.filter((f) => f !== 'mix' || !M.TIME.has(st.by));
  function againsts(sub, st, c) { return ['none', ...(c.P ? ['before'] : []), ...(sub.budget && st.when === 'this month' ? ['budget'] : [])]; }
  function sentence(sub, st, c) {
    const dims = M.dimsOf(sub.src, st);
    const part = (word, id, text, items, extra = {}) => ({ word, id, text, items, ...extra });
    const check = (list, cur) => list.map((v) => ({ id: v, text: v, checked: v === cur }));
    const start = [
      part('Showing', 'in-what', sub.noun, M.SUBS.filter((s) => s.group === sub.group && (!s.team || team())).map((s) => ({ id: s.id, text: s.noun, checked: s.id === sub.id })), { tip: 'What it shows' }),
      part('by', 'in-by', M.DIM[st.by], [...pick(dims).map((it) => (it.header ? it : { ...it, checked: it.id === st.by })), { sep: true }, { id: '+then', text: st.then ? `Then by ${M.DIM[st.then]}` : 'Then by' }], { tip: 'What it is broken down by' }),
      ...(st.then ? [part('then', 'in-then', M.DIM[st.then], [...pick(dims.filter((d) => d !== st.by)).map((it) => (it.header ? it : { ...it, checked: it.id === st.then })), { sep: true }, { id: 'none', text: 'No second level' }], { tip: 'The level under it' })] : []),
      part('', 'in-when', c.timeWord, [...check(M.WHEN, st.narrow ? '' : st.when), { id: 'custom', text: 'custom' }], { tip: 'When' }),
    ];
    const clear = st.narrow ? R.button({ label: 'Back to the whole period', iconOnly: true, kind: 'quiet', icon: R.icon('x', 11), cls: 'ch-clear', attrs: { 'data-in-clear': '' } }) : '';
    const rest = [
      part('of', 'in-of', filterWord(st), filterItems(sub, st), { tip: 'Which of it' }),
      part('as', 'in-as', AS[st.as], forms(sub, st).map((f) => ({ id: f, text: AS[f], checked: f === st.as })), { tip: 'How it is drawn' }),
      part('against', 'in-vs', AGAINST[st.against], againsts(sub, st, c).map((v) => ({ id: v, text: AGAINST[v], checked: v === st.against })), { tip: 'What it is set against' }),
    ];
    const open = { open: menu, chevron: R.icon('chevron', 10) };
    const words = (l, cls = '') => R.listSentence({ parts: l, ...open, menuCls: cls });
    return `<div class="list-sentence">${words(start.slice(0, 1))} ${words(start.slice(1, 2), ' is-two-cols')} ${st.then ? words([start[2]], ' is-two-cols') : ''} ${words(start.slice(-1))}${clear} ${words(rest.slice(0, 1), ' is-two-cols')} ${words(rest.slice(1))}</div>`;
  }
  // ---- the chart ----
  function chartHtml(sub, st, c) {
    const label = `${sub.title} by day, ${c.timeWord}`, hint = c.labels.length > 2 ? HINT : '', cur = c.whole && st.when === 'this month' ? c.labels.length - 1 : -1;
    const taskField = sub.src.fields.includes('tasks') ? 'tasks' : '';
    const pointAt = (v, i) => ({ value: v ?? 0, text: v == null ? 'none' : sub.text(v), diff: c.before ? R.diffWords(v, c.before[i], sub.text) : '', note: taskField ? `${c.F.tasks[i]} ${c.F.tasks[i] === 1 ? 'task' : 'tasks'}, opens them` : 'Opens its tasks' });
    const bars = c.labels.map((l, i) => ({ label: l, ...pointAt(c.points[i], i) }));
    if (st.as === 'table') return `<div class="in-table">${R.table({ label, columns: [{ id: 'day', label: 'When' }, { id: 'v', label: sub.noun, num: true }, ...(c.before ? [{ id: 'b', label: 'The same weekdays before', num: true }, { id: 'd', label: 'Difference', num: true }] : [])], rows: c.labels.map((l, i) => ({ day: l, v: c.points[i] == null ? 'none' : sub.text(c.points[i]), b: c.before?.[i] == null ? '' : sub.text(c.before[i]), d: bars[i].diff })) })}</div>`;
    if (st.as === 'mix') {
      const top = c.rows.slice(0, 3), rest = c.rows.slice(3), weights = [...top, ...(rest.length ? [{ name: 'Other', [sub.num]: M.sum(rest.map((r) => r[sub.num])) }] : [])], perDay = c.labels.map((_, i) => M.allocate(weights.map((r) => r[sub.num]), c.F[sub.num][i]));
      return R.mixChart({ label, labels: c.labels, hint, reads: c.points.map((v) => sub.text(v)), parts: weights.map((r, k) => ({ label: r.name, values: perDay.map((d) => d[k]), texts: perDay.map((d) => sub.text(d[k])) })) });
    }
    if (st.as === 'running' || st.as === 'lines') {
      const running = st.as === 'running', acc = (l) => { let t = 0; return l.map((v) => { t += v || 0; return t; }); };
      const now = running ? acc(c.points) : c.points, was = c.before && st.against === 'before' ? (running ? acc(c.before) : c.before) : null;
      const labels = running && st.against === 'budget' && c.whole ? Array.from({ length: 30 }, (_, i) => `Nov ${i + 1}`) : c.labels;
      const main = labels.map((_, i) => (i < now.length && now[i] != null ? { ...pointAt(c.points[i], i), value: now[i], text: sub.text(now[i]), diff: running ? '' : pointAt(c.points[i], i).diff } : null));
      const series = [{ label: running ? 'Running total' : sub.title, points: main }];
      if (was) series.push({ label: 'The same weekdays before', dashed: true, points: labels.map((_, i) => (i < was.length && was[i] != null ? { value: was[i], text: sub.text(was[i]) } : null)) });
      let limit = null;
      if (st.against === 'budget') {
        limit = { value: sub.budget, text: `Budget ${M.usd(sub.budget)}` };
        if (c.whole) { const lastAt = now.length - 1, pace = Math.round((now[lastAt] / now.length) * 30); series.push({ label: `On pace for ${M.usd(pace)}`, dashed: true, points: labels.map((_, i) => (i < lastAt ? null : { value: now[lastAt] + ((pace - now[lastAt]) * (i - lastAt)) / (29 - lastAt), text: sub.text(now[lastAt] + ((pace - now[lastAt]) * (i - lastAt)) / (29 - lastAt)) })) }); }
      }
      return R.lineChart({ label, labels, series, limit, current: cur, hint });
    }
    return R.barChart({ label, bars, current: cur, play: true, hint });
  }
  // ---- the rows ----
  const cellsOf = (sub, c, r) => [`${r.sharePct}%`, ...sub.cols.map(([, get]) => get(r, c))];
  const columns = (sub) => [{ label: 'Share' }, ...sub.cols.map(([label], i) => ({ label, narrow: i === 0 }))];
  function rowsHtml(sub, c) {
    const rowOf = (r, parent, s) => ({ name: r.name, cells: cellsOf(sub, c, r), sub: s, quiet: /^No /.test(r.name) || r.name === 'Other', attrs: { 'data-in-row': parent ? `${parent}, ${r.name}` : r.name, title: `Tasks, narrowed to ${parent ? `${parent}, ` : ''}${r.name}` } });
    return R.figureRows({ label: `By ${M.DIM[c.st.by]}`, columns: columns(sub), rows: c.rows.flatMap((r) => [rowOf(r, '', false), ...(r.kids || []).map((k) => rowOf(k, r.name, true))]) });
  }
  function actions(sub, st, c) {
    const tag = sub.id === 'untagged' || (sub.src === M.SUB.spend.src && st.by === 'client');
    const noClient = sub.id === 'untagged' ? c.T.tasks : c.rows.find((r) => r.name === 'No client')?.tasks;
    return `<div class="in-acts">${tag && noClient ? `${R.button({ label: `Tag these ${noClient} tasks`, attrs: { 'data-in-tag': noClient } })}${R.button({ label: 'Set a default for a project', kind: 'quiet', attrs: { 'data-in-default': '' } })}` : ''}${R.button({ label: 'Download CSV', kind: 'quiet', attrs: { 'data-in-csv': '' } })}${R.button({ label: 'Save this view', kind: 'quiet', attrs: { 'data-in-save': '' } })}</div>`;
  }
  const STANDS = 'Running web-app’s Build on Opus 5.5 would cost about $0.40 more a task and, on its last 11 tasks, save about one round.';
  function pageHtml(sub, st, c) {
    const plain = st.when === 'this month' && !st.narrow && !st.filter.length;
    const scope = st.narrow ? (c.days === 1 ? 'on this day' : `in these ${c.days} days`) : st.when === 'all time' ? 'in all' : st.when;
    const word = sub.wordAlways ? sub.wordAlways(c) : plain ? sub.word(c) : `${sub.text(c.v)} ${scope}`;
    const why = sub.whyAlways ? sub.whyAlways(c) : plain ? sub.why(c) : M.cmp(c, sub);
    const facts = st.narrow ? `${c.labels[0]} to ${c.labels[c.labels.length - 1]}, dragged out of ${st.when}` : st.filter.length ? `Only ${filterWord(st)}, ${st.when}` : `All your tasks and chats, ${st.when}`;
    const head = R.placeHead({ title: sub.title, facts: esc(facts), mark: R.kindMark({ kind: 'plugin', icon: sub.icon }), word, why, menu: R.moreMenu({ id: 'in-more', label: `More for ${sub.title}`, icon: R.icon('more', 16), open: menu === 'in-more', items: [{ id: 'link', text: 'Copy a link', help: 'To this page, as you narrowed it' }] }) });
    const stands = sub.id === 'why' ? `<p class="in-stands">What stands out: Review sends Build back most on <b>web-app</b>, on Sonnet 5.5. ${esc(STANDS)}</p><div class="in-acts">${R.button({ label: 'Try it in a chat', attrs: { 'data-in-try': '' } })}</div>` : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${sentence(sub, st, c)}${chartHtml(sub, st, c)}${rowsHtml(sub, c)}${stands}${actions(sub, st, c)}</div></div><div class="convo-dock" id="in-dock"></div></div>`;
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'insights';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    const sub = subOf(arg), st = stateOf(), c = M.compute(sub, st);
    const scroll = page.querySelector('.convo-scroll')?.scrollTop || 0, draft = page.querySelector('#in-dock [data-composer-t]')?.value || '';
    bar.innerHTML = barHtml();
    page.innerHTML = pageHtml(sub, st, c);
    window.RailConversation?.dock(document.getElementById('in-dock'), { kind: 'question', title: sub.title, chat: '' });
    const scroller = page.querySelector('.convo-scroll'); if (scroller) scroller.scrollTop = scroll;
    const box = page.querySelector('#in-dock [data-composer-t]'); if (box && draft) box.value = draft;
    R.watchChart(page.querySelector('[data-chart]'), {
      open: (i) => { window.RailShell.go('runs'); say(`Tasks from ${c.labels[i]}`); },
      narrow: (a, b) => { const base = st.narrow ? st.narrow[0] : 0; st.narrow = [base + a, base + b]; menu = ''; draw(); },
    });
    if (back) { page.querySelector(`[data-menu="${back}"]`)?.focus({ preventScroll: true }); back = ''; }
  }
  function choose(id, v) {
    const sub = subOf(arg), st = stateOf();
    if (id === 'in-what') { menu = ''; if (v !== sub.id) window.RailShell.go(`insights/${v}`); else draw(); return; }
    if (id === 'in-by') {
      if (v === '+then') { st.then = st.then || M.dimsOf(sub.src, st).find((d) => d !== st.by && !M.TIME.has(d)) || ''; menu = 'in-then'; draw(); return; }
      st.by = v; if (st.then === v) st.then = '';
      if (st.as === 'mix' && M.TIME.has(v)) st.as = 'bars';
    }
    if (id === 'in-then') st.then = v === 'none' ? '' : v;
    if (id === 'in-when') {
      st.narrow = null;
      if (v === 'custom') { st.when = 'this month'; say('Drag across the chart to pick your days'); } else st.when = v;
      if (st.against === 'budget' && st.when !== 'this month') st.against = 'none';
      if (st.against === 'before' && st.when === 'all time') { st.against = 'none'; }
    }
    if (id === 'in-of') {
      if (v === 'all') st.filter = [];
      else st.filter = st.filter.includes(v) ? st.filter.filter((k) => k !== v) : [...st.filter, v];
      draw(); return;   /* tick several: the menu stays open */
    }
    if (id === 'in-as') { st.as = v; if (v === 'bars' || v === 'mix') st.against = 'none'; if (v === 'lines' && st.against === 'budget') st.against = 'none'; }
    if (id === 'in-vs') { st.against = v; if (v === 'budget') st.as = 'running'; else if (v === 'before' && st.as !== 'running' && st.as !== 'table') st.as = 'lines'; else if (v === 'none' && st.as === 'running' && !sub.forms.includes('running')) st.as = 'bars'; }
    back = id; menu = ''; draw();
  }
  function csv(sub, st) {
    const c = M.compute(sub, st, true), q = (t) => `"${String(t).replace(/"/g, '""')}"`, head = [M.DIM[st.by], ...(st.then ? [M.DIM[st.then]] : []), 'Share', ...sub.cols.map(([l]) => l)];
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
    const c = M.compute(sub, st), name = `${sub.title} by ${M.DIM[st.by]}${st.then ? `, then ${M.DIM[st.then]}` : ''}, ${c.timeWord}`;
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
      if (on('[data-in-clear]')) { st.narrow = null; menu = ''; draw(); return; }
      if (on('[data-in-csv]')) { csv(sub, st); return; }
      if (on('[data-in-save]')) { save(sub, st); return; }
      if (on('[data-in-try]')) { window.RailConversation?.start('ask', `Try web-app's Build on Opus 5.5 for a while: ${STANDS}`); return; }
      if ((hit = on('[data-in-tag]'))) { window.RailShell.go('runs'); say(`Tasks without a client, ${hit.dataset.inTag} of them, to tag`); return; }
      if (on('[data-in-default]')) { window.RailShell.go('projects'); say('Set it in a project: Every new task here gets'); return; }
      if ((hit = on('[data-in-row]'))) { window.RailShell.go('runs'); say(`Tasks, narrowed to ${hit.dataset.inRow}`); return; }
      if ((hit = on('[data-pick]'))) { const t = hit.dataset.pick, at = t.indexOf('|'); choose(t.slice(0, at), t.slice(at + 1)); return; }
      if ((hit = on('[data-menu-pick]'))) { menu = ''; if (hit.dataset.menuPick.startsWith('in-more|')) say('Copied a link to this page'); draw(); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop, #route-place .pz-pick', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.insights = {
    sample: 'spend',
    search: (q) => [...M.SUBS.filter((s) => !s.team || team()).map((s) => ({ label: s.title, where: `Insights · ${s.group}`, hash: `insights/${s.id}` })), ...views.map((v) => ({ label: v.name, where: 'Insights · Your views', hash: `insights/${v.id}` }))].filter((x) => x.label.toLowerCase().includes(q)),
    show: ({ bar: b, page: pg, arg: a }) => { if (b !== bar) wire(b, pg); const next = ALIAS[a] || a || 'spend'; if (arg !== next) menu = ''; arg = next; draw(); },
  };
})();
