import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import {
  ClipboardCopy,
  iconSvg,
  Search,
  Trash2,
  X,
  Zap,
} from '../utils/icons.js';

/**
 * Extract category from event_type (e.g. 'pipeline.run.started' → 'run')
 */
function getCategory(eventType) {
  if (!eventType) return 'other';
  const parts = eventType.replace(/^pipeline\./, '').split('.');
  const cat = parts[0];
  const known = [
    'run',
    'stage',
    'agent',
    'bead',
    'git',
    'test',
    'review',
    'circuit_breaker',
    'cost',
    'loop',
    'hook',
    'control',
  ];
  return known.includes(cat) ? cat : 'other';
}

/**
 * Short display name for event type (strip pipeline. prefix)
 */
function shortEventType(eventType) {
  if (!eventType) return '';
  return eventType.replace(/^pipeline\./, '');
}

/**
 * Category CSS class for color coding
 */
function categoryClass(cat) {
  const map = {
    run: 'cat-run',
    stage: 'cat-stage',
    agent: 'cat-agent',
    cost: 'cat-cost',
    circuit_breaker: 'cat-danger',
    hook: 'cat-danger',
    test: 'cat-stage',
    review: 'cat-stage',
    bead: 'cat-run',
    git: 'cat-run',
    loop: 'cat-cost',
    control: 'cat-danger',
  };
  return map[cat] || 'cat-neutral';
}

/**
 * Extract a one-line summary from the webhook payload
 */
function extractSummary(envelope) {
  if (!envelope) return '';
  const cat = getCategory(envelope.event_type);
  const p = envelope.payload || {};

  switch (cat) {
    case 'run':
      return p.status || p.outcome || '';
    case 'stage':
      return [
        p.stage,
        p.outcome,
        p.duration_s != null ? `${p.duration_s}s` : '',
      ]
        .filter(Boolean)
        .join(' \u2022 ');
    case 'agent':
      return [p.tool_name, p.file || p.command]
        .filter(Boolean)
        .join(' \u2022 ')
        .slice(0, 80);
    case 'bead':
      return [p.bead_id, p.title].filter(Boolean).join(' \u2022 ').slice(0, 80);
    case 'git':
      return [p.branch, p.sha?.slice(0, 7), p.pr_url]
        .filter(Boolean)
        .join(' \u2022 ');
    case 'test':
      if (p.passed != null || p.failed != null)
        return `pass:${p.passed ?? 0} fail:${p.failed ?? 0}`;
      return p.outcome || '';
    case 'review':
      return [p.verdict, p.issue_count != null ? `${p.issue_count} issues` : '']
        .filter(Boolean)
        .join(' \u2022 ');
    case 'circuit_breaker':
      return [p.category, p.consecutive != null ? `${p.consecutive}x` : '']
        .filter(Boolean)
        .join(' \u2022 ');
    case 'cost':
      if (p.total_cost != null) return `$${Number(p.total_cost).toFixed(2)}`;
      if (p.budget_pct != null) return `${p.budget_pct}% of budget`;
      return '';
    case 'loop':
      return [
        p.loop_key,
        p.iteration != null ? `iter ${p.iteration}` : '',
        p.from && p.to ? `${p.from}\u2192${p.to}` : '',
      ]
        .filter(Boolean)
        .join(' \u2022 ');
    case 'hook':
      return [p.tool_blocked, p.reason].filter(Boolean).join(': ').slice(0, 80);
    case 'control':
      return p.action || '';
    default:
      return '';
  }
}

/**
 * Format date as YYYYMMDD
 */
function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Format time as HH:MM:SS
 */
function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const CATEGORIES = [
  'all',
  'run',
  'stage',
  'agent',
  'bead',
  'cost',
  'test',
  'review',
  'hook',
  'other',
];

