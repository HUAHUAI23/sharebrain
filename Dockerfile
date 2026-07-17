# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b AS bun-base
WORKDIR /app

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS node-base
WORKDIR /app

FROM bun-base AS manifests
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/collab/package.json ./apps/collab/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/editor/package.json ./packages/editor/package.json
COPY packages/i18n/package.json ./packages/i18n/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
COPY packages/ui/package.json ./packages/ui/package.json

FROM manifests AS development-dependencies
RUN bun install --frozen-lockfile

FROM development-dependencies AS source
COPY . .

FROM source AS web-build
ARG WEB_PUBLIC_API_BASE_URL=""
ARG WEB_PUBLIC_COLLAB_WS_URL="ws://localhost:3002"
ENV WEB_PUBLIC_API_BASE_URL=${WEB_PUBLIC_API_BASE_URL}
ENV WEB_PUBLIC_COLLAB_WS_URL=${WEB_PUBLIC_COLLAB_WS_URL}
RUN bun --filter @sharebrain/web build

FROM source AS api-build
RUN mkdir -p /out \
  && bun build apps/api/src/index.ts --outfile /out/index.js --target bun --external sharp

FROM source AS collab-build
RUN mkdir -p /out \
  && bun build apps/collab/src/index.ts --outfile /out/index.js --target node

FROM source AS worker-build
RUN mkdir -p /out \
  && bun build apps/worker/src/index.ts --outfile /out/index.js --target bun

FROM manifests AS api-production-dependencies
RUN bun install --frozen-lockfile --production --filter @sharebrain/api

FROM manifests AS collab-production-dependencies
RUN bun install --frozen-lockfile --production --filter @sharebrain/collab

FROM manifests AS worker-production-dependencies
RUN bun install --frozen-lockfile --production --filter @sharebrain/worker

FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]

FROM bun-base AS api
ENV NODE_ENV=production
ENV API_PORT=3001
COPY --from=api-production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=api-production-dependencies --chown=bun:bun /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-build --chown=bun:bun /out/index.js ./apps/api/index.js
WORKDIR /app/apps/api
USER bun
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const port = process.env.API_PORT ?? '3001'; const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (!response.ok) process.exit(1)"]
CMD ["bun", "./index.js"]

FROM node-base AS collab
ENV NODE_ENV=production
ENV COLLAB_PORT=3002
COPY --from=collab-production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=collab-production-dependencies --chown=node:node /app/apps/collab/node_modules ./apps/collab/node_modules
COPY --from=collab-build --chown=node:node /out/index.js ./apps/collab/index.js
WORKDIR /app/apps/collab
USER node
EXPOSE 3002
CMD ["node", "./index.js"]

FROM bun-base AS worker
ENV NODE_ENV=production
COPY --from=worker-production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=worker-production-dependencies --chown=bun:bun /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=worker-build --chown=bun:bun /out/index.js ./apps/worker/index.js
WORKDIR /app/apps/worker
USER bun
CMD ["bun", "./index.js"]
