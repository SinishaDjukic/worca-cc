# Pending: Node-graph v2 port of the workflow exporter

These are the test suites for the **Export to Claude Code** feature
(`src/core/workflow-export.mjs`). They are parked here — outside the
`test/*.mjs` run glob — because the exporter has not yet been ported to the
Node-graph **v2** engine.

## Why they don't run

The feature was built against the v1 `resolveWorkflow` engine, which returned a
`{ steps: [[Node]], feedbacks }` plan. The v2 rebase removed that engine; its
successor `resolveGraph` returns a node/wire graph
(`{ template, ports, loops, nodes, wires, agentsByKey, agentKeys }`). The
exporter's plan-walk (`buildExportSet` in `workflow-export.mjs`) still consumes
the old shape, so `buildExportSet` currently throws `NOT_IMPLEMENTED` rather than
emit a broken skill.

`workflow-export-generate.test.mjs` also imports `ui/public/composer-core.mjs`,
which the v2 refactor deleted — its `exportSlugPreview`/`distinctAgents` helpers
need re-homing as part of the UI port.

## What to do

These files are the TDD spec for the port. When re-implementing the plan-walk
against `resolveGraph` (and re-homing the UI helpers), move each file back to
`test/` and make it green. Track: exporter v2 plan-walk rewrite + UI composer
hook port.