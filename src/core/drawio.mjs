// src/core/drawio.mjs
// draw.io keeps each page in <diagram>…</diagram>. By default the body is compressed:
// base64(deflateRaw(encodeURIComponent(mxGraphModel xml))). No agent can read that, so
// createPipeline writes a decoded sibling next to an attached .drawio/.xml (artifacts.mjs).
import { inflateRawSync } from 'node:zlib';

const DIAGRAM = /(<diagram\b[^>]*>)([\s\S]*?)(<\/diagram>)/g;

/** The file with every compressed page body replaced by its plain XML, or null when
 *  nothing needed decoding (not draw.io, or every page already uncompressed).
 *  Throws on a corrupt payload. */
export function decodeDrawio(text) {
  let decoded = 0;
  const out = text.replace(DIAGRAM, (all, open, body, close) => {
    const b = body.trim();
    if (!b || b.startsWith('<')) return all;   // empty or already plain XML
    decoded++;
    return open + decodeURIComponent(inflateRawSync(Buffer.from(b, 'base64')).toString('utf8')) + close;
  });
  return decoded ? out : null;
}
