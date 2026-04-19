import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';

// Brand SVG icons (Simple Icons, MIT license) — 24×24
const BRAND_ICONS = {
  telegram:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#26A5E4"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
  discord:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  slack:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#4A154B"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>',
};

const TIER1_EVENTS = [
  'pipeline.run.started',
  'pipeline.run.completed',
  'pipeline.run.failed',
  'pipeline.run.interrupted',
  'pipeline.run.paused',
  'pipeline.run.resumed',
  'pipeline.run.resumed_from_pause',
  'pipeline.stage.started',
  'pipeline.stage.completed',
  'pipeline.stage.interrupted',
  'pipeline.git.pr_created',
  'pipeline.git.pr_merged',
  'pipeline.circuit_breaker.tripped',
  'pipeline.cost.budget_warning',
];

const ADAPTERS = [
  {
    key: 'telegram',
    label: 'Telegram',
    icon: BRAND_ICONS.telegram,
    desc: 'Two-way: notifications + inbound commands',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'Paste token from @BotFather',
    tokenHint:
      'Create a bot via @BotFather in Telegram, then paste the token here.',
    idLabel: 'Chat ID',
    idPlaceholder: 'Click Detect after sending /start',
    idHint: 'Send /start to the bot in Telegram, then click Detect.',
  },
  {
    key: 'discord',
    label: 'Discord',
    icon: BRAND_ICONS.discord,
    desc: 'Outbound notifications via bot',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'Paste bot token from Discord Developer Portal',
    tokenHint: 'Create a bot at discord.com/developers, copy the token.',
    idLabel: 'Channel ID',
    idPlaceholder: 'e.g. 1234567890',
    idHint:
      'Right-click the channel \u2192 Copy Channel ID (enable Developer Mode in settings).',
  },
  {
    key: 'slack',
    label: 'Slack',
    icon: BRAND_ICONS.slack,
    desc: 'Outbound notifications via incoming webhook',
    tokenLabel: 'Webhook URL',
    tokenPlaceholder: 'https://hooks.slack.com/services/...',
    tokenHint: 'Create an Incoming Webhook in your Slack workspace settings.',
    idLabel: 'Channel ID',
    idPlaceholder: 'e.g. C0123456789',
    idHint:
      'Right-click the channel \u2192 View channel details \u2192 copy the ID.',
  },
];

function formatLastEvent(ts) {
  if (!ts) return 'Never';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60000) return 'Just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function adapterStatus(key, status) {
  if (!status?.adapters) return null;
  return status.adapters.find((a) => a.name === key) || null;
}

function adapterConfig(key, config) {
  return config?.[key] || null;
}

// ── Configured card (has config saved) ──────────────────────────────────

