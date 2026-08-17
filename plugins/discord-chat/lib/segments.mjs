/**
 * Shared NormalizedMessage segment renderer — one walk over msg.body with a
 * per-platform style table. Replaces six hand-rolled copies of the same
 * loop+switch across the telegram/slack/discord/webhook_out adapters
 * (arch review 2026-06).
 * @module render-segments
 */

import { toSlackMrkdwn, toTelegramHtml, escapeSlackText } from './markdown.mjs';

/** Shared 429-retry backoff schedule for adapter send() loops. */
export const SEND_BACKOFF_DELAYS = [1000, 5000, 30000];

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A style table maps segment kinds to formatter functions.
 * `title` formats msg.title; `text` is the fallback for unknown kinds.
 * @typedef {{
 *   title: (t: string) => string,
 *   markdown: (v: string) => string,
 *   bold: (v: string) => string,
 *   code: (v: string) => string,
 *   code_block: (v: string) => string,
 *   link: (v: string, seg: {href?: string}) => string,
 *   text: (v: string) => string,
 * }} SegmentStyle
 */

/** @type {SegmentStyle} Slack mrkdwn (all text escaped — <!channel> etc. are control sequences). */
export const SLACK_STYLE = {
  title: (t) => `*${escapeSlackText(t)}*\n`,
  markdown: (v) => toSlackMrkdwn(v),
  bold: (v) => `*${escapeSlackText(v)}*`,
  code: (v) => `\`${escapeSlackText(v)}\``,
  code_block: (v) => `\`\`\`\n${escapeSlackText(v)}\n\`\`\``,
  link: (v, seg) => `<${String(seg.href ?? '').replace(/&/g, '&amp;')}|${escapeSlackText(v)}>`,
  text: (v) => escapeSlackText(v),
};

/** @type {SegmentStyle} Discord markdown (standard markdown passes through). */
export const DISCORD_STYLE = {
  title: (t) => `**${t}**\n`,
  markdown: (v) => v ?? '',
  bold: (v) => `**${v}**`,
  code: (v) => `\`${v}\``,
  code_block: (v) => `\`\`\`\n${v}\n\`\`\``,
  link: (v, seg) => `[${v}](${seg.href ?? ''})`,
  text: (v) => v,
};

/** @type {SegmentStyle} Telegram HTML (parse_mode: HTML, escaped). */
export const TELEGRAM_HTML_STYLE = {
  title: (t) => `<b>${escapeHtml(t)}</b>\n`,
  markdown: (v) => toTelegramHtml(v),
  bold: (v) => `<b>${escapeHtml(v)}</b>`,
  code: (v) => `<code>${escapeHtml(v)}</code>`,
  code_block: (v) => `<pre>${escapeHtml(v)}</pre>`,
  link: (v, seg) =>
    `<a href="${escapeHtml(seg.href ?? '')}">${escapeHtml(v)}</a>`,
  text: (v) => escapeHtml(v),
};

/**
 * Render a NormalizedMessage with the given style table.
 * @param {import('./adapter.js').NormalizedMessage} msg
 * @param {SegmentStyle} style
 * @returns {string}
 */
export function renderSegments(msg, style) {
  const parts = [];
  if (msg.title) {
    parts.push(style.title(msg.title));
  }
  for (const seg of msg.body) {
    const format = style[seg.kind] || style.text;
    parts.push(format(seg.value, seg));
  }
  return parts.join('');
}
