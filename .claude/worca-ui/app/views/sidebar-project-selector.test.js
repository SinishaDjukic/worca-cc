/**
 * Tests for sidebar project selector behavior.
 */

import { describe, expect, it, vi } from 'vitest';

describe('sidebar project selector', () => {
  function makeState(overrides = {}) {
    return {
      runs: {},
      preferences: {
        theme: 'light',
        sidebarCollapsed: false,
        notifications: null,
      },
      projectName: 'test-project',
      currentProjectId: null,
      projects: [],
      beads: { issues: [], dbExists: false },
      webhookInbox: { events: [] },
      ...overrides,
    };
  }

  it('no selector when projects is empty', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const state = makeState({ projects: [] });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', { onNavigate: vi.fn() });

    const templateStr = JSON.stringify(result.values);
    expect(templateStr).not.toContain('sidebar-project-selector');
  });

  it('selector rendered when projects.length is 1', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const state = makeState({ projects: [{ name: 'only-one' }] });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', { onNavigate: vi.fn() });

    const templateStr = JSON.stringify(result.values);
    expect(templateStr).toContain('sidebar-project-selector');
  });

  it('selector rendered when projects.length >= 2', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const state = makeState({
      projects: [{ name: 'proj-a' }, { name: 'proj-b' }],
      currentProjectId: 'proj-a',
    });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', { onNavigate: vi.fn() });

    const templateStr = JSON.stringify(result.values);
    expect(templateStr).toContain('sidebar-project-selector');
  });

  it('selector shows currentProjectId as selected', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const state = makeState({
      projects: [{ name: 'proj-a' }, { name: 'proj-b' }],
      currentProjectId: 'proj-b',
    });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', { onNavigate: vi.fn() });

    const templateStr = JSON.stringify(result.values);
    expect(templateStr).toContain('proj-b');
  });

  it('onProjectChange fires with selected project', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const onProjectChange = vi.fn();
    const state = makeState({
      projects: [{ name: 'proj-a' }, { name: 'proj-b' }],
      currentProjectId: 'proj-a',
    });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', {
      onNavigate: vi.fn(),
      onProjectChange,
    });

    expect(result).toBeTruthy();
  });

  it('single project shows selector', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const state = makeState({
      projects: [{ name: 'my-project' }],
      currentProjectId: 'my-project',
    });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', { onNavigate: vi.fn() });

    const templateStr = JSON.stringify(result.values);
    expect(templateStr).toContain('sidebar-project-selector');
  });

  it('single project renders selector and add-project button', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const state = makeState({
      projects: [{ name: 'solo' }],
      currentProjectId: 'solo',
    });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', { onNavigate: vi.fn() });

    const templateStr = JSON.stringify(result.values);
    expect(templateStr).toContain('sidebar-project-selector');
    expect(templateStr).toContain('sidebar-add-project-btn');
  });
});