function configuredCard(
  meta,
  adapterSt,
  cfg,
  {
    editing,
    form,
    onEdit,
    onCancel,
    onFieldChange,
    onEventToggle,
    onSave,
    onRemove,
    onDetect,
    onToggleEnabled,
  },
) {
  const isEnabled = cfg?.enabled !== false;
  const isPersistent = adapterSt?.persistent;
  const conn = adapterSt?.connection;
  const connErr = adapterSt?.connection_error;

  function connectionBadge() {
    if (!isPersistent || !isEnabled) return nothing;
    if (conn === 'connected')
      return html`<sl-badge variant="success" pill>Connected</sl-badge>`;
    if (conn === 'connecting')
      return html`<sl-badge variant="neutral" pill>Connecting\u2026</sl-badge>`;
    return html`<sl-tooltip content=${connErr || 'Connection lost'}><sl-badge variant="warning" pill>Disconnected</sl-badge></sl-tooltip>`;
  }

  return html`
    <div class="ig-card ${isEnabled ? 'ig-card--connected' : 'ig-card--disabled'}">
      <div class="ig-card-header">
        <span class="ig-card-icon">${unsafeHTML(meta.icon)}</span>
        <div class="ig-card-title">
          <span class="ig-card-name">${meta.label}</span>
          <span class="ig-card-desc">${meta.desc}</span>
        </div>
        <div class="ig-badges">
          <sl-badge variant="primary" pill>Configured</sl-badge>
          ${connectionBadge()}
        </div>
      </div>
      ${
        isEnabled && adapterSt
          ? html`
        <div class="ig-card-stats">
          <span>Last event: ${formatLastEvent(adapterSt.last_event_at)}</span>
          ${(adapterSt.dropped_messages || 0) > 0 ? html`<span class="stat-warn">Dropped: ${adapterSt.dropped_messages}</span>` : nothing}
        </div>
      `
          : nothing
      }
      ${
        editing
          ? configForm(meta, form, {
              onFieldChange,
              onEventToggle,
              onSave,
              onCancel,
              onDetect,
            })
          : html`
          <div class="ig-card-footer">
            <div class="ig-card-actions">
              <sl-button size="small" @click=${onEdit}>Edit</sl-button>
              <sl-button size="small" variant="danger" outline @click=${onRemove}>Remove</sl-button>
            </div>
            <sl-switch size="small" ?checked=${isEnabled}
              @sl-change=${(e) => onToggleEnabled(e.target.checked)}
            >${isEnabled ? 'Enabled' : 'Disabled'}</sl-switch>
          </div>
        `
      }
    </div>
  `;
}

// ── Pending card (configured but adapter not started) ───────────────────

function pendingCard(meta, cfg, { onEdit, onRemove, onToggleEnabled }) {
  const isEnabled = cfg?.enabled !== false;
  return html`
    <div class="ig-card ig-card--pending">
      <div class="ig-card-header">
        <span class="ig-card-icon">${unsafeHTML(meta.icon)}</span>
        <div class="ig-card-title">
          <span class="ig-card-name">${meta.label}</span>
          <span class="ig-card-desc">${meta.desc}</span>
        </div>
        <sl-badge variant="warning" pill>Not connected</sl-badge>
      </div>
      <div class="ig-card-pending-hint">Configuration saved but adapter failed to connect. Check the token and server logs.</div>
      <div class="ig-card-footer">
        <div class="ig-card-actions">
          <sl-button size="small" @click=${onEdit}>Edit</sl-button>
          <sl-button size="small" variant="danger" outline @click=${onRemove}>Remove</sl-button>
        </div>
        <sl-switch size="small" ?checked=${isEnabled}
          @sl-change=${(e) => onToggleEnabled(e.target.checked)}
        >${isEnabled ? 'Enabled' : 'Disabled'}</sl-switch>
      </div>
    </div>
  `;
}

// ── Unconfigured card ───────────────────────────────────────────────────

function unconfiguredCard(
  meta,
  {
    editing,
    form,
    onConfigure,
    onCancel,
    onFieldChange,
    onEventToggle,
    onSave,
    onDetect,
  },
) {
  return html`
    <div class="ig-card ig-card--disconnected">
      <div class="ig-card-header">
        <span class="ig-card-icon">${unsafeHTML(meta.icon)}</span>
        <div class="ig-card-title">
          <span class="ig-card-name">${meta.label}</span>
          <span class="ig-card-desc">${meta.desc}</span>
        </div>
        <sl-badge variant="neutral" pill>Not configured</sl-badge>
      </div>
      ${
        editing
          ? configForm(meta, form, {
              onFieldChange,
              onEventToggle,
              onSave,
              onCancel,
              onDetect,
            })
          : html`
          <div class="ig-card-actions">
            <sl-button size="small" variant="primary" @click=${onConfigure}>Configure</sl-button>
          </div>
        `
      }
    </div>
  `;
}

// ── Inline config form ──────────────────────────────────────────────────

