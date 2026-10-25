#!/usr/bin/env bash
# BoostAPI 生产部署脚本（在生产机上由 GitHub Actions 通过 SSH 执行）
# 用法: deploy.sh <image:tag>
#   也支持作为 authorized_keys 的 command= 强制命令运行，此时镜像来自 $SSH_ORIGINAL_COMMAND。
#   安装位置: /usr/local/sbin/boostapi-deploy （root:root 0755）
# 行为: 拉镜像 -> 单份 DB 备份(覆盖) -> 仅替换 sub2api 容器 -> 健康检查 -> 失败自动回滚镜像
# 性能: 全程 nice/ionice 低优先级；只重建 app 容器，postgres/redis 不重启；不在服务器上编译。
#
# 失败语义（重要）：
#   - 拉取/备份失败：不切换镜像，直接非零退出。
#   - 重建/健康检查失败：显式回滚到上一版镜像并验证；即使回滚成功，本次发布仍以非零状态返回。
#   - 回滚自身失败：打印明确的手工介入提示并返回非零，绝不伪装为成功。
#
# 测试用路径覆盖（仅用于隔离环境，生产使用默认值）：
#   BOOSTAPI_APP_DIR / BOOSTAPI_DEPLOY_LOCK / BOOSTAPI_HEALTH_URL
set -euo pipefail

NEW_IMAGE="${1:-${SSH_ORIGINAL_COMMAND:-}}"
[ -n "$NEW_IMAGE" ] || { echo "usage: deploy.sh <image:tag>"; exit 2; }
APP_DIR="${BOOSTAPI_APP_DIR:-/opt/sub2api}"
COMPOSE="$APP_DIR/docker-compose.yml"
SERVICE=sub2api
BACKUP_DIR="$APP_DIR/backups/predeploy-latest"   # 固定目录，每次覆盖，不累积
LOCK="${BOOSTAPI_DEPLOY_LOCK:-/var/lock/boostapi-deploy.lock}"
HEALTH_URL="${BOOSTAPI_HEALTH_URL:-http://127.0.0.1:8080/health}"
# 健康检查轮询参数（测试可缩短，生产使用默认 50 次 × 3 秒）
HEALTH_ATTEMPTS="${BOOSTAPI_HEALTH_ATTEMPTS:-50}"
HEALTH_INTERVAL="${BOOSTAPI_HEALTH_INTERVAL:-3}"
LOW="nice -n 19 ionice -c3"
IMAGE_RE='^[a-z0-9./_-]+:[A-Za-z0-9._-]+$'
PROJECT_IMAGE_RE='^(sub2api-boostapi|ghcr\.io/shanyu1314/sub2api):'

[[ "$NEW_IMAGE" =~ $IMAGE_RE ]] || { echo "invalid image ref"; exit 2; }
[[ "$NEW_IMAGE" == ghcr.io/shanyu1314/sub2api:* ]] || { echo "refusing image outside ghcr.io/shanyu1314/sub2api"; exit 2; }

exec 9>"$LOCK"
flock -n 9 || { echo "another deploy is running"; exit 3; }

cd "$APP_DIR"
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

current_image() {
  # 用 POSIX 字符类而非 \s：BSD grep（macOS）不支持 \s。
  grep -E '^[[:space:]]+image:[[:space:]]+(sub2api-boostapi|ghcr\.io/shanyu1314/sub2api):' "$COMPOSE" \
    | head -1 | sed -E 's/^[[:space:]]+image:[[:space:]]+//'
}
set_image() {
  local tmp; tmp="$(mktemp "$APP_DIR/.compose.XXXXXX")" || return 1
  awk -v img="$1" '
    !done && $0 ~ /^[[:space:]]+image:[[:space:]]+(sub2api-boostapi|ghcr\.io\/shanyu1314\/sub2api):/ {
      match($0,/^[[:space:]]+/); print substr($0,1,RLENGTH) "image: " img; done=1; next }
    { print }' "$COMPOSE" > "$tmp" || { rm -f "$tmp"; return 1; }
  [ "$(grep -c "image: $1" "$tmp")" = 1 ] || { rm -f "$tmp"; echo "compose rewrite failed"; return 1; }
  chmod --reference="$COMPOSE" "$tmp" 2>/dev/null || chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$COMPOSE" || { rm -f "$tmp"; return 1; }
}
wait_healthy() {
  local i st code
  for i in $(seq 1 "$HEALTH_ATTEMPTS"); do
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$SERVICE" 2>/dev/null || echo missing)"
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || true)"
    log "health: container=$st http=$code ($i/$HEALTH_ATTEMPTS)"
    [ "$st" = healthy ] && [ "$code" = 200 ] && return 0
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}
recreate_app() { $LOW docker compose -f "$COMPOSE" up -d --no-deps "$SERVICE"; }

