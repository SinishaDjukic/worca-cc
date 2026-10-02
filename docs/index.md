---
layout: home
title: Worca docs
titleTemplate: false

hero:
  name: Worca
  text: Documentation
  tagline: A deterministic multi-agent pipeline that drives Claude Code through Plan → Refine → Implement → Review, each run in its own git worktree and branch.
  actions:
    - theme: brand
      text: How it works
      link: /architecture
    - theme: alt
      text: What's new
      link: /changelog/latest/
      target: _self
    - theme: alt
      text: GitHub
      link: https://github.com/SinishaDjukic/worca-cc

features:
  - title: Architecture
    details: Clients, the engine, the headless Claude Code harness and model endpoints, and how a run flows through them.
    link: /architecture
  - title: Guardrails
    details: What a run may and may not do, how the limits are enforced at the harness, and where the known gaps are.
    link: /guardrails
  - title: Models
    details: The catalog, providers (GitHub Copilot, OpenAI-compatible) and the built-in bridge.
    link: /models
  - title: MCP servers
    details: Worca's own MCP registry, with catalog, sets, copies, secrets and Test.
    link: /mcp-servers
  - title: Team policy
    details: Team-set cost caps, plugins, models and guardrails from a worca-policy branch.
    link: /team-policy
  - title: Deploy
    details: The container as a hosted service on Railway, behind Cloudflare Access.
    link: /deploy-railway
---

## Install

Worca needs Node 22.13 or newer, and Claude Code for real runs.

```bash
npm install -g @worca/app
worca ui    # the web UI, on http://localhost:4317
```

The [README](https://github.com/SinishaDjukic/worca-cc#readme) has the feature tour and the CLI and Claude Code skill quick starts.
