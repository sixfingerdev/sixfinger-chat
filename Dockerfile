# syntax=docker/dockerfile:1.7
# SixFinger Chat — tek imaj: API + derlenmiş web arayüzü

# ---------- Derleme ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/sandboxd/package.json apps/sandboxd/
RUN npm ci --ignore-scripts
COPY . .
# Android için ayrı derlenir; web imajına capacitor kabuğu gerekmez.
RUN npm run build -w @sixfinger/server && npm run build -w @sixfinger/web

# ---------- Çalışma ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    WEB_DIST=/app/apps/web/dist \
    TRUST_PROXY=true
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --ignore-scripts -w @sixfinger/server && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health >/dev/null || exit 1
CMD ["node", "apps/server/dist/index.js"]
