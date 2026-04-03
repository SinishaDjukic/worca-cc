import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { elapsed, formatDuration, formatTimestamp } from '../utils/duration.js';
import { Clock, Coins, Cpu, iconSvg, Timer, Zap } from '../utils/icons.js';
import { STAGE_ORDER } from '../utils/stage-order.js';

function _sumCosts(runs) {
  let total = 0;
  for (const run of runs) {
    for (const stage of Object.values(run.stages || {})) {
      for (const iter of stage.iterations || []) {
        total += iter.cost_usd || 0;
      }
    }
  }
  return total;
}

function _sumTokens(tokenData) {
  let input = 0,
    output = 0,
    cacheRead = 0,
    cacheWrite = 0;
  for (const run of Object.values(tokenData)) {
    for (const stage of Object.values(run)) {
      for (const iter of stage) {
        input += iter.inputTokens || 0;
        output += iter.outputTokens || 0;
        cacheRead += iter.cacheReadInputTokens || 0;
        cacheWrite += iter.cacheCreationInputTokens || 0;
      }
    }
  }
  return { input, output, cacheRead, cacheWrite };
}

function _runCost(run) {
  let total = 0;
  for (const stage of Object.values(run.stages || {})) {
    for (const iter of stage.iterations || []) {
      total += iter.cost_usd || 0;
    }
  }
  return total;
}

function _runDuration(run) {
  if (run.started_at) {
    const end = run.completed_at || _lastStageEnd(run.stages);
    if (end) return elapsed(run.started_at, end);
  }
  return 0;
}

function _lastStageEnd(stages) {
  if (!stages) return null;
  let latest = null;
  for (const s of Object.values(stages)) {
    if (s.completed_at && (!latest || s.completed_at > latest))
      latest = s.completed_at;
  }
  return latest;
}

