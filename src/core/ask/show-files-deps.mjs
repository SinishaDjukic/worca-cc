// src/core/ask/show-files-deps.mjs — the REAL bundle behind show_files: the one Ask tool that writes into the thread's
// attachment store (tool-deps.mjs stays read-only by contract). No thread, no tool.
import { mkdirSync } from 'node:fs';
import { listProjects } from '../projects.mjs';
import { runDirForRow, resolveIndexedArtifactFileForRow } from '../artifacts.mjs';
import { terminalTargets } from '../terminal/context.mjs';
import { addAttachment, getAttachment, attachmentPath, listAttachments, askOutDir, getThread } from './store.mjs';
import { worktreesDir } from './worktrees.mjs';
import { redactAskText } from './redact.mjs';
import { ASK_LIMITS } from './limits.mjs';
import { showFiles } from './show-files.mjs';

const projectPath = async (key) => (await listProjects()).find((p) => p.key === key)?.path || null;

export function defaultShowFilesDeps({ threadId, platform = process.platform } = {}) {
  if (typeof threadId !== 'string' || !threadId) return {};
  const deps = {
    platform,
    limits: ASK_LIMITS.showFiles,
    redact: redactAskText,
    outDir: () => { const d = askOutDir(threadId); mkdirSync(d, { recursive: true }); return d; },
    worktreesDir: () => { try { return worktreesDir(threadId); } catch { return null; } },
    pinnedProjectDir: async () => {
      let c = null;
      try { c = getThread(threadId)?.context ?? null; } catch { return null; }
      return c && c.pinned === true && typeof c.projectKey === 'string' && c.projectKey ? projectPath(c.projectKey) : null;
    },
    projectDir: projectPath,
    // The folders run_command opens for a run (live worktree, or the finished run's checkout) plus its store folder.
    runDirsOf: async (row) => [await runDirForRow(row), ...terminalTargets(row).members.map((m) => m.cwd)].filter(Boolean),
    artifactFileOf: async (row, rel) => {
      const hit = await resolveIndexedArtifactFileForRow(row, rel);
      return hit ? { file: hit.file, base: hit.base } : null;
    },
    listAttachments: () => listAttachments(threadId),
    getAttachment: (id) => getAttachment(threadId, id),
    attachmentPath: (id) => attachmentPath(threadId, id),
    addAttachment: (body) => addAttachment(threadId, null, body),
  };
  return { showFiles: { show: (req) => showFiles(req, deps) } };
}
