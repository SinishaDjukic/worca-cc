// Settings' content for the prototype: the menu's groups, and every section's rows rewritten as Rail rows (a name,
// one sentence with its pickers, its end). From the app's Settings (ui/public/settings/settings.html and the views it
// mounts) and its Add-ons pages; Notifications is Pulse's (pulse-model.js). What changed from the app:
//   - everything takes effect at once: no Save on any card; the five reset labels are one "Reset to defaults" in the
//     section's head (it asks first, in the strip);
//   - a number becomes a SentencePicker of sensible values; a path, a list or a text shows as words with Change…;
//   - Alerts (General), Runs › Chat notifications and "Resume after a limit resets" (Runs › Budget) moved to
//     Notifications (plans/rail/pulse.md); a setting in two places keeps one home and says where in its tooltip.
// A row: { name, help, min ('advanced'|'expert'), say: 'words with {key} where a picker sits, **strong**, `code`',
//   picks: { key: { value, options: [[id, text, help]], tip, right } }, sw: { key, on, why },
//   acts: [{ label, kind ('quiet' default, '' bordered, 'danger'), help, say, go }] }
// A section: { title, meta, min, action: { label, say, confirm }, rows }.
(function () {
  const O = (...xs) => xs.map((x) => (Array.isArray(x) ? x : [x, x]));
  const P = (value, options, tip, right) => ({ value, options, tip, right });
  const reset = (what) => ({ label: 'Reset to defaults', confirm: `Reset ${what} to its defaults?`, help: 'Every row here back to its default; asks first' });
  const EFFORT = O('medium', 'high', 'xhigh', 'max');
  const MODEL = O(['sonnet', 'Sonnet 5.5'], ['opus', 'Opus 5.5'], ['haiku', 'Haiku 5.5'], ['fable', 'Fable 5.1']);
  const CHANGE = { label: 'Change…' };

  const SECTIONS = {
    general: { title: 'General', meta: 'How Worca looks, how much of it you see, and what it is.', sections: [
      { title: 'Appearance', rows: [
        { name: 'Theme', help: 'Also in the account menu. Applies to every browser that opens this Worca', say: 'Worca follows {theme}', picks: { theme: P('system', O(['system', 'your system'], ['light', 'light'], ['dark', 'dark']), 'Light, dark, or whatever your system uses') } },
        { name: 'Interface mode', help: 'Also in the account menu. Applies to every browser that opens this Worca', say: 'Show the {mode} set of pages and settings', picks: { mode: P('expert', O(['simple', 'simple'], ['advanced', 'advanced'], ['expert', 'expert']), 'Simple hides what most people never change; Expert shows everything') } },
      ] },
      { title: 'Getting set up', rows: [
        { name: 'Setup assistant', say: 'Checks Claude, git and your projects, and fixes what is missing', acts: [{ label: 'Open assistant', kind: '' }] },
        { name: 'Getting started', say: 'The checklist of the first nine things to do, and the guided tour', acts: [{ label: 'Start the tour' }, { label: 'Show checklist', kind: '' }] },
      ] },
      { title: 'Your access', meta: 'Shown when Worca runs with your team\'s credential broker.', rows: [
        { name: 'Model keys', say: 'Claude and OpenAI keys come from **your team\'s broker**', acts: [{ label: 'Manage keys', kind: '' }] },
        { name: 'GitHub', say: 'Signed in as **@emil-angelov**' },
      ] },
      { title: 'Browser extension', rows: [
        { name: 'Install', say: 'Add Worca to {browser}', picks: { browser: P('chrome', O(['chrome', 'Chrome'], ['edge', 'Edge'], ['firefox', 'Firefox']), 'Which browser to install it in') }, acts: [{ label: 'Install', kind: '' }] },
        { name: 'MacBook · Chrome', help: 'id 3f9a0c2b7d41', say: 'Paired 2 Oct · last used today', acts: [{ label: 'Revoke', help: 'It stops working at once; pair it again to use it' }] },
        { name: 'Work PC · Edge', help: 'id a81c55e09b3d', say: 'Paired 14 Sep · not used yet', acts: [{ label: 'Revoke', help: 'It stops working at once; pair it again to use it' }] },
      ] },
      { title: 'Storage', min: 'advanced', action: reset('Storage'), rows: [
        { name: 'Worca folder', say: 'Runs, history and settings live in `~/.worca`', acts: [CHANGE] },
        { name: 'Projects folder', say: 'New projects are cloned into `~/src`', acts: [CHANGE] },
      ] },
      { title: 'Diagnostics', min: 'expert', rows: [
        { name: 'Spawn details', say: 'Log each Claude start: its binary, arguments and routing', sw: { key: 'spawnLog', on: false, why: 'Writes them to the server log' } },
      ] },
      { title: 'About', rows: [
        { name: 'Version', say: 'Worca **1.17.0** · up to date', acts: [{ label: 'Check now', kind: '' }] },
        { name: 'Updates', say: 'Look for new versions of Worca', sw: { key: 'updates', on: true, why: 'Checks once a day; nothing installs by itself' } },
        { name: 'What\'s new', say: 'Changes since 1.16.0', acts: [{ label: 'Release notes' }] },
        { name: 'Feedback', say: 'Ideas and problems go to the Worca team on GitHub', acts: [{ label: 'Send feedback' }] },
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

    runs: { title: 'Runs', meta: 'How every run behaves: what it may spend, how it is named, when it starts and where it waits.', sections: [
      { title: 'Budget', action: reset('Budget'), meta: 'Spent this month: $412 of $1,000.', rows: [
        { name: 'Each run', say: 'A run pauses when it has spent {perRun}', picks: { perRun: P('none', O(['none', 'no limit'], ['5', '$5'], ['10', '$10'], ['25', '$25'], ['50', '$50'], ['100', '$100']), 'The most one run may spend before it pauses') } },
        { name: 'All runs', say: 'Every run pauses at {total} a {period}', picks: { total: P('1000', O(['none', 'no limit'], ['250', '$250'], ['500', '$500'], ['1000', '$1,000'], ['2500', '$2,500']), 'The most all runs together may spend'), period: P('month', O(['week', 'week (from Monday)'], ['month', 'month (from the 1st)']), 'When the total starts again') } },
        { name: 'Your time', say: 'Time saved is counted at {rate} an hour', picks: { rate: P('35', O(['25', '$25'], ['35', '$35'], ['50', '$50'], ['75', '$75'], ['100', '$100']), 'What an hour of a developer costs, for Statistics') } },
      ] },
      { title: 'Naming', action: reset('Naming'), meta: 'With Labs › Smart run naming on.', rows: [
        { name: 'Suggest', say: 'Suggest {what} for a new run, {when}', picks: { what: P('both', O(['both', 'a title and a branch name'], ['title', 'a title'], ['branch', 'a branch name']), 'What the model suggests'), when: P('typing', O(['typing', 'while you type the task'], ['ask', 'when you press Suggest']), 'When it suggests', true) } },
        { name: 'Branch', say: 'Branches are named `{type}/{slug}`, the type one of feat, fix, chore, docs, refactor, test', acts: [CHANGE] },
        { name: 'Run id', say: 'Add the run id to the branch name', sw: { key: 'runId', on: false } },
        { name: 'Model', say: 'Uses the **Run naming** model', acts: [{ label: 'Open Models', go: 'models', help: 'Models › Helper jobs' }] },
      ] },
      { title: 'Away mode', min: 'advanced', action: reset('Away mode'), meta: 'While you are away, Worca answers the questions your runs wait on, and says why.', rows: [
        { name: 'Now', say: 'Off · you count as away from **22:00**', acts: [{ label: 'I\'m away now', kind: '' }] },
        { name: 'Away hours', say: '**22:00–07:00**, Europe/Sofia', acts: [CHANGE] },
        { name: 'Which runs', say: 'Worca answers on {which}; a marked run is also answered by day after {byDay}', picks: { which: P('marked', O(['marked', 'runs you marked'], ['all', 'every run']), 'Which runs Worca answers on while you are away'), byDay: P('30', O(['never', 'never'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', 'an hour']), 'How long a question waits by day before Worca answers it', true) } },
        { name: 'How it decides', say: 'It {method}, trusting the agent at {sure} sure with a lead of {lead}', picks: { method: P('mixed', O(['mixed', 'trusts a sure agent, else weighs', 'Trusts the agent when it is sure; otherwise weighs the options'], ['trust', 'always trusts the agent'], ['weigh', 'always weighs the options']), 'How Worca picks an answer'), sure: P('60', O(['50', '50%'], ['60', '60%'], ['70', '70%'], ['80', '80%']), 'How sure the agent must be'), lead: P('25', O(['15', '15 points'], ['25', '25 points'], ['40', '40 points']), 'How far its pick must lead the next one', true) } },
        { name: 'What matters', say: 'Matches past decisions **3** · easy to undo **3** · changes least **2** · conventions **2** · cheapest **1**', acts: [CHANGE] },
        { name: 'Decided by', say: '{dmodel} at {deffort} effort', picks: { dmodel: P('run', O(['run', 'the run\'s own model'], ...MODEL), 'The model that weighs the options'), deffort: P('medium', EFFORT, 'Its effort') } },
        { name: 'Limits', say: 'Pause a run after {answers} answers, and everything at {spent} spent while away', picks: { answers: P('20', O('10', '20', '40'), 'Answers in one run before it pauses'), spent: P('none', O(['none', 'no cap'], ['25', '$25'], ['50', '$50'], ['100', '$100']), 'Spent while away before every run pauses', true) } },
        { name: 'Review loops', say: 'Allow {extra} extra fix rounds; the team cap is {exceed}', picks: { extra: P('0', O('0', '1', '2', '3'), 'Fix rounds beyond the workflow\'s own'), exceed: P('kept', O(['kept', 'kept'], ['exceed', 'allowed to be exceeded']), 'Whether away answers may go over the team\'s cost cap', true) } },
        { name: 'Always wait for me', say: 'On approving a plan, merging and deleting', acts: [CHANGE] },
      ] },
      { title: 'Before a run starts', min: 'advanced', action: reset('Before a run starts'), rows: [
        { name: 'Sync', say: 'Bring the source branch up to date from {remote}; if it has diverged, {div}', picks: { remote: P('origin', O('origin', 'upstream'), 'The remote to sync from'), div: P('ask', O(['ask', 'ask me'], ['origin', 'start from origin'], ['stop', 'don\'t run']), 'What a run does when the branch has diverged', true) }, sw: { key: 'sync', on: true } },
        { name: 'In the background', say: 'Check remotes {bg}', picks: { bg: P('10', O(['off', 'never'], ['5', 'every 5 minutes'], ['10', 'every 10 minutes'], ['30', 'every 30 minutes'], ['60', 'every hour']), 'How often Worca looks for new commits') } },
        { name: 'Pull requests', say: 'Draft the description with AI as the PR opens', sw: { key: 'prDraft', on: false } },
      ] },
      { title: 'Schedules and the network', min: 'advanced', action: reset('Schedules and the network'), rows: [
        { name: 'A missed start', say: 'When Worca was not running, {late} up to {lateMax} late', picks: { late: P('late', O(['late', 'start it'], ['skip', 'skip it']), 'What a scheduled run does when its time passed'), lateMax: P('6h', O(['30m', '30 minutes'], ['1h', '1 hour'], ['6h', '6 hours'], ['24h', '24 hours']), 'How late it may still start', true) } },
        { name: 'Failures', say: 'Pause a repeating schedule after {fails} failures in a row', picks: { fails: P('3', O('2', '3', '5', '10'), 'Failures in a row before it pauses') } },
        { name: 'Offline', say: 'When the network drops, a run waits up to {wait}', picks: { wait: P('4h', O(['30m', '30 minutes'], ['1h', '1 hour'], ['4h', '4 hours'], ['12h', '12 hours'], ['24h', '24 hours']), 'How long it waits before it fails') }, sw: { key: 'netWait', on: true } },
      ] },
      { title: 'Network proxy', rows: [
        { name: 'Proxy', say: 'Through **proxy.corp.example:8080**, signing in with {auth}', picks: { auth: P('ntlm', O(['ntlm', 'NTLMv2'], ['basic', 'Basic'], ['digest', 'Digest'], ['none', 'no login']), 'How Worca signs in to the proxy') }, acts: [{ label: 'Test', kind: '' }], sw: { key: 'proxy', on: false, why: 'Off: Worca connects directly' } },
        { name: 'Signed in', say: 'As **CORP\\emil** · checked today', acts: [{ label: 'Log out' }] },
        { name: 'Direct', say: 'These go direct: `localhost`, `*.corp.example`', acts: [CHANGE] },
        { name: 'Timeouts', min: 'expert', say: 'Connect within {ct}, sign in within {lt}, drop idle after {it}', picks: { ct: P('60', O(['30', '30s'], ['60', '60s'], ['120', '120s']), 'Connect timeout'), lt: P('60', O(['30', '30s'], ['60', '60s'], ['120', '120s']), 'Login timeout'), it: P('300', O(['120', '2 minutes'], ['300', '5 minutes'], ['600', '10 minutes']), 'Idle timeout', true) } },
      ] },
      { title: 'This machine', min: 'advanced', action: reset('This machine'), rows: [
        { name: 'Runs at once', say: 'Up to {n} runs at a time; each tests with {w}', picks: { n: P('3', O('1', '2', '3', '4', '6', '8', '12', '20'), 'More runs wait in line'), w: P('half', O(['half', 'half the cores'], ['1', '1 worker'], ['2', '2 workers'], ['4', '4 workers'], ['8', '8 workers']), 'Test workers per run', true) } },
        { name: 'Archive', say: 'Archive finished runs after {arch}', picks: { arch: P('never', O(['never', 'never'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', 'a year']), 'Archiving removes the branch, worktree and logs') } },
        { name: 'Checkouts', say: 'An action\'s checkout is {keep}; keep at most {coMax}', picks: { keep: P('demand', O(['demand', 're-created when needed'], ['success', 'kept after a successful run'], ['pr', 'kept until the PR closes']), 'When a checkout is removed'), coMax: P('none', O(['none', 'any number'], ['5', '5'], ['10', '10'], ['20', '20']), 'The oldest go first', true) } },
        { name: 'Ports', say: 'Port variables come from `4400–4499`', acts: [CHANGE] },
        { name: 'Editor and terminal', say: 'Opens files in **VS Code** and shells in **iTerm** (found on this machine)', acts: [CHANGE] },
        { name: 'Workspace scans', say: 'Scan with {scan} at {se} effort; write project agents with {agent} at {ae} effort', picks: { scan: P('sonnet', MODEL, 'The model that scans a workspace'), se: P('medium', EFFORT, 'Its effort'), agent: P('sonnet', MODEL, 'The model that writes project agents'), ae: P('medium', EFFORT, 'Its effort', true) } },
      ] },
    ] },

    presets: { min: 'advanced', title: 'Presets', meta: 'Saved setups a new run can start from. Save one from a run\'s ⋯.', sections: [
      { title: 'Presets', rows: [
        { name: 'Bug fix', say: 'Any project · Fix workflow · Claude · updated 3 Oct', acts: [{ label: 'Rename' }, { label: 'Delete' }] },
        { name: 'Docs pass', say: 'Only worca-cc · Docs workflow · Claude · updated 28 Sep', acts: [{ label: 'Rename' }, { label: 'Delete' }] },
        { name: 'Billing slice', say: 'Only billing workspace · **workspace gone** · Feature workflow', acts: [{ label: 'Rename' }, { label: 'Delete' }] },
      ] },
    ] },

    tags: { title: 'Labels & cost tags', meta: 'Words you put on runs: labels to find them, cost tags to count what they spend.', sections: [
      { title: 'Cost tags', action: { label: 'Add cost tag' }, rows: [
        { name: 'Required', say: 'A run starts only with every required cost tag set', sw: { key: 'tagsReq', on: false } },
        { name: 'Cost centre', help: 'key cost_centre', say: 'R&D, Platform, Support · required', acts: [{ label: 'Edit' }] },
        { name: 'Customer', help: 'key customer', say: 'Any value · optional', acts: [{ label: 'Edit' }] },
      ] },
      { title: 'Labels', min: '', meta: 'With Labs › Run labels on. The most used first.', rows: [
        { name: 'frontend', say: 'On 14 runs', acts: [{ label: 'Rename' }, { label: 'Remove' }] },
        { name: 'needs demo', say: 'On 6 runs', acts: [{ label: 'Rename' }, { label: 'Remove' }] },
        { name: 'hotfix', say: 'On 3 runs', acts: [{ label: 'Rename' }, { label: 'Remove' }] },
      ] },
    ] },

    automations: { min: 'advanced', title: 'Automations', meta: 'What runs by itself across projects. Each project\'s rules and switches are on its own Automations tab.', sections: [
      { title: 'Projects', rows: [
        { name: 'worca-cc', say: 'Proposes a fix for new issues and reviews PRs · 3 rules', acts: [{ label: 'Open' }] },
        { name: 'billing workspace', say: 'Every member repository · reviews PRs · 1 rule', acts: [{ label: 'Open' }] },
      ] },
      { title: 'Waiting for you', rows: [
        { name: 'Issue #1088', say: 'A fix is proposed · worca-cc · 2h ago', acts: [{ label: 'Open' }] },
      ] },
      { title: 'Recent', rows: [
        { name: 'PR #1087', say: 'Reviewed · worca-cc · today, 09:12' },
        { name: 'Issue #1085', say: 'Skipped: no rule matched · worca-cc · yesterday' },
      ] },
    ] },

    ask: { min: 'advanced', title: 'Chat', meta: 'Worca\'s own assistant: its engine, what it may do and where it may look.', sections: [
      { title: 'Engine', rows: [
        { name: 'Engine', say: 'New chats use {engine}', picks: { engine: P('claude', O(['claude', 'Claude'], ['codex', 'Codex (beta)'], ['copilot', 'Copilot (beta)'], ['gemini', 'Gemini CLI (beta)'], ['goose', 'Goose (beta)'], ['opencode', 'OpenCode (beta)'], ['qwen', 'Qwen Code (beta)']), 'The engine a new chat starts on') } },
        { name: 'Models', say: 'Picks from **Sonnet 5.5**, **Opus 5.5** and **Haiku 5.5**', acts: [CHANGE] },
      ] },
      { title: 'Limits and access', action: reset('Chat\'s limits and access'), rows: [
        { name: 'Limits', say: 'A chat stops after {turns} turns, and a turn at {cap}', picks: { turns: P('400', O('100', '200', '400', '800'), 'Turns in one chat'), cap: P('none', O(['none', 'no cap'], ['1', '$1'], ['5', '$5'], ['10', '$10']), 'What one turn may spend', true) } },
        { name: 'Scripts', say: 'Create and run scripts', sw: { key: 'scripts', on: true } },
        { name: 'Summaries', say: 'Show each command as one line saying what it does', sw: { key: 'summaries', on: true, why: 'With Labs › Command summaries on' } },
        { name: 'Next prompt', say: 'Suggest a next prompt after each reply', sw: { key: 'nextPrompt', on: true } },
        { name: 'Web', say: 'Read web pages from {web}', picks: { web: P('allowed', O(['allowed', 'the allowed sites'], ['any', 'any site, without asking'])) }, sw: { key: 'webOn', on: false } },
        { name: 'Allowed sites', say: '`docs.python.org`, `developer.mozilla.org`', acts: [CHANGE] },
        { name: 'Search', min: 'expert', say: 'Searches with the built-in search', acts: [{ label: 'Use your own…' }] },
        { name: 'Connectors', say: 'Uses the **General** set: 3 servers, 2 skills', acts: [{ label: 'Open Connectors', go: 'connectors' }] },
      ] },
      { title: 'History', rows: [
        { name: 'Chats', say: '38 chats kept on this machine', acts: [{ label: 'Delete all chats', kind: 'danger' }] },
      ] },
    ] },

    guardrails: { min: 'advanced', title: 'Guardrails', meta: 'What agents may not touch, as sets a project follows.', sections: [
      { title: 'Sets', action: { label: 'New set', help: 'Expert' }, rows: [
        { name: 'Default', help: 'Built in', say: 'Built in · 6 deny rules · 3 protected paths · scrub on · 5 projects', acts: [{ label: 'Edit' }] },
        { name: 'Strict', say: 'Yours · 14 deny rules · 6 protected paths · scrub on · 1 project', acts: [{ label: 'Edit' }] },
        { name: 'Team policy', help: 'Shipped by the team policy; edit it on the Team policy page', say: 'From the team policy · 9 deny rules · read-only', acts: [{ label: 'View' }] },
      ] },
    ] },

    memory: { min: 'advanced', title: 'Memory', meta: 'What agents remember between runs, as notes Worca keeps tidy.', sections: [
      { title: 'Health', min: 'expert', rows: [
        { name: 'Notes', say: '**Healthy** · 24 notes · tidied 3 days ago', acts: [{ label: 'Tidy now', kind: '' }] },
      ] },
      { title: 'Proposed by runs', rows: [
        { name: 'testing.md', say: 'Update · from run #412 · 2h ago', acts: [{ label: 'Reject' }, { label: 'Approve', kind: '' }] },
      ] },
      { title: 'Notes', action: { label: 'New note' }, rows: [
        { name: 'architecture.md', say: 'How the server and the UI are split · today · from Chat', acts: [{ label: 'Open' }] },
        { name: 'conventions.md', say: 'Naming, commits and tests · 2 Oct · from run #398', acts: [{ label: 'Open' }] },
      ] },
      { title: 'History', rows: [
        { name: 'Before tidying', say: '3 days ago · 31 notes', acts: [{ label: 'Restore' }] },
      ] },
    ] },

    marketplace: { min: 'advanced', title: 'Marketplace', meta: 'Plugins that add task sources, chat channels, MCP servers, models, agents and skills.', sections: [
      { title: 'Installed', action: { label: 'Browse plugins' }, rows: [
        { name: 'Jira', say: 'A task source · worca-official · **1 update**', acts: [{ label: 'Update', kind: '' }], sw: { key: 'pJira', on: true } },
        { name: 'Telegram', say: 'A chat channel · bot token set', sw: { key: 'pTg', on: true } },
        { name: 'Slack', say: 'A chat channel · needs a bot token', acts: [{ label: 'Set up…' }], sw: { key: 'pSlack', on: false } },
      ] },
      { title: 'Marketplaces', action: { label: 'Add marketplace' }, rows: [
        { name: 'worca-official', say: '12 plugins · synced 5 minutes ago', acts: [{ label: 'Refresh' }] },
        { name: 'team-internal', say: '**Can\'t be reached** · last synced yesterday', acts: [{ label: 'Try again' }] },
      ] },
    ] },

    connectors: { min: 'advanced', title: 'Connectors', meta: 'MCP servers and skills agents and Chat get, grouped in sets that projects follow.', sections: [
      { title: 'Sets', action: { label: 'New set' }, rows: [
        { name: 'General', help: 'Built in', say: 'Built in · 3 servers · 2 skills · Chat and 5 projects', acts: [{ label: 'Open' }] },
        { name: 'Frontend', say: '2 servers · 1 skill · 2 projects', acts: [{ label: 'Open' }] },
      ] },
      { title: 'Servers', action: { label: 'Add MCP server' }, rows: [
        { name: 'github', say: 'stdio · in 2 sets', acts: [{ label: 'Edit' }] },
        { name: 'postgres', say: 'stdio · **needs a secret** in Frontend', acts: [{ label: 'Edit' }] },
      ] },
      { title: 'Skills', action: { label: 'Import skill' }, rows: [
        { name: 'pdf-tools', say: 'From your Claude Code skills · in 1 set', acts: [{ label: 'Edit' }] },
      ] },
    ] },

    models: { min: 'expert', title: 'Models', meta: 'The models every project can pick from; sign-ins are on Providers.', sections: [
      { title: 'Roles', meta: 'Every job without a model of its own uses its role\'s.', rows: [
        { name: 'Deep thinking', help: 'Plans and reviews', say: '{deep} at {deepE} effort', picks: { deep: P('opus', MODEL, 'Plans and reviews: worth the strongest model'), deepE: P('high', EFFORT, 'Its effort') } },
        { name: 'Everyday coding', help: 'Writes the code and answers in Chat', say: '{code} at {codeE} effort', picks: { code: P('sonnet', MODEL, 'Writes the code and answers in Chat'), codeE: P('medium', EFFORT, 'Its effort') } },
        { name: 'Quick jobs', help: 'Short, frequent helper calls', say: '{quick} at {quickE} effort', picks: { quick: P('haiku', MODEL, 'Cheap and fast'), quickE: P('medium', EFFORT, 'Its effort') } },
      ] },
      { title: 'Engines', min: 'expert', rows: [
        { name: 'Default engine', say: 'New runs use {eng}', picks: { eng: P('claude', O(['claude', 'Claude'], ['codex', 'Codex (beta)'], ['copilot', 'Copilot (beta)'], ['cursor', 'Cursor (beta)'], ['gemini', 'Gemini CLI (beta)']), 'The engine a new run starts on') } },
        { name: 'Step models', say: 'Each workflow step\'s model, per engine', acts: [{ label: 'Edit' }] },
        { name: 'Helper jobs', say: 'Titles, PR descriptions, run naming and 5 more', acts: [{ label: 'Edit' }] },
      ] },
      { title: 'Catalogue', action: { label: 'Add model' }, rows: [
        { name: 'Built-in models', say: 'Hide the built-in Anthropic models', sw: { key: 'hideBuiltIn', on: false, why: 'When you don\'t use a first-party Anthropic account' } },
        { name: 'claude-sonnet-5-5', say: 'Your Claude login · priced by the CLI', acts: [{ label: 'Edit' }] },
        { name: 'gpt-5', say: 'Codex · your ChatGPT sign-in', acts: [{ label: 'Edit' }] },
        { name: 'local-llama', say: 'Through OpenAI-compatible · free', acts: [{ label: 'Edit' }] },
        { name: 'Import and share', say: 'Bring models in from Copilot or a provider, or share yours as a plugin', acts: [{ label: 'Share…' }, { label: 'Import…', kind: '' }] },
      ] },
    ] },

    providers: { min: 'expert', title: 'Providers', meta: 'Sign-ins and keys for the models Worca runs through its own bridge.', sections: [
      { title: 'Model providers', rows: [
        { name: 'GitHub Copilot', say: 'Connected as **@emil-angelov** · {acct} · up to {cop} requests at once', picks: { acct: P('business', O(['individual', 'Individual'], ['business', 'Business'], ['enterprise', 'Enterprise']), 'Your Copilot plan'), cop: P('4', O('2', '4', '8'), 'Requests at once', true) }, acts: [{ label: 'Refresh usage' }] },
        { name: 'OpenAI-compatible', say: 'Not set up', acts: [{ label: 'Set up…', kind: '' }] },
        { name: 'Anthropic-compatible', say: '`https://llm.corp.example/v1` · key set · up to {ant} at once', picks: { ant: P('8', O('4', '8', '16'), 'Requests at once', true) }, acts: [CHANGE] },
      ] },
      { title: 'Speech', meta: 'Used by Chat\'s voice.', rows: [
        { name: 'Speech to text', say: 'Listens {stt}', picks: { stt: P('browser', O(['browser', 'in the browser'], ['server', 'through your server']), 'Where speech is turned into text') } },
        { name: 'Text to speech', say: 'Replies aloud {tts}', picks: { tts: P('browser', O(['browser', 'in the browser'], ['server', 'through your server'], ['off', 'never: replies stay text']), 'Where replies are spoken') } },
      ] },
    ] },
  };

  const GROUPS = [
    { title: 'Worca', items: ['general', 'notifications', 'experimental'] },
    { title: 'Runs', items: ['runs', 'presets', 'tags', 'automations'] },
    { title: 'Agents', items: ['ask', 'guardrails', 'memory'] },
    { title: 'Add-ons', items: ['marketplace', 'connectors', 'models', 'providers'] },
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
