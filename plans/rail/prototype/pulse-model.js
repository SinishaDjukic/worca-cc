// Pulse mock: the cases, the event catalogue by group, and the pure figures the renderer paints (pulse.js).
// Spec: plans/rail/pulse.md. Now is a state, Updates is an event; usage is read per provider and window.
(function () {
  // The groups, in Settings order. Each event has a severity: needs (waiting for a person), problem, info.
  const GROUPS = [
    { id: 'runs', name: 'Runs', level: 'problems', where: 'both', events: [
      ['run.needs_you', 'Needs you', 'needs'], ['run.cost_cap', 'Cost cap reached', 'needs'], ['run.failed', 'Run failed', 'problem'],
      ['run.paused', 'Run paused', 'problem'], ['run.done', 'Run finished', 'info'], ['run.resumed', 'Resumed after a limit', 'info']] },
    { id: 'schedules', name: 'Schedules', level: 'problems', where: 'both', events: [
      ['schedule.missed', 'Start missed or late', 'problem'], ['schedule.skipped', 'Start skipped', 'problem'],
      ['schedule.self_paused', 'Series paused itself', 'problem'], ['schedule.ended', 'Series ended', 'info'], ['schedule.completed', 'Scheduled run finished', 'info']] },
    { id: 'prs', name: 'Pull requests', level: 'needs', where: 'both', events: [
      ['pr.needs_person', 'Watched PR needs a person', 'needs'], ['pr.fix_started', 'Fix started', 'info'], ['pr.published', 'Fix published', 'info']] },
    { id: 'usage', name: 'Usage', level: 'problems', where: 'both', events: [
      ['usage.near', 'Near the warning line', 'problem'], ['usage.reached', 'Limit reached', 'problem'], ['usage.reset', 'Limit reset', 'info'],
      ['usage.moved', 'Start moved to a harness with room', 'info'], ['usage.held', 'Start held until a reset', 'problem'],
      ['budget.threshold', 'Spend near its budget', 'problem'], ['budget.exceeded', 'Budget used up', 'problem']] },
    { id: 'away', name: 'Away mode', level: 'all', where: 'chat', events: [
      ['away.started', 'Away hours started', 'info'], ['away.ended', 'Away hours ended', 'info']] },
    { id: 'projects', name: 'Projects', level: 'problems', where: 'pulse', events: [
      ['project.clone_failed', 'Clone failed', 'problem'], ['project.clone_done', 'Clone finished', 'info'],
      ['project.sync_failed', 'Sync failed', 'problem'], ['project.sync_behind', 'Behind its remote', 'info']] },
  ];
  const LEVELS = [
    { id: 'needs', text: 'needs you', help: 'Only what waits for you: questions, gates, a watched PR that needs a person' },
    { id: 'problems', text: 'needs you and problems', help: 'Also what went wrong while nobody was waiting: a failed run, a missed start, a limit' },
    { id: 'all', text: 'everything', help: 'Also what simply happened: a run finished, a fix was published, a limit reset' },
  ];
  const WHERE = [
    { id: 'pulse', text: 'Pulse only', help: 'Kept in Pulse; nothing leaves Worca' },
    { id: 'desktop', text: 'desktop', help: 'Also a desktop notification, in browsers that allow it' },
    { id: 'chat', text: 'chat', help: 'Also a message to your chat channels (Telegram, Slack)' },
    { id: 'both', text: 'desktop and chat', help: 'Also a desktop notification and a chat message' },
  ];
  const RANK = { needs: 0, problem: 1, info: 2 };
  const LEVEL_MAX = { needs: 0, problems: 1, all: 2 };
  const qualifies = (level, sev) => RANK[sev] <= LEVEL_MAX[level];

  // Anything a run can spend against: a harness's own sign-in (Claude Code, Codex, Copilot, Cursor) or a provider
  // through the bridge (Gemini, OpenRouter's free models). `runs`: it can be picked as where a run runs.
  // `src`: who reports the figures. Windows: a short one (session) and a long one (week, day or month). A plan may have
  // only the long one: Claude's Ultra (was Max 20x) has no 5-hour session once the account is verified (30 Oct 2026);
  // its week stays.
  const PROVIDER = {
    claude: { name: 'Claude Code', vendor: 'Claude', runs: true, src: 'Reported by Claude Code' },
    codex: { name: 'Codex', vendor: 'OpenAI', runs: true, src: 'Reported by Codex' },
    copilot: { name: 'Copilot', vendor: 'GitHub', runs: true, src: 'Premium requests Worca counted this month' },
    gemini: { name: 'Gemini', vendor: 'Google, through Claude Code', runs: true, src: 'Requests Worca counted today' },
    openrouter: { name: 'OpenRouter', vendor: 'free models', runs: false, src: 'Free requests Worca counted today' },
  };
  const WIN = { session: 'Session', week: 'Week', day: 'Day', month: 'Month' };
  const LONG = ['week', 'day', 'month'];
  const WHAT = { day: 'daily requests', week: 'weekly limit', month: 'monthly requests', session: 'session' };

  // What a run uses of each window, per harness and Shaper's size: the median of done runs with the same agents and size
  // in the last 60 days (estimate.mjs, read against the harness's usage before and after each run). `N`: how many runs
  // it comes from. A harness with no history has no estimate, and the warning line decides alone.
  const SIZES = ['small', 'medium', 'large'];
  const EST = {
    claude: { small: { session: 4, week: 1 }, medium: { session: 12, week: 3 }, large: { session: 28, week: 7 } },
    codex: { small: { session: 3, week: 1 }, medium: { session: 10, week: 3 }, large: { session: 24, week: 6 } },
    copilot: { small: { month: 1 }, medium: { month: 3 }, large: { month: 8 } },
    gemini: { small: { day: 2 }, medium: { day: 6 }, large: { day: 15 } },
  };
  const N = { small: 21, medium: 12, large: 5 };

  const run = (title, project, detail, time) => ({ title, project, detail, time });
  const CASES = [
    { id: 'afternoon', label: 'A busy afternoon', desktop: 'on', task: { title: 'Add rate limiting to the public API', size: 'medium' },
      needs: [run('Add CSV export to billing', 'billing-api', 'Plan asks 2 questions', '14:32'), run('Migrate cron parser', 'worca-cc', 'Gate: approve the plan', '13:40')],
      running: [run('Fix flaky login test', 'web-app', 'Build · step 3 of 5', '12 min'), run('Rename settings keys', 'worca-cc', 'Review · checks running', '4 min')],
      scheduled: [run('Nightly dependency bump', 'web-app', 'Every day at 03:00', '03:00')],
      usage: [
        { p: 'claude', plan: 'Ultra', asOf: '14:28', win: [{ k: 'week', pct: 31, resets: 'Mon 09:00' }],
          note: { text: 'No session limit on Ultra', tip: 'Anthropic removed the 5-hour session from verified Ultra accounts on 30 Oct 2026; the weekly limit stays' } },
        { p: 'codex', plan: 'Plus', asOf: '13:52', win: [{ k: 'session', pct: 12, resets: '15:10' }, { k: 'week', pct: 40, resets: 'Sun 22:00' }] },
        { p: 'copilot', plan: 'Business', asOf: '14:05', win: [{ k: 'month', pct: 71, used: 212, of: 300, resets: 'Nov 1' }] },
        { p: 'openrouter', plan: 'Free', asOf: '13:30', win: [{ k: 'day', pct: 64, used: 32, of: 50, resets: '02:00' }] }],
      budget: { period: 'this week', spent: 1225.97, saved: 69306.73 },
      updates: [
        { id: 'u1', g: 'runs', sev: 'needs', open: true, title: 'Needs you · Add CSV export to billing', meta: 'billing-api · Plan asks 2 questions', time: '14:32', day: 'Today', unread: true, to: 'the run page at its questions' },
        { id: 'u2', g: 'runs', sev: 'problem', title: 'Run failed · Update Node to 24', meta: 'web-app · Test step · 3 tests failed', time: '13:58', day: 'Today', unread: true, to: 'the run page, on the step that stopped' },
        { id: 'u3', g: 'prs', sev: 'info', title: 'Fix published · #962 Retry on 502', meta: 'web-app · watched PR · checks green', time: '13:10', day: 'Today', unread: true, to: 'the fix run' },
        { id: 'u4', g: 'schedules', sev: 'problem', title: 'Start missed · Nightly dependency bump', meta: 'web-app · Worca was not running at 03:00', time: '09:02', day: 'Today', unread: true, to: 'Schedules, with its sheet open' },
        { id: 'u5', g: 'runs', sev: 'info', title: 'Run finished · Tidy the settings page', meta: 'worca-cc · 18 min · $1.42', time: '08:40', day: 'Today', unread: false, to: 'the run page' },
        { id: 'u6', g: 'usage', sev: 'info', title: 'Codex session reset · 1 run resumed', meta: 'OpenAI · Plus · Session', time: '17:05', day: 'Yesterday', unread: false, to: 'the resumed run' },
        { id: 'u7', g: 'runs', sev: 'needs', resolved: true, title: 'Needs you · Split the auth module', meta: 'worca-cc · answered at 11:20', time: '11:02', day: 'Yesterday', unread: false, to: 'the run page' },
        { id: 'u8', g: 'projects', sev: 'info', title: 'Clone finished · acme/design-tokens', meta: 'Projects · 2.1 MB', time: '10:15', day: 'Yesterday', unread: false, to: 'the project page' }] },
    { id: 'near', label: 'Session near its limit', desktop: 'on', task: { title: 'Add rate limiting to the public API', size: 'large' },
      needs: [],
      running: [run('Fix flaky login test', 'web-app', 'Build · step 3 of 5 · Claude Code', '12 min'), run('Rate limiting · slice 2 of 4', 'web-app', 'Build · Codex · moved from Claude Code at the start', '6 min')],
      // Worca starts these with nobody there to ask: each is checked against its own estimate when its turn comes.
      scheduled: [{ title: 'Rate limiting · slice 3 of 4', project: 'web-app', slice: true, on: 'claude', size: 'large', time: 'next' },
        { title: 'Rename the config flag', project: 'worca-cc', queued: true, on: 'claude', size: 'small', time: 'next' }],
      usage: [
        { p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: 86, resets: '16:40' }, { k: 'week', pct: 52, resets: 'Mon 09:00' }] },
        { p: 'codex', plan: 'Plus', asOf: '14:24', win: [{ k: 'session', pct: 20, resets: '15:10' }, { k: 'week', pct: 44, resets: 'Sun 22:00' }] }],
      budget: { period: 'this week', spent: 312.4, saved: 9120.55 },
      updates: [
        { id: 'n0', g: 'usage', sev: 'info', title: 'Slice 2 of 4 moved to Codex · Rate limiting', meta: 'web-app · Claude Code\'s session was at 84% · the slice keeps Codex to the end', time: '14:24', day: 'Today', unread: true, to: 'the slice\'s run page' },
        { id: 'n1', g: 'usage', sev: 'problem', title: 'Claude Code session at 80% · resets 16:40', meta: 'Claude · Max · runs on it may pause before it resets', time: '14:20', day: 'Today', unread: true, to: 'the usage card' },
        { id: 'n2', g: 'runs', sev: 'info', title: 'Run finished · Tidy the settings page', meta: 'worca-cc · 18 min · $1.42', time: '13:40', day: 'Today', unread: true, to: 'the run page' },
        { id: 'n3', g: 'prs', sev: 'info', title: 'Fix started · #962 Retry on 502', meta: 'web-app · watched PR · 2 checks failing', time: '11:30', day: 'Today', unread: false, to: 'the fix run' }] },
    { id: 'reached', label: 'Weekly limit reached', desktop: 'on', task: { title: 'Add rate limiting to the public API', size: 'medium' },
      needs: [],
      running: [run('Rename settings keys', 'worca-cc', 'Review · checks running', '4 min')],
      scheduled: [run('Nightly dependency bump', 'web-app', 'Every day at 03:00', '03:00')],
      usage: [
        { p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: 30, resets: '16:40' }, { k: 'week', pct: 61, resets: 'Mon 09:00' }] },
        { p: 'codex', plan: 'Plus', asOf: '11:05', win: [{ k: 'session', pct: 64, resets: '15:10' }, { k: 'week', pct: 100, resets: 'Mon 09:00' }], paused: 2 }],
      budget: { period: 'this week', spent: 488.1, saved: 15402.2 },
      updates: [
        { id: 'r1', g: 'usage', sev: 'problem', title: 'Codex weekly limit reached · 2 runs paused', meta: 'OpenAI · Plus · they resume by themselves Mon 09:05', time: '11:05', day: 'Today', unread: true, to: 'Runs, filtered to the paused runs' },
        { id: 'r2', g: 'runs', sev: 'problem', title: 'Run failed · Update Node to 24', meta: 'web-app · Test step · 3 tests failed', time: '09:58', day: 'Today', unread: true, to: 'the run page, on the step that stopped' },
        { id: 'r3', g: 'usage', sev: 'problem', title: 'Codex week at 80% · resets Mon 09:00', meta: 'OpenAI · Plus', time: '16:12', day: 'Yesterday', unread: false, to: 'the usage card' }] },
    { id: 'budget', label: 'Spend near its budget', desktop: 'off', task: { title: 'Add rate limiting to the public API', size: 'medium' },
      needs: [run('Add CSV export to billing', 'billing-api', 'Cost cap reached at $5.00', '10:12')],
      running: [],
      scheduled: [],
      usage: [{ p: 'claude', plan: 'API key', asOf: '10:12', win: [] }],
      budget: { period: 'in October', spent: 92, limit: 100 },
      updates: [
        { id: 'b1', g: 'runs', sev: 'needs', open: true, title: 'Cost cap reached · Add CSV export to billing', meta: 'billing-api · paused at $5.00 · raise the cap or stop', time: '10:12', day: 'Today', unread: true, to: 'the run page at its cost cap' },
        { id: 'b2', g: 'usage', sev: 'problem', title: 'Spend at 80% of $100 in October', meta: 'Budget · $80.40 of $100', time: '09:30', day: 'Today', unread: true, to: 'Costs' }] },
    { id: 'gemini', label: 'Gemini only', desktop: 'on', task: { title: 'Write the API reference for v2', size: 'large' },
      needs: [],
      running: [run('Write the API reference', 'docs-site', 'Build · step 2 of 4', '7 min')],
      scheduled: [],
      usage: [{ p: 'gemini', plan: 'Free tier', asOf: '14:02', win: [{ k: 'day', pct: 84, used: 840, of: 1000, resets: '02:00' }] }],
      budget: null,
      updates: [
        { id: 'g1', g: 'usage', sev: 'problem', title: 'Gemini daily requests at 80% · resets 02:00', meta: 'Gemini · Free · 800 of 1,000 requests', time: '13:44', day: 'Today', unread: true, to: 'the usage card' }] },
    { id: 'quiet', label: 'All quiet', desktop: 'blocked', task: { title: 'Add rate limiting to the public API', size: 'small' },
      needs: [], running: [], scheduled: [],
      usage: [{ p: 'claude', plan: 'Pro', asOf: '09:15', win: [{ k: 'session', pct: 5, resets: '13:30' }, { k: 'week', pct: 12, resets: 'Thu 08:00' }] }],
      budget: { period: 'this week', spent: 18.2, saved: 402.1 },
      updates: [
        { id: 'q1', g: 'runs', sev: 'info', title: 'Run finished · Tidy the settings page', meta: 'worca-cc · 18 min · $1.42', time: '09:15', day: 'Today', unread: false, to: 'the run page' }] },
  ];

  // The tone of a share: '' under the warning line, warn at or over it, over when used up.
  const tone = (pct, warnAt) => (pct >= 100 ? 'over' : pct >= warnAt ? 'warn' : '');
  const winWord = (k) => WIN[k];

  const usd = (n) => '$' + n.toLocaleString('en', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const spendPct = (b) => (b && b.limit ? Math.round((b.spent / b.limit) * 100) : null);
  // A window in words: "86%", or the count where the provider counts requests ("212 of 300").
  const fig = (w) => (w.of ? `${w.used.toLocaleString('en')} of ${w.of.toLocaleString('en')}` : `${w.pct}%`);

  // The avatar's rings, outside in: Session, then the long window (a week; a day or a month where that is the only
  // one), then Spend when a budget has a limit. Each shows its tightest provider; a ring nobody reports is not drawn.
  function rings(c, warnAt) {
    const out = [];
    for (const [slot, kinds] of [['session', ['session']], ['long', LONG]]) {
      let best = null;
      for (const u of c.usage) for (const w of u.win) if (kinds.includes(w.k) && (!best || w.pct > best.pct)) best = { ...w, p: u.p };
      if (best) out.push({ slot, pct: best.pct, tone: tone(best.pct, warnAt),
        line: `${winWord(best.k)} ${best.pct}% · ${PROVIDER[best.p].name} · ${best.pct >= 100 ? 'reached, resets' : 'resets'} ${best.resets}` });
    }
    const sp = spendPct(c.budget);
    if (sp != null) out.push({ slot: 'spend', pct: sp, tone: tone(sp, warnAt), line: `Spend ${usd(c.budget.spent)} of ${usd(c.budget.limit)} ${c.budget.period}` });
    return out;
  }

  // Limits in Now: each window at or over the warning line, and the budget. It is a state: it goes when the window resets.
  function limits(c, warnAt) {
    const out = [];
    for (const u of c.usage) for (const w of u.win) {
      if (w.pct < warnAt) continue;
      const name = PROVIDER[u.p].name;
      const what = { day: 'daily requests', week: 'weekly limit', month: 'monthly requests', session: 'session' }[w.k];
      out.push(w.pct >= 100
        ? { p: u.p, tone: 'over', title: `${name} ${what} reached`, detail: `${u.paused || 0} runs paused · they resume by themselves after it resets`, time: w.resets, tip: `Resets ${w.resets}` }
        : { p: u.p, tone: 'warn', title: `${name} ${what} at ${w.pct}%`, detail: `Resets ${w.resets} · runs on ${name} may pause before then`, time: w.resets, tip: `Resets ${w.resets}` });
    }
    const sp = spendPct(c.budget);
    if (sp != null && sp >= warnAt) out.push({ tone: sp >= 100 ? 'over' : 'warn', title: `Spend at ${sp}% of ${usd(c.budget.limit)}`, detail: `${c.budget.period[0].toUpperCase() + c.budget.period.slice(1)} · runs stop at the budget`, time: 'Nov 1', tip: 'The budget resets on 1 November' });
    return out;
  }

  // What a run of this size uses of each window on a harness, or null when it has no history.
  const est = (p, size) => (size && EST[p] && EST[p][size]) || null;
  // The window a start on this harness would run into, or null. With an estimate: one whose use plus the run's share is
  // over 100%, so a small run near a limit still starts. With none: one at or over the warning line.
  function near(c, p, warnAt, size) {
    const u = c.usage.find((x) => x.p === p); if (!u) return null;
    const e = est(p, size);
    const hit = u.win.map((w) => ({ ...w, need: e && e[w.k] != null ? e[w.k] : null }))
      .filter((w) => (w.need != null ? w.pct + w.need > 100 : w.pct >= warnAt))
      .sort((a, b) => b.pct + (b.need || 0) - (a.pct + (a.need || 0)))[0];
    return hit ? { ...hit, p, name: PROVIDER[p].name, what: WHAT[hit.k], left: Math.max(0, 100 - hit.pct) } : null;
  }
  // The harnesses with room: set up, able to run the run, and the run fits (or, with no estimate, every window under the
  // warning line); the most room first.
  function room(c, warnAt, except, size) {
    return c.usage.filter((u) => u.p !== except && PROVIDER[u.p].runs && u.win.length && !near(c, u.p, warnAt, size))
      .sort((a, b) => Math.max(...a.win.map((w) => w.pct)) - Math.max(...b.win.map((w) => w.pct))).map((u) => u.p);
  }

  window.PulseModel = { GROUPS, LEVELS, WHERE, PROVIDER, CASES, SIZES, N, WHAT, qualifies, tone, rings, limits, near, room, est, winWord, fig, usd, spendPct };
})();
