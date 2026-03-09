import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Pipeline stage order for log display (orchestrator first, then stages in execution order). */
const STAGE_ORDER = ['orchestrator', 'plan', 'coordinate', 'implement', 'test', 'review', 'pr'];

export function resolveLogPath(worcaDir, stage) {
  if (!stage) return join(worcaDir, 'logs', 'orchestrator.log');
  return join(worcaDir, 'logs', `${stage}.log`);
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
    const files = readdirSync(logsDir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({
        stage: f.replace('.log', ''),
        path: join(logsDir, f),
      }));
    // Sort by pipeline stage order; unknown stages go to the end
    files.sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(a.stage);
      const bi = STAGE_ORDER.indexOf(b.stage);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    return files;
  } catch {
    return [];
  }
}
