---
name: ospec-propose
description: Create a complete, validated OpenSpec change for a request — openspec/changes/<id>/ with proposal.md, delta specs, design.md when warranted, and tasks.md — then stop before implementation. Use for "propose", "new OpenSpec change", or "spec this out".
---

# Propose an OpenSpec change

Use the `ospec-format` skill for every artifact's exact format (and `ospec-workspace` for discovery) when they are available. The essentials are repeated here.

1. **Discover.** Read `openspec/config.yaml` (`context`, `rules`), or `openspec/project.md` in a classic repo. If there is no `openspec/`, create `openspec/config.yaml` (`schema: spec-driven` plus a short `context`). Check for the CLI with `command -v openspec`. Never install it, and never run `openspec init`.
2. **Ask** about anything material the request leaves open before writing.
3. **Pick a change id**: kebab-case, verb-led, unique. Run `openspec new change <id>`, or create `openspec/changes/<id>/` with `.openspec.yaml` (`schema: spec-driven`, `created: <date>`).
4. **Write `proposal.md`**: Why / What Changes / Capabilities (New, Modified) / Impact.
5. **Write the delta specs**, one per capability: `specs/<capability>/spec.md` with `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`. Each `### Requirement:` has SHALL/MUST text and at least one `#### Scenario:` with `- **WHEN**` / `- **THEN**`. MODIFIED copies the whole existing block.
6. **Write `design.md`** only for cross-cutting, risky or ambiguous changes.
7. **Write `tasks.md`**: `## 1. Group`, `- [ ] 1.1 task`. Every task says how it is verified, and every requirement is covered.
8. **Validate**: `openspec validate <id> --strict` when the CLI is present, otherwise the `ospec-format` Validation checklist. Fix every error, then report the change id and the files written. Do not implement.