# 回滚：恢复 compose 镜像 -> 重建 -> 健康检查。任何一步失败都返回非零并给出明确提示。
rollback() {
  local reason="$1"
  log "DEPLOY FAILED ($reason) -> rolling back to $PREV_IMAGE"
  docker logs --tail 40 "$SERVICE" 2>&1 | sed -E 's/(key|token|secret|password)=[^ ]+/\1=***/Ig' || true

  if ! set_image "$PREV_IMAGE"; then
    log "ROLLBACK FAILED: cannot restore compose image to $PREV_IMAGE; manual intervention required"
    return 1
  fi
  if ! recreate_app; then
    log "ROLLBACK FAILED: cannot recreate $SERVICE on $PREV_IMAGE; manual intervention required"
    return 1
  fi
  if wait_healthy; then
    log "rollback OK: service restored on $PREV_IMAGE (DB dump: $BACKUP_DIR/db.sql.gz)"
    return 0
  fi
  log "ROLLBACK ALSO UNHEALTHY on $PREV_IMAGE; manual intervention required"
  return 1
}

# 只清理本项目镜像：保留当前与上一版，跳过被容器占用的镜像，绝不触碰其他项目/数据库/卷。
cleanup_images() {
  local img in_use
  in_use="$(docker ps -a --format '{{.Image}}' 2>/dev/null || true)"
  docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
    | awk -v pattern="$PROJECT_IMAGE_RE" -v current="$NEW_IMAGE" -v previous="$PREV_IMAGE" \
        '$0 ~ pattern && $0 != current && $0 != previous' \
    | while IFS= read -r img; do
        [ -n "$img" ] || continue
        if printf '%s\n' "$in_use" | grep -qxF "$img"; then
          log "keep image still used by a container: $img"
          continue
        fi
        log "remove stale project image: $img"
        docker image rm "$img" >/dev/null 2>&1 || log "warn: failed to remove $img"
      done
}

PREV_IMAGE="$(current_image)"
[ -n "$PREV_IMAGE" ] || { echo "cannot detect current image"; exit 1; }
log "current image: $PREV_IMAGE"
log "target  image: $NEW_IMAGE"

# 预检：磁盘 >= 5GB，当前服务必须健康（否则不动它）
avail_kb="$(df --output=avail / | tail -1 | tr -d ' ')"
[ "$avail_kb" -ge 5242880 ] || { echo "less than 5GB free, abort"; exit 1; }
before_code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || true)"
[ "$before_code" = 200 ] || { echo "service not healthy before deploy, abort"; exit 1; }

if [ "$PREV_IMAGE" = "$NEW_IMAGE" ]; then log "already running target image, nothing to do"; exit 0; fi

# 1) 拉镜像：失败则完全不切换
log "pull image"
if ! $LOW docker pull "$NEW_IMAGE"; then
  log "ABORT: pull failed; compose and running container untouched"
  exit 1
fi

# 2) 单份备份（覆盖旧的）：先写临时文件，校验通过再替换；失败则不切换
log "database backup (single copy, overwritten each deploy)"
mkdir -p "$BACKUP_DIR"
tmp_sql="$BACKUP_DIR/db.sql.gz.tmp"
if ! $LOW docker exec sub2api-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' \
  | $LOW gzip -6 > "$tmp_sql"; then
  rm -f "$tmp_sql"
  log "ABORT: database backup failed; compose and running container untouched"
  exit 1
fi
if ! gzip -t "$tmp_sql"; then
  rm -f "$tmp_sql"
  log "ABORT: backup archive is corrupt; compose and running container untouched"
  exit 1
fi
if [ "$(stat -c %s "$tmp_sql")" -le 1048576 ]; then
  rm -f "$tmp_sql"
  log "ABORT: backup suspiciously small; compose and running container untouched"
  exit 1
fi
mv -f "$tmp_sql" "$BACKUP_DIR/db.sql.gz"
cp -f "$COMPOSE" "$BACKUP_DIR/docker-compose.yml.before"
printf '%s\n' "$PREV_IMAGE" > "$BACKUP_DIR/previous-image.txt"
log "backup ok: $(du -h "$BACKUP_DIR/db.sql.gz" | cut -f1)"

# 3) 切换镜像并重建 app 容器；失败进入回滚
log "switch image and recreate only the app container"
if ! set_image "$NEW_IMAGE"; then
  log "ABORT: compose rewrite failed; nothing was switched"
  exit 1
fi
if ! recreate_app; then
  rollback "recreate failed" || true
  log "release FAILED (recreate); rollback attempted"
  exit 1
fi

# 4) 健康检查；失败进入回滚
if ! wait_healthy; then
  rollback "health check failed" || true
  log "release FAILED (health check); rollback attempted"
  exit 1
fi

log "deploy OK"
cleanup_images || log "warn: image cleanup failed; application deployment is healthy"
exit 0
