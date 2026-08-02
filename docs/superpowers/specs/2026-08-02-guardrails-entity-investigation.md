# Named Guardrails as a First-Class Entity — Investigation

Date: 2026-08-02
Status: Implemented (per-run-only model — see the Decision 2026-08-02 block below; plan: docs/superpowers/plans/2026-08-02-guardrails-entity-v3.md)
Baseline: branch `feature/guardrails` as of `297040dc` (per-project guardrails v3, implemented)

> **Decision 2026-08-02 (supersedes the §8 verdict):** the user chose the **per-run-only model**
> (a refined Approach B): guardrail sets are selected **per pipeline run**; the per-project
> guardrails dimension is removed before merge; §3's risks were reviewed and are consciously
> accepted; the New Pipeline picker defaults to **Permissive**.
> Plan: `docs/superpowers/plans/2026-08-02-guardrails-entity-v3.md` (v1 = tighten-only variant, superseded).

## The question

Should guardrails become a first-class named entity — a dedicated **Guardrails** menu, built-in sets ("Permissive", "Normal", "Strict" replacing the "Secure++" label), a "Create guardrails" dialog that can start from a preset — selectable **per pipeline run** (single-project and workspace) the same way a workflow is selected in the New Pipeline form?

**Short answer: yes to the entity, the menu, and a run-time selector — with one critical amendment.** The run-time selection must *compose* with (tighten) the projects' own guardrails, not *replace* them. A replace semantic would turn every project's saved security policy into an advisory default that any run creation can silently discard, and it cannot express per-project facts (a project's own protected paths and env allowlist) in a heterogeneous workspace. The composition variant costs almost nothing extra: the orchestrator already unions an array of policies, and the run's selection can simply join that union as one more element.

The codebase itself anticipated this direction: `detectPreset` was deliberately kept exported "as forward-compat for a future GET-side `detected` field / **named presets** (v3-of-v3 scope)" (`docs/superpowers/plans/2026-08-01-per-project-guardrails-v3.md`, Task 1 notes).

---

## 1. Current state (what v3 shipped)

### Policy model

- Stored per project as `project_config.extra.guardrails` = `{ level, custom }` (`src/core/config.mjs:495-551`, `src/core/db.mjs:197-203`). No dedicated table; the `extra` blob round-trips unknown keys, so older worca versions preserve it.
- `level` ∈ `['permissive','normal','secure','custom']` (`GUARDRAIL_LEVELS`, `src/core/guardrails.mjs:28`). UI label for `secure` is "Secure++" (`ui/public/app.js:5027`).
- Preset levels resolve **from the code table at read time** (`GUARDRAIL_PRESETS`, `guardrails.mjs:64-101`) — never snapshotted — so a preset improvement ships with a worca upgrade and applies to every project on that level. `custom` pins one anonymous 5-key blob per project, kept dormant across preset switches.
- Effective shape enforcement consumes: `{ honorProjectSettings, envScrub, envAllowlist, protectedPaths, deny }`.

### Resolution and enforcement

- `Orchestrator._resolveGuardrails()` (`src/core/orchestrator.mjs:1082-1093`) runs at `run()` **and** `resume()`: reads each member's effective settings, builds the per-member `honorByKey` map (repo-settings lift gate), then takes the deny-safe union (`unionGuardrails`, `guardrails.mjs:285-302`). Single-project runs are a one-element member array — one code path.
- Union invariants: any member scrubbing scrubs the run; restriction lists (`protectedPaths`, `deny`) union across all members; `envAllowlist` (a widener) unions **only over scrubbing members**; `honorProjectSettings` in the union is advisory — the lift is gated per member. Net: *a member can never relax another member's policy.*
- Spawn effects: one merged `--settings` permissions payload + optional scrubbed spawn env (`src/core/claude-runner.mjs`). Empty policy ⇒ argv/env byte-identical to pre-guardrails (legacy-parity invariant).
- Audit: `run.json` gets `{envScrub, denyCount, protectedCount}` (`orchestrator.mjs:1148-1154`).

### What is *not* there today

- **No named/custom guardrail sets** — exactly one anonymous `custom` blob per project; no registry, no sharing, no workspace-level or global default. Two projects wanting the same custom policy must duplicate it by hand, and edits don't propagate.
- **No run-time selection** — `POST /api/run` (`ui/server.mjs:634`) has no guardrails field at all; policy is read from project config at run start. The pipeline row records nothing about which policy applied (only the `run.json` audit counts, on detached runs).
- **No dedicated view** — configuration lives in a per-row accordion in the Projects view (`app.js:4928-5146`). No badge shows a project's level anywhere; the level is visible only after expanding the row.
- **Client-side hardcoding** — the four level buttons, the preset-detection loop, and the fallback list are literals in `app.js` (`:4952`, `:4967`, `:4970`, `:5027`, `:5029`); the `guardrailLevels` array the server serves is dead data on the client. Adding a level today means touching core, tests, *and* two client literals.

### The precedent: workflows already are exactly this kind of entity

| Aspect | Workflows (exists) | Guardrail sets (proposed mirror) |
|---|---|---|
| Core module | `src/core/workflows.mjs` | new `guardrail-store` layer over `guardrails.mjs` |
| Storage | `workflows` DB table (`db.mjs:183-191`) + `origin` column | new `guardrail_sets` table (or config blob — see §5 Q3) |
| Built-in | `DEFAULT_WORKFLOW` (`wf_default`), never persisted, undeletable, always listed first | Permissive / Normal / Strict from `GUARDRAIL_PRESETS`, virtual, undeletable |
| Plugin-shipped | `wfp_<plugin>_<slug>`, `origin='plugin:<name>'`, uninstall blocked by `ReferencedError` while referenced | same pattern available for free |
| Validator | `workflow-validator.mjs` | `validateGuardrails` already exists (`guardrails.mjs:132-155`) |
| API | `GET/POST/DELETE /api/workflows` (`ui/server.mjs:1845-1900`) | `GET/POST/PUT/DELETE /api/guardrails` |
| Dedicated view | Pipeline Composer (`index.html:802`) | new Guardrails view |
| Run-time pick | `workflowId` in `POST /api/run`, validated, default `wf_default` (`ui/server.mjs:673-678`) | `guardrailsId`, validated, default "project defaults" |
| Remembered | `project_config.active_workflow_id` | not needed — the project's guardrails config *is* the memory |
| Resume | `workflowId` persisted in `resume_point`, re-resolved | same treatment |
| "Which named thing equals this blob" | — | `detectPreset` (`guardrails.mjs:233-239`), already built and tested |

Nothing about the proposal requires a pattern the codebase doesn't already have. That is the strongest argument that the entity-ization is cheap and low-risk.

---

## 2. What the proposal gets right

1. **Reuse.** Today a custom policy is trapped inside one project. Ten projects with the same org policy = ten hand-maintained copies that silently drift. A named set is defined once, referenced everywhere, and — if references resolve at read time, like presets already do — an edit to the set applies to every referencing project on its next run/resume. This extends the "presets track worca upgrades" property (README `:249-250`) to *user-defined* policy, which is the natural completion of the v3 design.
2. **Discoverability.** A top-level menu makes security policy a visible, browsable concept instead of something hidden behind a per-row expander. "What policies exist in this installation, and what exactly does Strict deny?" becomes one click.
3. **Consistency of mental model.** Users already learn "pick a workflow for this run" — "pick guardrails" rides the same UX groove, same form section, same picker pattern (`loadWorkflowsInto`, `app.js:2438` is directly imitable).
4. **It kills the client hardcoding.** A picker built from server data replaces the five hardcoded literals; adding/renaming a set no longer touches the client.
5. **"Strict" is a better name than "Secure++"** for a user-facing tier ladder (Permissive → Normal → Strict reads as an ordered scale; "Secure++" reads as a version pun). Rename is display-only — see §5 Q4.
6. **Per-run choice covers real cases per-project config can't:** run an untrusted-input scan strictly in a normally-permissive sandbox project; harden one workspace run without editing N member projects; try out a stricter policy on one pipeline before committing it to the project.

## 3. The one dangerous reading: per-run selection that *replaces* project policy

Read literally ("choose the guardrails for this run" as the *only* source of policy), the proposal has four problems:

1. **It demotes saved policy to a suggestion.** The entire v3 enforcement design is built on "more guarding always wins; a member can never relax another member's policy" (`unionGuardrails` doc comment, `guardrails.mjs:272-283`; per-member honor gate, `orchestrator.mjs:1084-1090`; deny-only repo lift). If the New Pipeline form can pick Permissive for a project whose owner saved Secure++, then a project's security policy holds only until the next person creates a run — a one-click silent downgrade. The analogy with workflows breaks precisely here: a workflow describes what the run *does* (an invocation property), guardrails describe what the run *may do to the project* (a target property). CI systems make the same split: you pick the workflow per run; you don't pick away branch protections per run.
2. **Project-intrinsic fields don't fit a global set.** `protectedPaths` beyond the generic preset (this repo's `config/prod-secrets/**`) and `envAllowlist` (project A needs `NPM_TOKEN` under scrub, project B needs `GOOGLE_APPLICATION_CREDENTIALS`) are facts *about a project*. Expressing them through run-selected global sets forces per-project singleton sets — per-project config reinvented with more ceremony, or a fat shared allowlist that widens every project's scrub (the exact hole `unionGuardrails`'s scrubbers-only rule was built to prevent).
3. **Workspace heterogeneity is lost.** Today each member contributes its own policy and the run enforces the union. One run-level choice flattens that to one-size-fits-all across members with different needs.
4. **Security becomes a per-invocation opt-in.** Whatever the picker defaults to is what unattended/habitual runs get. A forgotten dropdown should never mean "unprotected run".