function _formatCost(usd) {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function _formatTokens(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timingStripView(startedAt, completedAt) {
  const dur = startedAt
    ? formatDuration(elapsed(startedAt, completedAt || null))
    : '';
  return html`
    <div class="timing-strip">
      ${startedAt ? html`<span class="timing-strip-item"><span class="meta-label">Started:</span> <span class="meta-value">${formatTimestamp(startedAt)}</span></span>` : nothing}
      ${completedAt ? html`<span class="timing-strip-item"><span class="meta-label">Finished:</span> <span class="meta-value">${formatTimestamp(completedAt)}</span></span>` : nothing}
      ${dur ? html`<span class="timing-strip-item"><span class="meta-label">Duration:</span> <span class="meta-value">${dur}</span></span>` : nothing}
    </div>
  `;
}

function _stageOrder(stages) {
  const keys = Object.keys(stages || {});
  return STAGE_ORDER.filter((k) => keys.includes(k)).concat(
    keys.filter((k) => !STAGE_ORDER.includes(k)),
  );
}

function summaryCards(runs, tokenData) {
  const totalCost = _sumCosts(runs);
  const avgCost = runs.length > 0 ? totalCost / runs.length : 0;
  const tokens = _sumTokens(tokenData);
  const totalTokens =
    tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;

  return html`
    <div class="costs-stats">
      <div class="stat-card stat-cost-total">
        <div class="stat-icon-ring">${unsafeHTML(iconSvg(Coins, 20))}</div>
        <div class="stat-body">
          <span class="stat-number">${_formatCost(totalCost)}</span>
          <span class="stat-label">Total Cost</span>
        </div>
      </div>
      <div class="stat-card stat-cost-avg">
        <div class="stat-icon-ring">${unsafeHTML(iconSvg(Zap, 20))}</div>
        <div class="stat-body">
          <span class="stat-number">${_formatCost(avgCost)}</span>
          <span class="stat-label">Avg / Run</span>
        </div>
      </div>
      <div class="stat-card stat-tokens">
        <div class="stat-icon-ring">${unsafeHTML(iconSvg(Cpu, 20))}</div>
        <div class="stat-body">
          <span class="stat-number">${_formatTokens(totalTokens)}</span>
          <span class="stat-label">Total Tokens</span>
        </div>
      </div>
      <div class="stat-card stat-runs-count">
        <div class="stat-icon-ring">${unsafeHTML(iconSvg(Clock, 20))}</div>
        <div class="stat-body">
          <span class="stat-number">${runs.length}</span>
          <span class="stat-label">Runs</span>
        </div>
      </div>
    </div>
  `;
}

function costBreakdownBar(stages) {
  const stageNames = _stageOrder(stages);
  const costs = stageNames
    .map((name) => {
      let cost = 0;
      for (const iter of stages[name]?.iterations || []) {
        cost += iter.cost_usd || 0;
      }
      return { name, cost };
    })
    .filter((s) => s.cost > 0);

  const total = costs.reduce((sum, s) => sum + s.cost, 0);
  if (total === 0) return nothing;

  const colors = {
    plan: 'var(--accent)',
    coordinate: 'var(--status-in-progress)',
    implement: 'var(--status-completed)',
    test: '#8b5cf6',
    review: '#f59e0b',
    pr: 'var(--muted)',
  };

  return html`
    <div class="cost-bar-container">
      <div class="cost-bar">
        ${costs.map((s) => {
          const pct = ((s.cost / total) * 100).toFixed(1);
          const color = colors[s.name] || 'var(--muted)';
          return html`<div class="cost-bar-segment" style="width:${pct}%;background:${color}" title="${s.name}: ${_formatCost(s.cost)} (${pct}%)"></div>`;
        })}
      </div>
      <div class="cost-bar-legend">
        ${costs.map((s) => {
          const color = colors[s.name] || 'var(--muted)';
          return html`<span class="cost-legend-item"><span class="cost-legend-dot" style="background:${color}"></span>${s.name} ${_formatCost(s.cost)}</span>`;
        })}
      </div>
    </div>
  `;
}

function runRow(run, tokenData, expandedRun, { onToggleRun }) {
  const cost = _runCost(run);

  const dur = _runDuration(run);
  const title = run.work_request?.title || 'Untitled';
  const firstLine = title.split('\n')[0];
  const displayTitle =
    firstLine.length > 60 ? `${firstLine.slice(0, 60)}\u2026` : firstLine;
  const endTime = run.completed_at || _lastStageEnd(run.stages);
  const isExpanded = expandedRun === run.id;
  const stageNames = _stageOrder(run.stages);
  const runTokens = tokenData[run.id] || {};

  return html`
    <div class="cost-run-row ${isExpanded ? 'expanded' : ''}">
      <div class="cost-run-summary" @click=${() => onToggleRun(run.id)}>
        <span class="cost-run-title">${displayTitle}</span>
        <span class="cost-run-date">${unsafeHTML(iconSvg(Clock, 12))} ${endTime ? formatTimestamp(endTime) : run.active ? 'running\u2026' : 'interrupted'}</span>
        <span class="cost-run-cost">${unsafeHTML(iconSvg(Coins, 12))} ${_formatCost(cost)}</span>

        <span class="cost-run-duration">${unsafeHTML(iconSvg(Timer, 12))} ${dur > 0 ? formatDuration(dur) : '-'}</span>

        <span class="cost-run-chevron">${isExpanded ? '\u25BC' : '\u25B6'}</span>
      </div>
      ${
        isExpanded
          ? html`
        <div class="cost-run-detail">
          ${timingStripView(run.started_at, run.completed_at || _lastStageEnd(run.stages))}
          ${costBreakdownBar(run.stages)}
          <table class="cost-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Iter</th>
                <th>Cost</th>
                <th>Turns</th>
                <th>Duration</th>
                <th>API Duration</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cache Read</th>
                <th>Cache Write</th>
              </tr>
            </thead>
            <tbody>
              ${stageNames.map((name) => {
                const stage = run.stages[name];
                const iters = stage?.iterations || [];
                const stageTokens = runTokens[name] || [];
                if (iters.length === 0) {
                  return html`<tr class="cost-table-stage"><td>${name}</td><td colspan="9" class="cost-muted">-</td></tr>`;
                }
                return iters.map((iter, idx) => {
                  const tokens = stageTokens[idx] || {};
                  return html`
                    <tr class="${idx === 0 ? 'cost-table-stage' : 'cost-table-iter'}">
                      ${idx === 0 ? html`<td rowspan="${iters.length}">${name}</td>` : nothing}
                      <td>#${iter.number || idx + 1}</td>
                      <td>${_formatCost(iter.cost_usd)}</td>
                      <td>${iter.turns || '-'}</td>
                      <td>${iter.duration_ms ? formatDuration(iter.duration_ms) : '-'}</td>
                      <td>${iter.duration_api_ms ? formatDuration(iter.duration_api_ms) : '-'}</td>
                      <td>${tokens.inputTokens ? _formatTokens(tokens.inputTokens) : '-'}</td>
                      <td>${tokens.outputTokens ? _formatTokens(tokens.outputTokens) : '-'}</td>
                      <td>${tokens.cacheReadInputTokens ? _formatTokens(tokens.cacheReadInputTokens) : '-'}</td>
                      <td>${tokens.cacheCreationInputTokens ? _formatTokens(tokens.cacheCreationInputTokens) : '-'}</td>
                    </tr>
                  `;
                });
              })}
            </tbody>
          </table>
        </div>
      `
          : nothing
      }
    </div>
  `;
}

export function tokenCostsView(
  state,
  { expandedRun, tokenData, onToggleRun } = {},
) {
  const runs = [
    ...Object.values(state.runs),
    ...Object.values(state.archivedRuns || {}),
  ]
    .filter((r) => r.stages && Object.keys(r.stages).length > 0)
    .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));

  return html`
    <div class="costs-dashboard">
      ${summaryCards(runs, tokenData || {})}

      <h3 class="costs-section-title">Cost by Run</h3>
      ${
        runs.length > 0
          ? html`
        <div class="cost-run-list">
          ${runs.map((run) => runRow(run, tokenData || {}, expandedRun, { onToggleRun: onToggleRun || (() => {}) }))}
        </div>
      `
          : html`<div class="empty-state">No runs with cost data</div>`
      }
    </div>
  `;
}
