# Prompt check

The prompt check tells you, while you type a task, what kind of task it is and whether it says enough to start. It is
**off by default**. Turn it on in **Settings › Chat › Limits & access › Check how clear a task prompt is**.

This page is the one place that describes the assessment. Every surface that shows a kind or a grade reads it.

What ships so far: the engine (the assessment, the free skip rules, the grading call, the route, the browser grader),
the setting, the chip with its kind picker, Improve, and (behind the flag `proposedPerspectives`) the run card's
proposed perspectives (below).

## How a prompt is checked

The check runs cheapest first, and most texts never reach a model:

1. **Stage 0: skip rules** (free, in the browser and again on the server). A text is not graded when it is:

   | Reason | When |
   |---|---|
   | `small-talk` | exactly ok, okay, thanks, thank you, yes, no, go, a number from 1 to 9, or "option a" to "option e" (case and punctuation ignored) |
   | `emoji` | emoji only |
   | `answer` | an answer to a card or a question |
   | `short-question` | a question (ends with `?`) under 25 words |
   | `logs-or-code` | 60% or more of its non-empty lines are inside code fences or look like log, stack or code lines |
   | `same-text` | the same text hash as the previous check on this surface |
   | `small-change` | under 15% changed since the previous check on this surface |

   A run card's brief and the Shaper task are always tasks: only `same-text` and `small-change` apply there.

2. **Stage 1: signals** (free). Cheap text rules count hits per family: task verbs and lists, bug words and stack
   frames, requirement phrases ("as a user", "so that"), implementation hints (backticked file paths, "change X to Y"),
   plan structure (2 or more headings, or 5 or more numbered steps) and deliverable words (deck, slides, doc, video).
   The highest count picks the kind (ties: plan, bug, implementation, requirement, deliverable); a task with no
   specific signal is an idea. Confidence without a model is at most 0.7.

3. **Stage 2: one model call** after you pause typing for 1.5 s. It uses the next-prompt suggestion's cheap model
   (Haiku on Claude) and the same locked-down call: no tools, no MCP servers, a scrubbed environment and a fresh empty
   folder. The text is quoted as data between fixed delimiter lines it cannot close.

At most one grading call per surface is in flight; a newer one cancels the older one. The browser keeps the last two
task messages of the same requirement (the window) and sends them with the current text; a reply that says the topic
changed empties the window.

## The assessment

`src/shared/prompt-check/assessment.mjs` holds the shape and `normalizeAssessment`, which turns any input (a model
reply, the browser's guess, the run card's legacy `assess`) into this object. It never throws, drops unknown keys and
keeps every string as plain text.

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | The shape version |
| `isTask` | boolean | false for a conversation or a question |
| `kind` | string or null | One of the kinds below, `conversation`, `question`, or null when unknown |
| `minorKinds` | string[] | Up to 2 other kinds the text also has |
| `confidence` | number | 0 to 1, two decimals |
| `grade` | `clear`, `needs-detail` or null | null when the model was not asked or did not answer |
| `size` | `small`, `medium`, `large`, `very-large` or null | The model's size guess |
| `openDecisions` | string[] | Up to 6 open questions, each at most 160 characters |
| `perspectives` | `{id, reason}[]` | Proposed perspectives, read by the run card's proposal |
| `continuesRequirement` | boolean or null | false when the latest message starts a new topic |
| `taskKind` | string or null | The Auto workflow's task kind (table below) |
| `source` | `model`, `deterministic` or `mock` | Where the assessment came from |

## Kinds, rubrics and the Auto task kind

| Kind | Label | Clear when it states | Auto `taskKind` |
|---|---|---|---|
| `requirement` | Requirement | who, problem, outcome, done-when, scope, constraints | `prompt` |
| `implementation` | Implementation task | change, where (files and symbols that exist), tests, done-when | `prompt` |
| `bug` | Bug report | steps, expected, actual, where, logs, frequency | `prompt` |
| `plan` | Plan | the existing shape check | `plan-partial`, `plan-complete-small` or `plan-complete-detailed` |
| `idea` | Idea | goal | `prompt` |
| `run-change` | Change to a run | change | `prompt` |
| `deliverable` | Deck, doc or video | audience, purpose, length, sources | `prompt` |

