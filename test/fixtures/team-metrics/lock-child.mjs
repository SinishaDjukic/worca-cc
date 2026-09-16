import { appendFileSync } from 'node:fs';
import { withLock } from '../../../src/core/metrics/lock.mjs';
const [lock, log, tag] = process.argv.slice(2);
for (let i = 0; i < 2; i++) {
  await withLock(lock, async () => {
    appendFileSync(log, `enter ${tag}\n`);
    await new Promise((r) => setTimeout(r, 80));
    appendFileSync(log, `exit ${tag}\n`);
  }, { pollMs: 10 });
}
