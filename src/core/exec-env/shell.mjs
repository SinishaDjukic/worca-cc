// src/core/exec-env/shell.mjs
/** POSIX single-quote a word for `bash -c` inside the sandbox. */
export function shq(s) { return `'${String(s).replaceAll("'", `'\\''`)}'`; }
export function shellJoin(words) { return words.map(shq).join(' '); }

/** Create every missing component of each absolute dir; as root, hand each NEW component to
 *  the template user (mirrored host paths sit under root-owned parents such as /Users, /var).
 *  `mkdir -p`: a parallel spawn may create the same parent between the test and the mkdir. */
export function mkdirsScript(dirs) {
  return `set -e; u=$(id -u); for d in ${dirs.map(shq).join(' ')}; do p=''; IFS=/ read -ra parts <<< "$d"; `
    + 'for c in "${parts[@]}"; do [ -n "$c" ] || continue; p="$p/$c"; '
    + 'if [ ! -d "$p" ]; then mkdir -p "$p"; if [ "$u" = 0 ]; then chown user:user "$p"; fi; fi; done; done';
}
