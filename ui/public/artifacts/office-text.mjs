// ui/public/artifacts/office-text.mjs — .odt for the simplified Office preview: headings and paragraph text, in order. List
// items stay list items, table and section paragraphs read as paragraphs; footnotes, annotations and tracked changes are
// skipped (odfText).
import { attr, kid, odfText } from './office-xml.mjs';
import { OfficeLiteError } from './office-zip.mjs';

const elements = (el) => [...el.childNodes].filter((n) => n.nodeType === 1);
const levelOf = (h) => Math.min(6, Math.max(1, Number.parseInt(attr(h, 'outline-level'), 10) || 1));

/** .odt → TextModel. */
export async function readOdt(zip, DOMParserCtor, _limits) {
  if (!zip.has('content.xml')) throw new OfficeLiteError('UNREADABLE', 'no content');
  const root = (await zip.xml('content.xml', DOMParserCtor)).documentElement;
  const blocks = [];
  const push = (block) => { if (block.text.trim() !== '') blocks.push(block); };
  const walk = (el, inList) => {
    for (const node of elements(el)) {
      switch (node.localName) {
        case 'h':
          push(inList ? { tag: 'li', text: odfText(node) } : { tag: 'h', level: levelOf(node), text: odfText(node) });
          break;
        case 'p':
          push({ tag: inList ? 'li' : 'p', text: odfText(node) });
          break;
        case 'list': case 'list-item': case 'list-header':
          walk(node, true);
          break;
        case 'table': case 'table-row': case 'table-cell': case 'table-header-rows': case 'table-rows': case 'table-row-group':
        case 'section':
          walk(node, inList);
          break;
        default:
          break;
      }
    }
  };
  walk(kid(kid(root, 'body'), 'text'), false);
  return { format: 'text', blocks };
}