A plan's grade is always the shape check's result (Clear when it passes), even when the model answers. A failed shape
check gives `plan-partial`; a passed one gives `plan-complete-small` for a small plan and `plan-complete-detailed`
otherwise. The shape check wants the Shaper's section headings, so a pasted plan is mostly `plan-partial`.

## The route

`POST /api/prompt-check/grade`

```json
{ "requestId": "r-17", "surface": { "kind": "chat", "id": "th_123" },
  "text": "…", "window": ["…earlier task message…"], "forceTask": false,
  "engine": "claude", "chatModel": null }
```

- `surface.kind` is `chat`, `new-run`, `shaper` or `run-card`. `forceTask` defaults to true for `run-card` and `shaper`.
- `kind` (optional, one of the seven task kinds) is a person's correction from the chip. It pins the kind, limits the
  rubric to that kind and makes the text a task on every surface, so no skip rule applies (a person asked). The bucket
  and the budget still apply. Any other value answers 400 "kind is invalid". The log line then adds only `kind=forced`.
- A bad request answers `400 {error}`: "requestId is required", "surface is required", "text is required", "text is
  too long" (over 20 000 characters), "window has too many messages" (more than 2), "unknown engine" or "chatModel is
  invalid". A window item over 4 000 characters is clipped.
- `chatModel` is used only by an engine that grades on the chat's own model (Gemini CLI, Goose, OpenCode, Qwen Code).

Answers, in order:

| Answer | When |
|---|---|
| `{requestId, source: 'off'}` | The setting is off |
| `{requestId, textHash, source: 'skipped', skip}` | A skip rule matched |
| `429 {error: 'too many checks, try again in a moment'}` | More than 60 checks a minute |
| `{requestId, textHash, source: 'deterministic', assessment, error}` | The budget is spent, no model is available, or the call failed |
| `{requestId, source: 'superseded'}` | A newer check on the same surface replaced this one |
| `{requestId, textHash, source: 'model' or 'mock', assessment}` | The model graded it |
| `500 {error: 'prompt check failed'}` | An unexpected failure |

`error` is always one of: `model unavailable`, `timeout` (20 s), `unreadable reply`, `model call failed`,
`total cost limit reached`. No prompt or reply text is ever logged; the route writes at most one line per request with
the source, the skip or error code, the surface kind and the duration. The cost is booked as utility spend
(`prompt-check`).

## The chip

With the setting on, a graded task shows one chip next to its text field: `Bug report ▾  Needs detail`. The kind is a
SentencePicker (its name reads "Prompt kind: Bug report"); the grade is a Chip, `Clear` or `Needs detail`. It never
blocks Send or Start and never changes their state.

| Surface | Where | Surface kind |
|---|---|---|
| Chat composer | the lead row, after the intent chip | `chat` (the thread id, or `new`) |
| The Shaper task | the same, while the intent is Shaper; always a task | `shaper` |
| New run | under the prompt | `new-run` |
| A proposed run card | the brief's foot, before the character count; always a task | `run-card` (the card id) |

States: nothing shows while the setting is off, before the first result, or for a conversation or a question (Chat
only). A re-check keeps the last chip, the same node, with no spinner. A failed or model-less check shows the kind with
no badge. A grade change is said once in a polite live region; focus stays in the text field. Text emptied or sent
hides the chip. Stillhet's composer has no chip yet (it waits for the owner's answer); its Settings has the switch.

**Correcting the kind.** Picking another kind shows it at once, drops the badge, and checks the text again with that
`kind` (no debounce). The kind sticks for the rest of the draft. The correction is recorded by ids only:

`POST /api/prompt-check/kind-correction {surface, threadId?, cardId?, runId?, proposedKind, chosenKind}`

- Chat, the Shaper task and a run card send the thread id (a run card adds its card id). New run sends the run id, so
  its correction is held until `POST /api/run` answers; a new chat's is held until its first send creates the thread. An
  abandoned form or an unsent new chat records nothing.
