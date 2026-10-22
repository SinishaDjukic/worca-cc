// src/core/exec-env/backends/e2b-template.mjs
// The E2B template sources (plans/e2b-execution-design.md §13, §18): worca-agent = docker/e2b/e2b.Dockerfile at the
// pinned Claude Code (docker/CLAUDE_CODE_VERSION), and a project's environment = the same file plus a tool layer, as
// ONE single-stage Dockerfile (Template.fromDockerfile refuses multi-stage files and COPY --from, ignores SHELL).
// One renderer for `npm run e2b:build` and the server's builds; both files ship in the package (package.json files).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { shq } from '../shell.mjs';

export const E2B_DOCKERFILE = fileURLToPath(new URL('../../../../docker/e2b/e2b.Dockerfile', import.meta.url));
export const CLAUDE_CODE_VERSION_FILE = fileURLToPath(new URL('../../../../docker/CLAUDE_CODE_VERSION', import.meta.url));
export const MISE_VERSION = '2026.10.7';   // the floor the Toolchain setup workflow installs
// SHA-256 of the release binaries (SHASUMS256.txt of the GitHub release): a template build downloads and verifies one
// instead of piping the mise.run install script into a root shell. Move together with MISE_VERSION.
export const MISE_SHA256 = Object.freeze({
  x64: '6eb1b890e90818417ca34c90dbbd47881917d5cd199f31b63b062ea9c6b18d85',
  arm64: 'c7108d85a32ba17e4747d31d4a42f39f0c134f16211e204e8ef0a49d4f518fe1',
});
export const MISE_ROOT = '/opt/mise';
const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';   // node:22-bookworm's PATH

export function pinnedClaudeCodeVersion() { return readFileSync(CLAUDE_CODE_VERSION_FILE, 'utf8').trim(); }

export function renderTemplateDockerfile(version, text = readFileSync(E2B_DOCKERFILE, 'utf8')) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error(`e2b:build: "${version}" is not a pinned version`);
  return text.replaceAll('__CLAUDE_CODE_VERSION__', version);
}

/** What a project build stands on: the pinned Claude Code, the base Dockerfile's text and mise. A change to any
 *  of them makes every recorded build stale (the run still uses it, with a warning). */
export function e2bBaseVersion({ version = pinnedClaudeCodeVersion(), text = readFileSync(E2B_DOCKERFILE, 'utf8') } = {}) {
  // Instructions only: a comment or blank-line edit must not mark every project build stale.
  const instructions = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\s*#/.test(l)).join('\n');
  const base = createHash('sha256').update(instructions).digest('hex').slice(0, 12);
  return `claude-code@${version}+worca-agent@${base}+mise@${MISE_VERSION}`;
}

/** worca-agent plus the spec (env-spec.mjs normalizeEnvSpec output): apt packages, then mise tools under
 *  /opt/mise with shims on PATH — through ENV and /etc/profile.d (sandbox commands run in a login shell,
 *  whose /etc/profile resets PATH). Every name is validated by the spec and single-quoted here. */
export function renderProjectDockerfile(spec, { version = pinnedClaudeCodeVersion(), text } = {}) {
  const lines = [renderTemplateDockerfile(version, text).trimEnd(), '', `# worca: project environment ${spec.hash}`, 'USER root'];
  if (spec.apt.length) {
    lines.push(`RUN apt-get update \\\n && apt-get install -y --no-install-recommends ${spec.apt.map(shq).join(' ')} \\\n && rm -rf /var/lib/apt/lists/*`);
  }
  if (spec.tools.length) {
    lines.push(
      `RUN case "$(uname -m)" in x86_64) a=x64; s=${MISE_SHA256.x64};; aarch64|arm64) a=arm64; s=${MISE_SHA256.arm64};; *) echo "no mise for $(uname -m)" >&2; exit 1;; esac \\\n`
        + ` && curl -fsSL -o /usr/local/bin/mise "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-$a" \\\n`
        + ` && echo "$s  /usr/local/bin/mise" | sha256sum -c - \\\n`
        + ' && chmod 0755 /usr/local/bin/mise',
      `ENV MISE_DATA_DIR=${MISE_ROOT} MISE_CONFIG_DIR=${MISE_ROOT}/config PATH=${MISE_ROOT}/shims:${SYSTEM_PATH}`,
      `RUN mise use --global ${spec.tools.map((t) => shq(`${t.name}@${t.version}`)).join(' ')} \\\n`
        + ` && mise reshim \\\n`
        // A login shell keeps ENV's MISE_* today, but the shims must find the global config even if a
        // backend's runtime drops Dockerfile ENV: the profile script sets all three.
        + ` && printf 'export MISE_DATA_DIR=${MISE_ROOT} MISE_CONFIG_DIR=${MISE_ROOT}/config PATH="${MISE_ROOT}/shims:$PATH"\\n' > /etc/profile.d/mise.sh \\\n`
        + ` && chmod -R a+rX ${MISE_ROOT}`,
    );
  }
  lines.push('USER user', 'WORKDIR /home/user', '');
  return lines.join('\n');
}
