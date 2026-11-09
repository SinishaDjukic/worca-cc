// Insights' seeded data and its arithmetic (Wave 3). Every number on a page is computed here from these series and rows,
// so a narrowed stretch, a filter or a second level still adds up: a total is cut into rows by largest remainder.
(function () {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  function allocate(weights, total) {
    const all = sum(weights);
    if (!all || !total) return weights.map(() => 0);
    const exact = weights.map((w) => (w / all) * total), out = exact.map(Math.floor);
    exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, Math.round(total - sum(out))).forEach(([, i]) => { out[i] += 1; });
    return out;
  }
  const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`, usd2 = (n) => `$${n.toFixed(2)}`, pct = (n) => `${Math.round(n * 100)}%`;
  const plural = (n, w) => `${Math.round(n)} ${w}${Math.round(n) === 1 ? '' : 's'}`;

  // the dimensions of "by", grouped; a page offers those it has data for
  const DIM_GROUPS = [
    ['Where', [['project', 'project'], ['workspace', 'workspace'], ['branch', 'branch'], ['ticket', 'ticket'], ['pr', 'pull request']]],
    ['What did the work', [['workflow', 'workflow'], ['stage', 'stage'], ['agent', 'step and agent'], ['subagents', 'sub-agents']]],
    ['What it ran on', [['model', 'model'], ['engine', 'engine'], ['effort', 'effort'], ['cache', 'cache read or write'], ['tokens', 'tokens in or out']]],
    ['Why it cost', [['why', 'why'], ['rework', 'rework'], ['retries', 'retries'], ['fixes', 'fix rounds'], ['failed', 'failed or stopped'], ['reason', 'what went wrong']]],
    ['Who and how', [['person', 'person'], ['origin', 'chat, task, schedule'], ['requirements', 'Requirements'], ['away', 'Away or at the desk'], ['status', 'status'], ['billing', 'API or subscription']]],
    ['How you organise', [['client', 'client (cost tag)'], ['teamtag', 'team (cost tag)'], ['costcenter', 'cost-center (cost tag)'], ['label', 'label']]],
    ['When', [['hour', 'hour'], ['day', 'day'], ['week', 'week'], ['month', 'month'], ['timeofday', 'time of day']]],
  ];
  const DIM = Object.fromEntries(DIM_GROUPS.flatMap(([, l]) => l));
  const TIME = new Set(['day', 'week', 'month']), ORDERED = new Set(['stage', 'timeofday', ...TIME]);
  const FILTERS = ['project', 'workspace', 'workflow', 'model', 'origin', 'client', 'label'];

  // a source: its fields, each field's day series for 1-8 Nov and for the same days last month, and its rows by dimension
  function source(def) {
    const { fields, series, before = {}, dims, lastK = {} } = def, first = fields[0];
    const totals = {};
    for (const f of fields) {
      const rowsOf = Object.values(dims)[0], k = fields.indexOf(f) + 1;
      totals[f] = series[f] ? sum(series[f]) : sum(rowsOf.map((r) => r[k] || 0));
      if (!series[f]) series[f] = allocate(series[first], totals[f]);
      if (!before[f]) before[f] = allocate(before[first], Math.round((totals[f] * sum(before[first])) / sum(series[first])));
    }
    const rows = {};
    for (const [dim, list] of Object.entries(dims)) {
      const out = list.map((r) => ({ name: r[0] }));
      fields.forEach((f, k) => {
        const given = list.every((r) => r[k + 1] != null);
        const vals = given ? list.map((r) => r[k + 1]) : allocate(list.map((r) => r[1]), totals[f]);
        out.forEach((r, i) => { r[f] = vals[i]; });
      });
      rows[dim] = out;
    }
    return { fields, series, before, rows, lastK };
  }

  const money = source({
    fields: ['spend', 'hours', 'saved', 'tasks'],
    series: { spend: [38, 61, 22, 74, 55, 9, 93, 60], hours: [4, 7, 3, 8, 6, 1, 10, 8], saved: [105, 184, 79, 210, 157, 26, 262, 210], tasks: [5, 8, 2, 9, 7, 1, 11, 6] },
    before: { spend: [29, 44, 30, 51, 40, 14, 66, 49], hours: [3, 5, 3, 6, 5, 2, 7, 5], saved: [79, 131, 79, 157, 131, 52, 184, 131], tasks: [3, 5, 3, 6, 5, 2, 7, 5] },
    dims: {
      project: [['billing-api', 186, 21, 549], ['web-app', 131, 14, 359], ['worca-cc', 72, 9, 243], ['docs-site', 23, 3, 82]],   // tasks: read from the Tasks list (compute)
      workspace: [['web-shop', 317, 35, 908], ['internal', 95, 12, 325]],
      branch: [['feat/invoice-export', 64], ['feat/checkout-retry', 58], ['feat/usage-page', 52], ['fix/webhook-race', 47], ['feat/csv-import', 41], ['fix/tax-rounding', 38], ['fix/rate-limit', 33], ['chore/deps-bump', 26], ['docs/api-guide', 23], ['fix/login-redirect', 18], ['chore/ci-cache', 12]],
      ticket: [['BILL-212', 72], ['WEB-88', 61], ['BILL-240', 55], ['WEB-91', 44], ['CC-17', 38], ['No ticket', 142]],
      pr: [['#482', 64], ['#477', 58], ['#490', 47], ['#471', 41], ['#466', 33], ['No PR yet', 169]],
      workflow: [['Default', 241, 28, 722, 29], ['Full', 102, 11, 305, 11], ['Quick Fix', 69, 8, 206, 9]],
      stage: [['Plan', 58], ['Build', 187], ['Review', 96], ['PR', 71]],
      agent: [['Implementer', 168], ['Reviewer', 88], ['Planner', 58], ['Tester', 57], ['Docs', 41]],
      subagents: [['Main agent', 331], ['Explore', 47], ['Code review', 34]],
      model: [['Opus 5.5', 238, 27, 712, 22], ['Sonnet 5.5', 142, 16, 425, 20], ['Haiku 5', 32, 4, 96, 7]],
      engine: [['Claude Code', 372], ['Codex', 40]],
      effort: [['high', 196], ['medium', 171], ['low', 45]],
      cache: [['Fresh input and output', 174], ['Cache read', 142], ['Cache write', 96]],
      tokens: [['Output', 324], ['Input', 88]],
      rework: [['Review sent it back', 69], ['Everything else', 343]],
      retries: [['Retries', 18], ['Everything else', 394]],
      fixes: [['PR fix rounds', 11], ['Everything else', 401]],
      failed: [['Failed or stopped', 33], ['Finished', 379]],
      origin: [['Tasks', 248, 28, 742, 30], ['Chat', 72, 8, 216, 10], ['Schedules', 53, 6, 158, 6], ['Requirements', 39, 5, 117, 3]],
      requirements: [['Not from a requirement', 373], ['Invoice export', 24], ['Checkout retries', 15]],
      away: [['At the desk', 269], ['Away', 143]],
      status: [['Finished', 379, 47, 1233, 43], ['Failed', 24, 0, 0, 4], ['Stopped', 9, 0, 0, 2]],
      billing: [['API', 286], ['Subscription', 126]],
      client: [['acme', 173, 19, 485, 19], ['globex', 91, 11, 294, 12], ['No client', 148, 17, 454, 18]],
      teamtag: [['payments', 186], ['growth', 131], ['No team', 95]],
      costcenter: [['CC-4100', 186], ['CC-4200', 131], ['No cost center', 95]],
      label: [['billing', 188], ['no label', 128], ['hotfix', 96]],
      hour: [['14:00', 64], ['10:00', 58], ['15:00', 57], ['11:00', 51], ['16:00', 49], ['13:00', 41], ['09:00', 34], ['17:00', 31], ['20:00', 27]],
      timeofday: [['Morning', 142], ['Afternoon', 178], ['Evening', 61], ['Night', 31]],
    },
  });
  const waste = source({
    fields: ['spend', 'tasks'],
    series: { spend: [12, 21, 4, 28, 16, 2, 31, 17], tasks: [3, 5, 1, 6, 4, 1, 6, 4] }, before: { spend: [7, 12, 8, 11, 9, 4, 14, 9], tasks: [2, 3, 2, 4, 3, 1, 3, 2] },
    dims: {
      why: [['Review sent it back', 69, 11], ['Failed or stopped tasks', 33, 6], ['Retries', 18, 9], ['PR fix rounds', 11, 4]],
      project: [['web-app', 61, 14], ['billing-api', 49, 10], ['worca-cc', 16, 5], ['docs-site', 5, 1]],
      workflow: [['Default', 86, 19], ['Full', 31, 7], ['Quick Fix', 14, 4]],
      stage: [['Build', 57, 13], ['Review', 51, 12], ['PR', 23, 5]],
      model: [['Sonnet 5.5', 68, 16], ['Opus 5.5', 54, 11], ['Haiku 5', 9, 3]],
    },
  });
  const ends = source({
    fields: ['finished', 'failed', 'stopped'],
    series: { finished: [5, 7, 2, 8, 6, 1, 9, 5], failed: [0, 1, 0, 1, 0, 0, 2, 0], stopped: [0, 0, 0, 0, 1, 0, 0, 1] }, before: { finished: [3, 4, 3, 5, 4, 2, 6, 4], failed: [0, 1, 0, 1, 0, 0, 1, 1], stopped: [0, 0, 0, 0, 1, 0, 0, 0] },
    dims: {
      project: [['billing-api', 10, 1, 1], ['web-app', 12, 2, 0], ['worca-cc', 20, 1, 1], ['docs-site', 1, 0, 0]],
      workflow: [['Default', 26, 2, 1], ['Full', 9, 2, 0], ['Quick Fix', 8, 0, 1]],
      model: [['Opus 5.5', 20, 1, 1], ['Sonnet 5.5', 17, 2, 1], ['Haiku 5', 6, 1, 0]],
      client: [['acme', 18, 1, 0], ['globex', 10, 1, 1], ['No client', 15, 2, 1]],
    },
  });
  const review = source({
    fields: ['rounds', 'tasks', 'reviews', 'fixed', 'disputed', 'open', 'first'],
    series: { rounds: [6, 8, 3, 11, 7, 1, 10, 7], tasks: [4, 6, 2, 7, 5, 1, 8, 5] }, before: { rounds: [4, 6, 4, 7, 6, 3, 8, 5], tasks: [3, 4, 3, 5, 4, 2, 6, 4] },
    lastK: { rounds: 3.45 },   // October ran 1.5 rounds a task
    dims: {
      project: [['billing-api', 15, 11, 20, 22, 2, 1, 8], ['web-app', 21, 14, 24, 29, 3, 2, 8], ['worca-cc', 16, 12, 26, 26, 4, 0, 10], ['docs-site', 1, 1, 1, 1, 0, 0, 1]],
    },
  });
  const fails = source({
    fields: ['count', 'spend'],
    series: { count: [0, 1, 0, 1, 1, 0, 2, 1], spend: [0, 6, 0, 7, 5, 0, 12, 3] }, before: { count: [1, 0, 1, 1, 0, 0, 1, 1], spend: [5, 0, 4, 6, 0, 0, 7, 5] },
    dims: {
      stage: [['Plan', 1, 6], ['Build', 3, 17], ['Review', 1, 6], ['PR', 1, 4]],
      reason: [['Tests failing', 2, 13], ['Stopped by you', 2, 8], ['Timed out', 1, 9], ['Merge conflict', 1, 3]],
      project: [['web-app', 2, 13], ['billing-api', 2, 12], ['worca-cc', 2, 8]],
      model: [['Sonnet 5.5', 3, 18], ['Opus 5.5', 2, 11], ['Haiku 5', 1, 4]],
    },
  });
  const alone = source({
    fields: ['alone', 'tasks'],
    series: { alone: [4, 6, 1, 6, 4, 1, 6, 4], tasks: [5, 8, 2, 9, 7, 1, 11, 6] }, before: { alone: [2, 3, 2, 4, 3, 1, 5, 3], tasks: [3, 5, 3, 6, 5, 2, 7, 5] },
    dims: {
      project: [['billing-api', 10], ['web-app', 8], ['worca-cc', 13], ['docs-site', 1]],
      workflow: [['Default', 19, 29], ['Full', 6, 11], ['Quick Fix', 7, 9]],
      away: [['At the desk', 18, 33], ['Away', 14, 16]],
    },
  });
  const cache = source({
    fields: ['read', 'input'],
    series: { read: [14, 23, 8, 28, 21, 3, 35, 23], input: [23, 38, 14, 45, 34, 6, 57, 37] }, before: { read: [9, 15, 10, 18, 14, 5, 23, 16], input: [18, 28, 19, 32, 25, 9, 41, 30] },
    dims: {
      model: [['Opus 5.5', 88, 132], ['Sonnet 5.5', 56, 98], ['Haiku 5', 11, 24]],
      project: [['billing-api', 72, 118], ['web-app', 49, 82], ['worca-cc', 26, 41], ['docs-site', 8, 13]],
      stage: [['Plan', 18, 31], ['Build', 84, 141], ['Review', 37, 57], ['PR', 16, 25]],
    },
  });
  const prs = source({
    fields: ['prs', 'days'],
    series: { prs: [2, 4, 1, 5, 3, 0, 7, 5], days: [40, 88, 22, 105, 62, 0, 150, 100] }, before: { prs: [2, 3, 1, 4, 3, 1, 4, 3], days: [50, 72, 28, 100, 75, 30, 92, 68] },
    dims: {
      project: [['billing-api', 12, 252], ['web-app', 9, 189], ['worca-cc', 5, 110], ['docs-site', 1, 16]],
      workflow: [['Default', 16, 322], ['Full', 6, 165], ['Quick Fix', 5, 80]],
    },
  });
  const done = source({
    fields: ['finished'],
    series: { finished: [5, 7, 2, 8, 6, 1, 9, 5] }, before: { finished: [3, 4, 3, 5, 4, 2, 6, 4] },
    dims: { project: [['billing-api', 10], ['web-app', 12], ['worca-cc', 20], ['docs-site', 1]], workflow: [['Default', 26], ['Full', 9], ['Quick Fix', 8]] },
  });
  const waits = source({
    fields: ['waits', 'mins'],
    series: { waits: [3, 5, 2, 6, 4, 0, 7, 4], mins: [42, 105, 30, 126, 66, 0, 133, 56] }, before: { waits: [2, 4, 2, 5, 3, 1, 5, 3], mins: [50, 96, 44, 130, 75, 20, 120, 65] },
    dims: {
      stage: [['Plan', 9, 180], ['Build', 5, 60], ['Review', 12, 228], ['PR', 5, 90]],
      project: [['billing-api', 13, 252], ['web-app', 10, 170], ['worca-cc', 6, 106], ['docs-site', 2, 30]],
      away: [['At the desk', 20, 220], ['Away', 11, 338]],
    },
  });
  const team = source({
    fields: ['spend', 'hours', 'saved', 'tasks'],
    series: { spend: [240, 410, 180, 520, 390, 60, 610, 450] }, before: { spend: [200, 340, 160, 440, 340, 60, 500, 360] },
    dims: {
      person: [['Maya', 920, 108, 2808, 102], ['Jonas', 780, 88, 2288, 81], ['Priya', 510, 59, 1534, 56], ['Emil', 412, 47, 1233, 49], ['Lee', 238, 28, 717, 17]],
      project: [['billing-api', 1240, 143, 3720, 132], ['web-app', 980, 113, 2940, 105], ['worca-cc', 640, 74, 1920, 68]],
      client: [['acme', 1460, 168, 4380, 156], ['No client', 790, 91, 2370, 84], ['globex', 610, 71, 1830, 65]],
    },
  });
  const untagged = source({
    fields: ['tasks', 'spend'],
    series: { tasks: [2, 3, 1, 3, 2, 0, 4, 3], spend: [13, 26, 8, 30, 18, 3, 31, 19] }, before: { tasks: [2, 2, 2, 3, 2, 1, 3, 2], spend: [11, 15, 14, 19, 15, 5, 21, 16] },
    dims: {
      project: [['web-app', 7, 58], ['billing-api', 6, 51], ['worca-cc', 4, 31], ['docs-site', 1, 8]],
      workflow: [['Default', 11, 92], ['Full', 4, 34], ['Quick Fix', 3, 22]],
      label: [['no label', 12, 99], ['billing', 4, 33], ['hotfix', 2, 16]],
    },
  });

  // what a round back costs and what Opus would change on web-app: "Review sent it back" over the rounds past each task's first
  const webApp = review.rows.project.find((r) => r.name === 'web-app'), webBack = webApp.rounds - webApp.tasks;
  const roundBack = waste.rows.why.find((r) => r.name === 'Review sent it back').spend / (sum(review.series.rounds) - sum(review.series.tasks));
  const OPUS_MORE = 1.9;   // what each of web-app's Builds would cost more, at Opus 5.5's prices
  const webSaved = (webBack / webApp.tasks) * roundBack - OPUS_MORE, noOwner = money.rows.client.find((r) => r.name === 'No client');
  const STANDS = {
    why: { outcome: `on Opus 5.5 would save about ${usd2(webSaved)} a task, ${usd2(webSaved * webApp.tasks)} over its ${webApp.tasks} tasks this month.`, because: `Review sends web-app's code back more than any other project's, on Sonnet 5.5. Opus 5.5 costs about ${usd2(OPUS_MORE)} more a task and saves about one round every two tasks, at about ${usd2(roundBack)} a round.` },
    review: `takes the most, ${(webApp.rounds / webApp.tasks).toFixed(1)} rounds a task: ${webBack} rounds back over its ${webApp.tasks} tasks, ${(webBack / webApp.tasks).toFixed(1)} back per task, about ${usd(webBack * roundBack)} this month. ${pct(webApp.first / webApp.tasks)} pass the first time.`,
  };

  // ---- the periods of the time word ----
  const NOV = ['Nov 1', 'Nov 2', 'Nov 3', 'Nov 4', 'Nov 5', 'Nov 6', 'Nov 7', 'Nov 8'];
  const SPAN = { today: [7, 7], 'this week': [1, 7], 'this month': [0, 7] };
  const WEEKS = { labels: ['Oct 1-7', 'Oct 8-14', 'Oct 15-21', 'Oct 22-28', 'Oct 29-31'], days: [7, 7, 7, 7, 3], w: [18, 24, 20, 22, 16] };
  const MONTHS = { labels: ['Jul', 'Aug', 'Sep', 'Oct', 'Nov'], days: [31, 31, 30, 31, 8], k: [1.6, 2.2, 2.8, 3.2] };
  const WHEN = ['today', 'this week', 'this month', 'last month', 'all time'];
  function periodSeries(src, f, when) {
    const now = src.series[f], before = src.before[f], total = sum(now);
    if (SPAN[when]) { const [a, b] = SPAN[when]; return { labels: NOV.slice(a, b + 1), days: NOV.slice(a, b + 1).map(() => 1), now: now.slice(a, b + 1), before: before.slice(a, b + 1) }; }
    if (when === 'last month') return { ...WEEKS, now: allocate(WEEKS.w, Math.round(total * (src.lastK[f] ?? 3.2))), before: allocate(WEEKS.w, Math.round(total * 3.2 * 0.85)) };
    return { ...MONTHS, now: [...MONTHS.k.map((k, i) => Math.round(total * (i === 3 && src.lastK[f] || k))), total], before: null };
  }
  function filterShare(src, filter, f) {
    const by = {};
    for (const key of filter) { const at = key.indexOf(':'); (by[key.slice(0, at)] ||= []).push(key.slice(at + 1)); }
    let share = 1;
    for (const [dim, names] of Object.entries(by)) { const rows = src.rows[dim]; if (!rows) continue; const all = sum(rows.map((r) => r[f])); share *= all ? sum(rows.filter((r) => names.includes(r.name)).map((r) => r[f])) / all : 0; }
    return share;
  }
  function baseSpend(st) {   // AI spend for the same stretch and filter: what a waste row's share is of
    const s = periodSeries(money, 'spend', st.when), [a, b] = st.narrow || [0, s.now.length - 1];
    return Math.round(sum(s.now.slice(a, b + 1)) * filterShare(money, st.filter, 'spend'));
  }

  // ---- the sub-features ----
  const moneyCols = (mid = ['Cost per hour saved', (r) => (r.hours ? usd2(r.spend / r.hours) : '-')]) => [['AI spend', (r) => usd(r.spend)], ['Hours saved', (r) => `${r.hours} h`], ['Saved', (r) => usd(r.saved)], mid, ['Tasks', (r) => String(r.tasks)]];
  const wasteCols = [['AI spend', (r) => usd(r.spend)], ['Tasks affected', (r) => String(r.tasks)]];
  const SUM = ['bars', 'lines', 'running', 'table'], COUNT = ['bars', 'lines', 'table'], RATE = ['bars', 'lines', 'table'];
  const cmp = (c, sub, w = 'in the period before') => {
    if (c.p == null || !isFinite(c.p)) return '';
    const up = c.v > c.p, near = !c.p || Math.abs(c.v - c.p) / c.p < 0.03;
    if (near) return `About the same as ${sub.text(c.p)} ${w}`;
    return sub.den ? `${up ? 'Up' : 'Down'} from ${sub.text(c.p)} ${w}` : `${up ? 'Up' : 'Down'} ${Math.abs(Math.round(((c.v - c.p) / c.p) * 100))}% from ${sub.text(c.p)} ${w}`;
  };
  const SUBS = [
    { id: 'spend', title: 'Spend', group: 'Cost', icon: 'set-spending', noun: 'AI spend', src: money, num: 'spend', text: usd, forms: SUM, budget: 1000, cols: moneyCols(), share: 'spend',
      word: (c) => `${usd(c.v)} of $1,000`, why: (c) => (c.st.by === 'client' ? `${usd(noOwner.spend)} has no client` : `Saved about ${usd(c.T.saved)}, 3× what it cost · on pace for $1,545 · ${usd(noOwner.spend)} has no owner`) },
    { id: 'per-task', title: 'Per task', group: 'Cost', icon: 'dollar', noun: 'cost a task', src: money, num: 'spend', den: 'tasks', text: usd2, forms: RATE, cols: moneyCols(['Per task', (r) => (r.tasks ? usd2(r.spend / r.tasks) : '-')]), share: 'spend',
      word: (c) => `${usd2(c.v)} a task`, why: (c) => `${usd(c.T.spend)} across ${c.T.tasks} tasks` },
    { id: 'why', title: 'Why it cost', group: 'Cost', icon: 'refresh', noun: 'rework and waste', src: waste, by: 'why', num: 'spend', text: usd, forms: SUM, cols: wasteCols, share: 'base',
      wordAlways: (c) => `${usd(c.v)} of ${usd(c.base)} went on rework and waste`, whyAlways: (c) => (c.P && c.st.against === 'before' ? `${pct(c.v / c.base)}, up from ${pct(c.P.spend / c.pbase)} ${c.whole && c.st.when === 'this month' ? 'last month' : 'in the period before'}` : pct(c.v / c.base)) },
    { id: 'budget', title: 'Budget', group: 'Cost', icon: 'set-limits', noun: 'budget used', src: money, num: 'spend', text: usd, forms: SUM, as: 'running', against: 'budget', budget: 1000, cols: moneyCols(), share: 'spend',
      word: (c) => `${Math.round((c.v / 1000) * 100)}% of $1,000 used`, why: (c) => `${usd(c.v)} so far · on pace for $1,545, $545 over · 8 of 30 days gone` },
    { id: 'time-saved', title: 'Time saved', group: 'Value', icon: 'hourglass', noun: 'money saved', src: money, num: 'saved', text: usd, forms: SUM, cols: moneyCols(), share: 'saved',
      word: (c) => `${usd(c.v)} saved`, why: (c) => `About ${c.T.hours} hours of work` },
    { id: 'value', title: 'Value for spend', group: 'Value', icon: 'sparkle', noun: 'saved for each dollar', src: money, num: 'saved', den: 'spend', text: (n) => `${n.toFixed(1)}×`, forms: RATE, cols: moneyCols(), share: 'spend',
      word: (c) => `${c.v.toFixed(1)}× what it cost`, why: (c) => `${usd(c.T.saved)} saved on ${usd(c.T.spend)} · ${usd2(c.T.spend / c.T.hours)} for each hour saved` },
    { id: 'ends', title: 'How tasks end', group: 'Quality', icon: 'check', noun: 'finished tasks', src: ends, num: 'finished', text: (n) => plural(n, 'task'), forms: COUNT, share: 'finished', shareLabel: 'Share of finished',
      cols: [['Ended', (r) => String(r.finished + r.failed + r.stopped)], ['Finished', (r) => String(r.finished)], ['Failed', (r) => String(r.failed)], ['Stopped', (r) => String(r.stopped)]],
      word: (c) => `${c.T.finished} of ${c.T.finished + c.T.failed + c.T.stopped} finished`, why: (c) => `${c.T.failed} failed, ${c.T.stopped} stopped · ${pct(c.T.finished / (c.T.finished + c.T.failed + c.T.stopped))} finish` },
    { id: 'review', title: 'Review', group: 'Quality', icon: 'edit', noun: 'rounds a task', src: review, note: "A round is one review and its fixes; a round back is any after a task's first", num: 'rounds', den: 'tasks', text: (n) => `${n.toFixed(1)} rounds`, forms: RATE, share: 'reviews', noShare: true,
      cols: [['Rounds a task', (r) => (r.tasks ? (r.rounds / r.tasks).toFixed(1) : '-')], ['First-time pass', (r) => (r.tasks ? pct(r.first / r.tasks) : '-')], ['Raised', (r) => String(r.fixed + r.disputed + r.open)], ['Fixed', (r) => String(r.fixed)], ['You rejected', (r) => String(r.disputed)], ['Open', (r) => String(r.open)]],
      word: (c) => `${c.T.rounds} rounds over ${c.T.tasks} reviewed tasks, ${c.v.toFixed(1)} a task`, why: (c) => { const back = c.T.rounds - c.T.tasks; return `${back} rounds back, about ${usd(back * roundBack)}`; } },
    { id: 'fails', title: 'Where it fails', group: 'Quality', icon: 'alert', noun: 'tasks that did not finish', src: fails, by: 'stage', num: 'count', text: (n) => plural(n, 'task'), forms: COUNT, share: 'count',
      cols: [['Did not finish', (r) => String(r.count)], ['AI spend', (r) => usd(r.spend)]],
      word: (c) => `${c.T.count} tasks did not finish, ${usd(c.T.spend)}`, why: (c) => `Most at Build: 3 of ${c.T.count}` },
    { id: 'autonomy', title: 'Autonomy', group: 'Quality', icon: 'away', noun: 'tasks that ran without you', src: alone, num: 'alone', den: 'tasks', text: pct, forms: RATE, share: 'alone', shareLabel: 'Share of without you',
      cols: [['Tasks', (r) => String(r.tasks)], ['Without you', (r) => String(r.alone)], ['Asked you', (r) => String(r.tasks - r.alone)], ['Rate', (r) => (r.tasks ? pct(r.alone / r.tasks) : '-')]],
      word: (c) => `${c.T.alone} of ${c.T.tasks} ran without you`, why: (c) => `${pct(c.v)} of tasks` },
    { id: 'cache', title: 'Cache', group: 'Quality', icon: 'set-memory', noun: 'input from the cache', src: cache, by: 'model', num: 'read', den: 'input', text: pct, forms: RATE, share: 'read',
      cols: [['From the cache', (r) => `${(r.read / 10).toFixed(1)}M`], ['All input', (r) => `${(r.input / 10).toFixed(1)}M`], ['Rate', (r) => (r.input ? pct(r.read / r.input) : '-')]],
      word: (c) => `${pct(c.v)} of input from the cache`, why: (c) => `${(c.T.read / 10).toFixed(1)}M of ${(c.T.input / 10).toFixed(1)}M tokens` },
    { id: 'shipped', title: 'Shipped', group: 'Flow', icon: 'merge', noun: 'PRs merged', src: prs, num: 'prs', text: (n) => plural(n, 'PR'), forms: COUNT, share: 'prs',
      cols: [['PRs merged', (r) => String(r.prs)], ['Days each', (r) => (r.prs ? (r.days / r.prs / 10).toFixed(1) : '-')]],
      word: (c) => `${c.T.prs} PRs merged`, why: (c) => '6 in review, 3 need attention' },
    { id: 'merge', title: 'Start to merge', group: 'Flow', icon: 'after', noun: 'days to merge', src: prs, num: 'days', den: 'prs', text: (n) => `${(n / 10).toFixed(1)} days`, forms: RATE, share: 'prs',
      cols: [['PRs merged', (r) => String(r.prs)], ['Days each', (r) => (r.prs ? (r.days / r.prs / 10).toFixed(1) : '-')]],
      word: (c) => `${(c.v / 10).toFixed(1)} days from start to merge`, why: (c) => `Over ${c.T.prs} PRs merged` },
    { id: 'throughput', title: 'Throughput', group: 'Flow', icon: 'track', noun: 'tasks finished', src: done, num: 'finished', text: (n) => plural(n, 'task'), forms: COUNT, share: 'finished',
      cols: [['Finished', (r) => String(r.finished)], ['A day', (r, c) => (r.finished / c.days).toFixed(1)]],
      word: (c) => `${(c.v / c.days).toFixed(1)} tasks finished a day`, why: (c) => `${c.v} in ${c.days} days` },
    { id: 'waiting', title: 'Waiting on you', group: 'Flow', icon: 'question', noun: 'minutes a question', src: waits, by: 'stage', num: 'mins', den: 'waits', text: (n) => `${Math.round(n)} min`, forms: RATE, share: 'mins',
      cols: [['Times', (r) => String(r.waits)], ['Waited', (r) => `${Math.floor(r.mins / 60)} h ${r.mins % 60} min`], ['Each', (r) => (r.waits ? `${Math.round(r.mins / r.waits)} min` : '-')]],
      word: (c) => `${Math.round(c.v)} min a question`, why: (c) => `${c.T.waits} times, ${Math.floor(c.T.mins / 60)} h ${c.T.mins % 60} min in all` },
    { id: 'team', title: 'By person', group: 'Team', team: true, icon: 'nav-team-metrics', noun: 'team spend', src: team, by: 'person', num: 'spend', text: usd, forms: SUM, budget: 12000, cols: moneyCols(), share: 'spend',
      word: (c) => `${usd(c.v)} of $12,000`, why: () => 'Five people · on pace for $10,725 · pooled budget at 24%' },
    { id: 'untagged', title: 'Missing cost tags', group: 'Team', team: true, count: 18, icon: 'tag', noun: 'tasks without a client', src: untagged, num: 'tasks', text: (n) => plural(n, 'task'), forms: COUNT, share: 'tasks',
      cols: [['Without a client', (r) => String(r.tasks)], ['AI spend', (r) => usd(r.spend)]],
      word: (c) => `${c.T.tasks} tasks without a client`, why: (c) => `${usd(c.T.spend)} not counted to anyone` },
  ];
  const SUB = Object.fromEntries(SUBS.map((s) => [s.id, s]));

  // ---- what a page shows ----
  const dimsOf = (src, st) => Object.keys(DIM).filter((d) => src.rows[d] || d === 'day' || ((d === 'week' || d === 'month') && (st.when === 'this month' || st.when === 'this week')));
  const defaults = (sub) => ({ by: sub.by || 'project', then: '', as: sub.as || 'bars', against: sub.against || 'none', when: 'this month', filter: [], narrow: null });
  const dayRows = (c) => c.labels.map((name, i) => ({ name, ...Object.fromEntries(c.src.fields.map((f) => [f, c.F[f][i]])) }));
  function baseRows(c, dim) {
    if (dim === 'day') return dayRows(c);
    if (dim === 'month') return [{ name: c.st.when === 'this month' || c.st.when === 'this week' ? 'November' : c.timeWord, ...c.T }];
    if (dim === 'week') { const days = dayRows(c), first = days.filter((d) => d.name === 'Nov 1'), rest = days.filter((d) => d.name !== 'Nov 1'), total = (name, l) => ({ name, ...Object.fromEntries(c.src.fields.map((f) => [f, sum(l.map((d) => d[f]))])) }); return [...(first.length ? [total('Week of Oct 26', first)] : []), ...(rest.length ? [total('Week of Nov 2', rest)] : [])]; }
    const ticked = c.st.filter.filter((k) => k.startsWith(`${dim}:`)).map((k) => k.slice(dim.length + 1));
    let rows = c.src.rows[dim] || [];
    if (ticked.length) rows = rows.filter((r) => ticked.includes(r.name));
    if (dim === 'origin' && c.st.filter.length) rows = rows.filter((r) => r.name !== 'Chat' && r.name !== 'Requirements');
    return rows;
  }
  function cut(base, totals, fields) {
    const out = base.map((r) => ({ name: r.name }));
    for (const f of fields) allocate(base.map((r) => r[f]), totals[f]).forEach((v, i) => { out[i][f] = v; });
    return out;
  }
  function topFive(rows, fields) {
    if (rows.length <= 6) return rows;
    const rest = rows.slice(5), other = { name: 'Other', other: rest.length };
    for (const f of fields) other[f] = sum(rest.map((r) => r[f]));
    return [...rows.slice(0, 5), other];
  }
  // the stretch a row carries to Tasks, when it is not the plain month: a drag, or another period (RailRunsList.filter's range)
  const MON = { Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11 };
  const edge = (label, end) => { const [m, d] = label.split(' '), days = d ? d.split('-') : ['1', '31']; return MON[m] * 100 + +(end ? days[days.length - 1] : days[0]); };
  const rangeOf = (labels) => ({ from: edge(labels[0]), to: edge(labels[labels.length - 1], true), label: rangeWord(labels) });
  const rangeIn = (labels, st) => (st.narrow || !['this month', 'all time'].includes(st.when) ? rangeOf(labels) : null);
  // the Tasks list's own date of a row (runs-list.js dateKey, which that file keeps private)
  const WEEKDAY = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 }, MONTH_NO = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const dateKey = (t) => { if (t.day === 'today') return 1108; if (t.day === 'yesterday') return 1107; if (t.day === 'upcoming') return 0; const w = (t.run || t.group).time || '', m = /^([A-Z][a-z]{2}) (\d+)$/.exec(w); return WEEKDAY[w] ? 1100 + WEEKDAY[w] : m ? MONTH_NO[m[1]] * 100 + +m[2] : 0; };
  // a row's number of tasks is what its click opens: the rows of the Tasks list itself. A workspace is the projects its row stands for.
  const WS_OF = { 'web-shop': ['billing-api', 'web-app'], internal: ['worca-cc', 'docs-site'] };
  function listCount(dim, name, range) {
    const L = window.RailRunsList?.rows(); if (!L) return null;
    const names = dim === 'workspace' ? WS_OF[name] || [] : [name];
    return L.filter((t) => names.includes(t.project) && (!range || (dateKey(t) >= range.from && dateKey(t) <= range.to))).length;
  }
  // each row's part of each day, cut once over the whole period: a day's split stays the same however the chart is narrowed
  function dayCutOf(sub, st) {
    const c = compute(sub, { ...st, narrow: null }, true, true), names = c.rows.map((r) => r.name);
    let left = c.rows.map((r) => r[sub.num]);
    const perDay = c.F[sub.num].map((total) => { const got = allocate(left, total); left = left.map((v, k) => v - got[k]); return got; });
    return { names, perDay, days: c.F[sub.num] };
  }
  function compute(sub, st, all = false, whole0 = false) {
    const src = sub.src, fields = src.fields, first = periodSeries(src, fields[0], st.when), n = first.labels.length, [a, b] = st.narrow || [0, n - 1];
    const c = { sub, st, src, labels: first.labels.slice(a, b + 1), days: sum(first.days.slice(a, b + 1)), F: {}, B: first.before ? {} : null, T: {}, P: first.before ? {} : null, whole: !st.narrow };
    for (const f of fields) {
      const s = periodSeries(src, f, st.when), share = filterShare(src, st.filter, f), now = s.now.slice(a, b + 1);
      c.T[f] = Math.round(sum(now) * share); c.F[f] = allocate(now, c.T[f]);
      if (c.B) { const was = s.before.slice(a, b + 1); c.P[f] = Math.round(sum(was) * share); c.B[f] = allocate(was, c.P[f]); }
    }
    const counted = src === money || src === alone, range = rangeIn(c.labels, st);
    if (counted && st.when === 'this month' && !st.narrow && !st.filter.length && window.RailRunsList) {   // the plain month: the headline is the list too
      c.T.tasks = sum(src.rows.project.map((r) => listCount('project', r.name, null))); c.F.tasks = allocate(periodSeries(src, 'tasks', st.when).now, c.T.tasks);
    }
    const splits = !whole0 && !sub.den && !TIME.has(st.by) && !!src.rows[st.by];
    if (splits) {
      const cutAll = dayCutOf(sub, st), perDay = cutAll.perDay.slice(a, b + 1);
      c.dayCut = { names: cutAll.names, perDay };
      if (st.narrow) { c.F[sub.num] = cutAll.days.slice(a, b + 1); c.T[sub.num] = sum(c.F[sub.num]); }
    }
    const val = (A, i) => (sub.den ? (A[sub.den][i] ? A[sub.num][i] / A[sub.den][i] : null) : A[sub.num][i]);
    c.points = c.labels.map((_, i) => val(c.F, i));
    c.before = c.B ? c.labels.map((_, i) => val(c.B, i)) : null;
    const whole = (T) => (sub.den ? (T[sub.den] ? T[sub.num] / T[sub.den] : 0) : T[sub.num]);
    c.v = whole(c.T); c.p = c.P ? whole(c.P) : null;
    c.base = baseSpend(st);
    if (c.P) { const s = periodSeries(money, 'spend', st.when), was = s.before.slice(a, b + 1); c.pbase = Math.round(sum(was) * filterShare(money, st.filter, 'spend')); }
    c.timeWord = st.narrow ? rangeWord(c.labels) : st.when;
    const ordered = ORDERED.has(st.by), rowField = sub.share === 'base' ? 'spend' : sub.share;
    const sort = (rows, dim) => (ORDERED.has(dim) ? rows : [...rows].sort((x, y) => y[rowField] - x[rowField]));
    let rows = cut(baseRows(c, st.by), c.T, fields);
    if (c.dayCut && st.narrow) rows.forEach((r) => { const k = c.dayCut.names.indexOf(r.name); if (k >= 0) r[sub.num] = sum(c.dayCut.perDay.map((d) => d[k])); });
    if (counted && ['project', 'workspace'].includes(st.by)) rows.forEach((r) => { const n = listCount(st.by, r.name, range); if (n == null) return; r.tasks = n; if (r.alone > n) r.alone = n; });
    rows = sort(rows, st.by);
    c.rowCount = rows.length;
    if (!all && !ordered) rows = topFive(rows, fields);
    const whole100 = sub.share === 'base' ? (c.base ? Math.round((c.T.spend / c.base) * 100) : 0) : 100;
    allocate(rows.map((r) => r[rowField]), whole100).forEach((v, i) => { rows[i].sharePct = v; });
    const baseTotal = sub.share === 'base' ? c.base : c.T[rowField];
    if (st.then) for (const r of rows) {
      let kids = sort(cut(baseRows(c, st.then), r, fields), st.then);
      if (!all && !ORDERED.has(st.then)) kids = topFive(kids, fields);
      r.kids = kids; for (const k of kids) k.sharePct = baseTotal ? Math.round((k[rowField] / baseTotal) * 100) : 0;
    }
    c.rows = rows;
    return c;
  }
  function rangeWord(labels) {
    const a = labels[0], b = labels[labels.length - 1];
    if (a === b) return a;
    const [ma, da] = a.split(' '), [mb, db] = b.split(' ');
    return ma === mb && da && db && !/-/.test(da + db) ? `${ma} ${da}-${db}` : `${a} to ${b}`;
  }
  window.RailInsightsModel = { rangeOf, rangeIn, STANDS, SUBS, SUB, DIM, DIM_GROUPS, TIME, FILTERS, WHEN, usd, cmp, compute, defaults, dimsOf, allocate, sum, rangeWord };
})();
