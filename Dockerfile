# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jdk \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json .sequelizerc ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build

# ─── Stage 2: Base de produção (sem Playwright) ───────────────────────────────
FROM node:22-slim AS base-prod

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    gnupg \
    ca-certificates \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# Copia node_modules já compilado do builder (bindings nativos incluídos)
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY package*.json ./
COPY .sequelizerc ./
COPY src/config/database.js ./src/config/database.js

# ─── Stage 3: API + Workers gerais (sem Playwright) ───────────────────────────
FROM base-prod AS app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    gnupg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client-16 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Diretório para sessão/downloads do ML (será sobrescrito pelo worker-scraping)
RUN mkdir -p /app/ml_session /app/ml_downloads

CMD ["node", "dist/server.js"]

# ─── Stage 4: Worker de Scraping (com Playwright + Chromium) ──────────────────
FROM mcr.microsoft.com/playwright:v1.58.2-noble AS worker-scraping

WORKDIR /app

ENV NODE_ENV=production \
    ML_HEADLESS=true \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy everything from base-prod manually (can't inherit since we changed base)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY package*.json ./
COPY .sequelizerc ./
COPY src/config/database.js ./src/config/database.js

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/ml_session /app/ml_downloads

CMD ["node", "dist/worker-scraping.js"]