- Answers: `201 {ok: true, at}`; `400 {error}` ("surface is required", "threadId is required" or "runId is required",
  "id is invalid", "proposedKind is invalid", "chosenKind is invalid", "the kind did not change"), checked before the
  setting and any write; `409 {error: 'prompt check is off'}`; `429 {error: 'too many corrections, try again in a
  moment'}` past 60 a minute; `500 {error: 'could not record the kind correction'}`. A refusal writes nothing.
- The row (`prompt_kind_corrections`, schema v96) holds `surface`, `thread_id`, `card_id`, `run_id`, `proposed_kind`,
  `chosen_kind` and the server's `at`. No prompt text, ever; any other body key is ignored. It has no foreign key: rows
  stay after their thread or run is deleted. The route logs one line with the surface and the duration, no id.

## Improve

A chip that grades **Needs detail** shows an `Improve` button after the badge, on every surface that hands the chip
its field (all four above). Nothing is sent until it is clicked: typing, grading, a kind correction and a re-check make
no Improve call. One click sends one request, which makes one model call.

The call (`src/core/prompt-check/improve.mjs`) uses the strong tier: the person's `deep` role model, else
`claude-sonnet-5-5` on Claude when it is in the catalog and ready, else the chat's own model on another engine; with
none, it answers "model unavailable". The effort is `medium` on every engine that has an effort setting (none on
Cursor). It runs with grading's lockdown (no tools, no MCP, a scrubbed env, a fresh empty folder) through the same
helper call as grading, with the text quoted between delimiters it cannot close. The prompt tells the model to keep the
person's language, wording and intent and never to add a fact, name, number, path or requirement.

The reply is normalised into the kind's template (`src/shared/prompt-check/improve.mjs`): every section, in order; a
section the prompt does not state carries at least one gap, shown as an amber mark `Product · decide: who uses it?`.
Section labels and the default questions are Worca's English words; section texts and the model's questions keep the
person's language.

| Kind | Sections (default perspective) |
|---|---|
| `requirement` | Who, Problem, Outcome (product), Done when (qa), Scope (product), Constraints (architect) |
| `implementation` | Change, Where (architect), Tests, Done when (qa) |
| `bug` | Steps (qa), Expected (product), Actual (qa), Where (architect), Logs, Frequency (qa) |
| `plan` | `## Problem and goal` (product), `## Testing` (qa), `## Out of scope`, `## Open questions` (product) |
| `idea` | Goal (product) |
| `run-change` | Change (product) |
| `deliverable` | Audience, Purpose, Length, Sources (product) |

