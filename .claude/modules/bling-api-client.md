# Bling API client — trava de escrita por ambiente

`src/modules/handlers/bling/api/bling_api.service.ts`

- `BLING_WRITES_ENABLED = NODE_ENV === "production"`. Fora de produção (`development`, `test`, vazio) só GET passa na instância `blingApi`: POST/PUT/PATCH/DELETE lançam `[BlingApi] Requisição <método> bloqueado` no interceptor `onRequest` (antes do rate limit).
- `baseURL` sempre `https://api.bling.com.br/Api/v3` — GET funciona em dev (fetch/upsert real localmente).
- Token **não** é travado: `doRefreshToken`, refresh no 401, `BlingTokenRefreshQueue` e `handleBlingOAuthCallback` rodam em qualquer ambiente — dev usa outro app Bling (token próprio), não afeta o de produção.
- **Não coberto**: scrapers Playwright/cookie-session que não usam `blingApi` (`nfe-manifest-web-scraping.service.ts` — manifestação é escrita na Bling via UI; `get-stock-movements.ts`).
- `docker-compose.dev.yml`: workers rodam com `NODE_ENV: production` → escrevem na Bling. Só `npm run dev`/workers locais com `.env` (`NODE_ENV=development`) ficam travados.
