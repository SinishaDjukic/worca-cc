// Insights on Rail (Wave 3, 4.2): Statistics, the cost report and Team metrics as one place, with nothing said twice.
// The bar lists questions, not pages: Yours (what your tasks cost, saved and did) and, in Expert with a team policy, Team.
// A question's page says its answer in a sentence (the PlaceHead), picks what to look at in one sentence of pickers (of
// which projects, by what, when), shows one chart for it over time and its breakdown as rows. Labels and cost tags are
// not a third part: they are what "by" can read.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const DAYS = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  // each question: its answer, why, its series by day (this month) and its breakdown by each "by"
  const Q = {
    spend: { title: 'Spend', team: false, word: '$412 of $1,000', why: 'On pace for $890 by 30 Nov · 12% more than October', series: [38, 61, 22, 74, 55, 9, 93, 60], fmt: usd,
      by: { project: [['billing-api', 186], ['web-app', 131], ['worca-cc', 72], ['docs-site', 23]], workflow: [['Default', 241], ['Full', 102], ['Quick Fix', 69]], label: [['hotfix', 96], ['billing', 188], ['no label', 128]], tag: [['client:acme', 181], ['client:globex', 43], ['no tag', 188]] } },
    saved: { title: 'Saved', team: false, word: '$1,240 saved', why: '≈ 47 hours of work at $35 an hour, 3× what it cost', series: [120, 180, 60, 240, 150, 30, 260, 200], fmt: usd,
      by: { project: [['billing-api', 610], ['web-app', 380], ['worca-cc', 250]], workflow: [['Default', 720], ['Full', 340], ['Quick Fix', 180]], label: [['hotfix', 210], ['billing', 560], ['no label', 470]], tag: [['client:acme', 520], ['no tag', 720]] } },
    outcomes: { title: 'How tasks went', team: false, word: '38 of 44 finished', why: '4 failed, 2 stopped · 9 PRs merged', series: [4, 6, 3, 7, 5, 1, 9, 9], fmt: (n) => `${n} tasks`,
      by: { project: [['billing-api', 18], ['web-app', 14], ['worca-cc', 12]], workflow: [['Default', 26], ['Full', 10], ['Quick Fix', 8]], label: [['hotfix', 9], ['billing', 15], ['no label', 20]], tag: [['client:acme', 17], ['no tag', 27]] } },
    time: { title: 'Time', team: false, word: '24 min a task', why: 'The middle task; 1 in 10 takes over 2 hours', series: [22, 31, 18, 40, 26, 12, 35, 24], fmt: (n) => `${n} min`,
      by: { project: [['billing-api', 28], ['web-app', 21], ['worca-cc', 19]], workflow: [['Full', 52], ['Default', 23], ['Quick Fix', 9]], label: [['hotfix', 14], ['billing', 27]], tag: [['client:acme', 25], ['no tag', 23]] } },
    team: { title: 'Team spend', team: true, word: '$2,860 of $6,000', why: 'Five people · on pace for $5,400 · pooled budget at 48%', series: [240, 410, 180, 520, 390, 60, 610, 450], fmt: usd,
      by: { person: [['Maya', 920], ['Emil', 412], ['Jonas', 780], ['Priya', 510], ['Lee', 238]], project: [['billing-api', 1240], ['web-app', 980], ['worca-cc', 640]], tag: [['client:acme', 1460], ['client:globex', 610], ['no tag', 790]] } },
    shipped: { title: 'Shipped', team: true, word: '27 PRs merged', why: '6 in review, 3 need attention · 2.1 days from start to merge', series: [2, 4, 1, 5, 3, 0, 7, 5], fmt: (n) => `${n} PRs`,
      by: { person: [['Maya', 9], ['Jonas', 7], ['Emil', 5], ['Priya', 4], ['Lee', 2]], project: [['billing-api', 12], ['web-app', 9], ['worca-cc', 6]] } },
    untagged: { title: 'Missing cost tags', team: true, word: '6 tasks without a cost centre', why: '$148 not counted to anyone; a cost centre is required', series: [1, 0, 2, 0, 1, 0, 2, 0], fmt: (n) => `${n} tasks`,
      by: { person: [['Lee', 3], ['Priya', 2], ['Emil', 1]], project: [['web-app', 4], ['docs-site', 2]] } },
  };
  const BY = { day: 'day', project: 'project', workflow: 'workflow', label: 'label', tag: 'cost tag', person: 'person' };
  const WHEN = ['this month', 'last month', 'this quarter', 'this year'];
  const view = { of: 'all projects', when: 'this month' };
  const byOf = {};
  let current = '', menu = '', ctl = null, bar = null, page = null;
  const team = () => R.shows('expert');
  const rowOf = (id) => ({ key: `q:${id}`, _id: id, title: Q[id].title, mark: R.kindMark({ kind: 'event', tone: id === 'untagged' ? 'act' : 'idle' }), end: Q[id].word.split(' ')[0], current: id === current, tip: `${Q[id].title}\n${Q[id].word}\n${Q[id].why}`, menu: [{ id: 'csv', text: 'Export CSV', help: 'Its rows, for a spreadsheet' }] });
  function pageHtml(id) {
    const q = Q[id], by = byOf[id] || 'day';
    const pick = (pid, text, items, tip) => R.sentencePicker({ id: pid, text, tip, items: items.map((v) => (typeof v === 'string' ? { id: v, text: v, checked: v === text } : v)), open: menu === pid, chevron: R.icon('chevron', 10) });
    const facts = `Of ${pick('in-of', view.of, ['all projects', 'billing-api', 'web-app', 'worca-cc'], 'Which projects')} by ${pick('in-by', BY[by], ['day', ...Object.keys(q.by)].map((k) => ({ id: k, text: BY[k], checked: k === by })), 'What it is broken down by')} ${pick('in-when', view.when, WHEN, 'When')}`;
    const head = R.placeHead({ title: q.title, facts, mark: R.kindMark({ kind: 'event', tone: id === 'untagged' ? 'act' : 'idle' }), word: q.word, why: q.why,
      action: R.button({ label: 'Export CSV', attrs: { 'data-in-csv': '' } }), menu: R.moreMenu({ id: 'in-more', label: `More for ${q.title}`, icon: R.icon('more', 16), open: menu === 'in-more', items: [{ id: 'link', text: 'Copy a link', help: 'To this question, as you narrowed it' }, ...(id === 'untagged' ? [{ id: 'tasks', text: 'Show those tasks', help: 'In Tasks, to tag them' }] : [])] }) });
    const chart = R.barChart({ label: `${q.title} by day, ${view.when}`, bars: q.series.map((v, i) => ({ label: `Nov ${DAYS[i]}`, value: v, text: q.fmt(v) })), current: q.series.length - 1 });
    const rows = by === 'day' ? '' : (() => { const list = q.by[by] || [], total = list.reduce((a, [, v]) => a + v, 0) || 1;
      return R.settingsSection({ title: `By ${BY[by]}`, rows: list.map(([name, v]) => R.settingsRow({ name, sentence: `${esc(q.fmt(v))} · ${Math.round((v / total) * 100)}%`, end: R.button({ label: 'Its tasks', kind: 'quiet', attrs: { 'data-in-tasks': name, title: `Tasks, narrowed to ${name}` } }) })).join('') }); })();
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${chart}${rows}</div></div><div class="convo-dock" id="in-dock"></div></div>`;
  }
  function homeHtml() {
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ title: 'Insights', facts: esc(`What your tasks cost, saved and did${team() ? ', and your team’s' : ''}, ${view.when}`) })}
      ${R.settingsSection({ title: 'Yours', rows: ['spend', 'saved', 'outcomes', 'time'].map((id) => R.settingsRow({ name: Q[id].title, sentence: `<b>${esc(Q[id].word)}</b> · ${esc(Q[id].why)}`, end: R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-in-open': id } }) })).join('') })}
      ${team() ? R.settingsSection({ title: 'Team', meta: 'From the worca-metrics branch: every teammate who shares their tasks.', rows: ['team', 'shipped', 'untagged'].map((id) => R.settingsRow({ name: Q[id].title, sentence: `<b>${esc(Q[id].word)}</b> · ${esc(Q[id].why)}`, end: R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-in-open': id } }) })).join('') }) : ''}
    </div></div></div>`;
  }
  function draw() {
    if (!bar || !page) return;
    ctl?.paint();
    page.innerHTML = Q[current] && (!Q[current].team || team()) ? pageHtml(current) : homeHtml();
    if (Q[current]) window.RailConversation?.dock(document.getElementById('in-dock'), { kind: 'question', title: Q[current].title, chat: '' });
  }
  function wire(b, pg) {
    bar = b; page = pg;
    ctl = R.listController({ root: bar, spec: { noun: 'questions', label: 'Selected', view: () => ({ state: 'ready',
      parts: [{ word: 'Showing', id: 'when', text: view.when, tip: 'When', items: WHEN.map((w) => ({ id: w, text: w, checked: view.when === w })) }],
      sections: [{ id: 'yours', title: 'Yours', rows: ['spend', 'saved', 'outcomes', 'time'].map(rowOf) }, ...(team() ? [{ id: 'team', title: 'Team', rows: ['team', 'shipped', 'untagged'].map(rowOf) }] : [])] }),
      can: () => ['menu'], bulk: () => [], act: (id, rows) => { if (id === 'csv') say(`Exported ${Q[rows[0]._id].title} as CSV`); }, open: (r) => window.RailShell.go(`insights/${r._id}`), word: (id, v) => { view[id] = v; draw(); return false; }, say,
      active: () => /^#insights/.test(location.hash) } });
    page.addEventListener('click', (e) => {
      const on = (q) => e.target.closest(q); let hit;
      if ((hit = on('[data-in-open]'))) { window.RailShell.go(`insights/${hit.dataset.inOpen}`); return; }
      if (!Q[current]) return;
      if (on('[data-in-csv]')) { say(`Exported ${Q[current].title}, ${view.when}, as CSV`); return; }
      if ((hit = on('[data-in-tasks]'))) { window.RailShell.go('runs'); say(`Tasks from ${hit.dataset.inTasks}`); return; }
      if ((hit = on('[data-menu-pick]'))) {
        const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
        if (id === 'in-more') { if (v === 'tasks') window.RailShell.go('runs'); else say('Copied a link to this question'); draw(); return; }
        if (id === 'in-of') view.of = v; if (id === 'in-when') view.when = v; if (id === 'in-by') byOf[current] = v;
        draw(); return;
      }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => !!menu, inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.insights = { sample: 'spend', show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) menu = ''; current = arg || 'spend'; draw(); } };   /* no overview that repeats the bar: Insights opens on its first question */
})();
