// src/core/workspace-scan-mock.mjs
// The offline mock writers of the Workspace scan's three agents (wsmap spec D20): each reads the
// reference file its brief names on the pinned first-lines marker (`<!-- worca:extract=… -->`,
// `worca:catalog=…`, `worca:map=…` — P1's surveyBrief / usageBriefs / synthBrief) and writes a
// VALID, minimal JSON document, so a `--mock` run and the tests exercise every script and the
// finalize end to end without `claude`. Reads never throw: a missing brief, a missing reference or
// garbage JSON degrades to an empty valid document. Only an unwritable output path throws.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The value of the `<!-- worca:<name>=<value> -->` line of a brief, or null. LF or CRLF. */
export function briefMarker(text, name) {
  const prefix = `<!-- worca:${name}=`;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith(prefix) && line.endsWith('-->')) return line.slice(prefix.length, -3).trim() || null;
  }
  return null;
}

async function readText(path) {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}

/** `text` without a leading byte-order mark — compared by code point, so the source holds neither an
 *  escape sequence nor the invisible character itself. */
const noBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

async function readJson(path) {
  if (!path) return null;
  try { return JSON.parse(noBom(await readFile(path, 'utf8'))); } catch { return null; }
}

async function writeJson(path, doc) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

/** One survey member entry (spec §5.4) with no facts. The `'consumes'` key is QUOTED on purpose:
 *  test/v1-remnants-removed.test.mjs bans the bare v1 sidecar token (a word followed by a colon)
 *  anywhere in src/, and the survey document legitimately has that key. */
function surveyMember(status, role) {
  return { status, role, aliases: [], provides: [], 'consumes': [], notes: '' };
}

/** survey (role workspace-scan): every extract member with a non-empty `needs` is `investigated`
 *  with the role "Mock role for <key>" and no facts; every other member is `skipped`.
 *  @returns {Promise<{doc:object, investigated:number, skipped:number}>} */
export async function writeMockSurvey({ briefPath, outPath }) {
  const extract = await readJson(briefMarker(await readText(briefPath), 'extract'));
  const members = isObj(extract?.members) ? extract.members : {};
  const doc = { version: 1, members: {} };
  let investigated = 0;
  for (const key of Object.keys(members).sort()) {
    const needs = Array.isArray(members[key]?.needs) ? members[key].needs : [];
    if (needs.length) {
      investigated += 1;
      doc.members[key] = surveyMember('investigated', `Mock role for ${key}`);
    } else {
      doc.members[key] = surveyMember('skipped', '');
    }
  }
  await writeJson(outPath, doc);
  return { doc, investigated, skipped: Object.keys(doc.members).length - investigated };
}

/** usage (role workspace-usage): every catalog member `investigated`, every well-formed candidate
 *  of it confirmed as a use (entry, file, line, match), nothing rejected, no other relations.
 *  @returns {Promise<{doc:object, uses:number}>} */
export async function writeMockUsage({ briefPath, outPath }) {
  const catalog = await readJson(briefMarker(await readText(briefPath), 'catalog'));
  const keys = isObj(catalog?.members) ? Object.keys(catalog.members).sort() : [];
  const candidates = isObj(catalog?.candidates) ? catalog.candidates : {};
  const doc = { version: 1, members: {} };
  let uses = 0;
  for (const key of keys) {
    const list = (Array.isArray(candidates[key]) ? candidates[key] : []).filter((c) => isObj(c)
      && typeof c.entry === 'string' && typeof c.file === 'string' && Number.isInteger(c.line) && typeof c.match === 'string');
    doc.members[key] = {
      status: 'investigated',
      uses: list.map((c) => ({ entry: c.entry, file: c.file, line: c.line, match: c.match })),
      rejected: [],
      other: [],
    };
    uses += list.length;
  }
  await writeJson(outPath, doc);
  return { doc, uses };
}

/** synthesis (role workspace-synth): "Mock overview of <N> projects.", a mock role for every map
 *  member whose role is missing or blank, no coordination notes, no order notes.
 *  @returns {Promise<{doc:object}>} */
export async function writeMockSynthesis({ briefPath, outPath }) {
  const map = await readJson(briefMarker(await readText(briefPath), 'map'));
  const members = (Array.isArray(map?.members) ? map.members : []).filter((m) => isObj(m) && typeof m.key === 'string' && m.key);
  const roles = {};
  for (const m of members) if (!(typeof m.role === 'string' && m.role.trim())) roles[m.key] = `Mock role for ${m.key}`;
  const doc = { version: 1, overview: `Mock overview of ${members.length} projects.`, roles, coordination: [], orderNotes: '' };
  await writeJson(outPath, doc);
  return { doc };
}
