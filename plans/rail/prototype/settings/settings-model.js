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
// A row: { name, help, min, flag, when(sv), chip, say: 'words, {key} where a picker or a value sits, **strong**, `code`' or (sv) → those words,
//   picks: { key: { value, options: [[id, text, help, off]] or (sv) → them, tip, right, then(sv) } }, vals: { key: string | (sv) => string },
//   sw: { key | flag, on, why, locked, off(sv) → why }, acts: [action], more: [rows], moreList: [records], foldLabel }.
// An action: { label, help, min, when(sv), off(sv) → why, read, go | edit | confirm | copy | do(sv) | page | click | say }.
// A record: { title, meta, live(sv), detail, mark, fig, chip, sw, when(sv), menu: [labels or { text, off, help }] | (rec, sv) → them, quick: [labels on the row's end],
//   openMin, on: { label: (rec, x) → toast }, open: (rec, x) → toast }; a row opens only what it does not already show; a ⋯ with one item is a button.
//   Rename, Duplicate, Edit, Delete, Remove, Revoke and Reject are shared (settings.js). `x` is { sv, remove, add, dialog, confirm, go, page, click }.
//   and Reject are shared (settings.js). `x` is { sv, remove, add, dialog, confirm, go, page, click }.
// A Dialog: { title, yes, note, facts, rows, fields, check(vals), then(vals, sv) → toast, done, view, steps: [{ label, … }] }.
// A section: { title, meta, min, flag, actions: [action], rows, list, table, groups: [{ title, meta, rows | list, empty }] }.
// `min` is a level; `flag` a Labs flag that gates the thing too, on a section or a row. A record may fold rows of its own:
// `more`, with `foldFlag` when a Labs flag gates them. An action that opens records in a Dialog carries them as `list`,
// so search finds them.
// Loaded by the gates with an empty `window`: nothing here touches the library until it is called.
(function () {
  const O = (...xs) => xs.map((x) => (Array.isArray(x) ? x : [x, x]));
  const P = (value, options, tip, right) => ({ value, options, tip, right });
  const EFFORT = O('medium', 'high', 'xhigh', 'max');
  const MODEL = O(['sonnet', 'Sonnet 5.5'], ['opus', 'Opus 5.5'], ['haiku', 'Haiku 5.5'], ['fable', 'Fable 5.1']);
  const edit = (title, fields, o = {}) => ({ label: 'Change…', edit: { title, fields, yes: 'Save', ...o } });
  const ENGINES = O(['claude', 'Claude'], ['codex', 'Codex (beta)'], ['copilot', 'Copilot (beta)'], ['cursor', 'Cursor (beta)'], ['gemini', 'Gemini CLI (beta)'], ['goose', 'Goose (beta)'], ['opencode', 'OpenCode (beta)'], ['qwen', 'Qwen Code (beta)']);
  const usd = (v) => (v === '' || v == null ? 'no limit' : '$' + Number(v).toLocaleString('en-US'));
  const opens = (where) => ({ label: 'Open', say: `Would open ${where} in a new tab` });
const GIT_TIP = 'Needs git: this row is hidden when the machine has no git';
  const plural = (n, w) => `${n} ${w}${+n === 1 ? '' : 's'}`;
  const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const isAmount = (s) => /^\d+(\.\d{1,2})?$/.test(String(s).trim());
  const isFolder = (s) => /^~?\/[^/]/.test(s.trim());   // a real folder: / or ~/ alone is not one
  const isUrl = (s) => /^https?:\/\/\S+$/.test(String(s).trim());
  const limitsWrong = (run, all) => { const r = String(run).trim(), a = String(all).trim(), ok = (s) => !s || (isAmount(s) && +s > 0); return !ok(r) || !ok(a) ? 'A limit is an amount in dollars above 0, or empty' : r && a && +r > +a ? 'One run cannot be allowed more than the total' : ''; };
  const atLevel = (min) => window.RailUI.shows(min, window.RailUI.prefs.mode());
  const pickText = (options, v) => (options.find((o) => o[0] === v) || [v, v])[1];
  const ARCHIVE = O(['never', 'stay until you archive them'], ['7', 'are archived after 7 days'], ['30', 'are archived after 30 days'], ['90', 'are archived after 90 days'], ['365', 'are archived after a year']);
  const WAIT = O(['30m', '30 minutes'], ['1h', '1 hour'], ['4h', '4 hours'], ['12h', '12 hours'], ['24h', '24 hours']);

  // ---- Team policy: what the team published, and what you edit (docs/rail/settings.md › Team policy). The page edits
  // sv's own values; `sv.pol` is the last published document, and everything outside the editor reads that. A change
  // waits until Publish, one commit on the worca-policy branch, as in the app. ----
  const POLICY = { prOpen: 'none', prSlices: 'each', capRun: '50', capAll: '2000', wsCap: '120', blockMcp: true, policyTitle: 'Gateway team policy', policyNotes: 'Ask #platform' };
  const PR_WORDS = { none: 'None', draft: 'Draft', ready: 'Ready' };
  const POLICY_WORDS = {
    prOpen: (v) => `Create a PR: ${PR_WORDS[v]}`, prSlices: (v) => `A feature's PRs: ${v === 'each' ? 'one per slice' : 'one for all'}`, capRun: (v) => `Each task: ${usd(v)}`, capAll: (v) => `All tasks: ${usd(v)} a month`,
    wsCap: (v) => `Workspace runs: ${usd(v)} a run`, blockMcp: () => 'Unknown MCP servers no longer blocked', policyTitle: (v) => `Title: ${v}`, policyNotes: () => 'Notes changed',
  };
  const pending = (sv, keys = Object.keys(POLICY)) => keys.filter((k) => sv[k] !== sv.pol[k]);
  const pendingWords = (sv) => { const n = pending(sv).length; return n ? `${plural(n, 'change')} not published` : 'Nothing to publish'; };
  const pendingChip = (...keys) => (sv) => (pending(sv, keys).length ? 'Not published' : '');
  const polEdit = (title, fields, check) => ({ label: 'Change…', edit: { title, yes: 'Add to changes', note: 'Nothing reaches your team until you publish.', fields, check, then: (v, sv) => { Object.assign(sv, v); return pendingWords(sv); } } });
  // A cap has one behaviour: a task pauses at it (docs/rail/settings.md › Spending). The tighter of yours and your team's wins.
  const runCap = (sv) => (!sv.perRun ? `**${usd(sv.pol.capRun)}** (your team's)` : +sv.perRun <= +sv.pol.capRun ? `**${usd(sv.perRun)}**` : `**${usd(sv.pol.capRun)}** (your team's; yours is ${usd(sv.perRun)})`);
  const totalCap = (sv) => { const team = `${usd(sv.pol.capAll)} a month`, own = `${usd(sv.total)} a ${sv.period}`;
    if (!sv.total) return `**${team}** (your team's)`;
    if (sv.period !== 'month') return `**${own}**, and **${team}** (your team's)`;
    return +sv.total <= +sv.pol.capAll ? `**${own}**` : `**${team}** (your team's; yours is ${usd(sv.total)})`; };
  const SPENT = { day: ['today', 38], week: ['this week', 140], month: ['this month', 412] };
  const spentWords = (sv) => { const own = sv.total ? sv.period : 'month', [when, table] = SPENT[own], n = own === 'month' && sv.spentNow != null ? sv.spentNow : table, of = sv.total && own !== 'month' ? +sv.total : sv.total ? Math.min(+sv.total, +sv.pol.capAll) : +sv.pol.capAll; return `Spent ${when}: $${n} of ${usd(of)}.`; };

  // ---- Plugins and Chat › Channels read one fact from here: what is installed, and whether a channel has its token ----
  const store = () => window.RailPlaces?.marketplace;   // the Marketplace holds what is installed; a plugin it does not list falls back to this page's own
  const installed = (sv, title) => store()?.isInstalled?.(title) ?? !sv.gone[title];
  const uninstall = (title) => (r, x) => x.confirm({ text: `Uninstall ${title}?`, yes: 'Uninstall', danger: true, then: (s) => { s.gone = { ...s.gone, [title]: true }; store()?.setInstalled?.(title, false); return `Uninstalled: ${title}`; } });
  const CHANNELS = [['Telegram', 'chTelegram'], ['Discord', 'chDiscord'], ['Slack', 'chSlack'], ['Teams', 'chTeams']];
  const channelState = (sv, title, key) => (!sv.chToken[title] ? 'Not set up' : sv[key] ? 'Connected' : 'Off');
  const workingChannels = (sv) => CHANNELS.filter(([t, k]) => installed(sv, t) && channelState(sv, t, k) === 'Connected').map(([t]) => t);

  // ---- Connectors: a set holds names, so every count reads the lists ----
  const SET_MEMBERS = { General: { servers: ['github', 'postgres'], skills: ['pdf-tools'] }, Frontend: { servers: ['github', 'postgres'], skills: ['pdf-tools'] } };
  const setCount = (sv, name) => { const of = (where, names) => { const live = (sv.__recs[where] || recsSeed(...where.split('/'))).map((r) => r.title); return names.filter((n) => live.includes(n)).length; };
    return `${plural(of('connectors/Servers', SET_MEMBERS[name].servers), 'server')} · ${plural(of('connectors/Skills', SET_MEMBERS[name].skills), 'skill')}`; };
  // what a set's members and projects say follows the sets that are there: a deleted set leaves no trace, a copy counts
  const setsNow = (sv) => sv.__recs['connectors/Sets'] || recsSeed('connectors', 'Sets');
  const frontendSet = (sv) => setsNow(sv).find((s) => s.members === 'Frontend' && s.projects);
  const inSets = (sv, kind, name) => { const n = setsNow(sv).filter((s) => s.members && SET_MEMBERS[s.members][kind].includes(name)).length; return n ? `in ${plural(n, 'set')}` : 'in no set'; };
  const liveSets = (kind, name, front) => (sv, r) => (r.meta === `${front} · in 2 sets` ? `${front} · ${inSets(sv, kind, name)}` : r.meta);   // until you edit its details


  // ---- Labs: the registry's flags (src/shared/flags/registry.mjs), but its Flags demo ----
  const FLAGS = [
    { key: 'commandSummaries', name: 'Command summaries', stage: 'Beta', on: true, say: 'Commands in Chat show as one line saying what they do', why: 'Adds Chat › Summaries, which needs Advanced' },
    { key: 'runLabels', name: 'Run labels', stage: 'Experimental', on: false, say: 'Free-word labels on runs, with a Label filter on the Runs list', why: 'Adds Settings › Labels and labels on runs' },
    { key: 'smartRunNaming', name: 'Smart run naming', stage: 'Experimental', on: false, say: 'A quick model suggests the run title and a branch name as you type', why: 'Adds Runs › Naming' },
    { key: 'requirements', name: 'Requirements', stage: 'Experimental', on: false, say: 'Turn an idea into a testable spec through a short interview, before any run', why: 'Adds Requirements to the sidebar' },
    { key: 'runTelemetry', name: 'Run telemetry', stage: 'Experimental', on: false, say: 'Runs record context size, tokens and timing of every model call', why: 'Adds these numbers to a run\'s log', locked: 'Locked by WORCA_FLAGS' },
    { key: 'gitAutomations', name: 'Git event automations', stage: 'Experimental', on: false, say: 'Start a workflow when an issue or a pull request is opened', why: 'Adds Settings › Automations, which needs Advanced' },
    { key: 'sessionGroups', name: 'Shared session', stage: 'Experimental', on: false, say: 'Run 2 to 4 steps in a row in one agent session, so they share what they learned', why: 'Changes how a workflow\'s steps run' },
    { key: 'ticketUpdates', name: 'Ticket updates', stage: 'Experimental', on: false, say: 'A finished run moves its ticket, by a rule per tracker project', why: 'Adds Plugins › Ticket updates, which needs Advanced' },
    { key: 'shapeRequirements', name: 'Requirements first', stage: 'Experimental', on: false, say: 'A medium or large Shaper task first agrees what must be true, then plans', why: 'Adds a step to Shaper' },
  ];
  const flagsChanged = () => FLAGS.filter((f) => !f.locked && window.RailUI.prefs.flag(f.key) !== f.on);

  // ---- values that are not a row's own ----
  const STATE = { ver: '1.19.0', latest: '1.19.0', upd: 'latest', updTried: false, gsShown: false, proxyLogin: true, claudeIn: true, chats: 38, worktrees: 12, attach: '140 MB',
    defragged: '3 days ago', seeded: false, speechModels: true, gemQuota: '', gemUsed: 840, perRun: '', total: '1000', period: 'month', orLeft: 820,
    pol: POLICY, capRun: POLICY.capRun, capAll: POLICY.capAll, wsCap: POLICY.wsCap, blockMcp: POLICY.blockMcp, policyTitle: POLICY.policyTitle, policyNotes: POLICY.policyNotes,
    gone: { Sentry: true }, chToken: { Telegram: true, Discord: true, Slack: false, Teams: false }, chAllowed: {} };
  const NOTES = [note('architecture.md', 'How the server and the UI are split · today · from Chat'), note('conventions.md', 'Naming, commits and tests · 2 Oct · from run #398')];
  const COST_TAGS = [
    costTag('Cost centre', 'R&D, Platform, Support', true),
    costTag('Customer', '', false),
  ];

  // ---- General › About: what `Check now`, `Update` and `Choose version…` do ----
  const cmd = (sv) => `npm install -g @worca/app@${sv.upd === 'failed' || sv.upd === 'available' ? sv.latest : sv.ver}`;
  const short = (v) => v.replace(/\.0$/, '');   // 1.20.0 reads 1.20
  const updateFailed = (sv) => window.RailUI.failureOf(`Update to ${short(sv.latest)}`, 'npm could not write to the install folder');
  const updWords = (sv) => ({ latest: 'Up to date', available: `New version: ${short(sv.latest)}`, failed: updateFailed(sv).title, back: `An older version; ${short(sv.latest)} is the latest` }[sv.upd]);
  const outdated = (sv) => sv.upd === 'available' || sv.upd === 'failed' || sv.upd === 'back';
  const canUpdate = (sv) => sv.upd === 'available' || sv.upd === 'back';
  const VERSIONS = O(['1.20.0', '1.20, the latest'], ['1.19.0', '1.19'], ['1.18.2', '1.18.2'], ['1.17.0', '1.17']);

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
        check: (v) => limitsWrong(v.saRun, v.saTotal),
        fields: [{ key: 'saRun', label: 'Per run (USD)', value: '', placeholder: 'No limit' }, { key: 'saTotal', label: 'Total a month (USD)', value: '1000', placeholder: 'No limit' }] },
      { label: 'Review', note: 'Nothing changes until you press Apply.', facts: (v) => [
        { title: 'Network', meta: v.saNet === 'proxy' ? `Through ${v.saHost}:${v.saPort}` : 'Direct' },
        { title: 'Access', meta: [v.saClaude && (window.RailUI.prefs.connected('claude') ? 'Claude Code' : 'Claude Code (not signed in)'), v.saCopilot && 'Copilot'].filter(Boolean).join(', ') || 'None' },
        { title: 'Roles', meta: { rec: 'Recommended', cheap: 'Cheaper', keep: 'As they are' }[v.saRoles] },
        { title: 'Limits', meta: `Each task ${usd(v.saRun)}, all tasks ${usd(v.saTotal)} a month` },
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
  const NONE = ['', 'the default', "Each job's own default"];
  const roleKey = (e, r, what) => `role_${e}_${r}_${what}`;
  // An engine's roles: one sentence, its choices in it. Clearing a role is picking the default.
  const ROLE_WORDS = { deep: 'Plans and reviews on', every: 'Writes code on', quick: 'Quick jobs on' };
  const roleRow = ([e, label]) => {
    const [models, efforts, set] = ENGINE_MODELS[e], picks = {};
    for (const [r, , help] of ROLES) {
      const who = ROLE_WORDS[r].replace(' on', '');
      picks[roleKey(e, r, 'm')] = { ...P(set[r] || '', [NONE, ...models], help), name: who };
      if (efforts) picks[roleKey(e, r, 'e')] = { ...P(efforts.some((x) => x[0] === 'medium') ? 'medium' : efforts[0][0], efforts, 'Its effort'), name: who + ' effort' };
    }
    return { name: label.replace(' (beta)', ''), help: e === 'claude' || e === 'codex' ? 'Steps, Chat and helper jobs fall back to these. A team policy can also set them' : 'Steps and Chat fall back to these. Helper jobs run on Claude or Codex', picks,
      say: (sv) => ROLES.map(([r]) => `${ROLE_WORDS[r]} {${roleKey(e, r, 'm')}}${efforts && sv[roleKey(e, r, 'm')] ? ` at {${roleKey(e, r, 'e')}}` : ''}`).join('; ') };
  };
  const roleName = (sv, r) => pickText([NONE, ...MODEL], sv[roleKey('claude', r, 'm')]);

  // A job runs on its role's model, or on one picked here: one sentence per job, its choice in the sentence. Clearing is
  // picking its role again, so there is nothing else to learn. What it offers follows the engine New run starts on; a
  // helper job runs on Claude or Codex.
  const slot = (title, role, o = {}) => ({ title, role, factory: o.factory || '', detail: o.detail || '' });
  const jobEngine = (kind, sv) => (kind === 'jobHelp' && sv.eng !== 'codex' ? 'claude' : sv.eng);
  const jobOptions = (j, kind) => (sv) => { const e = jobEngine(kind, sv), factory = e === 'claude' ? j.factory : '';
    return [...(factory ? [[`model:${factory}`, `${factory} (default)`, 'What Worca ships for this job']] : []), ['follows', `Follows ${j.role}`, `Follows ${j.role} in Roles`], ...ENGINE_MODELS[e][0].filter(([, x]) => x !== factory).map(([, x]) => [`model:${x}`, x])]; };
  const jobRows = (list, kind) => list.map((j, i) => {
    const key = kind + i, start = j.factory ? `model:${j.factory}` : 'follows';
    return { name: j.title, help: j.detail, say: '{' + key + '}',
      picks: { [key]: P(start, jobOptions(j, kind), j.detail) },
      acts: [{ label: 'Test', help: 'Sends one tiny prompt to this model', when: (sv) => sv[key] !== 'follows', do: (sv) => (j.factory && sv[key] === start && !sv.claudeIn ? `${j.title}: sign in to Claude Code or pick a model` : `Would send ${String(sv[key]).replace('model:', '')} one tiny prompt`) }] };
  });
  const jobsSet = (list, kind, sv) => list.filter((_, i) => sv[kind + i] !== 'follows').length;
  // Another engine: a job's own model that it does not offer goes back to its role, and the toast says how many.
  const engineChanged = (sv) => { let n = 0; for (const [list, kind] of [[STEPS, 'jobStep'], [HELPERS, 'jobHelp']]) list.forEach((j, i) => { const k = kind + i; if (!jobOptions(j, kind)(sv).some((o) => o[0] === sv[k])) { sv[k] = 'follows'; n += 1; } }); return n ? (n === 1 ? '1 job back to its role' : `${n} jobs back to their roles`) : ''; };
  const HELPERS = [
    slot('Titles', 'Quick jobs', { detail: 'Writes the short title every task and chat gets.' }),
    slot('Auto workflow classifier', 'Everyday coding', { detail: 'Reads an Auto run\'s task and picks the workflow it runs.' }),
    slot('Run overview', 'Quick jobs', { detail: 'Writes the overview a finished run opens on.' }),
    slot('PR description', 'Quick jobs', { detail: 'Drafts the pull request description.' }),
    slot('Memory defragment', 'Quick jobs', { factory: 'Sonnet 5', detail: 'Runs Memory defragment, which restructures saved memory.' }),
    slot('Agent generation', 'Everyday coding', { detail: 'Drafts a new agent\'s prompt and metadata in Workflows › Agents.' }),
    slot('Run naming', 'Quick jobs', { detail: 'Suggests the title and branch name on New run.' }),
    slot('Command summaries', 'Quick jobs', { detail: 'Writes the one-line summary of a chat command.' }),
    slot('Workspace scan', 'Everyday coding', { detail: 'Runs the scan that maps how member projects connect.' }),
    slot('Requirements interview', 'Everyday coding', { detail: 'Runs the interview rounds on the Requirements page.' }),
    slot('Second-opinion reviewer', 'Deep thinking', { factory: 'Opus 5.5', detail: 'The one review that runs on another model than its step (Shaper\'s Product reviewer), at medium effort.' }),
  ];
  const STEPS = ['Plan', 'Plan review', 'Implement', 'Review', 'Fix'].map((t, i) => slot(t, i === 2 || i === 4 ? 'Everyday coding' : 'Deep thinking'));

  // ---- Chat › Channels: a chat plugin's channel, with what stops it working ----
  // Its switch and state live here; Plugins installs and sets it up. Everything reads channelState.
  const channel = (title, key, o) => ({ title, sw: { key, on: o.on, off: (sv) => (sv.chToken[title] ? '' : 'Set it up in Plugins first') }, meta: o.meta, chip: (sv) => channelState(sv, title, key), when: (sv) => installed(sv, title),
    live: (sv) => (!sv.chToken[title] ? 'Needs a bot token: set it up in Plugins' : o.warn && !sv.chAllowed[title] ? o.warn : o.meta),
    mark: (sv) => (sv.chToken[title] && o.warn && !sv.chAllowed[title] ? 'is-amber' : ''),
    // A row's one step: a problem's way out first; Test once nothing is wrong.
    menu: (r, sv) => (!sv.chToken[title] ? ['Set up'] : o.warn && !sv.chAllowed[title] ? ['Allow chat'] : [sv[key] ? 'Test' : { text: 'Test', off: true, help: 'Turn it on to send a test' }]),
    on: {
      Test: () => `Would send a test to ${title}`,
      'Set up': (r, x) => x.go('plugins'),
      'Allow chat': (r, x) => x.dialog({ title: `Allow a chat on ${title}`, yes: 'Allow', fields: [{ key: 'chat', label: 'Chat id', value: o.chatId || '', hint: 'Replies like /approve from this chat count' }], check: (v) => (v.chat.trim() ? '' : 'It needs a chat id'), then: (v, sv) => { sv.chAllowed = { ...sv.chAllowed, [title]: v.chat }; return `Chat ${v.chat} can answer on ${title}`; } }),
    } });

  // ---- Plugins: the trackers, each with its own Ticket updates ----
  const MOVES = window.RailUI?.TRACKER_MOVES || { jira: [] };   // the library's; the sweeps read this file for its section ids, without it
  const ruleWords = (m) => (m === 'none' ? 'Don\'t move' : m === 'done' ? 'Any Done status' : `Moves to ${m}`);
  const rule = (title, move, gone) => ({ title, move, gone, mark: gone ? 'is-amber' : '',
    meta: gone ? `${title} has no status named ${gone} any more: pick another; until then a task leaves its tickets where they are` : ruleWords(move),
    menu: ['Change rule', 'Remove'],
    on: { 'Change rule': (r, x) => x.dialog({ title: `Rule for ${r.title}`, yes: 'Save', fields: [{ key: 'to', label: 'Move its ticket', value: r.move, options: [['none', 'Don\'t move'], ['done', 'Any Done status'], ...MOVES[r.tracker].filter((m) => m !== r.gone).map((m) => [m, m])] }], then: (v) => { r.move = v.to; r.gone = ''; r.meta = ruleWords(v.to); r.mark = ''; return `${r.title}: ${r.meta}`; } }) } });

  const plugin = (title, meta, key, on, o = {}) => ({ title, meta, sw: { key, on }, mark: o.mark, menu: o.nothing ? ['Uninstall'] : o.menu ? (r) => (store()?.hasUpdate?.(title) === false ? ['Settings', 'Uninstall'] : o.menu) : ['Settings', 'Uninstall'], when: (sv) => installed(sv, title), live: () => (store()?.hasUpdate?.(title) === false ? meta.replace(' · 1 update', '') : meta),
    on: {
      Settings: (r, x) => x.dialog({ title: `${title} settings`, fields: o.fields || [{ key: 'url', label: 'Address', value: o.url || '' }], check: o.fields ? undefined : (v) => (isUrl(v.url) ? '' : 'An address reads like https://example.com'), done: `${title} saved` }),
      Update: (r) => { store()?.update?.(title); r.meta = meta.replace(' · 1 update', ''); r.mark = ''; r.menu = ['Settings', 'Uninstall']; return `${title} updated`; },
      Uninstall: uninstall(title),
    }, open: o.nothing ? undefined : (r, x) => r.on.Settings(r, x) });   // nothing: it asks for no setup, so it has no settings to open
  // A chat channel's plugin installs it and sets it up; its switch and state are Chat's, one link away.
  const channelPlugin = (title, key) => ({ title, meta: 'A chat channel', when: (sv) => installed(sv, title),
    live: (sv) => (sv.chToken[title] ? `A chat channel · ${channelState(sv, title, key) === 'Off' ? 'off' : 'on'} in Chat` : 'A chat channel · needs a bot token'),
    menu: (r, sv) => (sv.chToken[title] ? ['Channel in Settings › Chat', 'Settings', 'Uninstall'] : ['Set up…', 'Uninstall']),
    on: {
      'Channel in Settings › Chat': (r, x) => x.go('ask'),
      Settings: (r, x) => x.dialog({ title: `${title} settings`, yes: 'Save', fields: [{ key: 'allowed', label: 'Allowed chat IDs', value: x.sv.chAllowed[title] || '', hint: 'Replies from these chats count' }], then: (v, sv) => { sv.chAllowed = { ...sv.chAllowed, [title]: v.allowed }; return `${title} saved`; } }),
      'Set up…': (r, x) => x.dialog({ title: `Set up ${title}`, yes: 'Save', fields: [{ key: 'tok', label: 'Bot token', value: '', hint: 'Kept in a file only you can read' }], check: (v) => (v.tok.trim() ? '' : 'It needs a bot token'), then: (v, sv) => { sv.chToken = { ...sv.chToken, [title]: true }; sv[key] = true; return `${title} is set up and on, in Chat`; } }),
      Uninstall: uninstall(title),
    }, open: (r, x) => (x.sv.chToken[title] ? x.go('ask') : r.on['Set up…'](r, x)) });

  // A tracker plugin keeps its own projects and rules; they fold under it, with Labs › Ticket updates on.
  const tracker = (title, id, meta, key, on, o, rules) => ({ ...plugin(title, meta, key, on, o), foldFlag: 'ticketUpdates', foldHelp: 'Ticket updates', moreList: rules.map((r) => ({ ...r, tracker: id })), empty: 'No project rules', more: [
    { name: 'Ticket updates', help: 'A project\'s own rule wins over All projects', say: 'What a finished run does to its ticket', acts: [{ label: 'Add rule', edit: (sv) => ({ title: 'Add a project rule', yes: 'Add', fields: [{ key: 'proj', label: 'Project', value: '', hint: id === 'github' ? 'A repository: owner/repo' : 'A project you work on' }, { key: 'to', label: 'Move its ticket', value: 'done', options: [['none', 'Don\'t move'], ['done', 'Any Done status'], ...MOVES[id].map((m) => [m, m])] }], check: (v) => (!v.proj.trim() ? 'A rule needs a project' : id === 'github' && !/^[\w.-]+\/[\w.-]+$/.test(v.proj.trim()) ? 'A repository reads owner/repo' : ''), then: (v) => { const k = `plugins/Installed/Trackers/${title}`; (sv.__recs[k] ||= rules.map((r, i) => ({ ...r, tracker: id, id: 'r' + i }))).push({ ...rule(v.proj, v.to), tracker: id, id: 'n' + Date.now() }); return `Rule added for ${v.proj}`; } }) }] },
    { name: 'Projects', help: 'None picked means all projects', say: 'New run and Requirements list only **{tuProjects_' + id + '}**', vals: { ['tuProjects_' + id]: id === 'github' ? 'acme/worca' : id === 'azure' ? 'Billing' : 'WEB, API, INFRA' }, acts: [edit('Change your projects', [{ key: 'tuProjects_' + id, label: 'Projects you work on', hint: 'Comma-separated; none means all. Removing one keeps its rule' }], { done: 'Projects saved' })] },
    { name: 'All projects', say: 'When a task finishes successfully, {tuAll_' + id + '}', picks: { ['tuAll_' + id]: P('done', O(['none', 'don\'t move its ticket'], ['done', 'move it to any Done status', 'One the ticket can reach, never Won\'t Do, Rejected or Duplicate']), 'Unless a project below says otherwise') } },
  ] });
  // Plugins › Sources: the head's action opens them; a source's row opens the store it fills.
  function toStore(r, x) { x.sv.__dialog = null; return x.page('marketplace', 'Opens the Marketplace, the store in the sidebar'); }
  const SOURCES = [
    { title: 'worca-official', meta: '12 plugins', fig: 'synced 5 min ago', menu: ['Refresh'], open: toStore, on: { Refresh: (r) => { r.fig = 'synced just now'; return 'worca-official refreshed'; } } },
    { title: 'team-internal', meta: 'Can\'t be reached · last synced yesterday', mark: 'is-amber', menu: ['Try again', 'Remove'], open: toStore, on: { 'Try again': (r) => { r.mark = ''; r.meta = '4 plugins'; r.fig = 'synced just now'; r.menu = ['Refresh', 'Remove']; r.on = { Refresh: (x) => { x.fig = 'synced just now'; return 'team-internal refreshed'; } }; return 'team-internal is back'; } } },
  ];
  const sourcesDialog = (sv) => ({ title: 'Sources', yes: 'Add marketplace', where: 'plugins/Sources', list: SOURCES, fields: [{ key: 'where', label: 'Add a marketplace', value: '', hint: 'A repository or a folder' }],
    check: (v) => (v.where.trim() ? '' : 'Say where it is'),
    then: (v) => { (sv.__recs['plugins/Sources'] ||= SOURCES.map((it, i) => ({ ...it, id: 'r' + i }))).push({ id: 'n' + Date.now(), title: v.where, meta: 'Synced just now', menu: ['Remove'], open: toStore }); return `Marketplace added: ${v.where}`; } });

  // ---- Models › Sign-ins ----
  const orFree = (sv) => `OpenRouter · ${sv.orLeft} of 1,000 free requests left today · resets 00:00 UTC`;
  const OPENROUTER = { base: 'https://openrouter.ai/api/v1', key: '${OPENROUTER_KEY}' };

  const SUGGEST = O(['both', 'a title and a branch name'], ['title', 'a title'], ['branch', 'a branch name']);
  const SUGGEST_WHEN = O(['typing', 'while you type the task'], ['ask', 'when you press Suggest']);
  const LATE = O(['30m', '30 minutes'], ['1h', '1 hour'], ['6h', '6 hours'], ['24h', '24 hours']);
  const REQUIRED = ['Jira', 'Sentry'];
  const GUARD_SETS = {
    Default: { deny: ['rm -rf', 'git push --force', 'curl | sh', 'git reset --hard', 'chmod -R 777', 'dd if='], paths: ['.env', '.git/', '~/.ssh'] },
    Strict: { deny: ['rm -rf', 'git push --force', 'curl | sh', 'git reset --hard', 'chmod -R 777', 'dd if=', 'sudo', 'npm publish', 'docker push', 'kubectl delete', 'terraform apply', 'git clean -fd', 'mkfs', 'shutdown'], paths: ['.env', '.git/', '~/.ssh', '~/.aws', 'secrets/', 'infra/'] },
    'Team policy': { deny: ['rm -rf', 'git push --force', 'curl | sh', 'git reset --hard', 'chmod -R 777', 'dd if=', 'sudo', 'npm publish', 'kubectl delete'], paths: ['.env', '.git/', '~/.ssh'] },
  };

  // A guardrail set's counts read its lists; viewing one shows them.
  const guardCounts = (r) => `${plural(r.deny.length, 'deny rule')} · ${plural(r.paths.length, 'protected path')}`;
  const guardNote = (r) => `Deny: ${r.deny.map((x) => '`' + x + '`').join(', ')}. Protected: ${r.paths.map((x) => '`' + x + '`').join(', ')}.${r.about ? ' ' + r.about : ''}`;

  const SECTIONS = {
    general: { title: 'General', meta: 'Setup, storage, and which version of Worca runs.', sections: [
      { title: 'Setup', rows: [
        { name: 'Setup assistant', say: 'Checks this machine, the network, model access and your limits', acts: [{ label: 'Run setup', edit: setup }] },
        { name: 'Getting started', say: 'The Getting started chat: sign in, add a project, then your first task{gsWords}', vals: { gsWords: (sv) => (sv.gsShown ? ': back in the sidebar' : '') }, acts: [{ label: 'Show again', off: (sv) => (sv.gsShown ? 'The checklist is already showing' : ''), do: (sv) => { sv.gsShown = true; return 'The Getting started checklist is back in the sidebar'; } }] },
        { name: 'Browser extension', help: 'Works with a local Worca only', say: 'Add Worca to {browser}', picks: { browser: P('chrome', O(['chrome', 'Chrome'], ['edge', 'Edge'], ['firefox', 'Firefox']), 'Which browser to install it in') }, foldLabel: 'Paired browsers',
          acts: [{ label: 'How to install', edit: (sv) => ({ title: `Install in ${{ chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' }[sv.browser]}`, view: true, yes: 'Close', note: 'Load the folder `~/.worca-cc/extension` in the browser\'s extensions page, or take the zip from the latest release. It pairs on first use.' }) }],
          moreList: [
            { title: 'MacBook · Chrome', meta: 'Paired 2 Oct · last used today', menu: ['Revoke'] },
            { title: 'Work PC · Edge', meta: 'Paired 14 Sep · not used yet', menu: ['Revoke'] },
          ], empty: 'No browser paired' },
      ] },
      { title: 'Storage', min: 'advanced', rows: [
        { name: 'Folders', say: 'Data lives in `{root}`; new projects go in `{projects}`', vals: { root: '~/.worca-cc', projects: '~/src' },
          acts: [edit('Change the folders', [{ key: 'root', label: 'Worca folder', hint: 'Does not move data: Worca starts fresh here, and the old folder stays as it was' }, { key: 'projects', label: 'Projects folder', hint: 'Its CLAUDE.md, skills and .mcp.json reach every agent' }, { key: 'useDefaults', button: 'Use the defaults', hint: 'Fills in ~/.worca-cc and ~/src; Save applies them', when: (v) => v.root !== '~/.worca-cc' || v.projects !== '~/src', do: (v) => { v.root = '~/.worca-cc'; v.projects = '~/src'; return 'Save to start fresh in ~/.worca-cc'; } }], { done: 'Folders saved; new tasks use them', check: (v) => (isFolder(v.root) && isFolder(v.projects) ? '' : 'A folder is a path such as ~/src or /opt/work') })] },
        { name: 'Diagnostics', min: 'expert', say: 'Log each agent start in the run log: its binary, arguments and routing, never a credential. A set `WORCA_DEBUG_SPAWN` overrides this', sw: { key: 'spawnLog', on: false, why: 'Applies to runs started here and from the CLI, with no restart' } },
      ] },
      { title: 'Credentials', rows: [
        { name: 'Model keys', help: 'With a team credential broker, keys come from it and this opens its key page', say: 'Each engine signs in by itself, in Models › Sign-ins', acts: [{ label: 'Open Models', min: 'expert', go: 'models', help: 'Models › Sign-ins' }] },
        { name: 'GitHub', say: 'Signed in as **@emil-angelov**' },
      ] },
      { title: 'About', rows: [
        { name: 'Version', help: 'From a source checkout this says Source build and offers no Update', say: '**{verNow}** · {updNow}', vals: { verNow: (sv) => short(sv.ver), updNow: updWords },
          acts: [
            { label: (sv) => (sv.upd === 'failed' ? 'Try again' : 'Update'), id: 'update', when: (sv) => canUpdate(sv) || sv.upd === 'failed', do: (sv) => { if (!sv.updTried) { sv.updTried = true; sv.upd = 'failed'; sv.__open = 'more:general/About/Version'; return ''; } sv.ver = sv.latest; sv.upd = 'latest'; return `Worca ${short(sv.ver)} is running`; } },
            { label: 'Check now', when: (sv) => sv.upd === 'latest', do: (sv) => { if (sv.ver === '1.20.0') return 'You have the latest version'; sv.latest = '1.20.0'; sv.upd = 'available'; return `New version: ${short(sv.latest)}`; } },
          ],
          more: [
            { name: 'Other versions', say: 'Move to any released version, older ones too', acts: [{ label: 'Choose version…', edit: (sv) => ({ title: 'Choose a version', yes: 'Install it', fields: [{ key: 'to', label: 'Version', value: sv.ver, options: VERSIONS }], check: (v) => (v.to === sv.ver ? `Already on ${short(sv.ver)}` : ''), then: (v) => { sv.latest = '1.20.0'; sv.ver = v.to; sv.upd = v.to === sv.latest ? 'latest' : 'back'; return `Worca ${short(v.to)} is running`; } }) }] },
            { name: 'Updates', say: 'Look for new versions of Worca once a day', sw: { key: 'updates', on: true, why: 'Nothing installs by itself' } },
            { name: 'Release notes', say: '`docs.worca.dev/changelog`', acts: [opens('the changelog')] },
            { name: 'Command', when: outdated, say: 'Or from a terminal: `{updCmd}`', vals: { updCmd: cmd }, acts: [{ label: 'Copy command', copy: cmd }] },
            { name: 'Last update', when: (sv) => sv.upd === 'failed', say: (sv) => { const f = updateFailed(sv); return `${f.title}. ${f.detail} Update from a terminal instead`; }, acts: [{ label: 'Dismiss', do: (sv) => { sv.upd = 'available'; return ''; } }] },
            { name: 'npm output', when: (sv) => sv.upd === 'failed', say: 'The last lines npm wrote', acts: [{ label: 'View', edit: { title: 'npm output', view: true, yes: 'Close', note: '`npm ERR! code EACCES` · `npm ERR! syscall rename` · `npm ERR! path /usr/local/lib/node_modules/@worca/app`' } }] },
            { name: 'Repository', say: '`github.com/SinishaDjukic/worca-cc`', acts: [opens('the repository')] },
            { name: 'Report a bug', say: 'Opens a new issue, labelled bug', acts: [{ label: 'Open', id: 'bug', say: 'Would open a new bug issue on GitHub in a new tab' }] },
            { name: 'Suggest an improvement', say: 'Opens a new issue, labelled enhancement', acts: [{ label: 'Open', id: 'idea', say: 'Would open a new enhancement issue on GitHub in a new tab' }] },
          ] },
      ] },
    ] },

    team: { min: 'advanced', title: 'Team policy', meta: 'What your team requires of every Worca that follows its policy.',
      lock: { level: 'expert', why: 'Expert mode changes the policy; here you can read it' }, sections: [
      { title: 'Not published', when: (sv) => pending(sv).length > 0, meta: 'Nothing reaches your team until you publish: one commit on the worca-policy branch, read by every teammate\'s Worca.', actions: [
        { label: 'Cancel editing', do: (sv) => { Object.assign(sv, sv.pol); return 'Changes dropped; the policy is as published'; } },
        { label: 'Publish to worca-policy', id: 'publish', confirm: (sv) => ({ text: `Publish ${plural(pending(sv).length, 'change')} to worca-policy? Every teammate's Worca reads it at its next run.`, yes: 'Publish', then: (s) => { s.pol = Object.fromEntries(Object.keys(POLICY).map((k) => [k, s[k]])); return 'Policy published · commit 7a1c3e2'; } }) },
      ], rows: [
        { name: 'Changes', say: (sv) => pending(sv).map((k) => POLICY_WORDS[k](sv[k])).join(' · '), acts: [{ label: 'Copy for PR', help: 'The whole policy as JSON, for a pull request against worca-policy', copy: (sv) => JSON.stringify(Object.fromEntries(Object.keys(POLICY).map((k) => [k, sv[k]])), null, 2), copied: 'Would copy it, to paste into .worca-policy/policy.json on a pull request' }] },
      ] },
      { title: 'Effective policy', meta: 'What the next run on this machine will use.', table: { label: 'Effective policy', columns: [{ id: 'f', label: 'Field' }, { id: 't', label: 'Team', narrow: false }, { id: 'k', label: 'Kind', narrow: false }, { id: 'y', label: 'Yours', narrow: false }, { id: 'e', label: 'Effective' }],
        rows: (sv) => [
          { f: 'Per run limit', t: usd(sv.pol.capRun), k: 'Pauses', y: usd(sv.perRun), e: usd(sv.perRun ? Math.min(+sv.perRun, +sv.pol.capRun) : sv.pol.capRun) },
          { f: 'Total limit', t: `${usd(sv.pol.capAll)} a month`, k: 'Pauses', y: sv.total ? `${usd(sv.total)} a ${sv.period}` : usd(''), e: sv.total && sv.period === 'month' ? `${usd(Math.min(+sv.total, +sv.pol.capAll))} a month` : sv.total ? `${usd(sv.total)} a ${sv.period}, ${usd(sv.pol.capAll)} a month` : `${usd(sv.pol.capAll)} a month` },
          { f: 'Guardrails', t: 'Team policy', k: 'Required', y: 'Default', e: 'Team policy' },
          { f: 'Create a PR', t: PR_WORDS[sv.pol.prOpen], k: 'Default', y: '', e: PR_WORDS[sv.pol.prOpen] },
        ] } },
      { title: 'Defaults', meta: 'A project, New run and the run page can change these.', rows: [
        { name: 'Pull requests', help: 'Create a PR when a task finishes. If it cannot, a notification says why', chip: pendingChip('prOpen', 'prSlices'), say: (sv) => (sv.prOpen === 'none' ? 'When a task finishes, {prOpen}' : 'When a task finishes, {prOpen}; a feature gets {prSlices}'),
          picks: { prOpen: P('none', O(['none', 'don\'t create a PR'], ['draft', 'create a draft PR'], ['ready', 'create a PR ready for review']), 'Team default for every project'), prSlices: P('each', O(['each', 'a PR per slice, stacked'], ['one', 'one PR for the whole feature']), 'How a feature\'s slices become pull requests', true) } },
        { name: 'Spending', chip: pendingChip('capRun', 'capAll'), say: (sv) => `Each task pauses at **${usd(sv.capRun)}**, all tasks at **${usd(sv.capAll)} a month**; you can continue past, and that is recorded`, acts: [polEdit('Change the spending caps', [{ key: 'capRun', label: 'Per run (USD)' }, { key: 'capAll', label: 'Total a month (USD)' }], (v) => (isAmount(v.capRun) && isAmount(v.capAll) && +v.capRun > 0 && +v.capAll > 0 ? (+v.capRun > +v.capAll ? 'One run cannot be allowed more than the total' : '') : 'A cap is an amount in dollars above 0'))] },
        { name: 'Workspace runs', chip: pendingChip('wsCap'), say: (sv) => `A run across a workspace pauses at **${usd(sv.wsCap)}** instead`, acts: [polEdit('Change for workspace runs', [{ key: 'wsCap', label: 'Per run (USD)' }], (v) => (isAmount(v.wsCap) && +v.wsCap > 0 ? '' : 'A cap is an amount in dollars above 0'))] },
      ] },
      { title: 'Rules', actions: [
        { label: (sv) => { const m = REQUIRED.filter((t) => !installed(sv, t)); return m.length === 1 ? `Install ${m[0]}…` : 'Install all…'; }, id: 'install', help: 'The required plugins', read: true, off: (sv) => (REQUIRED.every((t) => installed(sv, t)) ? 'Everything required is installed' : ''),
          edit: (sv) => ({ title: 'Install what is required', yes: 'Install', note: REQUIRED.filter((t) => !installed(sv, t)).map((t) => `${t}, from worca-official at commit \`c81d02e\`: ${t === 'Sentry' ? 'an MCP server' : 'a task source'}, 1 skill, no agents.`).join(' '), then: () => { const left = REQUIRED.filter((t) => !installed(sv, t)); sv.gone = Object.fromEntries(Object.entries(sv.gone).filter(([t]) => !left.includes(t))); return `Installed: ${andList(left)}`; } }) },
      ], groups: [
        { title: 'Required plugins', meta: 'Installing shows its source and what it ships, and waits for your click.', list: [
          ...REQUIRED.map((t) => ({ title: t, meta: 'Installed', live: (sv) => (installed(sv, t) ? 'Installed' : 'Missing on this machine'), mark: (sv) => (installed(sv, t) ? '' : 'is-amber') })),
        ] },
        { title: 'Blocked', meta: 'A run with one of these enabled proceeds and is recorded as off-policy.', list: [
          { title: 'Unknown MCP servers', meta: 'Blocked by acme/worca-policy', when: (sv) => sv.pol.blockMcp, chip: (sv) => (sv.blockMcp ? '' : 'Not published'), menu: (r, sv) => (sv.blockMcp ? [{ id: 'Unblock', text: 'Unblock' }] : ['Keep blocked']),
            on: { Unblock: (r, x) => { x.sv.blockMcp = false; return pendingWords(x.sv); }, 'Keep blocked': (r, x) => { x.sv.blockMcp = true; return pendingWords(x.sv); } } },
        ] },
        { title: 'Guardrail sets', meta: 'Read-only on every machine that follows this policy.', list: [
          { title: 'Team policy', meta: `${plural(GUARD_SETS['Team policy'].deny.length, 'deny rule')} · read-only`, open: (r, x) => x.go('guardrails') },
        ] },
        { title: 'Models', meta: 'Selectable everywhere a model is chosen.', list: [
          { title: 'Opus via Acme gateway', meta: 'Through Anthropic-compatible · roles for Claude and Codex only', openMin: 'expert', open: (r, x) => x.go('models') },
        ] },
        { title: 'MCP servers', meta: 'What the policy adds to every task. Each waits for your consent.', list: [
          { title: 'github', meta: 'stdio · consented on 2 Oct', open: (r, x) => x.dialog({ title: 'github', view: true, yes: 'Close', note: 'Runs `npx @modelcontextprotocol/server-github`, with `GITHUB_TOKEN` from your settings.' }) },
        ] },
      ] },
      { title: 'Editing', rows: [
        { name: 'Policy', chip: pendingChip('policyTitle', 'policyNotes'), say: (sv) => `**${sv.policyTitle}**; it lives on the \`worca-policy\` branch, and only what you publish reaches your team`, acts: [{ label: 'Edit policy', edit: { title: 'Edit the policy', yes: 'Add to changes', note: 'Nothing reaches your team until you publish.', fields: [{ key: 'policyTitle', label: 'Title' }, { key: 'policyNotes', label: 'Notes', multiline: true, hint: 'Who to ask, and why' }], check: (v) => (v.policyTitle.trim() ? '' : 'A policy needs a title'), then: (v, sv) => { Object.assign(sv, v); return pendingWords(sv); } } }], more: [
          { name: 'Home', say: 'Follows **{policyHome}** · synced today', vals: { policyHome: 'acme/worca-policy' }, acts: [edit('Change the policy home', [{ key: 'policyHome', label: 'Repository', hint: 'The project whose marker branch carries the policy' }], { yes: 'Follow it', done: 'Now following the new policy home' })] },
          { name: 'Consent', say: 'Accepted on 2 Oct; a change to it asks again', acts: [{ label: 'Review', read: true, edit: { title: 'Accepted policy', view: true, yes: 'Close', note: 'Policy version `4f2a91c`, published by @dana on 1 Oct: required plugins, spending caps, the Team policy guardrail set and one model.' } }] },
        ] },
      ] },
    ] },

    experimental: { title: 'Labs', meta: 'Features still being shaped. Each switch applies to everyone using this Worca.', sections: [
      { title: 'Features', meta: 'Labs features may change, break or disappear in any release.', actions: [
        { label: 'Reset all', help: 'Every feature back to its default; asks first', off: () => (flagsChanged().length ? '' : 'Nothing to reset: every feature is at its default'),
          confirm: { text: 'Turn every Labs feature back to its default?', yes: 'Reset all', then: () => { for (const f of flagsChanged()) window.RailUI.prefs.setFlag(f.key, f.on); return 'Labs: back to its defaults'; } } },
      ], rows: [
        { name: 'Guide', say: 'How Labs works, and what a stage means', acts: [{ label: 'Open', say: 'Would open the Labs guide in a new tab' }] },
      ], groups: ['Beta', 'Experimental'].map((stage) => ({ title: stage, rows: FLAGS.filter((f) => f.stage === stage).map((f) => ({ name: f.name, say: f.locked ? `${f.say}. ${f.locked}` : f.say, sw: { flag: f.key, on: f.on, why: f.why, locked: f.locked } })) })) },
    ] },

    runs: { title: 'Tasks', meta: 'How tasks spend, start and wait.', sections: [
      { title: 'Spending', meta: spentWords, rows: [
        { name: 'Budget', say: (sv) => `All tasks pause at ${totalCap(sv)}; one run at ${runCap(sv)}`,
          acts: [{ label: 'Change…', edit: { title: 'Change the budget', yes: 'Save', note: 'Empty means only your team\'s cap applies. The tighter of the two wins.', check: (v) => limitsWrong(v.perRun, v.total), fields: [
            { key: 'perRun', label: 'Per run (USD)', placeholder: 'No limit' }, { key: 'total', label: 'Total (USD)', placeholder: 'No limit' }, { key: 'period', label: 'The total starts again', options: O(['day', 'Each day, at midnight'], ['week', 'Each week, from Monday'], ['month', 'Each month, from the 1st']) },
          ], done: 'Budget saved' } }],
          more: [
            { name: 'Team caps', say: 'Your team sets its own caps; you can continue past one when a task pauses, and that is recorded', min: 'advanced', acts: [{ label: 'Open', id: 'team', go: 'team', help: 'Settings › Team policy' }] },
            { name: 'Usage', min: 'advanced', say: 'What was spent, per harness', acts: [{ label: 'Open', id: 'usage', click: ['[data-acct]', '[data-sub="usage"]'], help: 'The profile menu\'s Usage and costs' }] },
          ] },
        { name: 'Hourly rate', say: (sv) => `Time saved is counted at **${usd(sv.rate)}** an hour`, vals: { rate: '35' }, acts: [edit('Change the hourly rate', [{ key: 'rate', label: 'USD an hour', hint: 'What an hour of a developer costs, for Statistics' }], { done: 'Hourly rate saved', check: (v) => (isAmount(v.rate) && +v.rate > 0 && +v.rate <= 1000 ? '' : 'A rate is an amount in dollars, above 0 and up to 1,000') })] },
        { name: 'Cost tags', say: (sv) => { const tags = sv.__recs['runs/Spending/Cost tags'] || COST_TAGS, req = tags.filter((t) => t.required).map((t) => `**${t.title}**`); if (!tags.length) return 'No cost tags: spend is counted per run only'; return `Spend is counted by ${andList(tags.map((t) => `**${t.title}**`))}; ${sv.tagsReq && req.length ? `a task needs its ${andList(req)}` : 'a task starts without any'}`; }, acts: [{ label: 'Add tag', edit: (sv) => ({ title: 'Add a cost tag', yes: 'Add', fields: costTagFields('', '', false), check: (v) => (v.name.trim() ? '' : 'A tag needs a name'), then: (v) => { const k = 'runs/Spending/Cost tags'; sv.__recs[k] ||= COST_TAGS.map((it, i) => ({ ...it, id: 'r' + i })); sv.__recs[k].push({ ...costTag(v.name, v.vals, v.req), id: 'n' + Date.now() }); sv.__open = 'more:' + k; return `Cost tag added: ${v.name}`; } }) }], more: [
          { name: 'Required', say: 'A run starts only with every required cost tag set', sw: { key: 'tagsReq', on: true } },
        ], moreList: COST_TAGS },
      ] },
      { title: 'Starting', rows: [
        { name: 'Naming', flag: 'smartRunNaming', say: (sv) => (sv.naming ? `Suggest ${pickText(SUGGEST, sv.what)} ${pickText(SUGGEST_WHEN, sv.when)}` : 'You name each task; nothing is suggested'), sw: { key: 'naming', on: true, why: 'Labs › Smart run naming' }, more: [
          { name: 'Suggestions', say: 'Suggest {what} for a new run, {when}', picks: { what: P('both', SUGGEST, 'What the model suggests'), when: P('typing', SUGGEST_WHEN, 'When it suggests', true) } },
          { name: 'Branch', help: 'A project can override the pattern and the types in its own Settings', say: 'Branches are named `{pattern}`, the type one of {types}', vals: { pattern: '{type}/{slug}', types: 'feat, fix, chore, docs, refactor, test' }, acts: [edit('Change the branch pattern', [{ key: 'pattern', label: 'Pattern', hint: '{type}, {slug}, {ticket} and {id} are filled in' }, { key: 'types', label: 'Types', hint: 'The model picks one of these' }], { done: 'Branch pattern saved' })] },
          { name: 'Add run id', say: 'Append the short run id when the pattern has no `{id}`', sw: { key: 'runId', on: false } },
          { name: 'Model', say: 'Uses the **Run naming** model, about $0.001 a suggestion', acts: [{ label: 'Open Models', min: 'expert', go: 'models', help: 'Models › Helper jobs' }] },
          { name: 'Defaults', say: 'Back to `{type}/{slug}` and the six types', acts: [{ label: 'Use defaults', do: (sv) => { sv.pattern = '{type}/{slug}'; sv.types = 'feat, fix, chore, docs, refactor, test'; sv.runId = false; return 'Naming: back to its defaults'; } }] },
        ] },
        { name: 'Sync', min: 'advanced', help: GIT_TIP, say: (sv) => (sv.sync ? 'Bring the source branch up to date first' : 'A run starts from the branch as it is'), sw: { key: 'sync', on: true }, more: [
          { name: 'Remote', say: 'Sync from {remote}; if the branch has diverged, {div}', picks: { remote: P('origin', O('origin', 'upstream'), 'The remote to sync from'), div: P('ask', O(['ask', 'ask me'], ['origin', 'start from origin'], ['stop', 'don\'t run']), 'What a task does when the branch has diverged', true) } },
          { name: 'Background checks', say: '{bg}', picks: { bg: P('10', O(['off', 'Never checks remotes'], ['5', 'Checks remotes every 5 minutes'], ['10', 'Checks remotes every 10 minutes'], ['30', 'Checks remotes every 30 minutes'], ['60', 'Checks remotes every hour']), 'How often Worca looks for new commits') } },
        ] },
        { name: 'Pull requests', help: GIT_TIP, say: (sv) => (sv.prDraft ? 'Draft the description with AI as the PR opens' : 'You write the description when the PR opens'), sw: { key: 'prDraft', on: false }, more: [
          { name: 'Create a PR', min: 'advanced', say: 'A finished run follows the team default: **{prNow}**', vals: { prNow: (sv) => ({ none: 'no PR', draft: 'a draft PR', ready: 'a PR ready for review' }[sv.pol.prOpen]) }, acts: [{ label: 'Open', id: 'team', go: 'team', help: 'Settings › Team policy › Defaults; a project or New run can change it' }] },
        ] },
        { name: 'Schedules', min: 'advanced', say: (sv) => `${sv.late === 'skip' ? 'A missed start is skipped' : `A missed start still runs, up to **${pickText(LATE, sv.lateMax)}** late`}; a schedule pauses after **${sv.fails} failures** in a row`, more: [
          { name: 'Missed starts', say: (sv) => (sv.late === 'skip' ? 'When Worca was not running, {late}' : 'When Worca was not running, {late} up to {lateMax} late'), picks: { late: P('late', O(['late', 'start it'], ['skip', 'skip it']), 'What a scheduled run does when its time passed'), lateMax: P('6h', LATE, 'How late it may still start', true) } },
          { name: 'Failures', say: 'Pause a repeating schedule after {fails} failures in a row', picks: { fails: P('3', O('2', '3', '5', '10'), 'Failures in a row before it pauses') } },
        ] },
      ] },
      { title: 'Limits', meta: 'Near a limit: a provider at or past the warning line.', rows: [
        { name: 'Paused runs', say: 'A run paused at a usage limit {resume}', picks: { resume: P('auto', O(['auto', 'resumes after the reset', 'Worca schedules its resume for 5 minutes after the limit resets'], ['me', 'waits for you', 'It stays paused until you resume it']), 'What a task paused at a usage limit does when the limit resets') } },
      ] },
      { title: 'Away mode', min: 'advanced', meta: 'Going away is the Away switch in your profile menu.', rows: [
        { name: 'Hours', say: 'Worca answers your runs\' questions from **{awayFrom} to {awayTo}**, {awayZone}', vals: { awayFrom: '22:00', awayTo: '07:00', awayZone: 'Europe/Sofia' }, acts: [edit('Change the away hours', [{ key: 'awayFrom', label: 'From', hint: 'A time, such as 22:00' }, { key: 'awayTo', label: 'To' }, { key: 'awayZone', label: 'Time zone' }], { done: 'Away hours saved', check: (v) => { const t = /^([01]\d|2[0-3]):[0-5]\d$/; return !t.test(v.awayFrom) || !t.test(v.awayTo) ? 'A time reads like 22:00' : v.awayZone.trim() ? '' : 'It needs a time zone'; } })], more: [
          { name: 'Runs', say: 'Worca answers on {which}; by day, a marked run {byDay}', picks: { which: P('marked', O(['marked', 'runs you marked'], ['all', 'every task']), 'Which runs Worca answers on while you are away'), byDay: P('30', O(['never', 'waits for you'], ['15', 'is answered after 15 minutes'], ['30', 'is answered after 30 minutes'], ['60', 'is answered after an hour']), 'How long a question waits by day before Worca answers it', true) } },
          { name: 'Decisions', say: (sv) => (sv.method === 'mixed' ? 'It {method}. An agent is sure at {sure}, with a lead of {lead}' : 'It {method}'), picks: { method: P('mixed', O(['mixed', 'trusts a sure agent, and otherwise weighs the options', 'Trusts the agent when it is sure; otherwise weighs the options'], ['trust', 'always trusts the agent'], ['weigh', 'always weighs the options']), 'How Worca picks an answer'), sure: P('60', O(['50', '50%'], ['60', '60%'], ['70', '70%'], ['80', '80%']), 'How sure the agent must be'), lead: P('25', O(['15', '15 points'], ['25', '25 points'], ['40', '40 points']), 'How far its pick must lead the next one', true) } },
          { name: 'Priorities', say: 'Matches past decisions **{pPast}** · easy to undo **{pUndo}** · changes least **{pLeast}** · conventions **{pConv}** · cheapest **{pCheap}**', vals: { pPast: '3', pUndo: '3', pLeast: '2', pConv: '2', pCheap: '1' }, acts: [edit('Change the priorities', [{ key: 'pPast', label: 'Matches past decisions', hint: '0 ignores it, 10 decides' }, { key: 'pUndo', label: 'Easy to undo' }, { key: 'pLeast', label: 'Changes the least' }, { key: 'pConv', label: 'Follows the conventions' }, { key: 'pCheap', label: 'Costs the least' }], { done: 'Priorities saved', check: (v) => (['pPast', 'pUndo', 'pLeast', 'pConv', 'pCheap'].every((k) => /^\d+$/.test(v[k]) && +v[k] <= 10) ? '' : 'A priority is a whole number from 0 to 10') })] },
          { name: 'Model', say: 'Weighs the options with {dmodel} at {deffort} effort', picks: { dmodel: P('run', O(['run', 'the run\'s own model'], ...MODEL), 'The model that weighs the options'), deffort: P('medium', EFFORT, 'Its effort') } },
          { name: 'Limits', say: 'Pause a task after {answers} answers; while away, {spent}', picks: { answers: P('20', O('10', '20', '40'), 'Answers in one run before it pauses'), spent: P('none', O(['none', 'spending has no cap'], ['25', 'everything pauses at $25'], ['50', 'everything pauses at $50'], ['100', 'everything pauses at $100']), 'Spent while away before every task pauses', true) } },
          { name: 'Review loops', say: (sv) => `Allow {extra} extra fix ${+sv.extra === 1 ? 'round' : 'rounds'}; at the team's cap a task {exceed}`, picks: { extra: P('0', O('0', '1', '2', '3'), 'Fix rounds beyond the workflow\'s own'), exceed: P('kept', O(['kept', 'pauses'], ['exceed', 'carries on, and is flagged']), 'Whether away answers may go past the team\'s cost cap', true) } },
          { name: 'Exceptions', say: 'Always waits for you on {awayEx}', vals: { awayEx: 'approving a plan, merging and deleting' }, acts: [edit('Change the exceptions', [{ key: 'awayEx', label: 'Waits for you on', hint: 'Comma-separated' }], { done: 'Exceptions saved' })] },
        ] },
      ] },
      { title: 'Machine', rows: [
        { name: 'Capacity', min: 'advanced', say: (sv) => `Up to {n} ${sv.n === '1' ? 'task' : 'tasks'} at a time; finished tasks ${pickText(ARCHIVE, sv.arch)}`, picks: { n: P('3', O('1', '2', '3', '4', '6', '8', '12', '20'), 'More tasks wait in line') }, more: [
          { name: 'Test workers', say: 'Each task tests with {w}', picks: { w: P('half', O(['half', 'half the cores'], ['1', '1 worker'], ['2', '2 workers'], ['4', '4 workers'], ['8', '8 workers']), 'Test workers per run') } },
          { name: 'Archive', say: 'Finished tasks {arch}', picks: { arch: P('never', ARCHIVE, 'Archiving removes the branch, worktree and logs') } },
          { name: 'Checkouts', help: GIT_TIP, say: 'An action\'s checkout is {keep}; {coMax}', picks: { keep: P('demand', O(['demand', 're-created when needed'], ['success', 'kept after a successful run'], ['pr', 'kept until the PR closes']), 'When a checkout is removed'), coMax: P('none', O(['none', 'any number are kept'], ['5', 'at most 5 are kept'], ['10', 'at most 10 are kept'], ['20', 'at most 20 are kept']), 'The oldest go first', true) } },
        ] },
        { name: 'Tools', min: 'advanced', help: `${GIT_TIP}. Actions are off on hosted deployments unless an administrator enables them`, say: 'Folders open with `{editorNow}`, shells with `{terminalNow}`', vals: { editorNow: (sv) => sv.editor, terminalNow: (sv) => sv.terminal }, more: [
          { name: 'Ports', say: 'Port variables come from `{portLow}–{portHigh}`', vals: { portLow: '4400', portHigh: '4499' }, acts: [edit('Change the ports', [{ key: 'portLow', label: 'From' }, { key: 'portHigh', label: 'To' }], { done: 'Ports saved', check: (v) => { const ok = (x) => /^\d+$/.test(x) && +x >= 1024 && +x <= 65535; return !ok(v.portLow) || !ok(v.portHigh) ? 'A port is a number from 1024 to 65535' : +v.portLow > +v.portHigh ? 'From must not be above To' : ''; } })] },
          { name: 'Editor', say: 'Opens folders with `{editor}` (found on this machine)', vals: { editor: 'code {folder}' }, acts: [{ label: 'Change…', edit: launcher('editor', 'Editor', O(['code {folder}', 'VS Code'], ['cursor {folder}', 'Cursor'], ['zed {folder}', 'Zed'])) }] },
          { name: 'Terminal', say: 'Opens shells with `{terminal}` (found on this machine)', vals: { terminal: 'open -a iTerm {folder}' }, acts: [{ label: 'Change…', edit: launcher('terminal', 'Terminal', O(['open -a iTerm {folder}', 'iTerm'], ['open -a Terminal {folder}', 'Terminal'], ['wezterm start --cwd {folder}', 'WezTerm'])) }] },
        ] },
        { name: 'Network', min: 'advanced', say: (sv) => `${sv.proxy ? `Through ${sv.proxyHost}:${sv.proxyPort}` : 'A direct connection'}; ${sv.netWait ? `a task waits up to **${pickText(WAIT, sv.wait)}** offline` : 'a task fails when offline'}`, more: [
          { name: 'Proxy', say: (sv) => (!sv.proxy ? 'Off: Worca connects directly. Turn it on to use **{proxyHost}:{proxyPort}**' : sv.auth === 'none' ? 'Through **{proxyHost}:{proxyPort}**, {auth}' : 'Through **{proxyHost}:{proxyPort}**, signing in with {auth}'), vals: { proxyHost: 'proxy.corp.example', proxyPort: '8080', proxyLocal: '' },
            picks: { auth: P('auto', O(['auto', 'NTLMv2'], ['basic', 'Basic', 'Sends the password in cleartext; cannot use a saved login'], ['digest', 'Digest', 'Cannot use a saved login'], ['none', 'with no login']), 'How Worca signs in to the proxy') },
            acts: [{ label: 'Change…', edit: (sv) => ({ title: 'Change the proxy', yes: 'Save and test', fields: [{ key: 'proxyHost', label: 'Host' }, { key: 'proxyPort', label: 'Port' }, { key: 'proxyLocal', label: 'Local port', hint: 'Empty: Worca picks one and keeps it', placeholder: 'Automatic' }], check: (v) => (!v.proxyHost.trim() ? 'A proxy needs a host' : !/^\d+$/.test(v.proxyPort) || +v.proxyPort > 65535 ? 'A port is a number up to 65535' : ''), then: (v, s) => { Object.assign(s, v); return `Reached ${v.proxyHost}:${v.proxyPort}: proxy saved${s.proxy ? '' : '; turn it on to use it'}`; } }) }], sw: { key: 'proxy', on: false, why: 'Off: Worca connects directly' } },
          { name: 'Login', when: (sv) => sv.proxy, say: '{loginWords}', vals: { loginWords: (sv) => (sv.proxyLogin ? `Saved for ${sv.proxyUser}: the NT hash, never the password` : 'No saved login'), proxyUser: 'CORP\\emil' },
            acts: [
              { label: 'Log out', when: (sv) => sv.proxyLogin, do: (sv) => { sv.proxyLogin = false; return 'Proxy login removed'; } },
              { label: 'Log in…', when: (sv) => !sv.proxyLogin, off: (sv) => (sv.auth === 'basic' || sv.auth === 'digest' ? 'This login mode needs the password in HTTPS_PROXY; choose NTLMv2 for a saved login' : ''), edit: { title: 'Log in to the proxy', yes: 'Log in', note: 'Worca saves your domain, user name and the NT hash in a file only you can read.', fields: [{ key: 'pxDomain', label: 'Domain', value: 'CORP' }, { key: 'pxUser', label: 'User name', value: 'emil' }, { key: 'pxPass', label: 'Password', type: 'password', value: '' }], then: (v, sv) => { sv.proxyLogin = true; sv.proxyUser = `${v.pxDomain}\\${v.pxUser}`; return 'Logged in to the proxy'; } } },
            ] },
          { name: 'Bypass', when: (sv) => sv.proxy, say: 'These go direct: `{bypass}`', vals: { bypass: 'localhost, *.corp.example' }, acts: [edit('Change the bypass list', [{ key: 'bypass', label: 'Hosts', hint: 'Comma-separated; * matches any part' }], { done: 'Bypass list saved' })] },
          { name: 'Timeouts', when: (sv) => sv.proxy, min: 'expert', say: 'Connect within {ct}, sign in within {lt}, drop idle after {it}', picks: { ct: P('60', O(['30', '30s'], ['60', '60s'], ['120', '120s']), 'Connect timeout'), lt: P('60', O(['30', '30s'], ['60', '60s'], ['120', '120s']), 'Login timeout'), it: P('300', O(['120', '2 minutes'], ['300', '5 minutes'], ['600', '10 minutes']), 'Idle timeout', true) } },
          { name: 'Offline', min: 'advanced', say: (sv) => (sv.netWait ? 'When the network drops, a task waits up to {wait}' : 'When the network drops, a task fails at once'), picks: { wait: P('4h', WAIT, 'How long it waits before it fails') }, sw: { key: 'netWait', on: true } },
        ] },
      ] },
    ] },

    presets: { min: 'advanced', title: 'Presets', meta: 'Saved setups a new run can start from. Save one from a run\'s ⋯.', sections: [
      { title: 'Presets', bare: true, empty: 'No presets yet', list: [
        preset('Bug fix', 'Any project', 'Fix workflow · Claude · updated 3 Oct', '', { task: 'Fix the bug you describe here' }),
        preset('Docs pass', 'Only worca-cc', 'Docs workflow · Claude · updated 28 Sep', '', { task: 'Bring the docs in line with the code' }),
        preset('Billing slice', 'Workspace gone', 'Feature workflow · Claude · updated 12 Sep', 'is-amber', { task: 'Build the next billing slice' }),
      ] },
    ] },

    labels: { flag: 'runLabels', title: 'Labels', meta: 'Free words you put on runs to find them again.', sections: [
      { title: 'Labels', bare: true, meta: 'The most used first.', empty: 'No labels yet', list: [
        { title: 'frontend', meta: 'On 14 runs', menu: ['Rename', 'Remove'] },
        { title: 'needs demo', meta: 'On 6 runs', menu: ['Rename', 'Remove'] },
        { title: 'hotfix', meta: 'On 3 runs', menu: ['Rename', 'Remove'] },
      ] },
    ] },

    automations: { min: 'advanced', flag: 'gitAutomations', title: 'Automations', meta: 'What runs by itself across projects; each project keeps its own rules.', sections: [
      { title: 'Waiting', empty: 'Nothing is waiting', list: [
        { title: 'Issue #1088', meta: 'A fix is proposed · worca-cc', mark: 'is-amber', fig: '2h ago', menu: ['Approve', 'Skip'], quick: ['Approve'],
          on: { Approve: (r, x) => { x.remove(); window.RailWorld?.add({ id: `auto-1088-${Date.now()}`, title: 'Fix Issue #1088', project: 'worca-cc', detail: 'Started by you from Automations' }); x.add({ title: r.title, meta: 'Approved: a task started · worca-cc', fig: 'now', open: (o, y) => y.page('runs', 'Opens Tasks') }, 'automations/Recent'); return 'Issue #1088: a task started, in Tasks'; }, Skip: (r, x) => { x.remove(); x.add({ title: r.title, meta: 'Skipped by you · worca-cc', fig: 'now' }, 'automations/Recent'); return 'Issue #1088: skipped'; } } },
      ] },
      { title: 'Projects', list: [
        { title: 'worca-cc', meta: 'Proposes a fix for new issues and reviews PRs · 3 rules', open: (r, x) => x.page('projects', 'Opens the project worca-cc, where its 3 rules are') },
        { title: 'billing workspace', meta: 'Every member repository · reviews PRs · 1 rule', open: (r, x) => x.page('workspaces', 'Opens the billing workspace, where its rule is') },
      ] },
      { title: 'Recent', list: [
        { title: 'PR #1087', meta: 'Reviewed · worca-cc', fig: '09:12' },
        { title: 'Issue #1085', meta: 'Skipped: no rule matched · worca-cc', fig: 'yesterday' },
      ] },
    ] },

    models: { min: 'expert', title: 'Models', meta: 'The models every project can pick from, and the sign-ins they run through.', sections: [
      { title: 'Defaults', rows: [
        { name: 'Roles', say: (sv) => `On Claude, **${roleName(sv, 'deep')}** plans and reviews, **${roleName(sv, 'every')}** writes the code, **${roleName(sv, 'quick')}** does quick jobs; every engine keeps its own`, help: 'Roles open at Simple through the link from a task or the setup assistant', more: ENGINES.map(roleRow) },
        { name: 'Engine', say: (sv) => { const e = pickText(ENGINES, sv.eng).replace(' (beta)', ''); return sv.eng === 'claude' || sv.eng === 'codex' ? `New tasks use {eng}; each step and helper job uses its ${e} role, unless set below` : `New tasks use {eng}; each step uses its ${e} role, unless set below; helper jobs stay on Claude`; }, picks: { eng: { ...P('claude', ENGINES, 'The engine a new run starts on'), then: (sv) => engineChanged(sv) } } },
      ] },
      { title: 'Jobs', meta: 'A step or a helper job follows its role until you override it.', rows: [
        { name: 'Step models', say: '{stepWords}', vals: { stepWords: (sv) => { const n = jobsSet(STEPS, 'jobStep', sv); return n ? `${n} of ${STEPS.length} have their own model; the rest follow their role` : `All ${STEPS.length} follow their role`; } }, more: jobRows(STEPS, 'jobStep') },
        { name: 'Helper jobs', say: '{helperWords}', vals: { helperWords: (sv) => { const n = jobsSet(HELPERS, 'jobHelp', sv); return n ? `${n} of ${HELPERS.length} have their own model; the rest follow their role` : `All ${HELPERS.length} follow their role`; } }, more: jobRows(HELPERS, 'jobHelp') },
      ] },
      { title: 'Sign-ins', meta: 'Sign-ins and keys for the models Worca runs through its own bridge.', rows: [
        { name: 'Claude sign-in', say: '{claudeWords}', vals: { claudeWords: (sv) => (sv.claudeIn ? 'Signed in to Claude Code; factory defaults show as (default)' : 'Not signed in to Claude Code: Memory defragment and Second-opinion reviewer lose their factory default. A run that needs one is refused, never given another model') },
          chip: (sv) => (sv.claudeIn ? '' : 'Signed out'),
          acts: [{ label: 'Sign out', when: (sv) => sv.claudeIn, do: (sv) => { sv.claudeIn = false; window.RailUI.prefs.setConnected('claude', false); return 'Signed out of Claude Code'; } }, { label: 'Sign in', when: (sv) => !sv.claudeIn, do: (sv) => { sv.claudeIn = true; window.RailUI.prefs.setConnected('claude', true); return 'Signed in to Claude Code'; } }] },
      ], list: [
        { title: 'GitHub Copilot', meta: 'Connected as @emil-angelov', mark: 'is-green', detail: 'Premium requests are read from GitHub, not counted by Worca, and reset on 1 Dec.',
          live: (sv, r) => (r.signedOut ? 'Not signed in' : `${r.account} · ${r.conc} at once · ${r.used} of 1,000 premium requests, from GitHub`), account: 'Business', conc: 4, used: 312,
          menu: (r) => (r.signedOut ? ['Sign in'] : ['Edit', 'Import models', 'Refresh usage', 'Sign out']),
          on: {
            Edit: (r, x) => x.dialog({ title: 'GitHub Copilot', yes: 'Save', fields: [{ key: 'acct', label: 'Account type', value: r.account, options: O('Individual', 'Business', 'Enterprise') }, { key: 'conc', label: 'Requests at once', value: String(r.conc), type: 'number', hint: 'Keep it low: more waits its turn, and it lowers GitHub\'s abuse-detection risk' }], then: (v) => { r.account = v.acct; r.conc = v.conc; return 'GitHub Copilot saved'; } }),
            'Import models': (r, x) => (importable(x.sv).length ? x.dialog(importModels(x.sv)) : 'Nothing new to import: the catalogue has it all'),
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
          mark: '', open: (r, x) => r.on[r.url ? 'Edit' : 'Set up…'](r, x), menu: (r) => (r.url ? (r.preset === 'openrouter' ? ['Edit', 'Refresh usage', 'Remove'] : ['Edit', 'Remove']) : ['Set up…']),
          on: {
            'Set up…': (r, x) => x.dialog(openaiSetup(r)), Edit: (r, x) => x.dialog(openaiSetup(r)),
            'Refresh usage': (r, x) => { x.sv.orLeft = x.sv.orLeft > 100 ? 80 : 820; r.mark = x.sv.orLeft < 100 ? 'is-amber' : 'is-green'; return x.sv.orLeft < 100 ? `Low: ${x.sv.orLeft} free requests left; New run warns below 10%` : `${x.sv.orLeft} free requests left today`; },
            Remove: (r) => { r.url = ''; r.preset = ''; r.mark = ''; return 'OpenAI-compatible removed'; },
          } },
        { title: 'Anthropic-compatible', meta: 'llm.corp.example · key set · 8 requests at once', mark: 'is-green', menu: ['Edit', 'Remove'],
          on: { Edit: (r, x) => x.dialog({ title: 'Anthropic-compatible', yes: 'Save', fields: [{ key: 'url', label: 'Base URL', value: 'https://llm.corp.example' }, { key: 'conc', label: 'Requests at once', value: '8', type: 'number' }], check: (v) => (!isUrl(v.url) ? 'A base URL reads like https://example.com' : /^[1-9]\d*$/.test(v.conc) ? '' : 'Requests at once is a whole number above 0'), then: (v) => { r.meta = `${v.url.replace(/^https?:\/\//, '')} · key set · ${v.conc} requests at once`; return 'Anthropic-compatible saved'; } }) } },
        { title: 'Gemini CLI', meta: 'Your Gemini sign-in; the CLI is the engine', mark: 'is-green',
          detail: 'Google does not report a quota to Worca. Set the number your plan allows and Worca counts requests against it.',
          live: (sv, r) => (r.signedOut ? 'Not signed in' : sv.gemQuota ? `Your Gemini sign-in · ${sv.gemUsed} of ${sv.gemQuota} requests today, counted by Worca against your quota` : 'Your Gemini sign-in · no quota set, so nothing is counted'),
          menu: (r, sv) => (r.signedOut ? ['Sign in'] : sv.gemQuota ? ['Set quota', 'Clear quota', 'Sign out'] : ['Set quota', 'Sign out']),
          on: {
            'Sign out': (r) => { r.signedOut = true; r.mark = ''; window.RailUI.prefs.setConnected('gemini', false); return 'Signed out of Gemini'; },
            'Sign in': (r) => { r.signedOut = false; r.mark = 'is-green'; window.RailUI.prefs.setConnected('gemini', true); return 'Signed in to Gemini'; },
            'Set quota': (r, x) => x.dialog({ title: 'Set the Gemini quota', yes: 'Save', note: 'Google does not report one. Worca counts requests against the number you set here, and Pulse warns near it.', fields: [{ key: 'gemQuota', label: 'Requests a day', type: 'number', placeholder: 'No quota', value: x.sv.gemQuota }], check: (v) => (+v.gemQuota >= 0 ? '' : 'A quota is a number'), then: (v, sv) => { if (v.gemQuota === sv.gemQuota) return ''; sv.gemQuota = v.gemQuota; return v.gemQuota ? `Gemini quota: ${v.gemQuota} requests a day` : 'Gemini quota cleared'; } }),
            'Clear quota': (r, x) => { x.sv.gemQuota = ''; return 'Gemini quota cleared'; },
          } },
      ] },
      { title: 'Catalogue', actions: [{ label: 'Add model', edit: (sv) => ({ title: 'Add a model', yes: 'Add', fields: [{ key: 'id', label: 'Model id', value: '', hint: 'Worca\'s handle for it' }, { key: 'lab', label: 'Label', value: '' }], check: (v) => (v.id.trim() ? '' : 'A model needs an id'), then: (v) => { (sv.__recs['models/Catalogue'] ||= recsSeed('models', 'Catalogue')).unshift({ id: 'n' + Date.now(), title: v.id, meta: v.lab || 'Added by you', menu: ['Edit', 'Remove'] }); return `Model added: ${v.id}`; } }) }], rows: [
        { name: 'Sources', say: 'Built-in models, import from a provider, sharing with the team', more: [
          { name: 'Built-in models', say: 'Show the built-in Anthropic models', sw: { key: 'builtIn', on: true, why: 'Turn off when you don\'t use a first-party Anthropic account' } },
          { name: 'Import', say: 'Bring models in from Copilot or a provider', acts: [{ label: 'Import…', off: (sv) => (importable(sv).length ? '' : 'Nothing new to import: the catalogue has it all'), edit: importModels }] },
          { name: 'Sharing', say: 'Share your models with the team as a plugin', acts: [{ label: 'Share…', edit: (sv) => ({ title: 'Share your models', yes: 'Create plugin', note: `Makes a plugin with your ${plural((sv.__recs['models/Catalogue'] || recsSeed('models', 'Catalogue')).length, 'model')}, with no keys in it.`, done: 'Plugin created: team-models' }) }] },
        ] },
      ], list: [
        { title: 'claude-sonnet-5-5', meta: 'Your Claude login · priced by the CLI', menu: ['Edit', 'Remove'] },
        { title: 'gpt-5', meta: 'Codex · your ChatGPT sign-in', menu: ['Edit', 'Remove'] },
        { title: 'local-llama', meta: 'Through OpenAI-compatible · free', menu: ['Edit', 'Remove'] },
      ], empty: 'No models yet' },
    ] },

    ask: { min: 'advanced', title: 'Chat', meta: 'Worca\'s own assistant: its engine, what it may do and where it may look.', sections: [
      { title: 'Assistant', rows: [
        { name: 'Engine', help: 'Engine for new chats. A chat can move to another engine later, from its model picker', say: 'New chats start on {chatEngine}{chatNote}', vals: { chatNote: (sv) => { const m = sv['chatModel_' + sv.chatEngine]; return m ? ` with ${m}` : sv.chatEngine === 'gemini' || sv.chatEngine === 'qwen' ? '. It needs a model: pick one under Customise' : ''; } },
          picks: { chatEngine: P('claude', [...ENGINES.filter(([id]) => id !== 'cursor'), ['cursor', 'Cursor', 'Unavailable on this Cursor version; new chats start on Claude', true]], 'The engine a new chat starts on') },
          more: ENGINES.filter(([id]) => id !== 'cursor').map(([e, label]) => chatModel(e, label.replace(' (beta)', ''))) },
        { name: 'Abilities', say: (sv) => { const on = [sv.scripts && 'runs scripts', sv.summaries && window.RailUI?.prefs.flag('commandSummaries') && 'sums up commands', sv.nextPrompt && 'suggests a next prompt'].filter(Boolean); return on.length ? `${on[0][0].toUpperCase()}${andList(on).slice(1)}` : 'It only answers: no scripts, no summaries, no suggestions'; }, more: [
          { name: 'Scripts', say: 'Create and run scripts', sw: { key: 'scripts', on: true } },
          { name: 'Summaries', flag: 'commandSummaries', say: 'Show each command as one line saying what it does', sw: { key: 'summaries', on: true, why: 'With Labs › Command summaries on' } },
          { name: 'Suggestions', say: 'Suggest a next prompt after each reply', sw: { key: 'nextPrompt', on: true } },
        ] },
        { name: 'Limits', help: 'On an engine other than Claude the cap is checked when a reply ends', say: 'One message may use **{turns}** turns, and a turn stops at **{capWords}**', vals: { turns: '400', cap: '', capWords: (sv) => (sv.cap ? `$${sv.cap}` : 'no cost cap') },
            acts: [edit('Change the chat limits', [{ key: 'turns', label: 'Turn limit', type: 'number', hint: '1 to 500, per message; empty restores 400', placeholder: '400' }, { key: 'cap', label: 'Per-turn cost cap (USD)', type: 'number', hint: '0.1 to 100; empty means no cap', placeholder: 'No cap' }], {
              check: (v) => { const t = v.turns === '' ? 400 : +v.turns, c = v.cap === '' ? 1 : +v.cap; if (!(t >= 1 && t <= 500)) return 'The turn limit is 1 to 500'; if (!(c >= 0.1 && c <= 100)) return 'The cap is 0.1 to 100'; return ''; },
              then: (v, sv) => { sv.turns = v.turns === '' ? '400' : v.turns; sv.cap = v.cap; return 'Chat limits saved'; } })] },
        { name: 'Web', say: (sv) => (sv.webOn ? 'Reads web pages from {web}' : 'No web access: replies use what Worca already has'), picks: { web: P('allowed', O(['allowed', 'the allowed sites'], ['any', 'any site, without asking'])) }, sw: { key: 'webOn', on: false }, more: [
          { name: 'Allowed sites', when: (sv) => sv.webOn && sv.web === 'allowed', say: '`{webSites}`', vals: { webSites: 'docs.python.org, developer.mozilla.org' }, acts: [edit('Change the allowed sites', [{ key: 'webSites', label: 'Sites', hint: 'Comma-separated' }], { done: 'Allowed sites saved' })] },
          { name: 'Search', when: (sv) => sv.webOn, min: 'expert', say: 'Searches with {searchWords}', vals: { searchWords: (sv) => (sv.searchUrl ? sv.searchUrl : 'the built-in search'), searchUrl: '' }, acts: [edit('Use your own search', [{ key: 'searchUrl', label: 'Endpoint' }, { key: 'searchVar', label: 'Key variable', value: '' }, { key: 'searchHead', label: 'Key header', value: '' }], { done: 'Search saved' })] },
        ] },
        { name: 'Connectors', say: (sv) => `Uses the **General** set: ${setCount(sv, 'General').replace(' · ', ', ')}`, acts: [{ label: 'Open', go: 'connectors' }] },
      ] },
      { title: 'Channels', meta: 'Chat plugins that carry notifications and your replies. What each kind of update sends is in Notifications.', actions: [{ label: 'Add channel', page: 'marketplace', say: 'Opens the Marketplace, the store in the sidebar' }], list: [
        channel('Telegram', 'chTelegram', { on: true, meta: 'Personal bot · last message 2h ago' }),
        channel('Discord', 'chDiscord', { on: true, chatId: '99812', meta: 'Team server · replies count from allowed chats', warn: 'Commands are off: no chat is in Allowed chat IDs, so replies like /approve are ignored' }),
        channel('Slack', 'chSlack', { on: false, meta: 'Workspace bot' }),
        channel('Teams', 'chTeams', { on: false, meta: 'Team bot' }),
      ], empty: 'No chat channels installed' },
      { title: 'Speech', min: 'expert', meta: 'Used by Chat\'s voice. The built-in engines run in your browser; audio never leaves this computer.', rows: [
        { name: 'Listening', say: 'Chat listens with {stt}', picks: { stt: P('whisper', O(['whisper', 'Whisper, in the browser'], ['server', 'your speech server']), 'The speech-to-text engine') }, more: [
          { name: 'Listening URL', when: (sv) => sv.stt === 'server', say: '`{sttUrl}`', vals: { sttUrl: 'https://speech.corp.example/v1/audio/transcriptions' }, acts: [edit('Change the listening URL', [{ key: 'sttUrl', label: 'URL', type: 'url' }], { done: 'Listening URL saved', check: (v) => (isUrl(v.sttUrl) ? '' : 'A URL reads like https://example.com') })] },
        ] },
        { name: 'Speaking', say: 'Replies {tts}', picks: { tts: P('kokoro', O(['kokoro', 'are read aloud with Kokoro, in the browser'], ['server', 'are read aloud with your speech server'], ['off', 'stay text']), 'The text-to-speech engine') }, more: [
          { name: 'Speaking URL', when: (sv) => sv.tts === 'server', say: '`{ttsUrl}`', vals: { ttsUrl: 'https://speech.corp.example/v1/audio/speech' }, acts: [edit('Change the speaking URL', [{ key: 'ttsUrl', label: 'URL', type: 'url' }], { done: 'Speaking URL saved', check: (v) => (isUrl(v.ttsUrl) ? '' : 'A URL reads like https://example.com') })] },
        ] },
        { name: 'Speech models', say: '{speechWords}', vals: { speechWords: (sv) =>  (sv.speechModels ? 'Downloaded: 480 MB; the next mic use fetches them again' : 'Not downloaded; the first mic use fetches them, up to 500 MB') }, acts: [{ label: 'Remove', off: (sv) => (sv.speechModels ? '' : 'Nothing is downloaded'), do: (sv) => { sv.speechModels = false; return 'Speech models removed'; } }] },
      ] },
      { title: 'History', meta: 'Delete removes transcripts, attachments and the worktrees checked out for them. Runs started from a chat stay.', actions: [
        { label: 'Delete all chats', help: 'Asks first', off: (sv) => (sv.chats ? '' : 'No chats to delete'), confirm: (sv) => ({ text: `Delete all ${sv.chats} chats, with ${sv.worktrees} worktrees and ${sv.attach} of attachments? They cannot be brought back.`, yes: 'Delete all', danger: true, then: (s) => { s.chats = 0; s.worktrees = 0; s.attach = '0 MB'; return 'All chats deleted'; } }) },
      ], rows: [
        { name: 'Chat history', say: '**{chatsNow}** chats, **{treesNow}** worktrees and **{attachNow}** of attachments on this machine', vals: { chatsNow: (sv) => sv.chats, treesNow: (sv) => sv.worktrees, attachNow: (sv) => sv.attach } },
      ] },
    ] },

    guardrails: { min: 'advanced', title: 'Guardrails', meta: 'What agents may not touch, as sets a project follows.', sections: [
      { title: 'Sets', actions: [{ label: 'New set', min: 'expert', edit: (sv) => ({ title: 'New guardrail set', yes: 'Create set', fields: [{ key: 'name', label: 'Name', value: '' }], check: (v) => (v.name.trim() ? '' : 'A set needs a name'), then: (v) => { (sv.__recs['guardrails/Sets'] ||= recsSeed('guardrails', 'Sets')).unshift(editable(v.name, 'no project', { deny: [], paths: [] })); return `Set created: ${v.name}`; } }) }], list: [
        readOnlySet('Default', 'Built in', '5 projects'),
        editable('Strict', '1 project'),
        readOnlySet('Team policy', 'From the team policy', 'read-only', 'Ships with acme/worca-policy; a change is published there, from Team policy.'),
      ] },
    ] },

    memory: { min: 'advanced', title: 'Memory', meta: 'What agents remember between runs, as notes Worca keeps in order.', sections: [
      { title: 'Notes', meta: (sv) => `Healthy · ${plural((sv.__recs['memory/Notes'] || NOTES).length, 'note')} · defragmented ${sv.defragged}`, actions: [{ label: 'New note', edit: (sv) => ({ title: 'New note', yes: 'Create', fields: [{ key: 'name', label: 'Name', value: '', hint: 'A file name, such as testing.md' }, { key: 'body', label: 'Note', value: '', multiline: true }], check: (v) => (!v.name.trim() ? 'A note needs a name' : /^[\w.-]+\.\w+$/.test(v.name.trim()) ? '' : 'A note is a file name, such as testing.md'), then: (v) => { (sv.__recs['memory/Notes'] ||= recsSeed('memory', 'Notes')).unshift({ ...note(v.name, 'Today · from you'), id: 'n' + Date.now() }); (sv.__recs['memory/Team memory'] ||= recsSeed('memory', 'Team memory')).unshift({ ...teamNote(v.name, sv.seeded ? 'Shared' : 'Local only', 'Yours', true), id: 'n' + Date.now() }); return `Note created: ${v.name}`; } }) },
        { label: 'Defragment now', min: 'expert', help: 'Merges duplicates and drops what is stale; what the notes were stays as a restore point', do: (sv) => { const notes = sv.__recs['memory/Notes'] || recsSeed('memory', 'Notes'); (sv.__recs['memory/Restore points'] ||= recsSeed('memory', 'Restore points')).unshift({ ...restorePoint('just now', notes.map((n) => [n.title, n.meta])), id: 'p' + Date.now() }); sv.defragged = 'just now'; return 'Notes defragmented; a restore point is kept'; } }],
        empty: 'No notes yet', list: NOTES },
      { title: 'Restore points', meta: 'What the notes were before each defragment.', empty: 'Nothing to restore', list: [
        restorePoint('3 days ago', [['architecture.md', 'How the server and the UI are split · 1 Oct · from Chat'], ['conventions.md', 'Naming, commits and tests · 2 Oct · from run #398'], ['old-deploy.md', 'The old deploy steps · 12 Aug · from Chat']]),
      ] },
      { title: 'Proposals', meta: 'Changes runs suggest; nothing changes until you approve.', empty: 'Nothing to approve', list: [
        { title: 'testing.md', meta: 'New note · from run #412 · 2h ago', mark: 'is-amber', menu: ['Approve', 'Reject'], quick: ['Approve'], open: (r, x) => x.dialog({ title: 'testing.md: the change', view: true, yes: 'Close', note: 'A new note, from run #412: `+ # How we test` · `+ Run the page\'s sweep before the full suite.` · `+ A new case must pass its sweep.`' }), on: { Approve: (r, x) => { x.remove(); x.add({ ...note('testing.md', 'How we test · today · from run #412') }, 'memory/Notes'); x.add({ ...teamNote('testing.md', x.sv.seeded ? 'Shared' : 'Local only', 'Yours', true) }, 'memory/Team memory'); return 'testing.md approved'; } } },
      ] },
      { title: 'Team memory', listWhen: (sv) => sv.teamLoad !== 'local', rows: [
        { name: 'Load', help: 'Local is team memory off', say: 'Runs and chats load {teamLoad}', picks: { teamLoad: P('local', O(['local', 'this machine\'s notes'], ['team', 'the team\'s notes only'], ['both', 'yours and the team\'s']), 'Team and Both share this project\'s notes on the worca-memory branch') } },
        { name: 'Sync', when: (sv) => sv.teamLoad !== 'local', say: 'Branch `worca-memory` on origin · fetched {teamSync}', vals: { teamSync: '5 minutes ago' }, acts: [{ label: 'Sync now', do: (sv) => { sv.teamSync = 'just now'; return 'Team memory synced'; } }] },
        { name: 'Share notes', when: (sv) => sv.teamLoad !== 'local', say: '{shareWords}', vals: { shareWords: (sv) => { const n = (sv.__recs['memory/Notes'] || NOTES).length; return sv.seeded ? `Your ${plural(n, 'local note')} ${n === 1 ? 'is' : 'are'} shared` : `${plural(n, 'local note')} ${n === 1 ? 'is' : 'are'} not shared yet`; } },
          acts: [
            { label: 'Share…', when: (sv) => !sv.seeded, edit: { title: 'Share existing notes', yes: 'Share them', note: 'Pushes your notes to the `worca-memory` branch, where teammates load them. You can undo the last sharing.', then: (v, sv) => { sv.seeded = true; let n = 0; for (const r of sv.__recs['memory/Team memory'] || []) if (r.tstate === 'Local only') { r.tstate = 'Shared'; n += 1; } return `${plural(n, 'note')} shared`; } } },
            { label: 'Undo', when: (sv) => sv.seeded, do: (sv) => { sv.seeded = false; for (const r of sv.__recs['memory/Team memory'] || []) if (r.tstate === 'Shared' && r.mine) r.tstate = 'Local only'; return 'Sharing undone'; } },
          ] },
      ], list: [
        teamNote('architecture.md', 'Local only', 'Yours', true),
        teamNote('conventions.md', 'Local only', 'Yours', true),
        teamNote('release.md', 'Team only', 'From @dana · 2 Oct'),
        teamNote('secrets-howto.md', 'Held', 'Held back: it looks like it holds a secret'),
      ] },
    ] },

    plugins: { min: 'advanced', title: 'Plugins', meta: 'What you installed from the Marketplace, and where Worca looks for more.', sections: [
      { title: 'Installed', actions: [{ label: 'Sources', help: 'Where Worca looks for plugins', list: SOURCES, edit: sourcesDialog }], rows: [
        { name: 'Marketplace', say: 'More plugins are in the store', acts: [{ label: 'Open', id: 'store', page: 'marketplace', say: 'Opens the Marketplace, the store in the sidebar' }] },
      ], empty: 'Nothing installed', groups: [
        { title: 'Trackers', list: [
          tracker('Jira', 'jira', 'A task source · worca-official · 1 update', 'pJira', true, { mark: 'is-amber', menu: ['Update', 'Settings', 'Uninstall'], url: 'https://acme.atlassian.net' }, [rule('WEB', MOVES.jira[0]), rule('INFRA', 'none', 'Resolved')]),
          tracker('Azure Boards', 'azure', 'A task source · worca-official', 'pAzure', true, { url: 'https://dev.azure.com/acme' }, [rule('Billing', 'Closed')]),
          tracker('GitHub Issues', 'github', 'A task source · worca-official', 'pIssues', false, { url: 'https://github.com/acme' }, [rule('acme/worca', 'closed')]),
        ] },
        { title: 'Chat channels', list: [
          channelPlugin('Telegram', 'chTelegram'),
          channelPlugin('Discord', 'chDiscord'),
          channelPlugin('Slack', 'chSlack'),
          channelPlugin('Teams', 'chTeams'),
        ] },
        { title: 'Others', list: [
          plugin('Notion', 'An MCP server · worca-official', 'pNotion', true, { url: 'https://mcp.notion.com' }),
          plugin('Sentry', 'An MCP server · worca-official', 'pSentry', true, { url: 'https://mcp.sentry.dev' }),
          plugin('Cloudflare', '2 MCP servers · worca-official', 'pCloudflare', true, { url: 'https://mcp.cloudflare.com' }),
          plugin('Review pack', '2 agents · worca-official', 'pReviewPack', true, { nothing: true }),
          plugin('Promo video', 'A workflow and 3 agents · worca-official', 'pPromoVideo', true, { nothing: true }),
        ] },
      ] },
    ] },

    connectors: { min: 'advanced', title: 'Connectors', meta: 'MCP servers and skills, grouped in sets that projects follow.', sections: [
      { title: 'Servers', actions: [{ label: 'Add server', edit: addTo('connectors/Servers', 'Add a server', 'Name', 'stdio · in no set', ['Edit', 'Remove']) }], empty: 'No servers', list: [
        { title: 'github', meta: 'stdio · in 2 sets', live: liveSets('servers', 'github', 'stdio'), menu: ['Edit', 'Remove'] },
        { title: 'postgres', meta: 'stdio · needs a secret in Frontend', live: (sv, r) => { if (r.meta !== 'stdio · needs a secret in Frontend') return r.meta; const f = frontendSet(sv); return f ? `stdio · needs a secret in ${f.title}` : `stdio · ${inSets(sv, 'servers', 'postgres')}`; }, mark: 'is-amber', menu: ['Edit', 'Remove'] },
      ] },
      { title: 'Sets', actions: [{ label: 'New set', edit: addTo('connectors/Sets', 'New set', 'Name', '0 servers · 0 skills · no project', ['Rename', 'Duplicate', 'Delete']) }], list: [
        { title: 'General', members: 'General', meta: 'Built in', live: (sv) => `Built in · ${setCount(sv, 'General')} · Chat and ${frontendSet(sv) ? 5 : 7} projects`, menu: ['Duplicate'], copy: { menu: ['Rename', 'Duplicate', 'Delete'], follows: 'No project uses it.', live: (sv) => `${setCount(sv, 'General')} · no project` } },
        { title: 'Frontend', members: 'Frontend', projects: 2, meta: 'A set', live: (sv) => `${setCount(sv, 'Frontend')} · 2 projects`, menu: ['Rename', 'Duplicate', 'Delete'], follows: 'Its 2 projects go back to General.', copy: { projects: 0, follows: 'No project uses it.', live: (sv) => `${setCount(sv, 'Frontend')} · no project` } },
      ] },
      { title: 'Skills', actions: [{ label: 'Import skill', edit: addTo('connectors/Skills', 'Import a skill', 'Skill', 'From your Claude Code skills · in no set', ['Edit', 'Remove']) }], empty: 'No skills', list: [
        { title: 'pdf-tools', meta: 'From your Claude Code skills · in 2 sets', live: liveSets('skills', 'pdf-tools', 'From your Claude Code skills'), menu: ['Edit', 'Remove'] },
      ] },
    ] },
  };

  // Function declarations, so the table above reads top down.
  function costTag(title, vals, required) {
    return { title, vals, required, meta: `${vals || 'Any value'} · ${required ? 'required' : 'optional'}`, live: (sv, r) => `${r.vals || 'Any value'} · ${r.required ? 'required' : 'optional'}`, menu: ['Edit', 'Remove'],
      on: { Edit: (r, x) => x.dialog({ title: `Edit ${r.title}`, yes: 'Save', fields: costTagFields(r.title, r.vals, r.required), check: (v) => (v.name.trim() ? '' : 'A tag needs a name'), then: (v) => { r.title = v.name.trim(); r.vals = v.vals; r.required = !!v.req; return `${r.title} saved`; } }) } };
  }
  function costTagFields(name, vals, req) {
    return [{ key: 'name', label: 'Name', value: name }, { key: 'vals', label: 'Values', value: vals, hint: 'Comma-separated; empty lets any value in' }, { key: 'req', check: true, label: 'A run needs this tag', value: req }];
  }
  function launcher(key, name, apps) {
    return (sv) => ({ title: `Change the ${name.toLowerCase()}`, yes: 'Save', fields: [
      { key: 'app', label: 'Pick an app', value: apps.some((a) => a[0] === sv[key]) ? sv[key] : '', options: apps, then: (v) => { v[key] = v.app; } },
      { key, label: 'Command', hint: '{folder} marks where the checkout goes; without it, the folder is added at the end' },
      { key: 'try', button: 'Try', hint: 'Opens the folder with this command', do: (v) => `Ran ${v[key]}` },
    ], check: (v) => (v[key].trim() ? '' : 'It needs a command'), then: (v, s) => { s[key] = v[key]; return `${name} saved`; } });
  }
  function preset(title, scope, tail, mark, start) {
    return { title, scope, tail, mark, start, meta: `${scope} · ${tail}`, menu: (r) => [r.mark ? { text: 'Use', off: true, help: 'Its workspace is gone: change its scope first' } : 'Use', 'Rename', 'Duplicate', 'Edit scope', 'Delete'], live: (sv, r) => `${r.scope} · ${r.tail}`,
      on: {
        Use: (r, x) => { x.sv.__preset = { title: r.title, ...r.start }; x.click(['[data-newrun]']); return `New run starts from ${r.title}`; },
        'Edit scope': (r, x) => x.dialog({ title: `Scope of ${r.title}`, yes: 'Save', fields: [{ key: 'scope', label: 'Offered on', value: r.scope, options: O('Any project', 'Only worca-cc', 'Only billing workspace') }], then: (v) => { r.scope = v.scope; r.mark = ''; return `${r.title}: ${v.scope}`; } }),
      } };
  }
  // A chat engine's model: one sentence with its picker; the default is the picker's first choice.
  function chatModel(e, title) {
    const key = 'chatModel_' + e, needs = e === 'gemini' || e === 'qwen';
    return { name: title, say: (sv) => (sv[key] || !needs ? `Chats on ${title} use {${key}}` : `Chats on ${title} {${key}}`),
      picks: { [key]: P(e === 'claude' ? 'Sonnet 5.5' : '', [['', needs ? 'need a model' : 'Worca\'s default'], ...ENGINE_MODELS[e][0].map(([, t]) => [t, t])], `The model a chat on ${title} starts on`) },
      acts: [{ label: 'Test', help: 'Sends one tiny prompt to this model', when: (sv) => !!sv[key], do: (sv) => `Would send ${sv[key]} one tiny prompt` }] };
  }
  function importable(sv) {
    const have = (sv.__recs['models/Catalogue'] || recsSeed('models', 'Catalogue')).map((r) => r.title);
    return [['sonnet-5-copilot', 'Sonnet 5 (Copilot)', true], ['gemini-pro', 'Gemini Pro (hosted API, GEMINI_API_KEY)', false]].filter(([id]) => !have.includes(id));
  }
  function importModels(sv) {
    const offer = importable(sv), where = 'models/Catalogue';
    return { title: 'Import models', yes: 'Import', note: 'What your providers offer that the catalogue does not have yet.', fields: offer.map(([id, label, on]) => ({ key: 'imp_' + id, check: true, label, value: on })),
      then: (v) => {
        const l = (sv.__recs[where] ||= recsSeed('models', 'Catalogue')), names = offer.map(([id]) => id).filter((id) => v['imp_' + id]);
        names.forEach((n, i) => l.unshift({ id: 'i' + Date.now() + i, title: n, meta: 'Imported just now', menu: ['Edit', 'Remove'] }));
        return names.length ? `Imported ${plural(names.length, 'model')}` : 'Nothing picked';
      } };
  }
  function openaiSetup(r) {
    return { title: 'OpenAI-compatible', yes: 'Save', fields: [
      { key: 'preset', label: 'Preset', value: r.preset || 'none', options: O(['none', 'None: your own endpoint'], ['openrouter', 'OpenRouter']), then: (v) => { if (v.preset === 'openrouter') { v.url = OPENROUTER.base; v.key = OPENROUTER.key; } } },
      { key: 'url', label: 'Base URL', value: r.url || '', type: 'url' }, { key: 'key', label: 'Key', value: r.url ? '${OPENAI_KEY}' : '', hint: 'A stored key is never replaced by a preset' },
    ], check: (v) => (isUrl(v.url) ? '' : 'A base URL reads like https://example.com'), then: (v, sv) => { r.url = v.url; r.preset = v.preset; r.mark = 'is-green'; sv.orLeft = sv.orLeft ?? 820; return v.preset === 'openrouter' ? 'OpenRouter set up' : 'OpenAI-compatible saved'; } };
  }
  function readOnlySet(title, from, tail, about) {
    const r0 = { ...GUARD_SETS[title], about };
    return { ...r0, title, meta: `${from} · ${guardCounts(r0)} · ${tail}`, menu: () => (atLevel('expert') ? ['Save as new set'] : []),
      open: (r, x) => x.dialog({ title: r.title, view: true, yes: 'Close', note: guardNote(r) }),
      on: { 'Save as new set': (r, x) => { x.add(editable(`${r.title} copy`, 'no project', r), 'guardrails/Sets'); return `Saved as ${r.title} copy`; } } };
  }
  function editable(title, tail, lists) {
    const set = lists || GUARD_SETS[title];
    return { id: 'n' + title, title, tail, deny: [...set.deny], paths: [...set.paths], meta: `${guardCounts(set)} · ${tail}`, live: (sv, r) => `${guardCounts(r)} · ${r.tail}`, menu: () => (atLevel('expert') ? ['Edit', 'Duplicate', 'Delete'] : ['Edit', 'Delete']), open: (r, x) => SHARED_EDIT(r, x), on: { Edit: (r, x) => SHARED_EDIT(r, x) }, copy: { tail: 'no project' }, follows: (r) => (r.tail === 'no project' ? 'No project uses it.' : `Its ${r.tail} ${/^1 /.test(r.tail) ? 'goes' : 'go'} back to Default.`) };
  }
  function SHARED_EDIT(r, x) {
    const lines = (s) => s.split('\n').map((t) => t.trim()).filter(Boolean);
    return x.dialog({ title: `Edit ${r.title}`, yes: 'Save', fields: [{ key: 'name', label: 'Name', value: r.title }, { key: 'deny', label: 'Deny rules', value: r.deny.join('\n'), multiline: true, hint: 'One per line' }, { key: 'paths', label: 'Protected paths', value: r.paths.join('\n'), multiline: true, hint: 'One per line' }], then: (v) => { r.title = v.name.trim() || r.title; r.deny = lines(v.deny); r.paths = lines(v.paths); return `${r.title} saved`; } });
  }
  function note(title, meta) { return { title, meta, menu: ['Rename', 'Delete'], open: (r, x) => x.dialog({ title: r.title, yes: 'Save', fields: [{ key: 'body', label: 'Note', value: `# ${r.title}\n\nWhat the agents should remember.`, multiline: true }], then: () => `${r.title} saved` }) }; }
  function restorePoint(when, notes) {
    return { title: 'Before defragmenting', notes, meta: `${when} · ${plural(notes.length, 'note')}`, menu: ['Restore'],
      on: { Restore: (r, x) => x.confirm({ text: `Put back the ${plural(r.notes.length, 'note')} from before this defragment? Notes added since go.`, yes: 'Restore', then: (s) => { s.__recs['memory/Notes'] = r.notes.map(([t, m], i) => ({ ...note(t, m), id: 'rp' + Date.now() + i })); x.remove(); return `Restored ${plural(r.notes.length, 'note')}`; } }) } };
  }
  function teamNote(title, tstate, meta, mine) {
    return { title, tstate, mine, meta, when: (sv, r) => sv.teamLoad !== 'local' && (!r?.mine || (sv.__recs['memory/Notes'] || NOTES).some((n) => n.title === r.title)), chip: undefined, live: (sv, r) => `${r.tstate} · ${r.meta}`, mark: tstate === 'Held' ? 'is-amber' : '',
      menu: (r) => (r.tstate === 'Team only' ? ['Compare'] : r.tstate === 'Held' ? ['Compare', 'Share anyway'] : ['Compare', 'Remove from team']),
      on: {
        Compare: (r, x) => x.dialog({ title: `Compare ${r.title}`, view: true, yes: 'Close', note: r.tstate === 'Team only' ? 'The team has this note; this machine does not.' : 'Yours and the team\'s are the same, but for one line.' }),
        'Share anyway': (r, x) => x.confirm({ text: `Share ${r.title} with your team? It looks like it holds a secret, and every teammate will load it.`, yes: 'Share anyway', danger: true, then: () => { r.tstate = 'Shared'; r.mark = ''; r.meta = 'Yours'; return `${r.title} shared`; } }),
        'Remove from team': (r) => { r.tstate = 'Local only'; return `${r.title}: removed from the team, kept here`; },
      } };
  }
  function addTo(where, title, label, meta, menu) {
    return (sv) => ({ title, yes: 'Add', fields: [{ key: 'name', label, value: '' }], check: (v) => (v.name.trim() ? '' : `It needs a ${label.toLowerCase()}`), then: (v) => { (sv.__recs[where] ||= recsSeed(...where.split('/'))).unshift({ id: 'n' + Date.now(), title: v.name, meta, menu }); return `Added: ${v.name}`; } });
  }
  function recsSeed(id, title) { return SECTIONS[id].sections.find((s) => s.title === title).list.map((it, i) => ({ ...it, id: 'r' + i })); }

  const GROUPS = [
    { title: 'Work', items: ['runs', 'presets', 'labels', 'automations'] },
    { title: 'AI', items: ['models', 'ask', 'memory'] },
    { title: 'Access', items: ['team', 'guardrails'] },
    { title: 'Add-ons', items: ['plugins', 'connectors'] },
    { title: 'Worca', items: ['general', 'notifications', 'experimental'] },
  ];
  const NOTIFICATIONS = { title: 'Notifications', meta: 'Pulse keeps everything; these choices say what else reaches you.' };
  // What the Changed dot's tooltip calls a value in a row with several, and the words of a default that is not an option's.
  const VALUE_NAMES = { prOpen: 'Create a PR', prSlices: 'A feature\'s PRs', what: 'Suggests', when: 'When', remote: 'Remote', div: 'If diverged', late: 'Missed starts', lateMax: 'How late', fails: 'Failures',
    which: 'Tasks answered', byDay: 'By day', method: 'How it picks', sure: 'Sure at', lead: 'Lead', dmodel: 'Model', deffort: 'Effort', answers: 'Answers', spent: 'While away', extra: 'Fix rounds', exceed: 'At the team\'s cap',
    keep: 'Checkout', coMax: 'Most kept', ct: 'Connect', lt: 'Sign in', it: 'Idle', auth: 'Signing in', wait: 'Wait', netWait: 'Wait for the network', web: 'Sites', webOn: 'Web access', proxy: 'Proxy', proxyHost: 'Host', proxyPort: 'Port', proxyLocal: 'Local proxy', period: 'Total starts again' };
  const VALUE_WORDS = { perRun: usd, total: (v, d) => `${usd(v)} a ${d.period}`, period: (v) => ({ day: 'each day', week: 'each week', month: 'each month' })[v] || v, rate: (v) => `${usd(v)} an hour`, capRun: usd, capAll: (v) => `${usd(v)} a month`, wsCap: usd };
  window.SettingsModel = { ICONS: { runs: 'nav-runs', presets: 'set-presets', labels: 'set-labels', automations: 'set-automations', models: 'set-models', ask: 'nav-chat', memory: 'set-memory', team: 'set-policy', guardrails: 'set-guardrails', plugins: 'set-plugins', connectors: 'set-connectors', general: 'set-general', notifications: 'set-notifications', experimental: 'set-labs' }, SECTION_ICONS: { Spending: 'set-spending', Starting: 'nav-runs', Limits: 'set-limits', 'Away mode': 'set-away', Machine: 'set-machine' },
    GROUPS, SECTIONS, FLAGS, STATE, FIRST: 'runs', workingChannels, VALUE_NAMES, VALUE_WORDS,
    title: (id) => (id === 'notifications' ? NOTIFICATIONS : SECTIONS[id] || { title: id }).title,
    meta: (id) => (id === 'notifications' ? NOTIFICATIONS : SECTIONS[id] || { meta: '' }).meta,
    min: (id) => (SECTIONS[id] || {}).min || '',
    flag: (id) => (SECTIONS[id] || {}).flag || '',
    shows: (min, level) => window.RailUI.shows(min, level),   // the one rule is the library's
    // Whether a section is in the menu: its level and its Labs flag.
    visible: (id, level) => { const x = SECTIONS[id] || {}; return window.RailUI.shows(x.min, level) && (!x.flag || window.RailUI.prefs.flag(x.flag)); },
  };
})();
