// test/fixtures/office/make-fixtures.mjs — builds the Office fixtures the simplified preview tests read
// (ui/public/artifacts/office-*.mjs). Run by hand: `node test/fixtures/office/make-fixtures.mjs` rewrites the committed
// files; test/office-lite-fixtures.test.mjs checks they are what this builds (per entry, not per archive byte).
// Every package is hand-authored and minimal (ECMA-376 / ODF 1.3), packed by the pinned JSZip with a fixed date.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patchZip } from '../../helpers/office-lite-fixtures.mjs';

const JSZip = createRequire(import.meta.url)('jszip');
const DATE = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
const DIR = fileURLToPath(new URL('.', import.meta.url));

const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DML = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** A 1×1 PNG, padded after IEND to `size` bytes (still sniffed as PNG; nothing decodes it). */
export function png(size = 0) {
  const b = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  if (size <= b.length) return new Uint8Array(b);
  const out = new Uint8Array(size);
  out.set(b);
  for (let i = b.length; i < size; i++) out[i] = i % 251;
  return out;
}
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const wmf = () => new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

/** entries: [name, string | Uint8Array, { store?: true }?][] → zip bytes (DEFLATE unless `store`). */
async function pack(entries) {
  const zip = new JSZip();
  for (const [name, data, opts = {}] of entries) {
    zip.file(name, data, { date: DATE, binary: typeof data !== 'string', ...(opts.store ? { compression: 'STORE' } : {}) });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const rels = (list) => `${X}<Relationships xmlns="${PKG_REL}">${list.map(([id, type, target, ext]) =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"${ext ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
const types = (defaults, overrides = []) => `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
  + defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('')
  + overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') + '</Types>';

// ---------- docx ----------
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const docxTypes = (extra = []) => types([['png', 'image/png'], ...extra], [['/word/document.xml', `${WML}.document.main+xml`]]);
const topRels = rels([['rId1', `${REL}/officeDocument`, 'word/document.xml']]);
const para = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
const run = (text, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const body = (inner) => `${X}<w:document ${W} ${DML}><w:body>${inner}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
const drawing = (attr, id) => `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="${id}" name="Picture ${id}"/>`
  + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
  + `<pic:nvPicPr><pic:cNvPr id="${id}" name="p${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip ${attr}/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
  + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
  + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
const STYLES = `${X}<w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>';
const NUMBERING = `${X}<w:numbering ${W}>`
  + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
  + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
  + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
const THEME = `${X}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements>`
  + '<a:fontScheme name="F"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Georgia"/></a:minorFont></a:fontScheme>'
  + '</a:themeElements></a:theme>';
const listItem = (text, numId) => para(run(text), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`);
const cell = (text, extra = '') => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${extra}</w:tcPr>${para(run(text))}</w:tc>`;

async function memoDocx() {
  const doc = body([
    para(run('Quarterly memo'), '<w:pStyle w:val="Heading1"/>'),
    para(run('Plain lead, ') + run('bold words', '<w:b/>') + run(' then plain.')),
    `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>`
      + `<w:tr>${cell('Merged head', '<w:gridSpan w:val="2"/>')}${cell('Third')}</w:tr>`
      + `<w:tr>${cell('Cell A')}${cell('Cell B')}${cell('Cell C')}</w:tr></w:tbl>`,
    para(drawing('r:embed="rIdImg"', 1)),
    para(`<w:hyperlink r:id="rIdLink">${run('worca site')}</w:hyperlink>`),
    listItem('First step', 1), listItem('Second step', 1),
    listItem('A bullet', 2), listItem('Another bullet', 2),
  ].join(''));
  return pack([
    ['[Content_Types].xml', docxTypes()],
    ['_rels/.rels', topRels],
    ['word/document.xml', doc],
    ['word/_rels/document.xml.rels', rels([
      ['rIdStyles', `${REL}/styles`, 'styles.xml'], ['rIdNum', `${REL}/numbering`, 'numbering.xml'], ['rIdTheme', `${REL}/theme`, 'theme/theme1.xml'],
      ['rIdImg', `${REL}/image`, 'media/image1.png'], ['rIdLink', `${REL}/hyperlink`, 'https://worca.example/', true],
    ])],
    ['word/styles.xml', STYLES],
    ['word/numbering.xml', NUMBERING],
    ['word/theme/theme1.xml', THEME],
    ['word/media/image1.png', png()],
  ]);
}

async function refsDocx() {
  const blips = Array.from({ length: 40 }, (_, i) => drawing('r:embed="rIdBig"', i + 1)).join('');
  return pack([
    ['[Content_Types].xml', docxTypes()],
    ['_rels/.rels', topRels],
    ['word/document.xml', body(para(run('Forty references to one picture')) + para(blips))],
    ['word/_rels/document.xml.rels', rels([['rIdBig', `${REL}/image`, 'media/big.png']])],
    ['word/media/big.png', png(64 * 1024), { store: true }],
  ]);
}

async function hostileDocx() {
  const styles = `${X}<w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`
    + '<w:style w:type="paragraph" w:styleId="x}body{color:red"><w:name w:val="evil"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style></w:styles>';
  const doc = body([
    para(run('&lt;script&gt;alert(1)&lt;/script&gt;')),
    para(run('styled'), '<w:pStyle w:val="x}body{color:red"/>'),
    para(`<w:hyperlink r:id="rIdJs">${run('click me')}</w:hyperlink>`),
    para(drawing('r:embed="rIdRemote"', 1)),
  ].join(''));
  return pack([
    ['[Content_Types].xml', docxTypes()],
    ['_rels/.rels', topRels],
    ['word/document.xml', doc],
    ['word/_rels/document.xml.rels', rels([
      ['rIdStyles', `${REL}/styles`, 'styles.xml'],
      ['rIdJs', `${REL}/hyperlink`, 'javascript:alert(1)', true],
      ['rIdRemote', `${REL}/image`, 'https://evil.example/x.png', true],
    ])],
    ['word/styles.xml', styles],
  ]);
}

async function altchunkDocx() {
  return pack([
    ['[Content_Types].xml', docxTypes([['htm', 'text/html']])],
    ['_rels/.rels', topRels],
    ['word/document.xml', body(para(run('Before the chunk')) + '<w:altChunk r:id="rIdAlt"/>' + para(run('After the chunk')))],
    ['word/_rels/document.xml.rels', rels([['rIdAlt', `${REL}/aFChunk`, 'afchunk.htm']])],
    ['word/afchunk.htm', '<html><body><script>parent.pwned=1</script><img src="x" onerror="parent.pwned=2"><p>chunk text</p></body></html>'],
  ]);
}

// ---------- xlsx ----------
const SML = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const sheetXml = (rows) => `${X}<worksheet ${SML}><sheetData>${rows}</sheetData></worksheet>`;
function xlsxParts({ sheets, shared = null, styles = null, date1904 = false }) {
  const wb = `${X}<workbook ${SML}>${date1904 ? '<workbookPr date1904="1"/>' : ''}<sheets>`
    + sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rIdS${i + 1}"/>`).join('')
    + '</sheets></workbook>';
  const wbRels = [...sheets.map((_, i) => [`rIdS${i + 1}`, `${REL}/worksheet`, `worksheets/sheet${i + 1}.xml`])];
  if (shared) wbRels.push(['rIdSst', `${REL}/sharedStrings`, 'sharedStrings.xml']);
  if (styles) wbRels.push(['rIdSty', `${REL}/styles`, 'styles.xml']);
  return [
    ['[Content_Types].xml', types([], [['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml']])],
    ['_rels/.rels', rels([['rId1', `${REL}/officeDocument`, 'xl/workbook.xml']])],
    ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', rels(wbRels)],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)]),
    ...(shared ? [['xl/sharedStrings.xml', shared]] : []),
    ...(styles ? [['xl/styles.xml', styles]] : []),
  ];
}
const SHARED = `${X}<sst ${SML} count="3" uniqueCount="3"><si><t>Item</t></si>`
  + '<si><r><t xml:space="preserve">Rich </t></r><r><rPr><b/></rPr><t>text</t></r><rPh sb="0" eb="1"><t>PHONETIC</t></rPh></si><si><t>Total</t></si></sst>';
