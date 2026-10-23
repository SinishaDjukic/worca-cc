// src/core/ui-supervisor.mjs
// The `worca ui` loop around ui/server.mjs (issue #841). The server never installs over itself: it
// writes the request, drains, and exits UPDATE_EXIT_CODE. This loop installs and starts it again.
// Imported STATICALLY by worca-cc.mjs: after `npm i -g` the files on disk are the new version's,
// and a lazy import here would mix versions.
import { canAutoRestart, canonicalVersion } from './update-check.mjs';
import { UPDATE_EXIT_CODE, startCommand } from './ui-update.mjs';

// A server that keeps exiting UPDATE_EXIT_CODE without a valid request would spin this loop.
const MAX_EMPTY_UPDATE_EXITS = 3;

export async function superviseUi({
  startServer, install, readRecord, writeRecord, log = () => {}, signal = null,
  now = () => new Date().toISOString(), dryRun = false, isAutoRestartable = canAutoRestart,
}) {
  let empty = 0;
  for (;;) {
    const code = await startServer();
    if (code !== UPDATE_EXIT_CODE) return code;
    if (signal?.aborted) return 130;
    const rec = readRecord();
    const to = canonicalVersion(rec?.to);
    if (!rec || rec.state !== 'requested' || !to) {
      if (++empty >= MAX_EMPTY_UPDATE_EXITS) {
        log('worca: the server keeps asking for an update without a valid request; stopping.');
        return 1;
      }
      log('worca: the server asked for an update but left no valid request; starting it again.');
      continue;
    }
    empty = 0;
    const base = { from: canonicalVersion(rec.from), to, port: rec.port, requestedAt: rec.requestedAt };
    writeRecord({ ...base, state: 'installing', startedAt: now() });
    log(`worca: stopped for the update. Installing @worca/app@${to} (Worca is offline until it finishes)…`);
    const r = dryRun ? { ok: true, output: '' } : await install(to, { signal });
    if (signal?.aborted) {
      writeRecord({ ...base, state: 'failed', reason: 'The update was stopped before it finished.', output: r.output || '', finishedAt: now() });
      return 130;
    }
    if (!r.ok) {
      writeRecord({ ...base, state: 'failed', reason: r.reason, output: r.output || '', finishedAt: now() });
      log(`worca: the update to ${to} failed: ${r.reason}. Starting Worca ${base.from} again.`);
      if (r.output) log(r.output);
      continue;
    }
    if (!isAutoRestartable(to)) {
      writeRecord({ ...base, state: 'installed', autoRestart: false, finishedAt: now() });
      log(`worca: installed Worca ${to}. It is older than 1.14.0 and cannot start itself again.\n  Start it with: ${startCommand(base.port)}`);
      return 0;
    }
    writeRecord({ ...base, state: 'installed', autoRestart: true, finishedAt: now() });
    log(`worca: installed Worca ${to}; starting it.`);
  }
}