`Use this` writes one `Label: text` line per section (a plan's sections as `## ` headings), each unfilled gap as
`[Product · decide: who uses it?]`, so the re-check keeps grading Needs detail until the gaps are filled.

`POST /api/prompt-check/improve {requestId, surface, text, kind, openDecisions?, projectKey? | projectDir?, engine?, chatModel?}`

| Answer | When |
|---|---|
| `400 {error}` | "requestId is required", "surface is required", "text is required", "text is too long" (over 20 000), "kind is invalid", "openDecisions is invalid" (at most 6 strings), "project is invalid" (both given, a non-string, or over 1 024 characters), "unknown engine", "chatModel is invalid"; checked before the setting and any model call |
| `409 {error: 'prompt check is off'}` | the setting is off |
| `429 {error: 'too many rewrites, try again in a moment'}` | more than 10 a minute |
| `{requestId, source: 'failed', error, model}` | the cost limit is reached, no model, a timeout (60 s), an unreadable reply, a failed call |
| `{requestId, source: 'superseded'}` | a newer Improve on the same surface replaced it |
| `{requestId, source: 'model' \| 'mock', kind, model, rewrite, text, paths}` | success; `paths` lists each backticked path of `text` as `{path, inRepo}` |
| `500 {error: 'prompt check failed'}` | an unexpected failure |

Cited paths are checked inside the project only: a known `projectKey` or a registered `projectDir`. A missing,
absolute, `..` or symlink-escaping path, and every path when there is no project, is "not in the repo". The answer holds
only `{path, inRepo}` pairs (each path at most 300 characters), never file contents. The cost is booked as utility
spend (`prompt-improve`). One log line per request carries the source, the error code, the surface kind and the path
counts; no prompt text, reply, path or project is logged.

States of the view (`ui/public/prompt-check/improve-view.mjs`, the library's RewriteSuggestion):

| State | What shows | The field |
|---|---|---|
| Busy | "Suggested rewrite: requirement", the violet shimmer "Rewriting…"; `Improve` disabled | unchanged and editable |
| Ready | the sections with their gap marks, "Not in the repo: …" when a path is missing, "Rewritten by Sonnet 5.5 · your language and intent kept", `Use this` and `Keep mine` | unchanged |
| Used | "Rewrite used." with `Undo`, until the next edit or send | the rewrite |
| Failed | the grey line ("Could not rewrite it: … Your text is as it was. Try again"); no Try again on the cost limit or with no model | unchanged |

`Undo` restores the exact text `Use this` replaced; `Keep mine` closes the view. Emptying or sending the field, the
setting turning off, the chip hiding, or a regrade that leaves Needs detail closes a busy or ready view.
Stillhet's composer has no Improve yet; it waits for the owner, with the chip.

## Perspectives

Behind the Labs flag `proposedPerspectives` (off by default; see [feature flags](feature-flags.md)). With the flag and
the setting on, each graded brief proposes the run card's perspective chips: Product plus 2 to 4 more, 3 to 5 in total.
`proposePerspectives` (`src/shared/prompt-check/perspectives.mjs`) is pure and makes no model call.

1. **The kind's start set** (Product first):

   | Kind | Start set |
   |---|---|
   | requirement, implementation, plan, run-change | Product, Architect, QA |
   | bug | Product, QA, Architect |
   | idea, deliverable | Product, UX, Devil's advocate |
   | none | Product, Architect, QA |

2. **Content signals**, in this order, on at most the first 8 000 characters of the brief (word-bounded, any case):
   security (sign-in, tokens, secrets, passwords, permissions, XSS, CSRF, injection, encryption), compliance (personal
   data, PII, email addresses, consent, GDPR, retention, licences), release (migration, feature flag, rollout,
   rollback, release), devops (CI, pipelines, Docker, deploy, Kubernetes, Terraform, GitHub Actions, monitoring,
   alerts), ux (screen, page, button, layout, UI, accessibility, mobile, modal), devil (rewrite, replace, migrate to,
   new framework, instead of).
3. **The assessment's own `perspectives`**, after the signals. Project fit is never proposed.

The list stops at 5. Each proposed chip shows a fixed reason as its tooltip and accessible description; a reason never
quotes the brief. Product stays locked on. The proposal sets the chips only until the person's first click; after it, a
later grade updates the reasons only. With the setting off, the chips show today's preselection and nothing is proposed.

With the flag on, Compliance (personal data, emails, consent, retention, licences) is a 10th perspective, and the
chosen set drives the run:

- **Clarify** asks at most one question per chosen perspective and 3 in total; the server keeps the first question per
  perspective (by the `id` prefix) and the first 3, even when the agent asks more.
- **The code review** runs one reviewer per chosen perspective (plus Requirements on a run with agreed requirements),
  in place of the single reviewer, or of Shaper's Correctness, Security and Project fit roles.
- **The plan role reviews** (Shaper only) gain a Compliance reviewer when Compliance is chosen.

The set is read when the run starts; a pause and resume keep it.

**The stored row.** A started run that had a proposal stores one row in `perspective_choices`: the run id, the surface
(`run-card`), the kind, and the proposed, chosen, dropped and added perspective ids, with the time. It holds no text.
Nothing reads it yet.

## The setting

The chat pref `promptCheck` in `settings.json`, saved through `POST /api/settings {chat: {promptCheck}}`. Only a stored
`true` turns it on; a non-boolean is refused with 400. "Use defaults" on the Limits & access card leaves it as it is.
