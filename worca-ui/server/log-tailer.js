import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { STAGE_ORDER_WITH_ORCHESTRATOR } from '../app/utils/stage-order.js';

/** Re-export for consumers (includes orchestrator). */
export const STAGE_ORDER = STAGE_ORDER_WITH_ORCHESTRATOR;

/**
 * Matches a persisted log record's `ISO-8601<TAB>rest` prefix.
 * Group 1 = the ISO timestamp, group 2 = everything after the first TAB (which
 * itself may begin with a `<stream>\t` token and may contain further tabs).
 */
const LOG_TS_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\t([\s\S]*)$/;

/**
 * Matches the optional origin-stream token in column 2: `out\t…` or `err\t…`.
 * The token is a fixed two-value enum, so a legacy message that merely happens
 * to start with other text is never mistaken for a stream tag.
 */
const STREAM_RE = /^(out|err)\t([\s\S]*)$/;

/**
 * Split a raw log line into its write-time, origin stream, and message.
 *
 * Canonical lines (written by `write_log_line` in log_lines.py) carry an
 * ISO-8601 timestamp and a `<stream>` token: `<ts>\t<stream>\t<text>`.
 * Legacy two-column lines (`<ts>\t<text>`) and untagged lines (no prefix at
 * all — e.g. old logs, some `orchestrator.log` records) default to
 * `stream: "out"`. Lines with no timestamp prefix return `ts: null` so the UI
 * renders an "unknown time" placeholder rather than a misleading current time.
 *
 * @param {string} raw
 * @returns {{ ts: string|null, stream: string, text: string }}
 */
export function parseLogLine(raw) {
  const m = LOG_TS_RE.exec(raw);
  if (m && Number.isFinite(Date.parse(m[1]))) {
    const sm = STREAM_RE.exec(m[2]);
    if (sm) {
      return { ts: m[1], stream: sm[1], text: sm[2] };
    }
    // Legacy two-column line — no recognized stream token → "out".
    return { ts: m[1], stream: 'out', text: m[2] };
  }
  return { ts: null, stream: 'out', text: raw };
}

/**
 * Parse an array of raw log lines into parallel `lines` (message text),
 * `timestamps` (ISO string or null), and `streams` (`"out"`/`"err"`) arrays —
 * the shape the `log-bulk` WS payload carries to the client.
 *
 * @param {string[]} rawLines
 * @returns {{ lines: string[], timestamps: (string|null)[], streams: string[] }}
 */
export function splitTimestamps(rawLines) {
  const lines = [];
  const timestamps = [];
  const streams = [];
  for (const raw of rawLines) {
    const { ts, stream, text } = parseLogLine(raw);
    lines.push(text);
    timestamps.push(ts);
    streams.push(stream);
  }
  return { lines, timestamps, streams };
}

export function resolveLogPath(worcaDir, stage, iteration = null) {
  if (!stage) return join(worcaDir, 'logs', 'orchestrator.log');
  if (iteration !== null) {
    return join(worcaDir, 'logs', stage, `iter-${iteration}.log`);
  }
  return join(worcaDir, 'logs', stage);
}

export function resolveIterationLogPath(worcaDir, stage, iteration) {
  return join(worcaDir, 'logs', stage, `iter-${iteration}.log`);
}

export function listIterationFiles(worcaDir, stage) {
  const stageDir = join(worcaDir, 'logs', stage);
  if (!existsSync(stageDir)) return [];
  try {
    return readdirSync(stageDir)
      .filter((f) => /^iter-\d+\.log$/.test(f))
      .sort((a, b) => {
        const an = parseInt(a.match(/\d+/)[0], 10);
        const bn = parseInt(b.match(/\d+/)[0], 10);
        return an - bn;
      })
      .map((f) => ({
        iteration: parseInt(f.match(/\d+/)[0], 10),
        path: join(stageDir, f),
      }));
  } catch {
    return [];
  }
}

export function readLastLines(filePath, n) {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export function countLines(filePath) {
  if (!existsSync(filePath)) return 0;
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.split('\n').filter((l) => l.length > 0).length;
  } catch {
    return 0;
  }
}

export function readLinesFrom(filePath, startLine) {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    return lines.slice(startLine);
  } catch {
    return [];
  }
}

/**
 * Return the byte length of a file (0 if missing/unreadable).
 * Used as the initial offset when starting to tail a log file.
 */
export function fileByteLength(filePath) {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Read new lines from a file starting at `byteOffset`.
 * Returns `{ lines: string[], newOffset: number }`.
 * Only the bytes after the offset are read, making this O(delta) instead of O(n).
 */
export function readNewLines(filePath, byteOffset) {
  try {
    const size = statSync(filePath).size;
    if (size <= byteOffset) return { lines: [], newOffset: byteOffset };
    const fd = openSync(filePath, 'r');
    try {
      const len = size - byteOffset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, byteOffset);
      const text = buf.toString('utf8');
      // Only consume up to the last newline. A trailing partial line (a write
      // still in progress) is left buffered for the next read so it is never
      // torn — important now that each line carries a timestamp prefix that
      // must arrive intact for the reader to parse it.
      const lastNl = text.lastIndexOf('\n');
      if (lastNl === -1) return { lines: [], newOffset: byteOffset };
      const consumed = text.slice(0, lastNl + 1);
      const lines = consumed.split('\n').filter((l) => l.length > 0);
      return {
        lines,
        newOffset: byteOffset + Buffer.byteLength(consumed, 'utf8'),
      };
    } finally {
      closeSync(fd);
    }
  } catch {
    return { lines: [], newOffset: byteOffset };
  }
}

export function listLogFiles(worcaDir) {
  const logsDir = join(worcaDir, 'logs');
  if (!existsSync(logsDir)) return [];
  try {
    const entries = readdirSync(logsDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.log')) {
        // Legacy flat file (e.g., orchestrator.log)
        files.push({
          stage: entry.name.replace('.log', ''),
          path: join(logsDir, entry.name),
        });
      } else if (entry.isDirectory()) {
        // Nested stage directory — list iteration files
        const iters = listIterationFiles(worcaDir, entry.name);
        for (const iter of iters) {
          files.push({
            stage: entry.name,
            iteration: iter.iteration,
            path: iter.path,
          });
        }
      }
    }

    // Sort by pipeline stage order, then by iteration
    files.sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(a.stage);
      const bi = STAGE_ORDER.indexOf(b.stage);
      const orderDiff = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      if (orderDiff !== 0) return orderDiff;
      return (a.iteration || 0) - (b.iteration || 0);
    });
    return files;
  } catch {
    return [];
  }
}
