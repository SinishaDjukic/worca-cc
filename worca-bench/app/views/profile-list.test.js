import { describe, expect, it } from 'vitest';
import { profileListView } from './profile-list.js';

// Same renderToString walker the other view tests use: inline strings/numbers/
// arrays/nested templates; functions and unsafeHTML directives are skipped.
function renderToString(template) {
  if (!template) return '';
  if (typeof template === 'string') return template;
  if (typeof template === 'symbol') return ''; // lit `nothing`
  if (!template.strings) return String(template);
  let result = '';
  template.strings.forEach((s, i) => {
    result += s;
    if (i < template.values.length) {
      const v = template.values[i];
      if (typeof v === 'string') result += v;
      else if (typeof v === 'number') result += String(v);
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v?.strings) result += renderToString(v);
    }
  });
  return result;
}

function agg(name, overrides = {}) {
  return {
    name,
    src: `src-${name}`,
    benchmark: 'swe-bench-verified',
    template: 'builtin:feature',
    reps: 1,
    resolved_rate: 1,
    ...overrides,
  };
}

const profiles = [
  agg('alpha'),
  agg('beta', { archived: true }),
  agg('gamma', { benchmark: 'commit0' }),
];

const handlers = {
  onFilter: () => {},
  onSearch: () => {},
};

describe('profileListView filtering', () => {
  it('omits the filter bar when no filter handlers are passed', () => {
    const out = renderToString(profileListView(profiles));
    expect(out).not.toContain('filter-pills');
    // …but still renders the grid (legacy callers).
    expect(out).toContain('profile-grid');
  });

  it('renders pills with per-category counts', () => {
    const out = renderToString(
      profileListView(profiles, { ...handlers, filter: 'all' }),
    );
    expect(out).toContain('filter-pills');
    // All=3, Active(non-archived)=2, Archived=1.
    expect(out).toMatch(/All\s*<span class="filter-pill-count">3/);
    expect(out).toMatch(/Active\s*<span class="filter-pill-count">2/);
    expect(out).toMatch(/Archived\s*<span class="filter-pill-count">1/);
  });

  it("default 'active' filter hides archived profiles", () => {
    const out = renderToString(
      profileListView(profiles, { ...handlers, filter: 'active' }),
    );
    expect(out).toContain('alpha');
    expect(out).toContain('gamma');
    expect(out).not.toContain('>beta<');
  });

  it("'archived' filter shows only archived profiles", () => {
    const out = renderToString(
      profileListView(profiles, { ...handlers, filter: 'archived' }),
    );
    expect(out).toContain('beta');
    expect(out).not.toContain('>alpha<');
  });

  it('search narrows by name within the active filter', () => {
    const out = renderToString(
      profileListView(profiles, {
        ...handlers,
        filter: 'all',
        search: 'gam',
      }),
    );
    expect(out).toContain('gamma');
    expect(out).not.toContain('>alpha<');
    expect(out).not.toContain('>beta<');
  });

  it('search matches benchmark too', () => {
    const out = renderToString(
      profileListView(profiles, {
        ...handlers,
        filter: 'all',
        search: 'commit0',
      }),
    );
    expect(out).toContain('gamma');
    expect(out).not.toContain('>alpha<');
  });

  it('shows an empty-state when nothing matches', () => {
    const out = renderToString(
      profileListView(profiles, {
        ...handlers,
        filter: 'all',
        search: 'zzz-nope',
      }),
    );
    expect(out).toContain('No profiles match');
    expect(out).not.toContain('profile-grid');
  });

  it('keeps the filter bar when the list is empty', () => {
    const out = renderToString(profileListView([], handlers));
    expect(out).toContain('filter-pills');
    expect(out).toContain('No benchmark results yet');
  });
});
