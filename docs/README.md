# Worca documentation

Start with the [project README](../README.md) for what Worca is and a quick start.

## Getting started

- [Install](install.md) — npm, requirements, the container image and a hosted setup; running the web UI
- [Getting started](getting-started.md) — the welcome dialog, the Getting started checklist and its spotlight guides
- [UI levels](ui-levels.md) — Simple, Advanced and Expert: what each interface mode shows, and where every element sits
- [CLI](cli.md) — common commands, exit codes and the `/worca` skill for Claude Code
- [Why Worca](why-worca.md) — the eight differentiators, and the use cases each one unlocks
- [Architecture](ARCHITECTURE.md) — the whole stack in one picture, and how Auto picks a run's topology

## Runs and workflows

- [Runs](runs.md) — Auto, the Default workflow, a run's record, pause and resume, worktrees, pull requests and Watch PR
- [Workflows, agents and scripts](workflows.md) — the built-in agents, the workflow editor and composer chat, sharing, and the Presentation, Architecture (C4) and Promo video workflows
- [Scripts](scripts.md) — script cards that run your own program instead of an agent, the Library's Scripts tab, testing a script by itself
- [Run presets](run-presets.md) — a named New run setup you pick instead of filling the form
- [Shaper](shape-it-first.md) — plan a task with Worca before it builds, in Chat, and cut a large one into slices
- [Scheduled runs](scheduled-runs.md) — start a run later, once or on a repeat, from the web UI, the CLI or the API
- [Away mode](away-mode.md) — Worca answers what a run waits on while you are away, and records every answer
- [Keep awake](keep-awake.md) — stop the computer sleeping while a run has agents working

## Projects and workspaces

- [Storage](storage.md) — where state lives, project keys, migration
- [Workspace map](workspace-map.md) — how a workspace scan maps relations, reviewing them, measuring a scan
- [Actions](actions.md) — check out a finished run and run the project's commands from Worca
- [Terminal](terminal.md) — the terminal pane, and Chat's agent mode with a shared terminal

## Chat

- [Chat](chat.md) — Ask Worca: scope, cards you confirm, agent mode, Pinpoint, memory and voice
- [Chat home](chat-home.md) — the composer, quick actions and the tabs Chat opens on
- [Files in the chat](show-files.md) — the files card and its viewer
- [Voice mode](speech.md) — hands-free Chat: Whisper and Kokoro in the browser, or your own speech servers
- [Voice languages](speech-languages.md) — which languages work today, and the plan for more
- [Browser extension](browser-extension.md) — sidebar chat, page context and Pinpoint on web pages; pairing and security model

## Integrations and models

- [Plugins](plugins.md) — plugins and marketplaces, task sources, and two-way chat channels
- [Models](models.md) — engines, the catalog, providers (GitHub Copilot, OpenAI-compatible) and the built-in bridge
- [MCP servers](mcp-servers.md) — Worca's own MCP registry: catalog, sets, copies, secrets, Test
- [Skills](skills.md) — skills in sets: the library, imports, `/<set>:<skill>` names, Team required skills
- [Azure DevOps](azure-devops.md) — Ship-it, clone, sync, merge tracking and the Boards source on `dev.azure.com`
- [Bitbucket](bitbucket.md) — Ship-it, clone, sync, Watch PR and merge tracking on bitbucket.org

## Governance and costs

- [Guardrails](guardrails.md) — per-run policy sets (Permissive, Normal, Strict), enforcement, honest limitations
- [Costs and budgets](costs.md) — cost per run, hard limits and cost tags
- [Statistics](statistics.md) — spend and outcomes by range, person and tag, CSV export and the API
- [Team metrics](team-metrics.md) — git-backed, team-wide records of finished runs on a `worca-metrics` branch ([record format](team-metrics-record-v1.md))
- [Team policy](team-policy.md) — team-set cost caps, allowed models, required plugins, guardrail defaults and MCP servers from a `worca-policy` branch
- [Feature flags](feature-flags.md) — the Labs features, and how to turn them on and off
- [Requirements](requirements.md) — feature specs through a short interview (Labs)
- [Run telemetry](run-telemetry.md) — detailed per-run model and timing statistics (Labs)

## Deployment

- [Worca in a container](docker.md) — Worca and every `claude` it spawns in a disposable Linux container
- [Deploy on Railway](deploy-railway.md) — the container as a hosted service behind Cloudflare Access
- [Remote access](remote-access.md) — opt-in, behind Cloudflare Access, with Worca checking the token
- [Credential broker](credential-broker.md) — model keys stay out of Worca's container behind short-lived tokens
- [Network proxy](network-proxy.md) — Worca behind a corporate proxy that asks for a login
- [Setup assistant](setup-assistant.md) — the server API behind the machine check and setup dialog

## Contributing

- [Contributing](../CONTRIBUTING.md) — developing Worca from source
- [Design system](design-system.md) — how Worca looks; every UI change passes its design gate
- [Architecture (C4) design](architecture-c4.md) — how Worca reads a codebase into a LikeC4 model
- [Releasing](RELEASING.md) — how `@worca/app` versions are published
- [Changelog](changelog/README.md) — the release pages behind docs.worca.dev/changelog
- [Screenshots](screenshots.md) — how the shots in the README and docs are made
