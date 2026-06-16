// app/views/settings.js — manage the result directories the dashboard reads.
//
// The dashboard aggregates results.jsonl from the launch --target-dir (always
// included) plus any directories configured in ~/.worca-bench/settings.json.
// This page lists them and lets you add/remove the configured ones. The page
// title + back button live in main.js's shared content header.

import { html, nothing } from 'lit-html';

/**
 * @param {object} data  { primary, configured, effective, cache?, error? }
 * @param {object} [handlers]
 * @param {(dir: string) => void} [handlers.onAddDir]
 * @param {(dir: string) => void} [handlers.onRemoveDir]
 * @param {(dir: string) => void} [handlers.onSetCache]
 */
export function settingsView(data, { onAddDir, onRemoveDir, onSetCache } = {}) {
  const primary = data?.primary || null;
  const configured = data?.configured || [];
  const effective = data?.effective || [];
  const cache = data?.cache || null;

  const submit = (e) => {
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
  };

  return html`
    <div class="settings-view">
      <p class="settings-note">
        The dashboard aggregates <code>results.jsonl</code> from the directories
        below. The launch directory is always included; add more to view results
        produced by other runs. Configuration is stored in
        <code>~/.worca-bench/settings.json</code>.
      </p>

      <section class="settings-block">
        <h3 class="settings-h">Result directories</h3>
        <table class="settings-dirs">
          <tbody>
            ${
              primary
                ? html`<tr class="settings-dir settings-dir--primary">
                    <td class="settings-dir-path">${primary}</td>
                    <td class="settings-dir-tag">launch dir · always included</td>
                    <td></td>
                  </tr>`
                : nothing
            }
            ${
              configured.length === 0 && !primary
                ? html`<tr>
                    <td class="empty-state" colspan="3">
                      No directories configured.
                    </td>
                  </tr>`
                : nothing
            }
            ${configured.map(
              (dir) => html`<tr class="settings-dir">
                <td class="settings-dir-path">${dir}</td>
                <td class="settings-dir-tag">
                  ${effective.includes(dir) ? 'configured' : 'missing'}
                </td>
                <td>
                  <button
                    class="settings-remove"
                    @click=${() => onRemoveDir?.(dir)}
                  >
                    Remove
                  </button>
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </section>

      <section class="settings-block">
        <h3 class="settings-h">Add a directory</h3>
        <form class="settings-add" @submit=${submit}>
          <input
            class="settings-add-input"
            type="text"
            placeholder="/absolute/path/to/target-dir"
          />
          <button class="settings-add-btn" type="submit">Add</button>
        </form>
        ${
          data?.error
            ? html`<p class="settings-error">${data.error}</p>`
            : nothing
        }
      </section>

      <section class="settings-block">
        <h3 class="settings-h">Benchmark cache directory</h3>
        <p class="settings-note">
          Large HuggingFace datasets and repo mirrors are stored here — keep it
          off your home volume. Resolves from
          <code>cache_dir</code> → <code>WORCA_BENCH_CACHE</code> →
          <code>~/.worca-bench/cache</code>.
        </p>
        <table class="settings-dirs">
          <tbody>
            <tr class="settings-dir settings-dir--cache">
              <td class="settings-dir-path">${cache?.dir || '—'}</td>
              <td class="settings-dir-tag">${cache?.source || 'default'}</td>
            </tr>
          </tbody>
        </table>
        <form class="settings-add" @submit=${submitCache}>
          <input
            class="settings-cache-input settings-add-input"
            type="text"
            placeholder="/absolute/path/to/cache (blank to reset)"
          />
          <button class="settings-add-btn" type="submit">Set</button>
        </form>
      </section>
    </div>
  `;
}
