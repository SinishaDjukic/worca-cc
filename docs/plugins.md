# Plugins

Plugins add task sources, agents, scripts, skills, workflow templates, models, chat channels and MCP servers to
Worca.

## Plugins and marketplaces

A plugin is a git repo or a folder with a `worca-cc-plugin.json`. It can contribute:

- task sources, such as GitHub Issues and Azure Boards
- agents, with their ask forms
- scripts, skills and workflow templates
- models
- chat channels
- MCP servers for the [registry](mcp-servers.md)

Install plugins from the **Marketplace** page's Browse tab (Advanced), or with `worca plugin install`. **Add
marketplace** takes a GitHub URL, `owner/repo` or a local path.

On a machine without git, marketplaces and installs still work for GitHub repositories over HTTPS, and a local
plugin folder is linked. Other sources say `Needs git`.

### What you agree to

Installing from the UI asks for your explicit consent first, pinned to the commit you saw. It shows:

- what gets installed
- which ask forms an agent can show, and which file types they may display
- which secrets each part asks for
- where models route
- which setup commands run

**Update all** reviews every update in one sheet: the plugin folder's commits, a diffstat and what changes. An
update that asks for new access waits until you tick it as reviewed. New access means a new secret, changed setup
or model env, a new source, channel, agent or model, or a change to an MCP server or skill. Each update applies
exactly the commit you reviewed.

`worca plugin update --diff` adds the full diff. `worca plugin purge <name>` deletes the settings and secrets a
removed plugin left behind.

To package your own, use **Export…** on a saved workflow or **Share as plugin…** on the Models page. See the
[authoring guide](../.claude/skills/creating-worca-cc-plugins/SKILL.md).

## The built-in marketplace

Every install registers **Worca CC Official**, which is Worca's GitHub repository on its `dev` branch. Nothing from
it is installed until you pick it. It holds:

- the GitHub Issues and Azure Boards task sources
- the four chat channels below
- MCP plugins for Atlassian, Cloudflare, Firebase, Notion and Railway

It works without git too, since it lives on GitHub. To use another marketplace in its place, set
`WORCA_BUILTIN_MARKETPLACE` to a repo URL or a local checkout. Worca follows it at its HEAD, and only committed
files count.

## Tasks from your tracker

An installed task source adds its button to New pipeline › **Task source** (Advanced). Search issues or work items,
or paste a GitHub issue URL or `owner/repo#123`, and the ticket becomes the run's task. Each source can close its
issue or work item when the run succeeds. Ask Worca can also find a ticket and propose a run for it.

See [GitHub Issues](../plugins/github-source/README.md), [Azure Boards](azure-devops.md) and
[Jira](../plugins/jira-source/README.md).

## Drive runs from chat

Two-way channels for **Telegram**, **Slack**, **Discord** and **Microsoft Teams** let you follow and steer runs from
the chat app you already use. Teams needs a public HTTPS endpoint through a tunnel. The others dial out.

In **Settings › Runs › Chat notifications** (Advanced), pick the events that notify you: questions and approvals,
finishes, failures, pauses (cost limits included) and Away hours. Then hit **Test**.

You answer back with commands:

- `/answer` for questions and forms
- `/approve` or `/retry` at a gate
- `/direct` to steer a live run
- `/pause`, `/stop`, `/resume`, `/status` and `/cost`
- `/use <name>` and `/mute 2h`

`/help` lists them all. Commands are deny-by-default: only chats on the channel's allowlist may send them.

Setup: [Telegram](../plugins/telegram-chat/README.md), [Slack](../plugins/slack-chat/README.md),
[Discord](../plugins/discord-chat/README.md), [Teams](../plugins/teams-chat/README.md).
