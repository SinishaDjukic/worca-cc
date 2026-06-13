/**
 * Tests for the Workspaces config table (W-073 setup gear).
 * @vitest-environment jsdom
 */

import { render } from 'lit-html';
import { describe, expect, it, vi } from 'vitest';
import { workspacesConfigView } from './workspaces-config.js';

function renderToContainer(template) {
  const container = document.createElement('div');
  render(template, container);
  return container;
}

const appState = {
  workspaces: [
    {
      name: 'multi',
      path: '/parent',
      projects: [
        { name: 'api', path: 'api', depends_on: [] },
        { name: 'web', path: 'web', depends_on: ['api'] },
      ],
      integration_test: null,
      umbrella_repo: null,
    },
  ],
  workspaceRuns: [],
};

describe('workspacesConfigView setup action', () => {
  it('renders a Workspace setup action button', () => {
    const container = renderToContainer(
      workspacesConfigView(appState, { onSetup: vi.fn() }),
    );
    const tip = container.querySelector(
      'sl-tooltip[content="Workspace setup"]',
    );
    expect(tip).not.toBeNull();
    expect(tip.querySelector('button.ws-action-btn')).not.toBeNull();
  });

  it('calls onSetup with the workspace name', () => {
    const onSetup = vi.fn();
    const container = renderToContainer(
      workspacesConfigView(appState, { onSetup }),
    );
    container
      .querySelector('sl-tooltip[content="Workspace setup"] button')
      .click();
    expect(onSetup).toHaveBeenCalledWith('multi');
  });

  it('keeps four actions per row (launch / edit / setup / delete)', () => {
    const container = renderToContainer(
      workspacesConfigView(appState, { onSetup: vi.fn() }),
    );
    const actions = container.querySelectorAll('.ws-actions .ws-action-btn');
    expect(actions.length).toBe(4);
  });
});
