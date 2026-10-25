---
name: review-baseline-and-suite-noise
description: Read before reviewing a worca run's diff or proving new tests catch their fixes — the checkpoint may not be the base, and many guard removals stay green.
updated: 2026-10-25T19:50:31.802Z
author: Bulibas
---

**Checkpoint ref can be the wrong baseline.** A reviewer prompt's "pre-implementation checkpoint" (e.g. `b146c1cf` on
`dev`) may NOT be an ancestor of the run branch's HEAD; `git diff <checkpoint>` then mixes in dozens of unrelated files.
Check `git merge-base --is-ancestor <ref> HEAD` first. If it fails, review `git diff HEAD` (implementers leave work
uncommitted/intent-to-added) and cross-check `git status`. If the implementers committed (clean tree, empty
`git diff HEAD`), diff the parent branch head instead (`git diff <parent-branch-head> HEAD`, from `git log --oneline -n 12`).

**The run's base can be a feature branch far behind `origin/dev`** (2026-10-17: cut from
`feat/worca-ai-enablement-plugin`, merge-base 2026-10-06, while dev already had per-member workspace PRs #520,
`pipeline_member_prs`). When a plan says "check whether X exists" or a conclusion rests on something being absent,
also run `git merge-base HEAD origin/dev` and `git show origin/dev:<file> | grep <symbol>`, and report a divergence
as an integration risk.

**A fix-cycle review (cycle 2+) has no committed "before".** The fix lands uncommitted on the cycle-1 tree.
- At the START of every review save `git diff <checkpoint> > <your scratchpad>/c<N>.diff` (intent-to-added new files
  are in it) and name that path in the review. The next cycle rebuilds the tree it saw: `git archive <checkpoint> |
  tar -x -C <dir>`, `git apply <prev scratchpad>/cN.diff`, then `cmp`/`diff -u` each changed file against the worktree
  (exact; worked on team memory 1b cycles 3 and 4). If cycle 1 found the code byte-identical to the plan's whole-file
  blocks, `diff -u` the extracted blocks instead; otherwise fall back to modification times (`stat -f '%Sm %N'`).

**Prove each new test catches its fix — in cycle 1 too, for every new guard branch** (a `continue`, a throw, a
route's `if (!check) return`), even when the tests are copied verbatim from a reviewed plan: plan tests check happy paths.
- Copy the worktree to a scratch folder without `node_modules`, `.git`, `.worca-cc-test` and `graphify-out`
  (`rsync -a`; the Linux run host has no rsync: `tar -c --exclude=./node_modules --exclude=./.git … . | tar -x -C <scratch>`),
  symlink the worktree's own `npm ci`-installed `node_modules` (see [[run-worktree-needs-npm-ci]]), revert one fix at a
  time and run `npm test -- <its test file>` (a scoped run makes its own homes). A python script that `str.replace`s
  one guard, runs `node tools/test.mjs <files>` under a temp HOME, then restores the file, does 18 guards in ~10 min.
- Survivors seen: 2 of 17 fixes (2026-10-17); 8 of 18 guards on team memory 1b, among them the origin check on 5 of
  6 routes; 8 of 13 guards that a plan's own "guard-removal spot checks" list did NOT name (Clef pre-pass 2026-10-19:
  the credential-broker refusal `refuseWithBroker` in a new provider patch, a new `findLocalCredentials` key, a typed
  request-body ID put into a URL next to a stored token). The broker-refusal test to copy is `test/bridge-broker.test.mjs`
  "provider keys, tests and the Copilot sign-in move to the key page"; `patchSpeech`'s refusal is untested there too.
- Revert the CALL-SITE option too, not only the helper's guard: on R14 (2026-10-24) dropping `root: workRoot` where
  `runCursorProcess` passes it to `writeCursorProjectFiles` stayed green because the new test calls the helper directly.
  An implementer's "N/N guards red" claim counts helper guards only.
  A new runClaude settings option has THREE call sites: `claude-argv-snapshot` catches only the `runClaude` forward
  and `runClaudeProcess`'s stage call. Dropping it from `planClaudeInvocation`'s `buildSettingsPayload` call (the
  staged `settings.json` used once argv passes `ARGV_INLINE_LIMIT`, 20000) stayed green across 15 files (promo
  path guard, 2026-10-25). Demand a `planClaudeInvocation({prompt:'x'.repeat(30000), …}, {dir})` row that reads the staged file.
- A test of a deadline or timeout fix must assert a `settled` flag one `setImmediate` after the fake-clock tick, not
  `await` the promise: reverted, an `await` hangs to the per-file timeout instead of failing (2026-10-18).

Judging a red, cancelled or hung full suite: [[test-suite-known-failures]].
