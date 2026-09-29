# EkBill: the Next.js server, as one image.
#
#   docker compose -p ekbill -f deploy/docker-compose.yml up -d --build
#
# Build stage installs and builds; the runtime stage carries the standalone server, Chromium for
# bill PDFs, fonts that have the rupee sign and Devanagari, and the migration runner. On start the
# container applies pending migrations, then serves.

FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-dejavu-core ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/db ./db
RUN useradd -r -u 10001 -m app && chown -R app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node db/migrate.mjs && exec node server.js"]