There is also a subtle enforcement interaction: `honorProjectSettings` gates the per-member repo-settings deny lift via each member's *own* saved value. A run-level replacement policy has no per-member answer to give — replace semantics would force an all-or-nothing lift gate, breaking the "one member can't override another member's opt-out" rule (`orchestrator.mjs:1084-1087`).

## 4. Approaches

### Approach A — status quo + polish (no entity)

Keep per-project `{level, custom}`; optionally de-hardcode the client and add badges.

- **Pros:** zero new concepts; zero migration.
- **Cons:** custom policies stay unshareable and drift; no run-time strictness; discoverability stays poor. Doesn't answer the user's goal at all.

### Approach B — entity + per-run selection with *replace* semantics (the literal proposal)

Named sets in a library; New Pipeline picks one; the pick **is** the run's policy.

- **Pros:** simplest mental model ("what I picked is what runs"); exact UX symmetry with workflows.
- **Cons:** all of §3 — saved project policy becomes advisory, per-project paths/allowlists inexpressible, workspace union lost, forgotten-dropdown hazard, honor-gate breakage. Would require *weakening* tested invariants that the v3 design (and its test suite: `test/guardrails.test.mjs`, `test/workspace-scan-guardrails.test.mjs`, `test/orchestrator-guardrails.test.mjs`) deliberately encodes.

