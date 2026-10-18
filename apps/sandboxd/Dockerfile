# sandboxd: ana uygulama ile Docker arasındaki dar kapı.
# Ana uygulama Docker'a hiç dokunmaz; yalnızca bu servisin sınırlı HTTP arayüzünü çağırır.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/sandboxd/package.json apps/sandboxd/
RUN npm ci --ignore-scripts
COPY apps/sandboxd apps/sandboxd
RUN npm run build -w @sixfinger/sandboxd

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=8791 HOST=0.0.0.0
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/sandboxd/package.json apps/sandboxd/
RUN npm ci --omit=dev --ignore-scripts -w @sixfinger/sandboxd && npm cache clean --force
COPY --from=build /app/apps/sandboxd/dist apps/sandboxd/dist
EXPOSE 8791
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null || exit 1
CMD ["node", "apps/sandboxd/dist/index.js"]
