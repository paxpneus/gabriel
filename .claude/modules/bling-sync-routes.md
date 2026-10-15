# Bling sync routes (`/api/bling-sync`)

Versão HTTP dos scripts `src/scripts/bling/populate-from-bling-choose.ts` / `populate-from-bling-choose-ids.ts`. Código: `src/modules/handlers/bling/services/bling-sync/`.

## Auth
- Só `authenticate` (usuário via cookie/bearer JWT **ou** application via JWT de app / `x-api-key`+`x-api-secret`). Sem `requireAdmin` — application não tem role de admin. Requester via `getRequester` (`middlewares/auth-token.ts`).
- Rota sem model e fora de `EXCLUDED_ROUTES` → `resolveEntityFromRoute` devolve null → nenhuma checagem de permissão por entidade.

## Rotas
- `POST /populate` — body `{ entities: ("products"|"invoices"|"orders")[], invoiceTypes?: ("nfe_out"|"nfe_in"|"nfe_cancelled"|"nfce")[], orderStatus?: string[], limit?: number }`. `invoiceTypes` omitido = os 4. `limit` = máximo **por etapa** (cada tipo de nota conta separado). Responde 202 e roda em background.
- `GET /populate/status` — última execução (`PopulateRun`, Redis `bling-sync:populate:run`, TTL 7d).
- Import por id/número/nome não fica aqui: ver `.claude/modules/manual-import.md` (`/api/manual-import`). `toBlingParams`/listagem paginada/payload de `BLING_API_FETCH` ficam em `bling-sync/helpers/bling-list.ts`, compartilhados com ele.

## Execução do populate
- Ordem fixa: produtos → nfe_out → nfe_in → nfe_cancelled → nfce → pedidos (item de nota resolve produto já persistido).
- Pedidos: `orderStatus` = `normalized_status` (ex.: `EM_ABERTO`), traduzido pra `idsSituacoes[]` via `integrationOrderStatusMappingService.findExternalStatusIdsByNormalizedStatus` escopado na integração Bling; nenhum mapeado → 400 antes do lock. Omitido = todas as situações. Enfileira em `BlingOrderQueue` com `BULK_FORCE_UPDATE_PRIORITY` e jobId do force-update.
- Enfileira em `BlingApiFetchQueue` (instância de `app.locals`), mesmos jobIds do script (`migration-...`) → dedup contra execução do script.
- Entre etapas espera só os jobIds da própria execução sumirem do pending (`getPendingJobIds`) — não espera a fila zerar (webhook nunca deixaria).
- Notas: filtro `dataEmissaoInicial` = cutoff (`bling-invoice-cutoff.ts`) + skip de `isKnownBlingInvoiceBeforeCutoff`. Canceladas varrem `tipo=0` e `tipo=1` (Bling `/nfe` sem `tipo` só traz saída).
- Uma execução por vez: lock Redis `bling-sync:populate:lock` (NX, TTL 30min renovado a cada 10min) → 409 se ocupado. Processo cai → lock expira sozinho, mas o status fica preso em `RUNNING`.
