// src/core/workflow-tests/settings-canary.mjs — workflow tests 3b, Task 5 fix review (concern 8). Worca's own --settings
// payload in a Pretend try runs this as a SessionStart hook: it writes its marker (argv[2], a path in the try's run folder),
// so a spawn that ends without the marker shows Claude Code dropped Worca's settings file (and its guards) silently.
// It prints nothing: a SessionStart hook's stdout would reach the agent's context.
import { writeFileSync } from 'node:fs';

const marker = process.argv[2];
try { if (marker) writeFileSync(marker, 'ok'); } catch { /* the missing marker says it */ }
process.exit(0);
