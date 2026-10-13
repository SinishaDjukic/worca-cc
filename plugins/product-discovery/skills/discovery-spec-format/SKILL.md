---
name: discovery-spec-format
description: The format of the final product specification compiled from product discovery — the spec/ files and what each holds, how requirements, business rules and acceptance criteria are written so they are specific and testable, traceability to decisions and workshops, and the consistency checklist a specification must pass before hand-over.
---

# The product specification

The specification lets a development team, or a coding agent, build the product without reading the
discovery conversations. It is compiled from the discovery workspace (`discovery-workspace`) and adds
no behavior that was not confirmed there.

## Files — docs/discovery/<slug>/spec/

| File | Holds |
|---|---|
| `README.md` | purpose, reading order, status (draft / signed off), terminology note, links |
| `01-vision-and-goals.md` | vision, goals, success metrics, stakeholders |
| `02-users-and-roles.md` | user groups, roles, responsibilities |
| `03-journeys.md` | the core journeys step by step, with actors and states |
| `04-functional-requirements.md` | `REQ-###` grouped by capability, each with priority |
| `05-business-rules.md` | business and validation rules (`BR-###`, `VR-###`) |
| `06-permissions.md` | the permission matrix: role × action × object state |
| `07-data-and-content.md` | business objects, attributes, states, lifecycle, retention |
| `08-integrations.md` | external systems, data flow, owners, failure behavior |
| `09-non-functional.md` | security, audit, availability, performance, accessibility, … (`NFR-###`) |
| `10-errors-and-edge-cases.md` | `RISK-###` with the agreed behavior and user-facing messages |
| `11-mvp-scope.md` | MVP, later phases, deferred (`DEF`) and out-of-scope (`OOS`) items |
| `12-acceptance-criteria.md` | acceptance criteria per MVP requirement (`AC-###`) |
| `13-open-items.md` | open questions, unconfirmed assumptions, pending recommendations, with owners |
| `14-constraints.md` | architecture and implementation constraints established in discovery |
| `decision-log.md` | a copy of, or link to, the workspace decision log |

Omit a file only when discovery established nothing for it, and say so in `README.md`.

## Writing requirements

- One behavior per requirement, in active voice: **"The system shall …"** or **"A <role> can …"**.
- Specific and testable: name the actor, the trigger, the object and the observable result. Replace
  "fast", "easy", "flexible" with a measurable target, or move the item to open items.
- Each requirement keeps its discovery id and cites its source: `(DEC-007, W04-Q06)`.
- Priority: `MVP`, `later`, or `tbd` (tbd also appears in `13-open-items.md`).
- Rules are numbered (`BR-###`, `VR-###`) and referenced from the requirements they govern.

## Acceptance criteria

Given / When / Then, one observable outcome each, including at least one failure path for requirements
with validation or permissions:

```markdown
**AC-031** (REQ-012)
- Given a draft with no subject
- When the editor submits it for approval
- Then submission is refused with "Add a subject before submitting" and the draft stays in Draft
```

## Gaps are recorded, never filled

When discovery left something open, the spec says so in `13-open-items.md` and points to it from the
affected section. Never invent behavior to make the document look complete.

## Consistency checklist

- Every `REQ` in the spec is `Confirmed` in the register; nothing proposed or assumed is presented as
  a requirement.
- Every confirmed `DEC` is reflected where it applies; no superseded decision is still applied.
- Every journey step maps to a requirement or an explicit exclusion.
- Every MVP requirement has at least one acceptance criterion.
- Every role in the permission matrix exists in `02-users-and-roles.md`, and every state in it exists
  in `07-data-and-content.md`.
- Every open question, unconfirmed assumption and pending recommendation from the register appears in
  `13-open-items.md` with an owner.
- One term, one meaning: every term matches the glossary.
- No implementation code; constraints only where discovery established them.
