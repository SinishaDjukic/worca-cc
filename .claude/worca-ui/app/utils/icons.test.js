import { describe, it, expect } from 'vitest';
import { X, iconSvg } from './icons.js';

describe('icons', () => {
  it('exports X icon data as an array', () => {
    expect(Array.isArray(X)).toBe(true);
    expect(X.length).toBeGreaterThan(0);
  });

  it('renders X icon to SVG string', () => {
    const svg = iconSvg(X, 16);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="16"');
  });
});
