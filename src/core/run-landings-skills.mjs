// src/core/run-landings-skills.mjs — recurring-task skills a readiness setup routed to worca land in
// one library set per project ("AI readiness: <name>") assigned to that project. A skill is only
// ever replaced when it is already a member of that set; a name used by any other library skill is
// never overwritten: the skill lands as <name>-<last 8 of the project key>, or is skipped when that
// name is taken too.
import { realpathSync, readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { redactAskText } from './ask/redact.mjs';
import { stageImport, discardStage } from './skills-registry/import.mjs';
import { commitImport, applyUpdate, removeLibrarySkill, readSkillLibrary } from './skills-registry/library.mjs';
import { skillIdOf, SKILL_NAME_MAX } from './skills-registry/ids.mjs';
import { loadSkillCatalog } from './skills-registry/catalog.mjs';
import { readMcpStore, createSet, deleteSet, putSkillMember, setProjectAssignment } from './mcp/store.mjs';

const PREFIX = 'AI readiness: ';
const clip = (v, n = 80) => String(v ?? '').slice(0, n);

// A skill folder is agent-written and lands in the shared library: refuse one holding a value the
// secret redaction would mask. Bounded walk; symlinks and binary files are not read.
const SCAN_MAX_FILES = 200;
const SCAN_MAX_BYTES = 1024 * 1024;
function secretFileIn(dir) {
  const stack = [dir];
  let seen = 0;
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) { stack.push(abs); continue; }
      if (!e.isFile() || ++seen > SCAN_MAX_FILES) continue;
      if (lstatSync(abs).size > SCAN_MAX_BYTES) continue;
      const text = readFileSync(abs, 'utf8');
      if (text.includes('\u0000')) continue;
      if (redactAskText(text) !== text) return relative(dir, abs).split(sep).join('/');
    }
  }
  return null;
}
// checkSetName allows 40 characters: the prefix leaves 26 for the project name.
const setName = (projectName) => `${PREFIX}${clip(projectName, 40 - PREFIX.length)}`.trim();
// Used when another project's set already has the plain name: a shorter clip plus the end of the project key.
const altSetName = (projectName, projectKey) => `${PREFIX}${clip(projectName, 17)} ${String(projectKey).slice(-8)}`;
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// The readiness set of one project: found only among the sets assigned to that project key, never another project's.
async function ensureSet(projectKey, projectName) {
  const store = await readMcpStore();
  const mine = (store.projects?.[projectKey]?.sets || []).filter((id) => store.sets?.[id]);
  const names = [setName(projectName), altSetName(projectName, projectKey)];
  for (const id of mine) {
    if (names.some((n) => same(store.sets[id].name, n))) return { id, name: store.sets[id].name };
  }
  try {
    return { ...(await createSet(names[0])), created: true };
  } catch (err) {
    if (err.status !== 409) throw err;
    return { ...(await createSet(names[1])), created: true };
  }
}

// The name a skill lands under when its plain name is taken outside this project's set: the task id clipped so
// that "-<last 8 of the project key>" fits the 64-character skill-name limit.
function suffixedName(name, projectKey) {
  const suffix = `-${String(projectKey).slice(-8).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  return `${String(name).slice(0, SKILL_NAME_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
}

// Set the frontmatter `name` of the staged SKILL.md (never the run's own folder) to the name the skill lands under.
function renameStaged(stageDir, name) {
  const file = join(stageDir, 'SKILL.md');
  const text = readFileSync(file, 'utf8');
  const m = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(text);
  if (!m || !/^name\s*:/m.test(m[2])) return;
  const fm = m[2].replace(/^name\s*:.*$/m, `name: ${name}`);
  writeFileSync(file, m[1] + fm + m[3] + text.slice(m[0].length));
}

export async function landSkills({ projectKey, projectName, pipelineDir, skills }) {
  const landed = [];
  const skipped = [];
  if (!skills.length) return { landed, skipped };
  let root;
  let set;
  try {
    root = realpathSync(resolve(pipelineDir)) + sep;
    set = await ensureSet(projectKey, projectName);
  } catch (err) {
    skipped.push(`skills: ${clip(err.message)}`);
    return { landed, skipped };
  }
  // A set's skills are a list of { skill, enabled }.
  const members = new Set(((await readMcpStore()).sets?.[set.id]?.skills || []).map((k) => k.skill));
  const idOf = (n) => skillIdOf({ source: 'library', name: n });
  const taken = 'name taken by a library skill outside this project\'s set';
  for (const s of skills) {
    const name = clip(s?.name);
    let dir;
    try { dir = realpathSync(resolve(pipelineDir, String(s?.dir || ''))); } catch (err) { skipped.push(`skill ${name}: ${clip(err.message)}`); continue; }
    if (!dir.startsWith(root)) { skipped.push(`skill ${name}: its folder is outside the run directory`); continue; }
    let leak = null;
    try { leak = secretFileIn(dir); } catch (err) { skipped.push(`skill ${name}: ${clip(err.message)}`); continue; }
    if (leak) { skipped.push(`skill ${name}: holds a secret-looking value (${clip(leak)}), so it was not added to the library`); continue; }
    // The library is global by name: a plain name used outside this project's set lands as <name>-<key end>.
    // A re-landing replaces whichever of the two names is already in this project's set.
    const alt = suffixedName(name, projectKey);
    const library = readSkillLibrary().skills;
    let target;
    let replace = false;
    if (members.has(idOf(name))) { target = name; replace = true; }
    else if (members.has(idOf(alt))) { target = alt; replace = true; }
    else if (!Object.hasOwn(library, name)) target = name;
    else if (!Object.hasOwn(library, alt)) target = alt;
    else { skipped.push(`skill ${name}: ${taken}`); continue; }
    const id = idOf(target);
    let staged = null;
    let fresh = false;
    try {
      staged = await stageImport({ kind: 'dir', path: dir }, replace ? { update: target } : {});
      if (target !== name) renameStaged(staged.dir, target);
      if (replace) {
        // An update swaps the folder in one step: a failed update keeps the old version.
        await applyUpdate(target, staged.dir);
      } else {
        try {
          await commitImport(staged.dir, target);
        } catch (err) {
          if (err.status === 409) { skipped.push(`skill ${name}: ${taken}`); continue; }
          throw err;
        }
        fresh = true;
      }
      try {
        const entry = (await loadSkillCatalog()).find((e) => e.id === id);
        if (!entry) throw new Error('the skill is not in the catalog');
        await putSkillMember(set.id, id, { enabled: true }, { entry });
      } catch (err) {
        // A skill worca just created must not stay behind looking like someone else's.
        if (fresh) await removeLibrarySkill(target).catch(() => {});
        throw err;
      }
      members.add(id);
      landed.push(`skill ${target} (set "${set.name}")`);
    } catch (err) {
      skipped.push(`skill ${name}: ${clip(err.message)}`);
    } finally {
      if (staged?.stage) { try { discardStage(staged.stage); } catch { /* already committed or gone */ } }
    }
  }
  if (landed.length) {
    try {
      const cur = (await readMcpStore()).projects?.[projectKey] || {};
      const sets = [...new Set([...(cur.sets || []), set.id])];
      await setProjectAssignment(projectKey, { sets, includeGeneral: cur.includeGeneral !== false });
    } catch (err) {
      skipped.push(`skills: the set could not be assigned: ${clip(err.message)}`);
    }
  }
  // A set this call created that ended up holding nothing is not left behind.
  if (!landed.length && set.created) await deleteSet(set.id).catch(() => {});
  return { landed, skipped };
}
