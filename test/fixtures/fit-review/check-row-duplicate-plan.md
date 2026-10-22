# Sleeker buttons and fix feature gates — slice 2 of 3: feature-gate checks on the feature card

## 1. Problem and goal

The feature card hides why a gate failed. Goal:

- The feature card lists 1 row per gate check, each with a pass mark or a fail reason.
- A failing row shows 1 "Fix" button that sends the fix request.

## 2. Decisions

| # | Decision | Where |
|---|---|---|
| D1 | Feature gates render their checks on the feature card. | `ui/public/shape/feature-view.mjs` |
| D2 | A new module renders the gate check rows: `ui/public/feature-check-row.mjs` (new), a second check-row renderer next to `ui/public/shape/check-row.mjs`. | `ui/public/feature-check-row.mjs` (new) |

## 3. Code layout

- `ui/public/feature-check-row.mjs` (new) — `buildFeatureCheckRow(doc, check)`: one row per check, a Fix button on a failing one.
- `ui/public/shape/feature-view.mjs` — calls it for each gate.

### Checklist

- [ ] R-arch-1 The feature card imports its rows from the feature check-row module.

## 4. Fit

Reused:

- `ui/public/shape/feature-view.mjs` — the feature card stays the host.

New:

- `ui/public/feature-check-row.mjs` (new) — gate rows need a Fix button per row.

### Checklist

- [ ] R-fit-1 No second component where one exists: every part the plan adds reuses the component the house brief lists for it.
- [ ] R-fit-2 No new engine state unless an open spec names it.
- [ ] R-fit-3 Wording matches the existing surfaces (labels, statuses, button text).
- [ ] R-fit-4 No known bug from the house brief is repeated.
- [ ] R-fit-5 No conflict with an open spec in plans/.

## 5. Testing

- `test/ui-feature-check-row.test.mjs` (new) shows 1 row per check and 1 Fix button on a failing row.

### Checklist

- [ ] R-qa-1 A failing check row shows 1 Fix button.

## 6. Out of scope

- The chips row on the outline card stays unchanged.

## 7. Open questions

- None.

## Clarifications (Q&A)

- No clarifications were required; the task was unambiguous.
