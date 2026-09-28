// scripts/js-inline.mjs — the `js` card (spec §12.2): runs `params.source` as an
// ES module through a data: URL and calls its default export with the SAME api
// the harness gives a file script, so a snippet that works inline works as a
// file unchanged. Imports nothing from worca (it runs with WORCA_HOME stripped).
export default async function (api) {
  const source = String(api?.params?.source ?? '');
  if (!source.trim()) throw new Error('the js card has no source');
  const mod = await import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);
  if (typeof mod.default !== 'function') throw new Error('the source must `export default async function (api) { … }`');
  return await mod.default(api);
}
