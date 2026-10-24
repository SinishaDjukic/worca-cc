// src/shared/engine-switch.mjs
// The engine catalog (every engine's facts, plans/core-protection-layer-design.md §4.4) and continuing a paused run on
// another engine: which engines there are, what they are called, which ones a pause offers, and which report a cost.
// ONE source for the harness, the CLI, the chat notifier, the scheduler feed and the browser.
// Import-free: served to the browser as-is under /src/shared.

/**
 * Every run engine and what the rest of worca needs to know about it, in list order. The one place an engine's facts
 * live (plans/core-protection-layer-design.md §4.4): the lists below, src/shared/exec-env.mjs REMOTE_ENGINES,
 * exec-env/policy.mjs ENGINE_SANDBOX, the child env (src/core/spawn.mjs childEnv), the engine gate
 * (engines/index.mjs ruleSupport) and the UI's engine pickers derive from it, and a test keeps it equal to the adapter
 * registry (src/core/engines/index.mjs, which adds the mock). Data only, no secrets.
 *   label     its display name
 *   models    it owns catalog models (step, helper and Ask slots; a switch falls back to its catalog default)
 *   cost      its runs report a cost (adapter capability `cost`); where not, a cost shows as unknown, never $0.00
 *   helpers   it runs a run's helper jobs itself (title, overview, PR description, Auto classifier, night decider);
 *             else they run on Claude
 *   beta      still in beta: every engine picker marks it (taking it out of beta is this one flag)
 *   signin    its models connect through its own sign-in (its CLI's login or its own providers): a model takes no env
 *             and no endpoint, and worca ships none of its models (efforts: src/core/model-env.mjs effortsForEngine)
 *   chat      Chat (Ask) on it: {images, pdfs, verified}; false = the adapter has no chat descriptor. Every engine but
 *             Claude runs a chat locked down, and its adapter exports the chat descriptor that does it. `verified: false`
 *             = the descriptor is wired but worca has no verified lockdown yet (its lockdown is null), so Chat stays off
 *             there. src/core/engines/chat.mjs refuses to load when this and the descriptors disagree. Kept here, not in
 *             the adapters, because the browser and src/core/model-env.mjs read it and neither may import an adapter.
 *   remote    a remote sandbox (E2B) runs it; where not, it runs locally only for now and a remote run on it is refused
 *             at run start (src/shared/exec-env.mjs REMOTE_ENGINES)
 * What the UI shows for it (the engine pickers, effort lists, sign-in text and helper notes read these, never a copy;
 * so do the CLI's --engine help and the chat's tools and rules):
 *   harness   its CLI's name where a sentence names the harness ('Claude Code'; the label stays short: 'Claude')
 *   efforts   the effort levels it takes, in its order ([]: it has no effort flag)
 *   signInLabel  its own sign-in, as a model picker's connection group names it ('ChatGPT sign-in')
 *   signInHint   how its own sign-in is set up, as the model editor says it (null: the editor names every harness)
 *   helpersNote  what the Engines tab says in place of helper-job rows, or null
 *   helperSlots  its helper jobs have model slots of their own (models.<engine>.utility.*); never read from the note
 *   modelConnection  how its catalog models connect when that is fixed, as the chat's model card says it
 *             ("cursor-agent's own sign-in"), or null: each entry's env or upstream decides
 *   modelRule  how the chat's add_model writes one of its catalog models when they connect one fixed way ("a cursor
 *             model takes no env, no upstream and no efforts (cursor-agent's own sign-in)"), or null
 *   modelIdHint  how the model editor says one of its model ids is written, when it has a shape of its own, or null
 *   signInTitle  the model editor's title for its own sign-in, or null ('<label> default')
 *   env       the exact variable names its child gets (never a prefix family): `names` its own non-secret config,
 *             `relayOwned` the ones that say where its model calls go and how they are signed (the model relay owns
 *             them in a sandbox), `hostOnly` the ones naming a path on this machine (a sandbox sets its own), `home` its
 *             dir in a sandbox HOME ({env, dir}) or null
 *   signIn    its sign-in modes: `id`, `kind` ('own' its own login, 'key' an API key or token, 'oauth' a subscription
 *             token), the exact `env` names the mode needs, the sign-in `files` it keeps, the broker slot that can
 *             hold its credential (`slotLabel`: how the Statistics view names a slot that is this engine's own), and `requires`: config names that must be set too for the mode to apply. Modes are
 *             listed in the order its CLI prefers them (the route resolver picks the first one whose credential is set
 *             and whose `requires` names are set too), its own login last. A mode's credential is its one secret-named
 *             name (`*_TOKEN`, `*_KEY`, `*_SECRET`); its other names are config.
 *   relay     how the model relay carries its calls ({protocol, upstream, modelCheck, auxModels, needsModel}), or null.
 *             `needsModel`: its CLI has no model of its own once pointed at a relay or broker slot (a step with none is
 *             refused)
 *   provider  who serves its model calls when no relay says so ('google'), or null; a sign-in mode's own `provider`
 *             wins (the run's and each step's `provider` column)
 *   shell     it runs an unrestricted shell, so its path rules bind its own tools only (decision 10)
 *   rules     per permission-rule kind (Read, Grep, Glob, Edit, Write, Bash, WebFetch, WebSearch, mcp): 'held' (a
 *             translation fixture AND a recorded denial under test/fixtures/engine-rules/<engine>/), 'partial',
 *             'unverified' or 'unenforced'. A kind not listed is unenforced; the gate refuses every kind but 'held'
 *             without --allow-unguarded-engine (decision 9)
 *   subagents its sub-agent tool (null: none) and `extraTools`, the tools that reach a sub-agent another way, whether
 *             its sub-agents inherit its rules ('yes' only with `proof`, a recorded denial from inside a sub-agent under
 *             test/fixtures/engine-rules/), else the core denies them all
 *   requiresExplicitModel  a step with no model is refused at start
 *   sessions  where it keeps run sessions ('managed-home', 'user-store' or 'none'); archiving a run removes them
 *   defaultModel  the model it runs when a step names none, or null (its CLI's own default)
 *   loadsClaudeMcp  it loads the MCP servers Claude Code loads on its own (user scope, approved .mcp.json), so a run
 *             misses none of them
 */
