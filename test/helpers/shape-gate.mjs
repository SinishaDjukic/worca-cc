// test/helpers/shape-gate.mjs — turn the client Shape it first gate on or off in a test. The gate reads the shapeFirst
// flag from <html data-flags> (ui/public/flags.mjs); a test without a page gets a minimal document for it.
export function setShapeFirst(on) {
  // A previous boot's closed window leaves a document without an element: replace it too.
  const d = globalThis.document?.documentElement ? globalThis.document : (globalThis.document = { documentElement: { dataset: {} } });
  const set = new Set(String(d.documentElement.dataset.flags || '').split(/\s+/).filter(Boolean));
  if (on) set.add('shapeFirst'); else set.delete('shapeFirst');
  d.documentElement.dataset.flags = [...set].join(' ');
}
