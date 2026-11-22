// src/core/office-preview.mjs — Office documents (.docx .pptx .xlsx .odt .odp .ods) as PDF for the file viewer, through
// a headless LibreOffice (`soffice --headless --convert-to pdf`) when one is installed. Detect only: nothing is
// installed or downloaded (a server image without LibreOffice answers NO_CONVERTER and the viewer offers Download).
// soffice runs as the server user on files agents may have written, so every conversion is boxed: a private copy in a
// fresh folder, its own LibreOffice profile (a running desktop LibreOffice never blocks it), a scrubbed env, a time
// limit with a process-group kill, one conversion at a time, size caps in and out. PDFs are cached by the source's
// SHA-256 under <worca home>/cache/office-pdf, newest OFFICE_LIMITS.cacheEntries kept.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findOnPath } from './actions/builtins.mjs';
import { scrubbedEnv } from './plugin-shim.mjs';
import { killTree } from './graph/script-runner.mjs';
import { worcaHome } from './projects.mjs';
import { isOfficePath, OFFICE_MAX_BYTES } from '../shared/artifact-kinds.mjs';

export const OFFICE_LIMITS = Object.freeze({
  maxBytes: OFFICE_MAX_BYTES, maxPdfBytes: 200 * 1024 * 1024, timeoutMs: 60_000, cacheEntries: 200, probeTtlMs: 60_000,
});

export class OfficePreviewError extends Error {
  constructor(code, message) { super(message); this.name = 'OfficePreviewError'; this.code = code; }
}
const fail = (code, message) => new OfficePreviewError(code, message);
export const NO_CONVERTER_TEXT = 'Install LibreOffice to preview Office files.';

const isRegularFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** Where LibreOffice is: `soffice` (then `libreoffice`) on PATH, else the standard macOS / Windows install. null = none. */
export function findSoffice({ env = process.env, platform = process.platform, isFile = isRegularFile } = {}) {
  for (const name of ['soffice', 'libreoffice']) {
    const hit = findOnPath(name, { env, platform, exists: isFile });
    if (hit) return hit;
  }
  const standard = platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
    : platform === 'win32' ? [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean).map((d) => `${d}\\LibreOffice\\program\\soffice.exe`)
      : [];
  return standard.find((p) => isFile(p)) || null;
}

let probe = { key: null, at: 0, bin: null };
/** findSoffice for this process, re-probed when PATH changes or after probeTtlMs (installing LibreOffice needs no restart). */
export function sofficeBin() {
  const key = String(process.env.PATH ?? process.env.Path ?? '');
  const now = Date.now();
  if (probe.key !== key || now - probe.at > OFFICE_LIMITS.probeTtlMs) probe = { key, at: now, bin: findSoffice() };
  return probe.bin;
}

const defaultCacheDir = () => join(worcaHome(), 'cache', 'office-pdf');
const extOf = (name) => { const b = String(name).split(/[\\/]/).pop() || ''; const d = b.lastIndexOf('.'); return d > 0 ? b.slice(d).toLowerCase() : ''; };
const sizeOf = async (p) => { try { const s = await stat(p); return s.isFile() ? s.size : null; } catch { return null; } };

const inflight = new Map();          // sha256 -> Promise<void>: one conversion per document, however many ask
let queue = Promise.resolve();       // one conversion at a time: soffice is heavy, and two share nothing

/**
 * The PDF of one Office document's bytes → { path, size, cached }. The caller read `buf` from the handle its own path
 * guard opened; `name` is only for the extension (LibreOffice picks its import filter from it).
 * Throws OfficePreviewError: NOT_OFFICE | TOO_LARGE | NO_CONVERTER | CONVERT_FAILED | TIMEOUT.
 */
