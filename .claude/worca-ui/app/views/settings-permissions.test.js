import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readPermissionsFromDom } from './settings.js';

describe('readPermissionsFromDom', () => {
  let origDocument;

  beforeEach(() => {
    origDocument = globalThis.document;
    globalThis.document = {
      querySelectorAll: () => [],
      getElementById: () => null,
    };
  });

  afterEach(() => {
    globalThis.document = origDocument;
  });

  it('reads permission values from .perm-input elements', () => {
    globalThis.document.querySelectorAll = () => [
      { value: 'Bash(pytest *)' },
      { value: 'Read(*)' },
    ];

    const result = readPermissionsFromDom();
    expect(result).toEqual(['Bash(pytest *)', 'Read(*)']);
  });

  it('filters out empty/whitespace-only values', () => {
    globalThis.document.querySelectorAll = () => [
      { value: 'Bash(pytest *)' },
      { value: '' },
      { value: '   ' },
      { value: 'Read(*)' },
    ];

    const result = readPermissionsFromDom();
    expect(result).toEqual(['Bash(pytest *)', 'Read(*)']);
  });

  it('returns empty array when no inputs exist', () => {
    globalThis.document.querySelectorAll = () => [];

    const result = readPermissionsFromDom();
    expect(result).toEqual([]);
  });

  it('trims whitespace from values', () => {
    globalThis.document.querySelectorAll = () => [
      { value: '  Bash(pytest *)  ' },
    ];

    const result = readPermissionsFromDom();
    expect(result).toEqual(['Bash(pytest *)']);
  });
});
