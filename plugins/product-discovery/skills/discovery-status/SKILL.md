---
name: discovery-status
description: Report where a product discovery stands — which workshops are closed, in progress or planned, the decisions made, the open questions with their owners, unconfirmed assumptions, parked items, conflicts or gaps in the record, and the single next step. Use for "discovery status", "where are we with discovery", or "what is still open".
---

# Discovery status

Read the discovery folder (`docs/discovery/<product-slug>/`, see `discovery-workspace`; when several
exist, ask which product or report each briefly). Change nothing.

Report, in this order and briefly:

1. **Progress** — the workshop table: number, title, status, open items.
2. **Decisions** — count confirmed, proposed and superseded; list the proposed ones that still wait for
   the PO.
3. **Open questions** — each `OQ` with its owner and the workshop it is needed by; flag any whose
   workshop is already closed.
4. **Assumptions to validate** — each `ASM` with who can validate it.
5. **Parking lot** — open `PARK` items and their target workshop.
6. **Record health** — anything inconsistent: a requirement citing a rejected or superseded decision,
   a closed workshop with an empty summary section, a term used with two meanings, a duplicate id.
7. **Next step** — one line: the workshop to run next, or "compile the specification" when all are
   closed.

Quote ids, not paraphrases, so the PO can find each item.
