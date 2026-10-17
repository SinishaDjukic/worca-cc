// Product Video, step 0: check every program the pipeline needs before anyone answers a question or approves a
// storyboard. Missing ones stop the run here with the command that installs each; the rest goes to the storyboard
// as facts (platform, browser, encoder, simulators) so it only plans media this machine can record.
import { checkTools } from '../skills/product-video/tools/video.mjs';

export default async function ({ params, log }) {
  const r = await checkTools({ launch: params.launchBrowser !== false });
  const have = `platform ${r.platform}, browser ${r.browser || 'not started'}, encoder ${r.encoder || 'none'}, `
    + `iOS simulator ${r.simulators.ios ? 'yes' : 'no'}, Android ${r.simulators.android ? 'yes' : 'no'}`;
  if (r.missing.length) {
    const lines = r.missing.map((m) => `- ${m.what}: ${m.hint}`).join('\n');
    if (params.failOnMissing !== false) throw new Error(`Product Video cannot record or encode on this machine. Missing:\n${lines}\nInstall them and resume the run.`);
    log('warn', `missing (failOnMissing is off):\n${lines}`);
  }
  return { outputs: { tools: { value: r } }, summary: `Programs: ${r.missing.length ? `${r.missing.length} missing` : 'all present'} (${have})` };
}
