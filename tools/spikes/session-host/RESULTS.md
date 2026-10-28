# Session host spikes — results

CLI: <claude --version> local, 2.1.294 (Docker pin). Date: <YYYY-MM-DD>. Runner: <who>.

Owner-run only (BUILD-GUIDE): `WORCA_ALLOW_LIVE_CLAUDE=1 node tools/spikes/session-host/<script>.mjs`. Agents run `--dry` only.

| Spike | Pass | Facts (JSON) | Decision | Frames |
|---|---|---|---|---|
| S1 | not run | | | |
| S2 | not run | | | |
| S3 | not run | | | |
| S4 | not run | | | |
| S6 | not run | | | |
| S7a | not run | | | |
| S7b | not run | | | |
| S8b | not run | | | |
| S9 | not run | | | |
| S10-codex | not run | | | |
| S10-copilot | not run | | | |
| S10-opencode | not run | | | |

## Decisions

No spike has run: every value below is the plan's safe default. Replace each one with the recorded result (`S3` holds
the AND over both measured CLIs), then re-run the Task 11 check. Tasks 52 and 53 read this block; it must stay the
first fenced JSON block in this file.

```json
{ "HOST_TOOLS_MODE": "union", "HOST_MAIN_THREAD_GUARD": false, "HOST_GUARD_CONTEXT_FIELD": null,
  "HOST_BUDGET_IS_CUMULATIVE": true, "HOST_BUDGET_SUBTYPE": "error_max_budget_usd", "HOST_CUT_COST_RESTORED": true,
  "SUBAGENT_CAP_RE": "(?:sub-?agent|agent)s? (?:per session )?(?:limit|cap) (?:reached|exceeded)", "VANISHED_RE": "No conversation found", "HOST_ROTATE_DISPATCHES": 24, "RECONCILE_EST_REL": 0.15,
  "CHILD_INHERITS_PARENT": { "model": true, "effort": true }, "MEMBER_BASE_TOOLS": ["TodoWrite"],
  "dropDefinitionFields": [], "S3": { "denyReachesChildren": false, "hostGuardReachesChildren": false },
  "phase0Go": false, "S7b": { "ran": false, "pass": false }, "claudeGo": false,
  "engines": { "codex": false, "copilot": false, "opencode": false } }
```

## Notes for the owner

- `SUBAGENT_CAP_RE` above is Task 6's default, verbatim. It also matches "Concurrent subagent limit reached. You can
  run 20 subagents at once." (checked with node), so Task 53's `doesNotMatch` assertion fails until S6 records a
  measured fragment. A candidate that keeps the per-session matches and rejects the concurrent text:
  `/(?<!concurrent )\b(?:sub-?agent|agent)s? (?:per session )?(?:limit|cap) (?:reached|exceeded)/i`. In this JSON
  block its source needs the backslash escaped (`\\b`). Task 32 (run 4) pins the demux default from the same pattern.
- `INVALID_INPUT_RE` (Task 2): add it to the block when S1's `missingDescriptionText` is not null; until then Task 32's
  default `/InputValidationError|Invalid tool parameters|required parameter/i` stands.
- S3: `denyReachesChildren` / `allowedToolsReachChildren` / `toolsFlagRestrictsChildren` are `null` when the run gave
  no evidence (the child never tried, or the deny rule did not match the host: `denyMatchesHost`). `null` keeps the
  gate off.
- S2 and S4: inheritance, grant and kill facts are `null` when the run gave no evidence. `CHILD_INHERITS_PARENT` treats
  `null` as `true`; `HOST_BUDGET_IS_CUMULATIVE` and `HOST_CUT_COST_RESTORED` keep their defaults on `null`. S2's
  `effortEvidence.requests: 0` means the proxy saw nothing (Vertex/Bedrock routing bypasses `ANTHROPIC_BASE_URL`).
- S2 `toolsRestrict` / `maxTurnsHonoured`: `null` means no evidence. It is neither a pass nor a field that fails, so
  re-run S2 before deciding `dropDefinitionFields`. Task 31's `memberDefinition` emits no `maxTurns`, so
  `maxTurnsHonoured` is informational there.
- S6 `capSpansResumes`: `null` (no evidence) keeps `HOST_ROTATE_DISPATCHES` at 24, with the cap-refusal rotation as the
  safety net. Only `true` lowers it.
- S7b (Task 52): task B's baseline `npm test` is red because task A's bug is in the same repo. Measure task B with
  `npm run test:b` (and task A with `npm test` or `npm run test:a`). The fixture holds no `.git`, so build each trial's
  copy with `copyRepo` from `s7-prompt-and-quality.mjs` (a committed git repo under `$TMPDIR`).
- S7a refuses a live run while `CLAUDE_CODE_USE_VERTEX` or `CLAUDE_CODE_USE_BEDROCK` is on, because the proxy would see
  nothing. Run it with first-party auth, for example `env -u CLAUDE_CODE_USE_VERTEX WORCA_ALLOW_LIVE_CLAUDE=1 node …`.
- S9: the owner run writes `test/fixtures/session-host/claude-depth2.ndjson` through `strip`. Review it for paths
  or text before committing.
- Pass cells: S2, S3 and S9 print one verdict per CLI. Write them as `local / 2.1.294`, for example `true / false`. The
  suite test only needs the cell to be non-empty.
- Task 52's `s7b-pipeline-ab.mjs`, if built on `spikeContext`, refuses a live run without `WORCA_ALLOW_LIVE_CLAUDE=1`.
