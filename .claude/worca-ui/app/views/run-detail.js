import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { stageTimelineView } from './stage-timeline.js';
import { statusClass, statusIcon, resolveStatus } from '../utils/status-badge.js';
import { formatDuration, elapsed, formatTimestamp } from '../utils/duration.js';
import { iconSvg, Clock, Timer, Cpu, GitBranch, RefreshCw, FileText, ClipboardCopy, Coins } from '../utils/icons.js';

function _lastStageEnd(stages) {
  if (!stages) return null;
  let latest = null;
  for (const s of Object.values(stages)) {
    if (s.completed_at && (!latest || s.completed_at > latest)) latest = s.completed_at;
  }
  return latest;
}

function _badgeVariant(status) {
  if (status === 'completed') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'in_progress' || status === 'interrupted') return 'warning';
  return 'neutral';
}

function _iterStatusIcon(iter) {
  const s = iter.status || 'pending';
  if (s === 'completed' && iter.outcome === 'success') return html`<span class="iter-status-icon success">${unsafeHTML(statusIcon('completed', 12))}</span>`;
  if (s === 'completed') return html`<span class="iter-status-icon">${unsafeHTML(statusIcon('completed', 12))}</span>`;
  if (s === 'error') return html`<span class="iter-status-icon failure">${unsafeHTML(statusIcon('error', 12))}</span>`;
  if (s === 'in_progress') return html`<span class="iter-status-icon in-progress">${unsafeHTML(statusIcon('in_progress', 12))}</span>`;
  return nothing;
}

function _triggerLabel(trigger) {
  if (!trigger) return nothing;
  const labels = {
    initial: 'Initial run',
    test_failure: 'Test failure',
    review_changes: 'Review changes',
    restart_planning: 'Restart planning',
  };
  return html`<span class="iteration-trigger">${labels[trigger] || trigger}</span>`;
}

function _outcomeLabel(outcome) {
  if (!outcome) return nothing;
  const cls = outcome === 'success' ? 'success' : 'failure';
  return html`<span class="iteration-outcome ${cls}">${outcome.replace(/_/g, ' ')}</span>`;
}

function _stageCost(iterations) {
  return iterations.reduce((sum, it) => sum + (it.cost_usd || 0), 0);
}

function timingStripView(startedAt, completedAt, extra = nothing) {
  const dur = startedAt ? formatDuration(elapsed(startedAt, completedAt || null)) : '';
  return html`
    <div class="timing-strip">
      ${startedAt ? html`<span class="timing-strip-item"><span class="meta-label">Started:</span> <span class="meta-value">${formatTimestamp(startedAt)}</span></span>` : nothing}
      ${completedAt ? html`<span class="timing-strip-item"><span class="meta-label">Finished:</span> <span class="meta-value">${formatTimestamp(completedAt)}</span></span>` : nothing}
      ${dur ? html`<span class="timing-strip-item"><span class="meta-label">Duration:</span> <span class="meta-value">${dur}</span></span>` : nothing}
      ${extra}
    </div>
  `;
}

function _iterationDetailView(iter, stageKey, stageAgent, promptData) {
  const agentName = iter.agent || stageAgent || stageKey;
  const model = iter.model || '';
  const iterNum = iter.number ?? 0;
  // Find the prompt for this iteration
  const iterPrompts = promptData?.iterationPrompts || [];
  const iterPrompt = iterPrompts.find(ip => ip.iteration === iterNum);
  const userPrompt = iterPrompt?.prompt || promptData?.userPrompt || null;
  const iterPromptData = userPrompt ? { agentInstructions: promptData?.agentInstructions, userPrompt } : promptData;
  const iterDur = iter.started_at ? formatDuration(elapsed(iter.started_at, iter.completed_at || null)) : '';
  return html`
    <div class="iteration-detail">
      ${timingStripView(iter.started_at, iter.completed_at)}
      <div class="stage-info-strip">
        ${agentName ? html`<span class="stage-info-item"><span class="stage-meta-icon">${unsafeHTML(iconSvg(Cpu, 12))}</span> ${agentName}${model ? html` <span class="text-muted">(${model})</span>` : ''}</span>` : nothing}
        ${iter.turns ? html`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${iter.turns}</span></span>` : nothing}
        ${iter.cost_usd != null ? html`<span class="stage-info-item"><span class="meta-label">Iteration Cost:</span> <span class="meta-value">$${Number(iter.cost_usd).toFixed(2)}</span></span>` : nothing}
        ${iterDur ? html`<span class="stage-info-item"><span class="meta-label">Iteration Duration:</span> <span class="meta-value">${iterDur}</span></span>` : nothing}
      </div>
      ${iter.trigger ? html`<div class="detail-row">${_triggerLabel(iter.trigger)}</div>` : nothing}
      ${iter.outcome ? html`<div class="detail-row">${_outcomeLabel(iter.outcome)}</div>` : nothing}
      ${_agentPromptSection(stageKey, iterPromptData)}
    </div>
  `;
}

