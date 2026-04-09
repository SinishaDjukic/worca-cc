import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf-8');

describe('bead-specific CSS color variables in :root', () => {
  it('defines --bead-in-progress as blue #3b82f6', () => {
    expect(css).toMatch(/--bead-in-progress:\s*#3b82f6/);
  });

  it('defines --bead-blocked as amber #f59e0b', () => {
    expect(css).toMatch(/--bead-blocked:\s*#f59e0b/);
  });

  it('places bead vars inside the :root block', () => {
    const rootMatch = css.match(/:root\s*\{([^}]+)\}/);
    expect(rootMatch).not.toBeNull();
    const rootBlock = rootMatch[1];
    expect(rootBlock).toContain('--bead-in-progress:');
    expect(rootBlock).toContain('--bead-blocked:');
  });
});

describe('bead CSS selectors use bead-specific color vars', () => {
  it('.beads-dep-chip--blocking uses --bead-blocked', () => {
    expect(css).toMatch(
      /\.beads-dep-chip--blocking\s*\{[^}]*var\(--bead-blocked\)/s,
    );
  });

  it('.beads-kanban-header--in_progress uses --bead-in-progress', () => {
    expect(css).toMatch(
      /\.beads-kanban-header--in_progress\s*\{[^}]*var\(--bead-in-progress\)/s,
    );
  });

  it('.beads-kanban-card--blocked uses --bead-blocked', () => {
    expect(css).toMatch(
      /\.beads-kanban-card--blocked\s*\{[^}]*var\(--bead-blocked\)/s,
    );
  });

  it('.beads-kanban-card-blocked uses --bead-blocked', () => {
    expect(css).toMatch(
      /\.beads-kanban-card-blocked\s*\{[^}]*var\(--bead-blocked\)/s,
    );
  });

  it('.beads-graph-node--in_progress rect uses --bead-in-progress', () => {
    expect(css).toMatch(
      /\.beads-graph-node--in_progress rect\s*\{[^}]*var\(--bead-in-progress\)/s,
    );
  });

  it('.beads-graph-node--blocked rect uses --bead-blocked', () => {
    expect(css).toMatch(
      /\.beads-graph-node--blocked rect\s*\{[^}]*var\(--bead-blocked\)/s,
    );
  });

  it('.beads-dep-chip--blocking does not use --status-blocked', () => {
    const chipBlock =
      css.match(/\.beads-dep-chip--blocking\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(chipBlock).not.toContain('--status-blocked');
  });

  it('.beads-kanban-header--in_progress does not use --status-in-progress', () => {
    const headerBlock =
      css.match(/\.beads-kanban-header--in_progress\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(headerBlock).not.toContain('--status-in-progress');
  });

  it('.beads-graph-node--blocked rect does not use --status-blocked', () => {
    const nodeBlock =
      css.match(/\.beads-graph-node--blocked rect\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(nodeBlock).not.toContain('--status-blocked');
  });
});
