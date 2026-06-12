/**
 * Unit tests for pipelines-editor-overlays.js (the Prompts tab).
 *
 * Covers:
 *   1. STAGE_OVERLAY_MAP file matchings
 *   2. stagePromptFiles selection over the server prompts model
 *   3. promptsTabView rendering: always shows every stage, source badges,
 *      merge highlighting (append = green, overwrite = amber) with tooltips
 *
 * @vitest-environment jsdom
 */

import { render } from 'lit-html';
import { describe, expect, it } from 'vitest';
import {
  promptsTabView,
  STAGE_OVERLAY_MAP,
  stagePromptFiles,
  unmappedPromptFiles,
} from './pipelines-editor-overlays.js';

function mount(prompts) {
  const container = document.createElement('div');
  render(promptsTabView(prompts), container);
  return container;
}

// A builtin-source model entry (fallback to the built-in prompt).
function builtin(content = '# core') {
  return { source: 'builtin', content };
}

// ─── 1. Stage map ────────────────────────────────────────────────────────────

describe('STAGE_OVERLAY_MAP file matchings', () => {
  it('has 8 stages in the correct order', () => {
    expect(STAGE_OVERLAY_MAP.map((s) => s.key)).toEqual([
      'plan',
      'plan_review',
      'coordinate',
      'implement',
      'test',
      'review',
      'pr',
      'learn',
    ]);
  });

  it('plan stage maps to planner.md + plan.block.md', () => {
    const stage = STAGE_OVERLAY_MAP.find((s) => s.key === 'plan');
    expect(stage.agentFiles).toEqual(['planner.md']);
    expect(stage.blockFiles).toEqual(['plan.block.md']);
  });

  it('plan_review stage fans out to 2 agent + 2 block files', () => {
    const stage = STAGE_OVERLAY_MAP.find((s) => s.key === 'plan_review');
    expect(stage.agentFiles).toEqual(['plan_reviewer.md', 'plan_editor.md']);
    expect(stage.blockFiles).toEqual([
      'plan-review.block.md',
      'plan-edit.block.md',
    ]);
  });
});

// ─── 2. stagePromptFiles ─────────────────────────────────────────────────────

describe('stagePromptFiles', () => {
  it('returns agent then block files, tagged with role + model', () => {
    const prompts = {
      'coordinator.md': builtin('# coord'),
      'coordinate.block.md': { source: 'pipeline', content: 'X' },
    };
    const stage = STAGE_OVERLAY_MAP.find((s) => s.key === 'coordinate');
    const files = stagePromptFiles(stage, prompts);
    expect(files).toEqual([
      {
        name: 'coordinator.md',
        role: 'agent',
        model: prompts['coordinator.md'],
      },
      {
        name: 'coordinate.block.md',
        role: 'user',
        model: prompts['coordinate.block.md'],
      },
    ]);
  });

  it('omits files absent from the prompts model', () => {
    const stage = STAGE_OVERLAY_MAP.find((s) => s.key === 'plan_review');
    const files = stagePromptFiles(stage, { 'plan_editor.md': builtin() });
    expect(files.map((f) => f.name)).toEqual(['plan_editor.md']);
  });
});

// ─── 3. promptsTabView rendering ─────────────────────────────────────────────