const BUDGET_STYLES = `${X}<styleSheet ${SML}><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="0.00E+00"/></numFmts>`
  + '<cellXfs count="8"><xf numFmtId="0"/><xf numFmtId="2"/><xf numFmtId="3"/><xf numFmtId="9"/><xf numFmtId="14"/><xf numFmtId="21"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';

async function budgetXlsx() {
  const s1 = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Inline</t></is></c>'
    + '<c r="D1" t="b"><v>1</v></c><c r="E1" t="b"><v>0</v></c><c r="F1" t="e"><v>#DIV/0!</v></c><c r="G1" t="str"><f>"Hel"&amp;"lo"</f><v>Hello</v></c></row>'
    + '<row r="2"><c r="A2" s="2"><v>1234</v></c><c r="B2" s="3"><v>0.12</v></c><c r="C2" s="4"><v>46037</v></c><c r="D2" s="5"><v>0.54524305555555552</v></c>'
    + '<c r="E2" s="6"><v>46037.5</v></c><c r="F2" s="1"><v>3.14159</v></c><c r="G2" s="7"><v>12345.678</v></c><c r="H2"><v>0.30000000000000004</v></c></row>'
    + '<row r="3"><c t="s"><v>2</v></c><c><v>7</v></c></row>'
    + '<row r="5"><c r="B5"><v>42</v></c></row>';
  const s2 = '<row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet</t></is></c></row>';
  const s3 = '<row r="1"><c r="A1" t="inlineStr"><is><t>Secret</t></is></c></row>';
  return pack(xlsxParts({
    sheets: [{ name: 'Budget', rows: s1 }, { name: 'Notes', rows: s2 }, { name: 'Hidden', state: 'hidden', rows: s3 }],
    shared: SHARED, styles: BUDGET_STYLES,
  }));
}

