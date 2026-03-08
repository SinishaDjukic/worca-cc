import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readSettings } from './settings-reader.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('settings-reader', () => {
  let dir;
  beforeEach(() => {
    dir = join(tmpdir(), `worca-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads agent config from settings.json', () => {
    const settings = {
      worca: {
        agents: { planner: { model: 'opus', max_turns: 40 } },
        loops: { implement_test: 10 }
      }
    };
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
    const result = readSettings(join(dir, 'settings.json'));
    expect(result.agents.planner.model).toBe('opus');
    expect(result.loops.implement_test).toBe(10);
  });

  it('returns defaults for missing file', () => {
    const result = readSettings(join(dir, 'missing.json'));
    expect(result.agents).toEqual({});
    expect(result.loops).toEqual({});
    expect(result.milestones).toEqual({});
    expect(result.stageUi).toEqual({});
  });

  it('reads optional UI stage config', () => {
    const settings = {
      worca: {
        ui: { stages: { deploy: { label: 'Deploy', icon: 'rocket' } } }
      }
    };
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
    const result = readSettings(join(dir, 'settings.json'));
    expect(result.stageUi.deploy.label).toBe('Deploy');
  });
});
