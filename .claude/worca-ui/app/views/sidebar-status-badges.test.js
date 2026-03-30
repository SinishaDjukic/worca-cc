import { describe, expect, it } from 'vitest';
import { projectStatus } from './sidebar.js';

describe('projectStatus', () => {
  it('returns idle when no runs exist', () => {
    expect(projectStatus('proj-1', {})).toBe('idle');
  });

  it('returns running when any run has pipeline_status running', () => {
    const runs = {
      r1: { pipeline_status: 'running', active: true },
    };
    expect(projectStatus('proj-1', runs)).toBe('running');
  });

  it('returns error when any run has pipeline_status failed', () => {
    const runs = {
      r1: { pipeline_status: 'failed', active: false },
    };
    expect(projectStatus('proj-1', runs)).toBe('error');
  });

  it('returns error when any run has pipeline_status error', () => {
    const runs = {
      r1: { pipeline_status: 'error', active: false },
    };
    expect(projectStatus('proj-1', runs)).toBe('error');
  });

  it('returns paused when any run has pipeline_status paused', () => {
    const runs = {
      r1: { pipeline_status: 'paused', active: false },
    };
    expect(projectStatus('proj-1', runs)).toBe('paused');
  });

  it('returns paused when any run has pipeline_status approval_needed', () => {
    const runs = {
      r1: { pipeline_status: 'approval_needed', active: false },
    };
    expect(projectStatus('proj-1', runs)).toBe('paused');
  });

  it('running takes priority over error and paused', () => {
    const runs = {
      r1: { pipeline_status: 'failed', active: false },
      r2: { pipeline_status: 'paused', active: false },
      r3: { pipeline_status: 'running', active: true },
    };
    expect(projectStatus('proj-1', runs)).toBe('running');
  });

  it('error takes priority over paused', () => {
    const runs = {
      r1: { pipeline_status: 'paused', active: false },
      r2: { pipeline_status: 'failed', active: false },
    };
    expect(projectStatus('proj-1', runs)).toBe('error');
  });

  it('returns idle for completed runs only', () => {
    const runs = {
      r1: { pipeline_status: 'completed', active: false },
      r2: { pipeline_status: 'completed', active: false },
    };
    expect(projectStatus('proj-1', runs)).toBe('idle');
  });

  it('filters by projectId when project field is set on runs', () => {
    const runs = {
      r1: { pipeline_status: 'running', active: true, project: 'proj-1' },
      r2: { pipeline_status: 'completed', active: false, project: 'proj-2' },
    };
    // proj-2 only has a completed run, so it should be idle
    expect(projectStatus('proj-2', runs)).toBe('idle');
    // proj-1 has a running run, so it should be running
    expect(projectStatus('proj-1', runs)).toBe('running');
  });
});
