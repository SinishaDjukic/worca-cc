import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Lock, Loader, Circle, CircleCheck, CircleAlert, GitBranch, Hash } from '../utils/icons.js';
import { runCardView } from './run-card.js';
import { sortByStartDesc } from '../utils/sort-runs.js';

export function priorityVariant(priority) {
  if (priority === 0 || priority === 1) return 'danger';
  if (priority === 2) return 'warning';
  return 'neutral';
}

export function statusVariant(status) {
  if (status === 'open') return 'success';
  if (status === 'in_progress') return 'warning';
  if (status === 'closed') return 'neutral';
  return 'neutral';
}

export function beadsStatusClass(issue) {
  if (issue.status === 'closed') return 'closed';
  if (issue.blocked_by && issue.blocked_by.length > 0) return 'blocked';
  return issue.status;
}

// Status icon data for beads (maps bead status to lucide icon + CSS color var)
const BEAD_STATUS_ICON = {
  open:        { icon: Circle,      color: 'var(--status-completed)' },
  in_progress: { icon: Loader,      color: 'var(--status-in-progress)' },
  closed:      { icon: CircleCheck,  color: 'var(--status-completed)' },
  blocked:     { icon: Lock,         color: 'var(--status-blocked)' },
};

function beadDepStatusIcon(depId, issuesById) {
  const dep = issuesById.get(depId);
  if (!dep) return iconSvg(Circle, 10);
  const sc = beadsStatusClass(dep);
  const entry = BEAD_STATUS_ICON[sc] || BEAD_STATUS_ICON.open;
  const cls = sc === 'in_progress' ? 'icon-spin' : '';
  return `<span style="color:${entry.color};display:inline-flex">${iconSvg(entry.icon, 10, cls)}</span>`;
}

function computeLayers(issues) {
  const ids = new Set(issues.map(i => i.id));
  const layer = new Map(issues.map(i => [i.id, 0]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const issue of issues) {
      for (const dep of issue.depends_on) {
        if (!ids.has(dep)) continue;
        const candidate = (layer.get(dep) ?? 0) + 1;
        if (candidate > layer.get(issue.id)) {
          layer.set(issue.id, candidate);
          changed = true;
        }
      }
    }
  }
  return layer;
}

