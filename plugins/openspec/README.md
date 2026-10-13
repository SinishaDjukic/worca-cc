# openspec

Run the [OpenSpec](https://github.com/Fission-AI/OpenSpec) spec-driven workflow through worca:
propose a change (proposal, delta specs, design, tasks), validate it, approve it, apply it task by
task with a verify loop, and archive it into `openspec/specs/`. Encodes the current OPSX layout
(`openspec/config.yaml`) and reads the classic `openspec/project.md` when a repo has one.

## Install

Marketplace → **Worca CC Official** → `openspec` → **Install…** (or `worca plugin install openspec`).
The `openspec` CLI is optional: when it is on PATH the agents use `openspec validate --strict`,
`openspec new change` and `openspec archive --yes`; otherwise they follow the documented format by
hand. Nothing installs it for you.

## Pipelines

| Template | What it does |
|---|---|
| **OpenSpec: Propose** | Clarify → proposal → delta specs → tasks → validate (loops back up to 3 times) → stops with a validated `openspec/changes/<id>/`. |
| **OpenSpec: Full** | Propose as above → **you approve** the change (Request changes sends it back to the proposer) → apply task by task → verify against the spec scenarios (fix loop, up to 3 cycles) → archive. |
| **OpenSpec: Apply existing change** | For a change already in the repo: name its change id in the task. Apply → verify loop → archive. |

In an unattended run (`--yes`, no human in the loop) the approval step auto-approves and says so in
its review. In the same mode an exhausted verify loop is force-continued by the engine, so archive can
run with tasks still open; the archive summary lists them as warnings. For a hard stop, run Full
attended, or run "OpenSpec: Propose" and then "OpenSpec: Apply existing change". Under night mode,
night mode answers the approval form itself unless its `neverDecide` setting lists `questions`.

After three rounds of requested changes, worca asks whether to allow another round or continue.
**Continue applies the change as it stands.** Pick "another" to keep reworking it. A night-mode
setup that must never apply an unapproved change should set `neverDecide` to `["questions", "gate"]`.

## Agents

`openspecProposer`, `openspecSpecWriter`, `openspecTaskPlanner`, `openspecValidator`,
`openspecApproval`, `openspecImplementer`, `openspecVerifier`, `openspecArchiver`. They are on the
Composer palette, so you can build your own OpenSpec flows from them.

## Skills

`ospec-format` (format cheat-sheet and validation checklist) and `ospec-workspace` (layout, CLI
and change-resolution rules) back the agents. `ospec-explore`, `ospec-propose`, `ospec-apply`,
`ospec-verify` and `ospec-archive` are for you: add them to a set on Connectors › Skills and use
them as `/<set>:ospec-propose` and so on in runs and Ask Worca.