async function wideXlsx() {
  const rows = '<row r="1"><c r="A1"><v>1</v></c></row><row r="1005"><c r="DA1005" t="inlineStr"><is><t>far</t></is></c></row>';
  return pack(xlsxParts({ sheets: [{ name: 'Wide', rows }] }));
}

/** A small valid workbook (four parts) for the patched fixtures. */
const smallParts = (extraRows = '') => xlsxParts({ sheets: [{ name: 'S', rows: `<row r="1"><c r="A1"><v>1</v></c></row>${extraRows}` }] });

async function bombXlsx() {
  const bytes = await pack(smallParts());
  const sixty = 60 * 1024 * 1024;
  return patchZip(bytes, { sizes: { '[Content_Types].xml': sixty, '_rels/.rels': sixty, 'xl/workbook.xml': sixty, 'xl/worksheets/sheet1.xml': sixty } });
}

async function liarXlsx() {
  const filler = '<row r="2"><c r="A2"><v>2</v></c></row>'.repeat(1600);
  const parts = smallParts(filler);
  const sheet = parts.find(([n]) => n === 'xl/worksheets/sheet1.xml');
  sheet[1] = sheet[1].slice(0, -('</sheetData></worksheet>'.length)) + ' '.repeat(64 * 1024 - sheet[1].length) + '</sheetData></worksheet>';
  const bytes = await pack(parts);
  return patchZip(bytes, { sizes: { 'xl/worksheets/sheet1.xml': 1024 } });
}

async function dtdXlsx() {
  const shared = `${X}<!DOCTYPE sst [<!ENTITY boom "BOOM">]><sst ${SML} count="1" uniqueCount="1"><si><t>&boom;</t></si></sst>`;
  return pack(xlsxParts({ sheets: [{ name: 'S', rows: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }], shared }));
}

