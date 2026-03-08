import { readFileSync } from 'node:fs';

export function readSettings(path) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const worca = raw.worca || {};
    return {
      agents: worca.agents || {},
      loops: worca.loops || {},
      milestones: worca.milestones || {},
      stageUi: worca.ui?.stages || {}
    };
  } catch {
    return { agents: {}, loops: {}, milestones: {}, stageUi: {} };
  }
}
