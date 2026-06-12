{{#if stages.plan_review.revision_mode}}
## Revision Required

The plan reviewer has identified issues that must be addressed.
Revise the existing plan — do NOT start from scratch.

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

{{#if plan_content}}
## Current Plan

{{plan_content}}
{{/if}}

{{block:graphify-reminder}}
{{block:crg-reminder}}
{{#if plan_review_issues_formatted}}
## Issues to Address

{{plan_review_issues_formatted}}
{{/if}}

{{#if plan_review_history_formatted}}
## Review History

{{plan_review_history_formatted}}
{{/if}}

Address each issue above. Preserve all parts of the plan that were not flagged.
Write the **complete** updated plan to `{{plan_file|MASTER_PLAN.md}}` — this is a
fresh file, so include every section (both changed and unchanged), not just the
edits. The previous revision is retained separately as audit history.
{{else}}
Create a detailed implementation plan for the following work request.
Start by reading CLAUDE.md for project context (tech stack, build/test commands, conventions).
Then explore the codebase to understand existing architecture.
Write the plan to `{{plan_file|MASTER_PLAN.md}}`.

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
{{/if}}
