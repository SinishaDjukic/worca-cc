---
name: pipeline-agent-write-lockdown
description: Read before locking down a pipeline agent (no shell / untrusted input): its Write reaches every path unless Edit-denied, and dontAsk cannot be used.
paths: src/core/graph/executor.mjs, src/core/graph/agent-lockdown.mjs, src/core/phases.mjs
updated: 2026-10-25T18:30:21.739Z
author: Bulibas
---

A pipeline agent's `--allowedTools Write` (phases.mjs runOpts, from `toolsForMeta`) approves a write to ANY path, and
`--add-dir` carries the run's writable memory copy. Denying Bash/WebFetch and secret Reads is not a lockdown: an agent
that reads untrusted text (a fetched brand guide) can still plant `~/.worca-cc/scripts` code, a `~/.zshrc` line, a
`.git/hooks` or `.claude/settings.json` hook, project code a later step runs, or a memory note.

How to apply:
- Add `Edit(...)` denies (an Edit rule covers Write; `//` = absolute) for host code, shell start files, PATH folders,
  `.claude/`, `.git/`, plus the spawn's own `opts.cwd` and memory dir as absolute rules; clear `addDirs`; set
  `settingSources: ['project']` and `disableSlashCommands: true` (what Ask and the night decider do).
- Do NOT reach for a write allow-list under `permissionMode: 'dontAsk'`: the mock runner routes every dontAsk spawn to
  the Ask mock and the run harness refuses dontAsk on a mock pipeline (run-harness.mjs:895-901), so golden runs die.
- The argv snapshot scrubs the project dir to `<PROJECT_DIR>`, so a cwd-based rule stays deterministic.