function configForm(
  meta,
  form,
  { onFieldChange, onEventToggle, onSave, onCancel, onDetect },
) {
  return html`
    <div class="ig-form">
      <div class="ig-form-field">
        <label>${meta.tokenLabel}</label>
        <sl-input
          type="password"
          value=${form.token || ''}
          placeholder=${meta.tokenPlaceholder}
          @sl-input=${(e) => onFieldChange('token', e.target.value)}
        ></sl-input>
        <span class="form-hint">${meta.tokenHint}</span>
      </div>
      <div class="ig-form-field">
        <label>${meta.idLabel}</label>
        <div class="ig-detect-row">
          <sl-input
            value=${form.chatId || ''}
            placeholder=${meta.idPlaceholder}
            @sl-input=${(e) => onFieldChange('chatId', e.target.value)}
          ></sl-input>
          ${
            meta.key === 'telegram'
              ? html`
            <sl-button size="small" outline ?loading=${form.detecting}
              @click=${onDetect}>Detect</sl-button>
          `
              : nothing
          }
        </div>
        ${form.detectHint ? html`<span class="form-hint">${form.detectHint}</span>` : html`<span class="form-hint">${meta.idHint}</span>`}
      </div>
      <div class="ig-form-field">
        <label>Events to forward</label>
        <div class="ig-event-grid">
          ${TIER1_EVENTS.map((evt) => {
            const short = evt.replace('pipeline.', '');
            const checked = (form.events || []).includes(evt);
            return html`
              <sl-checkbox ?checked=${checked} @sl-change=${() => onEventToggle(evt)}>
                ${short}
              </sl-checkbox>
            `;
          })}
        </div>
      </div>
      ${form.error ? html`<sl-alert variant="danger" open>${form.error}</sl-alert>` : nothing}
      ${form.saved ? html`<sl-alert variant="success" open>Saved and activated.</sl-alert>` : nothing}
      <div class="ig-form-actions">
        <sl-button size="small" variant="primary" ?loading=${form.saving}
          ?disabled=${form.saving || !form.token || !form.chatId || (form.events || []).length === 0}
          @click=${onSave}>Save</sl-button>
        <sl-button size="small" @click=${onCancel}>Cancel</sl-button>
      </div>
    </div>
  `;
}

// ── Exported Tab ────────────────────────────────────────────────────────

export function integrationsTab(integrationsState, options) {
  const { status, config, editingAdapter, forms } = integrationsState;
  const loading = status === undefined || status === null;

  if (loading) {
    return html`<div class="ig-loading"><sl-spinner></sl-spinner> Loading...</div>`;
  }

  return html`
    <div class="ig-page">
      <p class="ig-subtitle">Receive pipeline notifications in chat apps.</p>
      <div class="ig-cards">
        ${ADAPTERS.map((meta) => {
          const st = adapterStatus(meta.key, status);
          const cfg = adapterConfig(meta.key, config);
          const hasConfig = !!cfg;
          const isRunning = hasConfig && !!st;
          const isPending = hasConfig && !st && cfg.enabled !== false;
          const isEditing = editingAdapter === meta.key;
          const form = forms?.[meta.key] || {
            chatId: '',
            events: ['pipeline.run.completed', 'pipeline.run.failed'],
            saving: false,
            error: null,
            saved: false,
          };

          const cardOptions = {
            editing: isEditing,
            form,
            onEdit: () => options.onStartEdit(meta.key),
            onConfigure: () => options.onStartEdit(meta.key),
            onCancel: () => options.onCancelEdit(),
            onFieldChange: (field, value) =>
              options.onFieldChange(meta.key, field, value),
            onEventToggle: (evt) => options.onEventToggle(meta.key, evt),
            onSave: () => options.onSave(meta.key),
            onRemove: () => options.onRemove(meta.key),
            onDetect: () => options.onDetect?.(meta.key),
            onToggleEnabled: (enabled) =>
              options.onToggleEnabled?.(meta.key, enabled),
          };

          if (isRunning || (hasConfig && cfg.enabled !== false))
            return configuredCard(meta, st, cfg, cardOptions);
          if (isPending) return pendingCard(meta, cfg, cardOptions);
          return unconfiguredCard(meta, cardOptions);
        })}
      </div>
    </div>
  `;
}
