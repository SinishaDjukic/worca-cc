import { nothing } from 'lit-html';
import { describe, expect, it } from 'vitest';
import { liveOutputView } from './live-output.js';

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
      else if (typeof v === 'boolean') result += '';
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v?.strings) result += renderToString(v);
    }
  });
  return result;
}

describe('live-output stream filter control', () => {
  it('renders a segmented sl-radio-group in the live controls', () => {
    const html = renderToString(
      liveOutputView('implement', true, 'all', () => {}),
    );
    expect(html).toContain('live-stream-filter');
    expect(html).toContain('sl-radio-group');
    expect(html).toContain('sl-radio-button');
  });

  it('offers all / out / error options', () => {
    const html = renderToString(
      liveOutputView('implement', true, 'all', () => {}),
    );
    expect(html).toContain('value="all"');
    expect(html).toContain('value="out"');
    expect(html).toContain('value="err"');
    expect(html).toContain('Out');
    expect(html).toContain('Error');
  });

  it('renders nothing when the run is not active', () => {
    expect(liveOutputView('implement', false, 'all', () => {})).toBe(nothing);
  });

  it('renders with default args (no streamFilter / handler passed)', () => {
    const html = renderToString(liveOutputView('plan', true));
    expect(html).toContain('live-stream-filter');
  });
});
