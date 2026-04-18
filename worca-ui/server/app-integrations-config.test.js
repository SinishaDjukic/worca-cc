import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('Integrations config endpoints', () => {
  let httpServer;
  let port;
  let prefsDir;

  beforeEach(async () => {
    prefsDir = join(
      tmpdir(),
      `worca-ig-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(prefsDir, { recursive: true });
    const app = createApp({ prefsDir });
    httpServer = createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    rmSync(prefsDir, { recursive: true, force: true });
  });

  const url = (path) => `http://localhost:${port}${path}`;
  const post = (adapter, token, chatId, events) =>
    fetch(url('/api/integrations/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter, token, chatId, events }),
    });
  const readCfg = () =>
    JSON.parse(
      readFileSync(join(prefsDir, 'integrations', 'config.json'), 'utf8'),
    );

  // ── GET /api/integrations/config ────────────────────────────────────

  describe('GET /api/integrations/config', () => {
    it('returns empty object when no config file exists', async () => {
      const res = await fetch(url('/api/integrations/config'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
    });

    it('returns existing config', async () => {
      const configDir = join(prefsDir, 'integrations');
      mkdirSync(configDir, { recursive: true });
      const cfg = {
        schema_version: 1,
        enabled: true,
        telegram: {
          enabled: true,
          bot_token_env: 'TELEGRAM_BOT_TOKEN',
          chat_id: '999',
          events: ['pipeline.run.completed'],
        },
      };
      writeFileSync(join(configDir, 'config.json'), JSON.stringify(cfg));

      const res = await fetch(url('/api/integrations/config'));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.telegram.bot_token_env).toBe('TELEGRAM_BOT_TOKEN');
      expect(json.telegram.chat_id).toBe('999');
    });
  });

  // ── POST /api/integrations/config ───────────────────────────────────

  describe('POST /api/integrations/config', () => {
    it('stores telegram bot_token directly in config', async () => {
      const res = await post('telegram', 'tg-token-123', '12345', [
        'pipeline.run.completed',
      ]);
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);

      const cfg = readCfg();
      expect(cfg.telegram.bot_token).toBe('tg-token-123');
      expect(cfg.telegram.chat_id).toBe('12345');
      expect(cfg.telegram.enabled).toBe(true);
      expect(cfg.enabled).toBe(true);
    });

    it('stores discord bot_token directly in config', async () => {
      const res = await post('discord', 'dc-token-456', 'ch123', [
        'pipeline.run.failed',
      ]);
      expect(res.status).toBe(200);

      const cfg = readCfg();
      expect(cfg.discord.bot_token).toBe('dc-token-456');
      expect(cfg.discord.channel_id).toBe('ch123');
    });

    it('stores slack webhook_url directly in config', async () => {
      const res = await post('slack', 'https://hooks.slack.com/xxx', 'C999', [
        'pipeline.run.completed',
      ]);
      expect(res.status).toBe(200);

      const cfg = readCfg();
      expect(cfg.slack.webhook_url).toBe('https://hooks.slack.com/xxx');
      expect(cfg.slack.chat_id).toBe('C999');
    });

    it('preserves existing adapters when adding another', async () => {
      await post('telegram', 'tg-tok', '111', ['pipeline.run.completed']);
      await post('discord', 'dc-tok', '222', ['pipeline.run.failed']);

      const cfg = readCfg();
      expect(cfg.telegram.bot_token).toBe('tg-tok');
      expect(cfg.discord.bot_token).toBe('dc-tok');
    });

    it('rejects missing required fields', async () => {
      const res = await fetch(url('/api/integrations/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter: 'telegram' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid adapter', async () => {
      const res = await post('whatsapp', 'tok', '1', [
        'pipeline.run.completed',
      ]);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Invalid adapter/);
    });
  });

  // ── DELETE /api/integrations/config/:adapter ────────────────────────

  describe('DELETE /api/integrations/config/:adapter', () => {
    it('removes an adapter from config', async () => {
      await post('telegram', 'tok', '111', ['pipeline.run.completed']);

      const res = await fetch(url('/api/integrations/config/telegram'), {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);

      const cfg = readCfg();
      expect(cfg.telegram).toBeUndefined();
    });

    it('sets enabled=false when last adapter is removed', async () => {
      await post('telegram', 'tok', '111', ['pipeline.run.completed']);
      await fetch(url('/api/integrations/config/telegram'), {
        method: 'DELETE',
      });

      const cfg = readCfg();
      expect(cfg.enabled).toBe(false);
    });

    it('keeps enabled=true when other adapters remain', async () => {
      await post('telegram', 'tok1', '1', ['pipeline.run.completed']);
      await post('discord', 'tok2', '2', ['pipeline.run.completed']);

      await fetch(url('/api/integrations/config/telegram'), {
        method: 'DELETE',
      });

      const cfg = readCfg();
      expect(cfg.enabled).toBe(true);
      expect(cfg.discord).toBeDefined();
      expect(cfg.telegram).toBeUndefined();
    });

    it('succeeds silently when no config file exists', async () => {
      const res = await fetch(url('/api/integrations/config/telegram'), {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
    });

    it('rejects invalid adapter', async () => {
      const res = await fetch(url('/api/integrations/config/whatsapp'), {
        method: 'DELETE',
      });
      expect(res.status).toBe(400);
    });
  });
});