const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return Object.freeze(o); };
// Claude Code's own non-secret knobs (the CLI's documented env), exact names. Cloud-provider credentials (AWS_*,
// GOOGLE_APPLICATION_CREDENTIALS, AZURE_*) are not here: a Bedrock/Vertex/Foundry deployment allowlists them per project.
const CLAUDE_NAMES = [
  'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_BETAS', 'ANTHROPIC_VERTEX_PROJECT_ID', 'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL', 'CLOUD_ML_REGION',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH', 'CLAUDE_CODE_SKIP_FOUNDRY_AUTH', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE', 'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  'CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL', 'CLAUDE_CODE_MAX_RETRIES', 'CLAUDE_CODE_SHELL', 'CLAUDE_CODE_SHELL_PREFIX',
  'CLAUDE_CODE_TMPDIR', 'CLAUDE_CODE_GIT_BASH_PATH', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY', 'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
  'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS', 'CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY', 'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY', 'CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
  'DISABLE_TELEMETRY', 'DISABLE_AUTOUPDATER', 'DISABLE_ERROR_REPORTING', 'DISABLE_BUG_COMMAND', 'DISABLE_COST_WARNINGS',
  'DISABLE_NON_ESSENTIAL_MODEL_CALLS', 'DISABLE_PROMPT_CACHING', 'DISABLE_INTERLEAVED_THINKING',
  'MCP_TIMEOUT', 'MCP_TOOL_TIMEOUT', 'MAX_MCP_OUTPUT_TOKENS', 'MAX_THINKING_TOKENS', 'API_TIMEOUT_MS', 'API_FORCE_IDLE_TIMEOUT',
  'CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS', 'CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS', 'CLAUDE_STREAM_IDLE_TIMEOUT_MS',
  'BASH_DEFAULT_TIMEOUT_MS', 'BASH_MAX_TIMEOUT_MS', 'BASH_MAX_OUTPUT_LENGTH', 'ENABLE_TOOL_SEARCH', 'USE_BUILTIN_RIPGREP',
];
export const ENGINES = deepFreeze({
  claude: {
    label: 'Claude', models: true, cost: true, helpers: true, beta: false, signin: false, remote: true,
    harness: 'Claude Code', efforts: ['medium', 'high', 'xhigh', 'max'], chat: { images: true, pdfs: true },
    signInLabel: 'Claude sign-in', signInHint: null, helpersNote: null, helperSlots: true, modelConnection: null,
    modelRule: null, modelIdHint: null, signInTitle: null,
    env: { names: CLAUDE_NAMES, hostOnly: ['CLAUDE_CONFIG_DIR'],
      relayOwned: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS'],
      home: null },
    // The macOS keychain lookup also needs HOME, USER and PATH (/usr/bin/security): base names every child keeps.
    signIn: { modes: [
      // Claude Code's own precedence (docs, Authentication precedence): ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY,
      // CLAUDE_CODE_OAUTH_TOKEN, then its /login (keychain). The resolver picks the first that is set.
      { id: 'gateway', kind: 'key', env: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS'] },
      { id: 'api-key', kind: 'key', env: ['ANTHROPIC_API_KEY'], brokerSlot: 'anthropic' },
      { id: 'oauth-env', kind: 'oauth', env: ['CLAUDE_CODE_OAUTH_TOKEN'], brokerSlot: 'anthropic' },
      { id: 'keychain', kind: 'own', env: ['HOME', 'USER', 'LOGNAME', 'CLAUDE_CONFIG_DIR'], files: ['.credentials.json'] },
    ] },
    // Claude Code's own side calls (Haiku, sub-agent aliases) are not pinned yet (design §9; R15 fills auxModels): the
    // relay does not check its model.
    relay: { protocol: 'anthropic', upstream: 'anthropic', modelCheck: 'partial', auxModels: [] },
    shell: true,
    // Captured on 2.1.308 (test/fixtures/engine-rules/claude/); an MCP rule takes the tool out of the session, and the
    // call is refused as a tool that is not there. It has no Grep or Glob tool; a Write(…) rule is never consulted (Edit
    // rules cover every file-editing tool: guardrails.mjs guardrailsToPermissionRules).
    rules: { Read: 'held', Edit: 'held', Bash: 'held', WebFetch: 'held', WebSearch: 'held', mcp: 'held',
      Grep: 'unverified', Glob: 'unverified', Write: 'unenforced' },
    subagents: { tool: 'Agent', inheritsRules: 'yes', proof: 'claude/subagent.denial.jsonl' },
    requiresExplicitModel: false, sessions: 'user-store', defaultModel: null, loadsClaudeMcp: true,
  },
  codex: {
    label: 'Codex', models: true, cost: true, helpers: true, beta: true, signin: false, remote: true,
    harness: 'Codex', efforts: ['minimal', 'low', 'medium', 'high'],
    chat: { images: true, pdfs: false, minVersion: '0.162', flags: [],
      noLockdownMessage: "Chat on Codex is unavailable: this codex version cannot switch off its image viewer (which reads any image on disk) or its sub-agents, and a chat must stay inside its own files. Use a Claude chat.",
      shellTrippedMessage: 'Codex tried to run a shell command although its shell was switched off — worca stopped the turn.',
      titles: true,
      suggestionModel: 'gpt-5.6-luna',
      turnImages: true,
      // codex's MCP resource tools (plans/ask-on-codex-spike.md (h)): they read what the chat's own MCP servers publish.
      metaTools: ['mcp__codex__list_mcp_resources', 'mcp__codex__list_mcp_resource_templates', 'mcp__codex__read_mcp_resource'],
      prompt: {
        cli: "the Codex CLI with Codex's own sign-in",
        attachments: 'Image attachments are different: you see an image with the message it came with; read_attachment returns any image attachment itself as content[1] of its result — called directly, the image is attached to the result; called from exec, pass that block to image() to look at it again. A Codex chat cannot view a PDF: read_attachment returns only its kind and size, and {pdfs} chats can.',
        composerBinary: 'An image arrives with the message that carried it — you see it there; read_attachment returns it again as content[1] of its result (called from exec, pass that block to image()). A Codex chat cannot view a PDF.',
        webOff: "Codex's own web search stays off.",
      },
      media: 'it is content[1] of this result: called directly, it is attached to the result — look at it there; called from exec, pass that block to image() to look at it' },
    signInLabel: 'ChatGPT sign-in', signInHint: "codex's own sign-in (`codex login`) reaches OpenAI.", helpersNote: null,
    helperSlots: true, modelConnection: null, modelRule: null, modelIdHint: null, signInTitle: null,
    env: { names: ['OPENAI_ORG_ID', 'OPENAI_PROJECT_ID'], hostOnly: ['CODEX_HOME'],
      relayOwned: ['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'], home: { env: 'CODEX_HOME', dir: '.codex' } },
    signIn: { modes: [
      { id: 'api-key', kind: 'key', env: ['CODEX_API_KEY'], brokerSlot: 'openai' },
      { id: 'openai-key', kind: 'key', env: ['OPENAI_API_KEY'], brokerSlot: 'openai' },
      { id: 'chatgpt', kind: 'own', env: ['CODEX_HOME'], files: ['auth.json'] },
    ] },
    relay: { protocol: 'openai', upstream: 'openai', modelCheck: 'body', auxModels: [] },
    shell: true,
    // A bare Bash and an MCP rule remove the tool (codexRulePlan): no denial event can prove that, so 'unverified'.
    rules: { Bash: 'partial', mcp: 'unverified', WebFetch: 'unverified', WebSearch: 'unverified',
      Read: 'unenforced', Grep: 'unenforced', Glob: 'unenforced', Edit: 'unenforced', Write: 'unenforced' },
    subagents: { tool: 'multi_agent', inheritsRules: 'unverified', proof: null },
    requiresExplicitModel: false, sessions: 'managed-home', defaultModel: 'gpt-6.1-sol', loadsClaudeMcp: false,
  },
  copilot: {
    label: 'Copilot', models: true, cost: false, helpers: true, beta: true, signin: false, remote: true,
    harness: 'Copilot', efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    chat: { images: true, pdfs: true, minVersion: '1.0.100', flags: ['--available-tools', '--disable-builtin-mcps', '--disallow-temp-dir', '--no-custom-instructions', '--additional-mcp-config'],
      noLockdownMessage: 'Chat on Copilot is unavailable: this copilot cannot be locked down for a chat. Use a Claude chat.',
      docsAnchor: 'github-copilot-cli',
      shellTrippedMessage: 'Copilot tried to run a shell command although it was given none — worca stopped the turn.',
      titles: true,
      // GPT-5 Mini is one of Copilot's included models (0× premium requests on a paid plan): a suggestion after every reply
      // costs no premium request there (one on the free plan).
      suggestionModel: 'gpt-5-mini',
      prompt: {
        cli: "the GitHub Copilot CLI with Copilot's own sign-in",
        webOff: "Copilot's own web tools stay off.",
        // Copilot hands an MCP image on only to a model that declares vision, and a PDF only on the Responses and Anthropic
        // APIs; otherwise it drops the block without a word (plans/ask-on-qwen-gemini-spike.md, "Open topics").
        attachments: 'Image and PDF attachments are different: read_attachment returns the image or PDF itself, as a block of its result beside its kind and size, and Copilot hands it to your model right after the result only when the model can view that kind — read one to look at it; when it does not reach you, tell the user this Copilot model cannot view it.',
        composerBinary: 'For an image or PDF, read_attachment returns the image or PDF itself as a block of its result, which Copilot hands on only to a model that can view that kind: read it to look at it; when it does not reach you, say this Copilot model cannot view it.',
      },
      media: 'Copilot attaches it right after this result when your model can view {kind}: look at it there; if it did not reach you, tell the user this model cannot view it' },
    signInLabel: 'Copilot sign-in', signInHint: "the Copilot CLI's own sign-in (`copilot login`, or COPILOT_GITHUB_TOKEN) reaches GitHub Copilot.",
    helpersNote: "Copilot runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on its own default model.",
    helperSlots: false, modelConnection: "the Copilot CLI's own sign-in", modelRule: null, modelIdHint: null, signInTitle: null,
    // COPILOT_ALLOW_ALL and COPILOT_ASSISTED_APPROVAL are never listed: either widens copilot's tool allow list.
    env: { names: ['COPILOT_AUTO_UPDATE'], hostOnly: ['COPILOT_HOME'],
      relayOwned: ['COPILOT_GITHUB_TOKEN', 'COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_TYPE',
        'COPILOT_PROVIDER_WIRE_API', 'COPILOT_PROVIDER_BEARER_TOKEN', 'COPILOT_PROVIDER_API_KEY_COMMAND', 'COPILOT_OFFLINE',
        'COPILOT_API_URL', 'COPILOT_DEBUG_GITHUB_API_URL'], home: null },
    signIn: { modes: [
      // copilot's own bring-your-own-key mode (COPILOT_PROVIDER_* in this machine's env): when its base URL is set,
      // copilot's model calls go to that provider, so its key wins over the GitHub token. Local only, no broker slot.
      { id: 'provider-key', kind: 'key', env: ['COPILOT_PROVIDER_API_KEY'], requires: ['COPILOT_PROVIDER_BASE_URL'] },
      // A fine-grained PAT (github_pat_…, Copilot Requests only) is what the broker's copilot-pat slot and the relay
      // take; locally copilot accepts any token it accepts today.
      { id: 'token', kind: 'key', env: ['COPILOT_GITHUB_TOKEN'], brokerSlot: 'copilot-pat', slotLabel: 'Copilot (token)' },
      { id: 'keychain', kind: 'own', env: ['COPILOT_HOME'] },
    ] },
    relay: { protocol: 'openai', upstream: 'copilot', modelCheck: 'body', auxModels: [], needsModel: true },
    shell: true,
    rules: { Bash: 'partial', Edit: 'partial', Write: 'partial', mcp: 'unverified', WebFetch: 'unverified', WebSearch: 'unverified',
      Read: 'unenforced', Grep: 'unenforced', Glob: 'unenforced' },
    subagents: { tool: 'task', inheritsRules: 'unverified', proof: null },
    requiresExplicitModel: false, sessions: 'user-store', defaultModel: null, loadsClaudeMcp: false,
  },
  cursor: {
    label: 'Cursor', models: true, cost: false, helpers: false, beta: true, signin: true, remote: true,
    harness: 'Cursor', efforts: [],
    chat: { images: false, pdfs: false, verified: false, minVersion: null, flags: [],
      noLockdownMessage: 'Chat on Cursor is unavailable: no switch that turns off its shell and file tools has been verified, and a chat must stay inside its own files. Use a Claude chat.',
      prompt: { cli: "Cursor's CLI agent with Cursor's own sign-in" } },
    signInLabel: 'Cursor sign-in', signInHint: "cursor-agent's own sign-in (`cursor-agent login`, or CURSOR_API_KEY) reaches Cursor.",
    helpersNote: "Cursor runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude. See the Claude tab.",
    helperSlots: false, modelConnection: "cursor-agent's own sign-in",
    modelRule: "a cursor model takes no env, no upstream and no efforts (cursor-agent's own sign-in)", modelIdHint: null, signInTitle: null,
    env: { names: ['CURSOR_MODEL'], hostOnly: ['CURSOR_CONFIG_DIR'],
      relayOwned: ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN', 'CURSOR_API_ENDPOINT', 'CURSOR_AGENT_CLI_AUTHLESS_MODE'],
      home: { env: 'CURSOR_CONFIG_DIR', dir: '.cursor' } },
    signIn: { modes: [
      { id: 'api-key', kind: 'key', env: ['CURSOR_API_KEY'], brokerSlot: 'cursor', slotLabel: 'Cursor' },
      { id: 'keychain', kind: 'own', env: ['CURSOR_CONFIG_DIR'] },
    ] },
    relay: { protocol: 'connect', upstream: 'cursor', modelCheck: 'partial', auxModels: [] },
    shell: true,
    // Every rule Cursor is told is partial (cursorRulePlan); the fixtures are hand-written, none captured.
    rules: { Bash: 'partial', Read: 'partial', Edit: 'partial', Write: 'partial',
      Grep: 'unenforced', Glob: 'unenforced', WebFetch: 'unenforced', WebSearch: 'unenforced', mcp: 'unenforced' },
    subagents: { tool: null, inheritsRules: 'unverified', proof: null },
    requiresExplicitModel: false, sessions: 'user-store', defaultModel: null, loadsClaudeMcp: false,
  },
  gemini: {
    label: 'Gemini CLI', models: true, cost: false, helpers: false, beta: true, signin: true, remote: false,
    harness: 'Gemini CLI', efforts: ['low', 'medium', 'high'],
    chat: { images: true, pdfs: true, minVersion: '0.65.0', flags: ['--admin-policy', '--allowed-mcp-server-names', '--extensions'],
      docsAnchor: 'gemini-cli-and-qwen-code',
      prompt: { cli: "Gemini CLI with Gemini CLI's own sign-in" },
      ownFolder: true },
    signInLabel: 'Gemini CLI sign-in', signInHint: "gemini's own sign-in (GEMINI_API_KEY, Vertex AI, or the sign-in you chose in `gemini`) reaches Google.",
    helpersNote: "Gemini CLI runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude. See the Claude tab.",
    helperSlots: false, modelConnection: "gemini's own sign-in",
    modelRule: "a gemini model takes no env, no upstream and no efforts (gemini's own sign-in)", modelIdHint: null, signInTitle: null,
    // GEMINI_CLI_TRUST_WORKSPACE is set per spawn; GEMINI_CLI_HOME (the home holding its .gemini) and GEMINI_MODEL are
    // its own config. GEMINI_SYSTEM_MD and GEMINI_CLI_SYSTEM_SETTINGS_PATH are never listed (either replaces what worca
    // hands it). GOOGLE_APPLICATION_CREDENTIALS (Vertex AI through ADC) names a file, not a key: it passes like the
    // other endpoint names.
    env: { names: ['GEMINI_CLI_TRUST_WORKSPACE', 'GEMINI_CLI_HOME', 'GEMINI_MODEL'], hostOnly: ['GEMINI_CLI_HOME'],
      relayOwned: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_BASE_URL', 'GOOGLE_VERTEX_BASE_URL', 'GOOGLE_GENAI_USE_VERTEXAI',
        'GOOGLE_GENAI_USE_GCA', 'GOOGLE_CLOUD_ACCESS_TOKEN', 'CODE_ASSIST_ENDPOINT', 'GEMINI_CLI_AUTH_OVERRIDE',
        'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GCE_METADATA_HOST'], home: null },
    // The sign-in its settings choose (security.auth.selectedType) wins (engines/gemini.mjs geminiConfiguredMode).
    signIn: { modes: [
      { id: 'api-key', kind: 'key', env: ['GEMINI_API_KEY'] },
      { id: 'vertex-key', kind: 'key', env: ['GOOGLE_API_KEY'], requires: ['GOOGLE_GENAI_USE_VERTEXAI'], provider: 'vertex' },
      { id: 'access-token', kind: 'key', env: ['GOOGLE_CLOUD_ACCESS_TOKEN'], provider: 'vertex' },
      { id: 'google-login', kind: 'own', env: [], files: ['oauth_creds.json', 'google_accounts.json'] },
    ] },
    relay: null, provider: 'google',
    shell: true,
    // Captured on 0.63 (test/fixtures/engine-rules/gemini/, from test/fixtures/gemini/policy-denied.jsonl): read_file and
    // write_file refused by path rules. No `replace` refusal was captured, so Edit is partial until one is. A command rule
    // matches the start of the command (policy-bypass.jsonl: `env git log` runs), so Bash is partial. Grep and Glob are
    // translated, never captured; WebFetch, WebSearch and MCP rules take the tool out of the session, so no refusal can
    // be recorded.
    rules: { Read: 'held', Edit: 'partial', Write: 'held', Bash: 'partial', Grep: 'partial', Glob: 'partial',
      WebFetch: 'unverified', WebSearch: 'unverified', mcp: 'unverified' },
    // No sub-agent tool in its 0.63 captures (no `agents` setting is written).
    subagents: { tool: null, inheritsRules: 'unverified', proof: null },
    requiresExplicitModel: false, sessions: 'user-store', defaultModel: null, loadsClaudeMcp: false,
  },
  goose: {
    label: 'Goose', models: true, cost: true, helpers: false, beta: true, signin: true, remote: false,
    harness: 'Goose', efforts: ['low', 'medium', 'high', 'max'],
    chat: { images: true, pdfs: false, minVersion: '1.56.0', flags: ['--no-profile'],
      // load_skill reads the chat's own skills (plans/ask-on-qwen-gemini-spike.md): the one Goose tool a chat keeps.
      metaTools: ['load_skill'],
      prompt: { cli: "Goose with Goose's own providers" } },
    signInLabel: 'Goose providers', signInHint: "Goose's own providers (`goose configure`, or a provider key in worca's environment) reach the model the id names.",
    helpersNote: "Goose runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude. See the Claude tab.",
    helperSlots: false, modelConnection: "Goose's own providers",
    modelRule: "a goose model's id is provider/model, it takes no env and no upstream (Goose's own providers), and its efforts are GOOSE_THINKING_EFFORT values",
    modelIdHint: "A Goose model's id is provider/model (for example google/gemini-2.5-flash); Goose's own providers connect it.",
    signInTitle: 'Goose providers',
    // goose's own knobs (GOOSE_MODE and GOOSE_THINKING_EFFORT are set per spawn); the provider and model come from the
    // step's model id (--provider, --model), its credentials from goose's config and keyring or the provider's key.
    env: { names: ['GOOSE_MODE', 'GOOSE_THINKING_EFFORT', 'GOOSE_MAX_TURNS', 'GOOSE_TEMPERATURE', 'GOOSE_CONTEXT_LIMIT',
      'GOOSE_DISABLE_KEYRING', 'GOOSE_CLI_MIN_PRIORITY'], hostOnly: [],
      relayOwned: ['GOOSE_PROVIDER', 'GOOSE_MODEL', 'GOOSE_LEAD_PROVIDER', 'GOOSE_LEAD_MODEL', 'OPENAI_API_KEY', 'OPENAI_HOST',
        'OPENAI_BASE_PATH', 'ANTHROPIC_API_KEY', 'ANTHROPIC_HOST', 'GOOGLE_API_KEY', 'GOOGLE_HOST', 'OPENROUTER_API_KEY',
        'OPENROUTER_HOST', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT_NAME',
        'AZURE_OPENAI_API_VERSION', 'DATABRICKS_TOKEN', 'DATABRICKS_HOST', 'OLLAMA_HOST'], home: null },
    signIn: { modes: [
      { id: 'openai', kind: 'key', env: ['OPENAI_API_KEY'] },
      { id: 'anthropic', kind: 'key', env: ['ANTHROPIC_API_KEY'] },
      { id: 'google', kind: 'key', env: ['GOOGLE_API_KEY'] },
      { id: 'openrouter', kind: 'key', env: ['OPENROUTER_API_KEY'] },
      { id: 'azure_openai', kind: 'key', env: ['AZURE_OPENAI_API_KEY'] },
      { id: 'databricks', kind: 'key', env: ['DATABRICKS_TOKEN'] },
      { id: 'config', kind: 'own', env: [], files: ['config.yaml'] },
    ] },
    relay: null,
    shell: true,
    // goose holds no permission rule per spawn (its permission.yaml is per tool name and user-wide).
    rules: {},
    // The summon extension (its sub-agents) is never loaded: --no-profile --with-builtin developer.
    subagents: { tool: null, inheritsRules: 'unverified', proof: null },
    requiresExplicitModel: false, sessions: 'none', defaultModel: null, loadsClaudeMcp: false,
  },
  opencode: {
    label: 'OpenCode', models: true, cost: true, helpers: false, beta: true, signin: true, remote: false,
    harness: 'OpenCode', efforts: ['minimal', 'low', 'medium', 'high', 'max'],
    chat: { images: true, pdfs: true, minVersion: '1.19.4', flags: [],
      prompt: { cli: "OpenCode with OpenCode's own providers" } },
    signInLabel: 'OpenCode providers', signInHint: "OpenCode's own providers (`opencode auth login`, or a provider key in worca's environment) reach the model the id names.",
    helpersNote: "OpenCode runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude. See the Claude tab.",
    helperSlots: false, modelConnection: "OpenCode's own providers",
    modelRule: "an opencode model's id is provider/model, it takes no env and no upstream (OpenCode's own providers), and its efforts are OpenCode variants",
    modelIdHint: "An OpenCode model's id is provider/model (as `opencode models` lists it); OpenCode's own providers connect it, and its effort is OpenCode's --variant.",
    signInTitle: 'OpenCode providers',
    // worca's config rides OPENCODE_CONFIG_CONTENT with the project config off (set per spawn); OPENCODE_CONFIG,
    // OPENCODE_CONFIG_DIR and OPENCODE_PERMISSION are never listed: each would bring config or rules worca did not write.
    env: { names: ['OPENCODE_DISABLE_LSP_DOWNLOAD', 'OPENCODE_DISABLE_MODELS_FETCH'], hostOnly: [],
      relayOwned: ['OPENCODE_API_KEY', 'OPENCODE_AUTH_CONTENT', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY'], home: null },
    signIn: { modes: [
      { id: 'anthropic', kind: 'key', env: ['ANTHROPIC_API_KEY'] },
      { id: 'openai', kind: 'key', env: ['OPENAI_API_KEY'] },
      { id: 'google', kind: 'key', env: ['GOOGLE_GENERATIVE_AI_API_KEY'] },
      { id: 'openrouter', kind: 'key', env: ['OPENROUTER_API_KEY'] },
      { id: 'zen', kind: 'key', env: ['OPENCODE_API_KEY'] },
      // `opencode auth login` (auth.json), or the same content in OPENCODE_AUTH_CONTENT.
      { id: 'auth-file', kind: 'own', env: ['OPENCODE_AUTH_CONTENT'], files: ['auth.json'] },
    ] },
    relay: null,
    shell: true,
    rules: {},
    subagents: { tool: 'task', inheritsRules: 'unverified', proof: null },
    // Its own default can be a free OpenCode Zen model that sends the code to opencode.ai (engines/opencode.mjs).
    requiresExplicitModel: true, sessions: 'none', defaultModel: null, loadsClaudeMcp: false,
  },
  qwen: {
    label: 'Qwen Code', models: true, cost: false, helpers: false, beta: true, signin: true, remote: false,
    harness: 'Qwen Code', efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    chat: { images: true, pdfs: true, minVersion: '0.26.1', flags: ['--core-tools', '--exclude-tools', '--allowed-mcp-server-names'],
      docsAnchor: 'gemini-cli-and-qwen-code',
      prompt: { cli: "Qwen Code with Qwen Code's own sign-in" } },
    signInLabel: 'Qwen Code sign-in', signInHint: "qwen's own sign-in (the auth type you chose in `qwen`, or a provider's env such as OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_MODEL).",
    helpersNote: "Qwen Code runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude. See the Claude tab.",
    helperSlots: false, modelConnection: "qwen's own sign-in",
    modelRule: "a qwen model takes no env, no upstream and no efforts (qwen's own sign-in)", modelIdHint: null, signInTitle: null,
    // QWEN_CODE_SUPPRESS_YOLO_WARNING and QWEN_CODE_SYSTEM_SETTINGS_PATH are set per spawn (the latter to worca's own
    // settings file, built over this machine's); QWEN_HOME (its .qwen) and QWEN_MODEL are its own config.
    env: { names: ['QWEN_CODE_SUPPRESS_YOLO_WARNING', 'QWEN_HOME', 'QWEN_MODEL'], hostOnly: ['QWEN_HOME'],
      relayOwned: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'GEMINI_API_KEY',
        'GOOGLE_GEMINI_BASE_URL', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_VERTEX_BASE_URL',
        'QWEN_OAUTH'], home: null },
    // The mode ids are Qwen's auth types. The one its settings choose wins (engines/qwen.mjs qwenConfiguredMode); else,
    // as Qwen's getAuthTypeFromEnv, the env signs in only when it names a whole provider (`requires`).
    signIn: { modes: [
      { id: 'openai', kind: 'key', env: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'], requires: ['OPENAI_BASE_URL', 'OPENAI_MODEL'], provider: 'openai' },
      { id: 'gemini', kind: 'key', env: ['GEMINI_API_KEY', 'GEMINI_MODEL'], requires: ['GEMINI_MODEL'], provider: 'google' },
      { id: 'vertex-ai', kind: 'key', env: ['GOOGLE_API_KEY', 'GOOGLE_MODEL'], requires: ['GOOGLE_MODEL'], provider: 'vertex' },
      { id: 'anthropic', kind: 'key', env: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL'], requires: ['ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL'], provider: 'anthropic' },
      { id: 'qwen-oauth', kind: 'own', env: [], files: ['oauth_creds.json'], provider: 'qwen' },
    ] },
    relay: null, provider: null,
    shell: true,
    // Captured on 0.25 (test/fixtures/engine-rules/qwen/, from test/fixtures/qwen/denied.jsonl and mcp-denied.jsonl):
    // read_file and write_file refused by Read and Edit rules, an MCP tool by its rule. A command rule matches the start of
    // the command (`env git log` runs), so Bash is partial. Write, Grep, Glob, WebFetch and WebSearch were never refused
    // in a capture.
    rules: { Read: 'held', Edit: 'held', mcp: 'held', Bash: 'partial',
      Write: 'unverified', Grep: 'unverified', Glob: 'unverified', WebFetch: 'unverified', WebSearch: 'unverified' },
    // Its `agent` tool starts a sub-agent; send_message talks to a running one and cron_create starts a prompt later:
    // all three are off unless the catalog proves its sub-agents keep the rules (engines/qwen.mjs --exclude-tools).
    subagents: { tool: 'agent', extraTools: ['send_message', 'cron_create'], inheritsRules: 'unverified', proof: null },
    requiresExplicitModel: false, sessions: 'user-store', defaultModel: null, loadsClaudeMcp: false,
  },
});

/** The permission-rule kinds the catalog's `rules` are keyed by. */
export const RULE_KINDS = Object.freeze(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'mcp']);
/** The values a `rules` kind may take. */
export const RULE_SUPPORT = Object.freeze(['held', 'partial', 'unverified', 'unenforced']);

/** A deny rule's kind: the tool name before `(` (`Read(./x)` → Read), `mcp` for an MCP rule, MultiEdit/NotebookEdit
 *  as Edit; any other name as written (unlisted in every catalog entry, so unenforced). */
export function ruleKind(rule) {
  const s = String(rule ?? '').trim();
  if (/^mcp__/.test(s)) return 'mcp';
  const name = s.replace(/\(.*$/s, '').trim();
  return name === 'MultiEdit' || name === 'NotebookEdit' ? 'Edit' : name;
}

// The catalog the owners read: ENGINES, or a test's clone (setCatalogForTest). Owners call engineEntry, never ENGINES[x].
const seam = Object.seal({ catalog: null });
/** The catalog entry of `engine`, or null for an engine worca does not know. */
export function engineEntry(engine) {
  const cat = seam.catalog || ENGINES;
  return Object.hasOwn(cat, engine || 'claude') ? cat[engine || 'claude'] : null;
}
/** Test seam: owners read `catalog` (a clone of ENGINES with changes) until it is reset with null. */
export function setCatalogForTest(catalog) { seam.catalog = catalog || null; }

/** A run on the local machine, natively (no container, no sandbox): what every such run logs and shows (decision 4). */
export const NATIVE_NOTICE = 'This run executes on this machine as you, not in a sandbox: the agent can read and change what you can. Pick Container or E2B to isolate it.';

/** The engine a run gets when it names none. */
export const DEFAULT_ENGINE = 'claude';

/** The run engines. */
export const ENGINE_NAMES = Object.freeze(Object.keys(ENGINES));
/** The engines that own catalog models. */
export const MODEL_ENGINE_NAMES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].models));
/** The engines a run can switch between: the model engines (a switch falls back to the target's catalog default). */
export const SWITCH_ENGINES = MODEL_ENGINE_NAMES;
/** The engines whose helper jobs have model slots of their own (title, overview, PR description, …). */
export const HELPER_ENGINE_NAMES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].helperSlots));

