/**
 * Project registry — manages multi-project entries in ~/.worca/projects.d/
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

export const SLUG_RE = /^[a-z0-9_-]{1,64}$/i;
const DEFAULT_MAX_PROJECTS = 20;

/**
 * Slugify a project name: lowercase, replace non-alphanumeric (except _ and -)
 * with hyphens, collapse consecutive hyphens, truncate to 64 chars.
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}

/**
 * Validate a project entry { name, path }.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateProjectEntry(entry) {
  if (!entry || typeof entry.name !== 'string' || !entry.name) {
    return { valid: false, error: 'name is required' };
  }
  if (!SLUG_RE.test(entry.name)) {
    return {
      valid: false,
      error: `name must match ${SLUG_RE} (got "${entry.name}")`,
    };
  }
  if (!entry.path || typeof entry.path !== 'string') {
    return { valid: false, error: 'path is required' };
  }
  if (!isAbsolute(entry.path)) {
    return { valid: false, error: 'path must be absolute' };
  }
  return { valid: true };
}

/**
 * Read all project entries from {prefsDir}/projects.d/*.json.
 * Skips malformed files. Returns sorted by name.
 */
export function readProjects(prefsDir) {
  const dir = join(prefsDir, 'projects.d');
  if (!existsSync(dir)) return [];

  const entries = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = readFileSync(join(dir, file), 'utf8');
      const data = JSON.parse(raw);
      if (
        data &&
        typeof data.name === 'string' &&
        typeof data.path === 'string'
      ) {
        entries.push(data);
      }
    } catch {
      // skip malformed
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Write a project entry to {prefsDir}/projects.d/{name}.json.
 * Creates projects.d/ if needed. Validates entry. Enforces max limit.
 */
export function writeProject(prefsDir, entry) {
  const validation = validateProjectEntry(entry);
  if (!validation.valid) {
    throw new Error(`Invalid project entry: ${validation.error}`);
  }

  const dir = join(prefsDir, 'projects.d');
  mkdirSync(dir, { recursive: true });

  // Check max limit (only for new projects, not overwrites)
  const filePath = join(dir, `${entry.name}.json`);
  if (!existsSync(filePath)) {
    const existing = readProjects(prefsDir);
    const max = getMaxProjects(prefsDir);
    if (existing.length >= max) {
      throw new Error(`Max projects limit reached (${max})`);
    }
  }

  writeFileSync(filePath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
}

/**
 * Remove a project entry. No-op if missing.
 */
export function removeProject(prefsDir, name) {
  const filePath = join(prefsDir, 'projects.d', `${name}.json`);
  try {
    unlinkSync(filePath);
  } catch {
    // no-op if missing
  }
}

/**
 * Synthesize a default project from a project root directory.
 * Used when no projects.d/ exists (single-project mode).
 */
export function synthesizeDefaultProject(projectRoot) {
  const name = basename(projectRoot);
  return {
    name,
    path: projectRoot,
    worcaDir: join(projectRoot, '.worca'),
    settingsPath: join(projectRoot, '.claude', 'settings.json'),
  };
}

/**
 * Read max projects from {prefsDir}/config.json. Defaults to 20.
 */
export function getMaxProjects(prefsDir) {
  try {
    const raw = readFileSync(join(prefsDir, 'config.json'), 'utf8');
    const config = JSON.parse(raw);
    if (typeof config.maxProjects === 'number') return config.maxProjects;
  } catch {
    // missing or invalid
  }
  return DEFAULT_MAX_PROJECTS;
}