### Approach C — entity library + per-project assignment + per-run **tighten-only overlay** (recommended)

Two phases:

**Phase 1 — Guardrails become a named entity.**
Global library with built-ins (Permissive / Normal / Strict — wire ids unchanged) plus user-created named sets ("Create guardrails", start-from-preset). A project's guardrails config becomes a *reference* to a set (or stays an inline custom blob, back-compat). Dedicated Guardrails menu = list + editor (the editor is today's panel: level seg → set picker, toggles, three row editors — components already exist). Projects-view panel simplifies to a picker + "edit set" link.

**Phase 2 — Per-run selection as one more union member.**
`POST /api/run` gains optional `guardrailsId`. `_resolveGuardrails()` appends the selected set's effective settings to the `effective` array before `unionGuardrails(effective)` (`orchestrator.mjs:1083-1091`). That single line placement gives, by construction:

- run selection can add denies/protected paths/scrub — never remove a member's (`deny-safe union`);
- overlay `envAllowlist` counts only if the overlay itself scrubs (scrubbers-only rule);
- `honorByKey` untouched — it is built from `this.members` only, so per-member lift gating is preserved;
- default (no selection) = empty overlay = today's behavior, byte-identical (legacy parity).

Picker default: **"Project defaults"**. Relaxing a project below its saved policy remains what it should be: a deliberate, persistent edit in the project's config — not a per-run dropdown.

