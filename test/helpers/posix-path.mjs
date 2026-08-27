// Path-shape assertions want '/'-separated strings on every OS. Node hands
// tests Windows-native paths ('C:\\…\\plans\\x.md'), so a /\/plans\/x\.md$/
// pattern or a '/pipe/spec.md' literal that is exact on macOS/Linux never
// matches there. Normalise the ACTUAL value only — the expectation stays the
// readable POSIX form the layout docs use. Mixed separators (git prints '/'
// even on Windows) collapse to '/' too.
export function posix(p) {
  return typeof p === 'string' ? p.replace(/\\/g, '/') : p;
}