/** The engines whose models connect through their own sign-in (Cursor, Gemini CLI, Goose, OpenCode, Qwen Code). */
export const SIGN_IN_ENGINE_NAMES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].signin));

/** The engines a Chat runs on, Claude first (the `chat` flag above, without the unverified ones). */
export const CHAT_ENGINE_NAMES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].chat && ENGINES[e].chat.verified !== false));

/**
 * Why a chat on `engine` cannot take an attachment of this kind (`kind` text|image|binary, a PDF is `pdf: true`), said
 * before upload and again by the server; null when it can. A text attachment always can.
 */
export function chatAttachRefusal({ engine, kind, pdf = false }) {
  const c = Object.hasOwn(ENGINES, engine || 'claude') ? ENGINES[engine || 'claude'].chat : null;
  if (!c || c.verified === false || kind === 'text') return null;
  const label = engineLabel(engine);
  if (!c.images && !c.pdfs) return `a ${label} chat cannot view images or PDFs (${chatEnginesTaking('images', 'pdfs')} chats view both)`;
  if (pdf && !c.pdfs) return `a ${label} chat cannot view PDFs (${chatEnginesTaking('pdfs')} chats can)`;
  if (!pdf && kind === 'image' && !c.images) return `a ${label} chat cannot view images (${chatEnginesTaking('images')} chats can)`;
  return null;
}

