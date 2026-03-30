import { describe, expect, it } from 'vitest';
import { parseArgs } from './worca-ui.js';

describe('parseArgs', () => {
  it('sets global flag when --global is passed', () => {
    const result = parseArgs(['node', 'script', 'start', '--global']);
    expect(result.command).toBe('start');
    expect(result.global).toBe(true);
  });

  it('defaults global to false', () => {
    const result = parseArgs(['node', 'script', 'start']);
    expect(result.command).toBe('start');
    expect(result.global).toBe(false);
  });

  it('parses projects list', () => {
    const result = parseArgs(['node', 'script', 'projects', 'list']);
    expect(result.command).toBe('projects');
    expect(result.subAction).toBe('list');
  });

  it('parses projects add with path', () => {
    const result = parseArgs([
      'node',
      'script',
      'projects',
      'add',
      '/tmp/proj',
    ]);
    expect(result.command).toBe('projects');
    expect(result.subAction).toBe('add');
    expect(result.projectPath).toBe('/tmp/proj');
  });

  it('parses projects remove with name', () => {
    const result = parseArgs([
      'node',
      'script',
      'projects',
      'remove',
      'my-proj',
    ]);
    expect(result.command).toBe('projects');
    expect(result.subAction).toBe('remove');
    expect(result.projectPath).toBe('my-proj');
  });

  it('parses migrate --scan with --dry-run', () => {
    const result = parseArgs([
      'node',
      'script',
      'migrate',
      '--scan',
      '/tmp/dir',
      '--dry-run',
    ]);
    expect(result.command).toBe('migrate');
    expect(result.scanDir).toBe('/tmp/dir');
    expect(result.dryRun).toBe(true);
  });

  it('parses migrate --status', () => {
    const result = parseArgs(['node', 'script', 'migrate', '--status']);
    expect(result.command).toBe('migrate');
    expect(result.migrateStatus).toBe(true);
  });

  it('parses migrate --add with path', () => {
    const result = parseArgs(['node', 'script', 'migrate', '--add', '/path']);
    expect(result.command).toBe('migrate');
    expect(result.migrateAdd).toBe('/path');
  });

  it('overrides port and host', () => {
    const result = parseArgs([
      'node',
      'script',
      '--port',
      '3500',
      '--host',
      '0.0.0.0',
    ]);
    expect(result.port).toBe(3500);
    expect(result.host).toBe('0.0.0.0');
  });

  it('preserves --open flag', () => {
    const result = parseArgs(['node', 'script', 'start', '--open']);
    expect(result.open).toBe(true);
  });

  it('parses --name for projects add', () => {
    const result = parseArgs([
      'node',
      'script',
      'projects',
      'add',
      '/tmp/proj',
      '--name',
      'my-slug',
    ]);
    expect(result.command).toBe('projects');
    expect(result.subAction).toBe('add');
    expect(result.projectPath).toBe('/tmp/proj');
    expect(result.projectName).toBe('my-slug');
  });
});
