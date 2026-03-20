import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { stageTimelineView } from './stage-timeline.js';
import { statusClass, statusIcon, resolveStatus } from '../utils/status-badge.js';
import { formatDuration, elapsed, formatTimestamp } from '../utils/duration.js';
import { iconSvg, Clock, Timer, Cpu, GitBranch, RefreshCw, FileText, ClipboardCopy, Coins, RotateCcw, List } from '../utils/icons.js';
import { beadsDependencyGraph, priorityVariant, statusVariant } from './beads-panel.js';
import { resolveIterationTab } from './stage-tab-memory.js';
import { scrollOnExpand } from '../utils/scroll.js';

/**
 * Render a stacked horizontal timing bar at the pipeline level.
 * Segments: Thinking (Agent) | Tools (Agent) | Rest of Pipeline
 * 100% = pipeline wall time (started_at → last stage end).
 */
function _pipelineTimingBar(allIters, pipelineWallMs) {
  if (!pipelineWallMs || pipelineWallMs <= 0) return nothing;

  const thinkingMs = allIters.reduce((sum, it) => sum + (it.duration_api_ms || 0), 0);
  // duration_session_ms = CLI session time. Only fall back to duration_ms for legacy runs
  // where duration_session_ms is undefined. When explicitly 0 (e.g. preflight), don't fall back.
  const sessionMs = allIters.reduce((sum, it) => {
    if (it.duration_session_ms != null) return sum + it.duration_session_ms;
    return sum + (it.duration_ms || 0); // legacy fallback
  }, 0);
  const toolsMs = Math.max(0, sessionMs - thinkingMs);
  const restMs = Math.max(0, pipelineWallMs - sessionMs);

  if (thinkingMs <= 0 && toolsMs <= 0) return nothing;

  const thinkingPct = Math.round(thinkingMs / pipelineWallMs * 100);
  const toolsPct = Math.round(toolsMs / pipelineWallMs * 100);
  const restPct = Math.max(0, 100 - thinkingPct - toolsPct);

  const segments = [
    { key: 'thinking', pct: thinkingPct, ms: thinkingMs, label: 'Thinking (Agent)', desc: 'Time spent on model inference (API round-trips)', cls: 'timing-bar-thinking' },
    { key: 'tools', pct: toolsPct, ms: toolsMs, label: 'Tools (Agent)', desc: 'Time spent executing tools (bash, file I/O, subprocesses)', cls: 'timing-bar-tools' },
    { key: 'rest', pct: restPct, ms: restMs, label: 'Rest of Pipeline', desc: 'Orchestration, status writes, stage transitions, retry delays', cls: 'timing-bar-rest' },
  ].filter(s => s.pct > 0);

  return html`
    <div class="pipeline-timing-bar-container">
      <div class="pipeline-timing-bar">
        ${segments.map(s => html`
          <sl-tooltip>
            <div slot="content">
              <strong>${s.label}</strong><br>
              ${formatDuration(s.ms)} of ${formatDuration(pipelineWallMs)}<br>
              <span style="opacity:0.7">${s.desc}</span>
            </div>
            <div class="timing-bar-segment ${s.cls}" style="width:${s.pct}%">
              ${s.pct >= 15 ? html`<span class="timing-bar-segment-text">${s.label} ${s.pct}%</span>` :
                s.pct >= 8 ? html`<span class="timing-bar-segment-text">${s.pct}%</span>` : nothing}
            </div>
          </sl-tooltip>
        `)}
      </div>
      <div class="pipeline-timing-bar-legend">
        ${segments.map(s => html`
          <span class="timing-bar-legend-item">
            <span class="timing-bar-legend-swatch ${s.cls}"></span>
            <span class="timing-bar-legend-label">${s.label}</span>
            <span class="timing-bar-legend-value">${formatDuration(s.ms)} (${s.pct}%)</span>
          </span>
        `)}
      </div>
    </div>
  `;
}

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

function _classificationVariant(category) {
  if (category === 'infra_transient') return 'warning';
  if (category === 'infra_permanent' || category === 'logic_stuck' || category === 'env_missing') return 'danger';
  return 'neutral';
}

