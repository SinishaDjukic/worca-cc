// src/core/download-filename.mjs — the name a downloaded artifact is saved under, legal on Windows, macOS and Linux,
// and the Content-Disposition that carries it (RFC 6266: an ASCII `filename` fallback for old clients plus the exact
// UTF-8 name in RFC 5987 `filename*`). Pure.

// Microsoft's reserved device names, the superscript-digit COM/LPT forms and CONIN$/CONOUT$ included; Win32 drops the
// spaces before an extension, so `CON .txt` is the console too.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i;
// Bidirectional controls reorder what a save dialog shows (`invoice<RLO>txt.exe` reads as an invoice ending .txt).
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const MAX_NAME = 200;          // code points
const MAX_BYTES = 255;         // UTF-8 bytes: the name limit of ext4 and most Linux file systems
const utf8Size = (s) => new TextEncoder().encode(s).length;

/** The last path segment of `rel` (either separator), made a legal file name everywhere: characters Windows forbids,
 *  control characters and bidirectional controls become `_`, trailing dots and spaces go, a reserved device name gets
 *  a `_` prefix, an over-long name (past 200 code points or 255 UTF-8 bytes) keeps its extension. Never empty
 *  ('artifact'). A lone surrogate (a stored path is any JS string) becomes U+FFFD, so encodeURIComponent below never
 *  throws a URIError (a 500 instead of the file). */
export function downloadFilename(rel) {
  let name = String(rel ?? '').toWellFormed().split(/[\\/]/).filter(Boolean).pop() || '';
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(BIDI, '_').replace(/[. ]+$/, '');
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (Array.from(name).length > MAX_NAME || utf8Size(name) > MAX_BYTES) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    const stem = Array.from(ext ? name.slice(0, -ext.length) : name).slice(0, MAX_NAME - Array.from(ext).length);
    while (stem.length && utf8Size(stem.join('') + ext) > MAX_BYTES) stem.pop();
    const cut = stem.join('');
    name = (ext ? cut : cut.replace(/[. ]+$/, '')) + ext;        // the cut must not end on a dot or a space either
  }
  return name || 'artifact';
}

/** `attachment; filename="<ascii>"; filename*=UTF-8''<percent-encoded UTF-8>` for one artifact path. */
export function attachmentDisposition(rel) {
  const name = downloadFilename(rel);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/[%\\"]/g, '_');
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}
