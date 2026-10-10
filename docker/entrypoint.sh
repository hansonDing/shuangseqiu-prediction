#!/bin/sh
# 容器启动引导脚本
#
# 作用：数据目录（默认 /app/data）通常挂载在持久化磁盘上，首次挂载时为空。
# 若库文件不存在、目录内也没有种子 JSON，则把镜像内置的 lottery_draws.json 放进去，
# 由应用内置的 JSON → DuckDB 迁移逻辑自动导入历史开奖数据，避免首次部署页面空白。
#
# 可通过环境变量覆盖：
#   LOTTERY_DATA_DIR   数据目录，默认 /app/data（需与持久卷挂载点一致）
#   LOTTERY_SEED_FILE  种子文件路径，默认 /app/seed/lottery_draws.json
#   LOTTERY_DB_PATH    若显式指定，应用会跳过 JSON 迁移，此处也不再导入种子

set -e

DATA_DIR="${LOTTERY_DATA_DIR:-/app/data}"
SEED_FILE="${LOTTERY_SEED_FILE:-/app/seed/lottery_draws.json}"

# 云数据库模式：数据由 CloudBase PostgreSQL 承载，应用不会读写本地 DuckDB，
# 落一份种子文件只会变成永远没人读取的残留，直接跳过。
if [ "${STORAGE_DRIVER:-duckdb}" = "cloudbase" ]; then
  echo "[entrypoint] STORAGE_DRIVER=cloudbase，跳过种子导入（数据由 CloudBase PostgreSQL 承载）"
  exec "$@"
fi

if ! mkdir -p "$DATA_DIR" 2>/dev/null; then
  echo "[entrypoint] 警告：无法创建数据目录 $DATA_DIR（权限不足？），请检查持久卷挂载权限"
fi

if [ -n "${LOTTERY_DB_PATH:-}" ]; then
  echo "[entrypoint] 检测到 LOTTERY_DB_PATH=${LOTTERY_DB_PATH}，跳过种子导入（迁移仅在默认库路径下执行）"
elif [ -f "$DATA_DIR/lottery.duckdb" ]; then
  echo "[entrypoint] 数据目录已存在数据库文件，跳过种子导入"
elif [ -f "$DATA_DIR/lottery_draws.json" ]; then
  echo "[entrypoint] 数据目录已有 lottery_draws.json，交由应用迁移"
elif [ -f "$SEED_FILE" ]; then
  if cp "$SEED_FILE" "$DATA_DIR/lottery_draws.json" 2>/dev/null; then
    echo "[entrypoint] 已写入种子数据 -> $DATA_DIR/lottery_draws.json"
  else
    echo "[entrypoint] 警告：种子写入失败（目录不可写），应用将以空库启动，可稍后调用 /api/update 抓取"
  fi
else
  echo "[entrypoint] 未找到内置种子文件，应用将以空库启动"
fi

exec "$@"
