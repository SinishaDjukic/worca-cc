/**
 * Tests for the Project Setup Wizard component (W-073).
 * @vitest-environment jsdom
 */

import { render } from 'lit-html';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _getWizardState,
  closeProjectSetupWizard,
  openProjectSetupWizard,
  projectSetupWizardView,
} from './project-setup-wizard.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

// A fetch double routed by URL. `applyCalls` records every /setup/apply body.
let applyCalls;
function installFetch({
  preflight = {},
  templates = [],
  isWorkspace = false,
  integrations = {},
} = {}) {
  applyCalls = [];
  vi.stubGlobal('fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/setup/preflight')) {
      return jsonRes({
        ok: true,
        isWorkspace,
        worcaInstalled: true,
        baseBranch: 'master',
        graphifyInstalled: false,
        crgInstalled: false,
        currentSettings: {
          baseBranch: null,
          graphifyEnabled: false,
          crgEnabled: false,
          defaultTemplate: null,
        },
        projectCount: isWorkspace ? 2 : undefined,
        projects: isWorkspace
          ? [
              { name: 'api', baseBranch: 'main', currentSettings: {} },
              { name: 'web', baseBranch: 'main', currentSettings: {} },
            ]
          : undefined,
        templates: isWorkspace ? templates : undefined,
        ...preflight,
      });
    }
    if (u.includes('/templates')) {
      return jsonRes({ ok: true, templates });
    }
    if (u.includes('/setup/apply')) {
      applyCalls.push(JSON.parse(opts.body));
      return jsonRes({ ok: true, worca: {} });
    }
    if (u.includes('/integrations/config')) {
      return jsonRes(integrations);
    }
    return jsonRes({ ok: true });
  });
}

function jsonRes(obj) {
  return { json: async () => obj };
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const rerender = () => render(projectSetupWizardView(rerender), container);
  rerender();
  return { container, rerender };
}

function clickButton(container, label) {
  const btn = [...container.querySelectorAll('sl-button')].find((b) =>
    b.textContent.includes(label),
  );
  if (!btn) throw new Error(`button not found: ${label}`);
  btn.dispatchEvent(new Event('click', { bubbles: true }));
}