function _classificationStripView(iter) {
  const c = iter.classification;
  if (!c) return nothing;
  const variant = _classificationVariant(c.category);
  return html`
    <div class="classification-strip">
      <span class="classification-strip-item">
        <span class="classification-strip-label">Category:</span>
        <sl-badge variant="${variant}" pill>${c.category}</sl-badge>
      </span>
      <span class="classification-strip-item">
        <span class="classification-strip-label">Retriable:</span>
        <span class="classification-strip-value">${c.retriable ? 'yes' : 'no'}</span>
      </span>
      <span class="classification-strip-item">
        <span class="classification-strip-label">Similar:</span>
        <span class="classification-strip-value">${c.similar_to_previous ? 'yes' : 'no'}</span>
      </span>
      ${c.remediation ? html`
        <span class="classification-strip-item classification-remediation">
          <span class="classification-strip-label">Remediation:</span>
          <span class="classification-strip-value">${c.remediation}</span>
        </span>
      ` : nothing}
    </div>
  `;
}

function _circuitBreakerBannerView(run, settings) {
  const cb = run.circuit_breaker;
  if (!cb) return nothing;
  if (cb.tripped) {
    return html`
      <sl-alert class="circuit-breaker-banner" variant="danger" open>
        <strong>Circuit breaker tripped:</strong> ${cb.tripped_reason || 'Pipeline halted due to repeated errors.'}
      </sl-alert>
    `;
  }
  const failures = cb.consecutive_failures || 0;
  if (failures > 0) {
    const threshold = (settings.circuit_breaker || {}).max_consecutive_failures ?? 3;
    return html`
      <sl-alert class="circuit-breaker-banner" variant="warning" open>
        <strong>Circuit breaker warning:</strong> ${String(failures)}/${String(threshold)} consecutive failures.
      </sl-alert>
    `;
  }
  return nothing;
}

function _preflightCheckBadgeVariant(status) {
  if (status === 'pass') return 'success';
  if (status === 'warn') return 'warning';
  if (status === 'fail') return 'danger';
  return 'neutral';
}

