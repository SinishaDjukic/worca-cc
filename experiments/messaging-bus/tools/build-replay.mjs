#!/usr/bin/env node
// experiments/messaging-bus/tools/build-replay.mjs — builds E7's replay fixture from a past Decompose run
// (plan §4.11). Run once by hand; tests never need it.
//   node experiments/messaging-bus/tools/build-replay.mjs --pipeline <dir> --out experiments/messaging-bus/test/fixtures/replay-decompose.json.gz
// Reads decomposition.json, tasks/*.md, live-log.ndjson, impl-review-cycle*.json and diff-patch.patch.
// Stores the real touch pattern (tool, repo-relative path, first word of a Bash command) and the final
// diff's hunks with their base/final blob ids; never the absolute run paths, never a Bash command line.
// Refusals (exit 1, stderr code): REPLAY_NO_PATCH, REPLAY_BAD_INDEX, REPLAY_TOO_BIG.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseTaskFiles } from '../lib/task-files.mjs';
import { parsePatch } from '../lib/replay-tree.mjs';
import { redactSecretValues } from '../lib/redact.mjs';

const MAX_BYTES = 150 * 1024;
const CALL_RE = /^→ (Edit|Write|MultiEdit|NotebookEdit|Bash)\b ?(.*)$/;
const EXEC_RE = /^x:n_implementer:(\d+)(?::(p(\d+)t\d+))?$/;
const IN_REPO = /\/runs\/[^/]+\/repos\/[^/]+\/(.+)$/;

function fail(code, message) {
  process.stderr.write(`${code} ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const o = { pipeline: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pipeline') o.pipeline = argv[++i];
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  if (!o.pipeline || !o.out) fail('REPLAY_USAGE', 'usage: build-replay.mjs --pipeline <dir> --out <file.json.gz>');
  return o;
}

export function buildFixture(dir) {
  const patchPath = join(dir, 'diff-patch.patch');
  if (!existsSync(patchPath)) fail('REPLAY_NO_PATCH', `no diff-patch.patch in ${dir}`);
  const decomposition = JSON.parse(readFileSync(join(dir, 'decomposition.json'), 'utf8'));
  const phases = decomposition.phases.map((p) => ({
    ordinal: p.ordinal,
    tasks: p.tasks.map((t) => {
      let text = '';
      try { text = readFileSync(join(dir, t.file), 'utf8'); } catch { text = ''; }
      return { id: t.id, files: parseTaskFiles(text).files };
    }),
  }));

  const calls = [];
  const fanOut = new Set();
  let t = 0;
  for (const line of readFileSync(join(dir, 'live-log.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const src = String(o.source ?? '');
    const sub = /^([a-z-]+) ▸ /.exec(src);
    if (sub) fanOut.add(sub[1]);
    const ex = EXEC_RE.exec(String(o.executionId ?? ''));
    const m = CALL_RE.exec(String(o.text ?? ''));
    if (!ex || !m || src !== 'implementer') continue;
    const fix = !ex[2];
    const call = { t: t++, task: fix ? 'fix' : ex[2], phase: fix ? 'fix' : Number(ex[3]), tool: m[1] };
    if (m[1] === 'Bash') {
      const w = m[2].trim().split(/\s+/)[0] ?? '';
      call.cmd0 = w.startsWith('/') ? basename(w) : w;
    } else {
      const rel = IN_REPO.exec(m[2].trim());
      call.path = rel ? rel[1] : null;
    }
    calls.push(call);
  }

  const files = parsePatch(readFileSync(patchPath, 'utf8')).filter((f) => f.status !== 'deleted');
  let masked = 0;
  for (const f of files) {
    if (f.status === 'modified' && !f.baseBlob) fail('REPLAY_BAD_INDEX', `${f.path}: a modified file without a base blob id`);
    for (const h of f.hunks) {
      h.lines = h.lines.map((l) => {
        const r = redactSecretValues(l);
        if (r !== l) masked += 1;
        return r;
      });
    }
  }
  const review = { cycles: [] };
  const cycles = readdirSync(dir).map((n) => /^impl-review-cycle(\d+)\.json$/.exec(n)).filter(Boolean).sort((a, b) => Number(a[1]) - Number(b[1]));
  for (const c of cycles) {
    const v = JSON.parse(readFileSync(join(dir, c[0]), 'utf8'));
    review.cycles.push({ blocking: (v.issues ?? []).filter((i) => i.severity === 'critical' || i.severity === 'major').length });
  }
  return {
    fixture: {
      v: 2,
      source: {
        pipeline: basename(dir),
        note: 'real touch pattern; content from the real final diff, applied to the real base blobs',
        fanOut: [...fanOut].sort(),
      },
      phases, calls, files, review,
    },
    masked,
  };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const { fixture, masked } = buildFixture(o.pipeline);
  const gz = gzipSync(Buffer.from(JSON.stringify(fixture)), { level: 9 });
  if (gz.length > MAX_BYTES) fail('REPLAY_TOO_BIG', `${gz.length} bytes over ${MAX_BYTES}`);
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, gz);
  process.stdout.write(`${JSON.stringify({ out: o.out, bytes: gz.length, calls: fixture.calls.length, files: fixture.files.length, maskedLines: masked })}\n`);
}

main();
