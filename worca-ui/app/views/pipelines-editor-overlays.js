/**
 * Prompts tab for the Pipelines editor.
 *
 * Shows the effective per-stage prompt the pipeline runs — agent `*.md` and
 * user-prompt `*.block.md` — for every stage, always (built-in pipelines
 * included). Each file is classified by the server (GET /templates/:tier/:id/
 * prompts → { filename: model }) as one of:
 *
 *   - 'builtin'  — built-in default used unchanged (the pipeline doesn't touch it)
 *   - 'pipeline' — the pipeline fully replaces the built-in prompt
 *   - 'extends'  — the pipeline merges into the built-in (append / overwrite
 *                  sections), which are highlighted below the base.
 *
 * Read-only; no editing in this surface. Stage→file mapping follows
 * src/worca/orchestrator/stages.py naming.
 */

import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { renderMarkdown } from '../utils/markdown.js';

/**
 * Stage→prompt file mapping.
 * agentFiles: agent prompt files (first present wins, shown as sub-tabs when >1)
 * blockFiles: user prompt (block) files
 */
export const STAGE_OVERLAY_MAP = [
  {
    key: 'plan',
    label: 'Plan',
    agentFiles: ['planner.md'],
    blockFiles: ['plan.block.md'],
  },
  {
    key: 'plan_review',
    label: 'Plan Review',
    agentFiles: ['plan_reviewer.md', 'plan_editor.md'],
    blockFiles: ['plan-review.block.md', 'plan-edit.block.md'],
  },
  {
    key: 'coordinate',
    label: 'Coordinate',
    agentFiles: ['coordinator.md'],
    blockFiles: ['coordinate.block.md'],
  },
  {
    key: 'implement',
    label: 'Implement',
    agentFiles: ['implementer.md'],
    blockFiles: ['implement.block.md'],
  },
  {
    key: 'test',
    label: 'Test',
    agentFiles: ['tester.md'],
    blockFiles: ['test.block.md'],
  },
  {
    key: 'review',
    label: 'Review',
    agentFiles: ['reviewer.md'],
    blockFiles: ['review.block.md'],
  },
  {
    key: 'pr',
    label: 'PR',
    agentFiles: ['guardian.md'],
    blockFiles: ['pr.block.md'],
  },
  {
    key: 'learn',
    label: 'Learn',
    agentFiles: ['learner.md'],
    blockFiles: ['learn.block.md'],
  },
];

/**
 * Collect the prompt files present for a stage from the prompts model.
 * Returns an ordered list of { name, role: 'agent'|'user', model }.
 */
export function stagePromptFiles(stage, prompts) {
  const files = [];
  for (const name of stage.agentFiles) {
    if (prompts && Object.hasOwn(prompts, name)) {
      files.push({ name, role: 'agent', model: prompts[name] });
    }
  }
  for (const name of stage.blockFiles) {
    if (prompts && Object.hasOwn(prompts, name)) {
      files.push({ name, role: 'user', model: prompts[name] });
    }
  }
  return files;
}

/**
 * Prompt files no stage in STAGE_OVERLAY_MAP claims, split into shared
 * blocks (`*.block.md` embedded into stage prompts via `{{block:...}}` —
 * crg-reminder, graphify-orientation/-reminder, …) and auxiliary agents
 * (`*.md` outside the stage walk — template-advisor, workspace_planner).
 * Dynamic over the server model, so new core files (and custom-stage
 * overlays shipped by a template) appear without a mapping change.
 * Returns `{ blocks: [...], agents: [...] }` of { name, role, model },
 * each sorted by name.
 */
export function unmappedPromptFiles(prompts) {
  const mapped = new Set();
  for (const stage of STAGE_OVERLAY_MAP) {
    for (const name of stage.agentFiles) mapped.add(name);
    for (const name of stage.blockFiles) mapped.add(name);
  }
  const blocks = [];
  const agents = [];
  for (const name of Object.keys(prompts || {}).sort()) {
    if (mapped.has(name)) continue;
    if (name.endsWith('.block.md')) {
      blocks.push({ name, role: 'user', model: prompts[name] });
    } else {
      agents.push({ name, role: 'agent', model: prompts[name] });
    }
  }
  return { blocks, agents };
}

// Source → badge variant + label + tooltip. Colors follow the badge-color
// language: neutral = unchanged default, blue = wholly pipeline-defined,
// amber = caution / merged-into the built-in.
const _SOURCE_META = {
  builtin: {
    variant: 'neutral',
    label: 'Built-in',
    tip: 'This pipeline uses the built-in prompt unchanged.',
  },
  pipeline: {
    variant: 'primary',
    label: 'Replaced',
    tip: 'This pipeline fully replaces the built-in prompt with its own.',
  },
  extends: {
    variant: 'warning',
    label: 'Merged',
    tip: 'This pipeline merges into the built-in prompt — the highlighted sections below are appended or overwritten.',
  },
};

function _sourceBadge(source) {
  const meta = _SOURCE_META[source] || _SOURCE_META.builtin;
  return html`<sl-tooltip content=${meta.tip}
    ><sl-badge class="prompt-source-badge" variant=${meta.variant} pill
      >${meta.label}</sl-badge
    ></sl-tooltip
  >`;
}

function _md(text) {
  return html`<div class="prompt-file-content markdown-body">
    ${unsafeHTML(renderMarkdown(text || ''))}
  </div>`;
}

