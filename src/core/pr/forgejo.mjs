// src/core/pr/forgejo.mjs
// Forgejo pull requests: the Gitea family implementation bound to the WORCA_FORGEJO_HOSTS list.
import { makeFamilyPr, FLAVOUR } from './gitea-family.mjs';
import { forgejoHosts, forgejoAuthHeader, forgejoConfigured } from '../forgejo-credentials.mjs';
import { hostSuffix } from '../gitea-family-credentials.mjs';

export const { available, createPr, viewPr, findPrForBranch, listPullRequestsForBranches, mergedAt, markReady, closePr,
  prComment, prWatchSnapshot, prCheckFacts, failedBuildLog, requeueEvaluation, replyToThread, forkRefusal, _testing } = makeFamilyPr({
  forge: 'forgejo', label: 'Forgejo', flavour: FLAVOUR.forgejo, hosts: forgejoHosts, authHeader: forgejoAuthHeader, configured: forgejoConfigured,
  configureHint: 'list the host in WORCA_FORGEJO_HOSTS and set WORCA_FORGEJO_TOKEN_<HOST> (a token with repository read and write) where worca runs',
  tokenName: (host) => `WORCA_FORGEJO_TOKEN_${hostSuffix(host)}`,
});
