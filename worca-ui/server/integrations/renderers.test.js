import { describe, expect, it } from 'vitest';
import { isValidMessage } from './adapter.js';
import { renderEvent, TIER1_EVENTS } from './renderers.js';

function envelope(event_type, payload, run_id = 'run-abc123') {
  return { event_type, run_id, payload };
}

function bodyText(msg) {
  return msg.body.map((s) => s.value).join('');
}

describe('TIER1_EVENTS', () => {
  it('exports exactly 14 event type strings', () => {
    expect(TIER1_EVENTS).toHaveLength(14);
    expect(TIER1_EVENTS).toContain('pipeline.run.started');
    expect(TIER1_EVENTS).toContain('pipeline.run.completed');
    expect(TIER1_EVENTS).toContain('pipeline.run.failed');
    expect(TIER1_EVENTS).toContain('pipeline.run.interrupted');
    expect(TIER1_EVENTS).toContain('pipeline.run.paused');
    expect(TIER1_EVENTS).toContain('pipeline.run.resumed');
    expect(TIER1_EVENTS).toContain('pipeline.run.resumed_from_pause');
    expect(TIER1_EVENTS).toContain('pipeline.stage.started');
    expect(TIER1_EVENTS).toContain('pipeline.stage.completed');
    expect(TIER1_EVENTS).toContain('pipeline.stage.interrupted');
    expect(TIER1_EVENTS).toContain('pipeline.git.pr_created');
    expect(TIER1_EVENTS).toContain('pipeline.git.pr_merged');
    expect(TIER1_EVENTS).toContain('pipeline.circuit_breaker.tripped');
    expect(TIER1_EVENTS).toContain('pipeline.cost.budget_warning');
  });
});

