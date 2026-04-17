import { describe, expect, it } from 'vitest';
import { validateIntegrationsConfig } from '../settings-validator.js';

describe('validateIntegrationsConfig — top-level', () => {
  it('accepts minimal valid config', () => {
    expect(validateIntegrationsConfig({ schema_version: 1 }).valid).toBe(true);
  });

  it('rejects missing schema_version', () => {
    const r = validateIntegrationsConfig({ enabled: true });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(expect.stringContaining('schema_version'));
  });

  it('rejects schema_version != 1', () => {
    const r = validateIntegrationsConfig({ schema_version: 2 });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(expect.stringContaining('schema_version'));
  });

  it('rejects non-integer schema_version', () => {
    const r = validateIntegrationsConfig({ schema_version: '1' });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(expect.stringContaining('schema_version'));
  });

  it('rejects non-boolean enabled', () => {
    const r = validateIntegrationsConfig({ schema_version: 1, enabled: 'yes' });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(expect.stringContaining('enabled'));
  });

  it('accepts enabled: false', () => {
    expect(
      validateIntegrationsConfig({ schema_version: 1, enabled: false }).valid,
    ).toBe(true);
  });

  it('rejects non-string webhook_secret_env', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_secret_env: 123,
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('webhook_secret_env'),
    );
  });

  it('rejects empty webhook_secret_env', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_secret_env: '',
    });
    expect(r.valid).toBe(false);
  });

  it('accepts valid webhook_secret_env', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        webhook_secret_env: 'WORCA_WEBHOOK_SECRET',
      }).valid,
    ).toBe(true);
  });

  it('accepts valid webhook_secrets_env', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        webhook_secrets_env: 'WORCA_WEBHOOK_SECRETS',
      }).valid,
    ).toBe(true);
  });

  it('rejects non-boolean strict_inbox_verification', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      strict_inbox_verification: 1,
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('strict_inbox_verification'),
    );
  });

  it('accepts strict_inbox_verification: true', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        strict_inbox_verification: true,
      }).valid,
    ).toBe(true);
  });
});

describe('validateIntegrationsConfig — telegram', () => {
  it('rejects non-object telegram', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      telegram: 'yes',
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(expect.stringContaining('telegram'));
  });

  it('rejects missing bot_token_env', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      telegram: { enabled: true, chat_id: '123', events: [] },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('telegram.bot_token_env'),
    );
  });

  it('rejects empty bot_token_env', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      telegram: { bot_token_env: '', chat_id: '123', events: [] },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects missing chat_id', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      telegram: { bot_token_env: 'TG_TOKEN', events: [] },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('telegram.chat_id'),
    );
  });

  it('accepts numeric chat_id', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        telegram: {
          bot_token_env: 'TG_TOKEN',
          chat_id: 123456,
          events: ['pipeline.run.completed'],
        },
      }).valid,
    ).toBe(true);
  });

  it('rejects non-array events', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      telegram: { bot_token_env: 'TG_TOKEN', chat_id: '123', events: 'all' },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('telegram.events'),
    );
  });

  it('rejects empty string in events array', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      telegram: { bot_token_env: 'TG_TOKEN', chat_id: '123', events: [''] },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects non-integer rate_limit_per_min', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      telegram: {
        bot_token_env: 'TG_TOKEN',
        chat_id: '123',
        events: [],
        rate_limit_per_min: 1.5,
      },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('telegram.rate_limit_per_min'),
    );
  });

  it('rejects zero rate_limit_per_min', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      telegram: {
        bot_token_env: 'TG_TOKEN',
        chat_id: '123',
        events: [],
        rate_limit_per_min: 0,
      },
    });
    expect(r.valid).toBe(false);
  });

  it('accepts valid full telegram config', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        telegram: {
          enabled: true,
          bot_token_env: 'TELEGRAM_BOT_TOKEN',
          chat_id: '123456789',
          rate_limit_per_min: 20,
          events: ['pipeline.run.completed', 'pipeline.run.failed'],
        },
      }).valid,
    ).toBe(true);
  });
});

describe('validateIntegrationsConfig — discord', () => {
  it('rejects non-object discord', () => {
    const r = validateIntegrationsConfig({ schema_version: 1, discord: [] });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(expect.stringContaining('discord'));
  });

  it('rejects missing bot_token_env', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      discord: { channel_id: '999', events: [] },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('discord.bot_token_env'),
    );
  });

  it('rejects missing channel_id', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      discord: { bot_token_env: 'DC_TOKEN', events: [] },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('discord.channel_id'),
    );
  });

  it('accepts valid discord config', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        discord: {
          enabled: false,
          bot_token_env: 'DISCORD_BOT_TOKEN',
          channel_id: '123456',
          events: ['pipeline.run.completed'],
        },
      }).valid,
    ).toBe(true);
  });
});

describe('validateIntegrationsConfig — slack', () => {
  it('rejects non-object slack', () => {
    const r = validateIntegrationsConfig({ schema_version: 1, slack: 'url' });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(expect.stringContaining('slack'));
  });

  it('rejects missing webhook_url_env', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      slack: { events: [] },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('slack.webhook_url_env'),
    );
  });

  it('accepts valid slack config', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        slack: {
          enabled: false,
          webhook_url_env: 'SLACK_WEBHOOK_URL',
          events: ['pipeline.run.completed'],
        },
      }).valid,
    ).toBe(true);
  });
});

describe('validateIntegrationsConfig — webhook_out', () => {
  it('rejects non-object webhook_out', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_out: 'yes',
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(expect.stringContaining('webhook_out'));
  });

  it('rejects non-array endpoints', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_out: { enabled: true, endpoints: {} },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('webhook_out.endpoints'),
    );
  });

  it('rejects endpoint missing url', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_out: {
        enabled: true,
        endpoints: [{ name: 'test', format: 'plain-text', events: [] }],
      },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('webhook_out.endpoints[0].url'),
    );
  });

  it('rejects endpoint with invalid URL', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_out: {
        endpoints: [
          { name: 'x', url: 'not-a-url', format: 'plain-text', events: [] },
        ],
      },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects endpoint url with non-http protocol', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_out: {
        endpoints: [
          {
            name: 'x',
            url: 'ftp://example.com',
            format: 'plain-text',
            events: [],
          },
        ],
      },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects invalid format', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_out: {
        endpoints: [
          {
            name: 'x',
            url: 'https://example.com/hook',
            format: 'unknown-format',
            events: [],
          },
        ],
      },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('webhook_out.endpoints[0].format'),
    );
  });

  it('rejects non-object headers', () => {
    const r = validateIntegrationsConfig({
      schema_version: 1,
      webhook_out: {
        endpoints: [
          {
            name: 'x',
            url: 'https://example.com/hook',
            format: 'plain-text',
            headers: 'bad',
            events: [],
          },
        ],
      },
    });
    expect(r.valid).toBe(false);
    expect(r.details).toContainEqual(
      expect.stringContaining('webhook_out.endpoints[0].headers'),
    );
  });

  it('accepts valid webhook_out config', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        webhook_out: {
          enabled: false,
          endpoints: [
            {
              name: 'teams-dev',
              url: 'https://example.com/hook',
              format: 'teams-card',
              headers: { Authorization: 'Bearer token' },
              events: ['pipeline.run.completed'],
            },
          ],
        },
      }).valid,
    ).toBe(true);
  });

  it('accepts webhook_out with no endpoints', () => {
    expect(
      validateIntegrationsConfig({
        schema_version: 1,
        webhook_out: { enabled: false, endpoints: [] },
      }).valid,
    ).toBe(true);
  });
});
