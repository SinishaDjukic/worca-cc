import { describe, expect, it } from 'vitest';
import {
  ADAPTER_INTERFACE_KEYS,
  isValidAdapter,
  isValidIncoming,
  isValidMessage,
  isValidSegment,
  MESSAGE_SEGMENT_KINDS,
  SEVERITY_LEVELS,
} from './adapter.js';

describe('adapter typedefs', () => {
  it('exports MessageSegment kind constants', () => {
    expect(MESSAGE_SEGMENT_KINDS).toEqual([
      'text',
      'bold',
      'code',
      'code_block',
      'link',
    ]);
  });

  it('exports NormalizedMessage severity constants', () => {
    expect(SEVERITY_LEVELS).toEqual(['info', 'success', 'warning', 'error']);
  });

  it('exports ChatAdapter interface keys', () => {
    expect(ADAPTER_INTERFACE_KEYS).toEqual([
      'name',
      'supportsInbound',
      'start',
      'send',
      'onInbound',
    ]);
  });

  it('validates a well-formed MessageSegment', () => {
    expect(isValidSegment({ kind: 'text', value: 'hello' })).toBe(true);
    expect(
      isValidSegment({ kind: 'link', value: 'click', href: 'https://x.com' }),
    ).toBe(true);
    expect(isValidSegment({ kind: 'bold', value: 'strong' })).toBe(true);
    expect(isValidSegment({ kind: 'code', value: 'x' })).toBe(true);
    expect(isValidSegment({ kind: 'code_block', value: 'fn(){}' })).toBe(true);
    expect(isValidSegment({ kind: 'unknown', value: 'x' })).toBe(false);
    expect(isValidSegment({ kind: 'text' })).toBe(false);
    expect(isValidSegment(null)).toBe(false);
  });

  it('validates a well-formed NormalizedMessage', () => {
    const msg = {
      title: 'Run done',
      body: [{ kind: 'text', value: 'completed' }],
      severity: 'success',
    };
    expect(isValidMessage(msg)).toBe(true);
    expect(isValidMessage({ ...msg, title: null })).toBe(true);
    expect(isValidMessage({ ...msg, severity: 'critical' })).toBe(false);
    expect(isValidMessage({ ...msg, body: 'not an array' })).toBe(false);
    expect(
      isValidMessage({ ...msg, body: [{ kind: 'bad', value: 'x' }] }),
    ).toBe(false);
  });

  it('validates a well-formed IncomingMessage', () => {
    const inc = {
      platform: 'telegram',
      chatId: '123',
      userId: 'u1',
      text: '/status',
      raw: {},
    };
    expect(isValidIncoming(inc)).toBe(true);
    expect(isValidIncoming({ ...inc, chatId: undefined })).toBe(false);
    expect(isValidIncoming({ ...inc, platform: undefined })).toBe(false);
    expect(isValidIncoming({ ...inc, text: undefined })).toBe(false);
    expect(isValidIncoming(null)).toBe(false);
  });

  it('validates a well-formed ChatAdapter object', () => {
    const adapter = {
      name: 'test',
      supportsInbound: false,
      start: async () => {},
      send: async () => {},
      onInbound: () => {},
    };
    expect(isValidAdapter(adapter)).toBe(true);
    expect(isValidAdapter({ ...adapter, send: 'not a function' })).toBe(false);
    expect(isValidAdapter({ ...adapter, name: undefined })).toBe(false);
    expect(isValidAdapter({ ...adapter, supportsInbound: 'yes' })).toBe(false);
    expect(isValidAdapter(null)).toBe(false);
  });
});
