import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function createRunId(status) {
  const key = `${status.started_at}:${status.work_request?.title || ''}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function isTerminal(status) {
  if (!status.stages) return false;
  const values = Object.values(status.stages);
  return values.length > 0 && values.every(s =>
    s.status === 'completed' || s.status === 'error'
  );
}

export function discoverRuns(worcaDir) {
  const runs = [];

  const statusPath = join(worcaDir, 'status.json');
  if (existsSync(statusPath)) {
    try {
      const status = JSON.parse(readFileSync(statusPath, 'utf8'));
      runs.push({ id: createRunId(status), active: !isTerminal(status), ...status });
    } catch { /* ignore malformed */ }
  }

  const resultsDir = join(worcaDir, 'results');
  if (existsSync(resultsDir)) {
    for (const file of readdirSync(resultsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(resultsDir, file), 'utf8'));
        if (data.started_at) {
          runs.push({ id: createRunId(data), active: false, ...data });
        }
      } catch { /* ignore */ }
    }
  }

  return runs;
}
