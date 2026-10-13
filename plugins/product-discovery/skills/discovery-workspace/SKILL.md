---
name: discovery-workspace
description: Where worca's product discovery lives in a repo — the docs/discovery/<product>/ layout, the README status table, the decision log and register formats with their ids, the workshop file template, how an agent resolves which product and workshop it works on, and the discovery brief agents pass along.
---

# The discovery workspace

All discovery state lives in the repository, so every run, every agent and every person reads the same
record. Nothing important lives only in a run's chat.

## Layout

```
docs/discovery/<product-slug>/
  README.md            product, PO, workshop status table, next step
  workshop-plan.md     the ten workshops: objective, scope, expected outcome, complete when
  decision-log.md      DEC-### entries
  register.md          REQ, ASM, OQ, REC, DEF, OOS and RISK entries
  glossary.md          terms, definitions, renamed terms
  parking-lot.md       PARK-### items with the workshop they belong to
  workshops/
    01-<slug>.md       one file per workshop: summary + interview log
  spec/                the final specification (see discovery-spec-format)
```

`<product-slug>` is the product name in kebab-case. When the request names another location, use it
and record it in `README.md`. Write only inside the discovery folder. Never touch application code.

## Resolving the product and workshop

Product folder — use the first rule that matches:

1. A `Discovery dir:` line in the brief, or a path or slug in the request that names an existing
   folder under `docs/discovery/`.
2. Exactly one folder exists under `docs/discovery/`: use it.
3. Otherwise the product is **unresolved**. A kickoff creates a new folder; any other step changes
   nothing and reports it (a verifier as one critical issue listing the folders it found).

Workshop — use the first rule that matches:

1. A `Workshop:` line in the brief with a number, or a workshop number or title named in the request
   (`workshop 3`, `W03`, `run the data workshop`).
2. The first workshop in the README status table whose status is `in progress`.
3. The first workshop whose status is `planned`.
4. None left: every workshop is closed. Say so; the next step is the specification.

## README.md

```markdown
# <Product> — product discovery

- Product owner: <name or role>
- Plan: confirmed <YYYY-MM-DD> | proposed (not yet confirmed)
- Reference products: <list>

| # | Workshop | Status | Open items | File |
|---|---|---|---|---|
| 1 | Vision, goals and success | closed | 2 OQ | workshops/01-vision.md |
| 2 | Users, stakeholders and roles | in progress | — | workshops/02-users.md |
| 3 | Current process and pain points | planned | — | — |

## Next step
<one line>
```

Status values: `planned`, `in progress`, `closed`. Only the workshop review closes a workshop.

## decision-log.md

```markdown
### DEC-007 — Newsletters need one approver before sending
- Status: Confirmed | Proposed | Rejected | Superseded by DEC-012
- Workshop: 4 · Source: W04-Q06 (PO answer, 2026-10-13)
- Decision: <what was decided, one or two sentences>
- Rationale: <why>
- Alternatives considered: <short list>
- Consequences: <what this implies elsewhere; affected REQ/RISK ids>
```

Ids are never reused or renumbered. A proposed decision is visibly `Proposed` until the PO confirms it.

## register.md

One section per class, entries in id order:

```markdown
## Confirmed requirements
- **REQ-012** (W05, from DEC-007) An editor can submit a draft for approval. *Priority: MVP | later | tbd*

## Assumptions
- **ASM-004** (W02) All users sign in with the corporate SSO. *Validate with: IT security*

## Open questions
- **OQ-009** (W03, owner: PO, needed by: W07) Who may delete a sent newsletter? *Example: …*

## Recommendations
- **REC-003** (W04) Keep a single approval step for the MVP. *Trade-off: …* *Status: pending | accepted → DEC-007 | declined*

## Deferred
- **DEF-002** (W05) Scheduled sending. *Why: … · Phase: after MVP*

## Out of scope
- **OOS-001** (W01) External subscribers. *Why: …*

## Risks and edge cases
- **RISK-005** (W09) Two editors change the same draft. *Agreed behavior: … | open (OQ-014)*
```

## Workshop file — workshops/NN-<slug>.md

```markdown
# Workshop N — <title>

- Status: in progress | closed
- Objective: <from the plan>

## Summary
### Confirmed requirements
### Assumptions
### Open questions
### Decisions
### Risks and edge cases
### Product Owner questions
<questions for the PO or another stakeholder, in plain language, with an example>
### Outcome
<what is established; complete or not, and why>
### Next steps

## Interview log
- **W04-Q01** <question> — *Answer:* <PO answer, quoted or closely paraphrased> → <ids recorded>
```

Question ids are `W<NN>-Q<nn>`: two-digit workshop and question numbers, sequential within the workshop.

Summary sections hold ids and one-line statements, not prose essays. The full entries live in the
decision log and the register. Keep the documentation focused: no repeated explanations, no icons.

## parking-lot.md

```markdown
- **PARK-003** (raised W02, for W07) Can a team lead see drafts of other teams? *Status: open | moved to W07 | resolved by DEC-015*
```

## The discovery brief (the `brief` port)

```markdown
# Discovery brief

- Product: <name>
- Discovery dir: `docs/discovery/<slug>/`
- Plan: confirmed | proposed (not yet confirmed)
- Workshop: <N> — <title> | none
- Workshop status: planned | in progress | ready for review | closed
- Questions asked in this workshop: <n>
- Register: DEC <n> (<c> confirmed) · REQ <n> · ASM <n> · OQ <n> · RISK <n>

## Request
<the user's request, verbatim>

## Notes for the next step
none
```

Each agent rewrites the whole brief, keeps the lines it does not own, and passes it on.
