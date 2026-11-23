// ui/public/artifacts/office-slides.mjs — presentations for the simplified Office preview: .pptx and .odp → the embedded
// thumbnail (PNG, JPEG or GIF by magic bytes, when there is one), then each slide's title and text, in order. Speaker notes
// are skipped. The thumbnail is bytes plus its sniffed type: the renderer makes (and later revokes) the URL.
import { attr, descendants, kid, kids, odfText, relId, relsOf, resolvePart, sniffImageType } from './office-xml.mjs';
import { OfficeLiteError } from './office-zip.mjs';

async function thumbnailOf(zip, path) {
  if (!path || !zip.has(path)) return null;
  const bytes = await zip.bytes(path);
  const type = sniffImageType(bytes);
  if (!type) return null;
  bytes.type = type;
  return bytes;
}

/** An a:p's text: its a:t runs (fields included), a:br → newline. */
function drawingParagraph(p) {
  let s = '';
  for (const el of p.getElementsByTagNameNS('*', '*')) {
    if (el.localName === 't') s += el.textContent;
    else if (el.localName === 'br') s += '\n';
  }
  return s;
}

const elements = (el) => [...el.childNodes].filter((n) => n.nodeType === 1);

/** .pptx → SlidesModel. */
export async function readPptx(zip, DOMParserCtor, _limits) {
  const PRES = 'ppt/presentation.xml';
  if (!zip.has(PRES)) throw new OfficeLiteError('UNREADABLE', 'no presentation');
  const pres = (await zip.xml(PRES, DOMParserCtor)).documentElement;
  const rels = await relsOf(zip, PRES, DOMParserCtor);
  const slides = [];
  for (const sid of kids(kid(pres, 'sldIdLst'), 'sldId')) {
    const rel = rels.get(relId(sid) || '');
    if (!rel || rel.external) continue;
    const path = resolvePart(PRES, rel.target);
    if (!zip.has(path)) continue;
    const root = (await zip.xml(path, DOMParserCtor)).documentElement;
    let title = null;
    const paragraphs = [];
    const walk = (tree) => {
      for (const el of elements(tree)) {
        if (el.localName === 'grpSp') { walk(el); continue; }
        if (el.localName !== 'sp' && el.localName !== 'graphicFrame') continue;
        const ph = el.localName === 'sp' ? kid(kid(kid(el, 'nvSpPr'), 'nvPr'), 'ph') : null;
        const texts = descendants(el, 'p').map(drawingParagraph);
        if (ph && /^(title|ctrTitle)$/.test(attr(ph, 'type') || '') && title == null) {
          title = texts.filter((t) => t.trim() !== '').join(' ');
          continue;
        }
        for (const t of texts) if (t.trim() !== '') paragraphs.push(t);
      }
    };
    const tree = descendants(root, 'spTree')[0];
    if (tree) walk(tree);
    slides.push({ n: slides.length + 1, title: title || '', hidden: attr(root, 'show') === '0', paragraphs });
  }
  const top = await relsOf(zip, '', DOMParserCtor);
  const thumbRel = [...top.values()].find((r) => !r.external && /\/metadata\/thumbnail$/.test(r.type));
  let thumbnail = thumbRel ? await thumbnailOf(zip, resolvePart('', thumbRel.target)) : null;
  if (!thumbRel) {
    const fallback = ['docProps/thumbnail.jpeg', 'docProps/thumbnail.jpg', 'docProps/thumbnail.png'].find((p) => zip.has(p));
    thumbnail = await thumbnailOf(zip, fallback);
  }
  return { format: 'slides', thumbnail, slides };
}

/** .odp → SlidesModel. */
export async function readOdp(zip, DOMParserCtor, _limits) {
  if (!zip.has('content.xml')) throw new OfficeLiteError('UNREADABLE', 'no content');
  const root = (await zip.xml('content.xml', DOMParserCtor)).documentElement;
  const slides = [];
  for (const page of kids(kid(kid(root, 'body'), 'presentation'), 'page')) {
    let title = null;
    const paragraphs = [];
    const walk = (el) => {
      for (const node of elements(el)) {
        const name = node.localName;
        if (name === 'notes') continue;
        if (name === 'frame' && attr(node, 'class') === 'title') {
          if (title == null) title = descendants(node, 'p').map((p) => odfText(p)).filter((t) => t.trim() !== '').join(' ');
          continue;
        }
        if (name === 'p' || name === 'h') {
          const t = odfText(node);
          if (t.trim() !== '') paragraphs.push(t);
          continue;
        }
        walk(node);
      }
    };
    walk(page);
    slides.push({ n: slides.length + 1, title: title || '', hidden: attr(page, 'visibility') === 'hidden', paragraphs });
  }
  return { format: 'slides', thumbnail: await thumbnailOf(zip, 'Thumbnails/thumbnail.png'), slides };
}
