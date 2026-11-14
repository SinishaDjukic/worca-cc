// src/shared/pr-forge.mjs
// Which code host a PR url belongs to, for the server and the browser alike (src/core/forge.mjs re-exports both).
import { parseAzurePrUrl } from './azure-remote.mjs';
import { parseBitbucketPrUrl } from './bitbucket-remote.mjs';

export const FORGE_LABEL = Object.freeze({ github: 'GitHub', azure: 'Azure DevOps', bitbucket: 'Bitbucket' });

/** The forge of a persisted pr_url. */
export function forgeOfPrUrl(url) {
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(String(url || ''))) return 'github';
  if (parseAzurePrUrl(url)) return 'azure';
  return parseBitbucketPrUrl(url) ? 'bitbucket' : null;
}