// ---------- ODF ----------
const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
  + ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"'
  + ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"'
  + ' xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"';
const odf = (mime, content, extra = []) => pack([
  ['mimetype', mime, { store: true }],
  ['META-INF/manifest.xml', `${X}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">`
    + `<manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`],
  ['content.xml', `${X}<office:document-content ${ODF_NS}>${content}</office:document-content>`],
  ...extra,
]);

async function tableOds() {
  const styles = '<office:automatic-styles><style:style style:name="taHidden" style:family="table"><style:table-properties table:display="false"/></style:style></office:automatic-styles>';
  const t1 = '<table:table table:name="Data">'
    + '<table:table-column table:number-columns-repeated="4"/>'
    + '<table:table-row><table:table-cell office:value-type="string"><text:p>Name</text:p></table:table-cell>'
    + '<table:table-cell table:number-columns-repeated="3" office:value-type="string"><text:p>x</text:p></table:table-cell></table:table-row>'
    + '<table:table-row table:number-rows-repeated="2"><table:table-cell office:value-type="float" office:value="1234.5"><text:p>1,234.50</text:p></table:table-cell></table:table-row>'
    + '<table:table-row><table:table-cell table:number-columns-spanned="2" office:value-type="string"><text:p>Wide</text:p></table:table-cell>'
    + '<table:covered-table-cell/><table:table-cell office:value-type="float" office:value="3"/><table:table-cell office:value-type="string"><text:p>line one</text:p><text:p>line two</text:p></table:table-cell></table:table-row>'
    + '<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>'
    + '</table:table>';
  const t2 = '<table:table table:name="Second"><table:table-row><table:table-cell office:value-type="string"><text:p>two</text:p></table:table-cell></table:table-row></table:table>';
  const t3 = '<table:table table:name="Ghost" table:style-name="taHidden"><table:table-row><table:table-cell office:value-type="string"><text:p>ghost</text:p></table:table-cell></table:table-row></table:table>';
  return odf('application/vnd.oasis.opendocument.spreadsheet', `${styles}<office:body><office:spreadsheet>${t1}${t2}${t3}</office:spreadsheet></office:body>`);
}

async function deckOdp() {
  const frame = (cls, inner) => `<draw:frame${cls ? ` presentation:class="${cls}"` : ''} svg:width="10cm" svg:height="2cm"><draw:text-box>${inner}</draw:text-box></draw:frame>`;
  const p1 = '<draw:page draw:name="p1">' + frame('title', '<text:p>Hello deck</text:p>') + frame('outline', '<text:list><text:list-item><text:p>First point</text:p></text:list-item></text:list>')
    + '<presentation:notes><draw:frame presentation:class="notes"><draw:text-box><text:p>Speaker secret</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>';
  const p2 = '<draw:page draw:name="p2">' + frame('title', '<text:p>Second page</text:p>') + '<draw:custom-shape><text:p>Shape text</text:p></draw:custom-shape>'
    + frame('', '<text:p>Body <text:span>text</text:span></text:p>') + '</draw:page>';
  return odf('application/vnd.oasis.opendocument.presentation', `<office:body><office:presentation>${p1}${p2}</office:presentation></office:body>`,
    [['Thumbnails/thumbnail.png', png()]]);
}

async function notesOdt() {
  const t = '<text:h text:outline-level="1">Release notes</text:h>'
    + '<text:h text:outline-level="2">What changed</text:h>'
    + '<text:p>a<text:s text:c="3"/>b<text:tab/>c</text:p>'
    + '<text:p>See the note<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Footnote secret</text:p></text:note-body></text:note> here.</text:p>'
    + '<text:list><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p><text:list><text:list-item><text:p>two-a</text:p></text:list-item></text:list></text:list-item></text:list>'
    + '<table:table table:name="T"><table:table-row><table:table-cell><text:p>cell text</text:p></table:table-cell></table:table-row></table:table>'
    + '<text:section text:name="S"><text:p>In a section<office:annotation><text:p>Annotation secret</text:p></office:annotation></text:p></text:section>'
    + '<text:h text:outline-level="9">Deep</text:h>';
  return odf('application/vnd.oasis.opendocument.text', `<office:body><office:text>${t}</office:text></office:body>`);
}

