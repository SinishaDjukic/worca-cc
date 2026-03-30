import { existsSync, openSync, readSync, readdirSync, readFileSync, statSync, closeSync } from 'node:fs';
import { join } from 'node:path';

/** Pipeline stage order for log display (orchestrator first, then stages in execution order). */
const STAGE_ORDER = [
  'orchestrator',
  'plan',
  'coordinate',
  'implement',
  'test',
  'review',
  'pr',
  'learn',
];

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
      const lines = text.split('\n').filter((l) => l.length > 0);
      return { lines, newOffset: size };
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
