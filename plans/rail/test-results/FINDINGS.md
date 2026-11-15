# Stillhet browser test, pass 1: findings and fix proposals

Source: agent files in this folder (a1, a2, a3, a4, a5, a7a, a7b, owner-reports), `plans/rail/findings.md` rows "owner real test (4317)", protocol `plans/rail/test-protocol.md`. Code: `docs/rail-agreed` at a29b53a53; paths below are under `ui/public/stillhet/` unless they start with `ui/` or `src/`. Causes marked ✓ were re-read in the code for this report; the rest are as the agents reported.

Already in flight, not re-proposed here: **#1312** (Create PR demo body "Closes #942"), **#1297** (Chat repaint: keyed per-turn patch, debounce, skip when hidden, orb kept, per-run status read, spend re-read), **#1310** (Timeline in By person).

## 1. Summary

| Agent | Items | OK | Findings (items) | Partial | Blocked | Not tested | Finding rows | crit / major / minor |
|---|---|---|---|---|---|---|---|---|
| a1 Chat core | 28 | 5 | 11 | 2 | 0 | 10 (handed to a2) | 9 | 1 / 5 / 3 |
| a2 Chat cards, RQ | 40 | 10 | 15 | 2 | 0 | 13 | 18 | 0 / 6 / 12 |
| a3 Tasks read | 27 | 8 | 16 | 2 | 1 | 0 | 20 | 0 / 11 / 9 |
| a4 Tasks act, Schedules | 44 | 9 | 11 | 4 | 4 | 16 | 15 | 1 / 9 / 5 |
| a5 Workflows, Marketplace, OB | 38 | 14 | 22 | 0 | 2 | 0 | 20 | 2 / 6 / 12 |
| a6 Projects, Insights | 43 | — | — | — | — | pending | — | — |
| a7a Shell, Pulse, nav | 35 | 15 | 8 | 1 | 5 | 6 | 8 | 0 / 4 / 4 |
| a7b Settings, page map | 46 | 9 | 30 | 7 | 0 | 0 | 20 | 2 / 14 / 4 |
| Owner (4317) | — | — | — | — | — | — | 4 | 1 / 2 / 1 |
| a6 Projects, Insights (added) | 43 | 19 | 18 | 3 | 2 | 1 | 21 | 0 / 11 / 10 |
| **Total** (a1's 10 counted once) | **≈291** | **89** | **131** | **21** | **14** | **36** | **135** (≈120 unique) | **7 / 68 / 60** |

Root causes:
1. **Redraw storm:** every `history-pr` frame redraws the whole conversation, Pulse and `#app` with no debounce → 100% CPU, wiped inputs, vanishing dialogs.
2. **PR lookup token is per page:** another client's batch with the same token overwrites `pr` with null → merged work flips to Ready, false Needs you, Create PR on merged work.
3. **Live reads stop short:** first page only, no `?q=`, no archived, projects from task rows, tickets not filtered, routes checked before data loads.
4. **Run id vs pipeline id:** `run-created` has no `pipelineId`; a page keyed by run id gets no live actions and 404s; stale Paused rows and duplicates.
5. **Saved run fields not mapped:** clarify Q&A, sub-agents, step time/cost/cycle, model, PR base, labels → task page and cards lack what classic shows.
6. **Card/composer state on throw-away objects:** `taskOf()` builds a fresh card per call (Stop confirm lost); composer seeds the model from a reply that has none (Opus max).
7. **Prototype model leaks into live:** Settings sample model, demo PR body, demo plugins and Setup, toggles that only flip local state → demo shown as real and fake success.
8. **No design home:** `#design`, `#profile`, project tabs, Timeline, agent/script authoring, plugin management, Requirements parts.

## 2. Critical findings (and majors that risk data, money or repos)

| Id(s) | Place | What happens | Cause | Status |
|---|---|---|---|---|
| F-a1-01 | Chat composer | Second message of a new Haiku chat goes out as `claude-opus-5-5`/`max`; user silently pays top price | `live/chat-live.mjs:393-397` seeds from a reply with no model; `chat/conversation.js:183-186` falls back to catalog default ✓ | open |
| F-a4-01 | Task page › Create PR | Description filled with demo text incl. "Closes #942"; a real PR would close a real issue | `runs/run-page.js:989` → `runs/run-page-model.js:382-412` demo `prBody` ✓ | in flight #1312 |
| owner 4317 #1 | Task page | Task waits at its review gate ("Needs you · Asks you something") but the page shows no question and no Run another cycle / Accept as is | `live/task-page.mjs` gate not mapped | open |
| F-5-01 = F-7b-11 | Settings › Plugins | Lists Teams, Notion, Jira… as installed when only github-source (B) or nothing (D) is | `settings/settings-model.js:70,681` demo rows | open |
| F-5-02 = F-7b-12 | Settings › General › Setup | Setup assistant shows fixed "Claude Code installed, 6 projects…", Apply refused | `settings/settings-model.js:148-150` | open |
| F-7b-01 | Settings › Labs | Switch flips and toasts "on"; nothing saved; off after reload | `settings/settings.js:273-277` local `setFlag` only ✓ | open |
| F-7b-02 | Settings › Notifications | Badge, Sound, Breathing, Updates pickers change the sentence; nothing saved | `pulse/pulse.js:889-900` local `ui.s` only | open |
| F-3-01 + F-7a-01 | Tasks, Pulse | Merged work reads Ready · Create PR, flips; Pulse "19 need you" vs classic 0 | `live/live-adapter.mjs:108-122` per-page `prToken` ✓; `live/live-map.mjs:431-447` ignores members' `pr` ✓ | open |
| F-a4-06 = F-5-04 | New task / New schedule | Picker lists only projects with tasks; offered a removed project as default and **created a schedule in it** | `centers/centers.js:293` projects from `W.rows()` ✓ | open |
| F-a1-04 | Chat run card ⋯ Stop | Stop does nothing (no confirm, no request); a spending run cannot be stopped there | `chat/conversation.js:120` fresh `liveCard` per call; confirm set at `:502` is lost ✓ | open |
| F-a4-03 (+F-a1-09) | Task page | A running task opened from its row has no Pause and no Stop; 404s on run-id URLs | `runs/run-page-model.js:813` `liveNow` false for a run-id page | open |
| owner 4317 #2 | Task page | Review that ended blocked by a major issue shows a green tick | `live/task-page.mjs` | open |
| owner 4317 #3 + F-3-02 | Task page | Head says "into dev" / "merged into <source branch>"; Changes measured against dev (477 files) | base from `sourceBranch`, not PR base / run base (`live/task-page.mjs`, `live/live-map.mjs`) | open |
| F-7b-04, F-7b-05 | Settings › Spending, Team policy | "Spent this month $0 of $1,000", caps $50/$2,000 that do not exist (real: $6,318.60 this week, no caps) | `settings/settings-model.js:66,360,397`; `pulse/pulse.js:21` | open |

## 3. Root-cause groups

Severity: C critical, M major, m minor. "=" joins the same finding from two agents.

### (a) Live-layer redraw storm — 5 findings (4 unique)

| Id | Finding | Sev | Where |
|---|---|---|---|
| F-a1-02 (+F-a1-10) | Long chat: idle main thread 100%, 25k mutations/10 s, scroll p95 440 ms, 80 s to `hello` | M | `live/live-adapter.mjs:113-122` `onPrs` draws every frame ✓; `chat/conversation.js:881,920,960`; `pulse/pulse.js:754,857`; `components.js:5150` scroll-fade |
| F-a2-06 | Label menu input wiped within 0.6 s | M | repaint; `chat/conversation.js:1567` |
| F-a4-02 | New task / New schedule dialog vanishes in 1–3 s (B 8/8) | M | dialog host is a child of `#app` (`centers/centers.js:318`); `pulse/pulse.js:775` rewrites `#app.innerHTML` each draw ✓ |
| F-a4-10 | Move to group… typed name lost | M | same repaint |

- **Root cause:** `onPrs` redraws on every frame, even when no PR changed. Each draw rewrites the conversation, Pulse (`renderInShell`, `fitMenus`) and `#app` (popover, dialogs, menus) wholesale. The shell's `MutationObserver` re-runs `rewordIn` (`shell/shell.js:386-403`) and scroll-fade re-measures on every one.
- **#1297 covers:** debounce, keyed per-turn patch of the conversation, skip when hidden. That should fix F-a1-02's chat part and likely F-a2-06.
- **Remains:** the `#app` rewrite in `pulse.js:775`, which kills dialogs and menus on every page (F-a4-02, F-a4-10). Also: Pulse re-render and `fitMenus` per draw; `onPrs` drawing when nothing changed; observers re-running on every mutation.
- **Fix:** patch `#app` by part, and only the parts that changed. Host dialogs and open menus outside the repainted node, or keep them across a draw. A shared rule: an open menu or input keeps focus and value across a draw (a component plus a test). `onPrs` draws only on a real change. Re-measure SX-05 after #1297.

### (b) Live data incomplete or wrong — 29 findings

| Id | Finding | Sev | Where |
|---|---|---|---|
| F-a1-03 | Chats bar reads only page 1 (50 of 109); new pinned chats push old ones out ("chats disappear", KF-11) | M | `live/live-adapter.mjs:17` no cursor ✓ |
| F-a2-02 = F-7a-04 | Search matches chat titles only, among the 50 loaded; no `?q=` | M | top bar search (`pulse/pulse.js` ~600–640) |
| F-7b-16 | Search misses classic card names (Network proxy, Machine load, Spawn diagnostics) | m | search index |
| F-3-01 = F-7a-01 | PR state flips and is lost → merged reads Ready, Create PR offered, 19 false Needs you | M (see §2) | `live/live-adapter.mjs:108-122` ✓; `live/live-map.mjs:431-447` ✓; `shell/world.js:163` |
| F-3-18 | `GET /api/pr/checks` on a merged PR → 400, 2 console errors | m | checks read not limited to open PRs |
| F-7a-02 | After Resume: two rows, old one Paused; after Stop: stays Paused 60 s+ and in Needs you | M | `ui/server.mjs:1452-1467` `run-created` has no `pipelineId` ✓; `live/live-adapter.mjs:233-239` `supersede`; saved row not re-read |
| F-7a-03 | A started task appears only at the next `hello` (~20 s) | m | `live/live-adapter.mjs:250` `apply()` |
| F-a4-07 | Archived view "archived 0" (API has 29); no restore after Undo | M | `live/live-map.mjs:383` drops archived ✓; only `/api/history` read |
| F-a4-06 = F-5-04 | Project picker from task rows, not `/api/projects` | M (see §2) | `centers/centers.js:293` ✓ |
| F-a4-05 | Each repeating series listed twice (series + its ticket); the duplicate 404s | M | `live/live-map.mjs:393` no `!t.scheduleId` filter ✓ |
| F-a4-04 | `#schedule/ID` by address or reload → "There is no schedule" | M | `shell/shell.js:268` checks before schedules load; no re-route ✓ |
| F-3-06 | Feature 2/3 shows 2/2; unstarted slice dropped; slice title replaced by the feature's | M | `live/live-map.mjs:435` drops members without a run ✓ |
| F-a4-09 | Group with one done member reads Working | M | group case (`live/task-page.mjs` / `runs/run-page-model.js`) |
| F-a2-03 | Chat: run cards of feature members not drawn at all (no feature total) | M | `live/live-map.mjs:442` fold → `chat-turns` `taskTurn` finds nothing |
| F-3-02, owner #3 | Head shows source branch or "dev" instead of PR / run base; Changes vs dev | M | base from `sourceBranch` |
| F-3-03 | No-remote project reads Ready · Create PR, "Into main" | M | no-remote case not mapped |
| owner #2 | Blocked review shows a green tick | M | `live/task-page.mjs` |
| F-a1-05 | Reload mid-reply: text stops growing until the end | M | resubscribe/catch-up, `live/chat-live.mjs:184-213` |
| F-5-05 | Add a project → "There is no project called …" | M | `live/projects-live.mjs:81` refresh not awaited; `projects/projects.js:378` |
| F-3-10 | "168 tasks · $3496.66 this week" (API: 49 / $2542.31) | m | `centers/centers.js:98` group cost × inWeek |
| F-3-11 | Log times in UTC; steps named `n_plan` | m | `live/task-page.mjs:278-279` |
| F-5-11 | Pin to Chat: home starters not re-read until reload | m | chat-home pins not re-read |
| F-5-15 | Installed plugin shows catalogue sha, not pinned sha | m | `marketplace/marketplace.js` |
| F-5-18 | Marketplace does not refresh on open; catalogue 10 days old | m | `live/market-live.mjs` `firstSync` |

- **Root cause:** the live adapter reads one GET per source and maps only what the first screen needed. It misses paging, query, archived and sibling routes (`/api/projects`, run-group members). Three identity gaps add to it: the PR token, run id vs pipeline id, and schedule vs ticket. Routes are checked before their data arrives.
- **Fix:**
  - Follow the cursor, or read the bar and search from server queries (`?q=`, `?archived=1`).
  - Make the PR token unique per client (random prefix) and take group members' `pr` from `/api/run-groups`. Needs you then follows `src/shared/needs-you.mjs`.
  - Add `pipelineId` to `run-created` and re-read the saved row on `stopped`.
  - Filter tickets with a `scheduleId`. Re-run the route's gone check when the source loads.
  - Map base, no-remote and blocked-review from the saved run.

### (c) Missing information vs classic — 20 findings

| Id | Finding | Sev | Where |
|---|---|---|---|
| F-3-04 | No Q&A anywhere ("No problems or questions"; API has 3) | M | `live/task-page.mjs` `clarify` not mapped |
| F-3-05 | Agents: step keys only; model, skills, tokens "—"; no sub-agents, duration, cost, output | M | `live/task-page.mjs:317-327`, ignores `state.subAgents` |
| F-3-07 | Steps: no time, cycles or cost; 5 unlabeled dots; Cost table one row | M | `state.steps[]` `activeMs`/`costUsd`/`cycle` not mapped |
| F-3-13 | Overview: no start date, started by, engine/model, PR setting, outside-checkout warnings, "to check"; labels/tags hidden behind "+3" | M | `live/task-page.mjs` |
| F-a2-04 | Chat merged card: no cost, time or PR number; stages without time/cost | M | `chat/conversation.js:838` facts need `x.figures` |
| F-3-08 (KF-29) | No label, tag, person or "using workflow" filter | M | Tasks bar filters |
| F-3-09 (KF-19) | Center "by workflow" puts everything under Default | M | `/api/history` has no `workflowId` |
| F-3-15 | Row ⋯ has no View PR | M | Tasks bar row menu |
| F-a4-08 | Schedule page and row: no prompt, no workflow | M | `schedules/schedules.js` |
| F-a2-05 | Answered act cards (route, changes, run-stop, PR, script approval) draw a bare "✓ Done" | M | `live/chat-turns.mjs:66`; `chat/conversation.js:765` |
| F-3-14 | Bar rows: state, project, date only in tooltip; no cost, labels, PR | m | Tasks bar row |
| F-a1-08 | Proposal card: no model or branch; Customise fields empty | m | `chat/conversation.js` TaskProposal |
| F-a2-09 | Actions proposal: no op word; **safety line missing** ("runs only when a person clicks Start") | m | `live/chat-turns.mjs` `change()` |
| F-a2-10 | Ship card: "Requirements 0/0"; no runs/files/lines/reason; raw PR URL | m | `live/chat-turns.mjs:124`; `chat/conversation.js:731` |
| F-a2-11 | PR card: no base, no change size | m | `live/chat-turns.mjs:107-118` |
| F-a2-07 | PR refs not chips (run refs are) | m | Prose ref drawing for `gh:` |
| F-a2-08 | No unread dot when a reply lands in another chat | m | `live/live-adapter.mjs:269` tracks it; `chat/chats-column.js:66` does not draw |
| F-3-12 | Artifacts: 3 missing, raw execution ids, viewer lacks Previous/Next and Open full | m | `runs/run-page.js:242` |
| F-a4-14 | New task form: no guardrails, draft PR, slice PR choice | m | `centers/centers.js:263-271` |
| F-5-10 | Workflow story shows only `loops[0]`; "1 steps", "up to 1 times" | m | `workflows/workflows.js:86-93` |

Also seen, not filed: the Schedule Activity feed (classic `#schedules/activity`) has no place (SC-03, partial).

- **Root cause:** the live task page and cards map the run summary, not the saved run's detail (`clarify`, `subAgents`, `steps[]`), and `/api/history` lacks `workflowId`. Act cards drop their outcome when answered.
- **Fix:** a field-by-field mapping of the saved run onto the prototype's existing parts (Decisions, Agents, stage/step facts, metadata line, TaskCard Figures). Add `workflowId` to `/api/history` rows. Answered cards keep title and outcome. Keep each card's own footnote (safety line).

### (d) Wrong wiring / dead or fake actions — 19 findings

| Id | Finding | Sev | Where |
|---|---|---|---|
| F-a1-01 | Composer switches the chat to Opus max after the first send | C | `live/chat-live.mjs:393-397`; `chat/conversation.js:183-186` ✓ |
| F-7b-01 | Labs switch: fake success, nothing saved | C | `settings/settings.js:273-277` ✓ |
| F-7b-02 | Notifications pickers: fake success | C | `pulse/pulse.js:889-900` |
| owner #1 | Review gate: no question, no Run another cycle / Accept as is | C | `live/task-page.mjs` |
| F-a4-01 | PR dialog demo body "Closes #942" | C | `runs/run-page.js:989` ✓ — **#1312** |
| F-a1-04 | Run card ⋯ Stop does nothing | M | `chat/conversation.js:120,502` ✓ |
| F-a4-03 + F-a1-09 | Running task page by run id: no Pause/Stop; 404s on `/api/runs/<runId>/…` | M / m | `runs/run-page-model.js:813`; `live/task-live.mjs` |
| F-a2-01 | Send while streaming → 409 "turn in flight", silently dropped (classic queues) | M | composer send, `live/chat-live.mjs` `send` |
| F-5-08 | Edit a copy by hand saves at once; a second copy → 409 | M | `workflows/workflows.js:274`; `live/workflow-live.mjs:17` |
| F-a4-11 | Restart Build offered without a plan → 409 NO_PLAN | m | ▾ menu |
| F-a4-12 | PR failure says "Nothing changed" after the branch was pushed | m | PR dialog |
| F-5-09 | Delete with Undo lost on reload in the 5 s window (workflows, agents, scripts, sources) | m | `live/workflow-live.mjs:172-184`; `live/market-live.mjs:244` |
| F-5-13 | Built-in agent/script ⋯ opens an empty menu | m | `workflows/workflows.js:124` |
| F-5-14 | Run all enabled with 0 saved cases | m | scripts page |
| F-5-19 | Open in Workflows for a deleted workflow | m | `runs/run-page.js:340` |
| F-7a-05 | Pulse opened by `#activity` stays open over every later page | m | `shell/shell.js:283` |
| F-7b-14, F-7b-15, F-3-17 | `#settings/tags` Not found; `#settings/guardrails/ID` and `#history/…/details/logs` land at the top | m | `shell/old-addresses.js:17-23`; `settings/settings.js` |
| F-a2-17 | Gone chat still posts `mcp-preview` twice (404s) | m | composer MCP preview |

- **Root cause:**
  - Card and composer state lives on objects rebuilt on each paint. The composer fallback picks the catalog default.
  - The task page's live actions key on `pipelineId`.
  - The prototype's local-only handlers were not swapped for refusals or wires.
  - Actions are offered without checking that they can work (plan, cases, workflow exists).
- **Fix:**
  - Keep `confirm`/`form` in a per-id store, not on `liveCard(t)`.
  - Seed a new chat's model from the composer's own pick.
  - Key the task page by run id until `pipelineId` arrives; this depends on (b)'s `run-created` fix.
  - Wire Labs to `PATCH /api/flags` and Notifications to `chat.notify`, or refuse them.
  - Queue a send while streaming, or say it was not sent.
  - Copy by hand stays a draft until Save.
  - Flush deferred deletes on `pagehide`.
  - Disable with a reason where an action cannot work.

### (e) Confusing interface (wording, state mismatch) — 14 findings

| Id | Finding | Sev | Where |
|---|---|---|---|
| F-a1-06 | User's own text and run titles reworded ("run" → "task", "Run 7" → "Stop Task 7") | m | `shell/shell.js:386-390` `rewordIn`; `SKIP` lacks chat turns ✓ |
| F-7a-06 | Own pause reads "Paused on error" | m | `live/live-map.mjs:316` |
| owner #4 | Open review-gate decision listed under Plan | m | `live/task-page.mjs` |
| F-a2-15 | Head "No project" while composer says worka-cc | m | head reads `scope`, composer `context` |
| F-a2-16 | Worktree row shows raw project key | m | conversation head |
| F-a2-12 | "Direction Direction: …" | m | `live/chat-turns.mjs:62,132` |
| F-a2-13 (KF-17) | Scope-switch lists full path; "Switched to" twice | m | `live/chat-turns.mjs:46` |
| F-a2-14 (KF-16) | Metrics/policy rows raw `Change: kind` (code only) | m | `live/chat-turns.mjs:58-59` |
| F-7a-08 | ⌘J on Projects asks about project "Your projects" | m | `shell/shell.js:93-104` |
| F-3-16 | Ready center card joins two tasks with ";"; buttons carry full titles | m | `centers/centers.js` (prototype: one line per task) |
| F-3-19, F-a4-13 | "1 files", "1 PRs" | m | `runs/run-page.js:253`; group page |
| F-5-16 | Both Jira fields named "Token" | m | `marketplace/marketplace.js:125` |
| F-5-12 | Team / For you empty states give no reason; For you lists every built-in | m | `workflows/workflows.js:51,116` |
| F-a4-15 | One-off schedule: time picker only, no date | m | schedule page |

- **Fix:** one wording sweep. `rewordIn` skips chat turns and Prose (user text is never reworded); plural rule from the library; pause reasons by kind.

### (f) Missing functions and pages — 13 findings

| Id | Finding | Sev | Where |
|---|---|---|---|
| F-a1-07 = KF-29 | No workflow (or Sets) picker in composer Task/Schedule modes | M | `chat/conversation.js:201-206` |
| F-5-06 | No New agent/script, Duplicate, prompt or source text, script test bench, cases | M | `workflows/workflows.js`; `live/workflow-live.mjs` |
| F-5-07 | Plugin set-up asks required fields only; no full settings, Test connection, health, enable/disable | M | `live/market-map.mjs:115` |
| F-5-03 | No newcomer path live (no Getting started, no mode choice) | M | `shell/world.js:9`; `chat/conversation.js:95-96` |
| F-7b-17 | Project tabs (Settings, Sets, Actions, Automations, Away, Team, Memory) all land on overview | M | wave 3 slice 12 not built |
| F-7a-07 = F-7b-18, F-7b-19 | `#design`, `#profile` Not found | M | `shell/old-addresses.js`; `shell/shell.js:20` |
| F-7b-20 (KF-24) | Team metrics Timeline has no home | M | **#1310** |
| F-5-17 | No purge, no orphaned plugin data view | m | `marketplace/marketplace.js:105` |
| F-5-20 | Export to a marketplace / skill to a project has no home | m | `live/workflow-live.mjs:200` |
| F-a2-18 | Requirements RQ-03: no product brief, Files, Code look, Start before Ready, weekly spend, model picker, New feature | m (owner) | prototype `requirements/requirements.js` |
| F-3-20 | No mock choice; mock runs not marked | m (owner) | `live/chat-live.mjs:50` |

- **Root cause:** places with no design yet (wave 3, owner decisions) or functions the prototype browses but never authors.
- **Fix:** design first for each (§5), then build. Interim: each missing place says "not in Stillhet yet" and links the classic page, as Requirements already does.

### (g) Wave-3 Settings sample data — 11 findings (+ F-7b-01/02 in (d))

| Id | Finding | Sev |
|---|---|---|
| F-7b-03 | Every Settings row except Prompt check, Pulse icon and Labs states is sample, unmarked; same on empty D | M |
| F-7b-04 | Spending "$0 of $1,000 a month" vs $6,318.60 this week, no caps | M |
| F-7b-05 | Team policy "acme" sample; Copy for PR unreachable | M |
| F-7b-06 | Labs: wrong flag set; Run telemetry "Locked" (it is not); no `rail`/`design` rows | M |
| F-7b-07 | About: links refused; version "1.19 Up to date"; offers "1.20, the latest" | M |
| F-7b-08 | Models sign-ins and catalogue: the opposite of classic | M |
| F-7b-10 (KF-28) | Connectors, Guardrails, Memory, Presets, Labels: samples | M |
| F-5-01 = F-7b-11 | Plugins: demo installed rows | C |
| F-5-02 = F-7b-12 | Setup assistant demo | C |
| F-7b-13 | Away hours, capacity 3, editor/terminal, corp proxy: samples | M |
| F-7b-09 | Chat history row "38 chats" until Delete all is pressed; D shows nothing | m |

- **Row-by-row status:** `a7b-settings-pagemap.md` § "Wave 3 checklist: every Settings row on B/D". 3 rows live, about 55 sample (14 equal to today's default by chance), 2 fake.
- **Root cause:** Settings draws `settings/settings-model.js` on purpose (wave 3 not built), but never says so.
- **Fix:** stop-gap P4 below; the real build is wave 3.

### (h) Classic bugs found on the way — 4

| Where | Finding |
|---|---|
| A `#chat/ask_28fd685f` | Legacy `spec`/`spec-questions` cards throw `Cannot read properties of undefined (reading 'filter')`; only the title draws (B handles it) |
| A Runs under GraphQL quota | Merged rows turn into "Ready to ship" when the PR lookup fails |
| A Workflows › Scripts | Tab count 13 vs API 18 (leaves out the `shared` domain) |
| C Marketplace first open | "0 plugins in 1 marketplace" for 6 s+ while the refresh runs |

Test environment, not product: P on :4420 serves `worka-cc-rail-agreed`, whose generated `stillhet/components.js` is stale (`R.watchStillhetSwitch is not a function`). Agents served `worka-cc-test` instead.

### Projects, Workspaces, Insights (a6) — 21 findings

Coverage: 43 items · 19 OK · 18 with findings · 2 blocked (PJ-16, IN-09) · 4 partial/not tested. Full file: `a6-projects-insights.md`.

**Insights figures vs classic:** Spend, Saved, finished/stopped/failed, PRs merged/opened, Throughput, Shaping, project filter equal the API on every range; Team pages equal classic Team metrics (month $10,926.83 … all $51,389.40).

| Id | Finding | Sev | Group / where |
|---|---|---|---|
| F-6-01 | Projects inline fields (Add by hand, Rename, Locate, Make a workspace) wipe typed text every ~0.4 s on B | M | (a) redraw; `projects/projects.js:189,283` |
| F-6-02 (= F-5-05) | Locate folder / Add by hand land on "There is no project called …" until reload; 404s on old key | M | (b) `live/projects-live.mjs:81` |
| F-6-03 | Git project with no remote reads "Up to date", never offers Link a remote | M | (b) `live/live-map.mjs:241` maps `unknown`→ok, ignores `remote:null` |
| F-6-04 | Hand-made workspace can never be scanned (428 SCAN_MODEL_REQUIRED, no scan-model picker); no path/.code-workspace import | M | (f) |
| F-6-05 | Reload/shared link of a workspace page lands on `#projects` | M | (b) route check before load |
| F-6-06, F-6-07 | Project tabs (Memory, Sets, Actions, Away, Settings) and workspace tabs (Team, Actions, Automations) have no home | M | (f) = F-7b-17, D3 |
| F-6-08 | Insights Per task "$258.39 a task" divides ALL spend incl. Chat ($23,598) by 107 tasks; tasks only = $37.85 | M | (b) Insights per-task figure |
| F-6-09 | Missing classic figures: Chat sessions/turns, $ per session, Naming, Requirements, Time worked; cost/run, duration, Autonomy, Review cycles, Off-policy, By ticket | M | (c) / Insights measures run |
| F-6-15 | Project page lacks readiness, Metrics/Policy column, done/stopped split, last run; head says 5 need you, bar says 19 | M | (c) + (b) PR state |
| F-6-20, F-6-21 | KF-24 Timeline (#1310), KF-25 team-metrics enable/Push/Check | M | (f) |
| F-6-10…F-6-19 | Minors: "7 people" vs 9, hours unformatted, How tasks end headline outside this month, others | m | (e) |

Risk: Projects center and project page offer **Create PR on the real worka-cc for already-merged features** (PR-state finding, P3). #1312 removes the demo body; P3 removes the wrong offer.


### (i) Isolation and safety (found during testing)

| Id | Finding | Sev | Where |
|---|---|---|---|
| F-X-01 | `settings.json` is read and written at `$HOME/.worca-cc`, not under `WORCA_HOME`, so an instance started with its own `WORCA_HOME` shares (and changes) the real user's settings; the test copies changed `chat.promptCheck`, `chatHomePins`, `nightModeHereSince` and possibly `flags.rail` | M | `src/core/settings.mjs:85-91` `defaultRoot()` uses `HOME` |
| F-X-02 | Many Worca instances on one token exhaust the GitHub GraphQL quota (each re-asks PR status for every run; caches are per process) | M | `src/core/metrics/prs.mjs` |

## 4. Proposals: fix runs to dispatch

| # | Title | Scope | Why this order | Depends on | Size | Design first | Owner decisions |
|---|---|---|---|---|---|---|---|
| P1 | **Stop the wrong writes** | F-a1-01, F-a1-04, F-a4-03 + F-a1-09, F-a4-06 = F-5-04, F-a2-01, F-5-08 | Money, wrong project, uncontrollable runs | After #1297 merges (same `conversation.js`, `chat-live.mjs`) | M | Queued-send state in the composer (add the "Sends when the reply finishes" line) | D7, D8 |
| P2 | **Task page truth: gate, review, base** | owner #1–#4, F-3-02, F-3-03, F-a4-09, F-a4-11 | The owner's feature 2 final check; a blocked review reads as passed | Can run in parallel with P1 (`live/task-page.mjs`) | M | Check `run-page.html` has the review-gate case with both actions and the no-remote case; add if missing | — |
| P3 | **PR state and Needs you** | F-3-01 = F-7a-01, F-3-18, F-3-06, F-a2-03, F-7a-02, F-7a-03, F-7a-06 | False Needs you and Create PR on merged work; stale Paused | After #1297 (`live-adapter.mjs` draw path); server change for `run-created.pipelineId` | M | — | — |
| P4 | **Settings stop-gap until wave 3** | (g) all, F-7b-01, F-7b-02, F-5-01, F-5-02 | Demo shown as real to every Stillhet user | None | S | One rule + component: a "not in Stillhet yet" row (the Requirements notice pattern) with "Open in classic" | D6 |
| P5 | **Redraw storm: what #1297 leaves** | (a): F-a4-02, F-a4-10, remaining CPU from Pulse/`#app`/observers | New task/New schedule dialogs unusable on B; menus lose input | After #1297; re-measure SX-05 first | M | Library rule: an open menu/input/dialog survives a draw (component + test) | — |
| P6 | **Live reads complete** | F-a1-03, F-a2-02 = F-7a-04, F-7b-16, F-a4-07, F-a4-05, F-a4-04, F-a1-05, F-5-05, F-5-11, F-5-18, F-5-15, F-3-10, F-3-11 | Chats "disappear", search, archive, schedules | After P3 (same adapter) | M–L | — | — |
| P7 | **Task information parity (KF-01/KF-02)** | (c) task part: F-3-04, -05, -07, -13, -14, -15, -08, -09, -12, F-a4-08, F-a4-14 | Owner's area 1–2; largest gap vs classic | After P2 (same file); `/api/history` `workflowId` | L | Label/tag chips on rows; label, person and workflow filters; Agents table with sub-agents; check against `run-page.html` | D4 |
| P8 | **Chat cards parity** | (c) chat part: F-a2-04, -05, -07, -08, -09, -10, -11, F-a1-08; (e) chat part: F-a1-06, F-a2-12, -13, -14, -15, -16 | Answered cards say nothing; user text reworded | After #1297 | M | — | — |
| P9 | **Workflows and Marketplace gaps** | F-5-06, F-5-07, F-5-17, F-5-20, F-5-09, F-5-13, F-5-14, F-5-19, F-5-10, F-5-16, F-5-12 | Functions classic has; lower risk | After P1 (F-5-08 there) | L | Agent/script authoring; plugin manage sheet; export targets | D9, D10, D11 |
| P10 | **Wording and nav minors** | F-7a-05, F-7a-08, F-7b-14, F-7b-15, F-3-17, F-3-16, F-3-19, F-a4-13, F-a4-12, F-a4-15, F-a2-17 | Small, independent | Any time | S | — | — |
| P11 | **Second test pass** | see below | Covers what pass 1 could not | After P1–P5 and #1297, #1312 | M | — | — |

**Before feature 2 goes to dev:** #1312 and #1297 merged, then P1, P2, P3 and P4. P5 too if #1297's re-measure still shows dialogs vanishing (F-a4-02). Re-test the critical rows in §2 on B and D.

**Settings stop-gap (P4):**
- Every row whose status is "sample" in the a7b checklist reads "Not in Stillhet yet" (no value) and offers Open in classic.
- Live rows stay: Prompt check, Pulse icon, Delete all chats, Labs read.
- Labs switches write `PATCH /api/flags` (classic's call), or are disabled with that line.
- Notifications pickers are disabled with that line until wired.
- Plugins lists only `/api/plugins`.
- Setup assistant and Getting started › Show again are hidden or read "Not in Stillhet yet".
- A test fails any Settings row that draws a model value on a live instance.

**Second test pass (P11) needs:**
- an instance where `rail` is not locked by `WORCA_FLAGS` (NV-14, NV-15, SX-04, OB-08)
- a GitHub token with quota, or a quiet hour (TK-21, TK-22, TK-37, CH-24 Create PR, CH-18, CH-19 PR fields)
- an instance with `serverMock: true` and a higher run cap (SC-05, SC-06, SX-11)
- leave to restart an instance's server for the WebSocket drop (NV-18)
- a fresh `stillhet/components.js` for P on :4420
- state fixtures: a question card (CH-15, TK-15), plan approval (CH-20, TK-16), cost cap (TK-18), base moved (TK-26), kept work (TK-27), failure (TK-28), a plugin update that asks for new fields (MK-09)
- owner by hand: microphone (CH-38)

Items to cover:
- Not tested: CH-00, CH-06, CH-11, CH-22, CH-28, CH-35, CH-36, CH-39, CH-41, RQ-02; TK-24, TK-25, TK-29, TK-30, TK-31, TK-34; SC-04, SC-14, SC-16, SC-17; NV-07, NV-08, NV-19, NV-21, NV-22, NV-23.
- Partial: CH-01, CH-07, CH-10 (engine), CH-12 (on), CH-18, CH-23; TK-00, TK-20, TK-46; SC-03, SC-11, SX-06; NV-00; SE-00, SE-12, SE-14, SE-15, SE-16.
- Blocked: TK-09 (no sessions in data).
- Not done: the prototype (P) comparison for Chat and Schedules; a6 if it does not land.
- Also re-run every §2 row and SX-05/SX-10 after the fixes.

## 5. Owner decisions

| # | Decision | From |
|---|---|---|
| D1 | `#design` and `#profile` (Worca levels): a home in Stillhet, or retire them | F-7a-07, F-7b-18, F-7b-19 |
| D2 | Requirements: which classic parts get a place (product brief, Files, Code look, Start before Ready, weekly spend, model picker, New feature) | F-a2-18 (RQ-03) |
| D3 | Project tabs' home: Settings › Projects (slice 12) or the project page (sync/naming overrides, MCP Sets, Actions, Automations, Away, Team, team-metrics enable) | F-7b-17, PJ-12, PJ-22, KF-25 |
| D4 | Workflow picker place: composer sentence or the proposal's "Select workflow"; and the "using workflow" filter | F-a1-07, F-3-08 (KF-29) |
| D5 | Mock option in Stillhet: offer a mock choice and a mock mark, or classic only | F-3-20 (TK-47) |
| D6 | Settings stop-gap form: plain "Not in Stillhet yet", or with Open in classic | P4 |
| D7 | Send while a reply streams: queue as classic, or refuse with a line | F-a2-01 |
| D8 | Edit a copy by hand: a draft until Save (prototype), confirm | F-5-08 |
| D9 | Authoring agents and scripts (New, Duplicate, source, test bench, cases): on the Workflows page, or in chat only | F-5-06 |
| D10 | Plugin management (all settings, Test connection, health, enable/disable, purge): Marketplace page or Settings › Plugins | F-5-07, F-5-17 |
| D11 | Export into a marketplace, skill to a project: keep, or drop | F-5-20 (MK-11) |
| D12 | Schedule Activity feed (classic `#schedules/activity`): Pulse, or the Schedules page | SC-03 |
| D13 | Newcomer path live before wave 3 (Getting started, mode choice), or wait | F-5-03 |
| D14 | Team / For you ways with nothing live: hide, or say why | F-5-12 |
| D15 | One-off schedule: add a date picker | F-a4-15 |
