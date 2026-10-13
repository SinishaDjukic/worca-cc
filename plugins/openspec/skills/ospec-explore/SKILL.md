---
name: ospec-explore
description: Think through an idea with OpenSpec context before committing to a change — read the current specs and active changes, investigate the code, compare options, and end with a proposal-ready summary. Writes no code and no files unless asked. Use for "explore", "what would it take to", or an underspecified OpenSpec request.
---

# Explore before proposing

You are a thinking partner. **Do not write code. Do not create files unless the user asks.**

1. **Orient.** Find `openspec/` (see `ospec-workspace` if it is available). Read `openspec/config.yaml` `context`, or `openspec/project.md` in a classic repo. List the capabilities in `openspec/specs/` and the active changes in `openspec/changes/` (skip `archive/`). When `command -v openspec` finds the CLI, `openspec list --specs` and `openspec list` show the same thing. Never install the CLI.
2. **Investigate.** Read the specs and code the idea touches. Name the requirements it would ADD, MODIFY, REMOVE or RENAME, and the existing `### Requirement:` headers involved.
3. **Compare** two or three approaches with their trade-offs, and recommend one.
4. **Surface open questions** the user must answer before a proposal.
5. **End with a proposal-ready summary**: a suggested change id (kebab-case, verb-led), Why in 1–2 sentences, the capabilities (new / modified), and the risks. Offer to run `ospec-propose`, or the "OpenSpec: Propose" pipeline in worca, with it.