afterEach(() => {
  closeProjectSetupWizard();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('projectSetupWizardView', () => {
  it('renders nothing when closed', () => {
    const { container } = mount();
    expect(container.querySelector('sl-dialog')).toBeNull();
  });
});

describe('single-project wizard', () => {
  beforeEach(() => installFetch());

  it('loads preflight and seeds the detected base branch', async () => {
    const { rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    const s = _getWizardState();
    expect(s.loading).toBe(false);
    expect(s.baseBranch).toBe('master');
  });

  it('renders the preflight step with the dialog + step title', async () => {
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    expect(container.querySelector('sl-dialog')).not.toBeNull();
    expect(container.querySelector('.wizard-step-title').textContent).toContain(
      'Your Project Environment',
    );
  });

  it('reflects graphify/crg install state in preflight checks', async () => {
    installFetch({ preflight: { graphifyInstalled: true } });
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    const checks = container.querySelectorAll('.wizard-check');
    // Graphify row should be the "ok" variant.
    const graphifyRow = [...checks].find((c) =>
      c.textContent.includes('Graphify'),
    );
    expect(graphifyRow.classList.contains('ok')).toBe(true);
  });

  it('Skip Setup from step 1 closes the wizard without applying', async () => {
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    const skip = [...container.querySelectorAll('sl-button')].find((b) =>
      b.textContent.includes('Skip Setup'),
    );
    skip.dispatchEvent(new Event('click', { bubbles: true }));
    expect(_getWizardState()).toBeNull();
    expect(applyCalls).toHaveLength(0);
  });

  it('Next on the base-branch step applies parallel.default_base_branch', async () => {
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    const s = _getWizardState();
    s.step = 2; // jump to base-branch step
    s.baseBranch = 'develop';
    rerender();
    clickButton(container, 'Next');
    await flush();
    expect(applyCalls).toContainEqual({ baseBranch: 'develop' });
    expect(_getWizardState().step).toBe(3);
  });

  it('toggling an installed tool applies immediately', async () => {
    installFetch({ preflight: { graphifyInstalled: true } });
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    const s = _getWizardState();
    s.step = 3;
    rerender();
    const sw = container.querySelector('sl-switch');
    expect(sw).not.toBeNull();
    sw.checked = true;
    sw.dispatchEvent(new Event('sl-change', { bubbles: true }));
    await flush();
    expect(applyCalls).toContainEqual({ graphifyEnabled: true });
  });

  it('Done on the final step closes the wizard', async () => {
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    _getWizardState().step = 5;
    rerender();
    const done = [...container.querySelectorAll('sl-button')].find(
      (b) => b.textContent.trim() === 'Done',
    );
    done.dispatchEvent(new Event('click', { bubbles: true }));
    expect(_getWizardState()).toBeNull();
  });

  it('shows the notify card + Configure Now when no integration is configured', async () => {
    installFetch({ integrations: {} });
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    _getWizardState().step = 5;
    rerender();
    const card = container.querySelector('.wizard-notify-card');
    expect(card).not.toBeNull();
    const btn = [...card.querySelectorAll('sl-button')].find((b) =>
      b.textContent.includes('Configure Now'),
    );
    expect(btn).not.toBeNull();
  });

  it('hides the notify card when an integration is already configured', async () => {
    installFetch({ integrations: { slack: { enabled: true } } });
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    _getWizardState().step = 5;
    rerender();
    expect(container.querySelector('.wizard-notify-card')).toBeNull();
  });

  it('shows an empty-state on the template step when no templates exist', async () => {
    // installFetch() default returns templates: [] for /templates.
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    _getWizardState().step = 4;
    rerender();
    expect(container.querySelector('.wizard-empty')).not.toBeNull();
    expect(container.textContent).toContain('No pipeline templates found');
    // No template dropdown when the list is empty.
    expect(container.querySelector('.wizard-template-select')).toBeNull();
  });
});

describe('install step (worca not installed)', () => {
  it('inserts an install step after preflight for a single project', async () => {
    installFetch({ preflight: { worcaInstalled: false, isGitRepo: true } });
    const { rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    expect(_getWizardState().steps).toEqual([
      'preflight',
      'install',
      'branch',
      'tools',
      'template',
      'complete',
    ]);
  });

  it('shows the Install Worca title on step 2', async () => {
    installFetch({ preflight: { worcaInstalled: false, isGitRepo: true } });
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    _getWizardState().step = 2;
    rerender();
    expect(container.querySelector('.wizard-step-title').textContent).toContain(
      'Install Worca',
    );
  });

  it('omits the install step when worca is already installed', async () => {
    installFetch({ preflight: { worcaInstalled: true } });
    const { rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    expect(_getWizardState().steps).not.toContain('install');
  });

  it('offers the Install button on the install step (git repo)', async () => {
    installFetch({ preflight: { worcaInstalled: false, isGitRepo: true } });
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    _getWizardState().step = 2;
    rerender();
    expect(container.querySelector('.wizard-install-btn')).not.toBeNull();
  });

  it('hides Install and warns when the project is not a git repo', async () => {
    installFetch({ preflight: { worcaInstalled: false, isGitRepo: false } });
    const { container, rerender } = mount();
    openProjectSetupWizard({ target: 'alpha' }, rerender);
    await flush();
    _getWizardState().step = 2;
    rerender();
    expect(container.querySelector('.wizard-install-btn')).toBeNull();
    expect(container.textContent).toContain('requires a git repository');
  });

  it('never inserts the install step for workspaces', async () => {
    installFetch({ templates: [], isWorkspace: true });
    const { rerender } = mount();
    openProjectSetupWizard(
      { target: 'ws', isWorkspace: true, projectCount: 2 },
      rerender,
    );
    await flush();
    expect(_getWizardState().steps).not.toContain('install');
  });
});

describe('workspace wizard', () => {
  const templates = [
    { tier: 'builtin', id: 'feature', name: 'feature', description: 'Full' },
    { tier: 'user', id: 'mine', name: 'mine', description: 'Mine' },
    { tier: 'project', id: 'local', name: 'local', description: 'Local' },
  ];

  beforeEach(() => installFetch({ templates, isWorkspace: true }));

  it('sets projectCount from the preflight response', async () => {
    const { rerender } = mount();
    openProjectSetupWizard(
      { target: 'ws', isWorkspace: true, projectCount: 0 },
      rerender,
    );
    await flush();
    expect(_getWizardState().projectCount).toBe(2);
  });

  it('filters project-tier templates out of the picker', async () => {
    const { container, rerender } = mount();
    openProjectSetupWizard(
      { target: 'ws', isWorkspace: true, projectCount: 2 },
      rerender,
    );
    await flush();
    _getWizardState().step = 4;
    rerender();
    const options = [
      ...container.querySelectorAll('.wizard-template-select sl-option'),
    ].map((o) => o.getAttribute('value'));
    // The "No default" sentinel option is always present.
    expect(options).toContain('__none__');
    expect(options).toContain('feature');
    expect(options).toContain('mine');
    expect(options).not.toContain('local');
  });

  it('shows the chosen template description in the fixed slot', async () => {
    const { container, rerender } = mount();
    openProjectSetupWizard(
      { target: 'ws', isWorkspace: true, projectCount: 2 },
      rerender,
    );
    await flush();
    _getWizardState().step = 4;
    rerender();
    const select = container.querySelector('.wizard-template-select');
    select.value = 'feature';
    select.dispatchEvent(new Event('sl-change', { bubbles: true }));
    expect(_getWizardState().templateSel).toEqual({
      tier: 'builtin',
      id: 'feature',
    });
    const slot = container.querySelector('.wizard-template-desc-slot');
    expect(slot).not.toBeNull();
    expect(slot.textContent).toContain('Full');
  });

  it('shows the workspace-scope note on the template step', async () => {
    const { container, rerender } = mount();
    openProjectSetupWizard(
      { target: 'ws', isWorkspace: true, projectCount: 2 },
      rerender,
    );
    await flush();
    _getWizardState().step = 4;
    rerender();
    expect(container.querySelector('.wizard-note')).not.toBeNull();
    expect(container.textContent).toContain('Applies to all 2 projects');
  });

  it('uses the workspace title', async () => {
    const { container, rerender } = mount();
    openProjectSetupWizard(
      { target: 'ws', isWorkspace: true, projectCount: 2 },
      rerender,
    );
    await flush();
    expect(container.querySelector('sl-dialog').getAttribute('label')).toBe(
      'Workspace Setup',
    );
  });
});
