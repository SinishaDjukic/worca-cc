// src/core/exec-env/spec-dockerfile.mjs
// A project environment spec (env-spec.mjs) as Dockerfile instructions: the apt packages, then mise and each
// pinned tool under /opt/mise with its shims first on PATH. Backend-neutral and pure: the box image
// (`worca container build`), the E2B template and a Docker execution backend call the same function and wrap
// the lines in their own FROM and USER. The lines must run as root.
//
// Every value is treated as untrusted. The spec's own checks already limit names and versions, and this module
// checks them again with its own rules before it writes a byte: a value that could leave its single quotes, start
// a new instruction or read as an option is refused, never escaped into something that runs.
import { normalizeEnvSpec } from './env-spec.mjs';

export const MISE_VERSION = '2026.10.7';   // the floor the Toolchain setup workflow installs
// SHA-256 of the release binaries (SHASUMS256.txt of the GitHub release): a build downloads and verifies one
// instead of piping the mise.run install script into a root shell. Move together with MISE_VERSION.
export const MISE_SHA256 = Object.freeze({
  x64: '6eb1b890e90818417ca34c90dbbd47881917d5cd199f31b63b062ea9c6b18d85',
  arm64: 'c7108d85a32ba17e4747d31d4a42f39f0c134f16211e204e8ef0a49d4f518fe1',
});
export const MISE_ROOT = '/opt/mise';

// This module's own rules (kept apart from env-spec.mjs on purpose: a later loosening there must not reach a
// RUN line unseen). Each starts with a letter or digit, so no value reads as an option to apt-get or mise.
const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._/:@+-]{0,127}$/;
const TOOL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const APT_NAME = /^[a-z0-9][a-z0-9+.-]{1,63}$/;
const SPEC_HASH = /^sha256:[0-9a-f]{64}$/;
// The PATH tail after the shims: `$PATH` (Dockerfile ENV expands it from the base) or a literal list of absolute
// directories, for a builder that does not expand ENV (E2B's Template.fromDockerfile).
const PATH_TAIL = /^(?:\$PATH|\/[A-Za-z0-9._/-]*(?::\/[A-Za-z0-9._/-]*)*)$/;

export class SpecDockerfileError extends Error {
  constructor(message) { super(message); this.name = 'SpecDockerfileError'; this.code = 'EXEC_ENV_SPEC_RENDER'; }
}

/** One shell word in single quotes. The rules above never let a quote through; this stays correct if one did. */
export function shellWord(s) { return `'${String(s).replaceAll("'", "'\\''")}'`; }

function must(re, value, what) {
  if (typeof value !== 'string' || !re.test(value)) throw new SpecDockerfileError(`${what} ${JSON.stringify(value)} cannot go into a Dockerfile`);
  return value;
}

/**
 * The spec's Dockerfile instructions, in order: a marker comment, the apt layer, mise, the tools.
 * @param {{tools: {name:string, version:string}[], apt: string[], hash: string}} spec  normalizeEnvSpec output;
 *   anything else (a hand-made object, a stale hash) is refused
 * @param {{pathTail?: string}} [opts]  what follows the shims on PATH (default `$PATH`)
 * @returns {string[]} instructions (a RUN may span `\`-continued lines); join with '\n'. Empty spec: the comment only.
 */
export function renderSpecLayers(spec, { pathTail = '$PATH' } = {}) {
  if (!spec || typeof spec !== 'object') throw new SpecDockerfileError('the environment spec must be an object');
  // Re-validate through the spec's own checks, then insist the caller passed the canonical form.
  let canonical;
  try { canonical = normalizeEnvSpec({ version: spec.version, tools: spec.tools, apt: spec.apt }); } catch (err) { throw new SpecDockerfileError(err.message); }
  must(SPEC_HASH, spec.hash, 'spec hash');
  if (canonical.hash !== spec.hash) throw new SpecDockerfileError('the spec is not in its stored form (its hash does not match its content)');
  must(PATH_TAIL, pathTail, 'PATH tail');
  const tools = canonical.tools.map((t) => {
    must(TOOL_NAME, t.name, 'tool name');
    must(TOOL_VERSION, t.version, `tool ${t.name}: version`);
    return shellWord(`${t.name}@${t.version}`);
  });
  const apt = canonical.apt.map((p) => shellWord(must(APT_NAME, p, 'apt package')));

  const lines = [`# worca: project environment ${canonical.hash}`];
  if (apt.length) {
    lines.push('RUN apt-get update \\\n'
      + ` && apt-get install -y --no-install-recommends ${apt.join(' ')} \\\n`
      + ' && rm -rf /var/lib/apt/lists/*');
  }
  if (tools.length) {
    lines.push(
      `RUN case "$(uname -m)" in x86_64) a=x64; s=${MISE_SHA256.x64};; aarch64|arm64) a=arm64; s=${MISE_SHA256.arm64};; *) echo "no mise for $(uname -m)" >&2; exit 1;; esac \\\n`
        + ` && curl -fsSL -o /usr/local/bin/mise "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-$a" \\\n`
        + ' && echo "$s  /usr/local/bin/mise" | sha256sum -c - \\\n'
        + ' && chmod 0755 /usr/local/bin/mise',
      `ENV MISE_DATA_DIR=${MISE_ROOT} MISE_CONFIG_DIR=${MISE_ROOT}/config PATH=${MISE_ROOT}/shims:${pathTail}`,
      `RUN mise use --global ${tools.join(' ')} \\\n`
        + ' && mise reshim \\\n'
        // A login shell resets PATH from /etc/profile: the profile script puts the shims back for it.
        + ` && printf 'export MISE_DATA_DIR=${MISE_ROOT} MISE_CONFIG_DIR=${MISE_ROOT}/config PATH="${MISE_ROOT}/shims:$PATH"\\n' > /etc/profile.d/mise.sh \\\n`
        + ` && chmod -R a+rX ${MISE_ROOT}`,
    );
  }
  return lines;
}
