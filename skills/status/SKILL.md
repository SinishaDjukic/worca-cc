---
description: "Check the status of worca pipeline runs. Use this skill whenever the user asks about pipeline progress, run status, what's happening with worca, or says anything like 'worca status', 'check pipeline', 'how's the run going', 'pipeline progress', 'what stage is it on', 'is the run done', 'any errors'. Also trigger after the user launched a run with /worca-cc:run and wants to check on it."
---

# Check worca pipeline status

You are checking the status of worca pipeline runs and presenting the results clearly.

## Auto-detection logic

Determine which runs to show:

1. **Specific run ID provided** — the user named a run ID. Use `worca status <run-id>`.

2. **Run ID from context** — if the user recently launched a run via `/worca-cc:run` and the run ID is visible in the conversation, use that.

3. **Auto-detect** — no run ID available. Check what's running:

```bash
worca multi-status 2>/dev/null
```

- If one run active → show its details
- If multiple runs active → show the summary list, ask which one to drill into
- If no runs active → tell the user, suggest checking completed runs

## Presenting status

Parse the output and present it clearly:

### For an active run, show:
- **Run ID**
- **Current stage** (e.g. Planner, Coordinator, Implementer, Tester, Reviewer, Guardian)
- **Progress** — which stages completed, which pending
- **Duration** — how long it's been running
- **Errors** — any failures or retries in progress

### For a completed run, show:
- **Run ID**
- **Outcome** — success, failed, or stopped
- **Duration** — total run time
- **PR link** — if a PR was created, show the URL
- **Errors** — if failed, show the failure reason and which stage failed

### For multiple runs, show a summary table:
- Run ID | Status | Current Stage | Duration | Template

## Commands reference

```bash
worca status <run-id>       # detailed status for one run
worca multi-status           # all active runs
```

## Important notes

- This is a one-shot check. Do not poll or loop — just report what you find and return control to the user.
- If `worca` is not on PATH, tell the user to install it (`pip install worca-cc`).
- If no runs are found, let the user know and suggest starting one with `/worca-cc:run`.
