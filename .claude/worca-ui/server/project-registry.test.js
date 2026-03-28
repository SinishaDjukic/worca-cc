import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMaxProjects,
  readProjects,
  removeProject,
  slugify,
  synthesizeDefaultProject,
  validateProjectEntry,
  writeProject,
} from './project-registry.js';

describe('project-registry', () => {
  let prefsDir;

  beforeEach(() => {
    prefsDir = join(
      tmpdir(),
      `worca-prefs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(prefsDir, { recursive: true });
  });

  afterEach(() => rmSync(prefsDir, { recursive: true, force: true }));

  // --- slugify ---

  describe('slugify', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      expect(slugify('My Project')).toBe('my-project');
    });

    it('replaces non-alphanumeric chars with hyphens', () => {
      expect(slugify('hello@world!')).toBe('hello-world-');
    });

    it('collapses consecutive hyphens', () => {
      expect(slugify('a---b')).toBe('a-b');
    });

    it('truncates to 64 characters', () => {
      const long = 'a'.repeat(100);
      expect(slugify(long).length).toBe(64);
    });

    it('handles empty string', () => {
      expect(slugify('')).toBe('');
    });

    it('preserves underscores', () => {
      expect(slugify('my_project')).toBe('my_project');
    });

    it('handles already-valid slugs', () => {
      expect(slugify('my-project-123')).toBe('my-project-123');
    });
  });

  // --- validateProjectEntry ---

  describe('validateProjectEntry', () => {
    it('accepts valid entry', () => {
      const result = validateProjectEntry({
        name: 'my-project',
        path: '/home/user/project',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects missing name', () => {
      const result = validateProjectEntry({ path: '/home/user/project' });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/name/i);
    });

    it('rejects invalid name characters', () => {
      const result = validateProjectEntry({
        name: 'my project!',
        path: '/home/user/project',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects name longer than 64 chars', () => {
      const result = validateProjectEntry({
        name: 'a'.repeat(65),
        path: '/abs',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects missing path', () => {
      const result = validateProjectEntry({ name: 'my-project' });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/path/i);
    });

    it('rejects relative path', () => {
      const result = validateProjectEntry({
        name: 'my-project',
        path: 'relative/path',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/absolute/i);
    });
  });

  // --- readProjects ---

  describe('readProjects', () => {
    it('returns empty array when projects.d/ does not exist', () => {
      const projects = readProjects(prefsDir);
      expect(projects).toEqual([]);
    });

    it('returns empty array when projects.d/ is empty', () => {
      mkdirSync(join(prefsDir, 'projects.d'));
      const projects = readProjects(prefsDir);
      expect(projects).toEqual([]);
    });

    it('reads valid project files', () => {
      const projDir = join(prefsDir, 'projects.d');
      mkdirSync(projDir);
      writeFileSync(
        join(projDir, 'alpha.json'),
        JSON.stringify({ name: 'alpha', path: '/a' }),
      );
      writeFileSync(
        join(projDir, 'beta.json'),
        JSON.stringify({ name: 'beta', path: '/b' }),
      );

      const projects = readProjects(prefsDir);
      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('alpha');
      expect(projects[1].name).toBe('beta');
    });

    it('skips malformed JSON files', () => {
      const projDir = join(prefsDir, 'projects.d');
      mkdirSync(projDir);
      writeFileSync(
        join(projDir, 'good.json'),
        JSON.stringify({ name: 'good', path: '/g' }),
      );
      writeFileSync(join(projDir, 'bad.json'), '{not valid json');

      const projects = readProjects(prefsDir);
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('good');
    });

    it('skips non-json files', () => {
      const projDir = join(prefsDir, 'projects.d');
      mkdirSync(projDir);
      writeFileSync(
        join(projDir, 'good.json'),
        JSON.stringify({ name: 'good', path: '/g' }),
      );
      writeFileSync(join(projDir, 'readme.txt'), 'hello');

      const projects = readProjects(prefsDir);
      expect(projects).toHaveLength(1);
    });

    it('sorts projects by name', () => {
      const projDir = join(prefsDir, 'projects.d');
      mkdirSync(projDir);
      writeFileSync(
        join(projDir, 'zebra.json'),
        JSON.stringify({ name: 'zebra', path: '/z' }),
      );
      writeFileSync(
        join(projDir, 'alpha.json'),
        JSON.stringify({ name: 'alpha', path: '/a' }),
      );

      const projects = readProjects(prefsDir);
      expect(projects[0].name).toBe('alpha');
      expect(projects[1].name).toBe('zebra');
    });
  });

  // --- writeProject ---

  describe('writeProject', () => {
    it('creates projects.d/ if needed and writes project file', () => {
      writeProject(prefsDir, { name: 'test-proj', path: '/test' });
      const raw = readFileSync(
        join(prefsDir, 'projects.d', 'test-proj.json'),
        'utf8',
      );
      const data = JSON.parse(raw);
      expect(data.name).toBe('test-proj');
      expect(data.path).toBe('/test');
    });

    it('throws on invalid entry', () => {
      expect(() =>
        writeProject(prefsDir, { name: '', path: '/test' }),
      ).toThrow();
    });

    it('enforces max projects limit', () => {
      // Set max to 2
      writeFileSync(
        join(prefsDir, 'config.json'),
        JSON.stringify({ maxProjects: 2 }),
      );
      const projDir = join(prefsDir, 'projects.d');
      mkdirSync(projDir);
      writeFileSync(
        join(projDir, 'a.json'),
        JSON.stringify({ name: 'a', path: '/a' }),
      );
      writeFileSync(
        join(projDir, 'b.json'),
        JSON.stringify({ name: 'b', path: '/b' }),
      );

      expect(() => writeProject(prefsDir, { name: 'c', path: '/c' })).toThrow(
        /max/i,
      );
    });

    it('allows overwriting existing project', () => {
      writeProject(prefsDir, { name: 'proj', path: '/old' });
      writeProject(prefsDir, { name: 'proj', path: '/new' });
      const data = JSON.parse(
        readFileSync(join(prefsDir, 'projects.d', 'proj.json'), 'utf8'),
      );
      expect(data.path).toBe('/new');
    });
  });

  // --- removeProject ---

  describe('removeProject', () => {
    it('removes existing project file', () => {
      const projDir = join(prefsDir, 'projects.d');
      mkdirSync(projDir);
      writeFileSync(
        join(projDir, 'proj.json'),
        JSON.stringify({ name: 'proj', path: '/p' }),
      );

      removeProject(prefsDir, 'proj');
      const projects = readProjects(prefsDir);
      expect(projects).toHaveLength(0);
    });

    it('no-op when project does not exist', () => {
      expect(() => removeProject(prefsDir, 'nonexistent')).not.toThrow();
    });
  });

  // --- synthesizeDefaultProject ---

  describe('synthesizeDefaultProject', () => {
    it('derives project info from projectRoot', () => {
      const projectRoot = '/home/user/my-project';
      const result = synthesizeDefaultProject(projectRoot);
      expect(result.name).toBe('my-project');
      expect(result.path).toBe('/home/user/my-project');
      expect(result.worcaDir).toBe('/home/user/my-project/.worca');
      expect(result.settingsPath).toBe(
        '/home/user/my-project/.claude/settings.json',
      );
    });
  });

  // --- getMaxProjects ---

  describe('getMaxProjects', () => {
    it('returns default 20 when config.json missing', () => {
      expect(getMaxProjects(prefsDir)).toBe(20);
    });

    it('reads maxProjects from config.json', () => {
      writeFileSync(
        join(prefsDir, 'config.json'),
        JSON.stringify({ maxProjects: 5 }),
      );
      expect(getMaxProjects(prefsDir)).toBe(5);
    });
  });
});
