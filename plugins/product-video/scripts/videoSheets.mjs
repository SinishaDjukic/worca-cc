// Product Video, between Record and Review: contact sheets of the take the recording notes name, one frame every
// `every` seconds, 12 to a sheet, in video-sheets/. A missing or empty take is reported, not thrown, so the reviewer
// flags it as critical and the fix loop sends it back to the recorder.
import { join } from 'node:path';
import { sheets, takeFromNotes } from '../skills/product-video/tools/video.mjs';

export default async function ({ inputs, params, ctx, log }) {
  const notes = inputs.recording?.path || null;
  const take = takeFromNotes(notes, ctx.pipelineDir);
  const head = `# Contact sheets\n\nRecording notes: \`${notes || '(none)'}\`\n`;
  if (take.error) {
    log('warn', `no take: ${take.error}`);
    return { outputs: { sheets: { value: `${head}\n**No take:** ${take.error}.\n` } }, summary: `no take: ${take.error}` };
  }
  const every = Number.isFinite(params.every) && params.every > 0 ? params.every : 2.5;
  const r = sheets(take.path, join(ctx.pipelineDir, 'video-sheets'), { every });
  const md = `${head}Take: \`${take.rel}\` — ${(take.bytes / 1048576).toFixed(1)} MB, modified ${take.modified}`
    + `${take.named ? '' : ' (the notes name no take: this is the newest in video-takes/)'}\n`
    + (take.newer.length ? `\n**Newer takes exist:** ${take.newer.map((x) => `\`${x}\``).join(', ')} — the notes may name a stale take.\n` : '')
    + `\n${r.frames} frames, one every ${every} s (frame n is at ~${every}·n s; 12 per sheet, left to right, top to bottom):\n\n`
    + r.sheets.map((p, i) => `- \`video-sheets/sheet${String(i).padStart(2, '0')}.png\` — ~${(i * 12 * every).toFixed(0)}–${(Math.min((i + 1) * 12, r.frames) * every).toFixed(0)} s`).join('\n') + '\n'
    + (r.zooms.length
      ? `\n## Zoom moments\n\nOne full-size frame from the middle of each zoom's hold (from the take's \`.zooms.json\`):\n\n`
        + r.zooms.map((z, i) => `- \`video-sheets/zoom${String(i).padStart(2, '0')}.png\` — ~${z.at} s, ${z.kind === 'live' ? 'live (in the take)' : 'post (applied at encode; softer)'}${z.why ? ` — ${z.why}` : ''}`).join('\n') + '\n'
      : '\nNo zoom moments in this take.\n');
  return { outputs: { sheets: { value: md } }, summary: `${r.sheets.length} sheets${r.zooms.length ? ` + ${r.zooms.length} zoom frames` : ''} from ${take.rel} (${r.frames} frames)` };
}
