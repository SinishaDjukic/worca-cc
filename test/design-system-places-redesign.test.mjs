// The places' redesign: what Projects, Workflows, Marketplace and Insights added to the library.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- the shared parts ----
test('PageFilters: one FilterRow with the page\'s small tools at its end; a pick reports data-pick', async () => {
  const { centerSentence, centerFilters, figuresButton } = await import('../ui/public/design-system/components/center.mjs');
  assert.equal(centerSentence.filters, undefined, 'a page calls R.centerFilters: no bridge on CenterSentence');
  const parts = [{ id: 'sort', label: 'Sort by', text: 'most urgent', items: [{ id: 'most urgent', text: 'most urgent', checked: true }, { id: 'A–Z', text: 'A–Z' }] }];
  const end = figuresButton({ open: false, attrs: { 'data-figs': '' } });
  const html = centerFilters({ parts, pick: 'sort', end });
  assert.equal(html.match(/class="fr"/g).length, 1, 'one FilterRow, never one per field');
  assert.ok(html.includes('data-pick="sort|A–Z"'), 'the open picker lists its choices as picks');
  assert.equal(html.split(end).length, 2, 'the tools are drawn once, whether FilterRow has an end slot or not');
  assert.ok(html.indexOf(end) > html.indexOf('data-menu="sort"'), 'the tools come after the pickers');
  assert.ok(!/Showing/.test(html), 'no sentence');
  assert.equal(centerFilters({ parts }).includes('center-filters-end'), false, 'no tools, no end');
});

test('Figures at a filter row\'s end is a bordered button that says whether the totals show', async () => {
  const { figuresButton } = await import('../ui/public/design-system/components/center.mjs');
  const shut = figuresButton({ attrs: { 'data-figs': '' } }), open = figuresButton({ open: true });
  assert.match(shut, /^<button type="button" class="btn btn-sm"/, 'a real button, not the quiet text look');
  assert.ok(shut.includes('aria-expanded="false"') && open.includes('aria-expanded="true"'));
  assert.ok(shut.includes('data-figs'));
});


// ---- Workflows ----
// panel.graph-box: the graph never draws under a size you can read unless asked by hand; it says when it is wider than its box
test('Workflows: StillhetGraph.mount says when the graph is wider than its box, and marks a size under the readable floor', async () => {
  const { readFileSync } = await import('node:fs');
  const { JSDOM } = await import('jsdom');
  globalThis.window = globalThis.window || {};
  await import('../ui/public/stillhet/graph/graph-entry.mjs');
  const { READABLE_FIT } = await import('../ui/public/graph/view.mjs');
  const G = globalThis.window.StillhetGraph;
  const steps = (n) => Array.from({ length: n }, (_, i) => [`Step ${i + 1}`, 'planner', 'Sonnet 5.5', 'high', 3, 0.1]);
  const host = () => new JSDOM('<!doctype html><div id="h"></div>').window.document.getElementById('h');
  // a long workflow in a 700px box, fitted: held at the readable floor, wider than the box, its words kept at 12px
  let h = host(), r = G.mount(h, { id: 'w', title: 'W', steps: steps(14), loops: [] }, { width: 700, zoom: 0 });
  assert.equal(r.fit, READABLE_FIT);
  assert.equal(r.wide, true, 'wider than its box: the box scrolls');
  assert.equal(h.classList.contains('is-small'), false);
  // a one-step workflow fits: not wide
  h = host(); r = G.mount(h, { id: 'w', title: 'W', steps: steps(1), loops: [] }, { width: 1400, zoom: 0 });
  assert.equal(r.wide, false);
  // the editor's Zoom out, by hand, under the floor: marked small, so the skin lets its words shrink with the cards
  h = host(); r = G.mount(h, { id: 'w', title: 'W', steps: steps(14), loops: [] }, { width: 700, zoom: 0.4, mode: 'edit' });
  assert.equal(h.classList.contains('is-small'), true);
  // the skin's floor: every word of a graph at a readable size is 12px or more
  const css = readFileSync(new URL('../ui/public/stillhet/css/places.css', import.meta.url), 'utf8');
  assert.match(css, /\.gv-skin:not\(\.is-small\) \.gv-world :is\([^)]*\.nlabel[^)]*\.ncap[^)]*\)\{font-size:max\(12px,/);
});

