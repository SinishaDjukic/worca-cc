// src/core/ask/grep-worker.mjs
// One Codex-chat grep, off the caller's thread (file-reader.mjs grep): the model's regular expression can backtrack for
// as long as it likes here, and the caller terminates this worker when its time is up. Matches come back unredacted;
// the caller redacts them.
import { parentPort, workerData } from 'node:worker_threads';
import { createAskFileReader } from './file-reader.mjs';

const { roots, home, rules, limits, input } = workerData;
try {
  parentPort.postMessage(createAskFileReader({ roots, home, rules, limits }).grepRaw(input));
} catch (err) {
  parentPort.postMessage({ error: { name: err?.name || 'Error', message: err?.message || String(err) } });
}
