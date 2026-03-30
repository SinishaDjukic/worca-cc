/**
 * Tests for multi-project dashboard features.
 * @vitest-environment jsdom
 */

import { render } from 'lit-html';
import { describe, expect, it, vi } from 'vitest';
import { dashboardView } from './dashboard.js';

function renderToContainer(template) {
  const container = document.createElement('div');
  render(template, container);
  return container;
}

function makeState(overrides = {}) {
  return {
    runs: {},
    projects: [],
    currentProjectId: null,
    ...overrides,
  };
}

describe('single-project dashboard', () => {
  it('renders identically to before', () => {
    const state = makeState({
      projects: [{ name: 'default', path: '/app' }],
      currentProjectId: 'default',
      runs: {
        'run-1': {
          id: 'run-1',
          active: true,
          pipeline_status: 'running',
          stages: {},
        },
      },
    });
    const container = renderToContainer(
      dashboardView(state, { onSelectRun: vi.fn(), onNavigate: vi.fn() }),
    );
    // Should have dashboard stats but no project cards
    expect(container.querySelector('.dashboard-stats')).not.toBeNull();
    expect(container.querySelector('.project-cards')).toBeNull();
  });
});

describe('multi-project dashboard', () => {
  const projects = [
    { name: 'alpha', path: '/alpha' },
    { name: 'beta', path: '/beta' },
  ];

  it('shows project cards when no project selected', () => {
    const state = makeState({
      projects,
      currentProjectId: null,
      runs: {},
    });
    const container = renderToContainer(
      dashboardView(state, { onSelectRun: vi.fn(), onNavigate: vi.fn() }),
    );
    const cards = container.querySelectorAll('.project-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('alpha');
    expect(cards[1].textContent).toContain('beta');
  });

  it('project card shows active run count', () => {
    const state = makeState({
      projects,
      currentProjectId: null,
      runs: {
        'run-1': {
          id: 'run-1',
          active: true,
          projectId: 'alpha',
          pipeline_status: 'running',
          stages: {},
        },
        'run-2': {
          id: 'run-2',
          active: true,
          projectId: 'alpha',
          pipeline_status: 'running',
          stages: {},
        },
        'run-3': {
          id: 'run-3',
          active: false,
          projectId: 'beta',
          pipeline_status: 'completed',
          stages: {},
        },
      },
    });
    const container = renderToContainer(
      dashboardView(state, { onSelectRun: vi.fn(), onNavigate: vi.fn() }),
    );
    const cards = container.querySelectorAll('.project-card');
    // Alpha card should show 2 active
    expect(cards[0].querySelector('.project-card-stats').textContent).toContain(
      '2 active',
    );
    // Beta card should show 0 active
    expect(cards[1].querySelector('.project-card-stats').textContent).toContain(
      '0 active',
    );
  });

  it('clicking project card navigates to that project', () => {
    const onNavigate = vi.fn();
    const state = makeState({
      projects,
      currentProjectId: null,
      runs: {},
    });
    const container = renderToContainer(
      dashboardView(state, { onSelectRun: vi.fn(), onNavigate }),
    );
    const cards = container.querySelectorAll('.project-card');
    cards[0].click();
    expect(onNavigate).toHaveBeenCalledWith('active', null, 'alpha');
  });

  it('dashboard with selected project hides project cards', () => {
    const state = makeState({
      projects,
      currentProjectId: 'alpha',
      runs: {},
    });
    const container = renderToContainer(
      dashboardView(state, { onSelectRun: vi.fn(), onNavigate: vi.fn() }),
    );
    expect(container.querySelector('.project-cards')).toBeNull();
  });
});
