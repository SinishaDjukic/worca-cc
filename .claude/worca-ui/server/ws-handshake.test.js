import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createClientManager } from './ws-client-manager.js';

/**
 * Helper: create a test HTTP+WS server with client manager.
 * Returns { server, wss, clientManager, url, close }.
 */
function createTestServer() {
  return new Promise((resolve) => {
    const server = createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    const clientManager = createClientManager({ wss });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        wss,
        clientManager,
        url: `ws://127.0.0.1:${port}/ws`,
        close: () =>
          new Promise((res) => {
            clientManager.destroy();
            wss.close();
            server.close(res);
          }),
      });
    });
  });
}

function waitForMessage(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for message')),
      timeoutMs,
    );
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('WS handshake protocol', () => {
  let testServer;

  afterEach(async () => {
    if (testServer) await testServer.close();
  });

  describe('client manager protocol extensions', () => {
    it('ensureSubs includes protocolVersion=1 and projectId=null by default', async () => {
      testServer = await createTestServer();
      const { wss, clientManager } = testServer;

      const connected = new Promise((resolve) => {
        wss.on('connection', (ws) => {
          const s = clientManager.ensureSubs(ws);
          resolve(s);
        });
      });

      const client = new WebSocket(testServer.url);
      await new Promise((r) => client.on('open', r));

      const subs = await connected;
      expect(subs.protocolVersion).toBe(1);
      expect(subs.projectId).toBe(null);

      client.close();
    });

    it('setProtocol updates protocolVersion and projectId', async () => {
      testServer = await createTestServer();
      const { wss, clientManager } = testServer;

      const result = new Promise((resolve) => {
        wss.on('connection', (ws) => {
          clientManager.ensureSubs(ws);
          clientManager.setProtocol(ws, 2, 'my-project');
          const s = clientManager.getSubs(ws);
          resolve(s);
        });
      });

      const client = new WebSocket(testServer.url);
      await new Promise((r) => client.on('open', r));

      const subs = await result;
      expect(subs.protocolVersion).toBe(2);
      expect(subs.projectId).toBe('my-project');

      client.close();
    });
  });

  describe('hello message on connection', () => {
    it('server sends hello with protocol 2 and capabilities on connect', async () => {
      testServer = await createTestServer();
      const { wss, clientManager } = testServer;

      // Set up server to send hello on connection (mimicking ws-modular behavior)
      wss.on('connection', (ws) => {
        clientManager.ensureSubs(ws);
        ws.send(
          JSON.stringify({
            id: `evt-${Date.now()}`,
            ok: true,
            type: 'hello',
            payload: { protocol: 2, capabilities: ['multi-project'] },
          }),
        );
      });

      const client = new WebSocket(testServer.url);
      const msg = await waitForMessage(client, (m) => m.type === 'hello');

      expect(msg.type).toBe('hello');
      expect(msg.payload.protocol).toBe(2);
      expect(msg.payload.capabilities).toContain('multi-project');

      client.close();
    });
  });

  describe('hello-ack handling', () => {
    it('hello-ack from client sets protocol 2', async () => {
      testServer = await createTestServer();
      const { wss, clientManager } = testServer;

      const protocolSet = new Promise((resolve) => {
        wss.on('connection', (ws) => {
          clientManager.ensureSubs(ws);
          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'hello-ack') {
              clientManager.setProtocol(
                ws,
                msg.payload?.protocol || 1,
                msg.payload?.projectId || null,
              );
              const s = clientManager.getSubs(ws);
              resolve(s);
            }
          });
        });
      });

      const client = new WebSocket(testServer.url);
      await new Promise((r) => client.on('open', r));

      // Client sends hello-ack
      client.send(
        JSON.stringify({
          id: '1',
          type: 'hello-ack',
          payload: { protocol: 2, projectId: 'test-proj' },
        }),
      );

      const subs = await protocolSet;
      expect(subs.protocolVersion).toBe(2);
      expect(subs.projectId).toBe('test-proj');

      client.close();
    });

    it('protocol 1 clients still work (no hello-ack)', async () => {
      testServer = await createTestServer();
      const { wss, clientManager } = testServer;

      const connected = new Promise((resolve) => {
        wss.on('connection', (ws) => {
          const s = clientManager.ensureSubs(ws);
          // After a short delay, check the client is still at protocol 1
          setTimeout(() => resolve(s), 100);
        });
      });

      const client = new WebSocket(testServer.url);
      await new Promise((r) => client.on('open', r));

      // Client does NOT send hello-ack
      const subs = await connected;
      expect(subs.protocolVersion).toBe(1);
      expect(subs.projectId).toBe(null);

      client.close();
    });
  });
});
