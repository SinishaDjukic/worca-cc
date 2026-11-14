// src/core/run-landings.mjs — when a run ends `done`, artifacts of a few host-known kinds land in
// worca's own stores (a plugin script has no host API, so it writes an artifact and the host
// decides). project-profile → project_config.extra.projectProfile; project-skills → a library skill
// set assigned to the project (run-landings-skills.mjs). Never throws: the run is already done.
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { listRunArtifacts } from './artifacts.mjs';
import { writeProjectProfile } from './project-profile.mjs';
import { landSkills } from './run-landings-skills.mjs';

export const LANDING_KINDS = Object.freeze({ profile: 'project-profile', skills: 'project-skills' });
// The plan card's answer: a skill lands only when the user sent its recurring task to worca there.
const PLAN_KIND = 'readiness-plan';

/** The task ids the plan card sent to worca, per project key. A workspace plan prefixes ids with `<projectKey>/`. */
function approvedWorcaTasks(plan, members, isWorkspace) {
  const out = new Map(members.map((m) => [m.projectKey, new Set()]));
  for (const t of Array.isArray(plan?.tasks) ? plan.tasks : []) {
    if (!t || t.target !== 'worca' || typeof t.id !== 'string') continue;
    if (!isWorkspace) { out.get(members[0].projectKey)?.add(t.id); continue; }
    const slash = t.id.indexOf('/');
    if (slash > 0) out.get(t.id.slice(0, slash))?.add(t.id.slice(slash + 1));
  }
  return out;
}

async function newestJson(deps, pipelineId, pipelineDir, kind) {
  const rows = await deps.listRunArtifacts(pipelineId, { kind });
  const row = rows[rows.length - 1];
  if (!row) return { none: true };
  const outside = { error: `${row.relPath} is outside the run directory` };
  const abs = resolve(pipelineDir, row.relPath);
  if (!abs.startsWith(resolve(pipelineDir) + sep)) return outside;
  try {
    // Contain the real file, so a symlink inside the run directory cannot lead out of it.
    const real = await realpath(abs);
    if (!real.startsWith(await realpath(pipelineDir) + sep)) return outside;
    const { size } = await stat(real);
    if (size > MAX_ARTIFACT_BYTES) return { error: `${row.relPath} is larger than 1 MiB` };
    return { value: JSON.parse(await readFile(real, 'utf8')), abs };
  } catch (err) { return { error: `${row.relPath}: ${String(err.message).slice(0, 200)}` }; }
}

const MAX_ARTIFACT_BYTES = 1024 * 1024;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export async function landRunArtifacts({ pipelineId, pipelineDir, runId, members, isWorkspace, deps = {} }) {
  const d = { listRunArtifacts, writeProjectProfile, landSkills, ...deps };
  const landed = [];
  const skipped = [];
  const byKey = new Map(members.map((m) => [m.projectKey, m]));
  // A single-project artifact is the one member's; a workspace artifact is { members: { <key>: … } }.
  const perMember = (value) => (isWorkspace
    ? Object.entries(isPlainObject(value) && isPlainObject(value.members) ? value.members : {})
    : [[members[0].projectKey, value]]);

  const prof = await newestJson(d, pipelineId, pipelineDir, LANDING_KINDS.profile);
  if (prof.error) skipped.push(`profile: ${prof.error}`);
  else if (!prof.none) {
    for (const [key, p] of perMember(prof.value)) {
      const m = byKey.get(key);
      if (!m) { skipped.push(`profile: ${String(key).slice(0, 80)} is not a project of this run`); continue; }
      try { d.writeProjectProfile(key, p, { runId }); landed.push(`profile: ${m.projectName}`); } catch (err) { skipped.push(`profile ${m.projectName}: ${String(err.message).slice(0, 200)}`); }
    }
  }

  const sk = await newestJson(d, pipelineId, pipelineDir, LANDING_KINDS.skills);
  if (sk.error) skipped.push(`skills: ${sk.error}`);
  else if (!sk.none) {
    // Fail closed: without a readable plan card, nothing the agents wrote reaches the skill library.
    const plan = await newestJson(d, pipelineId, pipelineDir, PLAN_KIND);
    if (plan.error || plan.none) {
      skipped.push(`skills: no plan card to check them against${plan.error ? ` (${plan.error})` : ''}`);
      return { landed, skipped };
    }
    const approved = approvedWorcaTasks(plan.value, members, isWorkspace);
    for (const [key, v] of perMember(sk.value)) {
      const m = byKey.get(key);
      if (!m) { skipped.push(`skills: ${String(key).slice(0, 80)} is not a project of this run`); continue; }
      const ok = approved.get(key) || new Set();
      const skills = [];
      for (const s of Array.isArray(v?.skills) ? v.skills : []) {
        if (ok.has(s?.name)) skills.push(s);
        else skipped.push(`skill ${String(s?.name).slice(0, 80)}: not sent to worca on the plan card`);
      }
      if (!skills.length) continue;
      const r = await d.landSkills({ projectKey: key, projectName: m.projectName, pipelineDir, skills });
      landed.push(...r.landed); skipped.push(...r.skipped);
    }
  }
  return { landed, skipped };
}
