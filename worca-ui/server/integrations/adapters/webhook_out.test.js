import { describe, expect, it, vi } from 'vitest';
import {
  createWebhookOutAdapter,
  renderAsDiscordCompatible,
  renderAsGenericJson,
  renderAsNtfy,
  renderAsPlainText,
  renderAsSlackCompatible,
  renderAsTeamsCard,
} from './webhook_out.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_MSG = {
  title: 'Run complete',
  body: [
    { kind: 'text', value: 'All tests passed. ' },
    { kind: 'bold', value: 'W-042' },
    { kind: 'text', value: ' — ' },
    {
      kind: 'link',
      value: 'PR #7',
      href: 'https://github.com/org/repo/pull/7',
    },
  ],
  severity: 'success',
};

const PLAIN_MSG = {
  title: null,
  body: [{ kind: 'text', value: 'hello world' }],
  severity: 'info',
};

// ---------------------------------------------------------------------------
// renderAsGenericJson
// ---------------------------------------------------------------------------

describe('renderAsGenericJson', () => {
  it('returns title, severity, text, and segments', () => {
    const out = renderAsGenericJson(FULL_MSG);
    expect(out.title).toBe('Run complete');
    expect(out.severity).toBe('success');
    expect(typeof out.text).toBe('string');
    expect(Array.isArray(out.segments)).toBe(true);
  });

  it('text is plain concatenation of segment values', () => {
    const out = renderAsGenericJson(FULL_MSG);
    expect(out.text).toBe('All tests passed. W-042 — PR #7');
  });

  it('segments preserves original body array', () => {
    const out = renderAsGenericJson(FULL_MSG);
    expect(out.segments).toEqual(FULL_MSG.body);
  });

  it('handles null title', () => {
    const out = renderAsGenericJson(PLAIN_MSG);
    expect(out.title).toBeNull();
  });

  it('produces valid JSON-serializable object', () => {
    expect(() => JSON.stringify(renderAsGenericJson(FULL_MSG))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderAsSlackCompatible
// ---------------------------------------------------------------------------

describe('renderAsSlackCompatible', () => {
  it('returns object with text property', () => {
    const out = renderAsSlackCompatible(FULL_MSG);
    expect(typeof out.text).toBe('string');
  });

  it('includes bold title with single asterisks', () => {
    const out = renderAsSlackCompatible(FULL_MSG);
    expect(out.text).toContain('*Run complete*');
  });

  it('renders bold segment with single asterisks', () => {
    const out = renderAsSlackCompatible(FULL_MSG);
    expect(out.text).toContain('*W-042*');
  });

  it('renders link in Slack mrkdwn format <url|text>', () => {
    const out = renderAsSlackCompatible(FULL_MSG);
    expect(out.text).toContain('<https://github.com/org/repo/pull/7|PR #7>');
  });

  it('renders null title with no title line', () => {
    const out = renderAsSlackCompatible(PLAIN_MSG);
    expect(out.text).toBe('hello world');
  });

  it('produces valid JSON-serializable object', () => {
    expect(() =>
      JSON.stringify(renderAsSlackCompatible(FULL_MSG)),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderAsDiscordCompatible
// ---------------------------------------------------------------------------

describe('renderAsDiscordCompatible', () => {
  it('returns object with content property', () => {
    const out = renderAsDiscordCompatible(FULL_MSG);
    expect(typeof out.content).toBe('string');
  });

  it('includes bold title with double asterisks', () => {
    const out = renderAsDiscordCompatible(FULL_MSG);
    expect(out.content).toContain('**Run complete**');
  });

  it('renders bold segment with double asterisks', () => {
    const out = renderAsDiscordCompatible(FULL_MSG);
    expect(out.content).toContain('**W-042**');
  });

  it('renders link in markdown format [text](url)', () => {
    const out = renderAsDiscordCompatible(FULL_MSG);
    expect(out.content).toContain(
      '[PR #7](https://github.com/org/repo/pull/7)',
    );
  });

  it('renders null title with no title line', () => {
    const out = renderAsDiscordCompatible(PLAIN_MSG);
    expect(out.content).toBe('hello world');
  });

  it('produces valid JSON-serializable object', () => {
    expect(() =>
      JSON.stringify(renderAsDiscordCompatible(FULL_MSG)),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderAsTeamsCard
// ---------------------------------------------------------------------------

describe('renderAsTeamsCard', () => {
  it('returns type=message envelope', () => {
    const out = renderAsTeamsCard(FULL_MSG);
    expect(out.type).toBe('message');
  });

  it('has one attachment with adaptive-card contentType', () => {
    const out = renderAsTeamsCard(FULL_MSG);
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    );
  });

  it('adaptive card has AdaptiveCard type and version', () => {
    const card = renderAsTeamsCard(FULL_MSG).attachments[0].content;
    expect(card.type).toBe('AdaptiveCard');
    expect(typeof card.version).toBe('string');
  });

  it('includes title block when title present', () => {
    const card = renderAsTeamsCard(FULL_MSG).attachments[0].content;
    const titleBlock = card.body.find((b) => b.weight === 'bolder');
    expect(titleBlock).toBeDefined();
    expect(titleBlock.text).toBe('Run complete');
  });

  it('includes body text block', () => {
    const card = renderAsTeamsCard(FULL_MSG).attachments[0].content;
    const textBlock = card.body.find(
      (b) => b.type === 'TextBlock' && !b.weight,
    );
    expect(textBlock).toBeDefined();
    expect(textBlock.text).toBe('All tests passed. W-042 — PR #7');
  });

  it('omits title block when title is null', () => {
    const card = renderAsTeamsCard(PLAIN_MSG).attachments[0].content;
    const titleBlock = card.body.find((b) => b.weight === 'bolder');
    expect(titleBlock).toBeUndefined();
  });

  it('produces valid JSON-serializable object', () => {
    expect(() => JSON.stringify(renderAsTeamsCard(FULL_MSG))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderAsNtfy
// ---------------------------------------------------------------------------

describe('renderAsNtfy', () => {
  it('includes message as plain text', () => {
    const out = renderAsNtfy(FULL_MSG);
    expect(out.message).toBe('All tests passed. W-042 — PR #7');
  });

  it('includes title when present', () => {
    const out = renderAsNtfy(FULL_MSG);
    expect(out.title).toBe('Run complete');
  });

  it('omits title when null', () => {
    const out = renderAsNtfy(PLAIN_MSG);
    expect(out.title == null).toBe(true);
  });

  it('maps info severity to priority 2', () => {
    expect(renderAsNtfy({ ...FULL_MSG, severity: 'info' }).priority).toBe(2);
  });

  it('maps success severity to priority 3', () => {
    expect(renderAsNtfy({ ...FULL_MSG, severity: 'success' }).priority).toBe(3);
  });

  it('maps warning severity to priority 4', () => {
    expect(renderAsNtfy({ ...FULL_MSG, severity: 'warning' }).priority).toBe(4);
  });

  it('maps error severity to priority 5', () => {
    expect(renderAsNtfy({ ...FULL_MSG, severity: 'error' }).priority).toBe(5);
  });

  it('produces valid JSON-serializable object', () => {
    expect(() => JSON.stringify(renderAsNtfy(FULL_MSG))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderAsPlainText
// ---------------------------------------------------------------------------

describe('renderAsPlainText', () => {
  it('returns a string', () => {
    expect(typeof renderAsPlainText(FULL_MSG)).toBe('string');
  });

  it('includes title on first line when present', () => {
    const out = renderAsPlainText(FULL_MSG);
    expect(out.startsWith('Run complete\n')).toBe(true);
  });

  it('includes body as plain segment values', () => {
    const out = renderAsPlainText(FULL_MSG);
    expect(out).toContain('All tests passed. W-042 — PR #7');
  });

  it('omits title line when null', () => {
    const out = renderAsPlainText(PLAIN_MSG);
    expect(out).toBe('hello world');
    expect(out).not.toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// createWebhookOutAdapter — shape
// ---------------------------------------------------------------------------

describe('createWebhookOutAdapter shape', () => {
  it('has expected interface properties', () => {
    const adapter = createWebhookOutAdapter({
      endpoints: [],
      fetchFn: vi.fn(),
    });
    expect(adapter.name).toBe('webhook_out');
    expect(adapter.supportsInbound).toBe(false);
    expect(typeof adapter.start).toBe('function');
    expect(typeof adapter.send).toBe('function');
    expect(typeof adapter.onInbound).toBe('function');
  });

  it('start() resolves immediately', async () => {
    const adapter = createWebhookOutAdapter({
      endpoints: [],
      fetchFn: vi.fn(),
    });
    await expect(adapter.start()).resolves.toBeUndefined();
  });

  it('onInbound() is a no-op', () => {
    const adapter = createWebhookOutAdapter({
      endpoints: [],
      fetchFn: vi.fn(),
    });
    expect(() => adapter.onInbound(() => {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createWebhookOutAdapter.send — routing
// ---------------------------------------------------------------------------

function makeOkResponse() {
  return Promise.resolve({ ok: true, status: 200 });
}

function make429Response(retryAfter = null) {
  const headers = new Map();
  if (retryAfter !== null) headers.set('retry-after', String(retryAfter));
  return Promise.resolve({
    ok: false,
    status: 429,
    headers: { get: (k) => headers.get(k) ?? null },
  });
}

describe('createWebhookOutAdapter.send routing', () => {
  it('sends nothing when no endpoints configured', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({ endpoints: [], fetchFn });
    await adapter.send('any', FULL_MSG);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs to each configured endpoint URL', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({
      endpoints: [
        { url: 'https://example.com/a', format: 'generic-json', headers: {} },
        { url: 'https://example.com/b', format: 'generic-json', headers: {} },
      ],
      fetchFn,
    });
    await adapter.send('any', FULL_MSG);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const urls = fetchFn.mock.calls.map(([u]) => u);
    expect(urls).toContain('https://example.com/a');
    expect(urls).toContain('https://example.com/b');
  });

  it('uses POST method', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({
      endpoints: [
        {
          url: 'https://example.com/hook',
          format: 'generic-json',
          headers: {},
        },
      ],
      fetchFn,
    });
    await adapter.send('any', PLAIN_MSG);
    expect(fetchFn.mock.calls[0][1].method).toBe('POST');
  });

  it('sets Content-Type: application/json for JSON formats', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({
      endpoints: [
        {
          url: 'https://example.com/hook',
          format: 'slack-compatible',
          headers: {},
        },
      ],
      fetchFn,
    });
    await adapter.send('any', PLAIN_MSG);
    expect(fetchFn.mock.calls[0][1].headers['Content-Type']).toBe(
      'application/json',
    );
  });

  it('sets Content-Type: text/plain for plain-text format', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({
      endpoints: [
        { url: 'https://example.com/hook', format: 'plain-text', headers: {} },
      ],
      fetchFn,
    });
    await adapter.send('any', PLAIN_MSG);
    expect(fetchFn.mock.calls[0][1].headers['Content-Type']).toBe('text/plain');
  });

  it('sends string body for plain-text format', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({
      endpoints: [
        { url: 'https://example.com/hook', format: 'plain-text', headers: {} },
      ],
      fetchFn,
    });
    await adapter.send('any', PLAIN_MSG);
    expect(typeof fetchFn.mock.calls[0][1].body).toBe('string');
    expect(() => JSON.parse(fetchFn.mock.calls[0][1].body)).toThrow();
  });

  it('merges per-endpoint custom headers', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({
      endpoints: [
        {
          url: 'https://example.com/hook',
          format: 'generic-json',
          headers: { Authorization: 'Bearer secret', 'X-Custom': 'val' },
        },
      ],
      fetchFn,
    });
    await adapter.send('any', PLAIN_MSG);
    const { headers } = fetchFn.mock.calls[0][1];
    expect(headers.Authorization).toBe('Bearer secret');
    expect(headers['X-Custom']).toBe('val');
  });

  it('falls back to generic-json for unknown format', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({
      endpoints: [
        {
          url: 'https://example.com/hook',
          format: 'unknown-format',
          headers: {},
        },
      ],
      fetchFn,
    });
    await adapter.send('any', FULL_MSG);
    const payload = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(payload.severity).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// createWebhookOutAdapter.send — 429 retry
// ---------------------------------------------------------------------------

describe('createWebhookOutAdapter.send 429 retry', () => {
  it('retries on 429 with Retry-After header', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => make429Response(2))
      .mockImplementationOnce(() => makeOkResponse());
    const adapter = createWebhookOutAdapter({
      endpoints: [
        {
          url: 'https://example.com/hook',
          format: 'generic-json',
          headers: {},
        },
      ],
      fetchFn,
      _sleep: sleep,
    });
    await adapter.send('any', PLAIN_MSG);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('drops after exhausting retries on persistent 429', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = vi.fn(() => make429Response());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createWebhookOutAdapter({
      endpoints: [
        {
          url: 'https://example.com/hook',
          format: 'generic-json',
          headers: {},
        },
      ],
      fetchFn,
      _sleep: sleep,
    });
    await adapter.send('any', PLAIN_MSG);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dropped'));
    warnSpy.mockRestore();
  });

  it('warns but does not throw on non-429 HTTP error', async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createWebhookOutAdapter({
      endpoints: [
        {
          url: 'https://example.com/hook',
          format: 'generic-json',
          headers: {},
        },
      ],
      fetchFn,
      _sleep: vi.fn(),
    });
    await expect(adapter.send('any', PLAIN_MSG)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
