// app/views/settings.js — workspace settings (result dirs + benchmark cache).
//
// Card-based layout: each concern is a card with a header/description, a list of
// current values (path + status badge + inline remove), and an inline add/set
// form. The page title + back button live in main.js's shared content header.

import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { SECRET_FIELDS, secretStatus } from '../utils/secrets.js';

// Lucide icons, inlined to keep worca-bench dependency-light.
const FOLDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const DATABASE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>';
const TRASH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';

/**
 * @param {object} data  { primary, configured, effective, cache?, error? }
 * @param {object} [handlers]
 * @param {(dir: string) => void} [handlers.onAddDir]
 * @param {(dir: string) => void} [handlers.onRemoveDir]
 * @param {(dir: string) => void} [handlers.onSetCache]
 * @param {() => void} [handlers.onBrowseAdd]
 * @param {() => void} [handlers.onBrowseCache]
 * @param {(patch: object) => void} [handlers.onSaveSecrets]  browser-only credentials
 * @param {(name: string) => void} [handlers.onClearSecret]
 */
export function settingsView(
  data,
  {
    onAddDir,
    onRemoveDir,
    onSetCache,
    onBrowseAdd,
    onBrowseCache,
    onSaveSecrets,
    onClearSecret,
  } = {},
) {
  const primary = data?.primary || null;
  const configured = data?.configured || [];
  const effective = data?.effective || [];
  const cache = data?.cache || null;
  const secretsSet = secretStatus();

  // Collect non-empty credential inputs into a patch and hand off to the
  // browser-only store. Inputs are cleared after save (we never echo a secret).
  const submitSecrets = (e) => {
    e.preventDefault();
    const patch = {};
    for (const input of e.currentTarget.querySelectorAll(
      '.settings-secret-input',
    )) {
      const v = (input.value || '').trim();
      if (v) patch[input.dataset.key] = v;
      input.value = '';
    }
    if (Object.keys(patch).length) onSaveSecrets?.(patch);
  };

  const submitAdd = (e) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector('.settings-add-input');
    const value = (input?.value || '').trim();
    if (value) {
      onAddDir?.(value);
      input.value = '';
    }
  };

  const submitCache = (e) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector('.settings-cache-input');
    onSetCache?.((input?.value || '').trim());
    if (input) input.value = '';
  };

  return html`
    <div class="settings-view">
      ${
        data?.error
          ? html`<div class="settings-alert" role="alert">${data.error}</div>`
          : nothing
      }

      <section class="settings-card">
        <div class="settings-card-head">
          <h2 class="settings-card-title">Result directories</h2>
          <p class="settings-card-desc">
            The dashboard aggregates <code>results.jsonl</code> from these
            directories. The launch directory is always included; add more to
            view results from other runs. Stored in
            <code>~/.worca-bench/settings.json</code>.
          </p>
        </div>
        <div class="settings-list settings-dirs">
          ${
            primary
              ? html`<div class="settings-row settings-dir--primary">
                  <span class="settings-row-icon">${unsafeHTML(FOLDER)}</span>
                  <span class="settings-row-path">${primary}</span>
                  <span class="settings-row-hint">always included</span>
                </div>`
              : nothing
          }
          ${configured.map((dir) => {
            const present = effective.includes(dir);
            return html`<div class="settings-row">
              <span class="settings-row-icon">${unsafeHTML(FOLDER)}</span>
              <span class="settings-row-path">${dir}</span>
              ${
                present
                  ? nothing
                  : html`<sl-badge variant="warning" pill>missing</sl-badge>`
              }
              <button
                class="icon-btn icon-btn--danger settings-row-remove"
                aria-label=${`Remove ${dir}`}
                title="Remove"
                @click=${() => onRemoveDir?.(dir)}
              >
                ${unsafeHTML(TRASH)}
              </button>
            </div>`;
          })}
          ${
            configured.length === 0
              ? html`<div class="settings-empty">
                  No additional directories.
                </div>`
              : nothing
          }
        </div>
        <form class="settings-inline-form" @submit=${submitAdd}>
          <input
            class="settings-input settings-add-input"
            type="text"
            placeholder="/absolute/path/to/results-dir"
            aria-label="Directory path to add"
          />
          <button
            class="action-btn settings-browse-btn"
            type="button"
            @click=${() => onBrowseAdd?.()}
          >Browse…</button>
          <button class="action-btn action-btn--primary" type="submit">Add</button>
        </form>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <h2 class="settings-card-title">Benchmark cache directory</h2>
          <p class="settings-card-desc">
            Large HuggingFace datasets and repo mirrors live here — keep it off
            your home volume. Resolves <code>cache_dir</code> →
            <code>WORCA_BENCH_CACHE</code> → <code>~/.worca-bench/cache</code>.
          </p>
        </div>
        <div class="settings-list">
          <div class="settings-row settings-dir--cache">
            <span class="settings-row-icon">${unsafeHTML(DATABASE)}</span>
            <span class="settings-row-path">${cache?.dir || '—'}</span>
            ${
              cache?.source && cache.source !== 'settings'
                ? html`<span class="settings-row-hint">${cache.source}</span>`
                : nothing
            }
          </div>
        </div>
        <form class="settings-inline-form" @submit=${submitCache}>
          <input
            class="settings-input settings-cache-input"
            type="text"
            placeholder="/absolute/path/to/cache"
            aria-label="Cache directory path"
          />
          <button
            class="action-btn"
            type="button"
            title="Reset to default"
            @click=${() => onSetCache?.('')}
          >Reset</button>
          <button
            class="action-btn settings-browse-btn"
            type="button"
            @click=${() => onBrowseCache?.()}
          >Browse…</button>
          <button class="action-btn action-btn--primary" type="submit">Set</button>
        </form>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <h2 class="settings-card-title">Grader credentials</h2>
          <p class="settings-card-desc">
            Keys for the SWE-bench cloud (<code>sb-cli</code>) and Modal graders.
            Stored <strong>only in this browser</strong> (never in the repo or on
            the server) and forwarded into the runner's environment on launch and
            regrade. Leave a field blank to keep its current value.
          </p>
        </div>
        <form class="settings-secrets-form" @submit=${submitSecrets}>
          ${SECRET_FIELDS.map(
            (f) => html`<div class="settings-secret-row">
              <label class="settings-secret-label" for=${`secret-${f.key}`}>
                ${f.label}
                ${
                  secretsSet[f.key]
                    ? html`<sl-badge variant="success" pill>Set</sl-badge>`
                    : html`<sl-badge variant="neutral" pill>Not set</sl-badge>`
                }
              </label>
              <div class="settings-secret-controls">
                <input
                  id=${`secret-${f.key}`}
                  class="settings-input settings-secret-input"
                  type="password"
                  autocomplete="off"
                  data-key=${f.key}
                  placeholder=${secretsSet[f.key] ? '•••••••• (set)' : 'not set'}
                  aria-label=${f.label}
                />
                ${
                  secretsSet[f.key]
                    ? html`<button
                        class="icon-btn icon-btn--danger"
                        type="button"
                        aria-label=${`Clear ${f.label}`}
                        title="Clear"
                        @click=${() => onClearSecret?.(f.key)}
                      >
                        ${unsafeHTML(TRASH)}
                      </button>`
                    : nothing
                }
              </div>
              <p class="settings-secret-hint">${f.hint}</p>
            </div>`,
          )}
          <div class="settings-secrets-actions">
            <button class="action-btn action-btn--primary" type="submit">
              Save credentials
            </button>
          </div>
        </form>
      </section>
    </div>
  `;
}
