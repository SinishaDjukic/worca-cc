// src/core/design/watch.mjs
// The live signal of an engine without token streaming (P8 Task 4, L8.5, L8.23): the disk is its only source of
// `design-file` landings. One non-recursive `fs.watch` per folder that can hold a drawn file (work/, work/sections/,
// each sections/<id>/), never `recursive`: on Linux Node's recursive walker rethrows ENOSPC or EACCES from its own
// event callback, which nothing catches (L8.29). A baseline taken at `start()` keeps a Continue from re-sending every
// file. Events are debounced per path with a hard max wait. `rescan()` re-reads every drawn file: the build calls it
// at every tool result and agent exit, so a folder whose watch failed, or a filesystem that reports nothing (a network
// mount), still lands. Which paths count is `classifyDraftPath`'s call alone; whether a landing reaches the stage
// (the plan's sections only, never text already landed) is the build's (`_onWatchLand`).

import { lstatSync, readdirSync, watch } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyDraftPath } from './draft.mjs';
import { isSectionId } from './ids.mjs';

const LEAD_FILES = Object.freeze(['tokens.css', 'global.css']);
const SECTION_FILES = Object.freeze(['index.html', 'style.css', 'script.js']);

/** Size and both times: a same-size edit on a filesystem with coarse mtimes still moves `ctimeMs`. */
const fingerprint = (st) => `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
const sectionFiles = (id) => SECTION_FILES.map((f) => `sections/${id}/${f}`);
const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

/**
 * @param {{ workDir: string, onLand: (rel: string, o: { gone: boolean }) => void, debounceMs?: number,
 *   maxWaitMs?: number, watchImpl?: typeof watch, log?: (line: string) => void }} opts
 * @returns {{ start: () => void, rescan: () => Promise<number>, close: () => void, drop: (sectionId: string) => void,
 *   readonly degraded: boolean }}
 *
 * - `onLand(rel, {gone: false})` for a regular file (`lstat`: never a link, a FIFO or a folder) whose
 *   `ino:size:mtimeMs:ctimeMs` differs from the last seen; `{gone: true}` once for a seen file now missing, which is
 *   then forgotten. An error other than ENOENT (EACCES on an unreadable folder) skips the path, never a `gone`. A throw
 *   from `onLand` is logged and counts as landed.
 * - A folder whose watch throws or reports `'error'` is degraded: its handle is closed, it is logged once with the
 *   code, and only `rescan()` covers it. A folder whose inode changed (deleted and made again) is watched again.
 * - `rescan()` never rejects and resolves the count landed; one scan runs at a time, and every call during a scan
 *   shares one follow-up scan after it. After `close()` it resolves 0.
 * - `drop(sectionId)` closes that section folder's watch and forgets its files, before the build removes the folder
 *   (a watched folder deleted on Windows raises EPERM, and its pending delete can refuse a new folder of that name).
 * - `close()` is idempotent: every handle and timer goes, and a scan in flight lands nothing more.
 */
export function createWorkWatcher({ workDir, onLand, debounceMs = 150, maxWaitMs = 1000, watchImpl = watch, log = console.warn } = {}) {
  /** Folder (work-relative, '' for work/) -> `{handle, ino, degraded, logged}`. */
  const folders = new Map();
  /** Path -> the fingerprint it last landed (or had at the baseline). */
  const seen = new Map();
  /** Path -> its debounce timers: `trail` (restarted by each event) and `hard` (from its first pending event). */
  const pending = new Map();
  let rescanTimer = null;
  let started = false;
  let closed = false;
  /** The scan running now, and the one follow-up every rescan during it shares. */
  let running = null;
  let followUp = null;

  const abs = (rel) => (rel ? join(workDir, ...rel.split('/')) : workDir);

  function land(rel, gone) {
    try {
      onLand(rel, { gone });
    } catch (err) {
      log(`[design] watch: landing ${rel} failed: ${messageOf(err)}`);
    }
  }

  function closeHandle(entry) {
    const h = entry.handle;
    entry.handle = null;
    try { h?.close(); } catch { /* already closed */ }
  }

  function degrade(dirRel, entry, err) {
    if (folders.get(dirRel) !== entry) return;
    entry.degraded = true;
    closeHandle(entry);
    if (entry.logged) return;
    entry.logged = true;
    log(`[design] watch: ${dirRel || 'work'}/ is not watched (${err?.code ?? messageOf(err)}); rescans cover it`);
  }

  /** Watches folder `dirRel` (inode `ino`), unless it already is: a new inode closes the old watch first. */
  function watchFolder(dirRel, ino) {
    const had = folders.get(dirRel);
    if (had && had.ino === ino) return;
    if (had) closeHandle(had);
    const entry = { handle: null, ino, degraded: false, logged: false };
    folders.set(dirRel, entry);
    try {
      const handle = watchImpl(abs(dirRel), { persistent: false }, (_type, name) => onEvent(dirRel, entry, name));
      entry.handle = handle;
      handle.on('error', (err) => degrade(dirRel, entry, err));
    } catch (err) {
      degrade(dirRel, entry, err);
    }
  }

  function forget(dirRel) {
    const had = folders.get(dirRel);
    if (!had) return;
    closeHandle(had);
    folders.delete(dirRel);
  }

  /** A folder that appeared, went or was replaced: a real folder (never a link) is watched by its inode; a missing
   *  one, or anything else in its place, loses its watch. An unreadable parent leaves it as it is. */
  function followFolder(dirRel) {
    let st;
    try {
      st = lstatSync(abs(dirRel));
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') forget(dirRel);
      return;
    }
    if (st.isDirectory()) watchFolder(dirRel, st.ino);
    else forget(dirRel);
  }

  function onEvent(dirRel, entry, name) {
    if (closed || folders.get(dirRel) !== entry) return;
    if (name == null || name === '') { scheduleRescan(); return; }
    const sub = String(name).replace(/\\/g, '/');
    const segs = sub.split('/');
    if (segs.some((s) => !s || s.startsWith('.'))) return;
    const rel = dirRel ? `${dirRel}/${sub}` : sub;
    if (rel === 'sections' || (dirRel === 'sections' && segs.length === 1 && isSectionId(sub))) {
      followFolder(rel);
      scheduleRescan();
      return;
    }
    if (classifyDraftPath(rel)) schedule(rel);
  }

  function scheduleRescan() {
    if (rescanTimer || closed) return;
    rescanTimer = setTimeout(() => { rescanTimer = null; void rescan(); }, debounceMs);
  }

  function schedule(rel) {
    let p = pending.get(rel);
    if (!p) {
      p = { trail: null, hard: setTimeout(() => fire(rel), maxWaitMs) };
      pending.set(rel, p);
    }
    clearTimeout(p.trail);
    p.trail = setTimeout(() => fire(rel), debounceMs);
  }

  function unschedule(rel) {
    const p = pending.get(rel);
    if (!p) return;
    clearTimeout(p.trail);
    clearTimeout(p.hard);
    pending.delete(rel);
  }

  function fire(rel) {
    if (!pending.has(rel)) return;
    unschedule(rel);
    void check(rel);
  }

  /** 1 when `rel` landed, else 0. The compare and the landing run in one turn after the `lstat`, so an event's check
   *  and a scan's never land one change twice. */
  async function check(rel) {
    let st = null;
    try {
      st = await lstat(abs(rel));
    } catch (err) {
      if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') return 0;
    }
    if (closed) return 0;
    if (!st) {
      if (!seen.has(rel)) return 0;
      seen.delete(rel);
      land(rel, true);
      return 1;
    }
    if (!st.isFile()) return 0;
    const fp = fingerprint(st);
    if (seen.get(rel) === fp) return 0;
    seen.set(rel, fp);
    land(rel, false);
    return 1;
  }

  /** Every drawn file: the two global ones, the three of each real `sections/<id>/` folder, and every seen path (so a
   *  removed folder's files send their `gone`). Each section folder is watched again here if its watch is missing or
   *  its inode changed, and a watched folder that is gone loses its handle. */
  async function scanAll() {
    if (closed) return 0;
    const paths = new Set(LEAD_FILES);
    let names = null;
    try {
      names = (await readdir(abs('sections'))).sort();
    } catch { /* no sections/ yet, or unreadable */ }
    if (closed) return 0;
    if (names) followFolder('sections');
    else names = [];
    const present = new Set();
    for (const name of names) {
      if (!isSectionId(name)) continue;
      const dirRel = `sections/${name}`;
      let st;
      try { st = await lstat(abs(dirRel)); } catch { continue; }
      if (closed) return 0;
      if (!st.isDirectory()) continue;
      present.add(dirRel);
      watchFolder(dirRel, st.ino);
      for (const rel of sectionFiles(name)) paths.add(rel);
    }
    for (const dirRel of [...folders.keys()]) {
      if (dirRel.startsWith('sections/') && !present.has(dirRel)) forget(dirRel);
    }
    for (const rel of seen.keys()) paths.add(rel);
    let n = 0;
    for (const rel of paths) n += await check(rel);
    return n;
  }

  function scanOnce() {
    const p = scanAll().catch((err) => {
      log(`[design] watch: rescan failed: ${messageOf(err)}`);
      return 0;
    });
    running = p;
    p.then(() => { if (running === p) running = null; });
    return p;
  }

  function rescan() {
    if (closed) return Promise.resolve(0);
    if (followUp) return followUp;
    if (running) {
      followUp = running.then(() => {
        followUp = null;
        return scanOnce();
      });
      return followUp;
    }
    return scanOnce();
  }

  /** The baseline, synchronously: every drawn file already there is seen, and lands only once it changes. */
  function baseline(ids) {
    for (const rel of [...LEAD_FILES, ...ids.flatMap(sectionFiles)]) {
      try {
        const st = lstatSync(abs(rel));
        if (st.isFile()) seen.set(rel, fingerprint(st));
      } catch { /* not there yet */ }
    }
  }

  function sectionIds() {
    let names = [];
    try { names = readdirSync(abs('sections')).sort(); } catch { return []; }
    return names.filter((name) => {
      if (!isSectionId(name)) return false;
      try { return lstatSync(abs(`sections/${name}`)).isDirectory(); } catch { return false; }
    });
  }

  return {
    start() {
      if (started || closed) return;
      started = true;
      const ids = sectionIds();
      baseline(ids);
      followFolder('');
      followFolder('sections');
      for (const id of ids) followFolder(`sections/${id}`);
    },
    rescan,
    drop(sectionId) {
      forget(`sections/${sectionId}`);
      for (const rel of sectionFiles(sectionId)) {
        unschedule(rel);
        seen.delete(rel);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(rescanTimer);
      rescanTimer = null;
      for (const rel of [...pending.keys()]) unschedule(rel);
      for (const entry of folders.values()) closeHandle(entry);
      folders.clear();
    },
    get degraded() {
      for (const entry of folders.values()) if (entry.degraded) return true;
      return false;
    },
  };
}
