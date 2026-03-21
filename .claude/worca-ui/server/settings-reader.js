import { readMergedSettings } from './settings-merge.js';

export function readSettings(path) {
  try {
    const raw = readMergedSettings(path);
    const worca = raw.worca || {};
    return {
      agents: worca.agents || {},
      loops: worca.loops || {},
      milestones: worca.milestones || {},
      stageUi: worca.ui?.stages || {},
      learnEnabled: worca.stages?.learn?.enabled || false
    };
  } catch {
    return { agents: {}, loops: {}, milestones: {}, stageUi: {}, learnEnabled: false };
  }
}
