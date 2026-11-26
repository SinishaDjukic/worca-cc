// src/core/exec-env/project-env.mjs
// A project's environment record. This version holds the environment spec only: store it, clear it. Read it with
// readProjectExecEnv(key).spec (config.mjs). Backend fields and build records join this module in later releases;
// they live in the same record (`config`, `builds`) and never touch the spec.
import { updateProjectExecEnv } from '../config.mjs';
import { normalizeEnvSpec } from './env-spec.mjs';

/** Validate and store `input` as the project's spec; returns the stored spec (canonical, with hash and updatedAt). */
export function setProjectEnvSpec(projectKey, input, { now = new Date() } = {}) {
  const spec = { ...normalizeEnvSpec(input), updatedAt: now.toISOString() };
  updateProjectExecEnv(projectKey, (rec) => { rec.spec = spec; });
  return spec;
}
export function clearProjectEnvSpec(projectKey) { updateProjectExecEnv(projectKey, (rec) => { rec.spec = null; }); }