// what the Workflows pages call: the library's FilterRow for their views, no composer, the editor's six buttons
test('Workflows: the lists use FilterRow, the pages have no composer, and the editor bar holds Undo, Redo, Import, Export, Discard, Save', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../ui/public/stillhet/workflows/workflows.js', import.meta.url), 'utf8');
  assert.match(js, /R\.centerFilters\(/);   // PageFilters: the one FilterRow call the places share
  assert.doesNotMatch(js, /Showing \$\{/, 'no filter sentence');
  assert.doesNotMatch(js, /convo-dock|StillhetConversation\?\.dock\(/, 'no composer on a Workflows page (stillhet.chat-first)');
  assert.doesNotMatch(js, /Legacy approach/);
  assert.match(js, /Ask about it in chat/);
  const bar = js.slice(js.indexOf('const acts = `<div class="wf-ed-acts">'), js.indexOf('const z = ed.z'));
  assert.deepEqual([...bar.matchAll(/b\('(\w+)'|label: '(\w+)'/g)].map((m) => m[1] || m[2]), ['Undo', 'Redo', 'Import', 'Export', 'Discard', 'Save']);
  assert.match(js, /convo-col is-center/, 'the one page column, as Tasks');
});


// ---- Insights ----
{
  const { JSDOM } = await import('jsdom');
  const { figureRows } = await import('../ui/public/design-system/components/chart.mjs');
  const { heatGrid } = await import('../ui/public/design-system/components/heat-grid.mjs');
  const { filterRow } = await import('../ui/public/design-system/components/list-parts.mjs');
  const { readFileSync } = await import('node:fs');
  const body = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;
  const columns = [{ label: 'Share' }, { label: 'AI spend' }, { label: 'Hours saved', narrow: false }, { label: 'Tasks', narrow: false }];
  const rows = [
    { name: 'billing-api', cells: ['45%', '$186', '21 h', '18'], attrs: { 'data-in-row': '{"project":"billing-api"}', title: 'Opens Tasks, narrowed to billing-api' } },
    { name: 'Opus 5.5', cells: ['58%', '$238', '27 h', '22'], why: 'Tasks narrow by project, time or status, not by model' },
    { name: 'Other', cells: ['2%', '$8', '1 h', '1'], quiet: true, attrs: { disabled: true, title: 'Nothing to open' } },
    { name: 'A person', cells: ['32%', '$920', '108 h', '102'], attrs: { 'data-in-person': 'A person' }, opens: { id: 'w1', open: true, label: "A person's work", head: '<b>Their work</b>', body: '<p>rows</p>' } },
  ];

  test('figureRows: a row that opens is a button with a chevron; a row that cannot open is text, never a disabled button', () => {
    const d = body(figureRows({ label: 'By project', columns, rows }));
    const [opens, model, other, person] = d.querySelectorAll('.fr-row:not(.is-head)');
    assert.equal(opens.tagName, 'BUTTON'); assert.ok(opens.querySelector('.fr-go svg'), 'it shows that it opens');
    for (const r of [model, other]) {
      assert.equal(r.tagName, 'DIV'); assert.ok(r.classList.contains('is-static'));
      assert.equal(r.hasAttribute('disabled'), false); assert.equal(r.hasAttribute('tabindex'), false);
      assert.equal(r.querySelector('.fr-go svg'), null, 'no chevron on a row that opens nothing');
    }
    assert.equal(model.getAttribute('title'), 'Tasks narrow by project, time or status, not by model');
    assert.equal(model.getAttribute('aria-label'), 'Opus 5.5: Share 58%, AI spend $238, Hours saved 27 h, Tasks 22');
    assert.equal(person.getAttribute('aria-expanded'), 'true');
    assert.equal(d.querySelector('.fr-detail [data-fr-hide]').tagName, 'BUTTON', 'Hide is a bordered button, not bare text');
  });

  test('figureRows: no column leaves on a narrow screen; the rows sit in a box that scrolls sideways', () => {
    const html = figureRows({ label: 'By project', columns, rows });
    const d = body(html);
    assert.ok(d.querySelector('.fr-scroll > .fr-list'));
    assert.doesNotMatch(html, /is-wide/);
    for (const r of d.querySelectorAll('.fr-row:not(.is-head)')) assert.equal(r.querySelectorAll('.fr-c').length, columns.length);
    const css = readFileSync('ui/public/stillhet/css/places.css', 'utf8') + readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8');
    assert.match(css, /@media \(max-width:640px\)\{\.fr-scroll\{overflow-x:auto/);
    assert.doesNotMatch(css, /\.fr-c\.is-wide\{display:none/, 'the rule that dropped columns at 640px is gone');
    assert.doesNotMatch(css, /\.fr-row\.is-static:hover/);
  });

  test('heatGrid: the legend holds in both themes, and a cell shows its number without a hover', () => {
    const html = heatGrid({ label: 'Who spends where', rows: [{ label: 'A person' }], columns: [{ label: 'billing-api' }, { label: 'web-app' }], max: 186, cells: [[{ value: 186, text: '$186, 21 tasks' }, { value: 0, text: '' }]] });
    const d = body(html);
    assert.match(d.querySelector('.hg-legend').textContent, /Less.*More.*The stronger the cell, the more it spent/);
    assert.doesNotMatch(html, /darker/i);
    assert.equal(d.querySelectorAll('.hg-legend .hg-key').length, 4);
    const cells = d.querySelectorAll('.hg-cell');
    assert.equal(cells[0].querySelector('.hg-tip').textContent, '$186, 21 tasks');
    assert.ok(cells[0].classList.contains('is-first') && cells[1].classList.contains('is-last'), 'an edge cell keeps its card inside the grid');
    assert.equal(d.querySelectorAll('button, a, [title]').length, 0, 'a cell is not a control');
    const css = readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8') + readFileSync('ui/public/stillhet/css/places.css', 'utf8');
    assert.match(css, /\.hg-cell:hover \.hg-tip,\.hg-cell:focus \.hg-tip\{display:block;\}/);
    assert.match(css, /\.hg-cell\{[^}]*cursor:default/);
  });

  test('Insights filters: each is a labelled field (Show, By, Then by, Time, Of, As, Compared with), none a sentence word', () => {
    const labels = ['Show', 'By', 'Then by', 'Time', 'Of', 'As', 'Compared with'];
    const html = labels.map((label, i) => filterRow({ parts: [{ label, id: `f${i}`, text: 'value', items: [{ id: 'a', text: 'value', checked: true }] }] })).join('');
    const d = body(html);
    assert.deepEqual([...d.querySelectorAll('.fr-pick-l')].map((e) => e.textContent), labels.map((l) => `${l}:`));
    assert.equal(d.querySelectorAll('.fr-pick[data-menu]').length, labels.length);
    assert.equal(d.querySelector('[data-menu="f2"]').getAttribute('aria-label'), 'Then by: Value');
  });

  test('Insights model: six pages with no measure are gone; a budget is one fact with its source; a project\'s month has one source', async () => {
    const vm = await import('node:vm');
    const window = {};
    vm.runInNewContext(readFileSync('ui/public/stillhet/insights/insights-model.js', 'utf8'), { window });
    const M = window.StillhetInsightsModel;
    for (const id of ['why', 'review', 'autonomy', 'cache', 'merge', 'waiting']) assert.equal(M.SUB[id], undefined, id);
    assert.equal(M.SUBS.length, 13);
    for (const s of M.SUBS) { assert.ok(s.head, `${s.id} names whose figure it is`); assert.ok(s.measures, `${s.id} says what it measures`); assert.match(s.head, s.team ? /team/ : /you|shaping/i, s.id); }
    const B = M.BUDGET;
    assert.equal(B.yours.usd, 1000); assert.match(B.yours.from, /^Settings/); assert.match(B.team.from, /^Settings/);
    const word = (id) => { const s = M.SUB[id]; return s.word(M.compute(s, M.defaults(s))); };
    assert.equal(word('spend'), '$412 of your $1,000 budget');
    assert.equal(word('budget'), '41% of your $1,000 budget used');
    assert.equal(word('team'), "$2,860 of the team's $12,000 budget");
    assert.equal(M.SUB.spend.pace, `On pace for $${B.yours.pace.toLocaleString('en-US')}, $${B.yours.over} over`);
    // the same $412 is yours on Spend and your row among the team's five
    const you = M.SUB.spend.src.rows.person;
    assert.equal(you.length, 1); assert.equal(you[0].spend, 412);
    assert.equal(M.SUB.team.src.rows.person.find((r) => r.name === you[0].name).spend, 412);
    assert.deepEqual({ ...M.projectMonth('web-app') }, { spend: 131, tasks: 16 });
    assert.equal(M.projectMonth('no-such-project'), null);
  });
}

test('barChart: a chart you can read is one Tab stop of named bars; one that only shows has no Tab stops and keeps its table', async () => {
  const { barChart } = await import('../ui/public/design-system/components/chart.mjs');
  const { JSDOM } = await import('jsdom');
  const bars = [{ label: 'Mon', value: 10, text: '$10' }, { label: 'Tue', value: 40, text: '$40' }, { label: 'Wed', value: 5, text: '$5' }];
  const play = new JSDOM(barChart({ label: 'Spend by day', bars, current: 2, play: true })).window.document;
  assert.equal(play.querySelector('.bc-plot').getAttribute('aria-hidden'), null, 'the bars are read: the plot is not hidden');
  assert.equal(play.querySelector('.bc-plot').getAttribute('role'), 'group');
  assert.deepEqual([...play.querySelectorAll('.bc-col')].map((b) => [b.getAttribute('role'), b.getAttribute('tabindex'), b.getAttribute('aria-label')]), [['button', '-1', 'Mon: $10'], ['button', '-1', 'Tue: $40'], ['button', '0', 'Wed: $5']]);
  assert.equal(play.querySelector('.bc-table').getAttribute('aria-hidden'), 'true', 'one or the other: the named bars, not the table too');
  const still = new JSDOM(barChart({ label: 'Spend by day', bars })).window.document;
  assert.equal(still.querySelector('.bc-plot').getAttribute('aria-hidden'), 'true');
  assert.equal(still.querySelectorAll('.bc-col[tabindex]').length, 0, 'no Tab stop inside a hidden plot');
  assert.equal(still.querySelector('.bc-table').getAttribute('aria-hidden'), null);
});
