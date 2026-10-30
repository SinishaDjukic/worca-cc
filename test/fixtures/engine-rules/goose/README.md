# Goose: no rule fixtures

Goose holds no permission rule worca can set per spawn: its `permission.yaml` is per tool name and user-wide, and worca
does not write it. Its catalog entry (`ENGINES.goose.rules`) lists no kind, so every kind is `unenforced` and a guardrail
set with deny rules needs `--allow-unguarded-engine` (`test/engine-gate.test.mjs`). With no `held` or `partial` kind,
there is no translation and no denial to record here. A rule kind moves out of `unenforced` only with both files
(`../README.md`).
