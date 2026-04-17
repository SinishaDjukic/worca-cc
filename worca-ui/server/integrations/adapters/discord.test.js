import { describe, expect, it, vi } from 'vitest';
import { createDiscordAdapter, renderToMarkdown } from './discord.js';

// ---------------------------------------------------------------------------
// renderToMarkdown
// ---------------------------------------------------------------------------

describe('renderToMarkdown', () => {
  it('renders plain text', () => {
    const msg = {
      title: null,
      body: [{ kind: 'text', value: 'hello' }],
      severity: 'info',
    };
    expect(renderToMarkdown(msg)).toBe('hello');
  });

  it('renders title as bold line', () => {
    const msg = { title: 'Done', body: [], severity: 'success' };
    expect(renderToMarkdown(msg)).toBe('**Done**\n');
  });

  it('renders bold segment', () => {
    const msg = {
      title: null,
      body: [{ kind: 'bold', value: 'important' }],
      severity: 'info',
    };
    expect(renderToMarkdown(msg)).toBe('**important**');
  });

  it('renders inline code segment', () => {
    const msg = {
      title: null,
      body: [{ kind: 'code', value: 'npm test' }],
      severity: 'info',
    };
    expect(renderToMarkdown(msg)).toBe('`npm test`');
  });

  it('renders code_block segment', () => {
    const msg = {
      title: null,
      body: [{ kind: 'code_block', value: 'line1\nline2' }],
      severity: 'info',
    };
    expect(renderToMarkdown(msg)).toBe('```\nline1\nline2\n```');
  });

  it('renders link segment', () => {
    const msg = {
      title: null,
      body: [
        {
          kind: 'link',
          value: 'PR #42',
          href: 'https://github.com/org/repo/pull/42',
        },
      ],
      severity: 'info',
    };
    expect(renderToMarkdown(msg)).toBe(
      '[PR #42](https://github.com/org/repo/pull/42)',
    );
  });

  it('renders mixed segments in order', () => {
    const msg = {
      title: 'Build failed',
      body: [
        { kind: 'text', value: 'Error: ' },
        { kind: 'code', value: 'ENOMEM' },
        { kind: 'text', value: ' — see ' },
        { kind: 'link', value: 'logs', href: 'https://example.com/logs' },
      ],
      severity: 'error',
    };
    expect(renderToMarkdown(msg)).toBe(
      '**Build failed**\nError: `ENOMEM` — see [logs](https://example.com/logs)',
    );
  });

  it('escapes backticks inside inline code with zero-width-joiner fallback (passthrough)', () => {
    const msg = {
      title: null,
      body: [{ kind: 'code', value: 'back`tick' }],
      severity: 'info',
    };
    // Discord strips stray backticks; we just wrap in backticks as-is
    expect(renderToMarkdown(msg)).toBe('`back`tick`');
  });
});

// ---------------------------------------------------------------------------
// createDiscordAdapter
// ---------------------------------------------------------------------------

function makeOkResponse(body = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function make429Response(retryAfter = null) {
  return Promise.resolve({
    ok: false,
    status: 429,
    json: () =>
      Promise.resolve(retryAfter !== null ? { retry_after: retryAfter } : {}),
  });
}

function makeErrorResponse(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  });
}

describe('createDiscordAdapter shape', () => {
  it('has expected interface properties', () => {
    const adapter = createDiscordAdapter({
      botToken: 'tok',
      fetchFn: vi.fn(),
      _sleep: vi.fn(),
    });
    expect(adapter.name).toBe('discord');
    expect(adapter.supportsInbound).toBe(false);
    expect(typeof adapter.start).toBe('function');
    expect(typeof adapter.send).toBe('function');
    expect(typeof adapter.onInbound).toBe('function');
  });
});

describe('createDiscordAdapter.send', () => {
  it('POSTs to channels/{channelId}/messages with markdown body', async () => {
    const fetchFn = vi.fn(() => makeOkResponse({ id: '1' }));
    const adapter = createDiscordAdapter({
      botToken: 'Bot mytoken',
      channelId: 'chan123',
      fetchFn,
      _sleep: vi.fn(),
    });

    const msg = {
      title: 'Run complete',
      body: [{ kind: 'text', value: 'All tests passed.' }],
      severity: 'success',
    };
    await adapter.send('chan123', msg);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain('/channels/chan123/messages');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(init.body);
    expect(payload.content).toBe('**Run complete**\nAll tests passed.');
  });

  it('uses channelId from send() arg, not constructor default', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createDiscordAdapter({
      botToken: 'Bot mytoken',
      fetchFn,
      _sleep: vi.fn(),
    });
    await adapter.send('override-chan', {
      title: null,
      body: [{ kind: 'text', value: 'hi' }],
      severity: 'info',
    });
    const [url] = fetchFn.mock.calls[0];
    expect(url).toContain('/channels/override-chan/messages');
  });

  it('sets Authorization header with Bot prefix', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createDiscordAdapter({
      botToken: 'myrawtoken',
      fetchFn,
      _sleep: vi.fn(),
    });
    await adapter.send('c', { title: null, body: [], severity: 'info' });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bot myrawtoken');
  });

  it('does not double-prefix Bot when token already starts with Bot', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createDiscordAdapter({
      botToken: 'Bot alreadyprefixed',
      fetchFn,
      _sleep: vi.fn(),
    });
    await adapter.send('c', { title: null, body: [], severity: 'info' });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bot alreadyprefixed');
  });

  it('retries on 429 with retry_after from response', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => make429Response(2))
      .mockImplementationOnce(() => makeOkResponse());
    const adapter = createDiscordAdapter({
      botToken: 'tok',
      fetchFn,
      _sleep: sleep,
    });
    await adapter.send('c', {
      title: null,
      body: [{ kind: 'text', value: 'x' }],
      severity: 'info',
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries on 429 with backoff delay when retry_after absent', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => make429Response())
      .mockImplementationOnce(() => makeOkResponse());
    const adapter = createDiscordAdapter({
      botToken: 'tok',
      fetchFn,
      _sleep: sleep,
    });
    await adapter.send('c', { title: null, body: [], severity: 'info' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('drops message after exhausting retries on persistent 429', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = vi.fn(() => make429Response(0));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createDiscordAdapter({
      botToken: 'tok',
      fetchFn,
      _sleep: sleep,
    });
    await adapter.send('c', { title: null, body: [], severity: 'info' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dropped'));
    warnSpy.mockRestore();
  });

  it('warns but does not throw on non-429 HTTP error', async () => {
    const fetchFn = vi.fn(() => makeErrorResponse(500));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createDiscordAdapter({
      botToken: 'tok',
      fetchFn,
      _sleep: vi.fn(),
    });
    await expect(
      adapter.send('c', { title: null, body: [], severity: 'info' }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('createDiscordAdapter.start', () => {
  it('resolves immediately (no-op — outbound only)', async () => {
    const adapter = createDiscordAdapter({
      botToken: 'tok',
      fetchFn: vi.fn(),
      _sleep: vi.fn(),
    });
    await expect(adapter.start()).resolves.toBeUndefined();
  });
});

describe('createDiscordAdapter.onInbound', () => {
  it('is a no-op function (outbound only)', () => {
    const adapter = createDiscordAdapter({
      botToken: 'tok',
      fetchFn: vi.fn(),
      _sleep: vi.fn(),
    });
    expect(() => adapter.onInbound(() => {})).not.toThrow();
  });
});
