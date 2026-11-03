// TEMPORARY diagnostic for PR #1067 (Linux + Node 22: the file's process never exits). Removed with the fix.
import { after } from 'node:test';
const live = new Map();
for (const name of ['setTimeout', 'setInterval']) {
  const orig = globalThis[name];
  globalThis[name] = function (fn, ms, ...a) {
    const t = orig(fn, ms, ...a);
    live.set(t, { name, ms, stack: new Error().stack.split('\n').slice(2, 9).join(' | ') });
    return t;
  };
}
after(() => {
  setTimeout(() => {
    process.stderr.write(`\n[leak-dump ${process.argv[1]}] resources ${JSON.stringify(process.getActiveResourcesInfo())}\n`);
    for (const [t, info] of live) {
      if (t._destroyed || (typeof t.hasRef === 'function' && !t.hasRef())) continue;
      process.stderr.write(`[leak-dump] ${info.name} ${info.ms}ms ${info.stack}\n`);
    }
    process.exit(7);
  }, 20000).unref();
});
