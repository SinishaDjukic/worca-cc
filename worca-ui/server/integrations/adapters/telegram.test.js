import { describe, expect, it, vi } from 'vitest';
import { isValidAdapter } from '../adapter.js';
import { createTelegramAdapter, renderToHtml } from './telegram.js';

// ---------------------------------------------------------------------------
// renderToHtml
// ---------------------------------------------------------------------------

function msg(body, title = null, severity = 'info') {
  return { title, body, severity };
}

describe('renderToHtml — segment kinds', () => {
  it('text: plain passthrough', () => {
    expect(renderToHtml(msg([{ kind: 'text', value: 'hello' }]))).toBe('hello');
  });

  it('bold: wraps in <b>', () => {
    expect(renderToHtml(msg([{ kind: 'bold', value: 'strong' }]))).toBe(
      '<b>strong</b>',
    );
  });

  it('code: wraps in <code>', () => {
    expect(renderToHtml(msg([{ kind: 'code', value: 'run-abc' }]))).toBe(
      '<code>run-abc</code>',
    );
  });

  it('code_block: wraps in <pre>', () => {
    expect(renderToHtml(msg([{ kind: 'code_block', value: 'fn(){}' }]))).toBe(
      '<pre>fn(){}</pre>',
    );
  });

  it('link: wraps in <a href>', () => {
    expect(
      renderToHtml(
        msg([{ kind: 'link', value: 'click', href: 'https://example.com' }]),
      ),
    ).toBe('<a href="https://example.com">click</a>');
  });

  it('link: missing href defaults to empty string', () => {
    expect(renderToHtml(msg([{ kind: 'link', value: 'x' }]))).toBe(
      '<a href="">x</a>',
    );
  });
});

describe('renderToHtml — HTML escaping', () => {
  it('escapes < > & in text values', () => {
    expect(
      renderToHtml(msg([{ kind: 'text', value: '<b>test</b> & more' }])),
    ).toBe('&lt;b&gt;test&lt;/b&gt; &amp; more');
  });

  it('escapes < > & in bold values', () => {
    expect(renderToHtml(msg([{ kind: 'bold', value: '<script>' }]))).toBe(
      '<b>&lt;script&gt;</b>',
    );
  });

  it('escapes & in link href (query strings)', () => {
    expect(
      renderToHtml(
        msg([
          {
            kind: 'link',
            value: 'x',
            href: 'https://x.com/foo?a=1&b=2',
          },
        ]),
      ),
    ).toBe('<a href="https://x.com/foo?a=1&amp;b=2">x</a>');
  });

  it('escapes " in link href', () => {
    expect(renderToHtml(msg([{ kind: 'link', value: 'x', href: 'a"b' }]))).toBe(
      '<a href="a&quot;b">x</a>',
    );
  });

  it('escapes < in code values', () => {
    expect(renderToHtml(msg([{ kind: 'code', value: '<T>' }]))).toBe(
      '<code>&lt;T&gt;</code>',
    );
  });
});

describe('renderToHtml — title', () => {
  it('null title emits nothing before body', () => {
    expect(renderToHtml(msg([{ kind: 'text', value: 'body' }], null))).toBe(
      'body',
    );
  });

  it('non-null title is rendered as <b>title</b> followed by newline', () => {
    expect(renderToHtml(msg([], 'My Title'))).toBe('<b>My Title</b>\n');
  });

  it('title appears before body', () => {
    expect(renderToHtml(msg([{ kind: 'text', value: 'body' }], 'T'))).toBe(
      '<b>T</b>\nbody',
    );
  });

  it('title values are HTML-escaped', () => {
    expect(renderToHtml(msg([], '<evil>'))).toBe('<b>&lt;evil&gt;</b>\n');
  });
});

describe('renderToHtml — composition', () => {
  it('empty body returns empty string', () => {
    expect(renderToHtml(msg([]))).toBe('');
  });

  it('concatenates mixed segments without separator', () => {
    expect(
      renderToHtml(
        msg([
          { kind: 'bold', value: '✓' },
          { kind: 'text', value: ' ' },
          { kind: 'code', value: 'run-abc' },
          { kind: 'text', value: ' done' },
        ]),
      ),
    ).toBe('<b>✓</b> <code>run-abc</code> done');
  });

  it('renders a real renderEvent output (run completed) without raw HTML', () => {
    const html = renderToHtml({
      title: null,
      severity: 'success',
      body: [
        { kind: 'bold', value: '✓' },
        { kind: 'text', value: ' ' },
        { kind: 'code', value: 'run-xyz' },
        { kind: 'text', value: ' done · 1m00s · $1.23' },
      ],
    });
    expect(html).toBe('<b>✓</b> <code>run-xyz</code> done · 1m00s · $1.23');
    expect(html).not.toContain('<script');
  });
});