/** The chat engines that take every `what` ('images', 'pdfs'), as words: 'Claude, Copilot, Gemini CLI, OpenCode or Qwen Code'. */
export function chatEnginesTaking(...what) {
  const names = CHAT_ENGINE_NAMES.filter((e) => what.every((w) => ENGINES[e].chat[w] === true)).map((e) => ENGINES[e].label);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names.join('');
}

/** The engines still in beta: every engine picker marks them. */
export const BETA_ENGINES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].beta));

/** Is `engine` in beta? A missing engine is Claude. */
export function isBetaEngine(engine) {
  return BETA_ENGINES.includes(engine || 'claude');
}

/** The one list every engine picker renders, in catalog order: `surface` 'run' (every engine), 'models' (the engines
 *  that own catalog models) or 'ask' (the engines Ask Worca chats run on). A picker shows `label` and marks `beta`
 *  its own way (a Beta badge, or ' (beta)' where only text fits). */
export function engineOptions({ surface = 'run' } = {}) {
  const surfaces = { run: ENGINE_NAMES, models: MODEL_ENGINE_NAMES, ask: CHAT_ENGINE_NAMES };
  if (!Object.hasOwn(surfaces, surface)) throw new Error(`engineOptions: unknown surface "${surface}"`);
  const names = surfaces[surface];
  return names.map((value) => ({ value, label: engineLabel(value), beta: isBetaEngine(value) }));
}

