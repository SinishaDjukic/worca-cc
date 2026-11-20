// src/core/cli-resolve.mjs — what to spawn for an engine CLI on THIS host.
//
// Native Windows resolves a bare name on PATH to `.exe` only, and Node refuses to
// run .cmd/.bat shims without a shell (CVE-2024-27980). An npm-installed CLI puts
// exactly such a shim on PATH. This module turns "the configured bin" into a spawn
// command that needs no shell: the package's native .exe when one sits next to the
// shim (or is named by it), else `node <entry script>` parsed out of npm's
// cmd-shim. Engine-neutral: per-engine facts arrive as a CliSpec
// (src/core/engines/cli-specs.mjs). Off Windows every path is `as-is`, no I/O.
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';

export const GENERIC_CLI = Object.freeze({ id: 'generic', label: 'the CLI', envVar: null, candidates: [], allowNode: true });

const SHIM_EXTS = ['.cmd', '.bat', '.ps1'];
const TRIPLES = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' };

/** The configured Claude binary — the same precedence claude-runner.mjs spawns with. */
export function configuredClaudeBin() {
  return process.env.WORCA_CLAUDE_BIN || process.env.ORCH_CLAUDE_BIN || 'claude';
}

/** A real PE executable (MZ header, bigger than npm's placeholder stub). */
export function isNativeExe(p) {
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size < 4096) return false;
    const fd = openSync(p, 'r');
    try {
      const head = Buffer.alloc(2);
      readSync(fd, head, 0, 2, 0);
      return head.toString('latin1') === 'MZ';
    } finally { closeSync(fd); }
  } catch { return false; }
}

function defaultReadFile(p) {
  const fd = openSync(p, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally { closeSync(fd); }
}

const _ov = { isNativeExe: null, readFile: null };
const _resolveCache = new Map();
/** Test seam: swap the PE check / shim reader so a POSIX host can stand in a
 *  shell script for a native .exe. Clears the memo. */
export const _testing = {
  set({ isNativeExe: native = _ov.isNativeExe, readFile = _ov.readFile } = {}) {
    _ov.isNativeExe = native; _ov.readFile = readFile; _resolveCache.clear();
  },
  reset() { _ov.isNativeExe = null; _ov.readFile = null; _resolveCache.clear(); },
};

const lastMatch = (re, text) => { let m = null; for (const x of text.matchAll(re)) m = x; return m; };
const linePrefix = (text, idx) => text.slice(text.lastIndexOf('\n', idx - 1) + 1, idx);
const baseOf = (p) => String(p).split(/[\\/]/).pop().toLowerCase();

/**
 * Parse npm's cmd-shim launcher text. Pure.
 * @param {string} text
 * @param {'.cmd'|'.bat'|'.ps1'} ext
 * @returns {{kind:'exe'|'node', target:string}|{kind:'other', prog:string}|null}
 */
export function parseShim(text, ext) {
  const src = String(text ?? '').replace(/\r\n/g, '\n');
  if (String(ext).toLowerCase() === '.ps1') {
    const m = lastMatch(/"\$basedir\/([^"$]+)"\s+\$args/g, src);
    if (!m) return null;
    const target = m[1];
    if (/node(?:\$exe|\.exe)?"?\s*$/i.test(linePrefix(src, m.index))) return { kind: 'node', target };
    if (/\.exe$/i.test(target)) return { kind: 'exe', target };
    return { kind: 'other', prog: '' };
  }
  const m = lastMatch(/"%~?dp0%?\\([^"%]+)"[ \t]*%\*/g, src);
  if (!m) return null;
  const target = m[1];
  const pre = linePrefix(src, m.index);
  if (/"%_prog%"\s*$/i.test(pre)) {
    const prog = lastMatch(/SET\s+"?_prog=([^"\n]*)"?/gi, src)?.[1]?.trim() ?? '';
    return ['node', 'node.exe'].includes(baseOf(prog)) ? { kind: 'node', target } : { kind: 'other', prog };
  }
  if (/(?:\bnode(?:\.exe)?|"%~?dp0%?\\node\.exe")\s*$/i.test(pre)) return { kind: 'node', target };
  if (/\.(exe|com)$/i.test(target)) return { kind: 'exe', target };
  return { kind: 'other', prog: '' };
}

const targetPath = (shim, rel) => join(dirname(shim), ...rel.split(/[\\/]/));