function _preflightChecksView(stage, iter) {
  const isSkipped = stage.skipped || iter.outcome === 'skipped';
  if (isSkipped) {
    return html`<div class="preflight-checks-view"><sl-badge variant="neutral" pill>Skipped</sl-badge></div>`;
  }
  const output = iter.output || {};
  const checks = output.checks || [];
  const summary = output.summary || '';
  if (!checks.length && !summary) return nothing;
  return html`
    <div class="preflight-checks-view">
      ${summary ? html`<div class="preflight-summary">${summary}</div>` : nothing}
      ${checks.length > 0 ? html`
        <table class="preflight-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Check</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            ${checks.map(check => html`
              <tr>
                <td><sl-badge variant="${_preflightCheckBadgeVariant(check.status)}" pill>${check.status}</sl-badge></td>
                <td class="preflight-check-name">${check.name}</td>
                <td class="preflight-check-message">${check.message || ''}</td>
              </tr>
            `)}
          </tbody>
        </table>
      ` : nothing}
    </div>
  `;
}

function _stageCost(iterations) {
  return iterations.reduce((sum, it) => sum + (it.cost_usd || 0), 0);
}

function _stageToJson(key, stage, stageAgent, stageModel, promptData) {
  const iterations = stage.iterations || [];
  const wallMs = _stageWallMs(stage);
  return {
    stage: key,
    status: stage.status,
    agent: stageAgent || undefined,
    model: stageModel || undefined,
    cost_usd: _stageCost(iterations),
    duration: wallMs > 0 ? formatDuration(wallMs) : undefined,
    duration_ms: wallMs > 0 ? wallMs : undefined,
    started_at: stage.started_at || undefined,
    completed_at: stage.completed_at || undefined,
    error: stage.error || undefined,
    iterations: iterations.map(it => ({
      number: it.number,
      status: it.status,
      outcome: it.outcome || undefined,
      trigger: it.trigger || undefined,
      agent: it.agent || undefined,
      model: it.model || undefined,
      turns: it.turns || undefined,
      cost_usd: it.cost_usd || undefined,
      duration_ms: it.duration_ms || undefined,
      duration_session_ms: it.duration_session_ms || undefined,
      duration_api_ms: it.duration_api_ms || undefined,
      started_at: it.started_at || undefined,
      completed_at: it.completed_at || undefined,
    })),
    prompts: promptData ? {
      agent_instructions: promptData.agentInstructions || undefined,
      user_prompt: promptData.userPrompt || undefined,
    } : undefined,
  };
}

/** Total ms the stage actually ran — sum of all iteration durations. */
function _stageWallMs(stage) {
  const iters = stage.iterations || [];
  if (iters.length === 0) {
    if (!stage.started_at || !stage.completed_at) return 0;
    return elapsed(stage.started_at, stage.completed_at);
  }
  let total = 0;
  for (const it of iters) {
    if (it.started_at && it.completed_at) {
      total += elapsed(it.started_at, it.completed_at);
    }
  }
  return total;
}

function timingStripView(startedAt, completedAt, extra = nothing) {
  const dur = startedAt && completedAt ? formatDuration(elapsed(startedAt, completedAt)) : '';
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
        ${iter.duration_api_ms ? html`<span class="stage-info-item"><span class="meta-label">API Duration:</span> <span class="meta-value">${formatDuration(iter.duration_api_ms)}${iter.started_at && iter.completed_at ? ` (${Math.round(iter.duration_api_ms / elapsed(iter.started_at, iter.completed_at) * 100)}%)` : ''}</span></span>` : nothing}
        ${iter.cost_usd != null ? html`<span class="stage-info-item"><span class="meta-label">Iteration Cost:</span> <span class="meta-value">$${Number(iter.cost_usd).toFixed(2)}</span></span>` : nothing}
        ${iterDur ? html`<span class="stage-info-item"><span class="meta-label">Iteration Duration:</span> <span class="meta-value">${iterDur}</span></span>` : nothing}
      </div>
      ${iter.trigger ? html`<div class="detail-row">${_triggerLabel(iter.trigger)}</div>` : nothing}
      ${iter.outcome ? html`<div class="detail-row">${_outcomeLabel(iter.outcome)}</div>` : nothing}
      ${_classificationStripView(iter)}
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
    <sl-details class="agent-prompt-section" @sl-after-show=${scrollOnExpand}>
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

export function runBeadsSectionView(beads) {
  if (!beads) return nothing;
  if (beads.length === 0) {
    return html`
      <div class="run-beads-section">
        <sl-details class="run-beads-panel" @sl-after-show=${scrollOnExpand}>
          <div slot="summary" class="run-beads-header">
            <span class="run-beads-icon">${unsafeHTML(iconSvg(List, 16))}</span>
            <span class="run-beads-title">Beads</span>
          </div>
          <div class="run-beads-empty">No linked Beads issues</div>
        </sl-details>
      </div>
    `;
  }
  return html`
    <div class="run-beads-section">
      <sl-details class="run-beads-panel" @sl-after-show=${scrollOnExpand}>
        <div slot="summary" class="run-beads-header">
          <span class="run-beads-icon">${unsafeHTML(iconSvg(List, 16))}</span>
          <span class="run-beads-title">Beads</span>
          <span class="run-beads-count">${beads.filter(b => b.status === 'closed').length}/${beads.length}</span>
        </div>
        <div class="run-beads-list">
          ${beads.map(issue => html`
            <div class="run-bead-row">
              <sl-badge variant="${statusVariant(issue.status)}" pill>${issue.status}</sl-badge>
              <sl-badge variant="${priorityVariant(issue.priority)}" pill>P${issue.priority}</sl-badge>
              <span class="run-bead-id">#${issue.id}</span>
              <span class="run-bead-title">${issue.title}</span>
            </div>
          `)}
        </div>
        ${beads.length > 1 ? html`
          <div class="run-beads-graph">
            ${unsafeHTML(beadsDependencyGraph(beads))}
          </div>
        ` : ''}
      </sl-details>
    </div>
  `;
}

export function runDetailView(run, settings = {}, options = {}) {
  if (!run) {
    return html`<div class="empty-state">Select a run to view details</div>`;
  }

  const branch = run.branch || run.work_request?.branch || '';
  const pr = run.pr_url || null;
  const endTime = run.completed_at || _lastStageEnd(run.stages) || (run.active ? new Date().toISOString() : null);
  const rawStages = run.stages || {};
  // Ensure preflight and learn exist (may be absent in old runs)
  let stages = rawStages;
  if (!rawStages.preflight) stages = { preflight: { status: 'skipped' }, ...stages };
  if (!rawStages.learn) stages = { ...stages, learn: { status: 'skipped' } };
  const stageUi = settings.stageUi || {};
  const agents = settings.agents || {};

  return html`
    <div class="run-detail">
      ${stageTimelineView(stages, stageUi, run.active)}
      ${_circuitBreakerBannerView(run, settings)}

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
          const pipelineTurns = allIters.reduce((sum, it) => sum + (it.turns || 0), 0);
          const pipelineWallMs = run.started_at && endTime ? elapsed(run.started_at, endTime) : 0;
          return html`
            ${(pipelineCost > 0 || pipelineTurns > 0) ? html`
              <div class="pipeline-cost-strip">
                ${pipelineCost > 0 ? html`<span class="pipeline-cost-item"><span class="meta-label">Pipeline Cost:</span> <span class="meta-value">$${pipelineCost.toFixed(2)}</span></span>` : nothing}
                ${pipelineTurns > 0 ? html`<span class="pipeline-cost-item"><span class="meta-label">Total Turns:</span> <span class="meta-value">${pipelineTurns}</span></span>` : nothing}
              </div>
            ` : nothing}
            ${_pipelineTimingBar(allIters, pipelineWallMs)}
          `;
        })()}
      </div>

      <div class="stage-panels">
        ${Object.entries(stages).map(([key, stage]) => {
          const label = stageUi[key]?.label || key.replace(/_/g, ' ').toUpperCase();
          const stageStatus = resolveStatus(stage.status || 'pending', run.active);
          const stageAgent = stage.agent || agents[key]?.agent || key;
          const stageModel = stage.model || agents[key]?.model || '';
          const stageMs = _stageWallMs(stage);
          const stageDuration = stageMs > 0 ? formatDuration(stageMs) : '';
          const iterations = stage.iterations || [];
          const hasMultipleIterations = iterations.length > 1;
          const stageCost = _stageCost(iterations);

          return html`
            <sl-details ?open=${stageStatus === 'in_progress'} class="stage-panel"
              @sl-after-show=${(e) => {
                scrollOnExpand(e);
                if (!hasMultipleIterations) return;
                const tabGroup = e.target.querySelector('sl-tab-group');
                if (!tabGroup) return;
                const targetIter = resolveIterationTab(options.stageIterationTab, key, iterations);
                const panelName = `iter-${key}-${targetIter}`;
                requestAnimationFrame(() => tabGroup.show(panelName));
              }}>
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
                  ${(() => { const t = iterations.reduce((s, it) => s + (it.turns || 0), 0); return t > 0 ? html`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${unsafeHTML(iconSvg(RefreshCw, 11))}</span>
                      <span class="meta-value">${t} turns</span>
                    </span>
                  ` : nothing; })()}
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
                const copyBtn = html`
                  <button class="stage-copy-btn" title="Copy stage data as JSON" @click=${(e) => {
                    const json = _stageToJson(key, stage, stageAgent, stageModel, promptData);
                    _copyToClipboard(JSON.stringify(json, null, 2), e.currentTarget);
                  }}>
                    ${unsafeHTML(iconSvg(ClipboardCopy, 12))} Copy
                  </button>
                `;
                if (hasMultipleIterations) {
                  const stageTotalDur = stageMs > 0 ? formatDuration(stageMs) : '';
                  return html`
                    <div class="stage-content-wrapper">
                      ${copyBtn}
                      ${(() => {
                        const stageApiMs = iterations.reduce((sum, it) => sum + (it.duration_api_ms || 0), 0);
                        const stageTurns = iterations.reduce((sum, it) => sum + (it.turns || 0), 0);
                        const stageApiPct = stageMs > 0 && stageApiMs > 0 ? Math.round(stageApiMs / stageMs * 100) : 0;
                        return html`
                          <div class="stage-totals-strip">
                            <span class="stage-totals-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${stageCost.toFixed(2)}</span></span>
                            <span class="stage-totals-item"><span class="meta-label">Duration:</span> <span class="meta-value">${stageTotalDur}</span></span>
                            ${stageApiMs > 0 ? html`<span class="stage-totals-item"><span class="meta-label">API Duration:</span> <span class="meta-value">${formatDuration(stageApiMs)}${stageApiPct > 0 ? ` (${stageApiPct}%)` : ''}</span></span>` : nothing}
                            ${stageTurns > 0 ? html`<span class="stage-totals-item"><span class="meta-label">Turns:</span> <span class="meta-value">${stageTurns}</span></span>` : nothing}
                          </div>`;
                      })()}
                      <sl-tab-group @sl-tab-show=${(e) => {
                        const panel = e.detail.name;
                        const num = parseInt(panel.split('-').pop(), 10);
                        if (!isNaN(num)) options.onStageTabChange?.(key, num);
                      }}>
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
                    </div>
                  `;
                }
                return html`
                  <div class="stage-content-wrapper">
                    ${copyBtn}
                    <div class="stage-detail">
                      ${timingStripView(stage.started_at, stage.completed_at)}
                      <div class="stage-info-strip">
                        ${stageAgent ? html`<span class="stage-info-item"><span class="stage-meta-icon">${unsafeHTML(iconSvg(Cpu, 12))}</span> ${stageAgent}${stageModel ? html` <span class="text-muted">(${stageModel})</span>` : ''}</span>` : nothing}
                        ${iterations.length === 1 && iterations[0].turns ? html`<span class="stage-info-item"><span class="meta-label">Turns:</span> <span class="meta-value">${iterations[0].turns}</span></span>` : nothing}
                        ${iterations.length === 1 && iterations[0].duration_api_ms ? html`<span class="stage-info-item"><span class="meta-label">API Duration:</span> <span class="meta-value">${formatDuration(iterations[0].duration_api_ms)}${stageMs > 0 ? ` (${Math.round(iterations[0].duration_api_ms / stageMs * 100)}%)` : ''}</span></span>` : nothing}
                        ${iterations.length === 1 && iterations[0].cost_usd != null ? html`<span class="stage-info-item"><span class="meta-label">Cost:</span> <span class="meta-value">$${Number(iterations[0].cost_usd).toFixed(2)}</span></span>` : nothing}
                      </div>
                      ${iterations.length === 1 && iterations[0].trigger ? html`<div class="detail-row">${_triggerLabel(iterations[0].trigger)}</div>` : nothing}
                      ${iterations.length === 1 && iterations[0].outcome ? html`<div class="detail-row">${_outcomeLabel(iterations[0].outcome)}</div>` : nothing}
                      ${stage.task_progress ? html`<div class="detail-row"><span class="detail-label">Progress:</span> ${stage.task_progress}</div>` : nothing}
                      ${stage.error ? html`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${stage.error}</div>` : nothing}
                      ${iterations.length === 1 ? _classificationStripView(iterations[0]) : nothing}
                      ${key === 'preflight' && iterations.length === 1 ? _preflightChecksView(stage, iterations[0]) : nothing}
                      ${promptData ? _agentPromptSection(key, promptData) : nothing}
                    </div>
                  </div>
                `;
              })()}
              ${stageStatus === 'error' && !run.active && options.onRestartStage ? html`
                <div class="stage-restart-btn">
                  <sl-button variant="warning" size="small" @click=${() => options.onRestartStage(key)}>
                    ${unsafeHTML(iconSvg(RotateCcw, 14))}
                    Restart Stage
                  </sl-button>
                </div>
              ` : nothing}
            </sl-details>
          `;
        })}
      </div>
    </div>
  `;
}