/** The run engines as the CLI's --engine help lists them: 'claude (default) | codex (beta) | …'. */
export function engineHelpList() {
  return ENGINE_NAMES.map((e) => (e === DEFAULT_ENGINE ? `${e} (default)` : isBetaEngine(e) ? `${e} (beta)` : e)).join(' | ');
}

/** How the Statistics view names a broker slot that is one engine's own ('Copilot (token)'), or null. */
export function brokerSlotLabel(slot) {
  for (const e of ENGINE_NAMES) for (const m of ENGINES[e].signIn.modes) if (m.brokerSlot === slot && m.slotLabel) return m.slotLabel;
  return null;
}

/** An engine's name where only text fits (a select option, an optgroup): 'Codex (beta)'. */
export function engineChoiceLabel(engine) {
  return isBetaEngine(engine) ? `${engineLabel(engine)} (beta)` : engineLabel(engine);
}

/** The display name of an engine ('codex' -> 'Codex'); a missing engine is Claude. */
export function engineLabel(engine) {
  const e = engine || 'claude';
  return Object.hasOwn(ENGINES, e) ? ENGINES[e].label : String(e);
}

/** Whether runs on `engine` report a cost. Where not, a cost shows as unknown, never $0.00. An unknown engine does. */
export function engineReportsCost(engine) { const e = engine || 'claude'; return !Object.hasOwn(ENGINES, e) || ENGINES[e].cost; }

