import { html, nothing } from 'lit-html';

// Persistent bottom "Activity" dock: a slim always-visible bar that expands into
// a table of Run/Regrade actions with lifecycle, progress, and per-row controls.
// Pure/stateless (lit-html) — state (actions, collapsed) is owned by main.js and
// refreshed from the server's actions ledger, so it survives a page reload.

const TYPE_LABEL = { run: 'Run', regrade: 'Regrade' };

// Status → badge class (badge color language: blue=active, green=done,
// red=failed, gray=stopped).
const STATUS_CLASS = {
  running: 'act-status--running',
  completed: 'act-status--done',
  failed: 'act-status--failed',
  stopped: 'act-status--stopped',
};

function _fmtClock(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toISOString().slice(11, 16); // HH:MM (UTC)
}

function _fmtDur(start, end) {
  const a = Date.parse(start || '');
  const b = end ? Date.parse(end) : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return '—';
  let s = Math.floor((b - a) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function _progressText(a) {
  const p = a.progress;
  if (!p) return a.status === 'running' ? 'starting…' : '';
  if (p.unit === 'instances') {
    const total = p.total != null ? `/${p.total}` : '';
    const err = p.errors ? ` · ${p.errors} err` : '';
    return `${p.done}${total} inst${err}`;
  }
  if (p.unit === 'regraded') {
    const total = p.total != null ? `/${p.total}` : '';
    const err = p.errors ? ` · ${p.errors} err` : '';
    return `${p.done ?? 0}${total} regraded${err}`;
  }
  return '';
}

function _row(a, { onStop, onView, onDismiss }) {
  const running = a.status === 'running';
  const statusClass = STATUS_CLASS[a.status] || 'act-status--stopped';
  return html`
    <tr class="activity-row activity-row--${a.status}">
      <td class="act-type">${TYPE_LABEL[a.type] || a.type}</td>
      <td class="act-profile" title=${a.profile}>${a.profile}</td>
      <td>
        <span class="act-status ${statusClass}"
          >${running ? html`<span class="act-dot"></span>` : nothing}${a.status}</span
        >
      </td>
      <td class="act-progress">${_progressText(a)}</td>
      <td class="act-time">${_fmtClock(a.started_at)}</td>
      <td class="act-dur">${_fmtDur(a.started_at, a.ended_at)}</td>
      <td class="act-actions">
        ${
          running
            ? html`<button
                class="act-btn act-btn--stop"
                title="Stop this action"
                @click=${() => onStop?.(a)}
              >Stop</button>`
            : nothing
        }
        <button
          class="act-btn act-btn--view"
          title="Open this profile"
          @click=${() => onView?.(a)}
        >View</button>
        ${
          running
            ? nothing
            : html`<button
                class="act-btn act-btn--dismiss"
                title="Dismiss from the list"
                @click=${() => onDismiss?.(a)}
              >✕</button>`
        }
      </td>
    </tr>
  `;
}

/**
 * @param {Array} actions  ledger actions (newest-first), each enriched w/ progress
 * @param {{collapsed?: boolean, onToggle?: fn, onStop?: fn, onView?: fn,
 *          onDismiss?: fn, dismissed?: Set<string>}} opts
 */
export function activityDock(actions = [], opts = {}) {
  const {
    collapsed = true,
    onToggle,
    onStop,
    onView,
    onDismiss,
    dismissed,
  } = opts;
  const visible = dismissed
    ? actions.filter((a) => !dismissed.has(a.id))
    : actions;
  if (visible.length === 0) return nothing; // no dock when there's nothing to show

  const running = visible.filter((a) => a.status === 'running').length;
  const failed = visible.filter((a) => a.status === 'failed').length;
  const done = visible.filter((a) => a.status === 'completed').length;
  const stopped = visible.filter((a) => a.status === 'stopped').length;

  return html`
    <div class="activity-dock ${collapsed ? 'is-collapsed' : 'is-expanded'}">
      <button
        class="activity-bar"
        @click=${() => onToggle?.()}
        aria-expanded=${collapsed ? 'false' : 'true'}
      >
        <span class="activity-bar-title">
          <span class="activity-caret">${collapsed ? '▴' : '▾'}</span> Activity
        </span>
        <span class="activity-summary">
          ${
            running
              ? html`<span class="act-chip act-chip--running"
                ><span class="act-dot"></span>${running} running</span
              >`
              : nothing
          }
          ${
            failed
              ? html`<span class="act-chip act-chip--failed">✗ ${failed} failed</span>`
              : nothing
          }
          ${
            stopped
              ? html`<span class="act-chip act-chip--stopped">■ ${stopped} stopped</span>`
              : nothing
          }
          ${
            done
              ? html`<span class="act-chip act-chip--done">✓ ${done} done</span>`
              : nothing
          }
        </span>
      </button>
      ${
        collapsed
          ? nothing
          : html`
              <div class="activity-panel">
                <table class="activity-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Profile</th>
                      <th>Status</th>
                      <th>Progress</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${visible.map((a) => _row(a, { onStop, onView, onDismiss }))}
                  </tbody>
                </table>
              </div>
            `
      }
    </div>
  `;
}
