import { describe, expect, it } from 'vitest';
import { runDetailView } from './run-detail.js';

function renderToString(template) {
  if (!template) return '';
  if (template.overview) return renderToString(template.overview) + renderToString(template.stages);
  if (typeof template === 'string') return template;
  if (!template.strings) return String(template);
  let result = '';
  template.strings.forEach((s, i) => {
    result += s;
    if (i < template.values.length) {
      const v = template.values[i];
      if (typeof v === 'string') result += v;
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v?.strings) result += renderToString(v);
    }
  });
  return result;
}

describe('runDetailView learn stage injection', () => {
  it('injects learn stage with skipped status when stages.learn is absent', () => {
    const run = {
      stages: {
        plan: { status: 'completed' },
        pr: { status: 'completed' },
      },
    };
    const html = renderToString(runDetailView(run));
    // The timeline should contain a LEARN label from the injected stage
    expect(html).toContain('LEARN');
    // Should show skipped status styling
    expect(html).toContain('status-skipped');
  });

  it('preserves existing learn stage when already present', () => {
    const run = {
      stages: {
        preflight: { status: 'completed' },
        plan: { status: 'completed' },
        learn: { status: 'completed', iterations: [{ number: 0 }] },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('LEARN');
    // Should NOT have skipped status since both preflight and learn already exist with completed
    expect(html).not.toContain('status-skipped');
  });

  it('does not mutate the original stages object', () => {
    const stages = { plan: { status: 'completed' } };
    const run = { stages };
    renderToString(runDetailView(run));
    expect(stages.learn).toBeUndefined();
    expect(stages.preflight).toBeUndefined();
  });
});
