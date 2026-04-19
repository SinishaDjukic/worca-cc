import { describe, expect, it } from 'vitest';
import {
  toDiscordMarkdown,
  toPlainText,
  toSlackMrkdwn,
  toTelegramHtml,
} from './markdown.js';

// ---------------------------------------------------------------------------
// toTelegramHtml
// ---------------------------------------------------------------------------

describe('toTelegramHtml', () => {
  it('converts bold', () => {
    expect(toTelegramHtml('**bold**')).toBe('<b>bold</b>');
  });

  it('converts italic', () => {
    expect(toTelegramHtml('*italic*')).toBe('<i>italic</i>');
  });

  it('converts inline code', () => {
    expect(toTelegramHtml('`code`')).toBe('<code>code</code>');
  });

  it('converts code blocks', () => {
    expect(toTelegramHtml('```\nblock\n```')).toBe('<pre>\nblock\n</pre>');
  });

  it('converts links', () => {
    expect(toTelegramHtml('[text](https://example.com)')).toBe(
      '<a href="https://example.com">text</a>',
    );
  });

  it('converts strikethrough', () => {
    expect(toTelegramHtml('~~strike~~')).toBe('<s>strike</s>');
  });

  it('escapes < > & in regular text', () => {
    expect(toTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('escapes HTML inside code spans', () => {
    expect(toTelegramHtml('`<div>`')).toBe('<code>&lt;div&gt;</code>');
  });

  it('escapes HTML inside code blocks', () => {
    expect(toTelegramHtml('```<script>alert(1)</script>```')).toBe(
      '<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>',
    );
  });

  it('handles mixed formatting in one string', () => {
    expect(toTelegramHtml('**Run:** `run-001` *done*')).toBe(
      '<b>Run:</b> <code>run-001</code> <i>done</i>',
    );
  });

  it('protects code block content from bold/italic transformation', () => {
    expect(toTelegramHtml('```**not bold**```')).toBe(
      '<pre>**not bold**</pre>',
    );
  });

  it('protects inline code content from bold transformation', () => {
    expect(toTelegramHtml('`**not bold**`')).toBe('<code>**not bold**</code>');
  });

  it('handles nested bold around code', () => {
    expect(toTelegramHtml('**bold `code` bold**')).toBe(
      '<b>bold <code>code</code> bold</b>',
    );
  });

  it('returns empty string for empty input', () => {
    expect(toTelegramHtml('')).toBe('');
    expect(toTelegramHtml(null)).toBe('');
    expect(toTelegramHtml(undefined)).toBe('');
  });

  it('returns plain text unchanged when no formatting', () => {
    expect(toTelegramHtml('hello world')).toBe('hello world');
  });

  it('preserves newlines', () => {
    expect(toTelegramHtml('line1\nline2')).toBe('line1\nline2');
  });
});

// ---------------------------------------------------------------------------
// toDiscordMarkdown
// ---------------------------------------------------------------------------

describe('toDiscordMarkdown', () => {
  it('passes markdown through unchanged', () => {
    const md = '**bold** *italic* `code` [link](url) ~~strike~~';
    expect(toDiscordMarkdown(md)).toBe(md);
  });

  it('returns empty string for null/undefined', () => {
    expect(toDiscordMarkdown(null)).toBe('');
    expect(toDiscordMarkdown(undefined)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(toDiscordMarkdown('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// toSlackMrkdwn
// ---------------------------------------------------------------------------

describe('toSlackMrkdwn', () => {
  it('converts bold', () => {
    expect(toSlackMrkdwn('**bold**')).toBe('*bold*');
  });

  it('converts italic', () => {
    expect(toSlackMrkdwn('*italic*')).toBe('_italic_');
  });

  it('preserves inline code', () => {
    expect(toSlackMrkdwn('`code`')).toBe('`code`');
  });

  it('preserves code blocks', () => {
    expect(toSlackMrkdwn('```block```')).toBe('```block```');
  });

  it('converts links', () => {
    expect(toSlackMrkdwn('[text](https://example.com)')).toBe(
      '<https://example.com|text>',
    );
  });

  it('converts strikethrough', () => {
    expect(toSlackMrkdwn('~~strike~~')).toBe('~strike~');
  });

  it('escapes pipe in link URL', () => {
    expect(toSlackMrkdwn('[text](https://x.com?a|b)')).toBe(
      '<https://x.com?a%7Cb|text>',
    );
  });

  it('handles mixed formatting', () => {
    expect(toSlackMrkdwn('**Run:** `run-001`')).toBe('*Run:* `run-001`');
  });

  it('protects code block content from transformation', () => {
    expect(toSlackMrkdwn('```**not bold**```')).toBe('```**not bold**```');
  });

  it('protects inline code content from transformation', () => {
    expect(toSlackMrkdwn('`**not bold**`')).toBe('`**not bold**`');
  });

  it('returns empty string for empty input', () => {
    expect(toSlackMrkdwn('')).toBe('');
    expect(toSlackMrkdwn(null)).toBe('');
  });

  it('returns plain text unchanged when no formatting', () => {
    expect(toSlackMrkdwn('hello world')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// toPlainText
// ---------------------------------------------------------------------------

describe('toPlainText', () => {
  it('strips bold', () => {
    expect(toPlainText('**bold**')).toBe('bold');
  });

  it('strips italic', () => {
    expect(toPlainText('*italic*')).toBe('italic');
  });

  it('strips inline code backticks', () => {
    expect(toPlainText('`code`')).toBe('code');
  });

  it('strips code block fences', () => {
    expect(toPlainText('```block```')).toBe('block');
  });

  it('converts links to text (url)', () => {
    expect(toPlainText('[text](https://example.com)')).toBe(
      'text (https://example.com)',
    );
  });

  it('strips strikethrough', () => {
    expect(toPlainText('~~strike~~')).toBe('strike');
  });

  it('handles mixed formatting', () => {
    expect(toPlainText('**Run:** `run-001` *done*')).toBe('Run: run-001 done');
  });

  it('protects code block content from transformation', () => {
    expect(toPlainText('```**not bold**```')).toBe('**not bold**');
  });

  it('returns empty string for empty input', () => {
    expect(toPlainText('')).toBe('');
    expect(toPlainText(null)).toBe('');
  });

  it('returns plain text unchanged when no formatting', () => {
    expect(toPlainText('hello world')).toBe('hello world');
  });

  it('preserves newlines', () => {
    expect(toPlainText('line1\nline2')).toBe('line1\nline2');
  });

  it('handles special characters without formatting', () => {
    expect(toPlainText('a < b & c > d')).toBe('a < b & c > d');
  });
});
