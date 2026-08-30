// test/helpers/no-real-claude/assert-none.mjs
// Post-suite check for the PATH guard (package.json "test"). A non-empty
// real-claude-spawns.log means a test reached the guard shim with a real
// invocation (anything but --version/--help). generateTitle and friends swallow
// spawn failures, so without this the escape would stay silent. Prints the
// offenders and exits 1.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const log = process.env.WORCA_NO_REAL_CLAUDE_LOG
  || resolve(process.cwd(), '.worca-cc-test', 'real-claude-spawns.log');
if (!existsSync(log)) process.exit(0);
const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
if (lines.length === 0) process.exit(0);
console.error(`\n${lines.length} test spawn(s) reached the real-claude guard (${log}):`);
for (const l of lines.slice(0, 20)) console.error('  ' + l);
if (lines.length > 20) console.error(`  … ${lines.length - 20} more`);
console.error('Every claude spawn in the suite must go through claude:{mock:true} / claude:{bin} / WORCA_MOCK=1 / WORCA_CLAUDE_BIN.');
process.exit(1);
