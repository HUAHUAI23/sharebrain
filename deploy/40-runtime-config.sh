#!/bin/sh

# 在 Nginx 启动前将公开部署变量原子写入浏览器可读取的 JSON。
set -eu

template=${SHAREBRAIN_RUNTIME_CONFIG_TEMPLATE:-/etc/sharebrain/runtime-config.json.template}
output=${SHAREBRAIN_RUNTIME_CONFIG_OUTPUT:-/tmp/sharebrain-runtime-config.json}
variables='${WEB_PUBLIC_API_BASE_URL} ${WEB_PUBLIC_COLLAB_WS_URL} ${WEB_PUBLIC_EDITOR_WINDOWING_ENABLED} ${WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS} ${WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS} ${WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO} ${WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES}'
temporary=$(mktemp "${output}.XXXXXX")

cleanup() {
  rm -f "$temporary"
}

trap cleanup EXIT HUP INT TERM
envsubst "$variables" < "$template" > "$temporary"
chmod 0644 "$temporary"
mv -f "$temporary" "$output"
trap - EXIT HUP INT TERM
