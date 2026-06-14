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
 * Matches a persisted log record's `ISO-8601<TAB>message` prefix.
 * Group 1 = the ISO timestamp, group 2 = the message body (which may itself
 * contain tabs — we only split on the first TAB).
 */
const LOG_TS_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\t([\s\S]*)$/;

/**
 * Split a raw log line into its write-time and message.
 *
 * New-format lines (written by `_write_log_line` in claude_cli.py) carry an
 * ISO-8601 timestamp prefix. Legacy lines (written before this format existed)
 * have none — they return `{ ts: null, text: <raw line> }` so the UI can render
 * them with an "unknown time" placeholder rather than a misleading current time.
 *
 * @param {string} raw
 * @returns {{ ts: string|null, text: string }}
 */
export function parseLogLine(raw) {
  const m = LOG_TS_RE.exec(raw);
  if (m && Number.isFinite(Date.parse(m[1]))) {
    return { ts: m[1], text: m[2] };
  }
  return { ts: null, text: raw };
}

/**
 * Parse an array of raw log lines into parallel `lines` (message text) and
 * `timestamps` (ISO string or null) arrays, the shape the `log-bulk` WS payload
 * carries to the client.
 *
 * @param {string[]} rawLines
 * @returns {{ lines: string[], timestamps: (string|null)[] }}
 */
export function splitTimestamps(rawLines) {
  const lines = [];
  const timestamps = [];
  for (const raw of rawLines) {
    const { ts, text } = parseLogLine(raw);
    lines.push(text);
    timestamps.push(ts);
  }
  return { lines, timestamps };
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
