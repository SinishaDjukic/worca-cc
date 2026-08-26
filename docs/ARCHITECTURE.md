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

Deep dives: [Guardrails](guardrails.md) · [Storage](storage.md)

<!--
  The diagram is rendered from the self-contained page docs/architecture.html.
  To regenerate screenshots/architecture.png: serve docs/ (e.g.
  `python3 -m http.server`), open architecture.html in Chromium at a
  2400px-wide viewport with `document.body.style.zoom = 2` and every `.rv`
  element given the `in` class, then take a full-page PNG screenshot.
-->
