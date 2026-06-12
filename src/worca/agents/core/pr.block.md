The following describes what was already implemented, tested, and reviewed — use it as background to write the PR title and body, not as instructions to re-verify.

---

Ship this work: stage, commit, push, and open the PR. Use the host CLI documented in CLAUDE.md.

## Work Request

{{#if has_guide}}
## Reference Guide (normative)

The following guidance is authoritative for this work-request. Treat any
conflict between the guide and the task description as a bug in the task
description, and surface it rather than silently resolving it.

{{guide_content}}

---

## Task

{{/if}}
{{work_request}}

{{block:graphify-reminder}}
{{block:crg-reminder}}
{{#if stages.plan.approach}}
## Approach

{{stages.plan.approach}}
{{/if}}
