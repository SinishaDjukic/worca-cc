// src/core/secrets/wsl-dpapi.mjs — the WSL2 backend without a Secret Service: the vault key is wrapped by Windows
// DPAPI (scope CurrentUser) through Windows PowerShell 5.1 at its fixed absolute path, never `powershell.exe` from
// PATH. The wrapped key lives beside the vault in WRAPPED_KEY_FILE. Key material travels only on the child's stdin:
// the arguments are two fixed constants, the environment is the parent's, stderr is dropped and stdout never reaches
// an error.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, linkSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WSL_POWERSHELL } from '../system-proxy.mjs';
import { WRAPPED_KEY_FILE } from './files.mjs';

const STDOUT_CAP = 64 * 1024;
const MAX_WRAPPED_BYTES = 4096;
// A backstop only: callStore bounds every call and aborts the signal first.
const RUN_TIMEOUT_MS = 10_000;

const script = (call) => [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
  `$out = [System.Security.Cryptography.ProtectedData]::${call}($in, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
  '[Console]::Out.Write([Convert]::ToBase64String($out))',
].join('\n');
const encoded = (s) => Buffer.from(s, 'utf16le').toString('base64');
const BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'];

/** The two fixed PowerShell argument lists. Nothing else is ever passed on the command line. */
export const DPAPI_ARGS = Object.freeze({
  protect: Object.freeze([...BASE_ARGS, encoded(script('Protect'))]),
  unprotect: Object.freeze([...BASE_ARGS, encoded(script('Unprotect'))]),
});

/**
 * Run `file args` with `input` on stdin. Resolves `{ code, stdout }`: stdout capped at 64 KiB, stderr read and
 * dropped, the child killed on timeout or abort (code null), and a spawn failure such as ENOENT gives
 * `{ code: null, stdout: '' }`. Never rejects.
 */
export function runWithInput(file, args, { input = '', timeoutMs = RUN_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      resolve({ code: null, stdout: '' });
      return;
    }
    let done = false;
    let size = 0;
    const chunks = [];
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      resolve(r);
    };
    function kill() {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ code: null, stdout: '' });
    }
    const timer = setTimeout(kill, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (b) => {
      if (size >= STDOUT_CAP) return;
      const part = b.subarray(0, STDOUT_CAP - size);
      size += part.length;
      chunks.push(part);
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => finish({ code: null, stdout: '' }));
    child.on('close', (code) => finish({ code, stdout: Buffer.concat(chunks).toString('utf8') }));
    if (signal?.aborted) { kill(); return; }
    child.stdin.end(input);
  });
}

/** WSL_POWERSHELL when it is executable, else null. PATH is never searched. */
export function findPowershell({ accessImpl = accessSync } = {}) {
  try {
    accessImpl(WSL_POWERSHELL, constants.X_OK);
    return WSL_POWERSHELL;
  } catch {
    return null;
  }
}

const storeError = (code) => Object.assign(new Error(`OS key store: ${code}`), { code });
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** An OS store (kind `wsl-dpapi`) that keeps `home`'s vault key DPAPI-wrapped in WRAPPED_KEY_FILE. */
export function dpapiOsStore({ home, powershell, run = runWithInput }) {
  const file = join(home, WRAPPED_KEY_FILE);

  // The file's stat, or null when absent. Anything but ENOENT is unavailable.
  function statOf() {
    try { return lstatSync(file); } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw storeError('unavailable');
    }
  }

  return {
    kind: 'wsl-dpapi',
    async getKey({ signal } = {}) {
      const st = statOf();
      if (!st) return null;
      if (!st.isFile() || st.size > MAX_WRAPPED_BYTES) throw storeError('unavailable');
      let blob;
      try { blob = readFileSync(file, 'utf8').trim(); } catch { throw storeError('unavailable'); }
      const r = await run(powershell, DPAPI_ARGS.unprotect, { input: blob, timeoutMs: RUN_TIMEOUT_MS, signal });
      const text = r.code === 0 ? String(r.stdout ?? '').trim() : '';
      if (!BASE64_RE.test(text)) throw storeError('unavailable');
      const key = Buffer.from(text, 'base64');
      if (key.length !== 32) {
        key.fill(0);
        throw storeError('unavailable');
      }
      return key;
    },
    // The migration's preflight: protect 32 random bytes, unprotect them, compare. Both on stdin; no file is written,
    // so nothing is left to delete.
    async probe({ signal } = {}) {
      const bytes = randomBytes(32);
      const p = await run(powershell, DPAPI_ARGS.protect, { input: bytes.toString('base64'), timeoutMs: RUN_TIMEOUT_MS, signal });
      const blob = p.code === 0 ? String(p.stdout ?? '').trim() : '';
      if (!BASE64_RE.test(blob) || blob.length > MAX_WRAPPED_BYTES) throw storeError('unavailable');
      const u = await run(powershell, DPAPI_ARGS.unprotect, { input: blob, timeoutMs: RUN_TIMEOUT_MS, signal });
      if (u.code !== 0) throw storeError('unavailable');
      const text = String(u.stdout ?? '').trim();
      if (!text) throw storeError('probe-missing');
      if (!BASE64_RE.test(text) || !Buffer.from(text, 'base64').equals(bytes)) throw storeError('probe-mismatch');
    },
    // Remove the wrapped key file (export). No PowerShell call: the file is the item. False when it was not there.
    async deleteKey() {
      try { unlinkSync(file); return true; } catch (err) {
        if (err?.code === 'ENOENT') return false;
        throw storeError('unavailable');
      }
    },
    // Create-only: a temp file at 0600, then a link to the final name (EEXIST means exists), then the temp is removed.
    async setKey(key, { signal } = {}) {
      if (statOf()) throw storeError('exists');
      const r = await run(powershell, DPAPI_ARGS.protect, { input: Buffer.from(key).toString('base64'), timeoutMs: RUN_TIMEOUT_MS, signal });
      const blob = r.code === 0 ? String(r.stdout ?? '').trim() : '';
      if (!BASE64_RE.test(blob) || blob.length > MAX_WRAPPED_BYTES) throw storeError('unavailable');
      const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
      try {
        writeFileSync(tmp, blob, { mode: 0o600, flag: 'wx' });
        try { linkSync(tmp, file); } catch (err) {
          throw storeError(err.code === 'EEXIST' ? 'exists' : 'unavailable');
        }
      } catch (err) {
        throw err?.code === 'exists' || err?.code === 'unavailable' ? err : storeError('unavailable');
      } finally {
        try { unlinkSync(tmp); } catch { /* never created */ }
      }
    },
  };
}
