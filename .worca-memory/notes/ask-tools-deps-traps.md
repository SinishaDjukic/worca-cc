---
name: ask-tools-deps-traps
description: Read before adding or changing an Ask Worca tool (src/core/ask/tools.mjs), especially one that reads settings or live run state.
paths: src/core/ask/**, ui/server.mjs
updated: 2026-10-18T22:40:14.646Z
author: Bulibas
---

Traps that broke a plan's Ask tool design (verified 2026-09-30):

- `src/core/ask/tools.mjs` must stay **import-free**. `test/ask-diff-comment-tools.test.mjs` and
  `test/ask-memory-tools.test.mjs` enforce this. Every reader comes through `deps`, from a `*-deps.mjs` module
  spread in `createAskToolServer` (`mcp-stdio.mjs`). The parent side (turn.mjs, ui/server.mjs) imports the
  validators and apply functions from that same deps module.
- The MCP child (classic mode) cannot see live runs. Live-only readers are passed as `extraDeps` by the relay host
  (`ui/server.mjs` `askAgentRelay`; `readLiveDiff` is the precedent), so each one needs a fallback when absent.
- A pipelines row holds no live orchestrator state (e.g. `state.night`). A paused run keeps
  `resume_point`; `policy_state` is written only for team-policy runs.
- `resolveRow(input, tool)` reads `input.id`, not `runId`. Its errors are `<tool>: id is required` and
  `<tool>: run not found`. A live run's UUID has no row; pass it through as `track_run` does.
- runs-Map entries have `id` (and later `pipelineId`), never `runId`. Use `liveRunEntry(id)`.
- Tool-name order is pinned in several tests (ask-policy-tools:84 contiguous trio, ask-script-tools:59 list
  end). Full name lists exist only in ask-tools (~378), ask-mcp-stdio (~142) and ask-diff-comment-tools (~54);
  ask-memory-tools:50 and ask-model-tools:279 are relative checks and need no edit.
- `createAskTools(deps)` reads `deps.limits.*` while building the defs: a test stub without
  `limits: ASK_LIMITS` (src/core/ask/limits.mjs) throws at construction. Invoke tools with `tools.call(name, input)`.
- The hosting rule (`ASK_HOSTING_RULE`) takes the number after the last numbered rule (23 on 2026-10-07; it was
  20 in September). Adding a numbered rule means renumbering it and editing EVERY pin: `!/\n\s*23\./` at
  test/ask-prompt.test.mjs ~488, ~669; the `'23. Where worca runs'` check ~623; the per-rule table ~466. Grep
  the current number before planning. Extending an EXISTING rule's text (e.g. rule 3 or 15) or an
  always-appended unnumbered section avoids all of them.
- An API test that applies a card writing user settings (`setNightMode`, any settings.json write) must pin
  HOME/USERPROFILE, or it writes the developer's real `~/.worca-cc/settings.json`. ask-api-metrics-cards sets
  only WORCA_HOME; copy test/ask-web-card.test.mjs instead (HOME override + `store.appendMessage` card seeding).
- `setNightMode` / `writeNightModePrefs` merge the patch and clear fields only via `__unset`.
  `validateNightPatch` rejects an `__unset` key, so validate the set-part alone.
- The Away proposal card (`createAwayChangeValidator`, away-proposal.mjs) lists `card.changes` in the `set`
  patch's key order, then the `__unset` fields (`[...Object.keys(clean), ...unset]`). It does NOT sort by field.
  A test that expects alphabetical rows fails on correct code (seen 2026-10-19, Clef plan step 9).
- Memory tool pins (checked 2026-10-16). Any change to these shapes edits each pin:
  - the `onMemoryMutation` poke is deepEqual'd as `{ scope, tool }` at test/ask-events.test.mjs:670 and
    test/ask-turn.test.mjs:1080 (an added `name` key breaks both);
  - `list_memory({})` is deepEqual'd as `{ global, project }` at test/ask-mcp-stdio.test.mjs:172 and
    test/ask-memory-tools.test.mjs:106 and :112;
  - the text `scope must be "global" or "project"` is matched at ask-memory-tools:72 and :114;
  - a REST write's `memory-changed` frame is deepEqual'd as `{ type, scope }` at test/api-memory.test.mjs:129.
- More source scans: tools.mjs must not contain `metrics/(sync|read).mjs`, `outboxDir`, `slugDirName` or `worca-metrics/`
  (test/ask-tools.test.mjs:1035). memory-deps.mjs must import `../memory-store.mjs` and must not import `node:fs`
  (:1027-1028). No test checks the import closure of memory-deps or the MCP child, and the child already loads
  metrics/sync, settings-cascade and db.mjs through metrics-deps.
- memory-deps.mjs loads in BOTH processes: the MCP child (`defaultMemoryDeps`) and the server (turn.mjs
  `refreshAskMemoryMount`; relay mode runs `createAskToolServer` in the server). The child exits when the turn ends, so
  work it schedules in the background (a push, a timer) is lost. ui/server.mjs does not import `listMemory`.
