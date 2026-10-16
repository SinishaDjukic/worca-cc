// test/drawio.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeDrawio } from '../src/core/drawio.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createPipeline, listRunArtifacts } from '../src/core/artifacts.mjs';

useTempHome(after);

const PAGE1 = '<mxGraphModel><root><mxCell id="0"/><mxCell id="2" value="Start &amp; go" style="ellipse" vertex="1" parent="0"/></root></mxGraphModel>';
const PAGE2 = '<mxGraphModel><root><mxCell id="0"/><mxCell id="3" value="Ünïcode?" style="rhombus" vertex="1" parent="0"/></root></mxGraphModel>';
/** What draw.io writes by default: base64(deflateRaw(encodeURIComponent(xml))). */
const pack = (xml) => deflateRawSync(Buffer.from(encodeURIComponent(xml), 'utf8')).toString('base64');
const file = (...bodies) => `<mxfile host="app.diagrams.net">${bodies.map((b, i) =>
  `<diagram id="d${i}" name="Page-${i + 1}">${b}</diagram>`).join('')}</mxfile>`;

test('decodeDrawio inflates every compressed page in place and keeps the page attributes', () => {
  const out = decodeDrawio(file(pack(PAGE1), `\n  ${pack(PAGE2)}\n`));
  assert.equal(out, `<mxfile host="app.diagrams.net"><diagram id="d0" name="Page-1">${PAGE1}</diagram>`
    + `<diagram id="d1" name="Page-2">${PAGE2}</diagram></mxfile>`);
});

test('decodeDrawio decodes only the compressed pages of a mixed file', () => {
  assert.equal(decodeDrawio(file(PAGE1, pack(PAGE2))), file(PAGE1, PAGE2));
});

test('decodeDrawio returns null when there is nothing to decode', () => {
  assert.equal(decodeDrawio(file(PAGE1)), null, 'already uncompressed');
  assert.equal(decodeDrawio('<project><build/></project>'), null, 'an .xml that is not draw.io');
  assert.equal(decodeDrawio(file('')), null, 'an empty page');
});

test('decodeDrawio throws on a corrupt payload', () => {
  assert.throws(() => decodeDrawio(file('bm90IGRlZmxhdGU=')));
});

test('createPipeline writes <name>.decoded.xml beside a compressed draw.io attachment and indexes it', async () => {
  const src = mkdtempSync(join(tmpdir(), 'drawio-'));
  writeFileSync(join(src, 'flow.drawio'), file(pack(PAGE1)));
  writeFileSync(join(src, 'plain.drawio'), file(PAGE1));
  writeFileSync(join(src, 'flow.puml'), '@startuml\nstart\n:A;\nstop\n@enduml\n');
  const { id, dir } = await createPipeline(gitDir('drawio'), {
    prompt: 'build it', extras: ['flow.drawio', 'plain.drawio', 'flow.puml'].map((f) => join(src, f)),
  });
  assert.equal(readFileSync(join(dir, 'extras', 'flow.drawio.decoded.xml'), 'utf8'), file(PAGE1));
  assert.equal(readFileSync(join(dir, 'extras', 'flow.drawio'), 'utf8'), file(pack(PAGE1)), 'the original is untouched');
  assert.equal(existsSync(join(dir, 'extras', 'plain.drawio.decoded.xml')), false, 'nothing to decode, no sibling');
  assert.equal(existsSync(join(dir, 'extras', 'flow.puml.decoded.xml')), false, 'PlantUML is already text');
  const rels = (await listRunArtifacts(id)).map((a) => a.relPath);
  assert.ok(rels.includes('extras/flow.drawio.decoded.xml'), 'the sibling is a recorded extra');
});

test('a corrupt compressed draw.io attachment never fails run creation', async () => {
  const src = mkdtempSync(join(tmpdir(), 'drawio-bad-'));
  writeFileSync(join(src, 'bad.drawio'), file('bm90IGRlZmxhdGU='));
  const { dir } = await createPipeline(gitDir('drawio-bad'), { prompt: 'x', extras: [join(src, 'bad.drawio')] });
  assert.equal(existsSync(join(dir, 'extras', 'bad.drawio')), true);
  assert.equal(existsSync(join(dir, 'extras', 'bad.drawio.decoded.xml')), false);
});
