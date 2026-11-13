// src/core/pr/gitea.mjs
// Gitea pull requests: the Gitea family implementation bound to the WORCA_GITEA_HOSTS list.
import { makeFamilyPr, FLAVOUR } from './gitea-family.mjs';
import { giteaHosts, giteaAuthHeader, giteaConfigured } from '../gitea-credentials.mjs';
import { hostSuffix } from '../gitea-family-credentials.mjs';

export const { available, createPr, viewPr, findPrForBranch, listPullRequestsForBranches, mergedAt, markReady, closePr,
  prComment, prWatchSnapshot, prCheckFacts, failedBuildLog, requeueEvaluation, replyToThread, forkRefusal, _testing } = makeFamilyPr({
  forge: 'gitea', label: 'Gitea', flavour: FLAVOUR.gitea, hosts: giteaHosts, authHeader: giteaAuthHeader, configured: giteaConfigured,
  configureHint: 'list the host in WORCA_GITEA_HOSTS and set WORCA_GITEA_TOKEN_<HOST> (a token with repository read and write) where worca runs',
  tokenName: (host) => `WORCA_GITEA_TOKEN_${hostSuffix(host)}`,
});