describe('promptsTabView', () => {
  it('renders an empty notice when the model is empty', () => {
    expect(mount({}).textContent).toContain('No prompt files found');
  });

  it('always shows every stage (built-in fallback included)', () => {
    // Only one builtin file present, but every stage should still render —
    // those with files as sl-details, those without as a disabled card.
    const container = mount({ 'planner.md': builtin('# Plan core') });
    const summaries = Array.from(container.querySelectorAll('sl-details')).map(
      (d) => d.getAttribute('summary'),
    );
    expect(summaries).toContain('Plan');
    // Stages without any resolved file still render a (disabled) card.
    const disabled = container.querySelectorAll(
      '.overlay-stage-card--disabled',
    );
    expect(disabled.length).toBeGreaterThan(0);
  });

  it('renders a source badge per file (Built-in / Replaced / Merged)', () => {
    const container = mount({
      'planner.md': builtin('# core'),
      'plan.block.md': { source: 'pipeline', content: 'replaced body' },
    });
    const badges = Array.from(
      container.querySelectorAll('.prompt-source-badge'),
    ).map((b) => b.textContent.trim());
    expect(badges).toContain('Built-in');
    expect(badges).toContain('Replaced');
  });

  it('renders builtin content as markdown', () => {
    const container = mount({ 'planner.md': builtin('# Hello World') });
    const body = container.querySelector('.markdown-body');
    expect(body).not.toBeNull();
    expect(body.innerHTML).toContain('Hello World');
  });

  it('highlights append vs overwrite contributions with distinct colors', () => {
    const container = mount({
      'reviewer.md': {
        source: 'extends',
        builtin: '# Base review prompt',
        contributions: [
          { section: 'Rules', mode: 'append', body: 'extra rule' },
          { section: 'Style', mode: 'overwrite', body: 'new style' },
        ],
        rawAppend: null,
      },
    });
    expect(container.querySelector('.prompt-merge-append')).not.toBeNull();
    expect(container.querySelector('.prompt-merge-overwrite')).not.toBeNull();
    // Base prompt is shown above the customizations.
    expect(container.textContent).toContain('Built-in base');
    expect(container.textContent).toContain('Pipeline customizations');
    // Verbs label the contribution kind.
    expect(container.textContent).toContain('Appends to');
    expect(container.textContent).toContain('Overwrites');
  });

  it('renders a raw trailing append as a single append block', () => {
    const container = mount({
      'reviewer.md': {
        source: 'extends',
        builtin: '# Base',
        contributions: [],
        rawAppend: 'appended tail text',
      },
    });
    const appendBlocks = container.querySelectorAll('.prompt-merge-append');
    expect(appendBlocks.length).toBe(1);
    expect(container.querySelector('.prompt-merge-overwrite')).toBeNull();
    expect(container.textContent).toContain('appended tail text');
  });
});

// ─── 4. Shared blocks / auxiliary agents (unmapped files) ────────────────────

describe('unmappedPromptFiles', () => {
  it('splits unmapped files into shared blocks and auxiliary agents', () => {
    const prompts = {
      'planner.md': builtin(),
      'plan.block.md': builtin(),
      'graphify-reminder.block.md': builtin('# graphify'),
      'crg-reminder.block.md': builtin('# crg'),
      'template-advisor.md': builtin('# advisor'),
      'workspace_planner.md': builtin('# wsp'),
    };
    const { blocks, agents } = unmappedPromptFiles(prompts);
    expect(blocks.map((f) => f.name)).toEqual([
      'crg-reminder.block.md',
      'graphify-reminder.block.md',
    ]);
    expect(agents.map((f) => f.name)).toEqual([
      'template-advisor.md',
      'workspace_planner.md',
    ]);
    expect(blocks[0].role).toBe('user');
    expect(agents[0].role).toBe('agent');
  });

  it('returns empty groups when every file is stage-mapped', () => {
    const { blocks, agents } = unmappedPromptFiles({
      'planner.md': builtin(),
      'plan.block.md': builtin(),
    });
    expect(blocks).toEqual([]);
    expect(agents).toEqual([]);
  });
});

describe('promptsTabView shared cards', () => {
  it('renders a Shared blocks card with each unmapped block file', () => {
    const el = mount({
      'planner.md': builtin(),
      'graphify-reminder.block.md': builtin('# graphify body'),
      'crg-reminder.block.md': {
        source: 'pipeline',
        content: '# replaced crg',
      },
    });
    const shared = [...el.querySelectorAll('sl-details')].find(
      (d) => d.getAttribute('summary') === 'Shared blocks',
    );
    expect(shared).toBeTruthy();
    expect(shared.textContent).toContain('graphify-reminder.block');
    expect(shared.textContent).toContain('crg-reminder.block');
    expect(shared.textContent).toContain('Shared block');
    // source badges flow through the same classification
    expect(shared.textContent).toContain('Replaced');
  });

  it('renders an Auxiliary agents card for unmapped agent files', () => {
    const el = mount({
      'planner.md': builtin(),
      'workspace_planner.md': builtin('# wsp'),
    });
    const aux = [...el.querySelectorAll('sl-details')].find(
      (d) => d.getAttribute('summary') === 'Auxiliary agents',
    );
    expect(aux).toBeTruthy();
    expect(aux.textContent).toContain('workspace_planner');
  });

  it('omits both cards when nothing is unmapped', () => {
    const el = mount({ 'planner.md': builtin() });
    const summaries = [...el.querySelectorAll('sl-details')].map((d) =>
      d.getAttribute('summary'),
    );
    expect(summaries).not.toContain('Shared blocks');
    expect(summaries).not.toContain('Auxiliary agents');
  });
});
