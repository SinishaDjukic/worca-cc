/**
 * Markdown-to-native format converters for chat adapter responses.
 *
 * Command handlers write responses in standard markdown. Each adapter
 * converts to its native format before sending.
 *
 * @module integrations/markdown
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape HTML special characters in text (for Telegram HTML).
 */
function escHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Process a markdown string by extracting protected regions (code blocks and
 * inline code) first, applying transformations to unprotected text, then
 * restoring the protected regions.
 *
 * @param {string} md - Markdown input
 * @param {(text: string) => string} transformText - Transform non-code text
 * @param {(code: string) => string} transformCodeBlock - Transform ```block```
 * @param {(code: string) => string} transformInlineCode - Transform `code`
 * @returns {string}
 */
function processWithCodeProtection(
  md,
  transformText,
  transformCodeBlock,
  transformInlineCode,
) {
  const placeholders = [];
  let idx = 0;

  function placeholder(value) {
    const key = `\x00PH${idx++}\x00`;
    placeholders.push({ key, value });
    return key;
  }

  // 1. Protect fenced code blocks (``` ... ```)
  let result = md.replace(/```([\s\S]*?)```/g, (_match, code) => {
    return placeholder(transformCodeBlock(code));
  });

  // 2. Protect inline code (` ... `)
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    return placeholder(transformInlineCode(code));
  });

  // 3. Transform the remaining (unprotected) text
  result = transformText(result);

  // 4. Restore placeholders
  for (const { key, value } of placeholders) {
    result = result.replace(key, value);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Telegram HTML
// ---------------------------------------------------------------------------

/**
 * Convert standard markdown to Telegram HTML.
 *
 * Supports: bold, italic, code, code blocks, links, strikethrough.
 * Escapes <, >, & in regular text before adding HTML tags.
 *
 * @param {string} md
 * @returns {string}
 */
export function toTelegramHtml(md) {
  if (!md) return '';

  return processWithCodeProtection(
    md,
    // Transform regular text
    (text) => {
      // Escape HTML entities in regular text first
      text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      // Links: [text](url) → <a href="url">text</a>
      text = text.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, label, url) => `<a href="${url}">${label}</a>`,
      );
      // Bold: **text** → <b>text</b>
      text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      // Italic: *text* → <i>text</i>
      text = text.replace(/\*(.+?)\*/g, '<i>$1</i>');
      // Strikethrough: ~~text~~ → <s>text</s>
      text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
      return text;
    },
    // Code block: ```block``` → <pre>block</pre>
    (code) => `<pre>${escHtml(code)}</pre>`,
    // Inline code: `code` → <code>code</code>
    (code) => `<code>${escHtml(code)}</code>`,
  );
}

// ---------------------------------------------------------------------------
// Discord markdown (pass-through)
// ---------------------------------------------------------------------------

/**
 * Convert standard markdown to Discord markdown.
 * Discord supports standard markdown natively, so this is a pass-through.
 *
 * @param {string} md
 * @returns {string}
 */
export function toDiscordMarkdown(md) {
  return md ?? '';
}

// ---------------------------------------------------------------------------
// Slack mrkdwn
// ---------------------------------------------------------------------------

/**
 * Convert standard markdown to Slack mrkdwn format.
 *
 * Supports: bold, italic, code, code blocks, links, strikethrough.
 *
 * @param {string} md
 * @returns {string}
 */
export function toSlackMrkdwn(md) {
  if (!md) return '';

  return processWithCodeProtection(
    md,
    // Transform regular text
    (text) => {
      // Links: [text](url) → <url|text>
      // Match links carefully — url part uses a greedy match up to the closing )
      text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
        // Escape pipe characters in url and label
        const safeUrl = url.replace(/\|/g, '%7C');
        const safeLabel = label.replace(/\|/g, '\u2758');
        return `<${safeUrl}|${safeLabel}>`;
      });
      // Italic (single *) BEFORE bold — we need to match single * that are NOT
      // part of ** pairs. Convert italic first using a temp marker, then bold.
      // Step 1: Convert bold **text** → placeholder
      const boldParts = [];
      let bIdx = 0;
      text = text.replace(/\*\*(.+?)\*\*/g, (_m, content) => {
        const key = `\x01B${bIdx++}\x01`;
        boldParts.push({ key, content });
        return key;
      });
      // Step 2: Convert remaining italic *text* → _text_
      text = text.replace(/\*(.+?)\*/g, '_$1_');
      // Step 3: Restore bold as Slack bold *text*
      for (const { key, content } of boldParts) {
        text = text.replace(key, `*${content}*`);
      }
      // Strikethrough: ~~text~~ → ~text~
      text = text.replace(/~~(.+?)~~/g, '~$1~');
      return text;
    },
    // Code blocks pass through as-is (``` is native in Slack)
    (code) => `\`\`\`${code}\`\`\``,
    // Inline code passes through as-is
    (code) => `\`${code}\``,
  );
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/**
 * Strip all markdown formatting and return plain text.
 *
 * @param {string} md
 * @returns {string}
 */
export function toPlainText(md) {
  if (!md) return '';

  return processWithCodeProtection(
    md,
    // Transform regular text
    (text) => {
      // Links: [text](url) → text (url)
      text = text.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, label, url) => `${label} (${url})`,
      );
      // Bold: **text** → text
      text = text.replace(/\*\*(.+?)\*\*/g, '$1');
      // Italic: *text* → text
      text = text.replace(/\*(.+?)\*/g, '$1');
      // Strikethrough: ~~text~~ → text
      text = text.replace(/~~(.+?)~~/g, '$1');
      return text;
    },
    // Code blocks: just the content
    (code) => code,
    // Inline code: just the content
    (code) => code,
  );
}
