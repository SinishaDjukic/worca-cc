// Product Video, last step: trim the approved take and encode the deliverables — video/<slug>.mp4 (H.264, native
// width) and video/<slug>-small.mp4 (1600 wide, under smallMb MB) — then write video-package.md: the deliverables,
// the storyboard's summary and scripted section word for word, how to re-record, and the upload note.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { finish, takeFromNotes } from '../skills/product-video/tools/video.mjs';

/** The body of `## <title>` in a markdown file, up to the next `## ` heading; '' when absent. */
function section(md, title) {
  const m = md.match(new RegExp(`^##\\s+${title}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi'));
  return m ? m[1].trim() : '';
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'product-video';
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

export default async function ({ inputs, params, ctx, log }) {
  const take = takeFromNotes(inputs.recording?.path, ctx.pipelineDir);
  if (take.error) throw new Error(`nothing to deliver: ${take.error}`);
  const slug = slugify(params.slug || basename(take.path, extname(take.path)).replace(/-cycle\d+$/i, ''));
  log('info', `encoding ${take.rel} as video/${slug}.mp4 — this takes a few minutes`);
  const r = finish(take.path, join(ctx.pipelineDir, 'video'), slug, { smallMb: params.smallMb ?? 9.5 });

  // Frame folders the recorder may have left; the take and its scripts stay.
  rmSync(join(ctx.pipelineDir, 'video-env', 'peek'), { recursive: true, force: true });
  // Nothing of the video may land in the worktree.
  const git = ctx.cwd ? spawnSync('git', ['status', '--porcelain'], { cwd: ctx.cwd, encoding: 'utf8' }) : null;
  const stray = git && git.status === 0
    ? git.stdout.split('\n').filter((l) => /\.(webm|mp4|mov|png)\s*$|video-(env|takes|sheets)|take\.mjs/i.test(l)).map((l) => l.trim())
    : [];

  const sb = (() => { const p = join(ctx.pipelineDir, 'video-storyboard.md'); return existsSync(p) ? readFileSync(p, 'utf8') : ''; })();
  const row = (label, f) => `| ${label} | \`video/${basename(f.path)}\` | ${mb(f.bytes)} | ${f.seconds ?? '?'} s | ${f.width}×${f.height} |`;
  const md = [
    '# Video package', '',
    '| | File | Size | Duration | Resolution |', '|---|---|---|---|---|', row('Full', r.full), row('Small', r.small), '',
    `From \`${take.rel}\`; ${r.trimmedFrames} blank lead-in frames trimmed; encoded with ${r.encoder === 'ffmpeg' ? 'ffmpeg (libx264)' : 'AVFoundation (encode.swift)'}.`
      + (r.postZooms ? ` ${r.postZooms} post-process zoom${r.postZooms > 1 ? 's' : ''} applied (crop + scale, softer than a live zoom).` : ''),
    r.smallUnderCap ? '' : `\n**The small copy is over ${r.smallMb} MB** even after two lower-bitrate passes — re-run with a lower smallMb.`,
    stray.length ? `\n**Video files in the worktree** (remove them, they must never be committed):\n${stray.map((l) => `- \`${l}\``).join('\n')}` : '',
    '', '## What the video shows', '', section(sb, 'Summary') || '(the storyboard has no Summary section)',
    '', '## Scripted', '', section(sb, 'Scripted') || '(the storyboard has no Scripted section)',
    '', '## Re-record', '', 'Start the demo instance as below, then run `node video-env/take.mjs` from the pipeline directory.', '',
    section(sb, 'Environment') || '(the storyboard has no Environment section)',
    '', '## Upload', '',
    `Attaching to a PR or release needs a signed-in browser: drag \`video/${slug}-small.mp4\` (under GitHub's 10 MB limit on free accounts), or the full file on a paid account.`, '',
  ].join('\n');
  return { outputs: { package: { value: md } }, summary: `video/${slug}.mp4 ${mb(r.full.bytes)}, small ${mb(r.small.bytes)}, ${r.seconds} s${stray.length ? ` — ${stray.length} video file(s) in the worktree` : ''}` };
}
