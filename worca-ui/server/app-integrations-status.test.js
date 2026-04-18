import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

describe('GET /api/integrations/status', () => {
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

  it('returns {enabled:false} when no integrations are set', async () => {
    const res = await fetch(`http://localhost:${port}/api/integrations/status`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ enabled: false });
  });

  it('returns integrations.status() result when integrations are set', async () => {
    const statusResult = {
      enabled: true,
      strict_inbox_verification: false,
      secrets_configured: 1,
      adapters: [
        {
          name: 'telegram',
          enabled: true,
          persistent: true,
          connection: 'connected',
          connection_error: null,
          dropped_messages: 0,
          invalid_signature_events: 0,
          last_event_at: null,
        },
      ],
      chats: [],
    };
    app.locals.integrations = {
      onEvent: vi.fn(),
      status: () => statusResult,
      strictInboxVerification: false,
      secrets: ['s'],
    };
    const res = await fetch(`http://localhost:${port}/api/integrations/status`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject(statusResult);
  });

  it('calls status() on the integrations instance', async () => {
    const statusFn = vi
      .fn()
      .mockReturnValue({ enabled: true, adapters: [], chats: [] });
    app.locals.integrations = {
      onEvent: vi.fn(),
      status: statusFn,
      strictInboxVerification: false,
      secrets: [],
    };
    await fetch(`http://localhost:${port}/api/integrations/status`);
    expect(statusFn).toHaveBeenCalledOnce();
  });
});
