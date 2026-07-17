#!/bin/sh
# 容器启动时生成运行时配置（ADR-0007）：
# SAG_WEB_API_BASE 留空 = 浏览器按同主机 :8000 自动推导（localhost 与局域网均适用）。
set -eu
cat > /usr/share/nginx/html/config.json <<EOF
{
  "apiBase": "${SAG_WEB_API_BASE:-}",
  "enableWindowScaling": ${SAG_WEB_ENABLE_WINDOW_SCALING:-true}
}
EOF
echo "[sag] runtime config generated: apiBase='${SAG_WEB_API_BASE:-}' enableWindowScaling=${SAG_WEB_ENABLE_WINDOW_SCALING:-true}"
