#!/usr/bin/env bash
# Isolated failure-path tests for deploy/boostapi/deploy.sh.
#
# All external commands (docker/curl/df/flock/nice/ionice/gzip/stat) are replaced
# by stubs in a temp PATH, so this never touches a real daemon, database or host.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$TEST_DIR/../boostapi" && pwd)/deploy.sh"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/boostapi-deploy-test.XXXXXX")"
BIN="$ROOT/bin"
mkdir -p "$BIN"

cleanup() {
  if [ -n "${KEEP_DIR:-}" ]; then
    printf 'kept test dir: %s\n' "$ROOT" >&2
  else
    rm -rf "$ROOT"
  fi
}
trap cleanup EXIT HUP INT TERM

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
ok() { printf 'ok - %s\n' "$*"; }

# ---------- stubs ----------
cat > "$BIN/nice" <<'EOF'
#!/bin/sh
shift 2
exec "$@"
EOF

cat > "$BIN/ionice" <<'EOF'
#!/bin/sh
shift 1
exec "$@"
EOF

cat > "$BIN/flock" <<'EOF'
#!/bin/sh
exit 0
EOF

cat > "$BIN/df" <<'EOF'
#!/bin/sh
printf 'Avail\n'
printf '%s\n' "${STUB_AVAIL_KB:-10000000}"
EOF

cat > "$BIN/stat" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-c" ] && [ "${2:-}" = "%s" ]; then
  wc -c < "$3" | tr -d ' '
  exit 0
fi
exec /usr/bin/stat "$@"
EOF

cat > "$BIN/gzip" <<'EOF'
#!/bin/sh
case "${1:-}" in
  -t) [ "${STUB_GZIP_CORRUPT:-0}" = "1" ] && exit 1; exit 0 ;;
  *)  exec cat ;;
esac
EOF

cat > "$BIN/curl" <<'EOF'
#!/bin/sh
STATE="${STUB_STATE:?}"
COMPOSE="${STUB_COMPOSE:?}"
img="$(cat "$STATE/running" 2>/dev/null || true)"
[ -n "$img" ] || img="$(grep -E '^[[:space:]]+image:' "$COMPOSE" | head -1 | sed -E 's/^[[:space:]]+image:[[:space:]]+//')"
code=200
[ "${STUB_HEALTH_FAIL_FOR:-}" = "$img" ] && code=500
want=""
prev=""
for a in "$@"; do
  [ "$prev" = "-w" ] && want="$a"
  prev="$a"
done
case "$want" in
  *http_code*) printf '%s' "$code" ;;
esac
exit 0
EOF

cat > "$BIN/docker" <<'EOF'
#!/bin/bash
STATE="${STUB_STATE:?}"
COMPOSE="${STUB_COMPOSE:?}"
LOG="$STATE/docker.log"
echo "docker $*" >> "$LOG"

cur_image() {
  grep -E '^[[:space:]]+image:' "$COMPOSE" | head -1 | sed -E 's/^[[:space:]]+image:[[:space:]]+//'
}

case "${1:-}" in
  pull)
    [ "${STUB_PULL_FAIL:-0}" = "1" ] && exit 1
    exit 0
    ;;
  exec)
    [ "${STUB_BACKUP_FAIL:-0}" = "1" ] && exit 1
    if [ "${STUB_BACKUP_SMALL:-0}" = "1" ]; then printf 'tiny'; exit 0; fi
    dd if=/dev/zero bs=1024 count=2048 2>/dev/null
    exit 0
    ;;
  compose)
    img="$(cur_image)"
    [ "${STUB_RECREATE_FAIL_ALWAYS:-0}" = "1" ] && exit 1
    [ "${STUB_RECREATE_FAIL_FOR:-}" = "$img" ] && exit 1
    printf '%s\n' "$img" > "$STATE/running"
    exit 0
    ;;
  inspect)
    img="$(cat "$STATE/running" 2>/dev/null || cur_image)"
    if [ "${STUB_HEALTH_FAIL_FOR:-}" = "$img" ]; then echo unhealthy; else echo healthy; fi
    exit 0
    ;;
  ps)
    cat "$STATE/running" 2>/dev/null || true
    exit 0
    ;;
  image)
    if [ "${2:-}" = "ls" ]; then
      [ -n "${STUB_IMAGES:-}" ] && printf '%s\n' "$STUB_IMAGES"
      exit 0
    fi
    exit 0
    ;;
  logs)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
