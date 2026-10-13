# product-discovery

Turn a product idea into an implementation-ready specification through ten structured discovery
workshops. worca agents interview the product owner one question at a time, challenge their
assumptions, look for missing requirements and edge cases, and keep a decision log. Only the product
owner makes decisions. Everything is written to `docs/discovery/<product>/` in the repo, so every run
picks up where the last one stopped.

## Install

Marketplace → **Worca CC Official** → `product-discovery` → **Install…** (or
`worca plugin install product-discovery`).

## Pipelines

| Template | What it does |
|---|---|
| **Product Discovery: Kickoff** | Confirms the product basics with you, creates the discovery workspace and proposes a ten-workshop plan for you to approve, reorder or adjust. |
| **Product Discovery: Run workshop** | Runs one workshop: the facilitator interviews you, records what you decide, and loops until the workshop is ready for review. You then confirm pending decisions and close the workshop, or keep it open. Name the workshop in the task (`workshop 3`), or leave it out to run the next one. |
| **Product Discovery: Compile specification** | Compiles the closed workshops into `spec/`, audits it for invented behavior, contradictions and untestable requirements (fix loop, up to 3 cycles), and asks you to sign it off. |
| **Product Discovery: Full** | Kickoff, all ten workshops and the specification in one run. |

**Recommended:** run Kickoff once, then Run workshop once per workshop, then Compile specification.
Each run is short and leaves a reviewable diff of `docs/discovery/`. Full suits a dedicated discovery
sprint: one run waits for you through all ten workshops.

### How the interview works

worca lets an agent ask three times per execution. The facilitator asks **one question per round**,
then loops back on itself (up to 20 cycles, three questions each) until the workshop's completion
criteria are met. Each question is a form with the context: why the question matters, what is already
decided, an example, and the facilitator's recommendation with its trade-offs. Pick an option and/or
answer in your own words. Leave it empty when you are not sure: it becomes an open question, never a
guess. Turn on **That is enough for this workshop** to go straight to the review.

The review shows the outcome, the completion criteria, and every proposed decision or assumption still
waiting for you. Nothing is a requirement until you confirm it.

### Unattended runs

With no human in the loop (`--yes`), nothing gets confirmed for you. The facilitator records what the
request implies only as assumptions, recommendations and open questions. Workshops close marked "pending
items are not confirmed", and the specification stays an unsigned draft. In night mode, set
`neverDecide` to include `questions` so night mode never answers discovery forms itself.

In Full, if a workshop's review loop runs out and you choose to continue, that workshop stays
`in progress`, and the next facilitator picks it up again before moving on.

## The record — `docs/discovery/<product>/`

`README.md` (status table), `workshop-plan.md`, `decision-log.md` (`DEC-###`), `register.md`
(requirements, assumptions, open questions, recommendations, deferred, out of scope, risks),
`glossary.md`, `parking-lot.md`, `workshops/NN-*.md` (summary and interview log per workshop) and
`spec/` (the final specification).

## Agents

`discoveryKickoff`, `discoveryFacilitator`, `discoveryWorkshopReview`, `discoverySpecWriter`,
`discoverySpecAuditor`, `discoverySignOff`. They are on the Composer palette, so you can build your own
discovery flows from them.

## Skills

`discovery-method`, `discovery-workshops`, `discovery-workspace` and `discovery-spec-format` back the
agents. `product-discovery` runs the whole discovery as a live conversation in Ask Worca, one question
at a time. `discovery-status` reports progress, open items and the next step. Add them to a set on
Connectors › Skills and use them as `/<set>:product-discovery` and `/<set>:discovery-status`.