// ---------- pptx ----------
const PML = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const sp = (ph, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:spPr/>`
  + `<p:txBody><a:bodyPr/>${paras.map((t) => `<a:p>${t}</a:p>`).join('')}</p:txBody></p:sp>`;
const r = (t) => `<a:r><a:t>${t}</a:t></a:r>`;
const slide = (inner, hidden = false) => `${X}<p:sld ${PML}${hidden ? ' show="0"' : ''}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld></p:sld>`;
function pptxParts(slides, thumb) {
  const pres = `${X}<p:presentation ${PML}><p:sldIdLst>${slides.map((s, i) => `<p:sldId id="${256 + i}" r:id="${s.rid}"/>`).join('')}</p:sldIdLst></p:presentation>`;
  return [
    ['[Content_Types].xml', types([['jpeg', 'image/jpeg'], ['wmf', 'image/x-wmf']], [['/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml']])],
    ['_rels/.rels', rels([['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'], ['rId2', `${PKG_REL}/metadata/thumbnail`, thumb[0]]])],
    ['ppt/presentation.xml', pres],
    ['ppt/_rels/presentation.xml.rels', rels(slides.map((s) => [s.rid, `${REL}/slide`, `slides/${s.file}`]))],
    ...slides.map((s) => [`ppt/slides/${s.file}`, s.xml]),
    [thumb[0], thumb[1]],
  ];
}

async function deckPptx() {
  const intro = slide(sp('ctrTitle', [r('Intro')]) + sp('subTitle', [r('Welcome all')])
    + `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${sp('', [r('Grouped text')])}</p:grpSp>`);
  const data = slide(sp('title', [r('Data')]) + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:p>' + r('Q1') + '</a:p></a:txBody></a:tc>'
    + '<a:tc><a:txBody><a:bodyPr/><a:p>' + r('Q2') + '</a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>');
  const backup = slide(sp('title', [r('Backup')]) + sp('body', [`${r('Line one')}<a:br/>${r('Line two')}`, '']), true);
  // sldIdLst order differs from file-name order: slide2.xml is shown first.
  return pack(pptxParts([
    { rid: 'rIdB', file: 'slide2.xml', xml: intro }, { rid: 'rIdA', file: 'slide1.xml', xml: data }, { rid: 'rIdC', file: 'slide3.xml', xml: backup },
  ], ['docProps/thumbnail.jpeg', jpeg()]));
}

async function deckWmfPptx() {
  return pack(pptxParts([{ rid: 'rIdA', file: 'slide1.xml', xml: slide(sp('title', [r('Only slide')])) }], ['docProps/thumbnail.wmf', wmf()]));
}

/** name → builder; the generator's whole output. */
export const FIXTURES = Object.freeze({
  'memo.docx': memoDocx, 'refs.docx': refsDocx, 'hostile.docx': hostileDocx, 'altchunk.docx': altchunkDocx,
  'budget.xlsx': budgetXlsx, 'wide.xlsx': wideXlsx, 'bomb.xlsx': bombXlsx, 'liar.xlsx': liarXlsx, 'dtd.xlsx': dtdXlsx,
  'table.ods': tableOds, 'deck.pptx': deckPptx, 'deck.odp': deckOdp, 'deck-wmf.pptx': deckWmfPptx, 'notes.odt': notesOdt,
});

export async function buildFixtures() {
  const out = {};
  for (const [name, build] of Object.entries(FIXTURES)) out[name] = await build();
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  for (const [name, bytes] of Object.entries(await buildFixtures())) {
    writeFileSync(DIR + name, bytes);
    console.log(`${name} ${bytes.length} bytes`);
  }
}
