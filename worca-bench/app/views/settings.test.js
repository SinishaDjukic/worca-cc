import { describe, expect, it } from 'vitest';
import { settingsView } from './settings.js';

// Minimal lit-html template stringifier (mirrors worca-ui's renderToString).
function renderToString(template) {
  if (template == null || template === false) return '';
  if (typeof template === 'string') return template;
  if (typeof template === 'number') return String(template);
  if (Array.isArray(template)) return template.map(renderToString).join('');
  if (!template.strings) return '';
  let out = '';
  template.strings.forEach((s, i) => {
    out += s;
    if (i < template.values.length) out += renderToString(template.values[i]);
  });
  return out;
}

describe('settingsView', () => {
  it('renders the primary dir as always-included and lists configured dirs', () => {
    const out = renderToString(
      settingsView({
        primary: '/runs/primary',
        configured: ['/runs/extra'],
        effective: ['/runs/primary', '/runs/extra'],
      }),
    );
    expect(out).toContain('/runs/primary');
    expect(out).toContain('always included');
    expect(out).toContain('/runs/extra');
    expect(out).toContain('Remove');
    expect(out).toContain('settings-add'); // add form present
  });

  it('marks a configured dir that is not in the effective set as missing', () => {
    const out = renderToString(
      settingsView({
        primary: '/p',
        configured: ['/gone'],
        effective: ['/p'],
      }),
    );
    expect(out).toContain('missing');
  });

  it('surfaces an error message when present', () => {
    const out = renderToString(
      settingsView({
        primary: '/p',
        configured: [],
        effective: ['/p'],
        error: 'boom',
      }),
    );
    expect(out).toContain('boom');
  });

  it('renders the grader credentials card with all three fields', () => {
    const out = renderToString(
      settingsView({ primary: '/p', configured: [], effective: ['/p'] }),
    );
    expect(out).toContain('Grader credentials');
    expect(out).toContain('SWE-bench API key');
    expect(out).toContain('Modal token ID');
    expect(out).toContain('Modal token secret');
    // Browser-only with no secrets stored → all show "Not set".
    expect(out).toContain('Not set');
    expect(out).toContain('only in this browser');
  });
});
