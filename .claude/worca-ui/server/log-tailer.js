import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Pipeline stage order for log display (orchestrator first, then stages in execution order). */
const STAGE_ORDER = ['orchestrator', 'plan', 'coordinate', 'implement', 'test', 'review', 'pr'];

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
      .filter(f => /^iter-\d+\.log$/.test(f))
      .sort((a, b) => {
        const an = parseInt(a.match(/\d+/)[0]);
        const bn = parseInt(b.match(/\d+/)[0]);
        return an - bn;
      })
      .map(f => ({
        iteration: parseInt(f.match(/\d+/)[0]),
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
    const lines = content.split('\n').filter(l => l.length > 0);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export function countLines(filePath) {
  if (!existsSync(filePath)) return 0;
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.split('\n').filter(l => l.length > 0).length;
  } catch {
    return 0;
  }
}

export function readLinesFrom(filePath, startLine) {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.length > 0);
    return lines.slice(startLine);
  } catch {
    return [];
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
      } else if (entry.isDirectory() && STAGE_ORDER.includes(entry.name)) {
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
