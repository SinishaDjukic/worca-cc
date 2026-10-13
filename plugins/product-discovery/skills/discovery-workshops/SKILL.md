---
name: discovery-workshops
description: The default ten-workshop product discovery plan — each workshop's objective, scope, expected outcome, question areas and completion criteria, from product vision through MVP scope and acceptance criteria — plus how to tailor the plan to a product and how a single workshop is run.
---

# The ten discovery workshops

The plan runs from the product's purpose to the detail an implementation needs. Each workshop builds
on the decisions of the earlier ones; a later workshop never silently contradicts an earlier one.

## Default plan

### 1. Vision, goals and success
- **Objective:** why the product exists and how success is measured.
- **Scope:** problem statement, business goals, target outcomes, success metrics, stakeholders,
  constraints (budget, deadline, regulation), reference products to compare with.
- **Expected outcome:** a one-paragraph vision, 3–5 goals each with a measurable success metric, the
  sponsor and decision makers.
- **Complete when:** the problem, the goals and at least one measurable metric per goal are confirmed;
  the decision makers are known.

### 2. Users, stakeholders and roles
- **Objective:** who uses or is affected by the product, and what each is responsible for.
- **Scope:** user groups, personas, frequency of use, skill level, responsibilities, stakeholders who do
  not use it, initial role list and responsibility boundaries.
- **Expected outcome:** a confirmed list of user groups and roles with responsibilities and needs.
- **Complete when:** every role has a responsibility statement and an owner who can confirm it.

### 3. Current process and pain points
- **Objective:** how the work is done today and what goes wrong.
- **Scope:** as-is process step by step, tools in use, hand-offs, volumes, delays, errors,
  workarounds, what must not get worse, existing users' habits (learning curve).
- **Expected outcome:** an as-is process description and a ranked list of pain points tied to goals.
- **Complete when:** the main as-is flow is described end to end and each goal links to a pain point.

### 4. Core journeys and workflows
- **Objective:** the target end-to-end journeys.
- **Scope:** the 3–7 most important journeys, their triggers, steps, states, hand-offs, approvals,
  notifications, and where each ends.
- **Expected outcome:** each core journey described step by step with its actors and states.
- **Complete when:** every role from workshop 2 appears in at least one journey and every journey has a
  defined start, end, and the states an item passes through.

### 5. Functional requirements
- **Objective:** what the product must do, capability by capability.
- **Scope:** features per journey, inputs and outputs, search and filtering, templates or reuse,
  notifications, reporting.
- **Expected outcome:** a confirmed list of functional requirements (`REQ-###`) grouped by capability.
- **Complete when:** every journey step is backed by a requirement or explicitly marked out of scope.

### 6. Content and data
- **Objective:** the information the product holds and how it lives.
- **Scope:** main business objects, their attributes, relationships, lifecycle and states, ownership,
  versioning, retention, archiving, deletion, import/export, data quality.
- **Expected outcome:** the business objects with their key attributes, states and lifecycle rules.
- **Complete when:** each object has an owner, a lifecycle, and its retention and deletion rules.

### 7. Business rules, validation and permissions
- **Objective:** the rules that govern behavior and who may do what.
- **Scope:** business rules, validation rules, defaults, calculated values, permission matrix (role ×
  action × object state), approvals, delegation, separation of duties, audit trail.
- **Expected outcome:** numbered business and validation rules and a permission matrix.
- **Complete when:** every state change from workshops 4 and 6 has a rule for who may make it and when
  it is refused.

### 8. Integrations and non-functional requirements
- **Objective:** what the product depends on and the qualities it must have.
- **Scope:** external systems and directions of data flow, identity and access (SSO), security and
  privacy, auditability, availability, performance and volumes, accessibility, localization,
  maintainability, technical constraints that shape product decisions.
- **Expected outcome:** the integration list with ownership and failure behavior; measurable
  non-functional requirements.
- **Complete when:** each integration has an owner and a defined behavior when it is unavailable, and
  each non-functional requirement has a measurable target or is recorded as an open question.

### 9. Edge cases, errors and recovery
- **Objective:** what happens when things go wrong or are unusual.
- **Scope:** concurrent edits, partial failures, invalid or missing data, revoked permissions mid-flow,
  deleted references, time zones and deadlines, bulk operations, undo and recovery, user-facing error
  messages.
- **Expected outcome:** a list of edge cases (`RISK-###`), each with the agreed behavior.
- **Complete when:** every journey has its main failure paths and recovery behavior agreed or recorded
  as open.

### 10. MVP scope, release and acceptance
- **Objective:** what ships first and how it is accepted.
- **Scope:** MVP versus later phases, prioritization (for example MoSCoW), explicit exclusions,
  rollout and migration, training, acceptance criteria per requirement, remaining open questions and
  their owners.
- **Expected outcome:** an agreed MVP boundary, deferred and out-of-scope lists, and testable acceptance
  criteria for every MVP requirement.
- **Complete when:** every confirmed requirement is classified MVP / later / out, and every MVP
  requirement has at least one acceptance criterion.

## Tailoring the plan

The plan is a proposal the PO confirms at kickoff. Keep ten workshops unless the PO asks otherwise;
adjust titles, merge or split topics, and reorder when the product warrants it (for example a
data-heavy product may move workshop 6 before 5; an integration product may move 8 earlier). Every
topic of the default plan must still be covered somewhere. Record the confirmed plan in
`workshop-plan.md` with the same four headings per workshop.

## Running one workshop

1. State the workshop's objective and scope in two or three sentences.
2. Interview one question at a time, starting with the largest unknown, using earlier decisions and
   the parking-lot items for this workshop.
3. Challenge unclear or conflicting answers; explore relevant edge cases and alternatives.
4. Confirm decisions before treating them as final.
5. Summarize the outcome in the workshop file (`discovery-workspace` › Workshop file).
6. Update the decision log, the register, the glossary and the parking lot.
7. List the remaining questions and dependencies.
8. Ask the PO whether the workshop is complete before moving on.
