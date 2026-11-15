// NotLiveRow (docs/rail/settings.md `set.not-live`): a Settings row, or a whole section, that is still sample data on a
// live Stillhet. It shows no value and holds nothing to click: a row is its name and the sentence (a SettingsRow), a section
// all sample is one line (an EmptyState). The sentence lives here only; a page that needs the bare words (a disabled control's reason) reads NOT_LIVE_SENTENCE.
import { esc } from './html.mjs';
import { settingsRow } from './settings-row.mjs';
import { emptyState } from './empty-state.mjs';

export const NOT_LIVE_SENTENCE = 'Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it';

/**
 * NotLiveRow: a Settings row, or a whole section, still sample data on a live Stillhet.
 * @param {object} [o]
 * @param {string} [o.name]   the row's name; none for a section's one line
 * @param {string} [o.help]   the name's tooltip
 */
export function notLiveRow({ name = '', help = '' } = {}) {
  return name ? settingsRow({ name, help, sentence: esc(NOT_LIVE_SENTENCE) }) : emptyState({ title: NOT_LIVE_SENTENCE });
}
