import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRestClient } from './rest_client.js';

describe('createRestClient', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an object with get and post methods', () => {
    const client = createRestClient({ host: '127.0.0.1', port: 3400 });
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
  });

  describe('get(path)', () => {
    it('fetches the correct URL', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ runs: [] }),
      });
      const client = createRestClient({ host: '127.0.0.1', port: 3400 });
      await client.get('/api/runs');
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3400/api/runs');
    });

    it('returns status and parsed JSON on success', async () => {
      const payload = { id: 'run-1' };
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      });
      const client = createRestClient({ host: '127.0.0.1', port: 3400 });
      const result = await client.get('/api/runs/run-1');
      expect(result).toEqual({ status: 200, data: payload });
    });

    it('returns status and null data on non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });
      const client = createRestClient({ host: '127.0.0.1', port: 3400 });
      const result = await client.get('/api/runs/missing');
      expect(result).toEqual({ status: 404, data: null });
    });

    it('uses the configured host and port', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      const client = createRestClient({ host: 'localhost', port: 3401 });
      await client.get('/api/status');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3401/api/status',
      );
    });
  });

  describe('post(path, body)', () => {
    it('sends POST with JSON body and correct headers', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
      const client = createRestClient({ host: '127.0.0.1', port: 3400 });
      await client.post('/api/runs/run-1/pause', { reason: 'test' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3400/api/runs/run-1/pause',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'test' }),
        },
      );
    });

    it('returns status and parsed JSON on success', async () => {
      const payload = { paused: true };
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      });
      const client = createRestClient({ host: '127.0.0.1', port: 3400 });
      const result = await client.post('/api/runs/run-1/pause', {});
      expect(result).toEqual({ status: 200, data: payload });
    });

    it('returns status and null data on non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      const client = createRestClient({ host: '127.0.0.1', port: 3400 });
      const result = await client.post('/api/runs/run-1/pause', {});
      expect(result).toEqual({ status: 500, data: null });
    });

    it('serializes null body as empty object', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      const client = createRestClient({ host: '127.0.0.1', port: 3400 });
      await client.post('/api/runs/run-1/stop', null);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3400/api/runs/run-1/stop',
        expect.objectContaining({ body: JSON.stringify({}) }),
      );
    });

    it('serializes undefined body as empty object', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      const client = createRestClient({ host: '127.0.0.1', port: 3400 });
      await client.post('/api/runs/run-1/stop');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3400/api/runs/run-1/stop',
        expect.objectContaining({ body: JSON.stringify({}) }),
      );
    });
  });
});
