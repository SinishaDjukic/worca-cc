# Prompt check

The prompt check tells you, while you type a task, what kind of task it is and whether it says enough to start. It is
**off by default**. Turn it on in **Settings › Chat › Limits & access › Check how clear a task prompt is**.

This page is the one place that describes the assessment. Every surface that shows a kind or a grade reads it.

What ships so far: the engine (the assessment, the free skip rules, the grading call, the route, the browser grader)
and the setting. No surface shows a chip yet, so turning the setting on has no visible effect until the chip ships.

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
| `perspectives` | `{id, reason}[]` | Proposed perspectives (always empty for now) |
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

## The setting

The chat pref `promptCheck` in `settings.json`, saved through `POST /api/settings {chat: {promptCheck}}`. Only a stored
`true` turns it on; a non-boolean is refused with 400. "Use defaults" on the Limits & access card leaves it as it is.
