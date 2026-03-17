import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf-8');

describe('editable permission CSS styles', () => {
  it('has .settings-perm-item--editable with flex layout', () => {
    expect(css).toContain('.settings-perm-item--editable');
    // Should use flexbox for inline input + button
    const match = css.match(/\.settings-perm-item--editable\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = match[1];
    expect(block).toContain('display: flex');
    expect(block).toContain('align-items: center');
    expect(block).toContain('gap:');
  });

  it('has sl-input flex rule inside editable item', () => {
    const match = css.match(/\.settings-perm-item--editable\s+sl-input\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('flex: 1');
  });

  it('has .perm-remove-btn styles', () => {
    const match = css.match(/\.perm-remove-btn\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = match[1];
    expect(block).toContain('cursor: pointer');
    expect(block).toContain('color:');
  });

  it('has .perm-remove-btn:hover with danger color', () => {
    const match = css.match(/\.perm-remove-btn:hover\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('color:');
  });
});
