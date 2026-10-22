// Shaper s4: the release row's version suggestion (pure: the browser imports it too).
const SEMVER = /^(v?)(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/;
const VERSION_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** 'v1.11.0' → 'v1.12.0', '1.11.0' → '1.12.0', 'v2.0.0-rc.1' → 'v2.1.0'; a tag that is not a version → null. */
export function nextMinor(tag) {
  const m = SEMVER.exec(String(tag || '').trim());
  if (!m) return null;
  return `${m[1]}${m[2]}.${Number(m[3]) + 1}.0`;
}

/** The last tag + minor, else package.json's version (with a v), else nothing (the person types one). */
export function suggestReleaseVersion({ lastTag = null, packageVersion = null } = {}) {
  const fromTag = nextMinor(lastTag);
  if (fromTag) return { version: fromTag, from: 'tag' };
  const p = String(packageVersion || '').trim();
  if (SEMVER.test(p)) return { version: p.startsWith('v') ? p : `v${p}`, from: 'package' };
  return { version: null, from: null };
}

export function isReleaseVersion(v) {
  return typeof v === 'string' && v.length <= 64 && VERSION_RE.test(v);
}

/** A request's `release`: absent/null → { value: null }; { version } → { value: { version } }; else { error }. */
export function parseReleaseChoice(x) {
  if (x === undefined || x === null) return { value: null };
  const v = x && typeof x === 'object' && typeof x.version === 'string' ? x.version.trim() : null;
  if (!isReleaseVersion(v)) return { error: 'release.version must look like v1.12.0' };
  return { value: { version: v } };
}
