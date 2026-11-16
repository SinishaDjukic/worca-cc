// "How it works" copy for the build areas: Workflows, Requirements, Marketplace, Connectors, Models
// and Providers. Static data only: no imports, no state, no DOM. area-guides.mjs freezes and serves it.

export const BUILD_GUIDES = {
  workflows: {
    title: 'How Workflows work',
    tour: 'workflows',
    steps: [
      { id: 'what', title: 'A graph of cards', paras: [
        'A workflow is a graph. Each card is an agent that thinks or a script that runs, and the wires between them set the order.',
      ] },
      { id: 'library', title: 'The Library', paras: [
        'The Library holds your workflows. Yours are the ones you saved. Built-in ones are read-only, so open one with Use as template to get a copy you can change and save as your own.',
        'It also lists the agents and scripts you can add.',
      ] },
      { id: 'edit', title: 'Add cards and save', paras: [
        'Press + to add a card to the graph, wire it in, then press Save.',
      ] },
      { id: 'agent', title: 'Draft a new agent', paras: [
        'Describe the agent you want in plain words and Worca drafts it for you to read and edit.',
      ] },
    ],
    controls: [
      { label: 'Library', file: 'ui/public/workflows/workflows.html' },
      { label: 'Yours', file: 'ui/public/workflows/library.mjs' },
      { label: 'Built-in', file: 'ui/public/workflows/library.mjs' },
      { label: 'Use as template', file: 'ui/public/workflows/library.mjs' },
      { label: 'Save', file: 'ui/public/workflows/workflows.html', find: 'id="wfv-save"' },
    ],
  },

  requirements: {
    title: 'How Requirements work',
    tour: null,
    steps: [
      { id: 'what', title: 'Define it before you build it', paras: [
        'Requirements turn a rough idea, such as “Add a dark mode”, into a written spec before any code is written.',
      ] },
      { id: 'interview', title: 'A short interview', paras: [
        'Press New feature. Worca takes a read-only look at the code, then asks short rounds of questions, with a suggested answer for each.',
      ] },
      { id: 'spec', title: 'The spec', paras: [
        'Your answers become a spec you can read, correct and export.',
      ] },
      { id: 'start', title: 'Only one button builds', paras: [
        'Start in Worca is the only thing here that starts a build. Everything before it only reads and writes the spec.',
      ] },
    ],
    controls: [
      { label: 'New feature', file: 'ui/public/requirements-view.mjs' },
      { label: 'Start in Worca', file: 'ui/public/requirements-view.mjs' },
    ],
  },

  marketplace: {
    title: 'How the Marketplace works',
    tour: null,
    steps: [
      { id: 'what', title: 'What plugins add', paras: [
        'A plugin can add task sources, agents, workflow templates and MCP servers. The Marketplace shows from the Advanced level up.',
      ] },
      { id: 'browse', title: 'Browse and install', paras: [
        'Browse the tiles, open one to see what it adds, and install it.',
        'Add marketplace connects another catalog, such as your team’s own.',
      ] },
      { id: 'official', title: 'Nothing installs by itself', paras: [
        'Worca CC Official is already registered, so its plugins are listed. Nothing is installed until you pick it.',
      ] },
    ],
    controls: [
      { label: 'Add marketplace', file: 'ui/public/marketplace/browse.mjs' },
      { label: 'Worca CC Official', file: 'src/core/marketplaces.mjs' },
    ],
  },

  connectors: {
    title: 'How Connectors work',
    tour: null,
    steps: [
      { id: 'what', title: 'Worca’s own MCP list', paras: [
        'Connectors hold the MCP servers Worca’s agents can use. The list is Worca’s own and is never written to your Claude Code config.',
        'It shows from the Advanced level up.',
      ] },
      { id: 'views', title: 'Sets, Servers and Skills', paras: [
        'Servers lists what is installed. Sets group servers with their settings. Skills lists the skills agents can load.',
        'Press Add MCP server on the Servers view to add one by hand.',
      ] },
      { id: 'general', title: 'The General set', paras: [
        'General is built in, and Chat always uses it. A project picks other sets on its own Sets tab, and can turn General off for its runs.',
      ] },
    ],
    controls: [
      { label: 'Sets', file: 'ui/public/mcp-view.mjs' },
      { label: 'Servers', file: 'ui/public/mcp-view.mjs' },
      { label: 'Skills', file: 'ui/public/mcp-view.mjs' },
      { label: 'Add MCP server', file: 'ui/public/mcp-view.mjs' },
      { label: 'General', file: 'ui/public/mcp-view.mjs', find: "'General set'" },
    ],
  },

  models: {
    title: 'How Models work',
    tour: null,
    steps: [
      { id: 'what', title: 'Roles and Engines', paras: [
        'Roles say which model does each kind of work. Engines are the tools that run those models. Models show at the Expert level.',
      ] },
      { id: 'fallback', title: 'Roles are fallbacks', paras: [
        'A role is only the default. A workflow card that names its own model keeps it.',
      ] },
      { id: 'share', title: 'Bring models in, share them out', paras: [
        'Import models… brings in the models a provider or a server offers. Share as plugin… exports your models as a plugin a teammate can install.',
      ] },
    ],
    controls: [
      { label: 'Roles', file: 'ui/public/models/models.html' },
      { label: 'Engines', file: 'ui/public/models/models.html' },
      { label: 'Import models…', file: 'ui/public/models/models.html' },
      { label: 'Share as plugin…', file: 'ui/public/models/models.html' },
    ],
  },

  providers: {
    title: 'How Providers work',
    tour: null,
    steps: [
      { id: 'what', title: 'One connection for many models', paras: [
        'A provider is an account-level connection. Every bridged model that uses it shares that one connection. Providers show at the Expert level.',
      ] },
      { id: 'kinds', title: 'Three kinds of provider', paras: [
        'GitHub Copilot signs in with a device code. OpenAI-compatible and Anthropic-compatible providers take a base URL and an API key instead.',
      ] },
      { id: 'usage', title: 'Usage and models', paras: [
        'On the Copilot card, Sign in… connects the account and Refresh usage shows how much of your allowance is left.',
        'Import models… on a card brings that provider’s models in.',
      ] },
    ],
    controls: [
      { label: 'Sign in…', file: 'ui/public/bridge-view.mjs' },
      { label: 'Refresh usage', file: 'ui/public/bridge-view.mjs' },
      { label: 'Import models…', file: 'ui/public/bridge-view.mjs' },
    ],
  },
};
