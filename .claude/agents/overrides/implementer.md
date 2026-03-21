# Implementer Overlay
#
# This file customizes the Implementer agent for this project.
# Place overrides in "## Override: <SectionName>" blocks.
# The section name must match a ## heading in the core implementer.md.
# Default behavior: content is APPENDED to the matching section.
# To REPLACE the matching section entirely, add <!-- replace --> on
# the line immediately after the ## Override: heading.
#
# Governance-protected sections (tagged <!-- governance --> in core)
# cannot be replaced; the replace marker is silently ignored for them.

## Override: Rules

- Use TypeScript with `strict: true` for all new files in this project.
- Test files must be named `<module>.test.ts` (not `.spec.ts`).
- All commits must follow Conventional Commits: `feat(<scope>): <description>`.