- **Pros:** all §2 benefits; zero new security semantics (existing union tests already prove the composition); orchestrator change is ~1 line + plumbing; resume/audit follow existing patterns.
- **Cons:** "tighten-only" must be explained in the UI (one hint line + a resolved-policy summary in the form); a "run this secure project permissively once" escape hatch is deliberately absent (can be added later as an explicit-confirm override if a real need emerges — additive).

**Verdict: C.** B's replace semantics are the only part of the proposal that makes things *worse* than the current branch; everything else is a genuine improvement with an in-repo template to copy.

---

## 5. Design sketch for Approach C (details + decisions)

### Entity model

```
GuardrailSet {
  id:      'gr_<slug>'          // built-ins keep wire ids: 'permissive' | 'normal' | 'secure'
  name:    string               // display name; built-ins: Permissive / Normal / Strict
  settings: <5-key shape>       // validated by validateGuardrails (guardrails.mjs:132)
  origin:  'user' | 'plugin:<name>' | 'builtin'
}
```

- Built-ins are **virtual** (from `GUARDRAIL_PRESETS`, never persisted, undeletable, listed first) — exactly `DEFAULT_WORKFLOW`'s treatment (`workflows.mjs:92-110`). They keep resolving from code so upgrades still ship preset improvements.
- User sets resolve **by reference at read time** too: editing a set updates every referencing project at its next run/resume — same semantics presets already have, now user-extensible. (`resume()` already re-resolves, so even paused runs pick up set edits — unchanged behavior.)
- "Create guardrails" dialog: name + start-from (Permissive/Normal/Strict/blank/existing set) → opens the editor pre-filled. `detectPreset` powers "this equals Normal" hints.

### Storage + config reference

- New `guardrail_sets` table mirroring `workflows` (`db.mjs:183-191`), `origin` column included (SCHEMA bump — precedent: SCHEMA_V13 additions).
- Project config: `extra.guardrails` gains a ref form, e.g. `{ level: 'ref', ref: 'gr_org_policy' }` (or reuse `level` as the id — see Q1). Existing `{level, custom}` blobs stay valid forever; `sanitizeGuardrailsConfig`'s fail-open path (`guardrails.mjs:167-179`) extends: unknown/dangling ref → permissive (same documented downgrade hazard as today — an older worca reading a newer blob enforces Permissive; the blob itself is never damaged).
- Inline `custom` stays supported (zero migration); the Projects panel offers "promote to named set" (write set, flip project to ref).

### API

- `GET /api/guardrails` → `[...builtins, ...userSets]`; `GET /api/guardrails/:id`; `POST` (validate → 400 with `errors`); `PUT /:id`; `DELETE /:id` — built-ins refused, referenced sets refused with the `ReferencedError` pattern (`plugin-workflows.mjs:18`). Thin routes over a core module, like `ui/server.mjs:1845-1900`.
- `POST /api/config/guardrails` accepts the ref form; validation extends `validateGuardrailsConfig`.
- `POST /api/run` accepts optional `guardrailsId`, validated like `workflowId` (unknown → 400, `ui/server.mjs:673-678`).

### Run persistence, resume, audit

- Persist the run's selection: new nullable `pipelines.guardrails_id` column *and* in `resume_point` (note: `workflowId` today survives only in `resume_point` — the column makes the choice visible in History, which `workflowId` never got).
- `resume()` re-reads the set by id (latest definition), appends to the union — matches "resume enforces latest saved policy" (`orchestrator.mjs:1079-1081`). Dangling id at resume → warn + empty overlay (fail-open to project policy, never abort).
- `run.json` audit gains `guardrailsId` next to the existing counts (`orchestrator.mjs:1148-1154`); the deferred run-detail badge becomes more useful (set name, not just counts).

### UI

