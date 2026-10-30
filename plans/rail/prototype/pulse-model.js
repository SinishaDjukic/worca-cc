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
    { id: 'usage', name: 'Usage and spend', level: 'problems', where: 'both', events: [
      ['usage.near', 'Near the warning line', 'problem'], ['usage.reached', 'Limit reached', 'problem'], ['usage.reset', 'Limit reset', 'info'],
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

  const PROVIDER = {
    claude: { name: 'Claude', harness: 'Claude Code' },
    openai: { name: 'OpenAI', harness: 'Codex' },
    gemini: { name: 'Gemini', harness: 'Gemini CLI' },
  };
  const WIN = { session: 'Session', week: 'Week', day: 'Day' };

  const run = (title, project, detail, time) => ({ title, project, detail, time });
  const CASES = [
    { id: 'afternoon', label: 'A busy afternoon', desktop: 'on',
      needs: [run('Add CSV export to billing', 'billing-api', 'Plan asks 2 questions', '14:32'), run('Migrate cron parser', 'worca-cc', 'Gate: approve the plan', '13:40')],
      running: [run('Fix flaky login test', 'web-app', 'Build · step 3 of 5', '12 min'), run('Rename settings keys', 'worca-cc', 'Review · checks running', '4 min')],
      scheduled: [run('Nightly dependency bump', 'web-app', 'Every day at 03:00', '03:00')],
      usage: [
        { p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: 48, resets: '16:40' }, { k: 'week', pct: 31, resets: 'Mon 09:00' }] },
        { p: 'openai', plan: 'Plus', asOf: '13:52', win: [{ k: 'session', pct: 12, resets: '15:10' }, { k: 'week', pct: 40, resets: 'Sun 22:00' }] }],
      budget: { spent: 42, limit: 100 },
      updates: [
        { id: 'u1', g: 'runs', sev: 'needs', open: true, title: 'Needs you · Add CSV export to billing', meta: 'billing-api · Plan asks 2 questions', time: '14:32', day: 'Today', unread: true, to: 'the run page at its questions' },
        { id: 'u2', g: 'runs', sev: 'problem', title: 'Run failed · Update Node to 24', meta: 'web-app · Test step · 3 tests failed', time: '13:58', day: 'Today', unread: true, to: 'the run page, on the step that stopped' },
        { id: 'u3', g: 'prs', sev: 'info', title: 'Fix published · #962 Retry on 502', meta: 'web-app · watched PR · checks green', time: '13:10', day: 'Today', unread: true, to: 'the fix run' },
        { id: 'u4', g: 'schedules', sev: 'problem', title: 'Start missed · Nightly dependency bump', meta: 'web-app · Worca was not running at 03:00', time: '09:02', day: 'Today', unread: true, to: 'Schedules, with its sheet open' },
        { id: 'u5', g: 'runs', sev: 'info', title: 'Run finished · Tidy the settings page', meta: 'worca-cc · 18 min · $1.42', time: '08:40', day: 'Today', unread: false, to: 'the run page' },
        { id: 'u6', g: 'usage', sev: 'info', title: 'Claude session reset · 1 run resumed', meta: 'Claude · Max · Session', time: '17:05', day: 'Yesterday', unread: false, to: 'the resumed run' },
        { id: 'u7', g: 'runs', sev: 'needs', resolved: true, title: 'Needs you · Split the auth module', meta: 'worca-cc · answered at 11:20', time: '11:02', day: 'Yesterday', unread: false, to: 'the run page' },
        { id: 'u8', g: 'projects', sev: 'info', title: 'Clone finished · acme/design-tokens', meta: 'Projects · 2.1 MB', time: '10:15', day: 'Yesterday', unread: false, to: 'the project page' }] },
    { id: 'near', label: 'Session near its limit', desktop: 'on',
      needs: [],
      running: [run('Fix flaky login test', 'web-app', 'Build · step 3 of 5', '12 min')],
      scheduled: [],
      usage: [
        { p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: 86, resets: '16:40' }, { k: 'week', pct: 52, resets: 'Mon 09:00' }] },
        { p: 'openai', plan: 'Plus', asOf: '12:10', win: [{ k: 'session', pct: 20, resets: '15:10' }, { k: 'week', pct: 44, resets: 'Sun 22:00' }] }],
      budget: null,
      updates: [
        { id: 'n1', g: 'usage', sev: 'problem', title: 'Claude session at 80% · resets 16:40', meta: 'Claude · Max · runs may pause before it resets', time: '14:20', day: 'Today', unread: true, to: 'the usage card' },
        { id: 'n2', g: 'runs', sev: 'info', title: 'Run finished · Tidy the settings page', meta: 'worca-cc · 18 min · $1.42', time: '13:40', day: 'Today', unread: true, to: 'the run page' },
        { id: 'n3', g: 'prs', sev: 'info', title: 'Fix started · #962 Retry on 502', meta: 'web-app · watched PR · 2 checks failing', time: '11:30', day: 'Today', unread: false, to: 'the fix run' }] },
    { id: 'reached', label: 'Weekly limit reached', desktop: 'on',
      needs: [],
      running: [run('Rename settings keys', 'worca-cc', 'Review · checks running', '4 min')],
      scheduled: [run('Nightly dependency bump', 'web-app', 'Every day at 03:00', '03:00')],
      usage: [
        { p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: 30, resets: '16:40' }, { k: 'week', pct: 61, resets: 'Mon 09:00' }] },
        { p: 'openai', plan: 'Plus', asOf: '11:05', win: [{ k: 'session', pct: 64, resets: '15:10' }, { k: 'week', pct: 100, resets: 'Mon 09:00' }], paused: 2 }],
      budget: null,
      updates: [
        { id: 'r1', g: 'usage', sev: 'problem', title: 'OpenAI weekly limit reached · 2 runs paused', meta: 'OpenAI · Plus · they resume by themselves Mon 09:05', time: '11:05', day: 'Today', unread: true, to: 'Runs, filtered to the paused runs' },
        { id: 'r2', g: 'runs', sev: 'problem', title: 'Run failed · Update Node to 24', meta: 'web-app · Test step · 3 tests failed', time: '09:58', day: 'Today', unread: true, to: 'the run page, on the step that stopped' },
        { id: 'r3', g: 'usage', sev: 'problem', title: 'OpenAI week at 80% · resets Mon 09:00', meta: 'OpenAI · Plus', time: '16:12', day: 'Yesterday', unread: false, to: 'the usage card' }] },
    { id: 'budget', label: 'Spend near its budget', desktop: 'off',
      needs: [run('Add CSV export to billing', 'billing-api', 'Cost cap reached at $5.00', '10:12')],
      running: [],
      scheduled: [],
      usage: [{ p: 'claude', plan: 'API key', asOf: '10:12', win: [] }],
      budget: { spent: 92, limit: 100 },
      updates: [
        { id: 'b1', g: 'runs', sev: 'needs', open: true, title: 'Cost cap reached · Add CSV export to billing', meta: 'billing-api · paused at $5.00 · raise the cap or stop', time: '10:12', day: 'Today', unread: true, to: 'the run page at its cost cap' },
        { id: 'b2', g: 'usage', sev: 'problem', title: 'Spend at 80% of $100 this month', meta: 'Budget · $80.40 of $100', time: '09:30', day: 'Today', unread: true, to: 'Costs' }] },
    { id: 'gemini', label: 'Gemini only', desktop: 'on',
      needs: [],
      running: [run('Write the API reference', 'docs-site', 'Build · step 2 of 4', '7 min')],
      scheduled: [],
      usage: [{ p: 'gemini', plan: 'Free', asOf: '14:02', win: [{ k: 'day', pct: 84, used: 840, of: 1000, resets: '02:00' }] }],
      budget: null,
      updates: [
        { id: 'g1', g: 'usage', sev: 'problem', title: 'Gemini daily requests at 80% · resets 02:00', meta: 'Gemini · Free · 800 of 1,000 requests', time: '13:44', day: 'Today', unread: true, to: 'the usage card' }] },
    { id: 'quiet', label: 'All quiet', desktop: 'blocked',
      needs: [], running: [], scheduled: [],
      usage: [{ p: 'claude', plan: 'Pro', asOf: '09:15', win: [{ k: 'session', pct: 5, resets: '13:30' }, { k: 'week', pct: 12, resets: 'Thu 08:00' }] }],
      budget: null,
      updates: [
        { id: 'q1', g: 'runs', sev: 'info', title: 'Run finished · Tidy the settings page', meta: 'worca-cc · 18 min · $1.42', time: '09:15', day: 'Today', unread: false, to: 'the run page' }] },
  ];

  // The tone of a share: '' under the warning line, warn at or over it, over when used up.
  const tone = (pct, warnAt) => (pct >= 100 ? 'over' : pct >= warnAt ? 'warn' : '');
  const winWord = (k) => WIN[k];

  // The avatar's rings, outside in: Session, Week (Gemini's Day sits here), Spend when a budget is set. Each shows
  // its tightest provider; a ring no provider in use reports is not drawn.
  function rings(c, warnAt) {
    const out = [];
    for (const slot of [['session', ['session']], ['week', ['week', 'day']]]) {
      let best = null;
      for (const u of c.usage) for (const w of u.win) if (slot[1].includes(w.k) && (!best || w.pct > best.pct)) best = { ...w, p: u.p };
      if (best) out.push({ slot: slot[0], pct: best.pct, tone: tone(best.pct, warnAt),
        line: `${winWord(best.k)} ${best.pct}% · ${PROVIDER[best.p].name} · ${best.pct >= 100 ? 'reached, resets' : 'resets'} ${best.resets}` });
    }
    if (c.budget) {
      const pct = Math.round((c.budget.spent / c.budget.limit) * 100);
      out.push({ slot: 'spend', pct, tone: tone(pct, warnAt), line: `Spend $${c.budget.spent} of $${c.budget.limit} this month` });
    }
    return out;
  }

  // Limits in Now: each window at or over the warning line, and the budget. It is a state: it goes when the window resets.
  function limits(c, warnAt) {
    const out = [];
    for (const u of c.usage) for (const w of u.win) {
      if (w.pct < warnAt) continue;
      const name = PROVIDER[u.p].name;
      const what = w.k === 'day' ? 'daily requests' : w.k === 'week' ? 'weekly limit' : 'session';
      out.push(w.pct >= 100
        ? { tone: 'over', title: `${name} ${what} reached`, detail: `${u.paused || 0} runs paused · they resume by themselves after it resets`, time: w.resets, tip: `Resets ${w.resets}` }
        : { tone: 'warn', title: `${name} ${what} at ${w.pct}%`, detail: `Resets ${w.resets} · runs on ${name} may pause before then`, time: w.resets, tip: `Resets ${w.resets}` });
    }
    if (c.budget) {
      const pct = Math.round((c.budget.spent / c.budget.limit) * 100);
      if (pct >= warnAt) out.push({ tone: pct >= 100 ? 'over' : 'warn', title: `Spend at ${pct}% of $${c.budget.limit}`, detail: 'This month · runs stop at the budget', time: 'Nov 1', tip: 'The budget resets on 1 November' });
    }
    return out;
  }

  window.PulseModel = { GROUPS, LEVELS, WHERE, PROVIDER, CASES, qualifies, tone, rings, limits, winWord };
})();