export function webhookInboxView(
  state,
  {
    selectedId,
    categoryFilter,
    runFilter,
    searchTerm,
    onSelectEvent,
    onCategoryFilter,
    onRunFilter,
    onSearch,
    onSetControl,
    onClear,
    onCopyJson,
    onDismissDetail,
  },
) {
  const { events, controlAction } = state.webhookInbox;

  // Derive category counts
  const catCounts = {};
  for (const cat of CATEGORIES) catCounts[cat] = 0;
  for (const evt of events) {
    const cat = getCategory(evt.envelope?.event_type);
    catCounts[cat] = (catCounts[cat] || 0) + 1;
    catCounts.all++;
  }

  // Derive distinct run_ids
  const runIds = [
    ...new Set(events.map((e) => e.envelope?.run_id).filter(Boolean)),
  ];

  // Filter events
  let filtered = events;
  if (categoryFilter && categoryFilter !== 'all') {
    filtered = filtered.filter(
      (e) => getCategory(e.envelope?.event_type) === categoryFilter,
    );
  }
  if (runFilter) {
    filtered = filtered.filter((e) => e.envelope?.run_id === runFilter);
  }
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        (e.envelope?.event_type || '').toLowerCase().includes(term) ||
        JSON.stringify(e.envelope?.payload || {})
          .toLowerCase()
          .includes(term),
    );
  }

  const selectedEvent = selectedId
    ? events.find((e) => e.id === selectedId)
    : null;

  // Empty state
  if (events.length === 0) {
    return html`
      <div class="webhook-inbox">
        <div class="webhook-inbox-toolbar">
          <div class="webhook-inbox-control">
            ${controlSegment(controlAction, onSetControl)}
          </div>
        </div>
        <div class="webhook-inbox-empty">
          ${unsafeHTML(iconSvg(Zap, 32))}
          <p><strong>No webhook events received yet.</strong></p>
          <p>To start receiving events, add this URL to your webhook configuration:</p>
          <code class="webhook-inbox-url">http://localhost:3400/api/webhooks/inbox</code>
          <p>Go to Settings \u2192 Webhooks to configure.</p>
        </div>
      </div>
    `;
  }

  return html`
    <div class="webhook-inbox">
      <div class="webhook-inbox-toolbar">
        <div class="webhook-inbox-category-chips">
          ${CATEGORIES.map(
            (cat) => html`
            <button class="webhook-inbox-category-chip ${categoryFilter === cat ? 'active' : ''} ${categoryClass(cat)}"
                    @click=${() => onCategoryFilter(cat)}>
              ${cat === 'all' ? 'All' : cat}
              <span class="chip-count">${catCounts[cat] || 0}</span>
            </button>
          `,
          )}
        </div>
        <div class="webhook-inbox-toolbar-right">
          ${
            runIds.length > 0
              ? html`
            <select class="webhook-inbox-run-filter"
                    @change=${(e) => onRunFilter(e.target.value || null)}>
              <option value="">All Runs</option>
              ${runIds.map((id) => html`<option value="${id}" ?selected=${runFilter === id}>${id.slice(0, 12)}\u2026</option>`)}
            </select>
          `
              : ''
          }
          <div class="webhook-inbox-search">
            ${unsafeHTML(iconSvg(Search, 14))}
            <input type="text" placeholder="Filter events\u2026"
                   .value=${searchTerm || ''}
                   @input=${(e) => onSearch(e.target.value)} />
          </div>
          <div class="webhook-inbox-control">
            ${controlSegment(controlAction, onSetControl)}
          </div>
          <button class="webhook-inbox-clear-btn" @click=${onClear} title="Clear all events">
            ${unsafeHTML(iconSvg(Trash2, 14))}
          </button>
        </div>
      </div>

      <div class="webhook-inbox-list">
        <div class="webhook-inbox-list-header">
          <span class="wh-col-id">#</span>
          <span class="wh-col-date">Date</span>
          <span class="wh-col-time">Time</span>
          <span class="wh-col-type">Event Type</span>
          <span class="wh-col-stage">Stage</span>
          <span class="wh-col-summary">Summary</span>
          <span class="wh-col-run">Run</span>
        </div>
        <div class="webhook-inbox-list-body">
          ${[...filtered].reverse().map((evt) => {
            const cat = getCategory(evt.envelope?.event_type);
            return html`
              <div class="webhook-inbox-row ${selectedId === evt.id ? 'selected' : ''}"
                   @click=${() => onSelectEvent(evt.id)}>
                <span class="wh-col-id">${evt.id}</span>
                <span class="wh-col-date">${formatDate(evt.receivedAt)}</span>
                <span class="wh-col-time">${formatTime(evt.receivedAt)}</span>
                <span class="wh-col-type">
                  <span class="webhook-event-type ${categoryClass(cat)}">${shortEventType(evt.envelope?.event_type)}</span>
                </span>
                <span class="wh-col-stage">${evt.envelope?.payload?.stage || ''}</span>
                <span class="wh-col-summary webhook-inbox-summary">${extractSummary(evt.envelope)}</span>
                <span class="wh-col-run" title="${evt.envelope?.run_id || ''}">${evt.envelope?.run_id || ''}</span>
              </div>
            `;
          })}
        </div>
      </div>

      ${
        selectedEvent
          ? html`
        <div class="webhook-inbox-detail">
          <div class="webhook-inbox-detail-header">
            <span class="webhook-inbox-detail-title">Event #${selectedEvent.id} \u2014 ${selectedEvent.envelope?.event_type || 'unknown'}</span>
            <div class="webhook-inbox-detail-actions">
              <button class="webhook-inbox-copy-btn" @click=${() => onCopyJson(selectedEvent)} title="Copy JSON">
                ${unsafeHTML(iconSvg(ClipboardCopy, 14))}
              </button>
              <button class="webhook-inbox-dismiss-btn" @click=${onDismissDetail} title="Close">
                ${unsafeHTML(iconSvg(X, 14))}
              </button>
            </div>
          </div>
          <div class="webhook-inbox-detail-headers">
            <span class="detail-label">X-Worca-Event:</span> ${selectedEvent.headers['x-worca-event'] || '\u2014'}
            <span class="detail-label">X-Worca-Delivery:</span> ${selectedEvent.headers['x-worca-delivery'] || '\u2014'}
            <span class="detail-label">X-Worca-Signature:</span> ${selectedEvent.headers['x-worca-signature'] || '\u2014'}
          </div>
          <pre class="webhook-inbox-json">${JSON.stringify(selectedEvent.envelope, null, 2)}</pre>
        </div>
      `
          : ''
      }
    </div>
  `;
}

function controlSegment(current, onSetControl) {
  const actions = ['continue', 'pause', 'abort'];
  return html`
    <div class="webhook-control-segment">
      ${actions.map(
        (action) => html`
        <button class="webhook-control-btn ${current === action ? 'active' : ''} ${action === 'abort' ? 'danger' : ''}"
                @click=${() => onSetControl(action)}>
          ${action}
        </button>
      `,
      )}
    </div>
  `;
}
