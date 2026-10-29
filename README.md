# Worca

[![npm](https://img.shields.io/npm/v/@worca/app)](https://www.npmjs.com/package/@worca/app)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](.nvmrc)

Worca turns a task into reviewed, merge-ready work. You describe the change, and a
deterministic pipeline of coding agents clarifies, plans, implements and reviews it,
looping until the review is clean. Each run works on its own git branch, so your
checkout stays untouched and finished work arrives as a pull request.

Agents run on Claude Code by default, or (beta) on Codex, the GitHub Copilot CLI, Cursor,
Gemini CLI, Goose, OpenCode or Qwen Code. You drive Worca from a web UI, a CLI, a `/worca`
skill inside Claude Code, or a chat on Telegram, Slack, Discord or Teams.

[![Worca architecture diagram: you reach Worca through the web UI, the CLI, the /worca skill or chat on Telegram, Slack, Discord and Teams; the Worca host, a dev machine or a server, runs @worca/app with its engine, agents, workflows, guardrails, costs and budgets, and plugins, and drives N headless Claude Code harnesses that talk to Anthropic Cloud, a gateway or proxy, an air-gapped on-prem or dev-machine endpoint, or Bedrock/Vertex](docs/screenshots/architecture.png)](docs/ARCHITECTURE.md)

## Why Worca

- **The engine decides, the agents do the work.** A state machine walks the workflow
  graph. Agents never choose what runs next, and every step, verdict, cost and file is
  recorded.
- **It asks before it guesses.** A Clarify step turns hidden decisions into a few
  multiple-choice questions, and review loops pause for you when they run out of cycles.
- **Isolated by default.** Every run gets its own worktree and branch, so parallel runs
  never collide and nothing touches your working tree.
- **Bounded.** Cycle caps, cost limits, guardrail policy sets and a team policy keep
  runs inside limits you set.
- **Workflows you can see and change.** The Default workflow is one graph among many:
  draw your own, let Auto pick one per task, or share one as a plugin.
- **Built for a team.** Team metrics and team policy are shared through git branches on
  your own repository, with no extra server.

## Quick start

You need Node.js 22.13 or newer, git, and the [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
CLI signed in (only for real runs; mock mode needs none of it).

```bash
npm install -g @worca/app
```

```bash
worca ui
```

Open `http://localhost:4317`, add a project under **Projects › Add project**, then click
**New pipeline**, describe the task and press **Start run**. Turn on **Mock mode** to run
the whole pipeline offline, with no tokens and no cost.

From a terminal, inside a project:

```bash
worca "Add a /search endpoint with pagination"
```

See [Install](docs/install.md) for npm install scripts, Windows, the container image and a
hosted setup, and [CLI](docs/cli.md) for every command.

## How a run works

The built-in **Default** workflow runs five agents:

1. **Clarify** asks up to 8 multiple-choice questions, or none when the task is clear.
2. **Plan** explores the codebase and writes an implementation plan.
3. **Refine Plan** reviews and rewrites the plan until no critical or major issues remain.
4. **Implementation** follows the approved plan with test-driven development.
5. **Review Implementation** reviews the diff against the plan and sends blocking
   findings back to the implementer.

Each loop has a cycle cap (3 by default). When a loop hits it with blocking findings
left, the run pauses and asks whether to approve another cycle or continue. Only
critical and major findings block. A finished run's work is committed to its own
`worca-cc/…` branch, ready for **Create PR**.

Pick **Auto** instead and one model call classifies the task and assembles a workflow
for it, which you review before it runs. More in [Runs](docs/runs.md).

![A live run, "Webhooks for deal stage changes", waiting at its Clarify step under Needs you: two questions from Clarify, the first with lettered options, a Recommended pick and a field to type your own answer](docs/screenshots/clarify.png)

## Ways to use it

| Surface | What it is | Docs |
|---|---|---|
| Web UI | `worca ui`: runs, workflows, chat, settings | [Getting started](docs/getting-started.md), [UI levels](docs/ui-levels.md) |
| CLI | `worca …`: start, follow, pause, resume and schedule runs, with no server needed | [CLI](docs/cli.md) |
| `/worca` skill | `worca --install <project>`, then `/worca <task>` inside Claude Code | [CLI › skill](docs/cli.md#the-worca-skill-inside-claude-code) |
| Chat channels | Answer questions and steer runs from Telegram, Slack, Discord or Teams | [Plugins](docs/plugins.md) |
| Browser extension | A Worca chat beside the page you are reading | [Browser extension](docs/browser-extension.md) |

## Features

| Area | Feature | Docs |
|---|---|---|
| Runs | Pause and resume across restarts, live view, logs, one-click PRs, Watch PR, run on the source branch | [Runs](docs/runs.md) |
| | Workflow editor, built-in agents, script cards, the composer chat, sharing workflows | [Workflows](docs/workflows.md), [Scripts](docs/scripts.md) |
| | Run presets: save a New run setup and reuse it | [Run presets](docs/run-presets.md) |
| | Shaper: shape a thin or large task before anything is built | [Shaper](docs/shape-it-first.md) |
| | Scheduled runs and run trains | [Scheduled runs](docs/scheduled-runs.md) |
| | Away mode: Worca answers what a run waits on while you are away | [Away mode](docs/away-mode.md) |
| Outputs | Presentation decks, Architecture (C4) models, Promo videos | [Workflows](docs/workflows.md#presentations) |
| Projects | Git repositories, plain folders, or no project; workspaces of related repos with a code-derived map | [Workspace map](docs/workspace-map.md), [Storage](docs/storage.md) |
| | Actions: check out a result and run its dev server or tests; a terminal pane | [Actions](docs/actions.md), [Terminal](docs/terminal.md) |
| Chat | Ask Worca about runs and code; changes become cards you confirm; agent mode, memory, voice | [Chat](docs/chat.md), [Voice](docs/speech.md) |
| Integrations | Plugins and marketplaces, GitHub Issues, Azure Boards, Jira | [Plugins](docs/plugins.md), [Azure DevOps](docs/azure-devops.md), [Bitbucket](docs/bitbucket.md) |
| | Worca's own MCP registry and skill sets | [MCP servers](docs/mcp-servers.md), [Skills](docs/skills.md) |
| Models | Engines, bring your own models, Copilot and OpenAI-compatible providers | [Models](docs/models.md) |
| Governance | Guardrail policy sets (Permissive, Normal, Strict) | [Guardrails](docs/guardrails.md) |
| | Cost per run, Statistics, hard limits, cost tags | [Costs](docs/costs.md), [Statistics](docs/statistics.md) |
| | Team metrics and team policy, shared through git | [Team metrics](docs/team-metrics.md), [Team policy](docs/team-policy.md) |
| | Labs features behind flags | [Feature flags](docs/feature-flags.md) |
| Deployment | Container image, hosted behind Cloudflare Access, credential broker | [Docker](docs/docker.md), [Railway](docs/deploy-railway.md), [Remote access](docs/remote-access.md), [Credential broker](docs/credential-broker.md) |

![A finished run, "CSV export for contacts", on its Diff tab: 4 files changed (+36 −0) in a file tree beside the highlighted patch of src/routes/contacts.js, with the run's worca-cc/ branch, its time and cost, and the Create PR and Publish branch buttons](docs/screenshots/run-detail.png)

## Documentation

Every page is listed in the **[documentation index](docs/README.md)**. Good places to start:

- [Why Worca](docs/why-worca.md): what sets it apart, and the use cases that follow
- [Architecture](docs/ARCHITECTURE.md): the whole stack in one picture, and how Auto picks a workflow
- [Getting started](docs/getting-started.md): the welcome dialog and the first-week checklist
- [Runs](docs/runs.md): everything a run does, from Auto to the pull request

Release notes are at [docs.worca.dev/changelog](https://docs.worca.dev/changelog/).

## Contributing

Bug reports and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
from-source setup, mock mode, the test suite and the PR workflow. Development happens on
the `dev` branch, and PRs target `dev`. Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