// ---------------------------------------------------------------------------
// createTelegramAdapter — interface
// ---------------------------------------------------------------------------

describe('createTelegramAdapter — interface', () => {
  it('returns a valid ChatAdapter', () => {
    const adapter = createTelegramAdapter({
      token: 'bot123',
      cursorPath: '/tmp/tg-test.cursor',
    });
    expect(isValidAdapter(adapter)).toBe(true);
  });

  it('name is "telegram"', () => {
    expect(
      createTelegramAdapter({ token: 'x', cursorPath: '/tmp/x' }).name,
    ).toBe('telegram');
  });

  it('supportsInbound is true', () => {
    expect(
      createTelegramAdapter({ token: 'x', cursorPath: '/tmp/x' })
        .supportsInbound,
    ).toBe(true);
  });

  it('onInbound registers a callback (no throw)', () => {
    const adapter = createTelegramAdapter({ token: 'x', cursorPath: '/tmp/x' });
    expect(() => adapter.onInbound(() => {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createTelegramAdapter — send()
// ---------------------------------------------------------------------------

describe('createTelegramAdapter — send()', () => {
  it('POSTs to /sendMessage with HTML parse_mode', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const adapter = createTelegramAdapter({
      token: 'mytoken',
      cursorPath: '/tmp/x',
      fetchFn: mockFetch,
    });
    await adapter.send('123', {
      title: null,
      body: [{ kind: 'text', value: 'hello' }],
      severity: 'info',
    });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('mytoken');
    expect(url).toContain('/sendMessage');
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('123');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toBe('hello');
  });

  it('sends rendered HTML for bold/code segments', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const adapter = createTelegramAdapter({
      token: 'tok',
      cursorPath: '/tmp/x',
      fetchFn: mockFetch,
    });
    await adapter.send('99', {
      title: null,
      body: [
        { kind: 'bold', value: '✓' },
        { kind: 'text', value: ' ' },
        { kind: 'code', value: 'run-abc' },
      ],
      severity: 'success',
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toBe('<b>✓</b> <code>run-abc</code>');
  });

  it('retries once on 429 and succeeds on second attempt', async () => {
    const sleepSpy = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1)
        return {
          ok: false,
          status: 429,
          json: async () => ({ parameters: { retry_after: 2 } }),
        };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const adapter = createTelegramAdapter({
      token: 'x',
      cursorPath: '/tmp/x',
      fetchFn: mockFetch,
      _sleep: sleepSpy,
    });
    await adapter.send('1', {
      title: null,
      body: [{ kind: 'text', value: 'x' }],
      severity: 'info',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(2000);
  });

  it('uses fallback delay when retry_after is absent', async () => {
    const sleepSpy = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1)
        return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const adapter = createTelegramAdapter({
      token: 'x',
      cursorPath: '/tmp/x',
      fetchFn: mockFetch,
      _sleep: sleepSpy,
    });
    await adapter.send('1', {
      title: null,
      body: [{ kind: 'text', value: 'x' }],
      severity: 'info',
    });
    expect(sleepSpy).toHaveBeenCalledWith(1000); // first fallback delay
  });

  it('drops message and warns after exhausting retries', async () => {
    const sleepSpy = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ parameters: { retry_after: 1 } }),
    });
    const adapter = createTelegramAdapter({
      token: 'x',
      cursorPath: '/tmp/x',
      fetchFn: mockFetch,
      _sleep: sleepSpy,
    });
    await adapter.send('1', {
      title: null,
      body: [{ kind: 'text', value: 'x' }],
      severity: 'info',
    });
    expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dropped'));
    warnSpy.mockRestore();
  });

  it('does not throw on non-429 error status', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createTelegramAdapter({
      token: 'x',
      cursorPath: '/tmp/x',
      fetchFn: mockFetch,
    });
    await expect(
      adapter.send('1', {
        title: null,
        body: [{ kind: 'text', value: 'x' }],
        severity: 'info',
      }),
    ).resolves.not.toThrow();
    warnSpy.mockRestore();
  });
});
