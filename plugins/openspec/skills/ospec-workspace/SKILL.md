---
name: ospec-workspace
description: How worca's OpenSpec agents find their footing in a repo — detecting the OPSX (openspec/config.yaml) or classic (openspec/project.md) layout, bootstrapping a missing openspec/, using the openspec CLI only when it is installed, resolving which change a step works on, and the change-brief format agents pass along.
---

# OpenSpec in a worca run

## Discovery

| Found | Layout | Project context comes from |
|---|---|---|
| `openspec/config.yaml` | OPSX (current) | its `context` string; per-artifact `rules.<proposal\|specs\|design\|tasks>` |
| `openspec/project.md`, no `config.yaml` | classic | `project.md` (read only; never migrate it) |
| neither | none | bootstrap (below) |

`openspec/AGENTS.md` (classic) holds generic instructions. Read it for hints; it does not override these skills.

## The CLI is optional

- Detect it with `command -v openspec`. Record `openspec --version` in the brief.
- **Never install it** (no `npm install -g`, no `npx @fission-ai/openspec`). Never run `openspec init` or `openspec update`; they write tool skills and commands into the repo.
- When present, use `openspec new change <id>`, `openspec validate <id> --strict [--json]`, `openspec list [--specs]`, `openspec show <id>`, `openspec status --change <id> --json`, `openspec instructions <artifact> --change <id>` and `openspec archive <id> --yes`. Always pass `--yes` or ids explicitly; nothing may wait on a TTY.
- When absent, follow `ospec-format` by hand. The result must be what the CLI would accept.

## Bootstrap (no `openspec/` yet)

Create only:

```yaml
# openspec/config.yaml
schema: spec-driven
context: |
  <3-8 lines: language, frameworks, test command, conventions — read from README and manifests>
```

plus `openspec/specs/.gitkeep` and `openspec/changes/.gitkeep`.

## New change folder without the CLI

`mkdir -p openspec/changes/<id>`, then write `openspec/changes/<id>/.openspec.yaml`:

```yaml
schema: spec-driven
created: <YYYY-MM-DD>
```

## Resolving the change

Apply these in order and use the first that matches:

1. A `Change id:` line in the brief, or a kebab-case token in the request that names an existing `openspec/changes/<token>/` folder (never `archive/`).
2. Exactly one active change folder exists under `openspec/changes/` (excluding `archive/`): use it.
3. Otherwise the change is **unresolved**. A producer changes nothing and says so. A verifier reports one critical issue listing the active changes.

## The change brief (the `change` port)

```markdown
# OpenSpec change brief

- Change id: `<id>`
- Change dir: `openspec/changes/<id>/`
- Layout: opsx | classic | bootstrapped
- Validator: openspec CLI <version> | manual (CLI not on PATH)
- Capabilities: new `<cap>` (<n> req, <m> scenarios); modified `<cap>` (…)
- Tasks: <groups> groups, <tasks> tasks

## Request
<the user's request, plus the clarify answers that shaped it>

## Findings to address
none
```

Each agent rewrites the whole brief, keeps the lines it does not own, and passes it on.