chmod +x "$BIN"/*

# ---------- helpers ----------
CASE_DIR=""
setup_case() {
  local name="$1"
  CASE_DIR="$ROOT/case-$name"
  mkdir -p "$CASE_DIR/app/backups" "$CASE_DIR/state"
  cat > "$CASE_DIR/app/docker-compose.yml" <<'YAML'
services:
  sub2api:
    image: ghcr.io/shanyu1314/sub2api:prev
    restart: unless-stopped
YAML
  : > "$CASE_DIR/lock"
  unset STUB_PULL_FAIL STUB_BACKUP_FAIL STUB_BACKUP_SMALL STUB_GZIP_CORRUPT \
        STUB_RECREATE_FAIL_ALWAYS STUB_RECREATE_FAIL_FOR STUB_HEALTH_FAIL_FOR STUB_IMAGES STUB_AVAIL_KB
  export BOOSTAPI_APP_DIR="$CASE_DIR/app"
  export BOOSTAPI_DEPLOY_LOCK="$CASE_DIR/lock"
  export BOOSTAPI_HEALTH_ATTEMPTS=2
  export BOOSTAPI_HEALTH_INTERVAL=0
  export STUB_STATE="$CASE_DIR/state"
  export STUB_COMPOSE="$CASE_DIR/app/docker-compose.yml"
}

run_deploy() {
  PATH="$BIN:$PATH" "$SCRIPT" ghcr.io/shanyu1314/sub2api:new > "$CASE_DIR/out.log" 2>&1
}

compose_image() {
  grep -E '^[[:space:]]+image:' "$CASE_DIR/app/docker-compose.yml" | head -1 | sed -E 's/^[[:space:]]+image:[[:space:]]+//'
}

assert_compose() { [ "$(compose_image)" = "$1" ] || fail "compose image = $(compose_image), want $1"; }
assert_log() { grep -qF "$1" "$CASE_DIR/out.log" || fail "log missing: $1"; }
assert_no_log() { ! grep -qF "$1" "$CASE_DIR/out.log" || fail "log unexpectedly contains: $1"; }
assert_docker() { grep -qF "$1" "$CASE_DIR/state/docker.log" || fail "docker missing: $1"; }
assert_no_docker() { ! grep -qF "$1" "$CASE_DIR/state/docker.log" 2>/dev/null || fail "docker unexpectedly has: $1"; }

# ---------- cases ----------
setup_case pull-fail
export STUB_PULL_FAIL=1
if run_deploy; then fail "pull failure must be non-zero"; fi
assert_compose "ghcr.io/shanyu1314/sub2api:prev"
assert_no_docker "compose -f"
ok "pull failure does not switch the image"

setup_case backup-fail
export STUB_BACKUP_FAIL=1
if run_deploy; then fail "backup failure must be non-zero"; fi
assert_compose "ghcr.io/shanyu1314/sub2api:prev"
assert_no_docker "compose -f"
ok "backup failure does not switch the image"

setup_case backup-small
export STUB_BACKUP_SMALL=1
if run_deploy; then fail "suspicious backup must be non-zero"; fi
assert_compose "ghcr.io/shanyu1314/sub2api:prev"
assert_no_docker "compose -f"
ok "undersized backup does not switch the image"

setup_case recreate-fail
export STUB_RECREATE_FAIL_FOR="ghcr.io/shanyu1314/sub2api:new"
if run_deploy; then fail "recreate failure must be non-zero"; fi
assert_compose "ghcr.io/shanyu1314/sub2api:prev"
assert_log "rolling back"
assert_log "rollback OK"
[ "$(grep -c 'docker compose -f' "$CASE_DIR/state/docker.log")" = "2" ] || fail "expected recreate + rollback recreate"
ok "recreate failure rolls back and still returns failure"

setup_case health-fail
export STUB_HEALTH_FAIL_FOR="ghcr.io/shanyu1314/sub2api:new"
if run_deploy; then fail "health failure must be non-zero"; fi
assert_compose "ghcr.io/shanyu1314/sub2api:prev"
assert_log "rolling back"
assert_log "rollback OK"
ok "health-check failure rolls back and still returns failure"

setup_case rollback-fail
export STUB_RECREATE_FAIL_ALWAYS=1
if run_deploy; then fail "rollback failure must be non-zero"; fi
assert_log "ROLLBACK FAILED"
ok "rollback failure is reported clearly and returns non-zero"

setup_case success
export STUB_IMAGES="ghcr.io/shanyu1314/sub2api:ancient
other-project/app:1"
if ! run_deploy; then fail "successful deploy must return zero: $(cat "$CASE_DIR/out.log")"; fi
assert_compose "ghcr.io/shanyu1314/sub2api:new"
assert_log "deploy OK"
# 只清理本项目旧镜像
assert_docker "image rm ghcr.io/shanyu1314/sub2api:ancient"
# 不碰其他项目镜像
if grep -qF "image rm other-project/app:1" "$CASE_DIR/state/docker.log"; then
  fail "must not remove images from other projects"
fi
# 不再执行全局 prune
if grep -qF "prune" "$CASE_DIR/state/docker.log"; then
  fail "must not run a global image prune"
fi
ok "successful deploy cleans only this project's stale images and never prunes globally"

# 语法自检
/bin/bash -n "$SCRIPT" || fail "deploy.sh has a syntax error"
ok "deploy.sh passes bash -n"

printf '\nAll boostapi deploy tests passed.\n'