// Render a single overlay contribution (one ## Override block, or a raw append)
// as a colored, tooltipped panel.
function _contribution(kind, heading, body) {
  const isOverwrite = kind === 'overwrite';
  const cls = isOverwrite ? 'prompt-merge-overwrite' : 'prompt-merge-append';
  const verb = isOverwrite ? 'Overwrites' : 'Appends to';
  const where = heading
    ? html`<code>## ${heading}</code>`
    : 'the end of the prompt';
  const tip = isOverwrite
    ? `The pipeline replaces the built-in “${heading}” section with this content.`
    : heading
      ? `The pipeline appends this content to the built-in “${heading}” section.`
      : 'The pipeline appends this content after the built-in prompt.';
  return html`<div class="prompt-merge-block ${cls}">
    <div class="prompt-merge-tag">
      <sl-tooltip content=${tip}>
        <span class="prompt-merge-verb">${verb}</span> ${where}
      </sl-tooltip>
    </div>
    ${_md(body)}
  </div>`;
}

function _fileBody(model) {
  if (!model) return nothing;
  if (model.source === 'extends') {
    const contributions =
      model.rawAppend != null &&
      (!model.contributions || model.contributions.length === 0)
        ? [_contribution('append', null, model.rawAppend)]
        : (model.contributions || []).map((c) =>
            _contribution(c.mode, c.section, c.body),
          );
    return html`
      <div class="prompt-extends">
        <div class="prompt-base-label">Built-in base</div>
        ${_md(model.builtin)}
        <div class="prompt-customizations-label">
          Pipeline customizations
          <sl-tooltip
            content="Green = appended to the built-in. Amber = overwrites a built-in section."
            ><span class="prompt-help-dot">?</span></sl-tooltip
          >
        </div>
        ${contributions}
      </div>
    `;
  }
  return _md(model.content);
}

/**
 * Render sub-tabs for a stage's prompt files. Each present file becomes a tab
 * labeled by role (Agent prompt / User prompt) with a source badge.
 */
function _stageTabs(stage, files) {
  const tabs = [];
  const panels = [];
  for (const f of files) {
    const panelId = `prompt-${stage.key}-${f.name.replace(/\./g, '-')}`;
    const baseName = f.name.replace(/\.md$/, '');
    const roleLabel =
      f.label || (f.role === 'agent' ? 'Agent prompt' : 'User prompt');
    tabs.push(html`
      <sl-tab slot="nav" panel=${panelId}>
        ${roleLabel}
        <span class="overlay-file-label">(${baseName})</span>
        ${_sourceBadge(f.model?.source)}
      </sl-tab>
    `);
    panels.push(html`
      <sl-tab-panel name=${panelId}>${_fileBody(f.model)}</sl-tab-panel>
    `);
  }
  if (tabs.length === 0) return nothing;
  return html`
    <sl-tab-group class="overlay-stage-tabs">${tabs}${panels}</sl-tab-group>
  `;
}

/**
 * Render the Prompts tab content.
 *
 * @param {object} prompts - { filename: model } map from the server
 */
export function promptsTabView(prompts) {
  if (!prompts || Object.keys(prompts).length === 0) {
    return html`<div class="settings-tab-content overlay-empty">
      No prompt files found.
    </div>`;
  }

  const stageCards = STAGE_OVERLAY_MAP.map((stage) => {
    const files = stagePromptFiles(stage, prompts);
    if (files.length === 0) {
      return html`
        <div class="overlay-stage-card overlay-stage-card--disabled">
          <div class="overlay-stage-label">${stage.label}</div>
        </div>
      `;
    }
    return html`
      <sl-details class="overlay-stage-card" summary=${stage.label}>
        ${_stageTabs(stage, files)}
      </sl-details>
    `;
  });

  // Files no stage claims: shared blocks ({{block:...}} inserts like
  // crg-reminder / graphify-*) and auxiliary agents (template-advisor,
  // workspace_planner). Dynamic — new files appear without a map change.
  const { blocks: sharedBlocks, agents: auxAgents } =
    unmappedPromptFiles(prompts);
  const sharedCard =
    sharedBlocks.length === 0
      ? nothing
      : html`
          <sl-details
            class="overlay-stage-card overlay-shared-card"
            summary="Shared blocks"
          >
            <div class="overlay-shared-note">
              Inserted into stage prompts via
              <code>{{block:&lt;name&gt;}}</code> references — a change here
              affects every stage that embeds the block.
            </div>
            ${_stageTabs(
              { key: 'shared-blocks' },
              sharedBlocks.map((f) => ({ ...f, label: 'Shared block' })),
            )}
          </sl-details>
        `;
  const auxCard =
    auxAgents.length === 0
      ? nothing
      : html`
          <sl-details
            class="overlay-stage-card overlay-shared-card"
            summary="Auxiliary agents"
          >
            <div class="overlay-shared-note">
              Agents outside the stage walk (template advisor, workspace
              planner, custom-stage agents shipped by this pipeline).
            </div>
            ${_stageTabs({ key: 'aux-agents' }, auxAgents)}
          </sl-details>
        `;

  return html`
    <div class="settings-tab-content overlay-stages">
      <div class="prompt-legend">
        Each stage shows the prompt the pipeline actually runs.
        <sl-badge class="prompt-source-badge" variant="neutral" pill>Built-in</sl-badge>
        unchanged default ·
        <sl-badge class="prompt-source-badge" variant="primary" pill>Replaced</sl-badge>
        fully pipeline-defined ·
        <sl-badge class="prompt-source-badge" variant="warning" pill>Merged</sl-badge>
        built-in + highlighted changes
      </div>
      ${stageCards}${sharedCard}${auxCard}
    </div>
  `;
}
