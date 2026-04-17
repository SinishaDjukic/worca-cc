import { describe, expect, it, vi } from 'vitest';
import { createSlackAdapter, renderToMrkdwn } from './slack.js';

// ---------------------------------------------------------------------------
// renderToMrkdwn
// ---------------------------------------------------------------------------

describe('renderToMrkdwn', () => {
  it('renders plain text', () => {
    const msg = {
      title: null,
      body: [{ kind: 'text', value: 'hello' }],
      severity: 'info',
    };
    expect(renderToMrkdwn(msg)).toBe('hello');
  });

  it('renders title as bold line', () => {
    const msg = { title: 'Done', body: [], severity: 'success' };
    expect(renderToMrkdwn(msg)).toBe('*Done*\n');
  });

  it('renders bold segment with single asterisks', () => {
    const msg = {
      title: null,
      body: [{ kind: 'bold', value: 'important' }],
      severity: 'info',
    };
    expect(renderToMrkdwn(msg)).toBe('*important*');
  });

  it('renders inline code segment', () => {
    const msg = {
      title: null,
      body: [{ kind: 'code', value: 'npm test' }],
      severity: 'info',
    };
    expect(renderToMrkdwn(msg)).toBe('`npm test`');
  });

  it('renders code_block segment', () => {
    const msg = {
      title: null,
      body: [{ kind: 'code_block', value: 'line1\nline2' }],
      severity: 'info',
    };
    expect(renderToMrkdwn(msg)).toBe('```\nline1\nline2\n```');
  });

  it('renders link segment as Slack mrkdwn <url|text>', () => {
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
    expect(renderToMrkdwn(msg)).toBe(
      '<https://github.com/org/repo/pull/42|PR #42>',
    );
  });

  it('renders link with empty href gracefully', () => {
    const msg = {
      title: null,
      body: [{ kind: 'link', value: 'click here', href: undefined }],
      severity: 'info',
    };
    expect(renderToMrkdwn(msg)).toBe('<|click here>');
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
    expect(renderToMrkdwn(msg)).toBe(
      '*Build failed*\nError: `ENOMEM` — see <https://example.com/logs|logs>',
    );
  });

  it('renders null title with no title line', () => {
    const msg = {
      title: null,
      body: [{ kind: 'bold', value: 'hi' }],
      severity: 'warning',
    };
    expect(renderToMrkdwn(msg)).toBe('*hi*');
  });

  it('renders empty body with title only', () => {
    const msg = { title: 'Heads up', body: [], severity: 'warning' };
    expect(renderToMrkdwn(msg)).toBe('*Heads up*\n');
  });
});

// ---------------------------------------------------------------------------
// createSlackAdapter
// ---------------------------------------------------------------------------

function makeOkResponse() {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve('ok'),
  });
}

function make429Response(retryAfter = null) {
  const headers = new Map();
  if (retryAfter !== null) headers.set('retry-after', String(retryAfter));
  return Promise.resolve({
    ok: false,
    status: 429,
    headers: { get: (k) => headers.get(k) ?? null },
    text: () => Promise.resolve(''),
  });
}

function makeErrorResponse(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve('error'),
  });
}

describe('createSlackAdapter shape', () => {
  it('has expected interface properties', () => {
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn: vi.fn(),
      _sleep: vi.fn(),
    });
    expect(adapter.name).toBe('slack');
    expect(adapter.supportsInbound).toBe(false);
    expect(typeof adapter.start).toBe('function');
    expect(typeof adapter.send).toBe('function');
    expect(typeof adapter.onInbound).toBe('function');
  });
});

describe('createSlackAdapter.send', () => {
  it('POSTs to webhookUrl with mrkdwn text', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn,
      _sleep: vi.fn(),
    });

    const msg = {
      title: 'Run complete',
      body: [{ kind: 'text', value: 'All tests passed.' }],
      severity: 'success',
    };
    await adapter.send('ignored', msg);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/T/B/x');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(init.body);
    expect(payload.text).toBe('*Run complete*\nAll tests passed.');
  });

  it('sets Content-Type application/json', async () => {
    const fetchFn = vi.fn(() => makeOkResponse());
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn,
      _sleep: vi.fn(),
    });
    await adapter.send('any', {
      title: null,
      body: [{ kind: 'text', value: 'hi' }],
      severity: 'info',
    });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('retries on 429 with Retry-After header', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => make429Response(2))
      .mockImplementationOnce(() => makeOkResponse());
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn,
      _sleep: sleep,
    });
    await adapter.send('any', {
      title: null,
      body: [{ kind: 'text', value: 'x' }],
      severity: 'info',
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries on 429 with backoff delay when Retry-After absent', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => make429Response())
      .mockImplementationOnce(() => makeOkResponse());
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn,
      _sleep: sleep,
    });
    await adapter.send('any', { title: null, body: [], severity: 'info' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('drops message after exhausting retries on persistent 429', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFn = vi.fn(() => make429Response());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn,
      _sleep: sleep,
    });
    await adapter.send('any', { title: null, body: [], severity: 'info' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dropped'));
    warnSpy.mockRestore();
  });

  it('warns but does not throw on non-429 HTTP error', async () => {
    const fetchFn = vi.fn(() => makeErrorResponse(500));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn,
      _sleep: vi.fn(),
    });
    await expect(
      adapter.send('any', { title: null, body: [], severity: 'info' }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('createSlackAdapter.start', () => {
  it('resolves immediately (no-op — outbound only)', async () => {
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn: vi.fn(),
      _sleep: vi.fn(),
    });
    await expect(adapter.start()).resolves.toBeUndefined();
  });
});

describe('createSlackAdapter.onInbound', () => {
  it('is a no-op function (outbound only)', () => {
    const adapter = createSlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      fetchFn: vi.fn(),
      _sleep: vi.fn(),
    });
    expect(() => adapter.onInbound(() => {})).not.toThrow();
  });
});
