---
title: Add your project
description: Register a project in the dashboard and configure it with the setup wizard.
sidebar:
  order: 3
---

You add projects from the dashboard. Adding a single project **registers** it and then opens the **Project Setup** wizard, which installs worca into the project and walks you through its initial configuration.

## Steps

1. In the sidebar, click the **+** button next to the project picker.
2. Choose **Single project** (one repository) or **Multiple projects** (scan a parent folder and register several repositories at once).
3. Enter the path — the **Project Path** for a single repo, or the **Parent Path** to scan for repositories when adding multiple. The dialog validates it and, in single mode, generates a name.
4. Confirm. worca registers the project.

![The Add Project dialog: Single project / Multiple projects options with a project path filled in and the name auto-generated from the last path segment.](/screenshots/add-project/01-dialog.png)

## The setup wizard

After you add a single project, the **Project Setup** wizard opens automatically. It checks your environment and walks you through the essentials. Every step is skippable, and you can re-open the wizard at any time from **Settings → Projects** (the gear icon on a project's row).

1. **Your project environment** — a read-only preflight: git repository, the detected PR base branch, and whether Graphify and Code Review Graph are installed.
2. **Install Worca** — shown only when the project doesn't have the worca runtime yet. Click **Install Worca** to run `worca init --upgrade`, which scaffolds the pipeline into `.claude/worca/` (it creates `.claude/` if needed and preserves any existing settings). This step requires a git repository.
3. **Set PR base branch** — confirm or change the branch new pull requests target (detected from the git remote).
4. **Enable optional tools** — turn on [Graphify](/advanced/knowledge-graph/) and/or [Code Review Graph](/advanced/code-review-graph/) when they're installed.
5. **Set default template** — optionally pin a default [pipeline template](/configuration/pipeline-templates/) for the project.

![The Project Setup wizard's first step — the environment preflight, listing git, worca runtime, PR base branch, Graphify, and CRG.](/screenshots/add-project/02-setup-wizard.png)

:::tip
The `worca` CLI must be on your PATH (from `pip install worca-cc`) — the dashboard calls it to install worca into your project.
:::

## Multiple projects vs. workspaces

**Multiple projects** in the Add Project dialog simply registers several repositories at once — each becomes an independent project in the dashboard. It does **not** create a workspace.

A **workspace** is a separate concept: a parent folder with a `workspace.json` that declares dependencies between repositories, enabling [workspace runs](/introduction/choosing-a-run-mode/) where one prompt is coordinated across them in dependency order. Create one with `worca workspace init` or from the **Workspaces** page.

Next: [run your first pipeline](/getting-started/your-first-run/).
