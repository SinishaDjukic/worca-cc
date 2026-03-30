import { describe, expect, it } from 'vitest';
import { sidebarView } from './sidebar.js';

function makeState(overrides = {}) {
  return {
    runs: {},
    preferences: { sidebarCollapsed: false },
    beads: { issues: [], dbExists: false },
    projectName: '',
    projects: [],
    currentProjectId: null,
    ...overrides,
  };
}

const route = { section: 'dashboard' };
const conn = 'open';
const handlers = { onNavigate: () => {} };

/**
 * Walk a lit-html TemplateResult tree and collect all string values.
 */
function collectStrings(tpl) {
  const out = [];
  if (!tpl) return out;
  if (tpl.strings) {
    for (const s of tpl.strings) out.push(s);
  }
  if (tpl.values) {
    for (const v of tpl.values) {
      if (typeof v === 'string') out.push(v);
      else if (v?.strings) out.push(...collectStrings(v));
    }
  }
  return out;
}

function templateContains(tpl, pattern) {
  const all = collectStrings(tpl).join('');
  return pattern instanceof RegExp ? pattern.test(all) : all.includes(pattern);
}

describe('sidebar project name', () => {
  it('renders WORCA logo text', () => {
    const state = makeState({ projectName: 'my-project' });
    const tpl = sidebarView(state, route, conn, handlers);
    expect(templateContains(tpl, 'WORCA')).toBe(true);
  });

  it('does not render project-name label (removed)', () => {
    const state = makeState({ projectName: 'my-project' });
    const tpl = sidebarView(state, route, conn, handlers);
    expect(templateContains(tpl, 'project-name')).toBe(false);
  });

  it('includes collapsed class when sidebar is collapsed', () => {
    const state = makeState({
      projectName: 'my-project',
      preferences: { sidebarCollapsed: true },
    });
    const tpl = sidebarView(state, route, conn, handlers);
    expect(templateContains(tpl, 'collapsed')).toBe(true);
  });

  it('shows PROJECT section header when multiple projects', () => {
    const state = makeState({
      projects: [{ name: 'proj-a' }, { name: 'proj-b' }],
      currentProjectId: 'proj-a',
    });
    const tpl = sidebarView(state, route, conn, handlers);
    expect(templateContains(tpl, 'Project')).toBe(true);
    expect(templateContains(tpl, 'sidebar-project-selector')).toBe(true);
  });
});
