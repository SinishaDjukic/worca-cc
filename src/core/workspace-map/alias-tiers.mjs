// src/core/workspace-map/alias-tiers.mjs
// Which claim of an alias names its member (spec §6.3 step 3). Several members may claim one alias: the
// member named `billing`, an SDK publishing `@acme/billing` (tail `billing`), a deploy repo's compose service
// `billing` built from `../billing-service`, a survey agent's guess. The claim of the strongest tier wins, and
// the alias is ambiguous (unused) only among the claimants of that tier. Extract keeps each member's strongest
// source for a value it emits twice; the catalog claims every member's key and name at tier 0.

/** Tier by alias `source` (lower wins):
 *  0 identity — the member's key, name and checkout / project dir names (`identity`, identity.mjs);
 *  1 deploy — a name the member runs under: compose services, container names, hostnames and network aliases
 *    (`compose`, deploy-compose.mjs); k8s workload / Service names and `<name>.<namespace>` (`k8s`), an Ingress
 *    host (`k8s-ingress`), a Helm chart name (`helm`), a serverless `service` (`serverless`, all deploy-k8s.mjs);
 *    `spring.application.name` (`spring`, config-env.mjs);
 *  2 manifest — a package, module or crate name (`package.json`, `pyproject`, `maven`, `gradle`, `cargo`,
 *    `go.mod`: pkg-*.mjs) and the origin remote's slug and last segment (`git-remote`, extract.mjs);
 *  3 guess — an alias the survey agent reported (`survey`, catalog.mjs), and an npm scope tail (`billing` of
 *    `@acme/billing`, `npm-scope-tail`, pkg-npm.mjs): a name derived from another name, which an SDK carries as
 *    often as the service it calls, so it never outranks what the survey found for a member no code maps; and a deploy
 *    name a member claims for itself by default only (`deploy-self`: deploy-k8s.mjs, a workload whose image names no
 *    member, a chart named like no member, in a member without code or, in a member with code, when nothing names this
 *    member either — a local-dev stub of a peer; deploy-compose.mjs, a service built from a sub-directory or per service
 *    from the member's root): a guess of
 *    who runs a name never outranks a package's name. */
export const ALIAS_TIERS = Object.freeze({
  identity: 0,
  compose: 1, k8s: 1, 'k8s-ingress': 1, helm: 1, serverless: 1, spring: 1,
  'package.json': 2, pyproject: 2, maven: 2, gradle: 2, cargo: 2, 'go.mod': 2, 'git-remote': 2,
  survey: 3, 'npm-scope-tail': 3, 'deploy-self': 3,
});

/** The claims of tier 3 that tie with a manifest-tier claim instead of losing to it (catalog step 3): none is
 *  evidence of who serves a name, and at 15486564 they tied. A survey alias is one too: a library's package name
 *  never takes the host of a service no code maps that the survey names alike. */
export const GUESS_SOURCES = Object.freeze(['deploy-self', 'npm-scope-tail', 'survey']);

/** The tier of an alias source; a source the table does not name (a detector outside the registry) → 2. */
export const aliasTier = (source) => (typeof source === 'string' && Object.hasOwn(ALIAS_TIERS, source) ? ALIAS_TIERS[source] : 2);
