import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

function sign(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('POST /api/webhooks/inbox — strict verification', () => {
  let httpServer;
  let port;
  let app;
  const SECRET = 'test-secret-xyz';

  beforeEach(async () => {
    app = createApp({});
    app.locals.integrations = {
      onEvent: vi.fn(),
      status: () => ({ enabled: true }),
      strictInboxVerification: true,
      secrets: [SECRET],
    };
    httpServer = createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('returns 200 for valid signature when strictInboxVerification is true', async () => {
    const body = JSON.stringify({ event_type: 'run.completed', run_id: 'r1' });
    const res = await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'run.completed',
        'x-worca-signature': sign(body, SECRET),
      },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('control');
  });

  it('returns 401 for bad signature when strictInboxVerification is true', async () => {
    const body = JSON.stringify({ event_type: 'run.completed', run_id: 'r1' });
    const res = await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'run.completed',
        'x-worca-signature': 'sha256=badhash',
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('ok', false);
  });

  it('returns 401 for missing signature when strictInboxVerification is true', async () => {
    const body = JSON.stringify({ event_type: 'run.completed', run_id: 'r1' });
    const res = await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'run.completed',
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('ok', false);
  });
});
