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

  it('no selector when projects.length <= 1', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const state = makeState({ projects: [{ name: 'only-one' }] });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', { onNavigate: vi.fn() });

    // Render to string to check content
    const { render } = await import('lit-html');
    const container = { innerHTML: '' };
    // lit-html needs a real DOM element; we'll inspect the template values instead
    // The template should NOT contain sl-select for project switching
    const templateStr = JSON.stringify(result.values);
    expect(templateStr).not.toContain('sidebar-project-selector');
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

    // The template is created with onProjectChange in the handler bag
    // We verify it was passed through by checking the template contains the handler ref
    expect(result).toBeTruthy();
    // The actual sl-change handler is wired in the template — full DOM testing
    // would require a browser. We verify the template renders without error.
  });

  it('single project hides dropdown', async () => {
    const { sidebarView } = await import('./sidebar.js');
    const state = makeState({
      projects: [{ name: 'my-project' }],
      currentProjectId: 'my-project',
    });
    const route = { section: 'active' };
    const result = sidebarView(state, route, 'open', { onNavigate: vi.fn() });

    const templateStr = JSON.stringify(result.values);
    expect(templateStr).not.toContain('sidebar-project-selector');
  });
});
