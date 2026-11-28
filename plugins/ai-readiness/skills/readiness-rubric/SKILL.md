---
name: readiness-rubric
description: AI-readiness rubric for the AI readiness check and setup pipelines. How to judge a repository's core dimensions, which files each AI tool reads, and the judgement JSON that worca's scripts turn into the scorecard.
---

# AI-readiness rubric

worca measures the facts with a probe script and computes every score, severity and the pass gate
in code. You judge only quality: the six core dimensions, one line of reason each, and the gaps.
Never compute an overall score, never pick a severity, and never write HTML.

## Core dimensions (0–100 each, `null` when it does not apply)

| key | weight | 100 means |
|---|---|---|
| commands | 25 | install, test, single-test and lint commands are documented, run (see the probe's `commands[].status`) and match the confirmed map |
| architecture | 15 | the entry points, layering and module boundaries an agent needs, at the right depth; on a workspace member also its relations to the other members (`map.relations`): a member that uses or is used by another and does not say so has an architecture gap |
| conventions | 15 | the conventions that deviate from the ecosystem's defaults, each one checkable |
| gotchas | 15 | every confirmed gotcha and every unwritten rule from the map is written down |
| tests | 15 | the chosen tests exist and pass; real tests over pure units when any exist (`null` when the plan chose `none`) |
| recurringTasks | 15 | every confirmed recurring task is covered by a skill or a section (`null` when none is confirmed) |

A workspace's overall is its lowest member's overall, and the workspace passes only when every member passes.

Judge what an agent can READ in the instruction files the probe lists, not what is in the code.
A tool that was not selected is never a gap. Code health is a paragraph (`codeHealth`), never a score.

## Files per tool

The tool ids are worca's run engines: `claude`, `codex`, `copilot`, `cursor`, `gemini`, `qwen`,
`goose`, `opencode`. Which files each one READS is the probe's `tools.<id>.files` (worca's own view);
judge those. What a setup WRITES, for exactly the selected tools:

| Engine | Instruction file setup writes | Skills folder |
|---|---|---|
| any selected | `AGENTS.md` (core) | — |
| claude | `CLAUDE.md` = exactly `@AGENTS.md`; Claude-only notes in `.claude/rules/<name>.md` (no `paths:` = always loaded) | `.claude/skills/<id>/SKILL.md` (staged, placed) |
| gemini | `GEMINI.md` = exactly `@AGENTS.md` | `.agents/skills/<id>/SKILL.md` |
| codex, opencode, goose | none | `.agents/skills/<id>/SKILL.md` |
| qwen | none | `.qwen/skills/<id>/SKILL.md` |
| cursor | `.cursor/rules/<name>.mdc` for path rules only | `.agents/skills/<id>/SKILL.md` |
| copilot | `.github/instructions/<name>.instructions.md` (`applyTo:` globs) for path rules only | `.agents/skills/<id>/SKILL.md` |

`AGENTS.md` carries everything project-wide. A path rule holds only a convention tied to some paths:
Cursor's `.mdc` has frontmatter `description`, `globs` and `alwaysApply: false` (a plain `.md` in
`.cursor/rules/` is ignored); Copilot's `.instructions.md` has frontmatter `applyTo:` with the globs; a
Claude rule tied to paths has frontmatter `paths:` with the globs. One skill per confirmed recurring
task kept in the repository, the same `SKILL.md` in every skills folder in use (for example
`.claude/skills/<task id>/SKILL.md` and `.agents/skills/<task id>/SKILL.md`). `.github/copilot-instructions.md`
is never created; an existing one is only added to, improved or left alone, like any existing file.
Under `.claude/` only `skills/` and `rules/` are ever written; never settings, hooks, commands or
agents. An import the tool expands (`@AGENTS.md` in `CLAUDE.md` or `GEMINI.md`) is self-sufficient. A
sentence pointing to another file ("see AGENTS.md") is not. A file over the size limits the probe
reports (`limits`, `overCap`) does not count.

## Judgement JSON

Write exactly this shape (a workspace run: `{ "members": { "<projectKey>": … } }`):

```json
{ "dimensions": { "commands": 0, "architecture": 0, "conventions": 0, "gotchas": 0, "tests": 0, "recurringTasks": null },
  "reasons": { "commands": "<one line>" },
  "gaps": [ { "id": "g1", "dimension": "gotchas", "title": "", "detail": "", "fix": "<one line>", "location": "<repo-relative file>" } ],
  "codeHealth": "<one paragraph>", "whatExists": "<one paragraph>", "summary": "<3 lines>" }
```

`gaps[].dimension` is one of the six keys. One gap per unmet item. `location` is the file the
setup would change to close it. In a workspace judgement, `location` is relative to the member's own repository (`AGENTS.md`, not `repos/<projectKey>/AGENTS.md`); worca adds the member prefix.

## Paths worca mounted for this run

worca mounts `.claude/rules/worca/` and this rubric (`.claude/skills/readiness-rubric/` on Claude Code,
`.agents/skills/readiness-rubric/` on every other engine) into the checkout for the run. They are not part of the repository: never count them, copy them or edit them,
and never treat them as evidence that the repository is ready. The probe already leaves them out.
The one use allowed is the Map step's: it reads the PROJECT memory (never global memory) as a
source of candidate facts that the user confirms on card A.

## The knowledge graph

worca may say a graph "has already been built at `graphify-out/`". The Map step moved it out of the
repository: it is at `map.graphDir` (a pipeline-directory path; on a workspace run one per member
under `map.members.<projectKey>.graphDir`). Read `<graphDir>/GRAPH_REPORT.md` or query
`<graphDir>/graph.json` there. On a workspace run whose map has `map.workspaceGraph`, read that file
instead of a member's `graphDir`. Never create or rebuild `graphify-out/` inside the repository; if one
appears in `git status`, remove it before you finish.
