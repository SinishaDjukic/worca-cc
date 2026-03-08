import { html } from 'lit-html';

export function dashboardView(state) {
  const runs = Object.values(state.runs);
  const active = runs.filter(r => r.active);
  const completed = runs.filter(r => !r.active);
  const errored = runs.filter(r => {
    const stages = r.stages ? Object.values(r.stages) : [];
    return stages.some(s => s.status === 'error');
  });

  return html`
    <div class="dashboard">
      <h2 class="dashboard-title">Pipeline Overview</h2>
      <div class="dashboard-stats">
        <div class="stat-card">
          <span class="stat-number">${active.length}</span>
          <span class="stat-label">Active</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">${completed.length}</span>
          <span class="stat-label">Completed</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">${errored.length}</span>
          <span class="stat-label">Errors</span>
        </div>
      </div>

      ${active.length > 0 ? html`
        <h3 class="dashboard-section-title">Active Runs</h3>
        ${active.map(run => html`
          <div class="run-list-item">
            <div class="run-list-info">
              <span class="run-list-title">${run.work_request?.title || 'Untitled'}</span>
              <span class="run-list-meta">Stage: ${run.stage || 'pending'}</span>
            </div>
          </div>
        `)}
      ` : html`<div class="empty-state">No active pipeline runs</div>`}
    </div>
  `;
}
