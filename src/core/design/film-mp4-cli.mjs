#!/usr/bin/env node
// src/core/design/film-mp4-cli.mjs
// The child process of a video's MP4 export: `node film-mp4-cli.mjs <job.json> <chrome> <ffmpeg>`, started by
// film-mp4.mjs `renderFilmMp4`. It reports on stdout as JSON lines: `{type:'progress', done, total}` while it shoots,
// then `{type:'done', frames, seconds, bytes, violations}` (exit 0) or `{type:'error', message}` (exit 1).
// A closed stdin is its stop: the server closes it to stop the render, and it closes by itself when the server goes,
// so no browser or encoder outlives either. A stopped render exits 130 and says nothing.
import { readFileSync } from 'node:fs';
import { renderFilmJob } from './film-capture.mjs';

const [jobFile, chrome, ffmpeg] = process.argv.slice(2);
const stop = new AbortController();
for (const ev of ['end', 'close', 'error']) process.stdin.on(ev, () => stop.abort());
process.stdin.resume();

const say = (msg) => new Promise((done) => { process.stdout.write(`${JSON.stringify(msg)}\n`, () => done()); });

try {
  if (!jobFile || !chrome || !ffmpeg) throw new Error('usage: film-mp4-cli.mjs <job.json> <chrome> <ffmpeg>');
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  const made = await renderFilmJob(job, {
    chrome, ffmpeg, signal: stop.signal,
    onProgress: ({ done, total }) => { process.stdout.write(`${JSON.stringify({ type: 'progress', done, total })}\n`); },
  });
  await say({ type: 'done', ...made });
  process.exit(0);
} catch (e) {
  if (stop.signal.aborted) process.exit(130);
  await say({ type: 'error', message: e?.message ?? String(e) });
  process.exit(1);
}
