// src/core/agent-groups.mjs
// #1144: the agent process groups a host (the UI server, a CLI run) leaves behind when it is SIGKILLed.
//
// superviseSpawn starts every harness child as the leader of its own process group (POSIX) and kills the
// groups still running from a synchronous 'exit' listener. A host killed with SIGKILL (the Linux OOM
// killer, `kill -9`) never runs that listener, and a detached group does not die with its parent: the
// agent and every background job it started keep running, holding memory, after the host is gone. Under a
// memory cap (WSL2) that makes the next kill come sooner.
//
// So each host also records its live groups in <worcaHome>/agent-groups/<ownerPid>.json, one file per
// host so a server and a CLI run never write the same file, and the server's boot maintenance reaps the
// groups whose owner is dead (reapAgentGroups). A row also carries the kernel boot id: after a reboot
// (a `wsl --shutdown`) its pids may belong to anyone, so such a file is dropped without killing anything.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** The one folder for the per-host files. */
export const agentGroupsDir = (home) => join(home, 'agent-groups');

let cachedBootId;
/** Linux's per-boot id; null where there is none (macOS), and the boot check is then skipped. */
export function currentBootId() {
  if (cachedBootId === undefined) {
    try { cachedBootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null; } catch { cachedBootId = null; }
  }
  return cachedBootId;
}

/**
 * The host's record of its live groups. Every write is best-effort and synchronous (the record is
 * small, and the 'exit' path cannot await); the file is removed once the last group has ended.
 * @param {{dir: () => string, ownerPid?: number, bootId?: () => string|null, now?: () => number}} o
 */
export function createGroupTracker({ dir, ownerPid = process.pid, bootId = currentBootId, now = Date.now }) {
  const rows = new Map();
  const fileOf = () => join(dir(), `${ownerPid}.json`);
  const write = () => {
    try {
      const file = fileOf();
      if (!rows.size) { rmSync(file, { force: true }); return; }
      mkdirSync(dir(), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify([...rows.values()]));
      renameSync(`${file}.tmp`, file);
    } catch { /* best-effort: the in-process 'exit' reaper still covers a host that exits normally */ }
  };
  return {
    add(pgid, { bin = null } = {}) {
      rows.set(pgid, { pgid, ownerPid, bootId: bootId(), startedAt: now(), bin });
      write();
    },
    delete(pgid) {
      if (rows.delete(pgid)) write();
    },
    /** The host is exiting and has killed its groups itself: nothing is left to reap. */
    clear() {
      if (!rows.size) return;
      rows.clear();
      write();
    },
  };
}

const defaultAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** The pid still leads its own group: a recycled pid that is an ordinary process is never a target. */
async function defaultGroupLeader(pid) {
  const r = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 && Number(r.stdout.trim()) === pid;
}
const defaultKill = (pgid) => { try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ } };

/**
 * Boot: kill the groups a dead host left behind and delete its file. A live host's file (a CLI run
 * still going) and this process's own file stay. Never throws.
 * @returns {Promise<{reaped:number, files:number}>} groups killed, files of dead hosts removed
 */
export async function reapAgentGroups({ dir, ownerPid = process.pid, bootId = currentBootId(),
  isAlive = defaultAlive, isGroupLeader = defaultGroupLeader, kill = defaultKill } = {}) {
  let names = [];
  try { names = readdirSync(dir); } catch { return { reaped: 0, files: 0 }; }
  let reaped = 0;
  let files = 0;
  for (const name of names) {
    const m = /^(\d+)\.json$/.exec(name);
    if (!m) continue;
    const owner = Number(m[1]);
    if (owner === ownerPid) continue;
    const file = join(dir, name);
    let list = [];
    try { const rows = JSON.parse(readFileSync(file, 'utf8')); if (Array.isArray(rows)) list = rows; } catch { /* unreadable: nothing to kill */ }
    // A file from an earlier boot: its owner is dead, whoever holds that pid now.
    const sameBoot = (r) => !bootId || !r?.bootId || r.bootId === bootId;
    const fromEarlierBoot = list.length > 0 && !list.some(sameBoot);
    if (!fromEarlierBoot && isAlive(owner)) continue;
    for (const r of list) {
      const pgid = Number(r?.pgid);
      if (!Number.isSafeInteger(pgid) || pgid <= 1 || !sameBoot(r)) continue;
      try {
        if (isAlive(pgid) && await isGroupLeader(pgid)) { kill(pgid); reaped++; }
      } catch { /* one bad row must not stop the sweep */ }
    }
    try { rmSync(file, { force: true }); files++; } catch { /* best-effort */ }
  }
  return { reaped, files };
}
