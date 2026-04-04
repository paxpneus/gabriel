# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json .sequelizerc ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build

# ─── Stage 2: Base de produção (sem Playwright) ───────────────────────────────
FROM node:20-slim AS base-prod

WORKDIR /app

# Dependências de sistema mínimas
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY .sequelizerc ./
COPY src/config/database.js ./src/config/database.js

# ─── Stage 3: API + Workers gerais (sem Playwright) ───────────────────────────
FROM base-prod AS app

ENV NODE_ENV=production

# Diretório para sessão/downloads do ML (será sobrescrito pelo worker-scraping)
RUN mkdir -p /app/ml_session /app/ml_downloads

CMD ["node", "dist/server.js"]

# ─── Stage 4: Worker de Scraping (com Playwright + Chromium) ──────────────────
FROM base-prod AS worker-scraping

ENV NODE_ENV=production \
    ML_HEADLESS=true \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependências do Chromium headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Instala Playwright e baixa apenas o Chromium
RUN npx playwright install chromium

RUN mkdir -p /app/ml_session /app/ml_downloads

CMD ["node", "dist/server.js"]