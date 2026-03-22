import { describe, it, expect } from 'vitest';
import { liveOutputView } from './live-output.js';

function renderToString(template) {
  if (!template) return '';
  if (typeof template === 'symbol') return ''; // lit-html nothing
  if (typeof template === 'string') return template;
  if (!template.strings) return String(template);
  let result = '';
  template.strings.forEach((s, i) => {
    result += s;
    if (i < template.values.length) {
      const v = template.values[i];
      if (typeof v === 'string') result += v;
      else if (typeof v === 'number') result += String(v);
      else if (typeof v === 'boolean') result += '';
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v && v.strings) result += renderToString(v);
    }
  });
  return result;
}

describe('live-output copy button', () => {
  it('renders copy button with class terminal-copy-btn when running', () => {
    const html = renderToString(liveOutputView('implement', true));
    expect(html).toContain('terminal-copy-btn');
  });

  it('renders nothing when not running', () => {
    const html = renderToString(liveOutputView('implement', false));
    expect(html).toBe('');
  });

  it('renders copy button in live-output-controls toolbar', () => {
    const html = renderToString(liveOutputView('plan', true));
    const controlsPos = html.indexOf('live-output-controls');
    const copyBtnPos = html.indexOf('terminal-copy-btn');
    expect(controlsPos).toBeGreaterThan(-1);
    expect(copyBtnPos).toBeGreaterThan(controlsPos);
  });

  it('renders copy button even when stageName is null (waiting state)', () => {
    const html = renderToString(liveOutputView(null, true));
    expect(html).toContain('terminal-copy-btn');
  });
});