export async function officePdf(buf, name, { bin = sofficeBin(), cacheDir = defaultCacheDir(), timeoutMs = OFFICE_LIMITS.timeoutMs } = {}) {
  if (!isOfficePath(name)) throw fail('NOT_OFFICE', 'Only Office documents convert to PDF.');
  if (buf.length > OFFICE_LIMITS.maxBytes) throw fail('TOO_LARGE', 'This document is too large to preview.');
  const hash = createHash('sha256').update(buf).digest('hex');
  const out = join(cacheDir, `${hash}.pdf`);
  const hit = await sizeOf(out);
  if (hit != null) {
    const now = new Date();
    await utimes(out, now, now).catch(() => {});   // recently used: the prune keeps it
    return { path: out, size: hit, cached: true };
  }
  if (!bin) throw fail('NO_CONVERTER', NO_CONVERTER_TEXT);
  let job = inflight.get(hash);
  if (!job) {
    job = queue.catch(() => {}).then(() => convert(buf, extOf(name), { bin, out, cacheDir, timeoutMs }));
    queue = job;
    inflight.set(hash, job);
    job.then(() => inflight.delete(hash), () => inflight.delete(hash));
  }
  await job;
  const size = await sizeOf(out);
  if (size == null) throw fail('CONVERT_FAILED', 'LibreOffice could not convert this document.');
  return { path: out, size, cached: false };
}

async function convert(buf, ext, { bin, out, cacheDir, timeoutMs }) {
  await mkdir(cacheDir, { recursive: true });
  const work = await mkdtemp(join(cacheDir, 'job-'));
  try {
    const src = join(work, `in${ext}`);
    await writeFile(src, buf);
    await runSoffice(bin, ['--headless', '--norestore', '--nologo', '--nodefault', '--nolockcheck',
      `-env:UserInstallation=${pathToFileURL(join(work, 'profile')).href}`, '--convert-to', 'pdf', '--outdir', work, src], { cwd: work, timeoutMs });
    const pdf = join(work, 'in.pdf');
    const size = await sizeOf(pdf);
    if (!size) throw fail('CONVERT_FAILED', 'LibreOffice could not convert this document.');
    if (size > OFFICE_LIMITS.maxPdfBytes) throw fail('TOO_LARGE', 'This document is too large to preview.');
    await rename(pdf, out);                         // same file system: a reader never sees half a PDF
    await prune(cacheDir);
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
  }
}

// soffice children still running. Each leads its own process group (detached), so a terminal's Ctrl+C never reaches
// it and a hung one would outlive the server: the group goes down when this process exits (as script-runner's `live`).
const running = new Set();
process.on('exit', () => { for (const c of running) killTree(c); });

function runSoffice(bin, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child = null;
    let timer = null;                               // declared first: a synchronous spawn throw calls end() before the timer exists
    const end = (err) => {
      if (settled) return;
      settled = true; clearTimeout(timer); running.delete(child);
      if (err) reject(err); else resolve();
    };
    try {
      child = spawn(bin, args, { cwd, env: scrubbedEnv(), stdio: ['ignore', 'ignore', 'ignore'], detached: process.platform !== 'win32', windowsHide: true });
    } catch { end(fail('CONVERT_FAILED', 'LibreOffice could not be started.')); return; }
    running.add(child);
    timer = setTimeout(() => { killTree(child); end(fail('TIMEOUT', 'LibreOffice took too long to convert this document.')); }, timeoutMs);
    child.on('error', () => end(fail('CONVERT_FAILED', 'LibreOffice could not be started.')));
    child.on('close', (code) => end(code === 0 ? null : fail('CONVERT_FAILED', 'LibreOffice could not convert this document.')));
  });
}

/** Keep the newest `keep` cached PDFs (by mtime; a hit refreshes it). Job folders are never touched here. */
async function prune(dir, keep = OFFICE_LIMITS.cacheEntries) {
  const pdfs = [];
  for (const name of await readdir(dir).catch(() => [])) {
    if (!/^[0-9a-f]{64}\.pdf$/.test(name)) continue;
    const s = await stat(join(dir, name)).catch(() => null);
    if (s) pdfs.push({ name, t: s.mtimeMs });
  }
  pdfs.sort((a, z) => z.t - a.t);
  for (const { name } of pdfs.slice(keep)) await rm(join(dir, name), { force: true }).catch(() => {});
}
