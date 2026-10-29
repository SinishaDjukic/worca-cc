# Plugins

Plugins add task sources, agents, scripts, skills, workflow templates, models, chat channels and MCP servers to Worca.

- **Plugin system with marketplaces** — a plugin is a git repo or folder with a
  `worca-cc-plugin.json`. It can contribute task sources (e.g. GitHub Issues,
  Azure Boards),
  agents (with their ask forms), scripts, skills, workflow templates, models,
  chat channels, and MCP servers for the [registry](mcp-servers.md).
  Install from the **Marketplace** page's Browse tab (Advanced) or `worca plugin install`;
  **Add marketplace** takes a GitHub URL, `owner/repo` or a local path.
  On a machine without git, marketplaces and installs work for GitHub
  repositories over HTTPS, a local plugin folder is linked, and other sources
  say `Needs git`.
  Installing from the UI is an explicit consent ceremony pinned to the commit
  you saw: what's installed, which ask forms an agent can show and which file
  types they may display, which secrets each part requests, where models
  route, which setup commands run. **Update all** reviews every update in one
  sheet — the plugin folder's commits, a diffstat and what changes; an update
  that asks for new access (a new secret, changed setup or model env, a new
  source, channel, agent or model, an MCP server or skill change) waits until
  you tick it as reviewed, and each applies exactly the commit you reviewed
  (`worca plugin update --diff` adds the full diff; `worca plugin purge <name>`
  deletes a removed plugin's leftover settings and secrets). Package your
  own with **Export…** on a saved workflow or **Share as plugin…** on the
  Models page; see the [authoring guide](../.claude/skills/creating-worca-cc-plugins/SKILL.md).
- **Built-in marketplace** — **Worca CC Official**, Worca's GitHub repository on
  its `dev` branch, is registered on every install (nothing is installed until
  you pick it): the GitHub Issues and Azure Boards task sources, the four chat
  channels below, and MCP plugins for Atlassian, Cloudflare, Firebase, Notion
  and Railway. It works without git too (it lives on GitHub). Set
  `WORCA_BUILTIN_MARKETPLACE` to another repo URL or a local checkout to use
  that instead (followed at its HEAD; only committed files count).
- **Tasks from your tracker** — an installed task source adds its button to New
  pipeline › **Task source** (Advanced): search issues or work items, or paste a
  GitHub issue URL or `owner/repo#123`, and the ticket becomes the run's task.
  Each source can close its issue or work item when the run succeeds; Ask
  Worca can find a ticket and propose a run for it. See
  [GitHub Issues](../plugins/github-source/README.md),
  [Azure Boards](azure-devops.md) and [Jira](../plugins/jira-source/README.md).
- **Drive runs from chat** — two-way **Telegram**, **Slack**, **Discord** and
  **Microsoft Teams** channels (Teams needs a public HTTPS endpoint through a
  tunnel; the others dial out). Pick the events that notify — questions and
  approvals, finishes, failures, pauses (cost limits included), Away hours — in
  **Settings › Runs › Chat notifications** (Advanced), and hit **Test**. Answer
  back with commands: `/answer` questions and forms, `/approve` or `/retry` at a
  gate, `/direct` a live run, `/pause`, `/stop`, `/resume`, `/status`, `/cost`,
  `/use <name>`, `/mute 2h`; `/help` lists them all. Commands are
  deny-by-default: only chats on the channel's allowlist may send them. Setup:
  [Telegram](../plugins/telegram-chat/README.md),
  [Slack](../plugins/slack-chat/README.md),
  [Discord](../plugins/discord-chat/README.md),
  [Teams](../plugins/teams-chat/README.md).

