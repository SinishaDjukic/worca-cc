/**
 * Tests for the Projects tab in Settings and Add-Project dialog.
 * @vitest-environment jsdom
 */

import { render } from 'lit-html';
import { describe, expect, it, vi } from 'vitest';
import { addProjectDialogView } from './add-project-dialog.js';
import { _projectsTab as projectsTab } from './settings.js';

function renderToString(template) {
  const container = document.createElement('div');
  render(template, container);
  return container.innerHTML;
}

function renderToContainer(template) {
  const container = document.createElement('div');
  render(template, container);
  return container;
}

describe('Projects tab in settings', () => {
  it('renders in settings', () => {
    const projects = [
      { name: 'alpha', path: '/alpha' },
      { name: 'beta', path: '/beta' },
    ];
    const output = renderToString(
      projectsTab(projects, {
        onProjectAdd: vi.fn(),
        onProjectRemove: vi.fn(),
        rerender: vi.fn(),
      }),
    );
    expect(output).toContain('Projects');
    expect(output).toContain('alpha');
    expect(output).toContain('beta');
  });

  it('lists all projects with name and path', () => {
    const projects = [
      { name: 'proj-a', path: '/home/proj-a' },
      { name: 'proj-b', path: '/home/proj-b' },
    ];
    const container = renderToContainer(
      projectsTab(projects, {
        onProjectAdd: vi.fn(),
        onProjectRemove: vi.fn(),
        rerender: vi.fn(),
      }),
    );
    const items = container.querySelectorAll('.projects-list-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('proj-a');
    expect(items[0].textContent).toContain('/home/proj-a');
    expect(items[1].textContent).toContain('proj-b');
  });

  it('renders as a table with Name/Path/worca-cc/Actions columns', () => {
    const projects = [{ name: 'alpha', path: '/alpha' }];
    const container = renderToContainer(
      projectsTab(projects, {
        onProjectAdd: vi.fn(),
        onProjectRemove: vi.fn(),
        rerender: vi.fn(),
      }),
    );
    const headers = [
      ...container.querySelectorAll('.projects-config-table th'),
    ].map((th) => th.textContent.trim());
    expect(headers).toEqual(['Name', 'Path', 'worca-cc', 'Actions']);
  });

  it('remove button present for each project', () => {
    const projects = [
      { name: 'alpha', path: '/alpha' },
      { name: 'beta', path: '/beta' },
    ];
    const container = renderToContainer(
      projectsTab(projects, {
        onProjectAdd: vi.fn(),
        onProjectRemove: vi.fn(),
        rerender: vi.fn(),
      }),
    );
    const removeButtons = container.querySelectorAll(
      '.projects-list-item .proj-action-btn--danger',
    );
    expect(removeButtons.length).toBe(2);
  });

  it('renders the worca-cc version badge with a variant', () => {
    const projects = [{ name: 'alpha', path: '/alpha', worcaVersion: '1.0.0' }];
    const container = renderToContainer(
      projectsTab(projects, {
        onProjectAdd: vi.fn(),
        onProjectRemove: vi.fn(),
        rerender: vi.fn(),
      }),
    );
    const badge = container.querySelector('sl-badge');
    expect(badge).not.toBeNull();
    expect(badge.getAttribute('variant')).toBeTruthy();
    expect(badge.textContent).toContain('1.0.0');
  });

  it('Setup button calls onProjectSetup with the project name', () => {
    const onProjectSetup = vi.fn();
    const projects = [{ name: 'alpha', path: '/alpha' }];
    const container = renderToContainer(
      projectsTab(projects, {
        onProjectAdd: vi.fn(),
        onProjectRemove: vi.fn(),
        onProjectSetup,
        rerender: vi.fn(),
      }),
    );
    // Setup is the middle action button (Update / Setup / Remove).
    const actionBtns = container.querySelectorAll(
      '.projects-list-item .proj-action-btn',
    );
    expect(actionBtns.length).toBe(3);
    actionBtns[1].click();
    expect(onProjectSetup).toHaveBeenCalledWith('alpha');
  });
});

describe('Add-project dialog', () => {
  it('renders name and path fields', () => {
    const state = { addProjectDialogOpen: true };
    const container = renderToContainer(
      addProjectDialogView(state, { onProjectAdd: vi.fn(), onClose: vi.fn() }),
    );
    const nameInput = container.querySelector('#add-project-name');
    const pathInput = container.querySelector('#add-project-path');
    expect(nameInput).not.toBeNull();
    expect(pathInput).not.toBeNull();
  });

  it('does not render when dialog is closed', () => {
    const state = { addProjectDialogOpen: false };
    const container = renderToContainer(
      addProjectDialogView(state, { onProjectAdd: vi.fn(), onClose: vi.fn() }),
    );
    // When closed, nothing renders (no dialog element)
    expect(container.querySelector('sl-dialog')).toBeNull();
  });

  it('validates empty name', () => {
    const state = { addProjectDialogOpen: true };
    const container = renderToContainer(
      addProjectDialogView(state, { onProjectAdd: vi.fn(), onClose: vi.fn() }),
    );
    const nameInput = container.querySelector('#add-project-name');
    // The input has required attribute
    expect(nameInput.getAttribute('required')).not.toBeNull();
  });
});
