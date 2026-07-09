/**
 * Tests for the Project Setup Wizard server helpers (W-073).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applySetupPatch,
  buildProjectPreflight,
  setupPatchToWorca,
} from './worca-setup-config.js';

describe('setupPatchToWorca', () => {
  it('maps baseBranch to worca.parallel.default_base_branch', () => {
    const { worca, clearDefaultTemplate } = setupPatchToWorca({
      baseBranch: 'master',
    });
    expect(worca).toEqual({ parallel: { default_base_branch: 'master' } });
    expect(clearDefaultTemplate).toBe(false);
  });

  it('maps graphifyEnabled to worca.graphify.enabled', () => {
    expect(setupPatchToWorca({ graphifyEnabled: true }).worca).toEqual({
      graphify: { enabled: true },
    });
    expect(setupPatchToWorca({ graphifyEnabled: false }).worca).toEqual({
      graphify: { enabled: false },
    });
  });

  it('maps crgEnabled to worca.code_review_graph.enabled', () => {
    expect(setupPatchToWorca({ crgEnabled: true }).worca).toEqual({
      code_review_graph: { enabled: true },
    });
  });

  it('maps a template pointer to worca.default_template', () => {
    const { worca } = setupPatchToWorca({
      template: { tier: 'builtin', id: 'quick-fix' },
    });
    expect(worca.default_template).toEqual({
      tier: 'builtin',
      id: 'quick-fix',
    });
  });

  it('signals clearDefaultTemplate when template is null', () => {
    const { worca, clearDefaultTemplate } = setupPatchToWorca({
      template: null,
    });
    expect(worca.default_template).toBeUndefined();
    expect(clearDefaultTemplate).toBe(true);
  });

  it('ignores an empty baseBranch string', () => {
    expect(setupPatchToWorca({ baseBranch: '' }).worca).toEqual({});
  });

  it('ignores non-boolean tool flags', () => {
    expect(setupPatchToWorca({ graphifyEnabled: 'yes' }).worca).toEqual({});
  });
});

describe('applySetupPatch', () => {
  let dir;
  let settingsPath;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `worca-setup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(dir, '.claude'), { recursive: true });
    settingsPath = join(dir, '.claude', 'settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readWorca() {
    return JSON.parse(readFileSync(settingsPath, 'utf8')).worca;
  }

  it('writes base branch into a fresh settings.json', () => {
    applySetupPatch(settingsPath, { baseBranch: 'master' });
    expect(readWorca().parallel.default_base_branch).toBe('master');
  });

  it('deep-merges, preserving unrelated existing keys', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ worca: { models: { sonnet: 'x' } } }),
    );
    applySetupPatch(settingsPath, { graphifyEnabled: true });
    const w = readWorca();
    expect(w.models.sonnet).toBe('x');
    expect(w.graphify.enabled).toBe(true);
  });

  it('sets default_template', () => {
    applySetupPatch(settingsPath, {
      template: { tier: 'user', id: 'my-tmpl' },
    });
    expect(readWorca().default_template).toEqual({
      tier: 'user',
      id: 'my-tmpl',
    });
  });

  it('clears default_template when template is null', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        worca: { default_template: { tier: 'builtin', id: 'feature' } },
      }),
    );
    applySetupPatch(settingsPath, { template: null });
    expect(readWorca().default_template).toBeUndefined();
  });

  it('tolerates a non-existent settings.json (creates it)', () => {
    const fresh = join(dir, 'nested', '.claude', 'settings.json');
    applySetupPatch(fresh, { baseBranch: 'develop' });
    expect(
      JSON.parse(readFileSync(fresh, 'utf8')).worca.parallel
        .default_base_branch,
    ).toBe('develop');
  });
});

describe('buildProjectPreflight', () => {
  let dir;
  let settingsPath;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `worca-pf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(dir, '.claude'), { recursive: true });
    settingsPath = join(dir, '.claude', 'settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports isGitRepo false when no .git dir', async () => {
    const pf = await buildProjectPreflight({ projectRoot: dir, settingsPath });
    expect(pf.isGitRepo).toBe(false);
  });

  it('reports isGitRepo true when .git exists', async () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    const pf = await buildProjectPreflight({ projectRoot: dir, settingsPath });
    expect(pf.isGitRepo).toBe(true);
  });

  it('defaults tool install state to false when no status providers', async () => {
    const pf = await buildProjectPreflight({ projectRoot: dir, settingsPath });
    expect(pf.graphifyInstalled).toBe(false);
    expect(pf.crgInstalled).toBe(false);
  });

  it('reflects install state from injected status providers', async () => {
    const pf = await buildProjectPreflight({
      projectRoot: dir,
      settingsPath,
      graphifyStatus: { detect: async () => ({ installed: true }) },
      crgStatus: { detect: async () => ({ installed: false }) },
    });
    expect(pf.graphifyInstalled).toBe(true);
    expect(pf.crgInstalled).toBe(false);
  });

  it('survives a throwing status provider', async () => {
    const pf = await buildProjectPreflight({
      projectRoot: dir,
      settingsPath,
      graphifyStatus: {
        detect: async () => {
          throw new Error('boom');
        },
      },
    });
    expect(pf.graphifyInstalled).toBe(false);
  });

  it('reports worcaInstalled true via home-dir layout worcaConfigPath', async () => {
    const configPath = join(dir, 'worca-config.json');
    writeFileSync(configPath, '{}');
    const pf = await buildProjectPreflight({
      projectRoot: dir,
      settingsPath,
      worcaConfigPath: configPath,
    });
    expect(pf.worcaInstalled).toBe(true);
  });

  it('reports worcaInstalled false when neither layout present', async () => {
    const pf = await buildProjectPreflight({
      projectRoot: dir,
      settingsPath,
      worcaConfigPath: '/nonexistent/config.json',
    });
    expect(pf.worcaInstalled).toBe(false);
  });

  it('pre-populates currentSettings from existing settings.json', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        worca: {
          parallel: { default_base_branch: 'master' },
          graphify: { enabled: true },
          default_template: { tier: 'builtin', id: 'feature' },
        },
      }),
    );
    const pf = await buildProjectPreflight({ projectRoot: dir, settingsPath });
    expect(pf.currentSettings.baseBranch).toBe('master');
    expect(pf.currentSettings.graphifyEnabled).toBe(true);
    expect(pf.currentSettings.crgEnabled).toBe(false);
    expect(pf.currentSettings.defaultTemplate).toEqual({
      tier: 'builtin',
      id: 'feature',
    });
  });
});
