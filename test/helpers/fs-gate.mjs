// test/helpers/fs-gate.mjs — force an exact interleaving in a race test: patch one node:fs/promises (or node:fs)
// function for every ESM importer of this process (module.syncBuiltinESMExports updates the live named-import
// bindings), park a call at a chosen await, release it later. Each test file runs in its own process (node --test).
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const fsp = require('node:fs/promises');

/** Replace fsp[name] with wrap(original); returns restore(). */
export function patchFs(name, wrap) {
  const orig = fsp[name];
  fsp[name] = wrap(orig);
  syncBuiltinESMExports();
  return () => { fsp[name] = orig; syncBuiltinESMExports(); };
}

/** Hold the FIRST fs.promises.rename whose DESTINATION matches `match` (a writeAtomic's tmp → target). */
export function gateRename(match) {
  let reached, release;
  const atGate = new Promise((r) => { reached = r; });
  const gate = new Promise((r) => { release = r; });
  let armed = true;
  const restore = patchFs('rename', (orig) => async (src, dst) => {
    if (!(armed && typeof dst === 'string' && match(dst))) return orig(src, dst);
    armed = false;
    reached();
    await gate;
    return orig(src, dst);
  });
  return { atGate, release: () => release(), restore };
}

/** Hold the FIRST fs.promises.cp whose source and destination match `match(src, dst)` (snapshotScope copying a note). */
export function gateCopy(match) {
  let reached, release;
  const atGate = new Promise((r) => { reached = r; });
  const gate = new Promise((r) => { release = r; });
  let armed = true;
  const restore = patchFs('cp', (orig) => async (src, dst, ...a) => {
    if (!(armed && match(String(src), String(dst)))) return orig(src, dst, ...a);
    armed = false;
    reached();
    await gate;
    return orig(src, dst, ...a);
  });
  return { atGate, release: () => release(), restore };
}

/** Throw `code` from the FIRST node:fs renameSync whose destination matches (writeJsonAtomic's commit). */
export function failRenameSyncOnce(match, code = 'ENOSPC') {
  const fs = require('node:fs');
  const orig = fs.renameSync;
  let armed = true;
  fs.renameSync = (src, dst) => {
    if (armed && typeof dst === 'string' && match(dst)) { armed = false; throw Object.assign(new Error(`${code}: no space left on device`), { code }); }
    return orig(src, dst);
  };
  syncBuiltinESMExports();
  return () => { fs.renameSync = orig; syncBuiltinESMExports(); };
}

/** Call `fn` right AFTER the first node:fs renameSync whose destination matches (writeJsonAtomic's commit); restore(). */
export function afterRenameSyncOnce(match, fn) {
  const fs = require('node:fs');
  const orig = fs.renameSync;
  let armed = true;
  fs.renameSync = (src, dst) => {
    const r = orig(src, dst);
    if (armed && typeof dst === 'string' && match(dst)) { armed = false; fn(); }
    return r;
  };
  syncBuiltinESMExports();
  return () => { fs.renameSync = orig; syncBuiltinESMExports(); };
}

/** Hold the FIRST readFile of a path matching `match`: the real read is done at once, its result is handed back only
 *  after release(). `atGate` resolves when the caller is parked there. */
export function gateRead(match) {
  let reached, release;
  const atGate = new Promise((r) => { reached = r; });
  const gate = new Promise((r) => { release = r; });
  let armed = true;
  const restore = patchFs('readFile', (orig) => async (p, ...a) => {
    if (!(armed && typeof p === 'string' && match(p))) return orig(p, ...a);
    armed = false;
    let r;
    try { r = { v: await orig(p, ...a) }; } catch (e) { r = { e }; }
    reached();
    await gate;
    if (r.e) throw r.e;
    return r.v;
  });
  return { atGate, release: () => release(), restore };
}
