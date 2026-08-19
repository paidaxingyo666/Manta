# syntax=docker/dockerfile:1

# ---- build -------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
# npm ci, not npm install: a deployable image must build the exact tree the
# lockfile pins, or a transitive update lands in production unreviewed.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---- runtime dependencies ----------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime -----------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# The relay only ever needs to write its state directory, so it runs as a
# dedicated user and the image can be mounted read-only apart from that volume.
RUN addgroup -S manta && adduser -S -G manta manta \
 && mkdir -p /var/lib/manta-relay && chown manta:manta /var/lib/manta-relay
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER manta
ENV MANTA_RELAY_DATA_DIR=/var/lib/manta-relay
ENV PORT=8787
VOLUME ["/var/lib/manta-relay"]
EXPOSE 8787
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
