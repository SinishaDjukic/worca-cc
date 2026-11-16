# docker/entrypoint-lib.sh — shell functions both container entrypoints source
# (docker/entrypoint.sh for the controller, docker/entrypoint-worker.sh for a worker), installed
# at /usr/local/lib/worca-entrypoint-lib.sh. Sourced, never run: no shebang, no `set`.
# The caller defines `log` (its own prefix); this file supplies one only when it is missing.

if ! declare -F log >/dev/null 2>&1; then
  log() { printf 'worca-entrypoint: %s\n' "$*" >&2; }
fi

# A corporate CA (compose.ca.yml mounts it and sets WORCA_CA_CERT_FILE): Node reads it
# through NODE_EXTRA_CA_CERTS; git, curl, gh and Python read one bundle file, so build the
# system bundle plus the CA in a fresh mktemp dir (only this uid can write it; the agent
# users can read it) and point their variables at it. The system trust store itself needs
# root, which the box does not have. No-op without WORCA_CA_CERT_FILE.
worca_corporate_ca() {
  if [ -n "${WORCA_CA_CERT_FILE:-}" ]; then
    if [ -r "$WORCA_CA_CERT_FILE" ] && grep -q 'BEGIN CERTIFICATE' "$WORCA_CA_CERT_FILE"; then
      cadir="$(mktemp -d /tmp/worca-ca.XXXXXX)"
      cat /etc/ssl/certs/ca-certificates.crt "$WORCA_CA_CERT_FILE" > "$cadir/bundle.pem"
      chmod 0755 "$cadir"
      chmod 0644 "$cadir/bundle.pem"
      export SSL_CERT_FILE="$cadir/bundle.pem" GIT_SSL_CAINFO="$cadir/bundle.pem" \
        CURL_CA_BUNDLE="$cadir/bundle.pem" REQUESTS_CA_BUNDLE="$cadir/bundle.pem"
      log "corporate CA: trusted from $WORCA_CA_CERT_FILE"
    else
      log "corporate CA: $WORCA_CA_CERT_FILE is not a readable PEM certificate; TLS through a re-signing proxy will fail"
    fi
  fi
}
