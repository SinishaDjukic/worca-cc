/**
 * Shared helpers for the Project Setup Wizard (W-073).
 *
 * The wizard configures a handful of worca settings keys for one project
 * (single-project flow) or every child project of a workspace (workspace
 * flow). This module centralizes:
 *
 *   - `buildProjectPreflight()` — read-only diagnostics for one project
 *     (git repo, detected PR base branch, graphify/CRG install state, and the
 *     project's current values for the keys the wizard manages).
 *   - `setupPatchToWorca()` — pure translation of a wizard "patch" (a partial
 *     `{ baseBranch | graphifyEnabled | crgEnabled | template }`) into the
 *     `worca.*` settings shape. Kept pure so it can be unit-tested without IO.
 *   - `applySetupPatch()` — read → deep-merge → atomic-write a patch into one
 *     `settings.json`, with special handling for clearing `default_template`.
 *
 * The route handlers (project-routes.js, workspace-routes.js) are thin wrappers
 * over these so the single-project and workspace flows stay byte-identical in
 * what they write.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteSync } from './atomic-write.js';
import { getDefaultBranch } from './git-helpers.js';
import { deepMerge } from './settings-merge.js';
import { checkWorcaInstalled } from './worca-setup.js';

/**
 * Translate a wizard patch into the `worca.*` settings shape.
 *
 * A patch carries exactly one configured dimension per call (the wizard writes
 * step-by-step), but this function accepts any combination so a batched apply
 * also works. Returns `{ worca, clearDefaultTemplate }` where
 * `clearDefaultTemplate` signals the caller to delete the key rather than merge
 * it (deep-merge can't express a deletion).
 *
 * @param {object} patch
 * @param {string} [patch.baseBranch]
 * @param {boolean} [patch.graphifyEnabled]
 * @param {boolean} [patch.crgEnabled]
 * @param {{tier: string, id: string}|null} [patch.template] - null clears the default
 * @returns {{ worca: object, clearDefaultTemplate: boolean }}
 */
export function setupPatchToWorca(patch = {}) {
  const worca = {};
  let clearDefaultTemplate = false;

  if (typeof patch.baseBranch === 'string' && patch.baseBranch.length > 0) {
    worca.parallel = { default_base_branch: patch.baseBranch };
  }
  if (typeof patch.graphifyEnabled === 'boolean') {
    worca.graphify = { enabled: patch.graphifyEnabled };
  }
  if (typeof patch.crgEnabled === 'boolean') {
    worca.code_review_graph = { enabled: patch.crgEnabled };
  }
  if ('template' in patch) {
    if (
      patch.template &&
      typeof patch.template.tier === 'string' &&
      typeof patch.template.id === 'string'
    ) {
      worca.default_template = {
        tier: patch.template.tier,
        id: patch.template.id,
      };
    } else {
      // Explicit null / malformed → clear the pinned default.
      clearDefaultTemplate = true;
    }
  }

  return { worca, clearDefaultTemplate };
}

/**
 * Apply a wizard patch to a single settings.json, atomically.
 * Returns the resulting `worca` object so callers can echo it back.
 *
 * @param {string} settingsPath - absolute path to a project's .claude/settings.json
 * @param {object} patch - same shape as setupPatchToWorca()
 * @returns {object} the post-write `worca` settings object
 */
export function applySetupPatch(settingsPath, patch) {
  const { worca: worcaPatch, clearDefaultTemplate } = setupPatchToWorca(patch);

  let base = {};
  try {
    if (existsSync(settingsPath)) {
      base = JSON.parse(readFileSync(settingsPath, 'utf8'));
    }
  } catch {
    base = {};
  }
  if (
    !base.worca ||
    typeof base.worca !== 'object' ||
    Array.isArray(base.worca)
  ) {
    base.worca = {};
  }

  base.worca = deepMerge(base.worca, worcaPatch);

  if (clearDefaultTemplate) {
    delete base.worca.default_template;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  atomicWriteSync(settingsPath, `${JSON.stringify(base, null, 2)}\n`);

  return base.worca;
}

/**
 * Build the read-only preflight payload for a single project.
 *
 * Graphify/CRG detection is delegated to the shared status singletons passed in
 * (`app.locals.graphifyStatus` / `app.locals.crgStatus`); when they're absent
 * (e.g. a minimal test app), install state defaults to `false` rather than
 * spawning a detection subprocess.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.settingsPath
 * @param {{detect: Function}|null} [args.graphifyStatus]
 * @param {{detect: Function}|null} [args.crgStatus]
 * @returns {Promise<object>}
 */
export async function buildProjectPreflight({
  projectRoot,
  settingsPath,
  worcaConfigPath = null,
  graphifyStatus = null,
  crgStatus = null,
}) {
  const isGitRepo =
    Boolean(projectRoot) && existsSync(join(projectRoot, '.git'));
  // worca is "installed" when the project has a config — either the legacy
  // .claude/worca/ dir or the home-dir layout config.json.
  const worcaInstalled =
    Boolean(projectRoot) && checkWorcaInstalled(projectRoot, worcaConfigPath);
  const baseBranch = projectRoot ? getDefaultBranch(projectRoot) : 'main';

  let graphifyInstalled = false;
  try {
    const g = graphifyStatus ? await graphifyStatus.detect() : null;
    graphifyInstalled = Boolean(g?.installed);
  } catch {
    graphifyInstalled = false;
  }

  let crgInstalled = false;
  try {
    const c = crgStatus ? await crgStatus.detect() : null;
    crgInstalled = Boolean(c?.installed);
  } catch {
    crgInstalled = false;
  }

  let worca = {};
  try {
    if (settingsPath && existsSync(settingsPath)) {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
      worca = parsed?.worca || {};
    }
  } catch {
    worca = {};
  }

  return {
    isGitRepo,
    worcaInstalled,
    baseBranch,
    graphifyInstalled,
    crgInstalled,
    currentSettings: {
      baseBranch: worca.parallel?.default_base_branch ?? null,
      graphifyEnabled: Boolean(worca.graphify?.enabled),
      crgEnabled: Boolean(worca.code_review_graph?.enabled),
      defaultTemplate: worca.default_template ?? null,
    },
  };
}
