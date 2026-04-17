import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { RAW_BODY } from './integrations/index.js';

describe('POST /api/webhooks/inbox — integrations wiring', () => {
  let httpServer;
  let port;
  let app;

  beforeEach(async () => {
    app = createApp({});
    httpServer = createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('returns 200 for unsigned POST when no integrations set (strict=off by default)', async () => {
    const res = await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'run.completed',
      },
      body: JSON.stringify({ event_type: 'run.completed', run_id: 'r1' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('control');
  });

  it('returns 200 for unsigned POST when integrations.strictInboxVerification is false', async () => {
    app.locals.integrations = {
      onEvent: vi.fn(),
      status: () => ({ enabled: true }),
      strictInboxVerification: false,
      secrets: [],
    };
    const res = await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'run.completed',
      },
      body: JSON.stringify({ event_type: 'run.completed', run_id: 'r1' }),
    });
    expect(res.status).toBe(200);
  });

  it('calls integrations.onEvent with the stored event after broadcast', async () => {
    const onEvent = vi.fn();
    app.locals.integrations = {
      onEvent,
      status: () => ({}),
      strictInboxVerification: false,
      secrets: [],
    };
    await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'run.completed',
      },
      body: JSON.stringify({ event_type: 'run.completed', run_id: 'r1' }),
    });
    expect(onEvent).toHaveBeenCalledOnce();
    const storedArg = onEvent.mock.calls[0][0];
    expect(storedArg).toHaveProperty('envelope.event_type', 'run.completed');
  });

  it('attaches raw body buffer to stored event via RAW_BODY symbol', async () => {
    const onEvent = vi.fn();
    app.locals.integrations = {
      onEvent,
      status: () => ({}),
      strictInboxVerification: false,
      secrets: [],
    };
    const payload = JSON.stringify({ event_type: 'run.failed', run_id: 'r2' });
    await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'run.failed',
      },
      body: payload,
    });
    expect(onEvent).toHaveBeenCalledOnce();
    const storedArg = onEvent.mock.calls[0][0];
    expect(storedArg[RAW_BODY]).toBeDefined();
    expect(storedArg[RAW_BODY].toString()).toBe(payload);
  });
});
