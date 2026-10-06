---
name: enable-rubric
description: Score a repository's AI-readiness on nine dimensions and write the readiness report, JSON and HTML scorecard. Used by the AI analysis and AI enablement pipelines.
---

# AI-readiness rubric

Score 0–100 per dimension; the overall `score` is the weighted mean (weights in brackets), rounded to the nearest integer.
Use `null` for a dimension that does not apply; `null` dimensions are excluded from the mean.

| key | [w] | What 100 means | What 0 means |
|---|---|---|---|
| docs | 15 | CLAUDE.md states verified build/test/run commands, architecture, conventions, gotchas | no assistant docs |
| skillsAgents | 15 | `.claude/skills/*` and `.claude/agents/*` exist, frontmatter parses, paths referenced exist | none |
| rules | 10 | rules are checkable and project-specific | absent or generic |
| tests | 10 | the chosen test tier exists and runs | no test setup |
| featureSkillCoverage | 10 | every skill candidate above the ROI bar has a skill (null when no candidates) | none covered |
| realTests | 10 | a passing test exists over at least one pure unit (null when no pure units) | none |
| vendoring | 10 | requested bundled skills present with provenance headers and VENDORED.md | none |
| multiTool | 10 | every requested target (AGENTS.md, .cursor/rules, .github/copilot-instructions.md) exists and is self-sufficient | missing or stub |
| codeHealth | 10 | tests pass, no dead entry points, no broken commands | broken |

Hard failures (always a `critical` finding, regardless of score): a CLAUDE.md command that errors;
skill or agent frontmatter that does not parse; a requested multi-tool file missing or pointer-only;
a seeded test that does not run; `realTests` unmet while pure units exist.
Soft dimensions (lower the score, never block): featureSkillCoverage, agent coverage inside skillsAgents.
A repository with no tests, no pure units or no skill candidates is scored with `null` in
`realTests` / `featureSkillCoverage`: that is "not applicable", never a blocking issue.
Pass threshold: 80 unless the clarify answers override it.

## readiness.json

```json
{ "score": 0, "baselineScore": null, "delta": null,
  "dimensions": { "docs": 0, "skillsAgents": 0, "rules": 0, "tests": 0,
    "featureSkillCoverage": null, "realTests": null, "vendoring": 0, "multiTool": 0, "codeHealth": 0 },
  "gaps": [ { "id": "g1", "dimension": "docs", "severity": "major", "title": "", "detail": "", "fix": "" } ],
  "note": "" }
```

`delta` is `score - baselineScore`, or `null` without a baseline. `gaps[].severity` uses
critical | major | minor | suggestion. `gaps[].fix` is the one-line action that would close it.
The nine dimension keys are fixed and spelled exactly as above; never add, drop or rename one.

## readiness.md

Heading `# AI-readiness: <score>/100` then, when a baseline exists, one line
`Started at <baselineScore>/100, now <score>/100 (<+/-delta>).` Then a table of the nine dimensions,
then `## Gaps` as a list ordered by severity, then `## What exists` (one paragraph).

## readiness.html

One self-contained file: inline `<style>`, inline `<script>` only, no `src`, no `href` to other files,
no network. Layout: a header with the score ring and the baseline→final delta; one card per
dimension (name, score bar, one-line reason, `n/a` when null); a gaps section with one card per gap
showing severity chip, title, detail, fix. Colours use `light-dark()` or
`@media (prefers-color-scheme: dark)` so both themes read. Width fluid from 360px up.
Do not embed secrets, absolute paths or the user's home directory in the file.
Embed the readiness JSON once as a `<script type="application/json" id="readiness">` block so the
page can be re-read by a human or a tool; render from it with inline script, and render the
same content statically in the markup so the card still reads with scripts blocked.
