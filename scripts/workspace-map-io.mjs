// scripts/workspace-map-io.mjs — file IO shared by the four workspace-map cards (wsmap P2). Not a
// card: it has no sidecar, so the script registry never lists it. Reads are tolerant (a missing or
// unparsable input is null, never a throw); writes create their parent dir.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkerCommand } from '../src/core/workspace-map/check-cli.mjs';

/** A plain object (not null, not an array). */
export function isObj(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** `text` without a leading byte-order mark (an editor may write one before JSON). Compared by code
 *  point, so the source holds neither an escape sequence nor the invisible character itself. */
function noBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The parsed JSON of an input port's file (a leading BOM tolerated), or null: no port, no path, a
 *  missing file, bad JSON. An agent's output port always carries a path, even when the agent wrote
 *  nothing. */
export async function readJsonInput(input) {
  const path = input && typeof input.path === 'string' ? input.path : '';
  if (!path) return null;
  try {
    return JSON.parse(noBom(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}

export async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

export async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The allocated path of output `id`. The engine allocates every declared output, so a missing
 *  one is a programmer error — and a card without its output paths cannot write anything anyway. */
export function outPath(outputs, id) {
  const path = outputs && outputs[id] && outputs[id].path;
  if (typeof path !== 'string' || !path) throw new Error(`output "${id}" has no path`);
  return path;
}

/** The envelope's ctx.workspace as { id, name, members }: members sorted by key, each
 *  { key, name, dir, projectDir } — `dir` is the checkout, falling back to the live project dir;
 *  a member with neither is dropped. null when the run spans no workspace. */
export function workspaceOf(ctx) {
  const ws = ctx && ctx.workspace;
  if (!isObj(ws) || !Array.isArray(ws.members)) return null;
  const str = (v) => (typeof v === 'string' && v ? v : '');
  const members = ws.members
    .filter((m) => isObj(m) && str(m.key) && (str(m.dir) || str(m.projectDir)))
    .map((m) => ({ key: m.key, name: str(m.name) || m.key, dir: str(m.dir) || m.projectDir, projectDir: str(m.projectDir) || m.dir }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { id: str(ws.id) || null, name: str(ws.name) || null, members };
}

/** `promise`'s value, or `onTimeout` once `ms` passed (a rejection propagates; the timer is cleared
 *  either way). The extract card's deadline: past it the card writes its degraded document and the
 *  child exits, which ends the extraction still running behind it. */
export function withDeadline(promise, ms, onTimeout = null) {
  let timer;
  const deadline = new Promise((res) => { timer = setTimeout(() => res(onTimeout), ms); });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}

/** The checker command line a brief carries (P1 checkerCommand; the literal `<OUT>` token stays
 *  for the agent to replace). '' if it cannot be built — the brief still gets its first lines. */
export function checkerFor(kind, ref) {
  try {
    return String(checkerCommand(kind, { ref }));
  } catch {
    return '';
  }
}

/** The three first lines P1 pins for a brief. A card that could not build its real brief still
 *  writes them, so the agent (and the offline mock) can find the reference file. */
export function briefHead(title, marker, ref, checker) {
  return `# ${title}\n<!-- worca:${marker}=${ref} -->\n<!-- worca:check=${checker} -->\n`;
}