/** A run's cost as text for the CLI and chat: `fmt(costUsd)`; "cost unknown" on an engine that reports none (a total
 *  above 0 there is worca's own calls); "≥ $x (part unknown)" when a step's cost could not be priced (`known` false). */
export function runCostLabel(engine, costUsd, fmt, known = true) {
  const n = Number(costUsd) || 0;
  if (!engineReportsCost(engine)) return n > 0 ? `cost unknown (worca's own calls: ${fmt(n)})` : 'cost unknown';
  if (known === false) return n > 0 ? `≥ ${fmt(n)} (part unknown)` : 'cost unknown';
  return fmt(n);
}
/** Whether every step of a run (state or history row) has a known cost: false when one step's could not be priced. */
export function costKnownOf(run) {
  if (!run) return true;
  if (run.costKnown === false || run.cost_known === 0) return false;
  return !(Array.isArray(run.steps) && run.steps.some((s) => s && s.costKnown === false));
}

/** Every engine a run on `engine` can switch to, in list order, limited to `ready` (default: all). [] for an unknown engine. */
export function otherEngines(engine, ready = SWITCH_ENGINES) {
  const e = engine || 'claude';
  if (!SWITCH_ENGINES.includes(e)) return [];
  const ok = Array.isArray(ready) ? ready : SWITCH_ENGINES;
  return SWITCH_ENGINES.filter((x) => x !== e && ok.includes(x));
}

