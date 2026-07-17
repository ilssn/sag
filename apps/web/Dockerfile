# ── deps ───────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY scripts/require-npm.cjs ./scripts/require-npm.cjs
RUN npm ci

# ── build（静态导出，ADR-0006）─────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 运行时配置（ADR-0007）：不再有任何 NEXT_PUBLIC_* 构建参数;
# API 地址由容器启动时生成的 config.json 下发,改动无需重建镜像。
RUN rm -f public/config.json && npm run build

# ── runner（nginx 静态托管）────────────────────────────
FROM nginx:alpine AS runner
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html
# nginx 官方镜像启动时执行 /docker-entrypoint.d/*.sh:按环境变量生成运行时配置
COPY deploy/40-sag-runtime-config.sh /docker-entrypoint.d/40-sag-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-sag-runtime-config.sh
EXPOSE 3000
