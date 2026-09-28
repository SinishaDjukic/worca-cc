// src/core/workspace-map/check-cli.mjs
// The agents' self-check (spec D19). An agent writes survey.json / usage.json / synthesis.json,
// runs this file against it, and fixes every line it prints until it prints OK:
//   node check-cli.mjs survey    <file> --extract <extract.json>
//   node check-cli.mjs usage     <file> --catalog <catalog.json>
//   node check-cli.mjs synthesis <file> --map     <workspace-map.json>
// exit 0 + "OK" | exit 1 + ≤ 50 error lines | exit 2 usage error. Member keys and entry ids come
// from the reference file. A missing or unparsable <file> is exit 1 "file: …".

import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSurvey, checkSynthesis, checkUsage } from '../../shared/workspace-map/schema.mjs';

const SELF = fileURLToPath(import.meta.url);
const REF_FLAG = Object.freeze({ survey: 'extract', usage: 'catalog', synthesis: 'map' });
const MAX_LINES = 50;

/** → `"<node>" "<this file>" <kind> "<OUT>" --<refFlag> "<ref>"`. The literal token <OUT> is left
 *  for the agent to replace with its output path (the briefs say so). */
export function checkerCommand(kind, { ref } = {}) {
  const flag = Object.hasOwn(REF_FLAG, kind) ? REF_FLAG[kind] : null;
  if (!flag) throw new TypeError(`checkerCommand: unknown kind ${kind}`);
  return `"${process.execPath}" "${SELF}" ${kind} "<OUT>" --${flag} "${ref}"`;
}

async function readJson(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function refOf(kind, doc) {
  if (kind === 'survey') return { memberKeys: Object.keys(doc?.members || {}) };
  if (kind === 'usage') {
    return { memberKeys: Object.keys(doc?.members || {}), entryIds: new Set((Array.isArray(doc?.entries) ? doc.entries : []).map((e) => e?.id).filter(Boolean)) };
  }
  return { memberKeys: (Array.isArray(doc?.members) ? doc.members : []).map((m) => m?.key).filter(Boolean) };
}

/** → exit code. `print` receives every output line (stdout by default). */
export async function main(argv, { print: write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  // One physical line per message: a JSON parse error or an echoed key may hold newlines (and a line reading OK).
  const print = (line) => write(String(line).replace(/[\r\n]+/g, ' '));
  const args = Array.isArray(argv) ? argv : [];
  const [kind, file, flag, ref] = args;
  if (!Object.hasOwn(REF_FLAG, kind) || !file || flag !== `--${REF_FLAG[kind]}` || !ref || args.length !== 4) {
    print('usage: check-cli.mjs survey <file> --extract <extract.json> | usage <file> --catalog <catalog.json> | synthesis <file> --map <workspace-map.json>');
    return 2;
  }
  let refDoc;
  try {
    refDoc = await readJson(ref);
  } catch (err) {
    print(`--${REF_FLAG[kind]}: cannot read ${ref}: ${err.message}`);
    return 2;
  }
  let doc;
  try {
    doc = await readJson(file);
  } catch (err) {
    print(`file: ${err.code === 'ENOENT' ? `${file} does not exist` : `${file} is not valid JSON (${err.message})`}`);
    return 1;
  }
  const check = kind === 'survey' ? checkSurvey : kind === 'usage' ? checkUsage : checkSynthesis;
  const { ok, errors } = check(doc, refOf(kind, refDoc));
  if (ok) { print('OK'); return 0; }
  const shown = errors.length > MAX_LINES ? errors.slice(0, MAX_LINES - 1) : errors;
  // One physical line per error: a member key or entry id holding a newline (echoed in the path)
  // must neither break the ≤ 50-line promise nor print a line reading "OK".
  for (const e of shown) print(e);
  if (errors.length > shown.length) print(`… and ${errors.length - shown.length} more errors`);
  return 1;
}

async function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return (await realpath(resolve(process.argv[1]))) === (await realpath(SELF));
  } catch {
    return false;
  }
}

if (await invokedDirectly()) {
  process.exitCode = await main(process.argv.slice(2));
}
