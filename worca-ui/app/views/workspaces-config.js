import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { Boxes, iconSvg, Pencil, Play, Trash2 } from '../utils/icons.js';

function _runStats(name, workspaceRuns) {
  const matches = (workspaceRuns || []).filter(
    (r) => r.workspace_name === name,
  );
  return { total: matches.length };
}

export function workspacesConfigView(
  appState,
  { onCreate, onLaunch, onEdit, onDelete, onOpenRuns } = {},
) {
  const definitions = appState?.workspaces || [];
  const workspaceRuns = appState?.workspaceRuns || [];

  if (definitions.length === 0) {
    return html`
      <div class="workspaces-config-empty">
        <div class="empty-icon">${unsafeHTML(iconSvg(Boxes, 32))}</div>
        <h3>No workspaces registered</h3>
        <p>
          A workspace is a reusable topology of repositories with optional
          dependencies and an integration test. Create one to coordinate
          multi-project pipeline runs.
        </p>
        <sl-button variant="primary" @click=${() => onCreate?.()}>
          + New Workspace
        </sl-button>
      </div>
    `;
  }

  return html`
    <div class="workspaces-config-table">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Parent path</th>
            <th>Projects</th>
            <th>Integration test</th>
            <th>Umbrella</th>
            <th>Runs</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${definitions.map((d) => {
            const stats = _runStats(d.name, workspaceRuns);
            return html`
              <tr>
                <td class="ws-name">
                  <strong>${d.name}</strong>
                </td>
                <td class="ws-path">
                  <code>${d.path}</code>
                </td>
                <td>${d.projects.length}</td>
                <td>
                  ${
                    d.integration_test?.command
                      ? html`<sl-tag size="small" variant="success">✓</sl-tag>`
                      : html`<span class="ws-dash">—</span>`
                  }
                </td>
                <td>
                  ${
                    d.umbrella_repo
                      ? html`<code class="ws-umbrella">${d.umbrella_repo}</code>`
                      : html`<span class="ws-dash">—</span>`
                  }
                </td>
                <td>
                  ${
                    stats.total > 0
                      ? html`<a
                        href="#/workspace-runs"
                        @click=${(e) => {
                          e.preventDefault();
                          onOpenRuns?.(d.name);
                        }}
                      >${stats.total}↗</a>`
                      : html`<span class="ws-dash">0</span>`
                  }
                </td>
                <td class="ws-actions">
                  <sl-tooltip content="Launch workspace run">
                    <button
                      class="ws-action-btn"
                      @click=${() => onLaunch?.(d.name)}
                    >
                      ${unsafeHTML(iconSvg(Play, 14))}
                    </button>
                  </sl-tooltip>
                  <sl-tooltip content="Edit definition">
                    <button
                      class="ws-action-btn"
                      @click=${() => onEdit?.(d.name)}
                    >
                      ${unsafeHTML(iconSvg(Pencil, 14))}
                    </button>
                  </sl-tooltip>
                  <sl-tooltip content="Delete workspace">
                    <button
                      class="ws-action-btn ws-action-btn--danger"
                      @click=${() => onDelete?.(d.name)}
                    >
                      ${unsafeHTML(iconSvg(Trash2, 14))}
                    </button>
                  </sl-tooltip>
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}
