import { html, nothing } from 'lit-html';

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
    icon: '\u2708\ufe0f',
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
    icon: '\ud83d\udcac',
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
    icon: '\ud83d\udce1',
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

function adapterChats(key, status) {
  if (!status?.chats) return [];
  return status.chats.filter((c) => c.platform === key);
}

function adapterConfig(key, config) {
  return config?.[key] || null;
}

// ── Connected card (expanded with stats) ────────────────────────────────

function connectedCard(
  meta,
  adapterSt,
  chats,
  _cfg,
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
  },
) {
  const isPersistent = adapterSt?.persistent;
  const connOk = adapterSt?.connection === 'connected';
  const connErr = adapterSt?.connection_error;

  return html`
    <div class="ig-card ig-card--connected">
      <div class="ig-card-header">
        <span class="ig-card-icon">${meta.icon}</span>
        <div class="ig-card-title">
          <span class="ig-card-name">${meta.label}</span>
          <span class="ig-card-desc">${meta.desc}</span>
        </div>
        <div class="ig-badges">
          <sl-badge variant="primary" pill>Configured</sl-badge>
          ${
            isPersistent
              ? connOk
                ? html`<sl-badge variant="success" pill>Connected</sl-badge>`
                : html`<sl-tooltip content=${connErr || 'Connection lost'}><sl-badge variant="warning" pill>Disconnected</sl-badge></sl-tooltip>`
              : nothing
          }
        </div>
      </div>
      <div class="ig-card-stats">
        <span>Last event: ${formatLastEvent(adapterSt?.last_event_at)}</span>
        ${(adapterSt?.dropped_messages || 0) > 0 ? html`<span class="stat-warn">Dropped: ${adapterSt.dropped_messages}</span>` : nothing}
      </div>
      ${
        chats.length > 0
          ? html`
        <div class="ig-card-chats">
          ${chats.map(
            (c) => html`
            <span class="ig-chat-badge">
              <span class="ig-chat-id">${c.chat_id}</span>
              ${c.muted_until ? html`<sl-badge variant="warning" pill>Muted</sl-badge>` : nothing}
            </span>
          `,
          )}
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
          <div class="ig-card-actions">
            <sl-button size="small" @click=${onEdit}>Edit</sl-button>
            <sl-button size="small" variant="danger" outline @click=${onRemove}>Remove</sl-button>
          </div>
        `
      }
    </div>
  `;
}

// ── Pending card (configured, needs restart) ────────────────────────────

function pendingCard(meta, _cfg, { onEdit, onRemove }) {
  return html`
    <div class="ig-card ig-card--pending">
      <div class="ig-card-header">
        <span class="ig-card-icon">${meta.icon}</span>
        <div class="ig-card-title">
          <span class="ig-card-name">${meta.label}</span>
          <span class="ig-card-desc">${meta.desc}</span>
        </div>
        <sl-badge variant="warning" pill>Not connected</sl-badge>
      </div>
      <div class="ig-card-pending-hint">Configuration saved but adapter failed to connect. Check the token and server logs.</div>
      <div class="ig-card-actions">
        <sl-button size="small" @click=${onEdit}>Edit</sl-button>
        <sl-button size="small" variant="danger" outline @click=${onRemove}>Remove</sl-button>
      </div>
    </div>
  `;
}

// ── Disconnected card (compact) ─────────────────────────────────────────

function disconnectedCard(
  meta,
  {
    editing,
    form,
    onConnect,
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
        <span class="ig-card-icon">${meta.icon}</span>
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
            <sl-button size="small" variant="primary" @click=${onConnect}>Connect</sl-button>
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
          const chats = adapterChats(meta.key, status);
          const cfg = adapterConfig(meta.key, config);
          const isConnected = !!cfg?.enabled && !!st;
          const isPending = !!cfg?.enabled && !st;
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
            onConnect: () => options.onStartEdit(meta.key),
            onCancel: () => options.onCancelEdit(),
            onFieldChange: (field, value) =>
              options.onFieldChange(meta.key, field, value),
            onEventToggle: (evt) => options.onEventToggle(meta.key, evt),
            onSave: () => options.onSave(meta.key),
            onRemove: () => options.onRemove(meta.key),
            onDetect: () => options.onDetect?.(meta.key),
          };

          if (isConnected)
            return connectedCard(meta, st, chats, cfg, cardOptions);
          if (isPending) return pendingCard(meta, cfg, cardOptions);
          return disconnectedCard(meta, cardOptions);
        })}
      </div>
    </div>
  `;
}
