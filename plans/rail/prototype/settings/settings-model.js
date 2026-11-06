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
// A row: { name, help, min, say: 'words, {key} where a picker sits, **strong**, `code`', picks: { key: { value,
//   options: [[id, text, help]], tip, right } }, sw: { key, on, why }, acts: [{ label, kind, help, go, edit }],
//   more: [rows], moreList: [records] }. A record: { title, meta, mark, fig, sw, menu: [labels] }.
// A section: { title, meta, min, action: { label, confirm, help, edit }, rows, list }.
(function () {
  const O = (...xs) => xs.map((x) => (Array.isArray(x) ? x : [x, x]));
  const P = (value, options, tip, right) => ({ value, options, tip, right });
  const EFFORT = O('medium', 'high', 'xhigh', 'max');
  const MODEL = O(['sonnet', 'Sonnet 5.5'], ['opus', 'Opus 5.5'], ['haiku', 'Haiku 5.5'], ['fable', 'Fable 5.1']);
  const edit = (title, fields, o = {}) => ({ label: 'Change…', edit: { title, fields, yes: 'Save', ...o } });
  const ENGINES = O(['claude', 'Claude'], ['codex', 'Codex (beta)'], ['copilot', 'Copilot (beta)'], ['cursor', 'Cursor (beta)'], ['gemini', 'Gemini CLI (beta)'], ['goose', 'Goose (beta)'], ['opencode', 'OpenCode (beta)'], ['qwen', 'Qwen Code (beta)']);

  const SECTIONS = {
    general: { title: 'General', meta: 'Setup, storage, and which version of Worca runs.', sections: [
      { title: 'Setup', rows: [
        { name: 'Setup assistant', say: 'Checks Claude, git and your projects, and fixes what is missing', acts: [{ label: 'Open assistant' }] },
        { name: 'Getting started', say: 'The first nine things to do, and the guided tour', acts: [{ label: 'Show checklist' }] },
      ] },
      { title: 'Storage', min: 'advanced', rows: [
        { name: 'Folders', say: 'Runs live in `~/.worca`; new projects are cloned into `~/src`', acts: [edit('Change the folders', [{ label: 'Worca folder', value: '~/.worca', hint: 'Runs, history and settings; runs pause while they move' }, { label: 'Projects folder', value: '~/src', hint: 'Where a new project is cloned' }], { done: 'Folders saved' })] },
        { name: 'Diagnostics', min: 'expert', say: 'Log each Claude start: its binary, arguments and routing', sw: { key: 'spawnLog', on: false, why: 'Writes them to the server log' } },
      ] },
      { title: 'Credentials', meta: 'Shown when Worca runs with your team\'s credential broker.', rows: [
        { name: 'Model keys', say: 'Claude and OpenAI keys come from **the broker**', acts: [{ label: 'Manage keys' }] },
        { name: 'GitHub', say: 'Signed in as **@emil-angelov**' },
      ] },
      { title: 'Browser extension', rows: [
        { name: 'Install', say: 'Add Worca to {browser}', picks: { browser: P('chrome', O(['chrome', 'Chrome'], ['edge', 'Edge'], ['firefox', 'Firefox']), 'Which browser to install it in') }, acts: [{ label: 'Install' }] },
      ], list: [
        { title: 'MacBook · Chrome', meta: 'Paired 2 Oct · last used today', menu: ['Revoke'] },
        { title: 'Work PC · Edge', meta: 'Paired 14 Sep · not used yet', menu: ['Revoke'] },
      ] },
      { title: 'About', rows: [
        { name: 'Version', say: 'Worca **1.17.0** · up to date', acts: [{ label: 'Check now' }], more: [
          { name: 'Updates', say: 'Look for new versions of Worca once a day', sw: { key: 'updates', on: true, why: 'Nothing installs by itself' } },
          { name: 'Release notes', say: 'Changes since 1.16.0', acts: [{ label: 'Open' }] },
        ] },
        { name: 'Feedback', say: 'Ideas and problems go to the Worca team on GitHub', acts: [{ label: 'Send feedback' }] },
      ] },
    ] },

    team: { min: 'advanced', title: 'Team policy', meta: 'What your team requires of every Worca that follows its policy.', sections: [
      { title: 'Policy', rows: [
        { name: 'Home', say: 'Follows **acme/worca-policy** · synced today', acts: [edit('Change the policy home', [{ label: 'Repository', value: 'acme/worca-policy', hint: 'The project whose marker branch carries the policy' }], { yes: 'Follow it', done: 'Now following acme/worca-policy' })] },
        { name: 'Consent', say: 'Accepted on 2 Oct; a change to it asks again', acts: [{ label: 'Review' }] },
        { name: 'Editing', say: 'A change opens a pull request on `worca-policy`', acts: [{ label: 'Edit policy' }] },
      ] },
      { title: 'Requirements', rows: [
        { name: 'Spending', say: 'Each run up to **$50**, all runs **$2,000 a month**; a run may go past', acts: [{ label: 'Open Runs', go: 'runs' }] },
        { name: 'Plugins', say: 'Requires **Jira** and **Slack** · **1 missing here**', acts: [{ label: 'Install all…' }] },
        { name: 'Blocked', say: 'An unknown MCP server is blocked; a run with one is marked off-policy' },
        { name: 'Guardrails', say: 'Ships the **Team policy** set, read-only here', acts: [{ label: 'Open', go: 'guardrails' }] },
        { name: 'Models', say: 'Ships **Opus via Acme gateway**', acts: [{ label: 'Open', go: 'models' }] },
      ] },
    ] },

    experimental: { title: 'Labs', meta: 'Features still being shaped. Each switch applies to everyone using this Worca.', sections: [
      { title: 'Features', action: { label: 'Reset all', confirm: 'Turn every Labs feature back to its default?', help: 'Every feature back to its default; asks first' }, rows: [
        { name: 'Command summaries', help: 'Beta', say: 'Commands in Chat show as one line saying what they do', sw: { key: 'fCmd', on: true, why: 'Beta: on unless you turn it off' } },
        { name: 'Run labels', say: 'Free-word labels on runs, with a Label filter on the Runs list', sw: { key: 'fLabels', on: false } },
        { name: 'Smart run naming', say: 'A quick model suggests the run title and a branch name as you type', sw: { key: 'fNaming', on: false, why: 'Also Runs › Naming' } },
        { name: 'Requirements', say: 'Turn an idea into a testable spec through a short interview, before any run', sw: { key: 'fReq', on: false } },
        { name: 'Run telemetry', say: 'Runs record context size, tokens and timing of every model call', sw: { key: 'fTele', on: false } },
        { name: 'Git automations', say: 'Start a workflow when an issue or a pull request is opened', sw: { key: 'fAuto', on: false, why: 'Adds Settings › Automations' } },
        { name: 'One session', say: 'Run 2–4 steps in a row as one session', sw: { key: 'fSess', on: false } },
      ] },
    ] },

    runs: { title: 'Runs', meta: 'How runs spend, start and wait.', sections: [
      { title: 'Spending', meta: 'Spent this month: $412 of $1,000.', rows: [
        { name: 'Budget', say: 'Runs pause at **$1,000 a month**; one run has no limit', acts: [{ label: 'Usage', help: 'What was spent, per harness: the profile menu\'s Usage and costs' }], more: [
          { name: 'Per run', say: 'A run pauses when it has spent {perRun}', picks: { perRun: P('none', O(['none', 'no limit'], ['5', '$5'], ['10', '$10'], ['25', '$25'], ['50', '$50'], ['100', '$100']), 'The most one run may spend before it pauses') } },
          { name: 'Total', say: 'Every run pauses at {total} a {period}', picks: { total: P('1000', O(['none', 'no limit'], ['250', '$250'], ['500', '$500'], ['1000', '$1,000'], ['2500', '$2,500']), 'The most all runs together may spend'), period: P('month', O(['week', 'week (from Monday)'], ['month', 'month (from the 1st)']), 'When the total starts again') } },
          { name: 'Hourly rate', say: 'Time saved is counted at {rate} an hour', picks: { rate: P('35', O(['25', '$25'], ['35', '$35'], ['50', '$50'], ['75', '$75'], ['100', '$100']), 'What an hour of a developer costs, for Statistics') } },
        ] },
        { name: 'Cost tags', say: 'Spend is counted by **Cost centre** and **Customer**; a run needs its Cost centre', more: [
          { name: 'Required', say: 'A run starts only with every required cost tag set', sw: { key: 'tagsReq', on: true } },
        ], moreList: [
          { title: 'Cost centre', meta: 'R&D, Platform, Support · required', menu: ['Edit', 'Remove'] },
          { title: 'Customer', meta: 'Any value · optional', menu: ['Edit', 'Remove'] },
        ] },
      ] },
      { title: 'Start', rows: [
        { name: 'Naming', say: 'Suggest a title and a branch name as you type', sw: { key: 'naming', on: false, why: 'Labs › Smart run naming' }, more: [
          { name: 'Suggestions', say: 'Suggest {what} for a new run, {when}', picks: { what: P('both', O(['both', 'a title and a branch name'], ['title', 'a title'], ['branch', 'a branch name']), 'What the model suggests'), when: P('typing', O(['typing', 'while you type the task'], ['ask', 'when you press Suggest']), 'When it suggests', true) } },
          { name: 'Branch', say: 'Branches are named `{type}/{slug}`, the type one of feat, fix, chore, docs, refactor, test', acts: [edit('Change the branch pattern', [{ label: 'Pattern', value: '{type}/{slug}', hint: '{type}, {slug} and {id} are filled in' }, { label: 'Types', value: 'feat, fix, chore, docs, refactor, test', hint: 'The model picks one of these' }], { done: 'Branch pattern saved' })] },
          { name: 'Run id', say: 'Add the run id to the branch name', sw: { key: 'runId', on: false } },
          { name: 'Model', say: 'Uses the **Run naming** model', acts: [{ label: 'Open Models', go: 'models', help: 'Models › Engine › Helper jobs' }] },
        ] },
        { name: 'Sync', say: 'Bring the source branch up to date first', sw: { key: 'sync', on: true }, more: [
          { name: 'Remote', say: 'Sync from {remote}; if the branch has diverged, {div}', picks: { remote: P('origin', O('origin', 'upstream'), 'The remote to sync from'), div: P('ask', O(['ask', 'ask me'], ['origin', 'start from origin'], ['stop', 'don\'t run']), 'What a run does when the branch has diverged', true) } },
          { name: 'Background checks', say: 'Check remotes {bg}', picks: { bg: P('10', O(['off', 'never'], ['5', 'every 5 minutes'], ['10', 'every 10 minutes'], ['30', 'every 30 minutes'], ['60', 'every hour']), 'How often Worca looks for new commits') } },
        ] },
        { name: 'Pull requests', say: 'Draft the description with AI as the PR opens', sw: { key: 'prDraft', on: false } },
      ] },
      { title: 'Away mode', min: 'advanced', meta: 'Going away is the Away switch in your profile menu.', rows: [
        { name: 'Hours', say: 'Worca answers your runs\' questions from **22:00 to 07:00**, Europe/Sofia', more: [
          { name: 'Times', say: '**22:00–07:00**, Europe/Sofia', acts: [edit('Change the away hours', [{ label: 'From', value: '22:00' }, { label: 'To', value: '07:00' }, { label: 'Time zone', value: 'Europe/Sofia' }], { done: 'Away hours saved' })] },
          { name: 'Runs', say: 'Worca answers on {which}; a marked run is also answered by day after {byDay}', picks: { which: P('marked', O(['marked', 'runs you marked'], ['all', 'every run']), 'Which runs Worca answers on while you are away'), byDay: P('30', O(['never', 'never'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', 'an hour']), 'How long a question waits by day before Worca answers it', true) } },
          { name: 'Decisions', say: 'It {method}, trusting the agent at {sure} sure with a lead of {lead}', picks: { method: P('mixed', O(['mixed', 'trusts a sure agent, else weighs', 'Trusts the agent when it is sure; otherwise weighs the options'], ['trust', 'always trusts the agent'], ['weigh', 'always weighs the options']), 'How Worca picks an answer'), sure: P('60', O(['50', '50%'], ['60', '60%'], ['70', '70%'], ['80', '80%']), 'How sure the agent must be'), lead: P('25', O(['15', '15 points'], ['25', '25 points'], ['40', '40 points']), 'How far its pick must lead the next one', true) } },
          { name: 'Priorities', say: 'Matches past decisions **3** · easy to undo **3** · changes least **2** · conventions **2** · cheapest **1**', acts: [edit('Change the priorities', [{ label: 'Matches past decisions', value: '3', hint: '0 ignores it, 10 decides' }, { label: 'Easy to undo', value: '3' }, { label: 'Changes the least', value: '2' }, { label: 'Follows the conventions', value: '2' }, { label: 'Costs the least', value: '1' }], { done: 'Priorities saved' })] },
          { name: 'Model', say: '{dmodel} at {deffort} effort', picks: { dmodel: P('run', O(['run', 'the run\'s own model'], ...MODEL), 'The model that weighs the options'), deffort: P('medium', EFFORT, 'Its effort') } },
          { name: 'Limits', say: 'Pause a run after {answers} answers, and everything at {spent} spent while away', picks: { answers: P('20', O('10', '20', '40'), 'Answers in one run before it pauses'), spent: P('none', O(['none', 'no cap'], ['25', '$25'], ['50', '$50'], ['100', '$100']), 'Spent while away before every run pauses', true) } },
          { name: 'Review loops', say: 'Allow {extra} extra fix rounds; the team cap is {exceed}', picks: { extra: P('0', O('0', '1', '2', '3'), 'Fix rounds beyond the workflow\'s own'), exceed: P('kept', O(['kept', 'kept'], ['exceed', 'allowed to be exceeded']), 'Whether away answers may go over the team\'s cost cap', true) } },
          { name: 'Exceptions', say: 'Always waits for you on approving a plan, merging and deleting', acts: [{ label: 'Change…' }] },
        ] },
      ] },
      { title: 'Machine', min: 'advanced', rows: [
        { name: 'Capacity', say: 'Up to **3** runs at a time; finished runs are kept', more: [
          { name: 'Parallel runs', say: 'Up to {n} runs at a time; each tests with {w}', picks: { n: P('3', O('1', '2', '3', '4', '6', '8', '12', '20'), 'More runs wait in line'), w: P('half', O(['half', 'half the cores'], ['1', '1 worker'], ['2', '2 workers'], ['4', '4 workers'], ['8', '8 workers']), 'Test workers per run', true) } },
          { name: 'Archive', say: 'Archive finished runs after {arch}', picks: { arch: P('never', O(['never', 'never'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', 'a year']), 'Archiving removes the branch, worktree and logs') } },
          { name: 'Checkouts', say: 'An action\'s checkout is {keep}; keep at most {coMax}', picks: { keep: P('demand', O(['demand', 're-created when needed'], ['success', 'kept after a successful run'], ['pr', 'kept until the PR closes']), 'When a checkout is removed'), coMax: P('none', O(['none', 'any number'], ['5', '5'], ['10', '10'], ['20', '20']), 'The oldest go first', true) } },
          { name: 'Ports', say: 'Port variables come from `4400–4499`', acts: [edit('Change the ports', [{ label: 'From', value: '4400' }, { label: 'To', value: '4499' }], { done: 'Ports saved' })] },
          { name: 'Editor', say: 'Opens files in **VS Code** (found on this machine)', acts: [edit('Change the editor', [{ label: 'Editor', value: 'code', hint: 'The command that opens a file' }], { done: 'Editor saved' })] },
          { name: 'Terminal', say: 'Opens shells in **iTerm** (found on this machine)', acts: [edit('Change the terminal', [{ label: 'Terminal', value: 'iTerm', hint: 'The app that opens a shell' }], { done: 'Terminal saved' })] },
          { name: 'Scans', say: 'Scan a workspace with {scan} at {se} effort; write project agents with {agent} at {ae} effort', picks: { scan: P('sonnet', MODEL, 'The model that scans a workspace'), se: P('medium', EFFORT, 'Its effort'), agent: P('sonnet', MODEL, 'The model that writes project agents'), ae: P('medium', EFFORT, 'Its effort', true) } },
        ] },
        { name: 'Network', say: 'A direct connection; a run waits up to **4 hours** offline', more: [
          { name: 'Proxy', say: 'Through **proxy.corp.example:8080**, signing in with {auth}', picks: { auth: P('ntlm', O(['ntlm', 'NTLMv2'], ['basic', 'Basic'], ['digest', 'Digest'], ['none', 'no login']), 'How Worca signs in to the proxy') }, acts: [edit('Change the proxy', [{ label: 'Host', value: 'proxy.corp.example' }, { label: 'Port', value: '8080' }, { label: 'Domain', value: 'CORP' }, { label: 'User name', value: 'emil' }], { yes: 'Save and test', done: 'Proxy saved; tested and working' })], sw: { key: 'proxy', on: false, why: 'Off: Worca connects directly' } },
          { name: 'Bypass', say: 'These go direct: `localhost`, `*.corp.example`', acts: [edit('Change the bypass list', [{ label: 'Hosts', value: 'localhost, *.corp.example', hint: 'Comma-separated; * matches any part' }], { done: 'Bypass list saved' })] },
          { name: 'Timeouts', min: 'expert', say: 'Connect within {ct}, sign in within {lt}, drop idle after {it}', picks: { ct: P('60', O(['30', '30s'], ['60', '60s'], ['120', '120s']), 'Connect timeout'), lt: P('60', O(['30', '30s'], ['60', '60s'], ['120', '120s']), 'Login timeout'), it: P('300', O(['120', '2 minutes'], ['300', '5 minutes'], ['600', '10 minutes']), 'Idle timeout', true) } },
          { name: 'Offline', say: 'When the network drops, a run waits up to {wait}', picks: { wait: P('4h', O(['30m', '30 minutes'], ['1h', '1 hour'], ['4h', '4 hours'], ['12h', '12 hours'], ['24h', '24 hours']), 'How long it waits before it fails') }, sw: { key: 'netWait', on: true } },
        ] },
        { name: 'Schedules', say: 'A missed start still runs, up to **6 hours** late', more: [
          { name: 'Missed starts', say: 'When Worca was not running, {late} up to {lateMax} late', picks: { late: P('late', O(['late', 'start it'], ['skip', 'skip it']), 'What a scheduled run does when its time passed'), lateMax: P('6h', O(['30m', '30 minutes'], ['1h', '1 hour'], ['6h', '6 hours'], ['24h', '24 hours']), 'How late it may still start', true) } },
          { name: 'Failures', say: 'Pause a repeating schedule after {fails} failures in a row', picks: { fails: P('3', O('2', '3', '5', '10'), 'Failures in a row before it pauses') } },
        ] },
      ] },
    ] },

    presets: { min: 'advanced', title: 'Presets', meta: 'Saved setups a new run can start from. Save one from a run\'s ⋯.', sections: [
      { title: 'Presets', list: [
        { title: 'Bug fix', meta: 'Any project · Fix workflow · Claude · updated 3 Oct', menu: ['Rename', 'Delete'] },
        { title: 'Docs pass', meta: 'Only worca-cc · Docs workflow · Claude · updated 28 Sep', menu: ['Rename', 'Delete'] },
        { title: 'Billing slice', meta: 'Its workspace is gone · Feature workflow', mark: 'is-amber', menu: ['Rename', 'Delete'] },
      ] },
    ] },

    labels: { title: 'Labels', meta: 'Free words you put on runs to find them again.', sections: [
      { title: 'Labels', meta: 'The most used first.', list: [
        { title: 'frontend', meta: 'On 14 runs', menu: ['Rename', 'Remove'] },
        { title: 'needs demo', meta: 'On 6 runs', menu: ['Rename', 'Remove'] },
        { title: 'hotfix', meta: 'On 3 runs', menu: ['Rename', 'Remove'] },
      ] },
    ] },

    automations: { min: 'advanced', title: 'Automations', meta: 'What runs by itself across projects; each project keeps its own rules.', sections: [
      { title: 'Projects', list: [
        { title: 'worca-cc', meta: 'Proposes a fix for new issues and reviews PRs · 3 rules' },
        { title: 'billing workspace', meta: 'Every member repository · reviews PRs · 1 rule' },
      ] },
      { title: 'Waiting', list: [
        { title: 'Issue #1088', meta: 'A fix is proposed · worca-cc', mark: 'is-amber', fig: '2h ago' },
      ] },
      { title: 'Recent', list: [
        { title: 'PR #1087', meta: 'Reviewed · worca-cc', fig: '09:12' },
        { title: 'Issue #1085', meta: 'Skipped: no rule matched · worca-cc', fig: 'yesterday' },
      ] },
    ] },

    models: { min: 'expert', title: 'Models', meta: 'The models every project can pick from; sign-ins are on Providers.', sections: [
      { title: 'Defaults', rows: [
        { name: 'Roles', say: '**Opus** plans and reviews, **Sonnet** writes the code, **Haiku** does quick jobs', more: [
          { name: 'Deep thinking', help: 'Plans and reviews', say: '{deep} at {deepE} effort', picks: { deep: P('opus', MODEL, 'Plans and reviews: worth the strongest model'), deepE: P('high', EFFORT, 'Its effort') } },
          { name: 'Everyday coding', help: 'Writes the code and answers in Chat', say: '{code} at {codeE} effort', picks: { code: P('sonnet', MODEL, 'Writes the code and answers in Chat'), codeE: P('medium', EFFORT, 'Its effort') } },
          { name: 'Quick jobs', help: 'Short, frequent helper calls', say: '{quick} at {quickE} effort', picks: { quick: P('haiku', MODEL, 'Cheap and fast'), quickE: P('medium', EFFORT, 'Its effort') } },
        ] },
        { name: 'Engine', say: 'New runs use {eng}; each step and helper job uses its role', picks: { eng: P('claude', ENGINES, 'The engine a new run starts on') }, more: [
          { name: 'Step models', say: 'Each workflow step\'s model, per engine', acts: [{ label: 'Edit' }] },
          { name: 'Helper jobs', say: 'Titles, PR descriptions, run naming and 5 more', acts: [{ label: 'Edit' }] },
        ] },
      ] },
      { title: 'Catalogue', action: { label: 'Add model', edit: { title: 'Add a model', yes: 'Add', fields: [{ label: 'Model id', value: '', hint: 'Worca\'s handle for it' }, { label: 'Label', value: '' }], done: 'Model added' } }, list: [
        { title: 'claude-sonnet-5-5', meta: 'Your Claude login · priced by the CLI', menu: ['Edit', 'Remove'] },
        { title: 'gpt-5', meta: 'Codex · your ChatGPT sign-in', menu: ['Edit', 'Remove'] },
        { title: 'local-llama', meta: 'Through OpenAI-compatible · free', menu: ['Edit', 'Remove'] },
      ] },
      { title: 'Sources', rows: [
        { name: 'Built-in models', say: 'Show the built-in Anthropic models', sw: { key: 'builtIn', on: true, why: 'Turn off when you don\'t use a first-party Anthropic account' } },
        { name: 'Import', say: 'Bring models in from Copilot or a provider', acts: [{ label: 'Import…' }] },
        { name: 'Sharing', say: 'Share your models with the team as a plugin', acts: [{ label: 'Share…' }] },
      ] },
    ] },

    providers: { min: 'expert', title: 'Providers', meta: 'Sign-ins and keys for the models Worca runs through its own bridge.', sections: [
      { title: 'Providers', list: [
        { title: 'GitHub Copilot', meta: 'Connected as @emil-angelov · Business · 4 requests at once', mark: 'is-green', menu: ['Edit', 'Refresh usage', 'Sign out'] },
        { title: 'OpenAI-compatible', meta: 'Not set up', menu: ['Set up…'] },
        { title: 'Anthropic-compatible', meta: 'llm.corp.example · key set · 8 requests at once', mark: 'is-green', menu: ['Edit', 'Remove'] },
      ] },
      { title: 'Speech', meta: 'Used by Chat\'s voice.', rows: [
        { name: 'Listening', say: 'Chat listens {stt}', picks: { stt: P('browser', O(['browser', 'in the browser'], ['server', 'through your server']), 'Where speech is turned into text') } },
        { name: 'Speaking', say: 'Replies are read aloud {tts}', picks: { tts: P('browser', O(['browser', 'in the browser'], ['server', 'through your server'], ['off', 'never: replies stay text']), 'Where replies are spoken') } },
      ] },
    ] },

    ask: { min: 'advanced', title: 'Chat', meta: 'Worca\'s own assistant: its engine, what it may do and where it may look.', sections: [
      { title: 'Chat', rows: [
        { name: 'Engine', say: 'New chats use {chatEngine}, picking from Sonnet, Opus and Haiku', picks: { chatEngine: P('claude', ENGINES.filter(([id]) => id !== 'cursor'), 'The engine a new chat starts on') }, more: [
          { name: 'Models', say: 'Picks from **Sonnet 5.5**, **Opus 5.5** and **Haiku 5.5**', acts: [{ label: 'Change…' }] },
        ] },
        { name: 'Abilities', say: 'Runs scripts, sums up commands, suggests a next prompt', more: [
          { name: 'Scripts', say: 'Create and run scripts', sw: { key: 'scripts', on: true } },
          { name: 'Summaries', say: 'Show each command as one line saying what it does', sw: { key: 'summaries', on: true, why: 'With Labs › Command summaries on' } },
          { name: 'Suggestions', say: 'Suggest a next prompt after each reply', sw: { key: 'nextPrompt', on: true } },
          { name: 'Limits', say: 'A chat stops after {turns} turns, and a turn at {cap}', picks: { turns: P('400', O('100', '200', '400', '800'), 'Turns in one chat'), cap: P('none', O(['none', 'no cap'], ['1', '$1'], ['5', '$5'], ['10', '$10']), 'What one turn may spend', true) } },
        ] },
        { name: 'Web', say: 'Reads web pages from {web}', picks: { web: P('allowed', O(['allowed', 'the allowed sites'], ['any', 'any site, without asking'])) }, sw: { key: 'webOn', on: false }, more: [
          { name: 'Allowed sites', say: '`docs.python.org`, `developer.mozilla.org`', acts: [edit('Change the allowed sites', [{ label: 'Sites', value: 'docs.python.org, developer.mozilla.org', hint: 'Comma-separated' }], { done: 'Allowed sites saved' })] },
          { name: 'Search', min: 'expert', say: 'Searches with the built-in search', acts: [edit('Use your own search', [{ label: 'Endpoint', value: '' }, { label: 'Key variable', value: '' }, { label: 'Key header', value: '' }], { done: 'Search saved' })] },
        ] },
        { name: 'Connectors', say: 'Uses the **General** set: 3 servers, 2 skills', acts: [{ label: 'Open', go: 'connectors' }] },
      ] },
      { title: 'History', meta: '38 chats kept on this machine.', action: { label: 'Delete all chats', confirm: 'Delete all 38 chats? They cannot be brought back.', yes: 'Delete all', done: 'All chats deleted (not in this prototype)', help: 'Asks first' } },
    ] },

    guardrails: { min: 'advanced', title: 'Guardrails', meta: 'What agents may not touch, as sets a project follows.', sections: [
      { title: 'Sets', action: { label: 'New set', edit: { title: 'New guardrail set', yes: 'Create', fields: [{ label: 'Name', value: '' }], done: 'Set created' } }, list: [
        { title: 'Default', meta: 'Built in · 6 deny rules · 3 protected paths · 5 projects', menu: ['Duplicate'] },
        { title: 'Strict', meta: '14 deny rules · 6 protected paths · 1 project', menu: ['Edit', 'Duplicate', 'Delete'] },
        { title: 'Team policy', meta: 'From the team policy · 9 deny rules · read-only', menu: ['Duplicate'] },
      ] },
    ] },

    memory: { min: 'advanced', title: 'Memory', meta: 'What agents remember between runs, as notes Worca keeps tidy.', sections: [
      { title: 'Health', min: 'expert', rows: [
        { name: 'Notes', say: '**Healthy** · 24 notes · tidied 3 days ago', acts: [{ label: 'Tidy now' }] },
      ] },
      { title: 'Proposals', meta: 'Changes runs suggest; nothing changes until you approve.', list: [
        { title: 'testing.md', meta: 'Update · from run #412 · 2h ago', mark: 'is-amber', menu: ['Approve', 'Reject'] },
      ] },
      { title: 'Notes', action: { label: 'New note', edit: { title: 'New note', yes: 'Create', fields: [{ label: 'Name', value: '', hint: 'A file name, such as testing.md' }, { label: 'Note', value: '', multiline: true }], done: 'Note created' } }, list: [
        { title: 'architecture.md', meta: 'How the server and the UI are split · today · from Chat', menu: ['Rename', 'Delete'] },
        { title: 'conventions.md', meta: 'Naming, commits and tests · 2 Oct · from run #398', menu: ['Rename', 'Delete'] },
      ] },
      { title: 'History', list: [
        { title: 'Before tidying', meta: '3 days ago · 31 notes', menu: ['Restore'] },
      ] },
    ] },

    plugins: { min: 'advanced', title: 'Plugins', meta: 'What you installed from the Marketplace, and where Worca looks for more.', sections: [
      { title: 'Installed', action: { label: 'Open Marketplace', say: 'Opens the Marketplace, the store in the sidebar' }, list: [
        { title: 'Jira', meta: 'A task source · worca-official · 1 update', mark: 'is-amber', sw: { key: 'pJira', on: true }, menu: ['Update', 'Settings', 'Uninstall'] },
        { title: 'Telegram', meta: 'A chat channel · bot token set', sw: { key: 'pTg', on: true }, menu: ['Settings', 'Uninstall'] },
        { title: 'Slack', meta: 'A chat channel · needs a bot token', sw: { key: 'pSlack', on: false }, menu: ['Set up…', 'Uninstall'] },
      ] },
      { title: 'Sources', action: { label: 'Add marketplace', edit: { title: 'Add a marketplace', yes: 'Add', fields: [{ label: 'Repository or folder', value: '' }], done: 'Marketplace added' } }, list: [
        { title: 'worca-official', meta: '12 plugins', fig: 'synced 5 min ago', menu: ['Refresh'] },
        { title: 'team-internal', meta: 'Can\'t be reached · last synced yesterday', mark: 'is-amber', menu: ['Try again', 'Remove'] },
      ] },
    ] },

    connectors: { min: 'advanced', title: 'Connectors', meta: 'MCP servers and skills, grouped in sets that projects follow.', sections: [
      { title: 'Sets', action: { label: 'New set', edit: { title: 'New set', yes: 'Create', fields: [{ label: 'Name', value: '' }], done: 'Set created' } }, list: [
        { title: 'General', meta: 'Built in · 3 servers · 2 skills · Chat and 5 projects', menu: ['Duplicate'] },
        { title: 'Frontend', meta: '2 servers · 1 skill · 2 projects', menu: ['Rename', 'Duplicate', 'Delete'] },
      ] },
      { title: 'Servers', action: { label: 'Add server' }, list: [
        { title: 'github', meta: 'stdio · in 2 sets', menu: ['Edit', 'Remove'] },
        { title: 'postgres', meta: 'stdio · needs a secret in Frontend', mark: 'is-amber', menu: ['Edit', 'Remove'] },
      ] },
      { title: 'Skills', action: { label: 'Import skill' }, list: [
        { title: 'pdf-tools', meta: 'From your Claude Code skills · in 1 set', menu: ['Edit', 'Remove'] },
      ] },
    ] },
  };

  const GROUPS = [
    { title: 'Worca', items: ['general', 'notifications', 'team', 'experimental'] },
    { title: 'Work', items: ['runs', 'presets', 'labels', 'automations'] },
    { title: 'AI', items: ['models', 'providers', 'ask', 'guardrails', 'memory'] },
    { title: 'Add-ons', items: ['plugins', 'connectors'] },
  ];
  const NOTIFICATIONS = { title: 'Notifications', meta: 'Pulse keeps everything; these choices say what else reaches you, and what a start does near a limit.' };
  window.SettingsModel = {
    GROUPS, SECTIONS, FIRST: 'general',
    title: (id) => (id === 'notifications' ? NOTIFICATIONS : SECTIONS[id] || { title: id }).title,
    meta: (id) => (id === 'notifications' ? NOTIFICATIONS : SECTIONS[id] || { meta: '' }).meta,
    min: (id) => (SECTIONS[id] || {}).min || '',
    shows: (min, level) => !min || ['simple', 'advanced', 'expert'].indexOf(level) >= ['simple', 'advanced', 'expert'].indexOf(min),
  };
})();
