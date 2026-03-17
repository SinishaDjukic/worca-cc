import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf-8');

describe('Pricing table CSS', () => {
  it('has .pricing-table-wrap for horizontal overflow', () => {
    expect(css).toContain('.pricing-table-wrap');
    expect(css).toMatch(/\.pricing-table-wrap\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('has .pricing-table with border-collapse and compact font', () => {
    expect(css).toContain('.pricing-table');
    expect(css).toMatch(/\.pricing-table\s*\{[^}]*border-collapse:\s*collapse/);
    expect(css).toMatch(/\.pricing-table\s*\{[^}]*font-size:\s*13px/);
  });

  it('has th/td padding for compact layout', () => {
    expect(css).toMatch(/\.pricing-table\s+th[\s\S]*?padding:\s*\d+px\s+\d+px/);
  });

  it('has th styled as uppercase muted header', () => {
    expect(css).toMatch(/\.pricing-table\s+th\s*\{[^}]*text-transform:\s*uppercase/);
    expect(css).toMatch(/\.pricing-table\s+th\s*\{[^}]*font-size:\s*11px/);
    expect(css).toMatch(/\.pricing-table\s+th\s*\{[^}]*letter-spacing/);
  });

  it('has .pricing-model-name with capitalize', () => {
    expect(css).toMatch(/\.pricing-model-name\s*\{[^}]*text-transform:\s*capitalize/);
  });

  it('right-aligns number columns (th and td)', () => {
    // Cost columns should right-align for number readability
    expect(css).toMatch(/\.pricing-table\s+td:not\(:first-child\)[^{]*\{[^}]*text-align:\s*right/);
    expect(css).toMatch(/\.pricing-table\s+th:not\(:first-child\)[^{]*\{[^}]*text-align:\s*right/);
  });

  it('sets min-width and max-width on sl-input for compact fit', () => {
    expect(css).toMatch(/\.pricing-table\s+sl-input[^{]*\{[^}]*min-width:\s*\d+px/);
    expect(css).toMatch(/\.pricing-table\s+sl-input[^{]*\{[^}]*max-width:\s*\d+px/);
  });

  it('has .pricing-info as flex row with gap', () => {
    expect(css).toMatch(/\.pricing-info\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.pricing-info\s*\{[^}]*gap:\s*\d+px/);
  });

  it('applies vertical-align middle to td for input alignment', () => {
    expect(css).toMatch(/\.pricing-table\s+td[^{]*\{[^}]*vertical-align:\s*middle/);
  });
});
