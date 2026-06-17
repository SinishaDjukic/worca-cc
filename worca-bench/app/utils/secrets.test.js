// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSecret,
  launchSecrets,
  loadSecrets,
  SECRET_FIELDS,
  saveSecrets,
  secretStatus,
} from './secrets.js';

describe('secrets store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(loadSecrets()).toEqual({});
    expect(launchSecrets()).toBeUndefined();
    expect(secretStatus()).toEqual({
      SWEBENCH_API_KEY: false,
      MODAL_TOKEN_ID: false,
      MODAL_TOKEN_SECRET: false,
    });
  });

  it('saves + round-trips allowlisted secrets (trimmed)', () => {
    saveSecrets({ SWEBENCH_API_KEY: '  swb  ', MODAL_TOKEN_ID: 'mid' });
    expect(loadSecrets()).toEqual({
      SWEBENCH_API_KEY: 'swb',
      MODAL_TOKEN_ID: 'mid',
    });
    expect(launchSecrets()).toEqual({
      SWEBENCH_API_KEY: 'swb',
      MODAL_TOKEN_ID: 'mid',
    });
    expect(secretStatus().SWEBENCH_API_KEY).toBe(true);
    expect(secretStatus().MODAL_TOKEN_SECRET).toBe(false);
  });

  it('ignores unknown keys', () => {
    saveSecrets({ EVIL: 'x', SWEBENCH_API_KEY: 'ok' });
    expect(loadSecrets()).toEqual({ SWEBENCH_API_KEY: 'ok' });
  });

  it('a blank value in a patch clears that field; absent fields untouched', () => {
    saveSecrets({ SWEBENCH_API_KEY: 'a', MODAL_TOKEN_ID: 'b' });
    saveSecrets({ SWEBENCH_API_KEY: '   ' }); // clear one, leave the other
    expect(loadSecrets()).toEqual({ MODAL_TOKEN_ID: 'b' });
  });

  it('clearSecret removes a single field', () => {
    saveSecrets({ SWEBENCH_API_KEY: 'a', MODAL_TOKEN_ID: 'b' });
    clearSecret('SWEBENCH_API_KEY');
    expect(loadSecrets()).toEqual({ MODAL_TOKEN_ID: 'b' });
    clearSecret('NOT_A_KEY'); // no-op, no throw
    expect(loadSecrets()).toEqual({ MODAL_TOKEN_ID: 'b' });
  });

  it('survives a corrupt store', () => {
    localStorage.setItem('worca-bench:secrets', '{not json');
    expect(loadSecrets()).toEqual({});
    expect(() => saveSecrets({ SWEBENCH_API_KEY: 'x' })).not.toThrow();
  });

  it('exposes the three grader fields in lockstep with the server allowlist', () => {
    expect(SECRET_FIELDS.map((f) => f.key)).toEqual([
      'SWEBENCH_API_KEY',
      'MODAL_TOKEN_ID',
      'MODAL_TOKEN_SECRET',
    ]);
  });
});
