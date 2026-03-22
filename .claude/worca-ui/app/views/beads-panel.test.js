import { describe, it, expect } from 'vitest';
import { beadsPanelView } from './beads-panel.js';

function renderToString(template) {
  if (!template) return '';
  if (typeof template === 'string') return template;
  if (!template.strings) return String(template);
  let result = '';
  template.strings.forEach((s, i) => {
    result += s;
    if (i < template.values.length) {
      const v = template.values[i];
      if (typeof v === 'string') result += v;
      else if (typeof v === 'number') result += String(v);
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v && v.strings) result += renderToString(v);
      // unsafeHTML directives / functions — skip
    }
  });
  return result;
}

const baseOptions = {
  statusFilter: 'all',
  priorityFilter: 'all',
  starting: null,
  startError: null,
  onStatusFilter: () => {},
  onPriorityFilter: () => {},
  onStartIssue: () => {},
  onDismissError: () => {},
};

describe('beadsPanelView - run/branch metadata strip', () => {
  it('shows run ID when runId is provided', () => {
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      runId: '20260322-161722',
    }));
    expect(output).toContain('20260322-161722');
  });

  it('shows branch when run.branch is set', () => {
    const run = { branch: 'worca/my-feature-abc' };
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      run,
    }));
    expect(output).toContain('worca/my-feature-abc');
  });

  it('shows PR link when run.pr_url is set', () => {
    const run = { branch: 'worca/feature', pr_url: 'https://github.com/owner/repo/pull/42' };
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      run,
    }));
    expect(output).toContain('View PR');
    expect(output).toContain('https://github.com/owner/repo/pull/42');
  });

  it('hides PR link when run.pr_url is absent', () => {
    const run = { branch: 'worca/feature' };
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      run,
    }));
    expect(output).not.toContain('View PR');
  });

  it('shows both run ID and branch when both present', () => {
    const run = { branch: 'worca/feature-xyz' };
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      run,
      runId: '20260322-170556',
    }));
    expect(output).toContain('20260322-170556');
    expect(output).toContain('worca/feature-xyz');
  });

  it('shows nothing when neither run nor runId provided', () => {
    const output = renderToString(beadsPanelView([], { ...baseOptions }));
    expect(output).not.toContain('run-info-section');
  });

  it('uses run-info-section CSS class for the metadata strip', () => {
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      runId: '20260322-161722',
    }));
    expect(output).toContain('run-info-section');
  });

  it('uses run-branch CSS class for each metadata row', () => {
    const run = { branch: 'worca/feature' };
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      run,
      runId: '20260322-161722',
    }));
    expect(output).toContain('run-branch');
  });

  it('falls back to run.work_request.branch if run.branch is absent', () => {
    const run = { work_request: { branch: 'worca/fallback-branch' } };
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      run,
    }));
    expect(output).toContain('worca/fallback-branch');
  });

  it('shows "Run" label prefix before the run ID', () => {
    const output = renderToString(beadsPanelView([], {
      ...baseOptions,
      runId: '20260322-161722',
    }));
    expect(output).toContain('Run ');
    expect(output).toContain('20260322-161722');
  });
});
