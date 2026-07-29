#!/usr/bin/env node
// scripts/install.mjs
//
// Copy the orchestrator agents and the /worca skill into a target project's
// .claude directory so that opening Claude Code there lets the user run:
//   /worca <prompt>
//
// Usage:
//   node scripts/install.mjs <targetDir> [--force]
//
// - agents/*.md            -> <targetDir>/.claude/agents/
// - skills/worca/**        -> <targetDir>/.claude/skills/worca/
//
// Without --force, existing files are left untouched (and reported as skipped).
// ESM, no external dependencies.

import { readdir, mkdir, copyFile, stat, access, readFile, writeFile } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const AGENTS_SRC = join(REPO_ROOT, 'agents');
const SKILL_SRC = join(REPO_ROOT, 'skills', 'worca');

function parseArgs(argv) {
  const out = { target: null, force: false, help: false };
  for (const arg of argv) {
    if (arg === '--force' || arg === '-f') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!arg.startsWith('-') && !out.target) out.target = arg;
  }
  return out;
}

const HELP = `install — copy orchestrator agents + /worca skill into a project

Usage:
  node scripts/install.mjs <targetDir> [--force]

Copies:
  agents/*.md            -> <targetDir>/.claude/agents/
  skills/worca/**        -> <targetDir>/.claude/skills/worca/

Options:
  --force, -f   Overwrite files that already exist
  --help, -h    Show this help
`;

async function exists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a single file, honoring --force. Returns "copied" | "skipped".
 */
async function copyOne(src, dest, force) {
  await mkdir(dirname(dest), { recursive: true });
  if (!force && (await exists(dest))) {
    return 'skipped';
  }
  await copyFile(src, dest);
  return 'copied';
}

/**
 * Recursively copy a directory tree. Returns counts { copied, skipped }.
 */
async function copyTree(srcDir, destDir, force) {
  const counts = { copied: 0, skipped: 0 };
  let entries;
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch {
    return counts;
  }
  for (const ent of entries) {
    const src = join(srcDir, ent.name);
    const dest = join(destDir, ent.name);
    if (ent.isDirectory()) {
      const sub = await copyTree(src, dest, force);
      counts.copied += sub.copied;
      counts.skipped += sub.skipped;
    } else if (ent.isFile()) {
      const r = await copyOne(src, dest, force);
      counts[r] += 1;
    }
  }
  return counts;
}

/**
 * Rewrite the `<WORCA_REPO>` placeholder in the installed SKILL.md to the real
 * absolute path of this orchestrator repo, so /worca works on the target
 * machine without manual editing. Best-effort: never fails the install.
 * @returns {Promise<boolean>} true if the file was rewritten.
 */
async function rewriteSkillRepoPath(skillDest, repoRoot) {
  const skillMd = join(skillDest, 'SKILL.md');
  try {
    const original = await readFile(skillMd, 'utf8');
    const rewritten = original.split('<WORCA_REPO>').join(repoRoot);
    if (rewritten !== original) {
      await writeFile(skillMd, rewritten, 'utf8');
      return true;
    }
  } catch {
    /* no SKILL.md or unreadable — skip */
  }
  return false;
}

function log(s) {
  process.stdout.write(s + '\n');
}

async function main() {
  const { target, force, help } = parseArgs(process.argv.slice(2));
  if (help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!target) {
    process.stderr.write('install: missing <targetDir>. See --help.\n');
    return 2;
  }

  const targetDir = resolve(target);
  if (!(await exists(targetDir))) {
    process.stderr.write(`install: target directory does not exist: ${targetDir}\n`);
    return 2;
  }
  const targetStat = await stat(targetDir);
  if (!targetStat.isDirectory()) {
    process.stderr.write(`install: target is not a directory: ${targetDir}\n`);
    return 2;
  }

  const claudeDir = join(targetDir, '.claude');
  const agentsDest = join(claudeDir, 'agents');
  const skillDest = join(claudeDir, 'skills', 'worca');

  log(`Installing worca-cc into: ${targetDir}`);
  if (force) log('(--force: existing files will be overwritten)');

  // Agents: copy only the *.md files.
  let agentEntries = [];
  try {
    agentEntries = (await readdir(AGENTS_SRC, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch {
    agentEntries = [];
  }

  const agentCounts = { copied: 0, skipped: 0 };
  if (agentEntries.length === 0) {
    log(`! No agent markdown files found in ${relative(REPO_ROOT, AGENTS_SRC) || AGENTS_SRC}.`);
  } else {
    await mkdir(agentsDest, { recursive: true });
    for (const name of agentEntries) {
      const r = await copyOne(join(AGENTS_SRC, name), join(agentsDest, name), force);
      agentCounts[r] += 1;
      log(`  ${r === 'copied' ? '+' : '='} agents/${name}`);
    }
  }

  // Skill: copy the whole skills/worca tree.
  let skillCounts = { copied: 0, skipped: 0 };
  if (await exists(SKILL_SRC)) {
    skillCounts = await copyTree(SKILL_SRC, skillDest, force);
    log(`  ${skillCounts.copied ? '+' : '='} skills/worca/ (${skillCounts.copied} copied, ${skillCounts.skipped} skipped)`);
    // Personalize the copied skill so /worca targets this repo's real path.
    if (await rewriteSkillRepoPath(skillDest, REPO_ROOT)) {
      log(`  ~ skills/worca/SKILL.md (rewrote <WORCA_REPO> -> ${REPO_ROOT})`);
    }
  } else {
    log(`! Skill source not found at ${relative(REPO_ROOT, SKILL_SRC) || SKILL_SRC}.`);
  }

  log('');
  log(
    `Done. Agents: ${agentCounts.copied} copied / ${agentCounts.skipped} skipped. ` +
      `Skill: ${skillCounts.copied} copied / ${skillCounts.skipped} skipped.`,
  );
  if (!force && (agentCounts.skipped > 0 || skillCounts.skipped > 0)) {
    log('Some files already existed and were skipped. Re-run with --force to overwrite.');
  }
  log('');
  log('Next step: open Claude Code in that project and run:');
  log('  /worca <your task prompt>');

  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    process.stderr.write(`install: fatal: ${err?.stack || err?.message || err}\n`);
    process.exit(1);
  });
