import { describe, it, expect } from 'vitest';
import {
  MESSAGE_TYPES, nextId, makeRequest, makeOk, makeError,
  isMessageType, isRequest, decodeRequest
} from './protocol.js';

describe('protocol', () => {
  it('nextId returns unique sortable strings', () => {
    const a = nextId();
    const b = nextId();
    expect(typeof a).toBe('string');
    expect(a).not.toBe(b);
  });

  it('makeRequest creates valid envelope', () => {
    const req = makeRequest('list-runs', { filter: 'active' });
    expect(req.type).toBe('list-runs');
    expect(req.payload).toEqual({ filter: 'active' });
    expect(typeof req.id).toBe('string');
  });

  it('makeOk creates success reply', () => {
    const req = makeRequest('list-runs');
    const reply = makeOk(req, { runs: [] });
    expect(reply.ok).toBe(true);
    expect(reply.id).toBe(req.id);
    expect(reply.payload).toEqual({ runs: [] });
  });

  it('makeError creates error reply', () => {
    const req = makeRequest('list-runs');
    const reply = makeError(req, 'NOT_FOUND', 'Run not found');
    expect(reply.ok).toBe(false);
    expect(reply.error.code).toBe('NOT_FOUND');
  });

  it('isMessageType validates known types', () => {
    expect(isMessageType('list-runs')).toBe(true);
    expect(isMessageType('bogus')).toBe(false);
  });

  it('isRequest validates envelope shape', () => {
    expect(isRequest({ id: '1', type: 'list-runs' })).toBe(true);
    expect(isRequest({ id: '1' })).toBe(false);
    expect(isRequest(null)).toBe(false);
  });

  it('decodeRequest throws on invalid input', () => {
    expect(() => decodeRequest({})).toThrow();
  });
});