function candidatePaths(shim, spec, arch) {
  const archs = [arch, arch === 'arm64' ? 'x64' : 'arm64'];
  const out = [];
  for (const segs of spec.candidates ?? []) {
    const templated = segs.some((s) => /\{(arch|triple)\}/.test(s));
    for (const a of templated ? archs : [arch]) {
      const p = join(dirname(shim), ...segs.map((s) => s.replaceAll('{arch}', a).replaceAll('{triple}', TRIPLES[a])));
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

function probe(bin, spec, opts) {
  const pathEnv = opts.pathEnv ?? (process.env.PATH ?? '');
  const exists = opts.exists ?? existsSync;
  const native = opts.isNativeExe ?? _ov.isNativeExe ?? isNativeExe;
  const readFile = opts.readFile ?? _ov.readFile ?? defaultReadFile;
  const arch = opts.arch ?? process.arch;
  const ok = (p) => { try { return !!exists(p); } catch { return false; } }; // a probe error is "absent"
  const isNative = (p) => { try { return !!native(p); } catch { return false; } };
  const name = String(bin ?? '').trim();
  const out = { name, shims: [], exe: false, placeholder: null, firstCandidate: null,
    resolved: { bin, prefixArgs: [], source: 'as-is', note: null, shim: null } };
  if (/\.(exe|com)$/i.test(name)) { out.exe = true; out.resolved.source = 'exe'; return out; }
  const explicitPath = /[\\/]/.test(name);
  const shimExt = /\.(cmd|bat|ps1)$/i.test(name);
  const stems = explicitPath ? [name]
    : String(pathEnv).split(';').map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean).map((d) => join(d, name));
  let native1 = null;
  for (const stem of stems) {
    if (!shimExt && ok(stem + '.exe')) { out.exe = true; out.resolved = { bin, prefixArgs: [], source: 'exe', note: null, shim: null }; return out; }
    for (const ext of shimExt ? [''] : SHIM_EXTS) {
      const shim = stem + ext;
      if (!ok(shim)) continue;
      out.shims.push(shim);
      if (native1 || out.placeholder) continue;   // the first shim whose directory holds a candidate decides
      const cands = candidatePaths(shim, spec, arch);
      if (cands.length && !out.firstCandidate) out.firstCandidate = cands[0];
      for (const c of cands) {
        if (!ok(c)) continue;
        if (isNative(c)) { native1 = c; break; }
        out.placeholder ??= c;
      }
    }
  }
  const shim = out.shims[0] ?? null;
  out.resolved.shim = shim;
  const label = spec.label;
  const noteFor = (exe) => `using the npm-installed ${label} binary ${exe} ("${name}" on PATH is npm's .cmd shim, which Node cannot spawn directly)`;
  if (native1) { out.resolved = { bin: native1, prefixArgs: [], source: 'npm', note: noteFor(native1), shim }; return out; }
  if (!shim) return out;
  let parsed = null;
  try { parsed = parseShim(readFile(shim), extname(shim)); } catch { parsed = null; }
  if (parsed?.kind === 'exe') {
    const t = targetPath(shim, parsed.target);
    if (ok(t)) {
      if (isNative(t)) { out.resolved = { bin: t, prefixArgs: [], source: 'shim-exe', note: noteFor(t), shim }; return out; }
      out.placeholder ??= t;
    }
  } else if (parsed?.kind === 'node' && spec.allowNode !== false) {
    const t = targetPath(shim, parsed.target);
    if (ok(t)) {
      let node = join(dirname(shim), 'node.exe');
      if (!ok(node)) {
        node = String(pathEnv).split(';').map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)
          .map((d) => join(d, 'node.exe')).find(ok) ?? (opts.execPath ?? process.execPath);
      }
      out.resolved = { bin: node, prefixArgs: [t], source: 'node', shim,
        note: `running ${label} as node ${t} ("${name}" on PATH is npm's .cmd shim, which Node cannot spawn directly)` };
    }
  }
  return out;
}

// A memoised resolution is only good while the program and any entry script exist.
function stillThere(r) {
  try {
    if (/^[a-zA-Z]:[\\/]/.test(r.bin) && !existsSync(r.bin)) return false;
    return !(r.prefixArgs[0] && !existsSync(r.prefixArgs[0]));
  } catch { return false; }
}

/**
 * What to spawn for `bin` on THIS host. See the module header. Pure with injected
 * platform/pathEnv/exists/isNativeExe/readFile/arch/execPath; the uninjected
 * resolution is memoised per spec+bin+PATH, successful resolutions only (so a CLI
 * installed while the server runs is picked up by the next check).
 * @returns {{bin:string, prefixArgs:string[], source:'as-is'|'exe'|'npm'|'shim-exe'|'node', note:string|null, shim:string|null}}
 */
export function resolveCliBin(bin, spec = GENERIC_CLI, opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return { bin, prefixArgs: [], source: 'as-is', note: null, shim: null };
  const injected = Object.keys(opts).length > 0;
  const key = `${spec.id}\0${bin}\0${opts.pathEnv ?? process.env.PATH ?? ''}`;
  if (!injected && _resolveCache.has(key)) {
    const hit = _resolveCache.get(key);
    if (stillThere(hit)) return hit;
    _resolveCache.delete(key);   // the CLI moved or was removed while the server ran: probe again
  }
  const { resolved } = probe(bin, spec, opts);
  if (!injected && resolved.source !== 'as-is') _resolveCache.set(key, resolved);
  return resolved;
}

/** `{file, args}` ready for execFile/spawn: the resolved program, any entry
 *  script, then the caller's args untouched. */
export function resolveCliCommand(bin, args, spec = GENERIC_CLI, opts = {}) {
  const resolved = resolveCliBin(bin, spec, opts);
  return { file: resolved.bin, args: [...resolved.prefixArgs, ...(args ?? [])], resolved };
}

/**
 * Why `bin` cannot be spawned on THIS host, or null when the generic error is the
 * whole story (not Windows, a real exe, no shim at all, or it resolves). Never throws.
 * @returns {string|null}
 */
export function explainUnspawnableCli(bin, spec = GENERIC_CLI, opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return null;
  let p;
  try { p = probe(bin, spec, opts); } catch { return null; }
  if (p.exe || !p.shims.length) return null;
  if (['npm', 'shim-exe', 'node'].includes(p.resolved.source)) return null;
  const base = `"${p.name}" resolves to a script shim (${p.shims[0]}) — the npm install of ${spec.label}. ` +
    'Windows only launches a .exe by name and Node cannot run a .cmd/.bat shim without a shell. ';
  if (p.placeholder) {
    if (spec.placeholderHint) return base + spec.placeholderHint(p.placeholder);
    return base + `Worca would run the package's native binary instead, but ${p.placeholder} is still npm's placeholder — ` +
      `the package's install step did not run (--ignore-scripts / --omit=optional). Reinstall ${spec.label} without those flags, ` +
      `or set ${spec.envVar ?? 'the configured bin'} to the full path of its .exe.`;
  }
  return base + `No native binary was found next to it (${p.firstCandidate ?? 'and the shim does not name a node script or .exe'}). ` +
    (spec.noNativeHint ?? `Set ${spec.envVar ?? 'the configured bin'} to the full path of the program's .exe.`);
}

const hasSep = (s) => s.includes('/') || s.includes('\\');
const isAbs = (s) => /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\');

function findOnPath(name, pathEnv, exists, exts, sep) {
  for (const dir of String(pathEnv || '').split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (exists(p)) return p;
    }
  }
  return null;
}

/**
 * Is `bin` spawnable on this host? Never spawns — a handful of stat()s.
 * @returns {{ready:boolean, bin:string, hint:string|null}}
 */
export function cliReady(bin, spec = GENERIC_CLI, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const pathEnv = opts.pathEnv ?? (process.env.PATH ?? '');
  const exists = opts.exists ?? existsSync;
  const name = String(bin ?? '').trim();
  if (platform === 'win32') {
    const o = { ...opts, platform, pathEnv, exists };
    const hint = explainUnspawnableCli(name, spec, o);
    if (hint) return { ready: false, bin: name, hint };
    const r = resolveCliBin(name, spec, o);
    if (r.source !== 'as-is') return { ready: true, bin: r.source === 'exe' ? name : r.bin, hint: null };
    if (hasSep(name) || isAbs(name)) return { ready: exists(name), bin: name, hint: null };
    const hit = findOnPath(name, pathEnv, exists, ['.exe', ''], ';');
    return { ready: !!hit, bin: hit || name, hint: null };
  }
  if (hasSep(name)) return { ready: exists(name), bin: name, hint: null };
  const hit = findOnPath(name, pathEnv, exists, [''], ':');
  return { ready: !!hit, bin: hit || name, hint: null };
}
