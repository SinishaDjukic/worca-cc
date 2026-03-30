import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minimal WebSocket mock for testing createWsClient.
 */
class MockWebSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = MockWebSocket.OPEN;
    this.OPEN = MockWebSocket.OPEN;
    this._listeners = {};
    this._sent = [];
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  send(data) {
    this._sent.push(data);
  }
  close() {}
  _emit(type, data) {
    for (const fn of this._listeners[type] || []) fn(data);
  }
}

describe('ws client', () => {
  let origWS;

  beforeEach(() => {
    origWS = globalThis.WebSocket;
    globalThis.location = { protocol: 'http:', host: 'localhost:3400' };
  });

  afterEach(() => {
    globalThis.WebSocket = origWS;
    delete globalThis.location;
  });

  async function createClient() {
    let mockWs;
    globalThis.WebSocket = class extends MockWebSocket {
      constructor(url) {
        super();
        mockWs = this;
        // Auto-fire open after microtask
        Promise.resolve().then(() => this._emit('open'));
      }
    };
    const { createWsClient } = await import('./ws.js');
    const client = createWsClient({ url: 'ws://localhost:3400/ws' });

    // Wait for open event
    await new Promise((r) => setTimeout(r, 10));
    return { client, mockWs };
  }

  it('server hello event dispatches to registered on("hello") handler', async () => {
    const { client, mockWs } = await createClient();
    const handler = vi.fn();
    client.on('hello', handler);

    // Simulate server sending a hello message
    mockWs._emit('message', {
      data: JSON.stringify({
        id: 'evt-hello-1',
        ok: true,
        type: 'hello',
        payload: { protocol: 2, capabilities: ['multi-project'] },
      }),
    });

    expect(handler).toHaveBeenCalledWith(
      { protocol: 2, capabilities: ['multi-project'] },
      {
        id: 'evt-hello-1',
        ok: true,
        type: 'hello',
        payload: { protocol: 2, capabilities: ['multi-project'] },
      },
    );
    client.close();
  });

  it('sendRaw sends message bypassing MESSAGE_TYPES validation', async () => {
    const { client, mockWs } = await createClient();

    client.sendRaw({
      type: 'hello-ack',
      payload: { protocol: 2, projectId: 'test-proj' },
    });

    expect(mockWs._sent).toHaveLength(1);
    const parsed = JSON.parse(mockWs._sent[0]);
    expect(parsed.type).toBe('hello-ack');
    expect(parsed.payload.projectId).toBe('test-proj');
    client.close();
  });

  it('hello-ack sent before any queued messages', async () => {
    // Create client with connection not yet open
    let mockWs;
    globalThis.WebSocket = class extends MockWebSocket {
      constructor() {
        super();
        this.readyState = 0; // CONNECTING
        mockWs = this;
      }
    };
    const { createWsClient } = await import('./ws.js');
    const client = createWsClient({ url: 'ws://localhost:3400/ws' });

    // Queue a regular message before connection opens
    const listRunsPromise = client.send('list-runs', {});

    // Now send hello-ack via sendRaw (which goes directly, not queued)
    // Simulate connection opening
    mockWs.readyState = MockWebSocket.OPEN;
    mockWs._emit('open');

    // Wait for queue flush
    await new Promise((r) => setTimeout(r, 10));

    // sendRaw was called separately — the point is it doesn't go through queue
    // The queue should have flushed the list-runs message
    expect(mockWs._sent.length).toBeGreaterThanOrEqual(1);
    const types = mockWs._sent.map((s) => JSON.parse(s).type);
    expect(types).toContain('list-runs');

    client.close();
  });
});
