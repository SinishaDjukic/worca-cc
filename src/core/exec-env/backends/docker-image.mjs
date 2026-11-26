// src/core/exec-env/backends/docker-image.mjs
// The images of the "Local sandbox (Docker)" backend (docs/local-sandbox.md): the default image is
// docker/local-sandbox/sandbox.Dockerfile at the pinned Claude Code and engine CLIs, built on this machine the first
// time a run needs it; a project image is the same file plus the project's tool layer (env-spec.mjs), as ONE
// single-stage Dockerfile, like an E2B project template. Both files ship in the package (package.json files).
// Node built-ins and e2b-template.mjs only: the registry loads this through the backend at settings load.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderTemplateDockerfile, renderProjectDockerfile, pinnedClaudeCodeVersion, pinnedEngineClis, MISE_VERSION } from './e2b-template.mjs';

export const SANDBOX_DOCKERFILE = fileURLToPath(new URL('../../../../docker/local-sandbox/sandbox.Dockerfile', import.meta.url));
export const DEFAULT_IMAGE_REPO = 'worca-local-sandbox';
// A Docker image reference: optional registry host[:port]/, lowercase path components, optional :tag and @sha256 digest.
// Never starts with '-' (it is one argv word of `docker run`, where a leading dash would read as a flag).
export const IMAGE_RE = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?\/)?[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;
export const isImageRef = (v) => typeof v === 'string' && v.length <= 255 && IMAGE_RE.test(v);

const readText = () => readFileSync(SANDBOX_DOCKERFILE, 'utf8');

/** The default image's Dockerfile, placeholders filled (throws on an unpinned version). */
export function renderSandboxDockerfile({ version = pinnedClaudeCodeVersion(), text = readText(), clis = pinnedEngineClis() } = {}) {
  return renderTemplateDockerfile(version, text, clis);
}

/** The default image plus a project's spec: apt packages, then mise tools (e2b-template.mjs renderProjectDockerfile,
 *  on this backend's base file). */
export function renderSandboxProjectDockerfile(spec, { version = pinnedClaudeCodeVersion(), text = readText(), clis = pinnedEngineClis() } = {}) {
  return renderProjectDockerfile(spec, { version, text, clis });
}

/** What every image of this backend stands on: the pinned CLIs, the base Dockerfile's instructions and mise. A change
 *  makes the default image a new tag (built again on first use) and every recorded project build stale. */
export function dockerBaseVersion({ version = pinnedClaudeCodeVersion(), text = readText(), clis = pinnedEngineClis() } = {}) {
  const instructions = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\s*#/.test(l)).join('\n');
  const base = createHash('sha256').update(instructions).digest('hex').slice(0, 12);
  return `claude-code@${version}+codex@${clis.codex}+copilot@${clis.copilot}+cursor-agent@${clis.cursor}+local-sandbox@${base}+mise@${MISE_VERSION}`;
}

/** `worca-local-sandbox:<12 hex of the base version>`: a worca upgrade that moves a pin names a new image. */
export function defaultImageName(baseVersion = dockerBaseVersion()) {
  return `${DEFAULT_IMAGE_REPO}:${createHash('sha256').update(baseVersion).digest('hex').slice(0, 12)}`;
}

/** A project's image: `worca-local-sandbox-<projectKey>` (project keys are lowercase slugs with an 8-hex hash). */
export function projectImageName(projectKey) { return `${DEFAULT_IMAGE_REPO}-${projectKey}`; }
