// tools/flaky-register.mjs — #919 slice 2: which failing tests in an `npm test` log are not in test/flaky-register.json.
//   node tools/flaky-register.mjs LOG   prints each unlisted failure; exit 1 when there is one, 2 when the log is unreadable
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FILE_LEVEL = '(file-level failure)';
const ESC = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');   // FORCE_COLOR=1 logs carry ANSI codes

/**
 * The spec reporter's "✖ failing tests:" section (tools/test-run.mjs composes `spec`) → [{file, test}].
 * `test at FILE:L:C` names the file (absolute paths are cut back to `test/…`); the `✖ TITLE (ms)` after it is the test.
 * A title equal to the file path is a file-level failure (a load error or a failing hook). Throws when the log has no
 * `ℹ fail N` line, or when N > 0 and nothing was parsed, so a changed reporter cannot pass silently.
 */
export function parseFailures(log) {
  const lines = String(log).replace(ESC, '').split('\n');
  const sum = lines.map((l) => /^ℹ fail (\d+)\s*$/.exec(l)).filter(Boolean).at(-1);
  if (!sum) throw new Error('flaky register: the log has no "ℹ fail N" summary (not a node tools/test.mjs log?)');
  const start = lines.findIndex((l) => /^✖ failing tests:\s*$/.test(l));
  const out = []; let file = null;
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    const at = /^test at (?:.*\/)?(test\/\S+?\.mjs):\d+:\d+\s*$/.exec(line);
    if (at) { file = at[1]; continue; }
    const bad = /^\s*✖ (.+?)(?: \([\d.]+m?s\))?\s*$/.exec(line);
    if (bad && file) {
      const title = bad[1].replace(/^(?:.*\/)?(test\/\S+?\.mjs)$/, '$1');
      out.push({ file, test: title === file ? FILE_LEVEL : bad[1] });
      file = null;
    }
  }
  if (Number(sum[1]) > 0 && !out.length) throw new Error(`flaky register: the log reports ${sum[1]} failures but none were parsed`);
  return out;
}

/** Failures no register row covers: same file, and the title prefix before "…", or `test: "*"` for a file-level failure. */
export function unlistedFailures(log, register) {
  const empty = register.find((e) => e.test !== '*' && !e.test.split('…')[0].trim());
  if (empty) throw new Error(`flaky register: ${empty.file} row has an empty title prefix, which would cover every failure in its file`);
  return parseFailures(log).filter(({ file, test }) => !register.some((e) => e.file === file
    && (test === FILE_LEVEL ? e.test === '*' : e.test !== '*' && test.startsWith(e.test.split('…')[0].trim()))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const reg = JSON.parse(readFileSync(new URL('../test/flaky-register.json', import.meta.url), 'utf8'));
  try {
    const left = unlistedFailures(readFileSync(process.argv[2], 'utf8'), reg);
    for (const f of left) console.log(`not in the flaky register: ${f.file} — ${f.test}`);
    process.exitCode = left.length ? 1 : 0;
  } catch (e) { console.log(`FAIL (fatal) ${e.message}`); process.exitCode = 2; }
}