export function beadsDependencyGraph(issues) {
  if (!issues || issues.length === 0) return '';

  const NODE_W = 140, NODE_H = 40, H_GAP = 60, V_GAP = 24, PADDING = 16;
  const issuesById = new Map(issues.map(i => [i.id, i]));
  const layers = computeLayers(issues);
  const maxLayer = Math.max(...layers.values(), 0);

  const layerGroups = new Map();
  for (const issue of issues) {
    const l = layers.get(issue.id) ?? 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l).push(issue);
  }

  const maxPerLayer = Math.max(...[...layerGroups.values()].map(g => g.length), 1);
  const svgW = Math.round(PADDING * 2 + (maxLayer + 1) * (NODE_W + H_GAP));
  const svgH = Math.round(PADDING * 2 + maxPerLayer * (NODE_H + V_GAP));

  const positions = new Map();
  for (const [l, group] of layerGroups) {
    for (let i = 0; i < group.length; i++) {
      positions.set(group[i].id, {
        x: Math.round(PADDING + l * (NODE_W + H_GAP)),
        y: Math.round(PADDING + i * (NODE_H + V_GAP))
      });
    }
  }

  // Edge color based on dependency (source) status: closed = satisfied (gray), else blocking (red)
  let edges = '';
  for (const issue of issues) {
    const to = positions.get(issue.id);
    if (!to) continue;
    for (const depId of issue.depends_on) {
      const from = positions.get(depId);
      if (!from) continue;
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      const cx = Math.round((x1 + x2) / 2);
      const dep = issuesById.get(depId);
      const isSatisfied = dep && dep.status === 'closed';
      const cls = isSatisfied ? 'beads-graph-edge beads-graph-edge--satisfied' : 'beads-graph-edge beads-graph-edge--blocking';
      const marker = isSatisfied ? 'url(#beads-arrow-satisfied)' : 'url(#beads-arrow-blocking)';
      edges += `<path class="${cls}" d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}" marker-end="${marker}"/>`;
    }
  }

  // Node border color matches bead status
  let nodes = '';
  for (const issue of issues) {
    const pos = positions.get(issue.id);
    if (!pos) continue;
    const sc = beadsStatusClass(issue);
    const title = issue.title || '';
    const label = title.length > 18 ? title.slice(0, 18) + '...' : title;
    nodes += `<g class="beads-graph-node beads-graph-node--${sc}" transform="translate(${pos.x},${pos.y})">
      <rect width="${NODE_W}" height="${NODE_H}" rx="6"/>
      <text x="8" y="14" class="beads-graph-node-id">#${issue.id}</text>
      <text x="8" y="28">${escapeXml(label)}</text>
    </g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
    <defs>
      <marker id="beads-arrow-satisfied" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)"/>
      </marker>
      <marker id="beads-arrow-blocking" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--status-blocked)"/>
      </marker>
    </defs>
    ${edges}
    ${nodes}
  </svg>`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function beadsIssueRow(issue, { starting, onStartIssue, issuesById }) {
  const isClosed = issue.status === 'closed';
  const isBlocked = issue.blocked_by && issue.blocked_by.length > 0;
  const canStart = issue.status === 'open' && !isBlocked && starting === null;
  const isStarting = starting === issue.id;

  return html`
    <div class="beads-issue-row ${isClosed ? 'beads-issue-row--closed' : ''}">
      <sl-badge variant="${priorityVariant(issue.priority)}" pill>P${issue.priority}</sl-badge>
      <sl-badge variant="${statusVariant(issue.status)}">${issue.status}</sl-badge>
      <div class="beads-issue-body">
        <div class="beads-issue-title">${issue.title}</div>
        ${issue.body ? html`<div class="beads-issue-excerpt">${(issue.body || '').slice(0, 120)}</div>` : ''}
        ${issue.depends_on && issue.depends_on.length > 0 ? html`
          <div class="beads-issue-deps">
            ${issue.depends_on.map(depId => {
              const depSc = issuesById ? beadsStatusClass(issuesById.get(depId) || { status: 'open' }) : 'open';
              const chipClass = depSc === 'blocked' || depSc === 'open' || depSc === 'in_progress' ? 'beads-dep-chip--blocking' : 'beads-dep-chip--satisfied';
              return html`
                <span class="beads-dep-chip ${chipClass}">
                  ${unsafeHTML(beadDepStatusIcon(depId, issuesById || new Map()))}
                  #${depId}
                </span>
              `;
            })}
          </div>
        ` : ''}
      </div>
      ${!isClosed ? html`
        <div class="beads-issue-actions">
          <sl-button variant="primary" size="small"
            ?disabled=${!canStart}
            @click=${() => canStart && onStartIssue(issue.id)}>
            ${isStarting ? unsafeHTML(iconSvg(Loader, 14, 'icon-spin')) : ''}
            ${isStarting ? 'Starting...' : 'Start Pipeline'}
          </sl-button>
        </div>
      ` : html`<div class="beads-issue-actions"></div>`}
    </div>
  `;
}

// --- Run list landing view ---

export function beadsRunListView(runs, { onSelectRun, beadsCounts = {} }) {
  const all = runs || [];
  const active = sortByStartDesc(all.filter(r => r.active));
  const inactive = sortByStartDesc(all.filter(r => !r.active));
  const sorted = [...active, ...inactive];

  if (sorted.length === 0) {
    return html`<div class="empty-state">No pipeline runs yet.</div>`;
  }

  return html`
    <div class="run-list">
      ${sorted.map(run => runCardView(run, {
        onClick: onSelectRun,
        beadsCount: beadsCounts[run.id] || 0,
      }))}
    </div>
  `;
}

// --- Kanban board view ---

function beadsKanbanView(issues, { starting, onStartIssue }) {
  const issuesById = new Map(issues.map(i => [i.id, i]));
  const columns = [
    { key: 'open', label: 'Open', items: [] },
    { key: 'in_progress', label: 'In Progress', items: [] },
    { key: 'closed', label: 'Closed', items: [] },
  ];
  const colMap = new Map(columns.map(c => [c.key, c]));

  for (const issue of issues) {
    const col = colMap.get(issue.status) || colMap.get('open');
    col.items.push(issue);
  }

  // Sort each column by priority (P0 first)
  for (const col of columns) {
    col.items.sort((a, b) => a.priority - b.priority);
  }

  return html`
    <div class="beads-kanban">
      ${columns.map(col => html`
        <div class="beads-kanban-column">
          <div class="beads-kanban-header beads-kanban-header--${col.key}">
            ${col.label}
            <sl-badge variant="neutral" pill>${col.items.length}</sl-badge>
          </div>
          ${col.items.length === 0 ? html`
            <div class="beads-kanban-empty">No issues</div>
          ` : ''}
          ${col.items.map(issue => {
            const isBlocked = issue.blocked_by && issue.blocked_by.length > 0;
            return html`
              <div class="beads-kanban-card ${isBlocked ? 'beads-kanban-card--blocked' : ''}">
                <div class="beads-kanban-card-header">
                  <sl-badge variant="${priorityVariant(issue.priority)}" pill>P${issue.priority}</sl-badge>
                  <span class="beads-kanban-card-id">#${issue.id}</span>
                </div>
                <div class="beads-kanban-card-title">${issue.title}</div>
                ${isBlocked ? html`
                  <div class="beads-kanban-card-deps">
                    ${issue.blocked_by.map(depId => html`
                      <span class="beads-dep-chip beads-dep-chip--blocking">
                        ${unsafeHTML(beadDepStatusIcon(depId, issuesById))}
                        #${depId}
                      </span>
                    `)}
                  </div>
                ` : ''}
              </div>
            `;
          })}
        </div>
      `)}
    </div>
  `;
}

// --- Main panel view (kanban for a single run) ---

export function beadsPanelView(issues, {
  statusFilter, priorityFilter, starting, startError,
  onStatusFilter, onPriorityFilter, onStartIssue, onDismissError,
  loading = false, run, runId,
}) {
  if (loading) {
    return html`<div class="empty-state">Loading issues...</div>`;
  }

  const displayIssues = issues || [];

  // Apply status and priority filters
  let filtered = displayIssues;
  if (statusFilter !== 'all') filtered = filtered.filter(i => i.status === statusFilter);
  if (priorityFilter !== 'all') filtered = filtered.filter(i => String(i.priority) === priorityFilter);

  const branch = run?.branch || run?.work_request?.branch || '';
  const displayRunId = runId || run?.run_id || '';
  const pr = run?.pr_url || null;

  const metaStripView = (branch || displayRunId) ? html`
    <div class="run-info-section">
      ${displayRunId ? html`
        <div class="run-branch">
          <span class="stage-meta-icon">${unsafeHTML(iconSvg(Hash, 14))}</span>
          <span>Run ${displayRunId}</span>
        </div>
      ` : nothing}
      ${branch ? html`
        <div class="run-branch">
          <span class="stage-meta-icon">${unsafeHTML(iconSvg(GitBranch, 14))}</span>
          <span>${branch}</span>
          ${pr ? html`<a class="run-pr-link" href="${pr}" target="_blank">View PR</a>` : nothing}
        </div>
      ` : nothing}
    </div>
  ` : nothing;

  const filtersView = html`
    <div class="beads-filters">
      <sl-select value=${statusFilter} @sl-change=${(e) => onStatusFilter(e.target.value)}>
        <sl-option value="all">All statuses</sl-option>
        <sl-option value="open">Open</sl-option>
        <sl-option value="in_progress">In Progress</sl-option>
        <sl-option value="closed">Closed</sl-option>
      </sl-select>
      <sl-select value=${priorityFilter} @sl-change=${(e) => onPriorityFilter(e.target.value)}>
        <sl-option value="all">All priorities</sl-option>
        <sl-option value="0">P0 - Critical</sl-option>
        <sl-option value="1">P1 - High</sl-option>
        <sl-option value="2">P2 - Medium</sl-option>
        <sl-option value="3">P3 - Low</sl-option>
        <sl-option value="4">P4 - Backlog</sl-option>
      </sl-select>
      <span class="beads-filter-count">${filtered.length} issue${filtered.length !== 1 ? 's' : ''}</span>
    </div>
  `;

  if (filtered.length === 0) {
    return html`
      <div class="beads-panel">
        ${metaStripView}
        ${filtersView}
        <div class="empty-state">${displayIssues.length === 0 ? 'No issues found for this run.' : 'No issues match the current filters.'}</div>
      </div>
    `;
  }

  return html`
    <div class="beads-panel">
      ${metaStripView}
      ${filtersView}
      ${beadsKanbanView(filtered, { starting, onStartIssue })}
      ${startError ? html`
        <sl-dialog label="Could Not Start Pipeline" open @sl-after-hide=${onDismissError}>
          <p>${startError}</p>
          <sl-button slot="footer" variant="primary" @click=${() => document.querySelector('sl-dialog[label="Could Not Start Pipeline"]')?.hide()}>
            OK
          </sl-button>
        </sl-dialog>
      ` : ''}
    </div>
  `;
}