- **Nav:** add `guardrails` to the three `index.html` locations + `VIEW_NAMES` + the `showView` loader chain (`app.js:8215-8281`). Build the view as an extracted module like `plugins-view.mjs` (the cleaner, testable pattern).
- **Guardrails view:** list (name, origin badge, summary chips: `N deny · M paths · scrub`, referenced-by count) + editor + "Create guardrails" dialog. Editor reuses today's panel pieces (`.seg`, `.switch`, `grListHtml` row editors, dirty tracking).
- **Projects view:** the accordion's 4-way level seg becomes a set picker (built-ins + named sets + "Custom (inline)"); the dirty→Custom auto-flip logic (`grMutateSettings`/`grDetectPreset`) moves into the set editor as "edited a built-in → save as new set". Net simplification of the panel.
- **New Pipeline form:** one `<select>` in `#pipeline-config` next to the workflow picker, both targets, default **"Project defaults"**; options append "+ tighten with: <set>". A small resolved summary line ("this run: scrub on, 40 denies") would close today's visibility gap, sourced from the same data the audit uses.
- Optional polish: level/set badge on project rows (today the level is invisible until expanded).

### Rename "Secure++" → "Strict"

Display-label change only (`app.js:5027` today; server-provided `name` after Phase 1). Wire id `secure` is frozen: it lives in stored project blobs, `GUARDRAIL_LEVELS`, the preset snapshot test, and the downgrade fail-open path. Renaming the id would corrupt every saved config for zero benefit.

### Explicitly out of scope (unchanged)

Enforcement layer (`claude-runner.mjs`), union semantics, repo-settings lift, env-scrub keep-list, mock mode. The proposal is config-plumbing + UI; no enforcement code changes.

---

## 6. Costs and risks

| Item | Assessment |
|---|---|
| New store + CRUD + view + picker | Moderate, pattern-copy from workflows end-to-end; editor components exist |
| Migration | None forced — old blobs remain valid; ref form is additive; older-worca downgrade hazard unchanged in kind |
| Delete/rename of referenced sets | Solved by `ReferencedError` precedent (block delete while referenced); rename is free (ids stable) |
| Union growth on shared sets | A shared set's `envAllowlist` applies wherever the set is assigned — broader than per-project lists. Mitigation: keep project-specific allowlist entries in per-project inline custom or per-project sets; document |
| UI complexity in New Pipeline | One select + one hint line; default preserves today's behavior exactly |
| Test surface | New store/API/view tests; existing union/spawn/resume tests remain the invariant anchors (notably `test/spawn-args.test.mjs` legacy-parity baselines must keep passing unmodified) |
| Tighten-only surprise | A user expecting replace semantics sees stricter-than-picked runs on guarded projects; the resolved-summary line + picker labels ("tighten with") are the mitigation |

## 7. Open questions (need user decision before planning)

1. **Ref encoding in project config:** separate field (`{level:'ref', ref:'gr_x'}`) vs overloading `level` with set ids. Recommendation: separate field — keeps the closed 4-value `level` enum, its validators, and the snapshot test intact.
2. **Per-run relax escape hatch:** ship tighten-only (recommended), or also an explicit-confirm "override project policy" for single-project runs? Recommendation: tighten-only now; override is additive later if a real need shows up.
3. **Storage:** DB table (recommended — mirrors workflows, plugin `origin` ready, referenced-by queries easy) vs a blob in global settings.
4. **Rename scope:** display-only "Strict" (recommended) vs also introducing new wire ids with a migration (not worth it).
5. **Phasing:** Phase 1 (entity + menu + project refs) then Phase 2 (run picker), or both at once? Recommendation: two phases — Phase 1 is independently shippable and de-risks Phase 2.

## 8. Verdict

The proposal is the right direction — it was even pencilled in as "named presets (v3-of-v3 scope)" during v3 planning — **provided run-time selection composes instead of replaces**. Approach C delivers the requested UX (Guardrails menu, create-from-preset, per-run picker beside the workflow picker) while keeping every security invariant the current branch just spent v1→v3 building and testing, and the implementation is a pattern-copy of the existing workflows entity from store to picker.
