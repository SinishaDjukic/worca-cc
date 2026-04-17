import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

function sign(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('PUT /api/webhooks/inbox/control — strict verification', () => {
  let httpServer;
  let port;
  let app;
  const SECRET = 'ctrl-secret-abc';

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

  it('returns 200 for valid signature on PUT /control', async () => {
    const body = JSON.stringify({ action: 'continue' });
    const res = await fetch(
      `http://localhost:${port}/api/webhooks/inbox/control`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-worca-event': 'control',
          'x-worca-signature': sign(body, SECRET),
        },
        body,
      },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('ok', true);
  });

  it('returns 401 for bad signature on PUT /control', async () => {
    const body = JSON.stringify({ action: 'pause' });
    const res = await fetch(
      `http://localhost:${port}/api/webhooks/inbox/control`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-worca-event': 'control',
          'x-worca-signature': 'sha256=wronghash',
        },
        body,
      },
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('ok', false);
  });

  it('returns 401 for missing signature on PUT /control', async () => {
    const body = JSON.stringify({ action: 'abort' });
    const res = await fetch(
      `http://localhost:${port}/api/webhooks/inbox/control`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-worca-event': 'control',
        },
        body,
      },
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('ok', false);
  });
});
