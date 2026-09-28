// src/core/workspace-map/detectors/types.mjs
// The detector contract (JSDoc only). A detector is a pure, synchronous reader: extract hands it
// the files it claims, one at a time, and merges what it returns. It never reads the disk itself
// (except through `file.text`), never throws on purpose (extract catches and records it anyway),
// and reports what it could not key as `unresolved`.

/** @typedef {{ id: string,
 *    claims: (rel: string) => boolean,
 *    detect: (file: {rel: string, text: string}, ctx: DetectCtx) => (DetectResult|void),
 *    finish?: (ctx: DetectCtx) => (DetectResult|void) }} Detector
 *  @typedef {{ member: Member, members: Member[], files: string[], state: object }} DetectCtx
 *    // state: a fresh {} per (detector, member)
 *  @typedef {{ key: string, name: string, dir: string, projectDir: string }} Member
 *    // dir = checkout scanned; projectDir = the live project dir (compose build contexts resolve against it)
 *  @typedef {{ facts?: PartialFact[], aliases?: Array<{value: string, source: string, member?: string}>,
 *    unresolved?: Array<{kind: string, raw: string, file: string, line: number, reason: string}>,
 *    stack?: string[], role?: {text: string, source: 'readme'|'manifest'} }} DetectResult
 *    // aliases[].member defaults to the scanned member; a compose file in 'deploy' may alias 'billing-api'
 *  @typedef {{ kind: string, dir: 'provides'|'consumes', key: string, file: string, line: number,
 *    match: string, detail?: string, label?: string, target?: string,
 *    confidence?: 'exact'|'heuristic' }} PartialFact
 *    // file: REQUIRED, member-relative POSIX (a fact without one is dropped by extract).
 *    // target (consumes only): a host[:port], a member key, a repo slug, an env / config key
 *    //   (`BILLING_URL`, `billing.url`, `Billing:Url`) or a same-file variable name; the catalog tries
 *    //   it as an alias, then as a config key (envStems), then as a host — a public dotted host
 *    //   (`api.stripe.com`) only through an alias equal to the whole host.
 *    // confidence: an edge is never more confident than the fact it comes from. */

export {};
