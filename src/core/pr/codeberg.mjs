// src/core/pr/codeberg.mjs
// Codeberg pull requests: the Gitea family implementation in its Forgejo flavour, bound to the fixed host codeberg.org.
import { makeFamilyPr, FLAVOUR } from './gitea-family.mjs';
import { CODEBERG_HOST } from '../../shared/codeberg-remote.mjs';
import { codebergAuthHeader, codebergConfigured } from '../codeberg-credentials.mjs';

const HOSTS = Object.freeze([CODEBERG_HOST]);

export const { available, createPr, viewPr, findPrForBranch, listPullRequestsForBranches, mergedAt, markReady, closePr,
  prComment, prWatchSnapshot, prCheckFacts, failedBuildLog, requeueEvaluation, replyToThread, forkRefusal, _testing } = makeFamilyPr({
  forge: 'codeberg', label: 'Codeberg', flavour: FLAVOUR.forgejo, hosts: () => HOSTS, authHeader: codebergAuthHeader, configured: codebergConfigured,
  configureHint: 'set WORCA_CODEBERG_TOKEN (a token with repository read and write) where worca runs',
  tokenName: () => 'WORCA_CODEBERG_TOKEN',
});
