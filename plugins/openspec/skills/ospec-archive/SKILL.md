---
name: ospec-archive
description: Archive a finished OpenSpec change — merge its delta specs into openspec/specs/ (RENAMED, REMOVED, MODIFIED, ADDED) and move the folder to openspec/changes/archive/YYYY-MM-DD-<id>/, with `openspec archive <id> --yes` when the CLI is installed and by hand otherwise. Use for "archive", "finish the change", or "merge the specs".
---

# Archive an OpenSpec change

1. **Pick the change** (named id, or the only active one). Unticked tasks in `tasks.md` are a warning, not a blocker. Report them.
2. **CLI installed** (`command -v openspec`): `openspec archive <id> --yes`. It validates, merges and moves the folder. On a non-zero exit, report its output and stop. Never install the CLI.
3. **Otherwise, merge by hand.** For each `openspec/changes/<id>/specs/<capability>/spec.md`, with main spec `openspec/specs/<capability>/spec.md`:

## Manual merge

- **No main spec yet**: create it as `# <Capability> Specification`, then `## Purpose` (the delta's Purpose, or `TBD — update Purpose after archive.`), then `## Requirements`.
- Apply the delta sections in this order:
  1. **RENAMED**: for each FROM/TO pair, retitle `### Requirement: <from>` to `### Requirement: <to>` in place.
  2. **REMOVED**: delete each named requirement block: its `### Requirement:` line up to the next `### Requirement:` or the end of the file. Drop the Reason/Migration lines; they live on in the archive.
  3. **MODIFIED**: replace the whole block whose header matches (ignoring whitespace) with the delta's block.
  4. **ADDED**: append each block at the end of `## Requirements`.
- A header that does not match is an error: stop and report it rather than guess.
- If a capability ends with no requirements, keep the file unless `.openspec.yaml` sets `retire_capabilities: true`.

4. **Move the folder**: `mkdir -p openspec/changes/archive && mv openspec/changes/<id> openspec/changes/archive/$(date +%F)-<id>`.
5. **Report** the archive path and, per capability, `+added ~modified -removed →renamed`.
