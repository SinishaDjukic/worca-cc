import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