function _copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
}

function _agentPromptSection(_stageKey, promptData) {
  if (!promptData) return nothing;
  const { agentInstructions, userPrompt } = promptData;
  if (!agentInstructions && !userPrompt) return nothing;
  return html`
    <sl-details class="agent-prompt-section">
      <div slot="summary" class="agent-prompt-header">
        <span class="stage-meta-icon">${unsafeHTML(iconSvg(FileText, 12))}</span>
        Agent Instructions
      </div>
      ${userPrompt ? html`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">User Prompt (-p)</span>
            <button class="copy-btn" @click=${(e) => _copyToClipboard(userPrompt, e.currentTarget)}>
              ${unsafeHTML(iconSvg(ClipboardCopy, 11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${userPrompt}</pre>
        </div>
      ` : nothing}
      ${agentInstructions ? html`
        <div class="agent-prompt-block">
          <div class="agent-prompt-label-row">
            <span class="agent-prompt-label">System Prompt (agent .md)</span>
            <button class="copy-btn" @click=${(e) => _copyToClipboard(agentInstructions, e.currentTarget)}>
              ${unsafeHTML(iconSvg(ClipboardCopy, 11))} Copy
            </button>
          </div>
          <pre class="agent-prompt-content">${agentInstructions}</pre>
        </div>
      ` : nothing}
    </sl-details>
  `;
}

export function runDetailView(run, settings = {}, options = {}) {
  if (!run) {
    return html`<div class="empty-state">Select a run to view details</div>`;
  }

  const branch = run.branch || run.work_request?.branch || '';
  const pr = run.pr_url || null;
  const endTime = run.completed_at
    || (!run.active ? _lastStageEnd(run.stages) : null);
  const stages = run.stages || {};
  const stageUi = settings.stageUi || {};
  const agents = settings.agents || {};

  return html`
    <div class="run-detail">
      ${stageTimelineView(stages, stageUi, run.active)}

      <div class="run-info-section">
        ${branch ? html`
          <div class="run-branch">
            <span class="stage-meta-icon">${unsafeHTML(iconSvg(GitBranch, 14))}</span>
            <span>${branch}</span>
            ${pr ? html`<a class="run-pr-link" href="${pr}" target="_blank">View PR</a>` : nothing}
          </div>
        ` : nothing}
        ${timingStripView(run.started_at, endTime)}
        ${(() => {
          const allIters = Object.values(stages).flatMap(s => s.iterations || []);
          const pipelineCost = allIters.reduce((sum, it) => sum + (it.cost_usd || 0), 0);
          return pipelineCost > 0 ? html`
            <div class="pipeline-cost-strip">
              <span class="meta-label">Pipeline Cost:</span> <span class="meta-value">$${pipelineCost.toFixed(2)}</span>
            </div>
          ` : nothing;
        })()}
      </div>

      <div class="stage-panels">
        ${Object.entries(stages).map(([key, stage]) => {
          const label = stageUi[key]?.label || key.replace(/_/g, ' ').toUpperCase();
          const stageStatus = resolveStatus(stage.status || 'pending', run.active);
          const stageAgent = stage.agent || agents[key]?.agent || key;
          const stageModel = stage.model || agents[key]?.model || '';
          const stageDuration = stage.started_at
            ? formatDuration(elapsed(stage.started_at, stage.completed_at || null))
            : '';
          const iterations = stage.iterations || [];
          const hasMultipleIterations = iterations.length > 1;
          const stageCost = _stageCost(iterations);

          return html`
            <sl-details ?open=${stageStatus === 'in_progress'} class="stage-panel">
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${statusClass(stageStatus)}">${unsafeHTML(statusIcon(stageStatus))}</span>
                <span class="stage-panel-label">${label}</span>
                <span class="stage-panel-meta">
                  ${hasMultipleIterations ? html`
                    <span class="stage-meta-item stage-meta-iteration">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(RefreshCw, 11))}</span>
                      <span class="meta-value">${iterations.length} iterations</span>
                    </span>
                  ` : nothing}
                  ${stageCost > 0 ? html`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(Coins, 11))}</span>
                      <span class="meta-value">$${stageCost.toFixed(2)}</span>
                    </span>
                  ` : nothing}
                  ${stage.completed_at ? html`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(Clock, 11))}</span>
                      <span class="meta-value">${formatTimestamp(stage.completed_at)}</span>
                    </span>
                  ` : nothing}
                  ${stageDuration ? html`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(Timer, 11))}</span>
                      <span class="meta-value">${stageDuration}</span>
                    </span>
                  ` : nothing}
                </span>
                <sl-badge variant="${_badgeVariant(stageStatus)}" pill>
                  ${stageStatus.replace(/_/g, ' ')}
                </sl-badge>
              </div>
              ${(() => {
                const promptData = stageStatus !== 'pending' ? options.promptCache?.[key] : null;
                if (hasMultipleIterations) {
                  const stageTotalDurSec = iterations.reduce((sum, it) => {
                    if (it.duration_ms) return sum + it.duration_ms / 1000;
                    if (it.started_at) return sum + elapsed(it.started_at, it.completed_at || null);
                    return sum;
                  }, 0);
                  const stageTotalDur = formatDuration(stageTotalDurSec);
                  return html`
                    <div class="stage-totals-strip">
                      <span class="stage-totals-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${stageCost.toFixed(2)}</span></span>
                      <span class="stage-totals-item"><span class="meta-label">Duration:</span> <span class="meta-value">${stageTotalDur}</span></span>
                    </div>
                    <sl-tab-group>
                      ${iterations.map(iter => html`
                        <sl-tab slot="nav" panel="iter-${key}-${iter.number}">
                          Iter ${iter.number} ${_iterStatusIcon(iter)}
                        </sl-tab>
                      `)}
                      ${iterations.map(iter => html`
                        <sl-tab-panel name="iter-${key}-${iter.number}">
                          ${_iterationDetailView(iter, key, stageAgent, promptData)}
                        </sl-tab-panel>
                      `)}
                    </sl-tab-group>
                  `;
                }
                return html`
                  <div class="stage-detail">
                    ${timingStripView(stage.started_at, stage.completed_at)}
                    <div class="stage-info-strip">
                      ${stageAgent ? html`<span class="stage-info-item"><span class="stage-meta-icon">${unsafeHTML(iconSvg(Cpu, 12))}</span> ${stageAgent}${stageModel ? html` <span class="text-muted">(${stageModel})</span>` : ''}</span>` : nothing}
                      ${iterations.length === 1 && iterations[0].turns ? html`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${iterations[0].turns}</span></span>` : nothing}
                      ${iterations.length === 1 && iterations[0].cost_usd != null ? html`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(iterations[0].cost_usd).toFixed(2)}</span></span>` : nothing}
                    </div>
                    ${iterations.length === 1 && iterations[0].trigger ? html`<div class="detail-row">${_triggerLabel(iterations[0].trigger)}</div>` : nothing}
                    ${iterations.length === 1 && iterations[0].outcome ? html`<div class="detail-row">${_outcomeLabel(iterations[0].outcome)}</div>` : nothing}
                    ${stage.task_progress ? html`<div class="detail-row"><span class="detail-label">Progress:</span> ${stage.task_progress}</div>` : nothing}
                    ${stage.error ? html`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${stage.error}</div>` : nothing}
                    ${promptData ? _agentPromptSection(key, promptData) : nothing}
                  </div>
                `;
              })()}
            </sl-details>
          `;
        })}
      </div>
    </div>
  `;
}
