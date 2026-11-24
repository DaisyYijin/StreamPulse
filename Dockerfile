# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY tsconfig.web.json tsconfig.server.json vite.config.ts vitest.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
ARG STREAMPULSE_VERSION=1.50.1

LABEL org.opencontainers.image.title="StreamPulse" \
      org.opencontainers.image.description="StreamPulse: 115 / 123 / OpenList STRM libraries for Emby and Jellyfin." \
      org.opencontainers.image.source="https://github.com/DaisyYijin/StreamPulse" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${STREAMPULSE_VERSION}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini gosu fonts-noto-cjk libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=1024 \
    STREAM_PORT=2048 \
    CONFIG_DIR=/config \
    STATE_DIR=/data \
    OUTPUT_DIR=/strm \
    LOG_DIR=/logs \
    WEB_DIST=/app/dist/web \
    PUPPETEER_CACHE_DIR=/config/browsers \
    STREAMPULSE_VERSION=${STREAMPULSE_VERSION}

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /config /data /strm /logs \
    && chown -R node:node /config /data /strm /logs /app

VOLUME ["/config", "/data", "/strm", "/logs"]
EXPOSE 1024 2048

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "Promise.all([fetch('http://127.0.0.1:' + (process.env.PORT || 1024) + '/api/health'), fetch('http://127.0.0.1:' + (process.env.STREAM_PORT || 2048) + '/health')]).then((responses) => { if (responses.some((response) => !response.ok)) process.exit(1); }).catch(() => process.exit(1));"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
