// tools/demo/extension-video/lib/args.mjs — the recorder's command line (README.md "Flags").
export function parseArgs(argv) {
  const o = { size: { width: 1920, height: 1080 }, headed: false, keep: false, webm: false, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headed') o.headed = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--webm') o.webm = true;
    else if (a === '--out') o.outDir = argv[++i];
    else if (a === '--size') {
      const m = /^(\d{3,4})x(\d{3,4})$/.exec(argv[++i] || '');
      if (!m) throw new Error('--size wants WIDTHxHEIGHT, e.g. 1600x900');
      o.size = { width: Number(m[1]), height: Number(m[2]) };
    } else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

/** worca-extension-demo-20261014-1532.mp4 (local time). */
export function outputName(d, ext) {
  const p = (n) => String(n).padStart(2, '0');
  return `worca-extension-demo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
