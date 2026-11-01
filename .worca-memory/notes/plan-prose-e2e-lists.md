---
name: plan-prose-e2e-lists
description: When a plan specifies a server e2e test as a prose case list, replay it as code before calling the plan ready
updated: 2026-11-01T14:36:22.565Z
author: Bulibas
---
A plan's end-to-end test given only as a numbered prose case list ("say X → Y is posted") passed four plan reviews
and one refine cycle on audit alone (freeform Discord chat, 2026-11-01). Written and run against a full replay, the
production code was clean, but the case TEXT was not:
- 6 of 30 cases could not pass as worded. Examples: an assertion that a list is empty after an earlier case
  deliberately filled it; `Promise.all` over a call that is meant to reject; reading a DB row before its column is
  written; reusing a platform thread id that a UNIQUE key already holds; "restore the config", which does not clear
  keys because `writePluginConfig` merges (see [[plugin-config-write-merges]]).
- 4 cases were too weak to catch the guard they name. One was a dedup test where a busy guard also absorbs the
  duplicate. Another was a reconnect reconcile with no reconnect step, which needs `channelHost.reloadPlugin(name)`.
  A third was an `interactive` gate tested with freeform off, so the bridge ignores the message anyway.

How to apply (refiner): replay the server wiring from the plan's blocks into a checkpoint clone with a script. Then
split the cases over 2-3 lanes. Each lane appends its cases to a shared harness and runs them, then mutation-checks
the guards each case relies on. Merge the lanes into one green file (rename helper clashes, keep thread ids unique).
Put the complete file in the plan as a `(new file, complete)` block in place of the prose list. Case state flows in
file order, so the file must always be run whole.
