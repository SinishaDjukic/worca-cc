# Usage circles: AI plan usage per provider in the profile

## Goal

Show how much of each AI provider's plan limit is used, as circles: around the profile avatar, as a
Usage row in the profile menu, and in a Usage submenu with one block per provider. The behaviour and
layout follow the Stillhet prototype's usage rings; the look is dev's current look, built from dev's
design-system library and tokens (`ui/public/design-system/components`, `docs/design-system.md`
Foundations and Components). Never Stillhet's look, colours, CSS or code.

Mocks (dev's look, sample figures): `plans/mocks/profile-avatar-usage-rings.png`,
`plans/mocks/profile-menu-usage-light.png`, `plans/mocks/profile-menu-usage-dark.png`
(on branch `feat/usage`, worktree `~/src/worka-cc-usage`).

Every figure is real, read from the provider. If a provider gives nothing, nothing is drawn for it.
No feature flag (small feature). Out of scope: a warning-line setting, alerts or updates on a limit,
budget changes, moving the spend card, any plan name.

## What each provider supplies (validated 2026-11-18)

Full evidence with sources: `~/worca-test/copilot/usage-providers-validation.md`.

| Provider | Source Worca reads | Windows | Units | Who gets it |
|---|---|---|---|---|
| Claude Code | `rate_limit_event` frame in `claude -p --output-format stream-json` (`rate_limit_info`) | `five_hour` → Session, `seven_day` → Week | `utilization` fraction 0..1 (can exceed 1); `resetsAt` epoch seconds | claude.ai subscription sign-in only; none for API key, Bedrock, Vertex |
| Codex | last `event_msg` `token_count` line in the thread's session file (`<CODEX_HOME>/sessions/**/rollout-*.jsonl`), field `payload.rate_limits` | `primary` / `secondary`, mapped by `window_minutes` (300 → Session, 10080 → Week, 1440 → Day) | `used_percent` 0..100; `resets_at` epoch seconds (older CLIs: `resets_in_seconds`) | ChatGPT sign-in only; none with an API key |
| Gemini CLI | `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` `{project}` with the user's Login-with-Google token (the call the CLI itself makes) | per-model daily buckets → Day | `remainingFraction` 0..1 (share LEFT: used = 1 − it); `resetTime` ISO-8601 | Login with Google / Code Assist only; none for Gemini API key or Vertex |

Facts the build must respect:
- Claude: `unifiedWindows` (`{five_hour:{utilization,resetsAt}, seven_day:{…}}`) is tagged @internal in the
  CLI; the documented fallback is the top-level `rateLimitType` + `utilization` + `resetsAt`, which describes
  ONLY the window currently limiting. A top-level reading updates only the window it names, never the other.
  Other `rateLimitType` values (`seven_day_opus`, `seven_day_sonnet`, `overage`, `seven_day_overage_included`)
  are ignored. The event comes after model responses, on change; dev's normaliser
  (`src/core/engines/claude-events.mjs`) drops it today.
- Codex: `codex exec --json` (what dev runs, `src/core/engines/codex.mjs`) does NOT emit rate limits; the
  session file does, on every model response. Dev already reads that file for token usage
  (`codexRolloutUsage`); read `rate_limits` from the same last `token_count` line.
- Gemini: no headless output carries quota. The endpoint is internal and undocumented: read it defensively,
  at most once a minute, only while a Gemini sign-in exists, through Worca's egress policy, never log the
  token, never refresh or write the user's credentials (an expired token means no reading). If the call is
  not possible within Worca's security rules (egress, credential handling), Gemini is shown as no data and the
  PR says why. Bucket choice: the bucket of the model Worca runs on Gemini; else the most used bucket.

## Core (small and separate)

- `src/core/usage-limits.mjs` (new): keeps the latest reading per engine
  `{ engine, observedAt, windows: { session?|week?|day?: { pct 0..100 int, resetsAt ms } } }`, persisted to
  `usage-limits.json` under WORCA_HOME (atomic write, only on change); `GET /api/usage-limits` returns
  `{ harnesses: [{ engine, observedAt, windows: [{ kind, pct, resetsAt }] }] }`, dropping windows whose reset
  has passed and engines with none left. The Stillhet branch (`design/stillhet-shaping`, worktree
  `~/src/worka-cc-stillhet-shaping`, `src/core/usage-limits.mjs`, `claude-events.mjs` `limitOf`,
  `run-harness.mjs` and `ask/turn.mjs` callers) had a version for Claude: port the logic, not its UI.
- Fed by: Claude limit events from runs AND chats; Codex after each turn from the session file; Gemini by the
  quota call. A run paused on a usage limit (`pauseReason: 'usage_limit'`, `limitEngine`, `limitResetAt`,
  already in dev) shows its engine's Session window as 100% until that reset.
- Push changes to the UI the way the budget is pushed, or poll at most once a minute; no busy polling.

## UI (dev's look, Stillhet's behaviour)

1. **Avatar rings** (`#side-acct`, `ui/public/account-menu.mjs`, `ui/public/shell/account-corner.css`): up to
   two concentric rings. Outer = Session, inner = the long window (Week, else Day). Each ring is the provider
   closest to its limit for that slot. Neutral below the warning line, amber at it (dev's `BUDGET_WARN_AT`,
   80%), red and full at 100%. A slot nobody reports is not drawn; no reading at all = no ring.
   These rings replace the avatar's spend ring; spend stays in the spend card. The avatar shrinks to fit two
   rings. The tooltip and aria-label name each ring: "Session · Codex: 86%, resets 14:50".
2. **Usage row** in the profile menu, the last section (right above the avatar): a mini ring of the tightest
   window, label "Usage", value "<Provider> <pct>%" ("Reached" at 100%), chevron. Hidden when no provider has a
   reading. Opens the submenu.
3. **Usage submenu** beside the menu, same mechanism as Interface mode (`createFlyout` mode 'beside'):
   heading "Limits"; one block per provider with a reading: name (Claude Code, Codex, Gemini) and
   "as of HH:MM" (observedAt); one row per window: mini ring, Session / Week / Day, pct ("Reached" at 100%),
   "resets <time or weekday time>". Row tooltip says where the figure comes from ("Reported by Codex").
4. Every interface mode (Simple and up). Keyboard and screen reader like the Interface mode submenu.

## Edge cases (each one tested)

- No reading yet (fresh install, no run since): nothing drawn, no Usage row; never 0%.
- API-key / Bedrock / Vertex / Gemini API key logins: no figures, so nothing drawn for that provider.
- Reset time passed: the window is dropped; a provider with no windows left disappears.
- Utilization above 1 (paid overage): clamp to 100%, shown as Reached.
- Only one Claude window in an event (top-level shape): update that window only.
- Codex `resets_in_seconds` (older CLI): convert from observedAt; unknown `window_minutes`: ignore that window.
- Gemini: several model buckets; `remainingFraction` inverted to used; expired token or call error: keep the
  last reading until its reset, never show an error figure.
- Malformed or partial lines, torn last line in a session file, a frame split mid-line: ignored, no crash.
- Reset times in seconds, ms and ISO: normalised to ms on ingest.
- Units mismatch: fraction vs percent never mixed (store integer pct 0..100).
- Corrupt `usage-limits.json`: read as empty.
- A run paused on a usage limit while the provider's last reading is lower: Session shows 100% until reset.
- Narrow screen: the submenu replaces the menu with a way back, like Interface mode.
- Light and dark themes.

## Tests

- Unit: Claude normaliser (both shapes, ignored types, >1), Codex `rate_limits` reader (both reset fields,
  window mapping), Gemini bucket mapping and inversion, store (persist, change-only, reset drop, corrupt file),
  route payload.
- UI models/painters in `account-menu.mjs` style (pure, detached DOM): rings per slot, tones, hidden states,
  row value, submenu blocks, labels.
- The related suite passes (`npm run test:related`); design-system gates pass.

## Done means

- The avatar, the Usage row and the submenu show real figures from core for every provider that reports them,
  match the mocks in dev's look, light and dark.
- Verified live with a real Claude subscription run on this machine (Codex and Gemini are not installed here:
  verified by recorded fixtures shaped exactly as their sources above; say so in the PR).
- Clicked through in a running app (own HOME and WORCA_HOME) before the PR is marked ready.
- Commits stay local; the PR is opened by hand later.