/**
 * The engines a pause offers to continue on now. Only a session/usage limit an engine itself hit (`limitEngine`)
 * offers any: each other engine has its own allowance. Any other pause, and a limit that was not the engine's (a
 * spent OpenRouter free allowance, say), offers none. `ready`: the engines whose preflight passes
 * (engines/ready-cache.mjs); null or omitted, every other engine is offered and the resume's own gate decides.
 * @param {{reason?: string|null, limitEngine?: string|null}} pause
 * @param {string[]|null} [ready]
 * @returns {string[]}
 */
export function usageLimitSwitches({ reason = null, limitEngine = null } = {}, ready = null) {
  return reason === 'usage_limit' && limitEngine ? otherEngines(limitEngine, ready ?? SWITCH_ENGINES) : [];
}

/** What switching a paused run to `engine` does, in one line. */
export function engineSwitchNote(engine) {
  return `Starts the paused step fresh; a model ${engineLabel(engine)} cannot run falls back to its default.`;
}

/** The engine gate's refusal worded for where it is read. The run writes it for the CLI ("run it with
 *  --guardrails permissive", on a resume "start a new run with --guardrails permissive", "pass
 *  --allow-unguarded-engine"); the UI names the set and its checkbox, and chat sends the person to the UI (it
 *  never sends the consent). Any other text is returned as is. */
export function engineRefusalFor(text, surface) {
  const s = String(text ?? '');
  if (surface !== 'ui' && surface !== 'chat') return s;
  const set = s.replace(/ with --guardrails permissive/g, ' with the Permissive set');
  if (surface === 'ui') return set.replace(/pass --allow-unguarded-engine/g, 'tick Allow unguarded');
  return set.replace(/pass --allow-unguarded-engine/g, 'resume it in the Worca UI with Allow unguarded');
}

/** "Codex or Cursor" / "Claude, Codex or Cursor"; `label` maps each name (default engineLabel). */
export function engineList(engines, label = engineLabel) {
  const l = engines.map(label);
  return l.length < 2 ? (l[0] || '') : `${l.slice(0, -1).join(', ')} or ${l.at(-1)}`;
}
