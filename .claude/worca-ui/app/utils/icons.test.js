import { describe, it, expect } from 'vitest';
import { X, Lightbulb, iconSvg, RotateCw, CircleSlash } from './icons.js';

describe('icons', () => {
  it('exports X icon data as an array', () => {
    expect(Array.isArray(X)).toBe(true);
    expect(X.length).toBeGreaterThan(0);
  });

  it('exports Lightbulb icon data as an array', () => {
    expect(Array.isArray(Lightbulb)).toBe(true);
    expect(Lightbulb.length).toBeGreaterThan(0);
  });

  it('renders X icon to SVG string', () => {
    const svg = iconSvg(X, 16);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="16"');
  });

  it('exports RotateCw icon data as an array', () => {
    expect(Array.isArray(RotateCw)).toBe(true);
    expect(RotateCw.length).toBeGreaterThan(0);
  });

  it('exports CircleSlash icon data as an array', () => {
    expect(Array.isArray(CircleSlash)).toBe(true);
    expect(CircleSlash.length).toBeGreaterThan(0);
  });
});
