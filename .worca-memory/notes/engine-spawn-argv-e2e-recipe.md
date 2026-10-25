---
name: engine-spawn-argv-e2e-recipe
description: How to prove a run option reaches the REAL engine adapter's argv end to end (Orchestrator -> executor -> phases.runOpts -> runClaude -> adapter), and how to giv
paths: test/engine-subagents.test.mjs, test/ui-engine-picker.test.mjs, src/core/graph/executor.mjs, src/shared/engine-switch.mjs
updated: 2026-10-25T13:46:23.646Z
author: Bulibas
---

**Spawn argv end to end, no real engine run.** Keep the orchestrator a mock run (`claude: { mock: true, engine }`: no
preflight, no title spawn, nodes still go through the executor), and set `executor._testing.runClaude`
(src/core/graph/executor.mjs) to a wrapper. On the FIRST call it runs the real
`runClaude({ ...opts, mock: false, bin: <test/fixtures/fake-engine.mjs>, envAllowlist: [...opts.envAllowlist, 'FAKE_OUT', 'FAKE_STREAM'] })`
with `FAKE_OUT`/`FAKE_STREAM` (test/fixtures/engines/<engine>/stream.jsonl) set in process.env, then `o.stop()` and
`return runClaude(opts)`. Read the argv from FAKE_OUT. It costs about 2-6 s per run. Reset the seam to null in a `finally`.
Every wf_default agent node grants Task/Agent, so the first spawn is enough for sub-agent checks. Used for the decision-11
`subagentsOff` tests (codex `--disable multi_agent`, copilot `--excluded-tools=…task`, claude `--disallowedTools Agent,Task`).

**engineLabel ignores setCatalogForTest.** `engineLabel`/`engineOptions` read the deep-frozen `ENGINES`, not the
seam, so you cannot give a test label markup through the catalog. To test app.js's `<option>` rendering, write a temp
`engine-switch-shim.mjs` (`export *` from the real module, plus an `engineOptions` override). Then write a copy of
app.js as `app.mjs` in the same temp dir, with every relative `from`/`import` specifier made absolute and the
engine-switch one pointed at the shim. Boot jsdom with that URL. The shim's own export wins over the star export.

**Claude meets the run gate on its real catalog.** `writeGuardrailSet({ settings: { deny: ['Grep(secrets/**)'] } })` is
refused for Claude (catalog Grep 'unverified', Write 'unenforced'). The refusal hint wording changed in commit 8
("Verify Guardrail Run Flag…"), so assert the lead `…cannot enforce (Grep(secrets/**)) — ` only.
