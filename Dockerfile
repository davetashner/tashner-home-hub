# syntax=docker/dockerfile:1
# Multi-arch (linux/amd64 for Unraid, linux/arm64 for the Mac Studio). ADR 0001, NFR-11.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# Toolchain for native modules (better-sqlite3 compiles from source when no prebuilt binary matches)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
ARG APP_VERSION=dev
ARG VCS_REF=unknown
ENV APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.title="Tashner Home Hub" \
      org.opencontainers.image.description="Self-hosted family touchscreen hub" \
      org.opencontainers.image.source="https://github.com/davetashner/tashner-home-hub" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$VCS_REF
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build"]
