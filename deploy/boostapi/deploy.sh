#!/usr/bin/env bash
# BoostAPI 生产部署脚本（在生产机上由 GitHub Actions 通过 SSH 执行）
# 用法: deploy.sh <image:tag>
#   也支持作为 authorized_keys 的 command= 强制命令运行，此时镜像来自 $SSH_ORIGINAL_COMMAND。
#   安装位置: /usr/local/sbin/boostapi-deploy （root:root 0755）
# 行为: 拉镜像 -> 单份 DB 备份(覆盖) -> 仅替换 sub2api 容器 -> 健康检查 -> 失败自动回滚镜像
# 性能: 全程 nice/ionice 低优先级；只重建 app 容器，postgres/redis 不重启；不在服务器上编译。
set -euo pipefail

NEW_IMAGE="${1:-${SSH_ORIGINAL_COMMAND:-}}"
[ -n "$NEW_IMAGE" ] || { echo "usage: deploy.sh <image:tag>"; exit 2; }
APP_DIR=/opt/sub2api
COMPOSE="$APP_DIR/docker-compose.yml"
SERVICE=sub2api
BACKUP_DIR="$APP_DIR/backups/predeploy-latest"   # 固定目录，每次覆盖，不累积
LOCK=/var/lock/boostapi-deploy.lock
LOW="nice -n 19 ionice -c3"
IMAGE_RE='^[a-z0-9./_-]+:[A-Za-z0-9._-]+$'

[[ "$NEW_IMAGE" =~ $IMAGE_RE ]] || { echo "invalid image ref"; exit 2; }
[[ "$NEW_IMAGE" == ghcr.io/shanyu1314/sub2api:* ]] || { echo "refusing image outside ghcr.io/shanyu1314/sub2api"; exit 2; }

exec 9>"$LOCK"
flock -n 9 || { echo "another deploy is running"; exit 3; }

cd "$APP_DIR"
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

current_image() {
  grep -E '^\s+image:\s+(sub2api-boostapi|ghcr\.io/shanyu1314/sub2api):' "$COMPOSE" | head -1 | sed -E 's/^\s+image:\s+//'
}
set_image() {
  local tmp; tmp="$(mktemp "$APP_DIR/.compose.XXXXXX")"
  awk -v img="$1" '
    !done && $0 ~ /^[[:space:]]+image:[[:space:]]+(sub2api-boostapi|ghcr\.io\/shanyu1314\/sub2api):/ {
      match($0,/^[[:space:]]+/); print substr($0,1,RLENGTH) "image: " img; done=1; next }
    { print }' "$COMPOSE" > "$tmp"
  [ "$(grep -c "image: $1" "$tmp")" = 1 ] || { echo "compose rewrite failed"; return 1; }
  cat "$tmp" > "$COMPOSE"; unlink "$tmp"
}
wait_healthy() {
  local i st code
  for i in $(seq 1 50); do
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SERVICE" 2>/dev/null || echo missing)"
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:8080/health || true)"
    log "health: container=$st http=$code ($i/50)"
    [ "$st" = healthy ] && [ "$code" = 200 ] && return 0
    sleep 3
  done
  return 1
}
recreate_app() { $LOW docker compose -f "$COMPOSE" up -d --no-deps "$SERVICE"; }

PREV_IMAGE="$(current_image)"
[ -n "$PREV_IMAGE" ] || { echo "cannot detect current image"; exit 1; }
log "current image: $PREV_IMAGE"
log "target  image: $NEW_IMAGE"

# 预检：磁盘 >= 5GB，当前服务必须健康（否则不动它）
avail_kb="$(df --output=avail / | tail -1 | tr -d ' ')"
[ "$avail_kb" -ge 5242880 ] || { echo "less than 5GB free, abort"; exit 1; }
[ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:8080/health || true)" = 200 ] \
  || { echo "service not healthy before deploy, abort"; exit 1; }

if [ "$PREV_IMAGE" = "$NEW_IMAGE" ]; then log "already running target image, nothing to do"; exit 0; fi

log "pull image"
$LOW docker pull "$NEW_IMAGE"

# 单份备份（覆盖旧的）：先写临时文件，校验通过再替换
log "database backup (single copy, overwritten each deploy)"
mkdir -p "$BACKUP_DIR"
tmp_sql="$BACKUP_DIR/db.sql.gz.tmp"
$LOW docker exec sub2api-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' \
  | $LOW gzip -6 > "$tmp_sql"
gzip -t "$tmp_sql"
[ "$(stat -c %s "$tmp_sql")" -gt 1048576 ] || { echo "backup suspiciously small, abort"; exit 1; }
mv -f "$tmp_sql" "$BACKUP_DIR/db.sql.gz"
cp -f "$COMPOSE" "$BACKUP_DIR/docker-compose.yml.before"
printf '%s\n' "$PREV_IMAGE" > "$BACKUP_DIR/previous-image.txt"
log "backup ok: $(du -h "$BACKUP_DIR/db.sql.gz" | cut -f1)"

log "switch image and recreate only the app container"
set_image "$NEW_IMAGE"
recreate_app

if wait_healthy; then
  log "deploy OK"
  # 只保留 当前 + 上一版 两个镜像，其余清理，避免占盘
  keep="$(printf '%s\n%s\n' "$NEW_IMAGE" "$PREV_IMAGE")"
  docker image ls --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '^(sub2api-boostapi|ghcr\.io/shanyu1314/sub2api):' \
    | grep -vxF "$keep" | xargs -r docker image rm >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
  exit 0
fi

log "NEW VERSION UNHEALTHY -> rolling back image to $PREV_IMAGE"
docker logs --tail 40 "$SERVICE" 2>&1 | sed -E 's/(key|token|secret|password)=[^ ]+/\1=***/Ig' || true
set_image "$PREV_IMAGE"
recreate_app
if wait_healthy; then
  log "rolled back; service restored on previous image. DB was already migrated; dump at $BACKUP_DIR/db.sql.gz"
else
  log "ROLLBACK ALSO UNHEALTHY - manual intervention required"
fi
exit 1
