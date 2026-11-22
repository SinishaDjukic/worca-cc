// test/helpers/import-recorder.mjs — a `--import` preload that appends every resolved module URL (import and
// require) to the file named by WORCA_TEST_IMPORT_LOG, one per line. Builtins only, so the preload itself loads no
// repo module; without the variable it registers nothing and writes no log. Used by test/helpers/flag-off.mjs.
import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const log = process.env.WORCA_TEST_IMPORT_LOG;
if (log) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      appendFileSync(log, `${result.url}\n`);
      return result;
    },
  });
}
