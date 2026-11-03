// TEMPORARY diagnostic for PR #1067 (Linux + Node 22: the file's process never exits). Removed with the fix.
import { after } from 'node:test';
import { execSync } from 'node:child_process';
const describe = (h) => {
  const o = { type: h?.constructor?.name };
  try {
    if (h.spawnfile) Object.assign(o, { pid: h.pid, file: h.spawnfile, args: h.spawnargs?.join(' ').slice(0, 300) });
    if ('fd' in (h._handle || {})) o.fd = h._handle.fd;
    if (h.remoteAddress) o.remote = `${h.remoteAddress}:${h.remotePort}`;
    if (h._idleTimeout) o.ms = h._idleTimeout;
    if (h._onTimeout) o.fn = String(h._onTimeout).slice(0, 300);
    if (h.listeners) o.data = h.listeners('data').map(String).map((s) => s.slice(0, 200));
    if (h.path) o.path = h.path;
  } catch (e) { o.err = String(e); }
  return o;
};
after(() => {
  setTimeout(() => {
    process.stderr.write(`\n[leak-dump ${process.argv[1]}] resources ${JSON.stringify(process.getActiveResourcesInfo())}\n`);
    for (const h of process._getActiveHandles()) process.stderr.write(`[leak-dump] ${JSON.stringify(describe(h))}\n`);
    try { process.stderr.write(execSync(`ps -o pid,ppid,pgid,stat,args --ppid ${process.pid} -g ${process.pid} 2>&1 || ps -ef`, { encoding: 'utf8' })); } catch (e) { process.stderr.write(String(e)); }
    try { process.stderr.write(execSync(`ls -l /proc/${process.pid}/fd 2>&1`, { encoding: 'utf8' })); } catch { /* not Linux */ }
    process.exit(7);
  }, 20000).unref();
});
