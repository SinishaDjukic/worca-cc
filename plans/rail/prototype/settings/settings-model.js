// Settings' content for the prototype, built strictly from the design system (docs/rail/settings.md and
// › A settings tab; drawn by settings.js). From the app's Settings (ui/public/settings/settings.html and the views it
// mounts), its Team policy page and its Add-ons pages; Notifications is Pulse's (pulse-model.js).
//   - A decision is a row: its name, its state in words (pickers where it changes), its Switch or button. The
//     fine-tuning folds under Customise (`more`, `moreList`). Everything takes effect at once; no Save anywhere.
//   - A record (a preset, a label, a model, a plugin) is a ListRow in a List (`list`): the row opens the thing, its own
//     actions in its ⋯ (`menu`).
//   - Change… opens a Dialog with Fields (`edit`). A reset of many rows sits in its section's head and confirms.
//   - Names follow Small rules › Names: the thing, 1–3 words, one thing one name. Theme, Interface mode and going away
//     live in the profile menu only.
// A row: { name, help, min, flag, when(sv), chip, say: 'words, {key} where a picker or a value sits, **strong**, `code`',
//   picks: { key: { value, options: [[id, text, help]], tip, right } }, vals: { key: string | (sv) => string },
//   sw: { key | flag, on, why, locked }, acts: [action], more: [rows], moreList: [records] }.
// An action: { label, help, min, when(sv), off(sv) → why, read, go | edit | confirm | copy | do(sv) | page | click | say }.
// A record: { title, meta, live(sv), detail, mark, fig, chip, sw, when(sv), menu: [labels] | (rec, sv) → labels,
//   on: { label: (rec, x) → toast }, open: (rec, x) → toast }; Rename, Duplicate, Edit, Delete, Remove, Revoke, Uninstall
//   and Reject are shared (settings.js). `x` is { sv, remove, add, dialog, confirm, go, page, click }.
// A Dialog: { title, yes, note, facts, rows, fields, check(vals), then(vals, sv) → toast, done, view, steps: [{ label, … }] }.
// A section: { title, meta, min, flag, actions: [action], rows, list, table }. `min` is a level; `flag` a Labs flag that
// gates the thing too, on a section or a row.
// Loaded by the gates with an empty `window`: nothing here touches the library until it is called.
(function () {
  const O = (...xs) => xs.map((x) => (Array.isArray(x) ? x : [x, x]));
  const P = (value, options, tip, right) => ({ value, options, tip, right });
  const EFFORT = O('medium', 'high', 'xhigh', 'max');
  const MODEL = O(['sonnet', 'Sonnet 5.5'], ['opus', 'Opus 5.5'], ['haiku', 'Haiku 5.5'], ['fable', 'Fable 5.1']);
  const edit = (title, fields, o = {}) => ({ label: 'Change…', edit: { title, fields, yes: 'Save', ...o } });
  const ENGINES = O(['claude', 'Claude'], ['codex', 'Codex (beta)'], ['copilot', 'Copilot (beta)'], ['cursor', 'Cursor (beta)'], ['gemini', 'Gemini CLI (beta)'], ['goose', 'Goose (beta)'], ['opencode', 'OpenCode (beta)'], ['qwen', 'Qwen Code (beta)']);
  const usd = (v) => (v === '' || v == null ? 'no limit' : '$' + Number(v).toLocaleString('en-US'));
  const opens = (where) => ({ label: 'Open', say: `Opens ${where} in a new tab` });
  const GIT_TIP = 'Needs git: this row is hidden when the machine has no git';

  // ---- Labs: the registry's flags (src/shared/flags/registry.mjs), but its Flags demo ----
  const FLAGS = [
    { key: 'commandSummaries', name: 'Command summaries', stage: 'Beta', on: true, say: 'Commands in Chat show as one line saying what they do', why: 'Adds Chat › Summaries' },
    { key: 'runLabels', name: 'Run labels', stage: 'Experimental', on: false, say: 'Free-word labels on runs, with a Label filter on the Runs list', why: 'Adds Settings › Labels and labels on runs' },
    { key: 'smartRunNaming', name: 'Smart run naming', stage: 'Experimental', on: false, say: 'A quick model suggests the run title and a branch name as you type', why: 'Adds Runs › Naming' },
    { key: 'requirements', name: 'Requirements', stage: 'Experimental', on: false, say: 'Turn an idea into a testable spec through a short interview, before any run', why: 'Adds Requirements to the sidebar' },
    { key: 'runTelemetry', name: 'Run telemetry', stage: 'Experimental', on: false, say: 'Runs record context size, tokens and timing of every model call', locked: 'Locked by WORCA_FLAGS' },
    { key: 'gitAutomations', name: 'Git event automations', stage: 'Experimental', on: false, say: 'Start a workflow when an issue or a pull request is opened', why: 'Adds Settings › Automations' },
    { key: 'sessionGroups', name: 'One session', stage: 'Experimental', on: false, say: 'Run 2–4 steps in a row as one session' },
    { key: 'ticketUpdates', name: 'Ticket updates', stage: 'Experimental', on: false, say: 'A finished run moves its ticket, by a rule per tracker project', why: 'Adds Plugins › Ticket updates' },
    { key: 'shapeRequirements', name: 'Requirements first', stage: 'Experimental', on: false, say: 'A medium or large Shaper task agrees keyed requirements before the plan' },
  ];
  const flagsChanged = () => FLAGS.filter((f) => !f.locked && window.RailUI.prefs.flag(f.key) !== f.on);

  // ---- values that are not a row's own ----
  const STATE = { ver: '1.19.0', latest: '1.19.0', upd: 'latest', updTried: false, gsShown: false, proxyLogin: true, claudeIn: true, chats: 38, worktrees: 12, attach: '140 MB',
    jobsAll: false, stepsAll: false, seeded: false, speechModels: true, gemQuota: '', gemUsed: 840, perRun: '', total: '1000', period: 'month', orLeft: 820 };
  const NOTES = [note('architecture.md', 'How the server and the UI are split · today · from Chat'), note('conventions.md', 'Naming, commits and tests · 2 Oct · from run #398')];
  const COST_TAGS = [
    { title: 'Cost centre', meta: 'R&D, Platform, Support · required', menu: ['Edit', 'Remove'] },
    { title: 'Customer', meta: 'Any value · optional', menu: ['Edit', 'Remove'] },
  ];

  // ---- General › About: what `Check now`, `Update` and `Choose version…` do ----
  const cmd = (sv) => `npm install -g @worca/app@${sv.upd === 'failed' || sv.upd === 'available' ? sv.latest : sv.ver}`;
  const updWords = (sv) => ({ latest: 'Latest', available: `Update available: ${sv.latest}`, failed: `Update available: ${sv.latest}`, back: `Back on an older version; ${sv.latest} is the latest` }[sv.upd]);
  const outdated = (sv) => sv.upd === 'available' || sv.upd === 'failed' || sv.upd === 'back';
  const canUpdate = (sv) => sv.upd === 'available' || sv.upd === 'back';
  const VERSIONS = O(['1.20.0', '1.20.0, the latest'], ['1.19.0', '1.19.0'], ['1.18.2', '1.18.2'], ['1.17.0', '1.17.0']);

  // ---- General › Setup assistant: one Dialog, one step per screen (docs/rail/forms.md). No workspace walkthrough. ----
  const setup = () => ({ title: 'Setup assistant', yes: 'Apply',
    steps: [
      { label: 'Check', note: 'What Worca found on this machine.', facts: [
        { title: 'Claude Code', meta: 'Installed, signed in', mark: 'is-green' },
        { title: 'Git', meta: 'Installed', mark: 'is-green' },
        { title: 'Projects', meta: '6 under ~/src', mark: 'is-green' },
        { title: 'Copilot', meta: 'Not signed in: optional', mark: 'is-amber' },
      ] },
      { label: 'Network', note: 'How Worca reaches the model providers.', fields: [
        { key: 'saNet', label: 'Connection', value: 'direct', options: O(['direct', 'Direct'], ['proxy', 'Through a corporate proxy']) },
        { key: 'saHost', label: 'Proxy host', value: 'proxy.corp.example', when: (v) => v.saNet === 'proxy' },
        { key: 'saPort', label: 'Proxy port', value: '8080', when: (v) => v.saNet === 'proxy' },
        { key: 'saTest', button: 'Test', when: (v) => v.saNet === 'proxy', do: (v) => `Reached ${v.saHost}:${v.saPort}` },
      ] },
      { label: 'Access', note: 'The accounts Worca may run models through.', fields: [
        { key: 'saClaude', check: true, label: 'Claude Code sign-in', value: true },
        { key: 'saCopilot', check: true, label: 'GitHub Copilot', value: false },
      ] },
      { label: 'Models', note: 'Who does which kind of work.', fields: [
        { key: 'saRoles', label: 'Model roles', value: 'rec', options: O(['rec', 'Recommended: Opus plans, Sonnet codes, Haiku helps'], ['cheap', 'Cheaper: Sonnet plans, Haiku helps too'], ['keep', 'Keep what is set']) },
      ] },
      { label: 'Limits', note: 'What runs may spend. Empty means no limit.',
        check: (v) => (/^\d*$/.test(v.saRun) && /^\d*$/.test(v.saTotal) ? '' : 'A limit is a whole number of dollars'),
        fields: [{ key: 'saRun', label: 'Per run (USD)', value: '', placeholder: 'No limit' }, { key: 'saTotal', label: 'Total a month (USD)', value: '1000', placeholder: 'No limit' }] },
      { label: 'Review', note: 'Nothing changes until you press Apply.', facts: (v) => [
        { title: 'Network', meta: v.saNet === 'proxy' ? `Through ${v.saHost}:${v.saPort}` : 'Direct' },
        { title: 'Access', meta: [v.saClaude && 'Claude Code', v.saCopilot && 'Copilot'].filter(Boolean).join(', ') || 'None' },
        { title: 'Roles', meta: { rec: 'Recommended', cheap: 'Cheaper', keep: 'As they are' }[v.saRoles] },
        { title: 'Limits', meta: `Each run ${usd(v.saRun)}, all runs ${usd(v.saTotal)} a month` },
      ] },
    ],
    then: (v, sv) => {
      sv.proxy = v.saNet === 'proxy'; if (sv.proxy) { sv.proxyHost = v.saHost; sv.proxyPort = v.saPort; }
      sv.perRun = v.saRun; sv.total = v.saTotal; sv.period = 'month';
      return 'Setup applied';
    } });

  // ---- Models: per engine; each job's factory default says (default) ----
  const ROLES = [['deep', 'Deep thinking', 'Plans and reviews'], ['every', 'Everyday coding', 'Writes the code and answers in Chat'], ['quick', 'Quick jobs', 'Short, frequent helper calls']];
  const ENGINE_MODELS = {
    claude: [MODEL, EFFORT, { deep: 'opus', every: 'sonnet', quick: 'haiku' }],
    codex: [O(['gpt-5', 'gpt-5'], ['gpt-5-mini', 'gpt-5-mini']), O('minimal', 'low', 'medium', 'high'), { deep: 'gpt-5', every: 'gpt-5', quick: 'gpt-5-mini' }],
    copilot: [O(['gpt-5', 'gpt-5'], ['sonnet-5', 'Sonnet 5 (Copilot)']), O('low', 'medium', 'high'), {}],
    cursor: [O(['auto', 'Auto'], ['sonnet-5', 'Sonnet 5 (Cursor)']), null, {}],
    gemini: [O(['gemini-pro', 'Gemini Pro'], ['gemini-flash', 'Gemini Flash']), O('low', 'medium', 'high'), {}],
    goose: [O(['goose-default', 'Goose default']), O('low', 'medium', 'high', 'max'), {}],
    opencode: [O(['local-llama', 'local-llama']), O('minimal', 'low', 'medium', 'high', 'max'), {}],
    qwen: [O(['qwen-max', 'Qwen Max']), O('low', 'medium', 'high', 'xhigh', 'max'), {}],
  };
  const NONE = ['', "each job's own default"];
  const roleKey = (e, r, what) => `role_${e}_${r}_${what}`;
  const roleRows = (e) => ROLES.map(([r, name, help]) => {
    const [models, efforts, set] = ENGINE_MODELS[e];
    return { name, help, say: efforts ? `{${roleKey(e, r, 'm')}} at {${roleKey(e, r, 'e')}} effort` : `{${roleKey(e, r, 'm')}}`,
      picks: { [roleKey(e, r, 'm')]: P(set[r] || '', [NONE, ...models], help), ...(efforts ? { [roleKey(e, r, 'e')]: P(efforts.some((x) => x[0] === 'medium') ? 'medium' : efforts[0][0], efforts, 'Its effort', true) } : {}) } };
  });
  const roleLive = (e) => (sv) => {
    const names = ROLES.map(([r, n]) => { const v = sv[roleKey(e, r, 'm')] ?? ENGINE_MODELS[e][2][r] ?? ''; return v ? `${n}: ${(ENGINE_MODELS[e][0].find((x) => x[0] === v) || [v, v])[1]}` : ''; }).filter(Boolean);
    return names.length ? names.join(' · ') : "No roles set: each job uses its own default";
  };
  const roleRecord = ([e, label]) => ({ title: label.replace(' (beta)', ''), meta: 'Deep thinking, Everyday coding, Quick jobs', live: roleLive(e),
    open: (r, x) => x.dialog({ title: `Roles on ${r.title}`, view: true, yes: 'Done', note: e === 'claude' || e === 'codex' ? 'Steps, Chat and helper jobs fall back to these. A team policy can also set them.' : 'Steps and Chat fall back to these. Helper jobs run on Claude or Codex.', rows: roleRows(e) }), menu: ['Clear'],
    on: { Clear: (r, x) => { ROLES.forEach(([k]) => { x.sv[roleKey(e, k, 'm')] = ''; }); return `Roles on ${r.title}: cleared`; } } });

  // A step or a helper job: a row that follows its role until it is overridden.
  const test = (r) => `One tiny prompt to ${r.model}: answered in 1.2s`;
  const slot = (title, role, o = {}) => ({ title, role, model: o.model || '', factory: o.factory || '', detail: o.detail || '', when: (sv, r) => r.model || sv[o.all || 'jobsAll'],
    live: (sv, r) => (r.model ? `${r.model}${r.factory && !r.own ? ' (default)' : ''}` : `Follows ${role}`) + (r.factory && !r.own && !sv.claudeIn ? ' · dropped: not signed in' : ''),
    menu: (r) => (r.model ? (r.own ? ['Test', 'Clear'] : ['Test', 'Override']) : ['Override']),
    on: {
      Test: (r, x) => (r.factory && !r.own && !x.sv.claudeIn ? `${r.title}: sign in to Claude Code or pick a model` : test(r)),
      Clear: (r) => { r.own = false; r.model = r.factory; return `${r.title}: follows ${r.factory ? 'its default' : role} again`; },
      Override: (r, x) => x.dialog({ title: `Override ${r.title}`, yes: 'Override', fields: [{ key: 'to', label: 'Model', value: 'Sonnet 5.5', options: MODEL.map(([, t]) => [t, t]) }], then: (v) => { r.model = v.to; r.own = true; return `${r.title}: ${v.to}`; } }),
    } });
  const HELPERS = [
    slot('Titles', 'Quick jobs', { detail: 'Writes the short title every run and chat gets.' }),
    slot('Auto workflow classifier', 'Everyday coding', { detail: 'Reads an Auto run\'s task and picks the workflow it runs.' }),
    slot('Run overview', 'Quick jobs', { detail: 'Writes the overview a finished run opens on.' }),
    slot('PR description', 'Quick jobs', { detail: 'Drafts the pull request description.' }),
    slot('Memory defragment', 'Quick jobs', { model: 'Sonnet 5', factory: 'Sonnet 5', detail: 'Runs Memory defragment, which restructures saved memory.' }),
    slot('Agent generation', 'Everyday coding', { detail: 'Drafts a new agent\'s prompt and metadata in Workflows › Agents.' }),
    slot('Run naming', 'Quick jobs', { detail: 'Suggests the title and branch name on New run.' }),
    slot('Command summaries', 'Quick jobs', { detail: 'Writes the one-line summary of a chat command.' }),
    slot('Workspace scan', 'Everyday coding', { detail: 'Runs the scan that maps how member projects connect.' }),
    slot('Requirements interview', 'Everyday coding', { detail: 'Runs the interview rounds on the Requirements page.' }),
    slot('Second-opinion reviewer', 'Deep thinking', { model: 'Opus 5.5 · medium', factory: 'Opus 5.5 · medium', detail: 'The one review that runs on another model than its step (Shaper\'s Product reviewer).' }),
  ];
  const STEPS = ['Plan', 'Plan review', 'Implement', 'Review', 'Fix'].map((t, i) => slot(t, i === 2 || i === 4 ? 'Everyday coding' : 'Deep thinking', { all: 'stepsAll' }));
  const shownOf = (list, sv, key) => (sv.__recs['models/Jobs/' + key] || list).filter((r) => r.model).length;

  // ---- Chat › Channels: a chat plugin's channel, with what stops it working ----
  const channel = (title, key, o) => ({ title, sw: { key, on: o.on }, meta: o.meta, chip: (sv) => o.state(sv), mark: o.mark, warned: !!o.warn,
    menu: (r) => (r.warned ? ['Test', 'Allow chat', 'Manage'] : ['Test', 'Manage']),
    on: {
      Test: (r) => (o.state() === 'Not set up' ? `Could not send: ${title} needs a bot token` : `Test sent to ${title}`),
      'Allow chat': (r, x) => x.dialog({ title: `Allow a chat on ${title}`, yes: 'Allow', fields: [{ key: 'chat', label: 'Chat id', value: o.chatId || '', hint: 'Replies like /approve from this chat count' }], then: (v) => { r.warned = false; r.mark = ''; r.meta = o.fixed; return `Chat ${v.chat} can answer on ${title}`; } }),
      Manage: (r, x) => x.go('plugins'),
    } });

  // ---- Plugins: the three trackers Ticket updates knows ----
  const TRACKERS = O(['jira', 'Jira'], ['azure', 'Azure Boards'], ['github', 'GitHub Issues']);
  const MOVES = window.RailUI?.TRACKER_MOVES || { jira: [] };   // the library's; the sweeps read this file for its section ids, without it
  const ruleWords = (m) => (m === 'none' ? 'Don\'t move' : m === 'done' ? 'Any Done status' : `Moves to ${m}`);
  const rule = (title, tracker, move, gone) => ({ title, tracker, move, when: (sv, r) => r.tracker === sv.tuTracker, mark: gone ? 'is-amber' : '',
    meta: gone ? `${title} has no status named ${gone} any more: pick another; until then a run leaves its tickets where they are` : ruleWords(move),
    menu: ['Change rule', 'Remove'],
    on: { 'Change rule': (r, x) => x.dialog({ title: `Rule for ${r.title}`, yes: 'Save', fields: [{ key: 'to', label: 'Move its ticket', value: r.move, options: [['none', 'Don\'t move'], ['done', 'Any Done status'], ...MOVES[r.tracker].map((m) => [m, m])] }], then: (v) => { r.move = v.to; r.meta = ruleWords(v.to); r.mark = ''; return `${r.title}: ${r.meta}`; } }) } });

  const plugin = (title, meta, key, on, o = {}) => ({ title, meta, sw: { key, on }, mark: o.mark, menu: o.menu || ['Settings', 'Uninstall'],
    on: {
      Settings: (r, x) => x.dialog({ title: `${title} settings`, fields: o.fields || [{ key: 'url', label: 'Address', value: o.url || '' }], done: `${title} saved` }),
      Update: (r) => { r.meta = meta.replace(' · 1 update', ''); r.mark = ''; r.menu = ['Settings', 'Uninstall']; return `${title} updated`; },
      'Set up…': (r, x) => x.dialog({ title: `Set up ${title}`, yes: 'Save', fields: [{ key: 'tok', label: 'Bot token', value: '', hint: 'Kept in a file only you can read' }], then: (v, sv) => { r.meta = 'A chat channel · bot token set'; r.menu = ['Settings', 'Uninstall']; sv[key] = true; return `${title} is set up`; } }),
    }, open: (r, x) => r.on[r.menu.includes('Set up…') ? 'Set up…' : 'Settings'](r, x) });

  // ---- Providers ----
  const orFree = (sv) => `OpenRouter · ${sv.orLeft} of 1,000 free requests left today · resets 00:00 UTC`;
  const OPENROUTER = { base: 'https://openrouter.ai/api/v1', key: '${OPENROUTER_KEY}' };

  const SECTIONS = {
    general: { title: 'General', meta: 'Setup, storage, and which version of Worca runs.', sections: [
      { title: 'Setup', rows: [
        { name: 'Setup assistant', say: 'Checks this machine, the network, model access and your limits', acts: [{ label: 'Run setup', edit: setup }] },
        { name: 'Getting started', say: 'The first nine things to do, and the guided tour{gsWords}', vals: { gsWords: (sv) => (sv.gsShown ? ': back in the sidebar' : '') }, acts: [{ label: 'Show again', off: (sv) => (sv.gsShown ? 'The checklist is already showing' : ''), do: (sv) => { sv.gsShown = true; return 'The Getting started checklist is back in the sidebar'; } }] },
      ] },
      { title: 'Storage', min: 'advanced', rows: [
        { name: 'Folders', say: 'Data lives in `{root}`; new projects go in `{projects}`', vals: { root: '~/.worca-cc', projects: '~/src' },
          acts: [edit('Change the folders', [{ key: 'root', label: 'Worca folder', hint: 'Does not move data: Worca starts fresh here, and the old folder stays as it was' }, { key: 'projects', label: 'Projects folder', hint: 'Its CLAUDE.md, skills and .mcp.json reach every agent' }], { done: 'Folders saved; new runs use them' })],
          more: [{ name: 'Defaults', say: 'Back to `~/.worca-cc` and `~/src`', acts: [{ label: 'Reset', do: (sv) => { sv.root = '~/.worca-cc'; sv.projects = '~/src'; return 'Folders: back to their defaults'; } }] }] },
        { name: 'Diagnostics', min: 'expert', say: 'Log each agent start in the run log: its binary, arguments and routing, never a credential. A set `WORCA_DEBUG_SPAWN` overrides this', sw: { key: 'spawnLog', on: false, why: 'Applies to runs started here and from the CLI, with no restart' } },
      ] },
      { title: 'Credentials', meta: 'Shown when Worca runs with your team\'s credential broker.', rows: [
        { name: 'Model keys', say: 'Claude and OpenAI keys come from **the broker**', acts: [{ label: 'Manage keys', say: 'Opens your team\'s key page in a new tab' }] },
        { name: 'GitHub', say: 'Signed in as **@emil-angelov**' },
      ] },
      { title: 'Browser extension', meta: 'Works with a local Worca only.', rows: [
        { name: 'Install', say: 'Add Worca to {browser}', picks: { browser: P('chrome', O(['chrome', 'Chrome'], ['edge', 'Edge'], ['firefox', 'Firefox']), 'Which browser to install it in') },
          acts: [{ label: 'Install', edit: (sv) => ({ title: `Install in ${{ chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' }[sv.browser]}`, view: true, yes: 'Close', note: 'Load the folder `~/.worca-cc/extension` in the browser\'s extensions page, or take the zip from the latest release. It pairs on first use.' }) }] },
      ], list: [
        { title: 'MacBook · Chrome', meta: 'Paired 2 Oct · last used today', menu: ['Revoke'] },
        { title: 'Work PC · Edge', meta: 'Paired 14 Sep · not used yet', menu: ['Revoke'] },
      ], empty: 'No browser paired' },
      { title: 'About', rows: [
        { name: 'Version', help: 'From a source checkout this says Source build and offers no Update', say: 'Worca **{verNow}** · {updNow}', vals: { verNow: (sv) => sv.ver, updNow: updWords },
          acts: [
            { label: 'Update', kind: '', when: canUpdate, do: (sv) => { if (!sv.updTried) { sv.updTried = true; sv.upd = 'failed'; return ''; } sv.ver = sv.latest; sv.upd = 'latest'; return `Worca ${sv.ver} is running`; } },
            { label: 'Check now', when: (sv) => sv.upd === 'latest', do: (sv) => { if (sv.ver === '1.20.0') return 'You have the latest version'; sv.latest = '1.20.0'; sv.upd = 'available'; return 'Worca 1.20.0 is available'; } },
          ],
          more: [
            { name: 'Other versions', say: 'Move to any released version, older ones too', acts: [{ label: 'Choose version…', edit: (sv) => ({ title: 'Choose a version', yes: 'Install it', fields: [{ key: 'to', label: 'Version', value: sv.ver, options: VERSIONS }], then: (v) => { if (v.to === sv.ver) return `Already on ${v.to}`; sv.latest = '1.20.0'; sv.ver = v.to; sv.upd = v.to === sv.latest ? 'latest' : 'back'; return `Worca ${v.to} is running`; } }) }] },
            { name: 'Updates', say: 'Look for new versions of Worca once a day', sw: { key: 'updates', on: true, why: 'Nothing installs by itself' } },
            { name: 'Release notes', say: '`docs.worca.dev/changelog`', acts: [opens('the changelog')] },
          ] },
        { name: 'Command', when: outdated, say: 'Or from a terminal: `{updCmd}`', vals: { updCmd: cmd }, acts: [{ label: 'Copy command', copy: cmd }] },
        { name: 'Last update', when: (sv) => sv.upd === 'failed', say: 'Could not update to **{latestNow}**: npm could not write to the install folder. Update from a terminal instead', vals: { latestNow: (sv) => sv.latest }, acts: [{ label: 'Dismiss', do: (sv) => { sv.upd = 'available'; return ''; } }], more: [
          { name: 'npm output', say: 'The last lines npm wrote', acts: [{ label: 'View', edit: { title: 'npm output', view: true, yes: 'Close', note: '`npm ERR! code EACCES` · `npm ERR! syscall rename` · `npm ERR! path /usr/local/lib/node_modules/@worca/app`' } }] },
        ] },
        { name: "What's new", when: outdated, say: 'What changed in **{latestShown}**', vals: { latestShown: (sv) => sv.latest }, acts: [{ label: 'Open', id: 'whats-new', say: 'Opens the 1.20.0 changelog page in a new tab' }] },
        { name: 'Changes', help: 'Changes since this version', when: outdated, say: 'Changes since this version, on GitHub', acts: [{ label: 'Compare', say: 'Opens the compare view on GitHub in a new tab' }] },
        { name: 'Repository', say: '`github.com/SinishaDjukic/worca-cc`', acts: [opens('the repository')] },
        { name: 'Report a bug', say: 'Opens a new issue, labelled bug', acts: [{ label: 'Open', id: 'bug', say: 'Opens a new bug issue on GitHub in a new tab' }] },
        { name: 'Suggest an improvement', say: 'Opens a new issue, labelled enhancement', acts: [{ label: 'Open', id: 'idea', say: 'Opens a new enhancement issue on GitHub in a new tab' }] },
      ] },
    ] },

    team: { min: 'advanced', title: 'Team policy', meta: 'What your team requires of every Worca that follows its policy.',
      lock: { level: 'expert', why: 'Expert mode changes the policy; here you can read it' }, sections: [
      { title: 'Policy', rows: [
        { name: 'Home', say: 'Follows **{policyHome}** · synced today', vals: { policyHome: 'acme/worca-policy' }, acts: [edit('Change the policy home', [{ key: 'policyHome', label: 'Repository', hint: 'The project whose marker branch carries the policy' }], { yes: 'Follow it', done: 'Now following the new policy home' })] },
        { name: 'Consent', say: 'Accepted on 2 Oct; a change to it asks again', acts: [{ label: 'Review', read: true, edit: { title: 'Accepted policy', view: true, yes: 'Close', note: 'Policy version `4f2a91c`, published by @dana on 1 Oct: required plugins, spending caps, the Team policy guardrail set and one model.' } }] },
        { name: 'Editing', say: '**{policyTitle}**; a change opens a pull request on `worca-policy`', vals: { policyTitle: 'Gateway team policy', policyNotes: 'Ask #platform' }, acts: [{ label: 'Edit policy', edit: { title: 'Edit the policy', yes: 'Open pull request', fields: [{ key: 'policyTitle', label: 'Title' }, { key: 'policyNotes', label: 'Notes', multiline: true, hint: 'Who to ask, and why' }], done: 'Pull request opened on worca-policy' } }] },
      ] },
      { title: 'Effective policy', meta: 'What the next run on this machine will use.', table: { label: 'Effective policy', columns: [{ id: 'f', label: 'Field' }, { id: 't', label: 'Team', narrow: false }, { id: 'k', label: 'Kind', narrow: false }, { id: 'y', label: 'Yours', narrow: false }, { id: 'e', label: 'Effective' }],
        rows: (sv) => [
          { f: 'Per run limit', t: '$50', k: 'Soft', y: usd(sv.perRun), e: sv.perRun ? usd(Math.min(+sv.perRun, 50)) : '$50' },
          { f: 'Total limit', t: '$2,000', k: 'Soft', y: usd(sv.total), e: sv.total ? usd(Math.min(+sv.total, 2000)) : '$2,000' },
          { f: 'Guardrails', t: 'Team policy', k: 'Required', y: 'Default', e: 'Team policy' },
          { f: 'Create a PR', t: { none: 'None', draft: 'Draft', ready: 'Ready' }[sv.prOpen], k: 'Default', y: '', e: { none: 'None', draft: 'Draft', ready: 'Ready' }[sv.prOpen] },
        ] } },
      { title: 'Defaults', meta: 'A project, New run and the run page can change these.', rows: [
        { name: 'Pull requests', help: 'Create a PR when a run finishes. If it cannot, a notification says why', say: 'When a run finishes, {prOpen}; a feature gets {prSlices}',
          picks: { prOpen: P('none', O(['none', 'don\'t create a PR'], ['draft', 'create a draft PR'], ['ready', 'create a PR ready for review']), 'Team default for every project'), prSlices: P('each', O(['each', 'a PR per slice, stacked'], ['one', 'one PR for the whole feature']), 'How a feature\'s slices become pull requests', true) } },
        { name: 'Spending', say: 'Each run up to **{capRun}**, all runs **{capAll} a month**; a run may go past', vals: { capRun: '$50', capAll: '$2,000' }, acts: [edit('Change the spending caps', [{ key: 'capRun', label: 'Per run' }, { key: 'capAll', label: 'Total a month' }], { done: 'Pull request opened with the new caps' })] },
        { name: 'Workspace runs', say: 'These values replace the others for a run across a workspace: **{wsCap}** a run', vals: { wsCap: '$120' }, acts: [edit('Change for workspace runs', [{ key: 'wsCap', label: 'Per run' }], { done: 'Pull request opened for workspace runs' })] },
      ] },
      { title: 'Required plugins', meta: 'Installing shows its source and what it ships, and waits for your click.', actions: [
        { label: 'Install all…', read: true, off: (sv) => (sv.__recs['team/Required plugins']?.some((r) => r.missing) === false ? 'Everything required is installed' : ''),
          edit: (sv) => ({ title: 'Install what is required', yes: 'Install', note: 'Slack, from worca-official at commit `c81d02e`: a chat channel, 1 skill, no agents.', then: () => { (sv.__recs['team/Required plugins'] || []).forEach((r) => { r.missing = false; r.mark = ''; r.meta = 'Installed'; r.menu = []; }); return 'Required plugins installed'; } }) },
      ], list: [
        { title: 'Jira', meta: 'Installed' },
        { title: 'Slack', meta: 'Missing on this machine', mark: 'is-amber', missing: true },
      ] },
      { title: 'Blocked', meta: 'A run with one of these enabled proceeds and is recorded as off-policy.', list: [
        { title: 'Unknown MCP servers', meta: 'Blocked by acme/worca-policy', menu: ['Remove'] },
      ], empty: 'Nothing is blocked' },
      { title: 'Guardrail sets', meta: 'Read-only on every machine that follows this policy.', list: [
        { title: 'Team policy', meta: '9 deny rules · read-only', open: (r, x) => x.go('guardrails') },
      ] },
      { title: 'Models', meta: 'Selectable everywhere a model is chosen.', list: [
        { title: 'Opus via Acme gateway', meta: 'Through Anthropic-compatible · roles for Claude and Codex only', open: (r, x) => x.go('models') },
      ] },
      { title: 'MCP servers', meta: 'What the policy adds to every run. Each waits for your consent.', list: [
        { title: 'github', meta: 'stdio · consented on 2 Oct', menu: ['Review'], on: { Review: (r, x) => x.dialog({ title: 'github', view: true, yes: 'Close', note: 'Runs `npx @modelcontextprotocol/server-github`, with `GITHUB_TOKEN` from your settings.' }) } },
      ] },
    ] },

    experimental: { title: 'Labs', meta: 'Features still being shaped. Each switch applies to everyone using this Worca.', sections: [
      { title: 'Features', meta: 'Labs features may change, break or disappear in any release.', actions: [
        { label: 'Reset all', help: 'Every feature back to its default; asks first', off: () => (flagsChanged().length ? '' : 'Nothing to reset: every feature is at its default'),
          confirm: { text: 'Turn every Labs feature back to its default?', yes: 'Reset all', then: () => { for (const f of flagsChanged()) window.RailUI.prefs.setFlag(f.key, f.on); return 'Labs: back to its defaults'; } } },
      ], rows: [
        { name: 'Guide', say: 'How Labs works, and what a stage means', acts: [{ label: 'Open', say: 'Opens the Labs guide in a new tab' }] },
        ...FLAGS.map((f) => ({ name: f.name, say: f.say, chip: f.stage, sw: { flag: f.key, on: f.on, why: f.why, locked: f.locked } })),
      ] },
    ] },

    runs: { title: 'Runs', meta: 'How runs spend, start and wait.', sections: [
      { title: 'Spending', meta: (sv) => `Spent this month: $412${sv.total ? ` of ${usd(sv.total)}` : ''}.`, rows: [
        { name: 'Budget', say: 'All runs pause at **{bTotal}**; one run at **{bRun}**', vals: { bTotal: (sv) => (sv.total ? `${usd(sv.total)} a ${sv.period}` : 'no limit'), bRun: (sv) => usd(sv.perRun) },
          acts: [{ label: 'Change…', edit: { title: 'Change the budget', yes: 'Save', note: 'Empty means no limit.', check: (v) => (/^\d*(\.\d+)?$/.test(v.perRun) && /^\d*(\.\d+)?$/.test(v.total) ? '' : 'A limit is an amount in dollars'), fields: [
            { key: 'perRun', label: 'Per run (USD)', placeholder: 'No limit' }, { key: 'total', label: 'Total (USD)', placeholder: 'No limit' }, { key: 'period', label: 'The total starts again', options: O(['day', 'Each day, at midnight'], ['week', 'Each week, from Monday'], ['month', 'Each month, from the 1st']) },
          ], done: 'Budget saved' } }],
          more: [
            { name: 'Team caps', say: 'Your team\'s policy caps each run at **$50** and all runs at **$2,000 a month**', min: 'advanced', acts: [{ label: 'Open', id: 'team', go: 'team', help: 'Settings › Team policy' }] },
            { name: 'Usage', say: 'What was spent, per harness', acts: [{ label: 'Usage', click: ['[data-acct]', '[data-sub="usage"]'], help: 'The profile menu\'s Usage and costs' }] },
            { name: 'Hourly rate', say: 'Time saved is counted at **${rate}** an hour', vals: { rate: '35' }, acts: [edit('Change the hourly rate', [{ key: 'rate', label: 'USD an hour', hint: 'What an hour of a developer costs, for Statistics' }], { done: 'Hourly rate saved' })] },
            { name: 'Clear limits', say: 'Remove both limits', acts: [{ label: 'Clear', off: (sv) => (sv.perRun || sv.total ? '' : 'No limit is set'), do: (sv) => { sv.perRun = ''; sv.total = ''; return 'Limits cleared'; } }] },
          ] },
        { name: 'Cost tags', say: 'Spend is counted by **Cost centre** and **Customer**; a run needs its Cost centre', acts: [{ label: 'Add tag', edit: (sv) => ({ title: 'Add a cost tag', yes: 'Add', fields: [{ key: 'name', label: 'Name', value: '' }, { key: 'vals', label: 'Values', value: '', hint: 'Comma-separated; empty lets any value in' }], check: (v) => (v.name.trim() ? '' : 'A tag needs a name'), then: (v) => { const k = 'runs/Spending/Cost tags'; sv.__recs[k] ||= COST_TAGS.map((it, i) => ({ ...it, id: 'r' + i })); sv.__recs[k].push({ id: 'n' + Date.now(), title: v.name, meta: `${v.vals || 'Any value'} · optional`, menu: ['Edit', 'Remove'] }); sv.__open = 'more:' + k; return `Cost tag added: ${v.name}`; } }) }], more: [
          { name: 'Required', say: 'A run starts only with every required cost tag set', sw: { key: 'tagsReq', on: true } },
        ], moreList: COST_TAGS },
      ] },
      { title: 'Start', rows: [
        { name: 'Naming', flag: 'smartRunNaming', say: 'Suggest a title and a branch name as you type', sw: { key: 'naming', on: true, why: 'Labs › Smart run naming' }, more: [
          { name: 'Suggestions', say: 'Suggest {what} for a new run, {when}', picks: { what: P('both', O(['both', 'a title and a branch name'], ['title', 'a title'], ['branch', 'a branch name']), 'What the model suggests'), when: P('typing', O(['typing', 'while you type the task'], ['ask', 'when you press Suggest']), 'When it suggests', true) } },
          { name: 'Branch', help: 'A project can override the pattern and the types in its own Settings', say: 'Branches are named `{pattern}`, the type one of {types}', vals: { pattern: '{type}/{slug}', types: 'feat, fix, chore, docs, refactor, test' }, acts: [edit('Change the branch pattern', [{ key: 'pattern', label: 'Pattern', hint: '{type}, {slug}, {ticket} and {id} are filled in' }, { key: 'types', label: 'Types', hint: 'The model picks one of these' }], { done: 'Branch pattern saved' })] },
          { name: 'Add run id', say: 'Append the short run id when the pattern has no `{id}`', sw: { key: 'runId', on: false } },
          { name: 'Model', say: 'Uses the **Run naming** model, about $0.001 a suggestion', acts: [{ label: 'Open Models', go: 'models', help: 'Models › Helper jobs' }] },
          { name: 'Defaults', say: 'Back to `{type}/{slug}` and the six types', acts: [{ label: 'Use defaults', do: (sv) => { sv.pattern = '{type}/{slug}'; sv.types = 'feat, fix, chore, docs, refactor, test'; sv.runId = false; return 'Naming: back to its defaults'; } }] },
        ] },
        { name: 'Sync', min: 'advanced', help: GIT_TIP, say: 'Bring the source branch up to date first', sw: { key: 'sync', on: true }, more: [
          { name: 'Remote', say: 'Sync from {remote}; if the branch has diverged, {div}', picks: { remote: P('origin', O('origin', 'upstream'), 'The remote to sync from'), div: P('ask', O(['ask', 'ask me'], ['origin', 'start from origin'], ['stop', 'don\'t run']), 'What a run does when the branch has diverged', true) } },
          { name: 'Background checks', say: 'Check remotes {bg}', picks: { bg: P('10', O(['off', 'never'], ['5', 'every 5 minutes'], ['10', 'every 10 minutes'], ['30', 'every 30 minutes'], ['60', 'every hour']), 'How often Worca looks for new commits') } },
        ] },
        { name: 'Pull requests', help: GIT_TIP, say: 'Draft the description with AI as the PR opens', sw: { key: 'prDraft', on: false }, more: [
          { name: 'Create a PR', min: 'advanced', say: 'A finished run follows the team default: **{prNow}**', vals: { prNow: (sv) => ({ none: 'no PR', draft: 'a draft PR', ready: 'a PR ready for review' }[sv.prOpen]) }, acts: [{ label: 'Open', id: 'team', go: 'team', help: 'Settings › Team policy › Defaults; a project or New run can change it' }] },
        ] },
      ] },
      { title: 'Limits', meta: 'Near: the run’s estimate does not fit in what is left of a window; with no estimate, at the warning line.', rows: [
        { name: 'Paused runs', say: 'A run paused at a usage limit {resume}', picks: { resume: P('auto', O(['auto', 'resumes after the reset', 'Worca schedules its resume for 5 minutes after the limit resets'], ['me', 'waits for you', 'It stays paused until you resume it']), 'What a run paused at a usage limit does when the limit resets') } },
      ] },
      { title: 'Away mode', min: 'advanced', meta: 'Going away is the Away switch in your profile menu.', rows: [
        { name: 'Hours', say: 'Worca answers your runs\' questions from **{awayFrom} to {awayTo}**, {awayZone}', vals: { awayFrom: '22:00', awayTo: '07:00', awayZone: 'Europe/Sofia' }, acts: [edit('Change the away hours', [{ key: 'awayFrom', label: 'From' }, { key: 'awayTo', label: 'To' }, { key: 'awayZone', label: 'Time zone' }], { done: 'Away hours saved' })], more: [
          { name: 'Runs', say: 'Worca answers on {which}; a marked run is also answered by day after {byDay}', picks: { which: P('marked', O(['marked', 'runs you marked'], ['all', 'every run']), 'Which runs Worca answers on while you are away'), byDay: P('30', O(['never', 'never'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', 'an hour']), 'How long a question waits by day before Worca answers it', true) } },
          { name: 'Decisions', say: 'It {method}, trusting the agent at {sure} sure with a lead of {lead}', picks: { method: P('mixed', O(['mixed', 'trusts a sure agent, else weighs', 'Trusts the agent when it is sure; otherwise weighs the options'], ['trust', 'always trusts the agent'], ['weigh', 'always weighs the options']), 'How Worca picks an answer'), sure: P('60', O(['50', '50%'], ['60', '60%'], ['70', '70%'], ['80', '80%']), 'How sure the agent must be'), lead: P('25', O(['15', '15 points'], ['25', '25 points'], ['40', '40 points']), 'How far its pick must lead the next one', true) } },
          { name: 'Priorities', say: 'Matches past decisions **{pPast}** · easy to undo **{pUndo}** · changes least **{pLeast}** · conventions **{pConv}** · cheapest **{pCheap}**', vals: { pPast: '3', pUndo: '3', pLeast: '2', pConv: '2', pCheap: '1' }, acts: [edit('Change the priorities', [{ key: 'pPast', label: 'Matches past decisions', hint: '0 ignores it, 10 decides' }, { key: 'pUndo', label: 'Easy to undo' }, { key: 'pLeast', label: 'Changes the least' }, { key: 'pConv', label: 'Follows the conventions' }, { key: 'pCheap', label: 'Costs the least' }], { done: 'Priorities saved' })] },
          { name: 'Model', say: '{dmodel} at {deffort} effort', picks: { dmodel: P('run', O(['run', 'the run\'s own model'], ...MODEL), 'The model that weighs the options'), deffort: P('medium', EFFORT, 'Its effort') } },
          { name: 'Limits', say: 'Pause a run after {answers} answers, and everything at {spent} spent while away', picks: { answers: P('20', O('10', '20', '40'), 'Answers in one run before it pauses'), spent: P('none', O(['none', 'no cap'], ['25', '$25'], ['50', '$50'], ['100', '$100']), 'Spent while away before every run pauses', true) } },
          { name: 'Review loops', say: 'Allow {extra} extra fix rounds; the team cap is {exceed}', picks: { extra: P('0', O('0', '1', '2', '3'), 'Fix rounds beyond the workflow\'s own'), exceed: P('kept', O(['kept', 'kept'], ['exceed', 'allowed to be exceeded']), 'Whether away answers may go over the team\'s cost cap', true) } },
          { name: 'Exceptions', say: 'Always waits for you on {awayEx}', vals: { awayEx: 'approving a plan, merging and deleting' }, acts: [edit('Change the exceptions', [{ key: 'awayEx', label: 'Waits for you on', hint: 'Comma-separated' }], { done: 'Exceptions saved' })] },
        ] },
      ] },
      { title: 'Machine', rows: [
        { name: 'Capacity', min: 'advanced', say: 'Up to **{nNow}** runs at a time; finished runs are kept', vals: { nNow: (sv) => sv.n }, more: [
          { name: 'Parallel runs', say: 'Up to {n} runs at a time; each tests with {w}', picks: { n: P('3', O('1', '2', '3', '4', '6', '8', '12', '20'), 'More runs wait in line'), w: P('half', O(['half', 'half the cores'], ['1', '1 worker'], ['2', '2 workers'], ['4', '4 workers'], ['8', '8 workers']), 'Test workers per run', true) } },
          { name: 'Archive', say: 'Archive finished runs after {arch}', picks: { arch: P('never', O(['never', 'never'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', 'a year']), 'Archiving removes the branch, worktree and logs') } },
          { name: 'Checkouts', help: GIT_TIP, say: 'An action\'s checkout is {keep}; keep at most {coMax}', picks: { keep: P('demand', O(['demand', 're-created when needed'], ['success', 'kept after a successful run'], ['pr', 'kept until the PR closes']), 'When a checkout is removed'), coMax: P('none', O(['none', 'any number'], ['5', '5'], ['10', '10'], ['20', '20']), 'The oldest go first', true) } },
          { name: 'Ports', say: 'Port variables come from `{portLow}–{portHigh}`', vals: { portLow: '4400', portHigh: '4499' }, acts: [edit('Change the ports', [{ key: 'portLow', label: 'From' }, { key: 'portHigh', label: 'To' }], { done: 'Ports saved' })] },
          { name: 'Editor', help: `${GIT_TIP}. Actions are off on hosted deployments unless an administrator enables them`, say: 'Opens folders with `{editor}` (found on this machine)', vals: { editor: 'code {folder}' }, acts: [{ label: 'Change…', edit: launcher('editor', 'Editor', O(['code {folder}', 'VS Code'], ['cursor {folder}', 'Cursor'], ['zed {folder}', 'Zed'])) }] },
          { name: 'Terminal', help: `${GIT_TIP}. Actions are off on hosted deployments unless an administrator enables them`, say: 'Opens shells with `{terminal}` (found on this machine)', vals: { terminal: 'open -a iTerm {folder}' }, acts: [{ label: 'Change…', edit: launcher('terminal', 'Terminal', O(['open -a iTerm {folder}', 'iTerm'], ['open -a Terminal {folder}', 'Terminal'], ['wezterm start --cwd {folder}', 'WezTerm'])) }] },
          { name: 'Scans', say: 'A workspace scan and a new project agent follow the **Everyday coding** role', acts: [{ label: 'Open Models', go: 'models' }] },
        ] },
        { name: 'Network', say: '{netWords}; a run waits up to **{waitNow}** offline', vals: { netWords: (sv) => (sv.proxy ? `Through ${sv.proxyHost}:${sv.proxyPort}` : 'A direct connection'), waitNow: (sv) => ({ '30m': '30 minutes', '1h': '1 hour', '4h': '4 hours', '12h': '12 hours', '24h': '24 hours' }[sv.wait]) }, more: [
          { name: 'Proxy', say: 'Through **{proxyHost}:{proxyPort}**, signing in with {auth}', vals: { proxyHost: 'proxy.corp.example', proxyPort: '8080', proxyLocal: '' },
            picks: { auth: P('auto', O(['auto', 'NTLMv2'], ['basic', 'Basic', 'Sends the password in cleartext; cannot use a saved login'], ['digest', 'Digest', 'Cannot use a saved login'], ['none', 'no login']), 'How Worca signs in to the proxy') },
            acts: [{ label: 'Change…', edit: (sv) => ({ title: 'Change the proxy', yes: 'Save and test', fields: [{ key: 'proxyHost', label: 'Host' }, { key: 'proxyPort', label: 'Port' }, { key: 'proxyLocal', label: 'Local port', hint: 'Empty: Worca picks one and keeps it', placeholder: 'Automatic' }, { key: 'proxyTest', button: 'Test', hint: 'A new address must pass a test before it saves', do: (v) => `Reached ${v.proxyHost}:${v.proxyPort}` }], check: (v) => (v.proxyHost.trim() ? '' : 'A proxy needs a host'), done: 'Proxy saved; tested and working' }) }], sw: { key: 'proxy', on: false, why: 'Off: Worca connects directly' } },
          { name: 'Login', say: '{loginWords}', vals: { loginWords: (sv) => (sv.proxyLogin ? `Saved for ${sv.proxyUser}: the NT hash, never the password` : 'No saved login'), proxyUser: 'CORP\\emil' },
            acts: [
              { label: 'Log out', when: (sv) => sv.proxyLogin, do: (sv) => { sv.proxyLogin = false; return 'Proxy login removed'; } },
              { label: 'Log in…', when: (sv) => !sv.proxyLogin, off: (sv) => (sv.auth === 'basic' || sv.auth === 'digest' ? 'This login mode needs the password in HTTPS_PROXY; choose NTLMv2 for a saved login' : ''), edit: { title: 'Log in to the proxy', yes: 'Log in', note: 'Worca saves your domain, user name and the NT hash in a file only you can read.', fields: [{ key: 'pxDomain', label: 'Domain', value: 'CORP' }, { key: 'pxUser', label: 'User name', value: 'emil' }, { key: 'pxPass', label: 'Password', type: 'password', value: '' }], then: (v, sv) => { sv.proxyLogin = true; sv.proxyUser = `${v.pxDomain}\\${v.pxUser}`; return 'Logged in to the proxy'; } } },
            ] },
          { name: 'Bypass', say: 'These go direct: `{bypass}`', vals: { bypass: 'localhost, *.corp.example' }, acts: [edit('Change the bypass list', [{ key: 'bypass', label: 'Hosts', hint: 'Comma-separated; * matches any part' }], { done: 'Bypass list saved' })] },
          { name: 'Timeouts', min: 'expert', say: 'Connect within {ct}, sign in within {lt}, drop idle after {it}', picks: { ct: P('60', O(['30', '30s'], ['60', '60s'], ['120', '120s']), 'Connect timeout'), lt: P('60', O(['30', '30s'], ['60', '60s'], ['120', '120s']), 'Login timeout'), it: P('300', O(['120', '2 minutes'], ['300', '5 minutes'], ['600', '10 minutes']), 'Idle timeout', true) } },
          { name: 'Offline', min: 'advanced', say: 'When the network drops, a run waits up to {wait}', picks: { wait: P('4h', O(['30m', '30 minutes'], ['1h', '1 hour'], ['4h', '4 hours'], ['12h', '12 hours'], ['24h', '24 hours']), 'How long it waits before it fails') }, sw: { key: 'netWait', on: true } },
        ] },
        { name: 'Schedules', min: 'advanced', say: 'A missed start still runs, up to **{lateNow}** late', vals: { lateNow: (sv) => ({ '30m': '30 minutes', '1h': '1 hour', '6h': '6 hours', '24h': '24 hours' }[sv.lateMax]) }, more: [
          { name: 'Missed starts', say: 'When Worca was not running, {late} up to {lateMax} late', picks: { late: P('late', O(['late', 'start it'], ['skip', 'skip it']), 'What a scheduled run does when its time passed'), lateMax: P('6h', O(['30m', '30 minutes'], ['1h', '1 hour'], ['6h', '6 hours'], ['24h', '24 hours']), 'How late it may still start', true) } },
          { name: 'Failures', say: 'Pause a repeating schedule after {fails} failures in a row', picks: { fails: P('3', O('2', '3', '5', '10'), 'Failures in a row before it pauses') } },
        ] },
      ] },
    ] },

    presets: { min: 'advanced', title: 'Presets', meta: 'Saved setups a new run can start from. Save one from a run\'s ⋯.', sections: [
      { title: 'Presets', empty: 'No presets yet', list: [
        preset('Bug fix', 'Any project', 'Fix workflow · Claude · updated 3 Oct'),
        preset('Docs pass', 'Only worca-cc', 'Docs workflow · Claude · updated 28 Sep'),
        preset('Billing slice', 'Workspace gone', 'Feature workflow · Claude · updated 12 Sep', 'is-amber'),
      ] },
    ] },

    labels: { flag: 'runLabels', title: 'Labels', meta: 'Free words you put on runs to find them again.', sections: [
      { title: 'Labels', meta: 'The most used first.', empty: 'No labels yet', list: [
        { title: 'frontend', meta: 'On 14 runs', menu: ['Rename', 'Remove'] },
        { title: 'needs demo', meta: 'On 6 runs', menu: ['Rename', 'Remove'] },
        { title: 'hotfix', meta: 'On 3 runs', menu: ['Rename', 'Remove'] },
      ] },
    ] },

    automations: { min: 'advanced', flag: 'gitAutomations', title: 'Automations', meta: 'What runs by itself across projects; each project keeps its own rules.', sections: [
      { title: 'Projects', list: [
        { title: 'worca-cc', meta: 'Proposes a fix for new issues and reviews PRs · 3 rules' },
        { title: 'billing workspace', meta: 'Every member repository · reviews PRs · 1 rule' },
      ] },
      { title: 'Waiting', empty: 'Nothing is waiting', list: [
        { title: 'Issue #1088', meta: 'A fix is proposed · worca-cc', mark: 'is-amber', fig: '2h ago', menu: ['Approve', 'Skip'],
          on: { Approve: (r, x) => { x.remove(); x.add({ title: r.title, meta: 'Approved: a run started · worca-cc', fig: 'now' }, 'automations/Recent'); return 'Issue #1088: a run started'; }, Skip: (r, x) => { x.remove(); x.add({ title: r.title, meta: 'Skipped by you · worca-cc', fig: 'now' }, 'automations/Recent'); return 'Issue #1088: skipped'; } } },
      ] },
      { title: 'Recent', list: [
        { title: 'PR #1087', meta: 'Reviewed · worca-cc', fig: '09:12' },
        { title: 'Issue #1085', meta: 'Skipped: no rule matched · worca-cc', fig: 'yesterday' },
      ] },
    ] },

    models: { min: 'expert', title: 'Models', meta: 'The models every project can pick from; sign-ins are on Providers.', sections: [
      { title: 'Defaults', rows: [
        { name: 'Roles', say: 'Every engine keeps its own: on Claude, **Opus** plans and reviews, **Sonnet** writes the code, **Haiku** does quick jobs', help: 'Roles open at Simple through the link from a run or the setup assistant', moreList: ENGINES.map(roleRecord) },
        { name: 'Engine', say: 'New runs use {eng}; each step and helper job uses its role', picks: { eng: P('claude', ENGINES, 'The engine a new run starts on') } },
        { name: 'Claude sign-in', say: '{claudeWords}', vals: { claudeWords: (sv) => (sv.claudeIn ? 'Signed in to Claude Code; factory defaults show as (default)' : 'Not signed in to Claude Code: Memory defragment and Second-opinion reviewer lose their factory default. A run that needs one is refused, never given another model') },
          chip: (sv) => (sv.claudeIn ? '' : 'Signed out'),
          acts: [{ label: 'Sign out', when: (sv) => sv.claudeIn, do: (sv) => { sv.claudeIn = false; window.RailUI.prefs.setConnected('claude', false); return 'Signed out of Claude Code'; } }, { label: 'Sign in', when: (sv) => !sv.claudeIn, do: (sv) => { sv.claudeIn = true; window.RailUI.prefs.setConnected('claude', true); return 'Signed in to Claude Code'; } }] },
      ] },
      { title: 'Jobs', meta: 'A step or a helper job follows its role until you override it.', rows: [
        { name: 'Step models', say: '**{stepN}** set here; the others follow their role', vals: { stepN: (sv) => shownOf(STEPS, sv, 'Step models') }, acts: [{ label: (sv) => (sv.stepsAll ? 'Show set' : 'Show all 5'), id: 'steps-all', do: (sv) => { sv.stepsAll = !sv.stepsAll; sv.__open = 'more:models/Jobs/Step models'; return ''; } }], moreList: STEPS, empty: 'None overridden: Show all lists the steps' },
        { name: 'Helper jobs', say: '**{helperN}** have a model; the other {helperRest} follow their role', vals: { helperN: (sv) => shownOf(HELPERS, sv, 'Helper jobs'), helperRest: (sv) => HELPERS.length - shownOf(HELPERS, sv, 'Helper jobs') }, acts: [{ label: (sv) => (sv.jobsAll ? 'Show set' : 'Show all 11'), id: 'jobs-all', do: (sv) => { sv.jobsAll = !sv.jobsAll; sv.__open = 'more:models/Jobs/Helper jobs'; return ''; } }], moreList: HELPERS },
      ] },
      { title: 'Catalogue', actions: [{ label: 'Add model', edit: (sv) => ({ title: 'Add a model', yes: 'Add', fields: [{ key: 'id', label: 'Model id', value: '', hint: 'Worca\'s handle for it' }, { key: 'lab', label: 'Label', value: '' }], check: (v) => (v.id.trim() ? '' : 'A model needs an id'), then: (v) => { (sv.__recs['models/Catalogue'] ||= recsSeed('models', 'Catalogue')).unshift({ id: 'n' + Date.now(), title: v.id, meta: v.lab || 'Added by you', menu: ['Edit', 'Remove'] }); return `Model added: ${v.id}`; } }) }], list: [
        { title: 'claude-sonnet-5-5', meta: 'Your Claude login · priced by the CLI', menu: ['Edit', 'Remove'] },
        { title: 'gpt-5', meta: 'Codex · your ChatGPT sign-in', menu: ['Edit', 'Remove'] },
        { title: 'local-llama', meta: 'Through OpenAI-compatible · free', menu: ['Edit', 'Remove'] },
      ], empty: 'No models yet' },
      { title: 'Sources', rows: [
        { name: 'Built-in models', say: 'Show the built-in Anthropic models', sw: { key: 'builtIn', on: true, why: 'Turn off when you don\'t use a first-party Anthropic account' } },
        { name: 'Import', say: 'Bring models in from Copilot or a provider', acts: [{ label: 'Import…', edit: importModels('models/Catalogue') }] },
        { name: 'Sharing', say: 'Share your models with the team as a plugin', acts: [{ label: 'Share…', edit: { title: 'Share your models', yes: 'Create plugin', note: 'Makes a plugin with your 3 models, with no keys in it.', done: 'Plugin created: team-models' } }] },
      ] },
    ] },

    providers: { min: 'expert', title: 'Providers', meta: 'Sign-ins and keys for the models Worca runs through its own bridge.', sections: [
      { title: 'Providers', list: [
        { title: 'GitHub Copilot', meta: 'Connected as @emil-angelov', mark: 'is-green', detail: 'Premium requests are read from GitHub, not counted by Worca, and reset on 1 Dec.',
          live: (sv, r) => (r.signedOut ? 'Not signed in' : `${r.account} · ${r.conc} at once · ${r.used} of 1,000 premium requests, from GitHub`), account: 'Business', conc: 4, used: 312,
          menu: (r) => (r.signedOut ? ['Sign in'] : ['Edit', 'Import models', 'Refresh usage', 'Sign out']),
          on: {
            Edit: (r, x) => x.dialog({ title: 'GitHub Copilot', yes: 'Save', fields: [{ key: 'acct', label: 'Account type', value: r.account, options: O('Individual', 'Business', 'Enterprise') }, { key: 'conc', label: 'Requests at once', value: String(r.conc), type: 'number', hint: 'Keep it low: more waits its turn, and it lowers GitHub\'s abuse-detection risk' }], then: (v) => { r.account = v.acct; r.conc = v.conc; return 'GitHub Copilot saved'; } }),
            'Import models': (r, x) => x.dialog(importModels('models/Catalogue')),
            'Refresh usage': (r) => { r.used += 7; return `Copilot: ${r.used} of 1,000 used, from GitHub`; },
            'Sign out': (r) => { r.signedOut = true; r.mark = ''; window.RailUI.prefs.setConnected('copilot', false); return 'Signed out of Copilot'; },
            'Sign in': (r) => { r.signedOut = false; r.mark = 'is-green'; window.RailUI.prefs.setConnected('copilot', true); return 'Signed in to Copilot as @emil-angelov'; },
          } },
        { title: 'Codex', meta: 'Your ChatGPT sign-in', mark: 'is-green', detail: 'Codex reports its own session and weekly usage.',
          live: (sv, r) => (r.signedOut ? 'Not signed in' : 'Your ChatGPT sign-in'), menu: (r) => (r.signedOut ? ['Sign in'] : ['Sign out']),
          on: {
            'Sign out': (r) => { r.signedOut = true; r.mark = ''; window.RailUI.prefs.setConnected('codex', false); return 'Signed out of Codex'; },
            'Sign in': (r) => { r.signedOut = false; r.mark = 'is-green'; window.RailUI.prefs.setConnected('codex', true); return 'Signed in to Codex'; },
          } },
        { title: 'OpenAI-compatible', meta: 'Not set up · presets: OpenRouter',
          live: (sv, r) => (r.url ? (r.preset === 'openrouter' ? orFree(sv) : `${r.url} · key set`) : 'Not set up · presets: OpenRouter'),
          mark: '', menu: (r) => (r.url ? (r.preset === 'openrouter' ? ['Edit', 'Refresh usage', 'Remove'] : ['Edit', 'Remove']) : ['Set up…']),
          on: {
            'Set up…': (r, x) => x.dialog(openaiSetup(r)), Edit: (r, x) => x.dialog(openaiSetup(r)),
            'Refresh usage': (r, x) => { x.sv.orLeft = x.sv.orLeft > 100 ? 80 : 820; r.mark = x.sv.orLeft < 100 ? 'is-amber' : 'is-green'; return x.sv.orLeft < 100 ? `Low: ${x.sv.orLeft} free requests left; New run warns below 10%` : `${x.sv.orLeft} free requests left today`; },
            Remove: (r) => { r.url = ''; r.preset = ''; r.mark = ''; return 'OpenAI-compatible removed'; },
          } },
        { title: 'Anthropic-compatible', meta: 'llm.corp.example · key set · 8 requests at once', mark: 'is-green', menu: ['Edit', 'Remove'],
          on: { Edit: (r, x) => x.dialog({ title: 'Anthropic-compatible', yes: 'Save', fields: [{ key: 'url', label: 'Base URL', value: 'https://llm.corp.example' }, { key: 'conc', label: 'Requests at once', value: '8', type: 'number' }], then: (v) => { r.meta = `${v.url.replace(/^https?:\/\//, '')} · key set · ${v.conc} requests at once`; return 'Anthropic-compatible saved'; } }) } },
        { title: 'Gemini CLI', meta: 'Your Gemini sign-in; the CLI is the engine', mark: 'is-green',
          detail: 'Google does not report a quota to Worca. Set the number your plan allows and Worca counts requests against it.',
          live: (sv) => (sv.gemQuota ? `Your Gemini sign-in · ${sv.gemUsed} of ${sv.gemQuota} requests today, counted by Worca against your quota` : 'Your Gemini sign-in · no quota set, so nothing is counted'),
          menu: (r, sv) => (r.signedOut ? ['Sign in'] : sv.gemQuota ? ['Set quota', 'Clear quota', 'Sign out'] : ['Set quota', 'Sign out']),
          on: {
            'Sign out': (r) => { r.signedOut = true; r.mark = ''; window.RailUI.prefs.setConnected('gemini', false); return 'Signed out of Gemini'; },
            'Sign in': (r) => { r.signedOut = false; r.mark = 'is-green'; window.RailUI.prefs.setConnected('gemini', true); return 'Signed in to Gemini'; },
            'Set quota': (r, x) => x.dialog({ title: 'Set the Gemini quota', yes: 'Save', note: 'Google does not report one. Worca counts requests against the number you set here, and Pulse warns near it.', fields: [{ key: 'gemQuota', label: 'Requests a day', type: 'number', placeholder: 'No quota', value: x.sv.gemQuota }], check: (v) => (+v.gemQuota >= 0 ? '' : 'A quota is a number'), then: (v, sv) => { sv.gemQuota = v.gemQuota; return v.gemQuota ? `Gemini quota: ${v.gemQuota} requests a day` : 'Gemini quota cleared'; } }),
            'Clear quota': (r, x) => { x.sv.gemQuota = ''; return 'Gemini quota cleared'; },
          } },
      ] },
      { title: 'Speech', meta: 'Used by Chat\'s voice. The built-in engines run in your browser; audio never leaves this computer.', rows: [
        { name: 'Listening', say: 'Chat listens with {stt}', picks: { stt: P('whisper', O(['whisper', 'Whisper, in the browser'], ['server', 'your speech server']), 'The speech-to-text engine') } },
        { name: 'Listening URL', when: (sv) => sv.stt === 'server', say: '`{sttUrl}`', vals: { sttUrl: 'https://speech.corp.example/v1/audio/transcriptions' }, acts: [edit('Change the listening URL', [{ key: 'sttUrl', label: 'URL', type: 'url' }], { done: 'Listening URL saved' })] },
        { name: 'Speaking', say: 'Replies are read aloud with {tts}', picks: { tts: P('kokoro', O(['kokoro', 'Kokoro, in the browser'], ['server', 'your speech server'], ['off', 'nothing: replies stay text']), 'The text-to-speech engine') } },
        { name: 'Speaking URL', when: (sv) => sv.tts === 'server', say: '`{ttsUrl}`', vals: { ttsUrl: 'https://speech.corp.example/v1/audio/speech' }, acts: [edit('Change the speaking URL', [{ key: 'ttsUrl', label: 'URL', type: 'url' }], { done: 'Speaking URL saved' })] },
        { name: 'Speech models', say: '{speechWords}', vals: { speechWords: (sv) =>  (sv.speechModels ? 'Downloaded: 480 MB; the next mic use fetches them again' : 'Not downloaded; the first mic use fetches them, up to 500 MB') }, acts: [{ label: 'Remove', off: (sv) => (sv.speechModels ? '' : 'Nothing is downloaded'), do: (sv) => { sv.speechModels = false; return 'Speech models removed'; } }] },
      ] },
    ] },

    ask: { min: 'advanced', title: 'Chat', meta: 'Worca\'s own assistant: its engine, what it may do and where it may look.', sections: [
      { title: 'Chat', rows: [
        { name: 'Engine', help: 'Engine for new chats. A chat can move to another engine later, from its model picker', say: 'New chats start on {chatEngine}{chatNote}', vals: { chatNote: (sv) => (sv.chatEngine === 'gemini' || sv.chatEngine === 'qwen' ? '. It needs a model of its own: add one on Models' : '') },
          picks: { chatEngine: P('claude', [...ENGINES.filter(([id]) => id !== 'cursor'), ['cursor', 'Cursor (unavailable)', 'Unavailable on this Cursor version; new chats start on Claude']], 'The engine a new chat starts on') },
          moreList: ENGINES.filter(([id]) => id !== 'cursor').map(([e, label]) => chatModel(e, label.replace(' (beta)', ''))) },
        { name: 'Abilities', say: 'Runs scripts, sums up commands, suggests a next prompt', more: [
          { name: 'Scripts', say: 'Create and run scripts', sw: { key: 'scripts', on: true } },
          { name: 'Summaries', flag: 'commandSummaries', say: 'Show each command as one line saying what it does', sw: { key: 'summaries', on: true, why: 'With Labs › Command summaries on' } },
          { name: 'Suggestions', say: 'Suggest a next prompt after each reply', sw: { key: 'nextPrompt', on: true } },
          { name: 'Limits', help: 'On an engine other than Claude the cap is checked when a reply ends', say: 'One message may use **{turns}** turns, and a turn stops at **{capWords}**', vals: { turns: '400', cap: '', capWords: (sv) => (sv.cap ? `$${sv.cap}` : 'no cap') },
            acts: [edit('Change the chat limits', [{ key: 'turns', label: 'Turn limit', type: 'number', hint: '1 to 500, per message; empty restores 400', placeholder: '400' }, { key: 'cap', label: 'Per-turn cost cap (USD)', type: 'number', hint: '0.1 to 100; empty means no cap', placeholder: 'No cap' }], {
              check: (v) => { const t = v.turns === '' ? 400 : +v.turns, c = v.cap === '' ? 1 : +v.cap; if (!(t >= 1 && t <= 500)) return 'The turn limit is 1 to 500'; if (!(c >= 0.1 && c <= 100)) return 'The cap is 0.1 to 100'; return ''; },
              then: (v, sv) => { sv.turns = v.turns === '' ? '400' : v.turns; sv.cap = v.cap; return 'Chat limits saved'; } })] },
        ] },
        { name: 'Web', say: 'Reads web pages from {web}', picks: { web: P('allowed', O(['allowed', 'the allowed sites'], ['any', 'any site, without asking'])) }, sw: { key: 'webOn', on: false }, more: [
          { name: 'Allowed sites', say: '`{webSites}`', vals: { webSites: 'docs.python.org, developer.mozilla.org' }, acts: [edit('Change the allowed sites', [{ key: 'webSites', label: 'Sites', hint: 'Comma-separated' }], { done: 'Allowed sites saved' })] },
          { name: 'Search', min: 'expert', say: 'Searches with {searchWords}', vals: { searchWords: (sv) => (sv.searchUrl ? sv.searchUrl : 'the built-in search'), searchUrl: '' }, acts: [edit('Use your own search', [{ key: 'searchUrl', label: 'Endpoint' }, { key: 'searchVar', label: 'Key variable', value: '' }, { key: 'searchHead', label: 'Key header', value: '' }], { done: 'Search saved' })] },
        ] },
        { name: 'Connectors', say: 'Uses the **General** set: 3 servers, 2 skills', acts: [{ label: 'Open', go: 'connectors' }] },
      ] },
      { title: 'Channels', meta: 'Chat plugins that carry notifications and your replies. What each kind of update sends is in Notifications.', actions: [{ label: 'Add channel', page: 'marketplace', say: 'Opens the Marketplace, the store in the sidebar' }], list: [
        channel('Telegram', 'chTelegram', { on: true, state: () => 'Connected', meta: 'Personal bot · last message 2h ago', fixed: 'Personal bot · last message 2h ago' }),
        channel('Discord', 'chDiscord', { on: true, state: () => 'Connected', mark: 'is-amber', warn: true, chatId: '99812', meta: 'Commands are off: no chat is in Allowed chat IDs, so replies like /approve are ignored', fixed: 'Team server · replies count from allowed chats' }),
        channel('Slack', 'chSlack', { on: false, state: () => 'Not set up', meta: 'Needs a bot token: Plugins › Slack › Settings', fixed: 'Workspace bot' }),
        channel('Teams', 'chTeams', { on: false, state: () => 'Not set up', meta: 'Needs a bot token: Plugins › Teams › Settings', fixed: 'Team bot' }),
      ], empty: 'No chat channels installed' },
      { title: 'History', meta: 'Delete removes transcripts, attachments and the worktrees checked out for them. Runs started from a chat stay.', actions: [
        { label: 'Delete all chats', help: 'Asks first', off: (sv) => (sv.chats ? '' : 'No chats to delete'), confirm: (sv) => ({ text: `Delete all ${sv.chats} chats, with ${sv.worktrees} worktrees and ${sv.attach} of attachments? They cannot be brought back.`, yes: 'Delete all', danger: true, then: (s) => { s.chats = 0; s.worktrees = 0; s.attach = '0 MB'; return 'All chats deleted'; } }) },
      ], rows: [
        { name: 'Chat history', say: '**{chatsNow}** chats, **{treesNow}** worktrees and **{attachNow}** of attachments on this machine', vals: { chatsNow: (sv) => sv.chats, treesNow: (sv) => sv.worktrees, attachNow: (sv) => sv.attach } },
      ] },
    ] },

    guardrails: { min: 'advanced', title: 'Guardrails', meta: 'What agents may not touch, as sets a project follows.', sections: [
      { title: 'Sets', actions: [{ label: 'New set', min: 'expert', edit: (sv) => ({ title: 'New guardrail set', yes: 'Create set', fields: [{ key: 'name', label: 'Name', value: '' }], check: (v) => (v.name.trim() ? '' : 'A set needs a name'), then: (v) => { (sv.__recs['guardrails/Sets'] ||= recsSeed('guardrails', 'Sets')).unshift(editable(v.name, '0 deny rules · 0 protected paths · no project')); return `Set created: ${v.name}`; } }) }], list: [
        readOnlySet('Default', 'Built in · 6 deny rules · 3 protected paths · 5 projects', 'Deny: `rm -rf`, `git push --force`, `curl | sh`. Protected: `.env`, `.git/`, `~/.ssh`.'),
        editable('Strict', '14 deny rules · 6 protected paths · 1 project'),
        readOnlySet('Team policy', 'From the team policy · 9 deny rules · read-only', 'Ships with acme/worca-policy; a change opens a pull request there.'),
      ] },
    ] },

    memory: { min: 'advanced', title: 'Memory', meta: 'What agents remember between runs, as notes Worca keeps tidy.', sections: [
      { title: 'Health', min: 'expert', rows: [
        { name: 'Notes', say: '**{healthWords}** · tidied {tidied}', vals: { healthWords: (sv) => `Healthy · ${(sv.__recs['memory/Notes'] || NOTES).length} notes`, tidied: '3 days ago' }, acts: [{ label: 'Tidy now', do: (sv) => { sv.tidied = 'just now'; return 'Notes tidied'; } }] },
      ] },
      { title: 'Proposals', meta: 'Changes runs suggest; nothing changes until you approve.', empty: 'Nothing to approve', list: [
        { title: 'testing.md', meta: 'Update · from run #412 · 2h ago', mark: 'is-amber', menu: ['Approve', 'Reject'], on: { Approve: (r, x) => { x.remove(); x.add({ ...note('testing.md', 'How we test · today · from run #412') }, 'memory/Notes'); return 'testing.md approved'; } } },
      ] },
      { title: 'Notes', actions: [{ label: 'New note', edit: (sv) => ({ title: 'New note', yes: 'Create', fields: [{ key: 'name', label: 'Name', value: '', hint: 'A file name, such as testing.md' }, { key: 'body', label: 'Note', value: '', multiline: true }], check: (v) => (v.name.trim() ? '' : 'A note needs a name'), then: (v) => { (sv.__recs['memory/Notes'] ||= recsSeed('memory', 'Notes')).unshift({ ...note(v.name, 'Today · from you'), id: 'n' + Date.now() }); return `Note created: ${v.name}`; } }) }], empty: 'No notes yet', list: NOTES },
      { title: 'Team memory', rows: [
        { name: 'Load', help: 'Local is team memory off', say: 'Runs and chats load {teamLoad}', picks: { teamLoad: P('local', O(['local', 'this machine\'s notes'], ['team', 'the team\'s notes only'], ['both', 'yours and the team\'s']), 'Team and Both share this project\'s notes on the worca-memory branch') } },
        { name: 'Sync', when: (sv) => sv.teamLoad !== 'local', say: 'Branch `worca-memory` on origin · fetched {teamSync}', vals: { teamSync: '5 minutes ago' }, acts: [{ label: 'Sync now', do: (sv) => { sv.teamSync = 'just now'; return 'Team memory synced'; } }] },
        { name: 'Share notes', when: (sv) => sv.teamLoad !== 'local', say: '{shareWords}', vals: { shareWords: (sv) => (sv.seeded ? 'Your 2 local notes are shared' : '2 local notes are not shared yet') },
          acts: [
            { label: 'Share…', when: (sv) => !sv.seeded, edit: { title: 'Share existing notes', yes: 'Share them', note: 'Pushes your notes to the `worca-memory` branch, where teammates load them. You can undo the last sharing.', then: (v, sv) => { sv.seeded = true; for (const r of sv.__recs['memory/Team memory'] || []) if (r.tstate === 'Local only') { r.tstate = 'Shared'; } return '2 notes shared'; } } },
            { label: 'Undo', when: (sv) => sv.seeded, do: (sv) => { sv.seeded = false; for (const r of sv.__recs['memory/Team memory'] || []) if (r.tstate === 'Shared' && r.mine) r.tstate = 'Local only'; return 'Sharing undone'; } },
          ] },
      ], list: [
        teamNote('architecture.md', 'Local only', 'Yours', true),
        teamNote('conventions.md', 'Local only', 'Yours', true),
        teamNote('release.md', 'Team only', 'From @dana · 2 Oct'),
        teamNote('secrets-howto.md', 'Held', 'Held back: it looks like it holds a secret'),
      ] },
      { title: 'History', empty: 'Nothing to restore', list: [
        { title: 'Before tidying', meta: '3 days ago · 31 notes', menu: ['Restore'], on: { Restore: (r, x) => { x.remove(); return 'Notes restored from before tidying'; } } },
      ] },
    ] },

    plugins: { min: 'advanced', title: 'Plugins', meta: 'What you installed from the Marketplace, and where Worca looks for more.', sections: [
      { title: 'Installed', actions: [{ label: 'Open Marketplace', page: 'marketplace', say: 'Opens the Marketplace, the store in the sidebar' }], empty: 'Nothing installed', list: [
        plugin('Jira', 'A task source · worca-official · 1 update', 'pJira', true, { mark: 'is-amber', menu: ['Update', 'Settings', 'Uninstall'], url: 'https://acme.atlassian.net' }),
        plugin('Azure Boards', 'A task source · worca-official', 'pAzure', true, { url: 'https://dev.azure.com/acme' }),
        plugin('GitHub Issues', 'A task source · worca-official', 'pIssues', false, { url: 'https://github.com/acme' }),
        plugin('Telegram', 'A chat channel · bot token set', 'pTg', true, { fields: [{ key: 'allowed', label: 'Allowed chat IDs', value: '', hint: 'Replies from these chats count' }] }),
        plugin('Discord', 'A chat channel · bot token set', 'pDiscord', true, { fields: [{ key: 'allowed', label: 'Allowed chat IDs', value: '', hint: 'Replies from these chats count' }] }),
        plugin('Slack', 'A chat channel · needs a bot token', 'pSlack', false, { menu: ['Set up…', 'Uninstall'] }),
        plugin('Teams', 'A chat channel · needs a bot token', 'pTeams', false, { menu: ['Set up…', 'Uninstall'] }),
      ] },
      { title: 'Ticket updates', flag: 'ticketUpdates', meta: 'What a finished run does to its ticket. A project\'s own rule wins over All projects.', actions: [
        { label: 'Add rule', edit: (sv) => ({ title: 'Add a project rule', yes: 'Add', fields: [{ key: 'proj', label: 'Project', value: '', hint: sv.tuTracker === 'github' ? 'A repository: owner/repo' : 'A project you work on' }, { key: 'to', label: 'Move its ticket', value: 'done', options: [['none', 'Don\'t move'], ['done', 'Any Done status'], ...MOVES[sv.tuTracker].map((m) => [m, m])] }], check: (v) => (v.proj.trim() ? '' : 'A rule needs a project'), then: (v) => { (sv.__recs['plugins/Ticket updates'] ||= recsSeed('plugins', 'Ticket updates')).push({ ...rule(v.proj, sv.tuTracker, v.to), id: 'n' + Date.now() }); return `Rule added for ${v.proj}`; } }) },
      ], rows: [
        { name: 'Tracker', say: 'Rules for {tuTracker}', picks: { tuTracker: P('jira', TRACKERS, 'A tracker plugin keeps its own projects and rules; for GitHub Issues a project is a repository') } },
        { name: 'Projects', help: 'None picked means all projects', say: 'New run and Requirements list only **{tuProjects}**', vals: { tuProjects: 'WEB, API, INFRA' }, acts: [edit('Change your projects', [{ key: 'tuProjects', label: 'Projects you work on', hint: 'Comma-separated; none means all. Removing one keeps its rule' }], { done: 'Projects saved' })] },
        { name: 'All projects', say: 'When a run finishes successfully, {tuAll}', picks: { tuAll: P('done', O(['none', 'don\'t move its ticket'], ['done', 'move it to any Done status', 'One the ticket can reach, never Won\'t Do, Rejected or Duplicate']), 'Unless a project below says otherwise') } },
      ], list: [
        rule('WEB', 'jira', MOVES.jira[0]),
        rule('INFRA', 'jira', 'none', 'Resolved'),
        rule('Billing', 'azure', 'Closed'),
        rule('acme/worca', 'github', 'closed'),
      ], empty: 'No project rules' },
      { title: 'Sources', actions: [{ label: 'Add marketplace', edit: (sv) => ({ title: 'Add a marketplace', yes: 'Add', fields: [{ key: 'where', label: 'Repository or folder', value: '' }], check: (v) => (v.where.trim() ? '' : 'Say where it is'), then: (v) => { (sv.__recs['plugins/Sources'] ||= recsSeed('plugins', 'Sources')).push({ id: 'n' + Date.now(), title: v.where, meta: 'Synced just now', menu: ['Remove'] }); return `Marketplace added: ${v.where}`; } }) }], list: [
        { title: 'worca-official', meta: '12 plugins', fig: 'synced 5 min ago', menu: ['Refresh'], on: { Refresh: (r) => { r.fig = 'synced just now'; return 'worca-official refreshed'; } } },
        { title: 'team-internal', meta: 'Can\'t be reached · last synced yesterday', mark: 'is-amber', menu: ['Try again', 'Remove'], on: { 'Try again': (r) => { r.mark = ''; r.meta = '4 plugins'; r.fig = 'synced just now'; r.menu = ['Refresh', 'Remove']; r.on = { Refresh: (x) => { x.fig = 'synced just now'; return 'team-internal refreshed'; } }; return 'team-internal is back'; } } },
      ] },
    ] },

    connectors: { min: 'advanced', title: 'Connectors', meta: 'MCP servers and skills, grouped in sets that projects follow.', sections: [
      { title: 'Sets', actions: [{ label: 'New set', edit: addTo('connectors/Sets', 'New set', 'Name', '0 servers · 0 skills · no project', ['Rename', 'Duplicate', 'Delete']) }], list: [
        { title: 'General', meta: 'Built in · 3 servers · 2 skills · Chat and 5 projects', menu: ['Duplicate'], copy: { menu: ['Rename', 'Duplicate', 'Delete'], meta: '3 servers · 2 skills · no project' } },
        { title: 'Frontend', meta: '2 servers · 1 skill · 2 projects', menu: ['Rename', 'Duplicate', 'Delete'] },
      ] },
      { title: 'Servers', actions: [{ label: 'Add server', edit: addTo('connectors/Servers', 'Add a server', 'Name', 'stdio · in no set', ['Edit', 'Remove']) }], empty: 'No servers', list: [
        { title: 'github', meta: 'stdio · in 2 sets', menu: ['Edit', 'Remove'] },
        { title: 'postgres', meta: 'stdio · needs a secret in Frontend', mark: 'is-amber', menu: ['Edit', 'Remove'] },
      ] },
      { title: 'Skills', actions: [{ label: 'Import skill', edit: addTo('connectors/Skills', 'Import a skill', 'Skill', 'From your Claude Code skills · in no set', ['Edit', 'Remove']) }], empty: 'No skills', list: [
        { title: 'pdf-tools', meta: 'From your Claude Code skills · in 1 set', menu: ['Edit', 'Remove'] },
      ] },
    ] },
  };

  // Function declarations, so the table above reads top down.
  function launcher(key, name, apps) {
    return { title: `Change the ${name.toLowerCase()}`, yes: 'Save', fields: [
      { key: 'app', label: 'Pick an app', value: '', options: apps, then: (v) => { v[key] = v.app; } },
      { key, label: 'Command', hint: '{folder} marks where the checkout goes; without it, the folder is added at the end' },
      { key: 'try', button: 'Try', hint: 'Opens the folder with this command', do: (v) => `Ran ${v[key]}` },
    ], then: (v, sv) => { sv[key] = v[key]; return `${name} saved`; } };
  }
  function preset(title, scope, tail, mark) {
    return { title, scope, tail, mark, meta: `${scope} · ${tail}`, menu: ['Use', 'Rename', 'Duplicate', 'Edit scope', 'Delete'], live: (sv, r) => `${r.scope} · ${r.tail}`,
      on: {
        Use: (r, x) => { x.click(['[data-newrun]']); return `New run starts from ${r.title}`; },
        'Edit scope': (r, x) => x.dialog({ title: `Scope of ${r.title}`, yes: 'Save', fields: [{ key: 'scope', label: 'Offered on', value: r.scope, options: O('Any project', 'Only worca-cc', 'Only billing workspace') }], then: (v) => { r.scope = v.scope; r.mark = ''; return `${r.title}: ${v.scope}`; } }),
      } };
  }
  function chatModel(e, title) {
    return { title, model: e === 'claude' ? 'Sonnet 5.5' : '', live: (sv, r) => (r.model ? r.model : (e === 'gemini' || e === 'qwen' ? 'Needs a model of its own' : 'Worca\'s default')),
      menu: (r) => (r.model ? ['Test', 'Change', 'Clear'] : ['Change']),
      on: {
        Test: (r) => `One tiny prompt to ${r.model}: answered in 1.1s`,
        Change: (r, x) => x.dialog({ title: `Chat on ${title}`, yes: 'Save', fields: [{ key: 'to', label: 'Model', value: r.model || (ENGINE_MODELS[e][0][0][1]), options: ENGINE_MODELS[e][0].map(([, t]) => [t, t]) }], then: (v) => { r.model = v.to; return `Chat on ${title}: ${v.to}`; } }),
        Clear: (r) => { r.model = ''; return `Chat on ${title}: back to the default`; },
      } };
  }
  function importModels(where) {
    return { title: 'Import models', yes: 'Import', note: 'What your providers offer that the catalogue does not have yet.', fields: [
      { key: 'impA', check: true, label: 'gpt-5 (Copilot)', value: true }, { key: 'impB', check: true, label: 'Sonnet 5 (Copilot)', value: true }, { key: 'impC', check: true, label: 'Gemini Pro (hosted API, GEMINI_API_KEY)', value: false },
    ], then: (v, sv) => {
      const l = (sv.__recs[where] ||= recsSeed(...where.split('/'))), names = [v.impA && 'gpt-5-copilot', v.impB && 'sonnet-5-copilot', v.impC && 'gemini-pro'].filter(Boolean);
      names.forEach((n, i) => l.unshift({ id: 'i' + Date.now() + i, title: n, meta: 'Imported just now', menu: ['Edit', 'Remove'] }));
      return names.length ? `Imported ${names.length} models` : 'Nothing picked';
    } };
  }
  function openaiSetup(r) {
    return { title: 'OpenAI-compatible', yes: 'Save', fields: [
      { key: 'preset', label: 'Preset', value: r.preset || 'none', options: O(['none', 'None: your own endpoint'], ['openrouter', 'OpenRouter']), then: (v) => { if (v.preset === 'openrouter') { v.url = OPENROUTER.base; v.key = OPENROUTER.key; } } },
      { key: 'url', label: 'Base URL', value: r.url || '', type: 'url' }, { key: 'key', label: 'Key', value: r.url ? '${OPENAI_KEY}' : '', hint: 'A stored key is never replaced by a preset' },
    ], check: (v) => (v.url.trim() ? '' : 'It needs a base URL'), then: (v, sv) => { r.url = v.url; r.preset = v.preset; r.mark = 'is-green'; sv.orLeft = sv.orLeft ?? 820; return v.preset === 'openrouter' ? 'OpenRouter set up' : 'OpenAI-compatible saved'; } };
  }
  function readOnlySet(title, meta, rules) {
    return { title, meta, menu: ['View', 'Save as new set'], open: (r, x) => r.on.View(r, x),
      on: {
        View: (r, x) => x.dialog({ title: r.title, yes: 'Save as new set', note: rules, then: () => saveAs(r, x) }),
        'Save as new set': (r, x) => saveAs(r, x),
      } };
  }
  function saveAs(r, x) { x.add(editable(`${r.title} copy`, meta2(r)), 'guardrails/Sets'); return `Saved as ${r.title} copy`; }
  function meta2(r) { return r.meta.replace(/^(Built in|From the team policy) · /, '').replace(/ · (read-only|\d+ projects?)$/, '') + ' · no project'; }
  function editable(title, meta) {
    return { id: 'n' + title, title, meta, menu: ['Edit', 'Duplicate', 'Delete'], open: (r, x) => SHARED_EDIT(r, x), on: { Edit: (r, x) => SHARED_EDIT(r, x) } };
  }
  function SHARED_EDIT(r, x) {
    return x.dialog({ title: `Edit ${r.title}`, yes: 'Save', fields: [{ key: 'name', label: 'Name', value: r.title }, { key: 'deny', label: 'Deny rules', value: '`rm -rf`, `git push --force`', multiline: true }, { key: 'paths', label: 'Protected paths', value: '.env, .git/', multiline: true }], then: (v) => { r.title = v.name.trim() || r.title; return `${r.title} saved`; } });
  }
  function note(title, meta) { return { title, meta, menu: ['Rename', 'Delete'], open: (r, x) => x.dialog({ title: r.title, yes: 'Save', fields: [{ key: 'body', label: 'Note', value: `# ${r.title}\n\nWhat the agents should remember.`, multiline: true }], then: () => `${r.title} saved` }) }; }
  function teamNote(title, tstate, meta, mine) {
    return { title, tstate, mine, meta, when: (sv) => sv.teamLoad !== 'local', chip: undefined, live: (sv, r) => `${r.tstate} · ${r.meta}`, mark: tstate === 'Held' ? 'is-amber' : '',
      menu: (r) => (r.tstate === 'Team only' ? ['Compare'] : r.tstate === 'Held' ? ['Compare', 'Share anyway'] : ['Compare', 'Remove from team']),
      on: {
        Compare: (r, x) => x.dialog({ title: `Compare ${r.title}`, view: true, yes: 'Close', note: r.tstate === 'Team only' ? 'The team has this note; this machine does not.' : 'Yours and the team\'s are the same, but for one line.' }),
        'Share anyway': (r) => { r.tstate = 'Shared'; r.mark = ''; return `${r.title} shared`; },
        'Remove from team': (r) => { r.tstate = 'Local only'; return `${r.title}: removed from the team, kept here`; },
      } };
  }
  function addTo(where, title, label, meta, menu) {
    return (sv) => ({ title, yes: 'Add', fields: [{ key: 'name', label, value: '' }], check: (v) => (v.name.trim() ? '' : `It needs a ${label.toLowerCase()}`), then: (v) => { (sv.__recs[where] ||= recsSeed(...where.split('/'))).unshift({ id: 'n' + Date.now(), title: v.name, meta, menu }); return `Added: ${v.name}`; } });
  }
  function recsSeed(id, title) { return SECTIONS[id].sections.find((s) => s.title === title).list.map((it, i) => ({ ...it, id: 'r' + i })); }

  const GROUPS = [
    { title: 'Worca', items: ['general', 'notifications', 'team', 'experimental'] },
    { title: 'Work', items: ['runs', 'presets', 'labels', 'automations'] },
    { title: 'AI', items: ['models', 'providers', 'ask', 'guardrails', 'memory'] },
    { title: 'Add-ons', items: ['plugins', 'connectors'] },
  ];
  const NOTIFICATIONS = { title: 'Notifications', meta: 'Pulse keeps everything; these choices say what else reaches you, and what a start does near a limit.' };
  window.SettingsModel = {
    GROUPS, SECTIONS, FLAGS, STATE, FIRST: 'general',
    title: (id) => (id === 'notifications' ? NOTIFICATIONS : SECTIONS[id] || { title: id }).title,
    meta: (id) => (id === 'notifications' ? NOTIFICATIONS : SECTIONS[id] || { meta: '' }).meta,
    min: (id) => (SECTIONS[id] || {}).min || '',
    flag: (id) => (SECTIONS[id] || {}).flag || '',
    shows: (min, level) => window.RailUI.shows(min, level),   // the one rule is the library's
    // Whether a section is in the menu: its level and its Labs flag.
    visible: (id, level) => { const x = SECTIONS[id] || {}; return window.RailUI.shows(x.min, level) && (!x.flag || window.RailUI.prefs.flag(x.flag)); },
  };
})();
