// src/shared/engine-setup.mjs
// How each chat engine is installed and signed in, for the setup dialog (Connect <engine>, ui/public/engine-setup.mjs)
// and for the docs link of each engine's not-ready notice (src/core/engines/chat-descriptor.mjs). The words are the
// engine sections of docs/models.md, shortened; a command here is one those sections give. Import-free: served to the
// browser as-is under /src/shared.

/** The page that tells every engine's setup. */
export const MODELS_DOCS = 'https://github.com/worca-org/worca/blob/dev/docs/models.md';

/**
 * One entry per chat engine (engine-switch.mjs CHAT_ENGINE_NAMES; a test keeps them equal). Prose takes `code` in
 * backticks and [a link](https://…), nothing else (ui/public/engine-setup.mjs inlineParts).
 *   docsAnchor  the engine's section of docs/models.md
 *   binVar      the variable that points worca at a binary elsewhere (src/core/engines/cli-specs.mjs `envVar`)
 *   install     the commands that put the CLI on the PATH
 *   installNote what else installs it, and the version a chat needs
 *   signIn      {lead, commands, notes}: the step after the install, run once in a terminal
 */
export const ENGINE_SETUP = Object.freeze({
  claude: entry({
    docsAnchor: 'claude-code', binVar: 'WORCA_CLAUDE_BIN',
    install: ['npm install -g @anthropic-ai/claude-code'],
    installNote: 'On native Windows the [native installer](https://docs.anthropic.com/en/docs/claude-code/setup) works too.',
    signIn: {
      lead: 'Start it once in a terminal and type `/login`:',
      commands: ['claude'],
      notes: ['Signing in to the Claude desktop app does not carry over. The CLI keeps its own sign-in.'],
    },
  }),
  codex: entry({
    docsAnchor: 'codex', binVar: 'WORCA_CODEX_BIN',
    install: ['npm install -g @openai/codex'],
    installNote: 'The `codex` bundled with the ChatGPT desktop app works too. Chat needs `codex-cli` 0.162 or newer.',
    signIn: {
      lead: 'Sign in once in a terminal:',
      commands: ['codex login'],
      notes: ['`codex login status` must say you are logged in. A model on its own endpoint needs no sign-in.'],
    },
  }),
  copilot: entry({
    docsAnchor: 'github-copilot-cli', binVar: 'WORCA_COPILOT_BIN',
    install: ['npm install -g @github/copilot'],
    installNote: 'Chat needs 1.0.100 or newer (`copilot --version`), and a GitHub account with Copilot access (any plan, Free included).',
    signIn: {
      lead: 'Sign in once in a terminal and follow the prompts:',
      commands: ['copilot login'],
      notes: [
        'Or set a fine-grained GitHub token with the Copilot Requests permission as `COPILOT_GITHUB_TOKEN` in worca\'s environment. The Copilot provider\'s sign-in (Models › Providers) is a separate one.',
        'The CLI has no sign-in status command, so Check again only finds the binary. A signed-out CLI fails the first turn with an auth error.',
      ],
    },
  }),
  gemini: entry({
    docsAnchor: 'gemini-cli-and-qwen-code', binVar: 'WORCA_GEMINI_BIN',
    install: ['npm i -g @google/gemini-cli'],
    installNote: 'Chat needs Gemini CLI 0.65.0 or newer.',
    signIn: {
      lead: 'Run it once in a terminal and sign in with Google:',
      commands: ['gemini'],
      notes: [
        'Or set `GEMINI_API_KEY` (or Vertex AI\'s variables) in worca\'s environment or in `~/.gemini/.env`.',
        'Gemini CLI has no status command: Check again finds the binary and a configured sign-in. worca never reads the credentials.',
      ],
    },
  }),
  goose: entry({
    docsAnchor: 'goose', binVar: 'WORCA_GOOSE_BIN',
    install: ['brew install block-goose-cli'],
    installNote: 'conda-forge\'s `goose-cli` works too. Chat needs goose 1.56.0 or newer.',
    signIn: {
      lead: 'Set up a provider once in a terminal:',
      commands: ['goose configure'],
      notes: [
        'A chat runs in a Goose home of its own and does not read that config: for Chat, keep the model\'s provider key in worca\'s environment under its own name (for example `GOOGLE_API_KEY`).',
        'Check again only finds the binary: a missing provider key shows when the first turn fails.',
      ],
    },
  }),
  opencode: entry({
    docsAnchor: 'opencode', binVar: 'WORCA_OPENCODE_BIN',
    install: ['npm install -g @opencode/cli'],
    installNote: 'That is OpenCode 2.x; Homebrew\'s `opencode` formula works too, and 1.x is npm `opencode-ai`. Chat needs 2.3.2 or newer (1.x: 1.19.4).',
    signIn: {
      lead: 'Connect a provider once in a terminal:',
      commands: ['opencode auth login'],
      notes: [
        'Or set the provider\'s key (for example `ANTHROPIC_API_KEY`) in worca\'s environment. `opencode auth list` (2.x) or `opencode providers list` (1.x) shows what OpenCode sees.',
      ],
    },
  }),
  qwen: entry({
    docsAnchor: 'gemini-cli-and-qwen-code', binVar: 'WORCA_QWEN_BIN',
    install: ['npm i -g @qwen-code/qwen-code'],
    installNote: 'Chat needs Qwen Code 0.26.1 or newer.',
    signIn: {
      lead: 'Run it once in a terminal and choose how it signs in:',
      commands: ['qwen'],
      notes: [
        'Or set a whole provider in worca\'s environment or `~/.qwen/.env` (for example `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `OPENAI_MODEL`). A key alone is not enough.',
        'Qwen Code has no status command: Check again finds the binary and a configured sign-in. worca never reads the credentials.',
      ],
    },
  }),
});

/** `engine`'s setup entry, or null (an engine with no chat). */
export function engineSetup(engine) {
  return typeof engine === 'string' && Object.hasOwn(ENGINE_SETUP, engine) ? ENGINE_SETUP[engine] : null;
}

/** The docs section that tells `engine`'s setup: its anchor on docs/models.md. An engine with no entry (Cursor, which
 *  has no chat) has a section of its own name. */
export function engineSetupDocs(engine) {
  const e = engineSetup(engine);
  const anchor = e ? e.docsAnchor : typeof engine === 'string' && /^[a-z][a-z0-9-]*$/.test(engine) ? engine : '';
  return anchor ? `${MODELS_DOCS}#${anchor}` : MODELS_DOCS;
}

function entry({ docsAnchor, binVar, install, installNote, signIn }) {
  return Object.freeze({
    docsAnchor, binVar, install: Object.freeze([...install]), installNote,
    signIn: Object.freeze({ lead: signIn.lead, commands: Object.freeze([...signIn.commands]), notes: Object.freeze([...signIn.notes]) }),
  });
}
