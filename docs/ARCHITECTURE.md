# Architecture

You talk to Worca, Worca drives the headless Claude Code harness, and the
harness talks to your model — cloud or on-prem. The host is your laptop or a
server. Everything is a plugin.

![The Worca stack — clients on top, the Worca host running @worca/app and the
headless Claude Code harness in the middle, and model endpoints at the
bottom](screenshots/architecture.png)

- **You** reach the same engine four ways: the web UI, the CLI, the `/worca`
  skill inside Claude Code, and two-way chat (Telegram, Slack, Discord,
  Teams) for driving runs remotely.
- **`@worca/app`** is one Node process — interactive (web UI) or headless
  (CLI, skill, chat-driven server). A deterministic engine sequences the
  agents of your workflow; guardrails, costs & budgets, and plugins wrap
  every run.
- **Claude Code harness** — the engine spawns one headless `claude` process
  per agent step, inside the run's own git worktree.
- **Models** — each catalog entry can carry routing env, so the same pipeline
  talks to the Anthropic cloud, a gateway/proxy, an on-prem or dev-machine
  endpoint, or Bedrock/Vertex. See the README's Models section.

### Auto workflow

`wf_auto` is a reserved id, never a row. A run started on it gets a bootstrap
manifest (`auto.status: 'deciding'`), and once the run row and run root exist the
orchestrator's `_decideTopology()` hook runs the decision loop: one classifier
call (`src/core/auto/classify.mjs`) — with a bounded read-only look at a detached
checkout (`Read`/`Grep`/`Glob`, a 6-call prompt budget under a `--max-turns` cap;
the run's own worktree, or a throwaway worktree `src/core/auto/repo-look.mjs` lends
the chat's `propose_workflow`) — whose agent vocabulary is built from
every registry entry's sidecar meta plus the agent file's YAML front matter
(`src/core/frontmatter.mjs` — never the agent body) returns a small *shape*; the
shared assembler (`src/shared/graph/assemble.mjs`) turns it into a validated v2
template (it also owns two scheduler-safety rules: `awaitAll` on a parallel
group's successor and `LOOP_INTO_GROUP`); the matcher (`src/core/auto/match.mjs`)
reuses an exact-topology twin among the Default, the seeds and every saved row
(oldest first); the proposal goes to the user through the ordinary question
channel (`kind: 'workflow'`, kept pending on a malformed answer) unless *human in
the loop* is off; on accept the run adopts the graph (a new row with `origin:
'auto'` when nothing matched) and continues exactly like a saved workflow. A
classifier or assembler failure is rethrown into the shell's failure policy
(`reason: 'error'`); a pause before the decision keeps the decision state in the
resume point, and `resume()` re-enters the loop BEFORE the setup replay.

While the proposal question is open the run row carries a setup-incomplete resume
point with the pending proposal, so a pause, a cost cap or a server restart resumes
into the same proposal without a second classifier call; Accept re-checks for a twin
before saving a row. The recipe guide (`src/core/auto/recipes.mjs`) is an additive
ladder — implementer only, + reviewer, + clarify/planner, + refiner — with the web
test pair, the decomposer and the plan reviewer as signal-gated modifiers.

Deep dives: [Guardrails](guardrails.md) · [Storage](storage.md) · [Scheduled runs](scheduled-runs.md)

<!--
  The diagram is rendered from the self-contained page docs/architecture.html.
  To regenerate screenshots/architecture.png: serve docs/ (e.g.
  `python3 -m http.server`), open architecture.html in Chromium at a
  2400px-wide viewport with `document.body.style.zoom = 2` and every `.rv`
  element given the `in` class, then take a full-page PNG screenshot.
-->