describe('renderEvent', () => {
  it('returns null for unknown event type', () => {
    expect(renderEvent(envelope('pipeline.bead.created', {}))).toBeNull();
  });

  it('returns null for missing envelope', () => {
    expect(renderEvent(null)).toBeNull();
    expect(renderEvent(undefined)).toBeNull();
  });

  it('returns null for envelope without event_type', () => {
    expect(renderEvent({ payload: {} })).toBeNull();
  });

  describe('pipeline.run.completed', () => {
    const payload = {
      duration_ms: 754000,
      total_cost_usd: 0.87,
      total_turns: 10,
      total_tokens: 50000,
      stages_completed: ['planner', 'implementer'],
    };

    it('produces a valid NormalizedMessage', () => {
      const msg = renderEvent(envelope('pipeline.run.completed', payload));
      expect(isValidMessage(msg)).toBe(true);
    });

    it('severity is success', () => {
      const msg = renderEvent(envelope('pipeline.run.completed', payload));
      expect(msg.severity).toBe('success');
    });

    it('body includes run_id', () => {
      const msg = renderEvent(envelope('pipeline.run.completed', payload));
      expect(bodyText(msg)).toContain('run-abc123');
    });

    it('body includes formatted duration (12m34s)', () => {
      const msg = renderEvent(envelope('pipeline.run.completed', payload));
      expect(bodyText(msg)).toContain('12m34s');
    });

    it('body includes formatted cost ($0.87)', () => {
      const msg = renderEvent(envelope('pipeline.run.completed', payload));
      expect(bodyText(msg)).toContain('$0.87');
    });

    it('formats sub-minute duration correctly', () => {
      const p = { ...payload, duration_ms: 45000 };
      const msg = renderEvent(envelope('pipeline.run.completed', p));
      expect(bodyText(msg)).toContain('45s');
    });

    it('pads seconds to two digits', () => {
      const p = { ...payload, duration_ms: 65000 }; // 1m05s
      const msg = renderEvent(envelope('pipeline.run.completed', p));
      expect(bodyText(msg)).toContain('1m05s');
    });
  });

  describe('pipeline.run.failed', () => {
    const payload = {
      error: 'SyntaxError: unexpected token',
      failed_stage: 'implementer',
      error_type: 'SyntaxError',
    };

    it('produces a valid NormalizedMessage', () => {
      const msg = renderEvent(envelope('pipeline.run.failed', payload));
      expect(isValidMessage(msg)).toBe(true);
    });

    it('severity is error', () => {
      const msg = renderEvent(envelope('pipeline.run.failed', payload));
      expect(msg.severity).toBe('error');
    });

    it('body includes failed_stage', () => {
      const msg = renderEvent(envelope('pipeline.run.failed', payload));
      expect(bodyText(msg)).toContain('implementer');
    });

    it('body includes error_type', () => {
      const msg = renderEvent(envelope('pipeline.run.failed', payload));
      expect(bodyText(msg)).toContain('SyntaxError');
    });

    it('body includes run_id', () => {
      const msg = renderEvent(envelope('pipeline.run.failed', payload));
      expect(bodyText(msg)).toContain('run-abc123');
    });

    it('falls back to error string when error_type is absent', () => {
      const p = { error: 'something broke', failed_stage: 'tester' };
      const msg = renderEvent(envelope('pipeline.run.failed', p));
      expect(bodyText(msg)).toContain('something broke');
    });
  });

  describe('pipeline.run.interrupted', () => {
    const payload = { interrupted_stage: 'tester', elapsed_ms: 720000 };

    it('produces a valid NormalizedMessage', () => {
      const msg = renderEvent(envelope('pipeline.run.interrupted', payload));
      expect(isValidMessage(msg)).toBe(true);
    });

    it('severity is warning', () => {
      const msg = renderEvent(envelope('pipeline.run.interrupted', payload));
      expect(msg.severity).toBe('warning');
    });

    it('body includes interrupted_stage', () => {
      const msg = renderEvent(envelope('pipeline.run.interrupted', payload));
      expect(bodyText(msg)).toContain('tester');
    });

    it('body includes elapsed time (12m00s)', () => {
      const msg = renderEvent(envelope('pipeline.run.interrupted', payload));
      expect(bodyText(msg)).toContain('12m00s');
    });

    it('body includes run_id', () => {
      const msg = renderEvent(envelope('pipeline.run.interrupted', payload));
      expect(bodyText(msg)).toContain('run-abc123');
    });
  });

  describe('pipeline.git.pr_created', () => {
    const payload = {
      pr_url: 'https://github.com/org/repo/pull/193',
      pr_number: 193,
      title: 'Add user auth',
    };

    it('produces a valid NormalizedMessage', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_created', payload));
      expect(isValidMessage(msg)).toBe(true);
    });

    it('severity is info', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_created', payload));
      expect(msg.severity).toBe('info');
    });

    it('body includes PR number', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_created', payload));
      expect(bodyText(msg)).toContain('193');
    });

    it('body includes PR title', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_created', payload));
      expect(bodyText(msg)).toContain('Add user auth');
    });

    it('includes a link segment with pr_url as href', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_created', payload));
      const linkSeg = msg.body.find((s) => s.kind === 'link');
      expect(linkSeg).toBeDefined();
      expect(linkSeg.href).toBe('https://github.com/org/repo/pull/193');
    });
  });

  describe('pipeline.git.pr_merged', () => {
    const payload = {
      pr_url: 'https://github.com/org/repo/pull/193',
      pr_number: 193,
    };

    it('produces a valid NormalizedMessage', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_merged', payload));
      expect(isValidMessage(msg)).toBe(true);
    });

    it('severity is success', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_merged', payload));
      expect(msg.severity).toBe('success');
    });

    it('body includes PR number', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_merged', payload));
      expect(bodyText(msg)).toContain('193');
    });

    it('includes a link segment with pr_url as href', () => {
      const msg = renderEvent(envelope('pipeline.git.pr_merged', payload));
      const linkSeg = msg.body.find((s) => s.kind === 'link');
      expect(linkSeg).toBeDefined();
      expect(linkSeg.href).toBe('https://github.com/org/repo/pull/193');
    });
  });

  describe('pipeline.circuit_breaker.tripped', () => {
    const payload = {
      reason: 'consecutive api_error failures',
      consecutive_failures: 3,
      category: 'api_error',
    };

    it('produces a valid NormalizedMessage', () => {
      const msg = renderEvent(
        envelope('pipeline.circuit_breaker.tripped', payload),
      );
      expect(isValidMessage(msg)).toBe(true);
    });

    it('severity is error', () => {
      const msg = renderEvent(
        envelope('pipeline.circuit_breaker.tripped', payload),
      );
      expect(msg.severity).toBe('error');
    });

    it('body includes consecutive_failures count', () => {
      const msg = renderEvent(
        envelope('pipeline.circuit_breaker.tripped', payload),
      );
      expect(bodyText(msg)).toContain('3');
    });

    it('body includes category', () => {
      const msg = renderEvent(
        envelope('pipeline.circuit_breaker.tripped', payload),
      );
      expect(bodyText(msg)).toContain('api_error');
    });

    it('body indicates run halted', () => {
      const msg = renderEvent(
        envelope('pipeline.circuit_breaker.tripped', payload),
      );
      expect(bodyText(msg)).toContain('halted');
    });
  });

  describe('pipeline.cost.budget_warning', () => {
    const payload = {
      total_cost_usd: 85.0,
      budget_usd: 100.0,
      pct_used: 0.85,
    };

    it('produces a valid NormalizedMessage', () => {
      const msg = renderEvent(
        envelope('pipeline.cost.budget_warning', payload),
      );
      expect(isValidMessage(msg)).toBe(true);
    });

    it('severity is warning', () => {
      const msg = renderEvent(
        envelope('pipeline.cost.budget_warning', payload),
      );
      expect(msg.severity).toBe('warning');
    });

    it('body includes pct_used as percentage', () => {
      const msg = renderEvent(
        envelope('pipeline.cost.budget_warning', payload),
      );
      expect(bodyText(msg)).toContain('85%');
    });

    it('body includes budget_usd', () => {
      const msg = renderEvent(
        envelope('pipeline.cost.budget_warning', payload),
      );
      expect(bodyText(msg)).toContain('$100.00');
    });

    it('body includes run_id', () => {
      const msg = renderEvent(
        envelope('pipeline.cost.budget_warning', payload),
      );
      expect(bodyText(msg)).toContain('run-abc123');
    });
  });

  describe('pipeline.run.started', () => {
    it('returns valid message', () => {
      const msg = renderEvent(
        envelope('pipeline.run.started', { title: 'Add auth' }),
      );
      expect(isValidMessage(msg)).toBe(true);
      expect(msg.severity).toBe('info');
      expect(bodyText(msg)).toContain('started');
      expect(bodyText(msg)).toContain('Add auth');
    });

    it('truncates long titles', () => {
      const msg = renderEvent(
        envelope('pipeline.run.started', { title: 'A'.repeat(100) }),
      );
      expect(bodyText(msg)).toContain('…');
    });

    it('works without title', () => {
      const msg = renderEvent(envelope('pipeline.run.started', {}));
      expect(isValidMessage(msg)).toBe(true);
    });
  });

  describe('pipeline.run.paused', () => {
    it('returns valid warning', () => {
      const msg = renderEvent(
        envelope('pipeline.run.paused', { stage: 'implement' }),
      );
      expect(msg.severity).toBe('warning');
      expect(bodyText(msg)).toContain('paused');
      expect(bodyText(msg)).toContain('implement');
    });
  });

  describe('pipeline.run.resumed', () => {
    it('returns valid info', () => {
      const msg = renderEvent(envelope('pipeline.run.resumed', {}));
      expect(msg.severity).toBe('info');
      expect(bodyText(msg)).toContain('resumed');
    });
  });

  describe('pipeline.run.resumed_from_pause', () => {
    it('returns valid info', () => {
      const msg = renderEvent(envelope('pipeline.run.resumed_from_pause', {}));
      expect(msg.severity).toBe('info');
      expect(bodyText(msg)).toContain('resumed from pause');
    });
  });

  describe('pipeline.stage.started', () => {
    it('returns valid message with stage name', () => {
      const msg = renderEvent(
        envelope('pipeline.stage.started', { stage: 'plan', iteration: 1 }),
      );
      expect(isValidMessage(msg)).toBe(true);
      expect(bodyText(msg)).toContain('plan');
      expect(bodyText(msg)).toContain('iter 1');
    });
  });

  describe('pipeline.stage.completed', () => {
    it('returns valid success with duration', () => {
      const msg = renderEvent(
        envelope('pipeline.stage.completed', {
          stage: 'test',
          duration_ms: 65000,
        }),
      );
      expect(msg.severity).toBe('success');
      expect(bodyText(msg)).toContain('test');
      expect(bodyText(msg)).toContain('done');
      expect(bodyText(msg)).toContain('1m05s');
    });
  });

  describe('pipeline.stage.interrupted', () => {
    it('returns valid warning', () => {
      const msg = renderEvent(
        envelope('pipeline.stage.interrupted', { stage: 'implement' }),
      );
      expect(msg.severity).toBe('warning');
      expect(bodyText(msg)).toContain('implement');
      expect(bodyText(msg)).toContain('interrupted');
    });
  });
});
