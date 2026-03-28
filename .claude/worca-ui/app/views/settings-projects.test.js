/**
 * Tests for the Projects tab in Settings and Add-Project dialog.
 * @vitest-environment jsdom
 */

import { html, render } from 'lit-html';
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
    const removeButtons = container.querySelectorAll('sl-icon-button');
    expect(removeButtons.length).toBe(2);
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
