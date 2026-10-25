// src/core/requirements/attachments.mjs
// Attachments in the requirements process (plans/requirements-a8-design.md), without I/O: the limits, ids and display
// names, the upload refusals, the reader's prompts and what Worca enforces on its replies, the prompt blocks rounds and
// the brief carry, and the spec ids that mention a file. The job (attachment-job.mjs) does the disk, the queue and calls.

export const REQ_ATTACH_LIMITS = Object.freeze({
  files: 10,                        // per feature, and documents per brief (D7)
  fileBytes: 25 * 1024 * 1024,      // per file, every kind
  requestBytes: 100 * 1024 * 1024,  // per upload request: Ask's per-message cap, inside the routes' JSON window (D10)
  summary: 1500, answer: 600, question: 200, asks: 20, history: 10,
  entry: 3000,                      // one file's summary and answers in a prompt (§4)
  inlineBytes: 24 * 1024,           // = ASK_LIMITS.inlineAttachmentsMaxBytes: inline reads and the <attachments> text budget
  name: 200,
});
export const REQ_ATT_ID_RE = /^ratt_[0-9a-f]{12}$/;

/** The uploaded name reduced to its last segment (either separator), without control characters, at most 200
 *  characters; 'file' when nothing usable is left. Never a path (D9). */
export function displayName(raw) {
  // toWellFormed: a lone surrogate (JSON can carry one) becomes U+FFFD; bidi controls go, so a name cannot spoof its end
  const last = String(raw ?? '').toWellFormed().split(/[\\/]/).pop();
  const s = last.replace(/[\u0000-\u001f\u007f؜‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, REQ_ATTACH_LIMITS.name).trim();
  return s && s !== '.' && s !== '..' ? s : 'file';
}

/** `name`, else "<base> (2)<ext>", "<base> (3)<ext>" …: the first not in `taken` (ignoring case), at most 200 characters. */
export function uniqueName(name, taken = []) {
  const used = new Set(taken.map((t) => String(t).toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let k = 2; ; k += 1) {
    const tail = ` (${k})${ext}`;
    const cand = `${base.slice(0, Math.max(1, REQ_ATTACH_LIMITS.name - tail.length))}${tail}`;
    if (!used.has(cand.toLowerCase())) return cand;
  }
}

export const KIND_TITLES = Object.freeze({ text: 'Text', image: 'Image', binary: 'PDF' });   // the page; the read prompt's Kind
export const KIND_WORDS = Object.freeze({ text: 'text', image: 'image', binary: 'PDF' });    // the <attachments> block

/** 640 B, 9 KB, 2.1 MB. */
export function sizeLabel(bytes) {
  const v = Number(bytes) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- uploads (D7) ----

export const OFFICE_EXTENSIONS = Object.freeze(['.docx', '.xlsx', '.pptx']);
const READS = 'Worca reads text, images and PDF.';

/** A type Worca does not read: Office files get the PDF hint. */
export function officeRefusal(name, ext) {
  const n = displayName(name);
  return OFFICE_EXTENSIONS.includes(String(ext || '').toLowerCase()) ? `${n} was not added: ${READS} Save it as PDF to attach it here.` : `${n} was not added: ${READS}`;
}

/** validateAttachmentUploads' options for a feature's files or a brief's documents; `create` is the New feature form. */
export function reqUploadOptions({ owner = 'feature', create = false } = {}) {
  const L = REQ_ATTACH_LIMITS;
  const cap = owner === 'brief' ? `a brief takes up to ${L.files} documents.` : `a feature takes up to ${L.files} files.`;
  return {
    maxFiles: L.files, maxBytesPerFile: L.fileBytes, maxBytesPerBinaryFile: L.fileBytes, maxBytesTotal: L.requestBytes,
    notAllowed: officeRefusal,
    messages: {
      notArray: () => 'attachments must be a list of files',
      tooMany: (_max, name) => `${displayName(name)} was not added: ${cap}`,
      tooBig: (name) => `${displayName(name)} was not added: it is over 25 MB.`,
      totalTooBig: (_cap, name) => (create
        ? `${displayName(name)} was not added: a new feature's files can be up to 100 MB in all; add more on the feature page.`
        : `${displayName(name)} was not added: add up to 100 MB at a time.`),
    },
  };
}
