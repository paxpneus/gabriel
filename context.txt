# CONTEXTO DO PROJETO - PAX PNEUS BACKEND

Backend Node.js/TypeScript/Express da PAX Pneus, rede com 30+ filiais. O sistema cobre integracoes, vendas, entrada de notas, expedicao, estoque/inventario, operacoes internas, usuarios/permissoes, relatorios analiticos, impressao e webhooks para aplicacoes externas.

Este arquivo e o guia operacional para outra IA trabalhar no projeto sem quebrar os padroes existentes.

> **Atualizacao:** a modelagem de invoice/expedicao mudou. Leia a secao 10-A antes de mexer em qualquer fluxo de entrada, expedicao ou devolucao de nota.

---

## 1. Arquivos que devem ser lidos antes de implementar

Os arquivos base atuais ficam em:

- `src/shared/utils/base-models/base-controller.ts`
- `src/shared/utils/base-models/base-service.ts`
- `src/shared/utils/base-models/base-repository.ts`
- `src/shared/utils/base-models/base-redis.ts`
- `src/shared/utils/base-models/base-queue-service.ts`
- `src/shared/query/query.parser.ts`
- `src/shared/query/query.types.ts`
- `src/config/routes.ts`
- `src/config/sequelize-associations.ts`
- `package.json`

Sempre que precisar mexer com uma tabela, verifique a estrutura dela (`\d <tabela>` no banco ou a migration mais recente) antes de assumir colunas — nao confiar de memoria.

Observacao: caminhos antigos como `src/shared/base/*` estao desatualizados.

---

## 2. Stack e dependencias relevantes

Projeto CommonJS com TypeScript. Scripts principais:

- `npm run dev`: `nodemon --exec ts-node src/server.ts`
- `npm run build`: `tsc`
- `npm run start`: `node dist/server.js`
- `npm run migrate`: `sequelize-cli db:migrate`

Principais libs ja disponiveis:

- API: `express`, `cors`, `cookie-parser`, `qs`
- ORM/banco: `sequelize`, `pg`, `pg-hstore`, `sequelize-cli`
- Validacao: `zod`
- Auth/crypto: `jsonwebtoken`, `bcrypt`, `crypto` nativo
- Redis/filas: `ioredis`, `bullmq`, `@bull-board/api`, `@bull-board/express`
- HTTP/XML/NFe: `axios`, `fast-xml-parser`, `xml2js`, `@alexssmusica/node-pdf-nfe`
- Arquivos: `multer`, `archiver`, `pdf-lib`, `xlsx`
- Impressao: `ipp`, `bonjour-service`, `pdf-to-printer`
- Browser automation: `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth`
- Email: `nodemailer`

Nao adicionar dependencias sem conferir `package.json` e pedir autorizacao.

---

## 3. Arquitetura geral

`src/app.ts` monta:

- CORS baseado em `ALLOWED_ORIGINS`
- `express.json()`
- `express.urlencoded({ extended: true })`
- `cookieParser()`
- parser de query com `qs` (`arrayLimit: 1000`, `depth: 10`)
- `GET /health`
- `app.use('/api', externalApiAccess, applicationRateLimit, applicationWebhookEvents, router)`

`src/config/routes.ts` descobre rotas dinamicamente percorrendo `src/modules`. Para cada pasta que contem `.routes.ts`, registra o router em `/api/<nome-da-pasta>`. Se houver `.model.ts` na mesma pasta, popula `ROUTE_TO_TABLE` com `model.getTableName()` para permissoes e webhooks.

Ponto importante: a rota HTTP vem do nome da pasta que contem o `.routes.ts`, mesmo quando o model/tabela tem outro nome. Exemplos reais:

- `src/modules/warehouse/entrance/invoice/invoice.routes.ts` -> `/api/invoice`
- `src/modules/sales/orders/order/orders.routes.ts` -> `/api/order`
- `src/modules/warehouse/expedition/batch/batch.routes.ts` -> `/api/batch`
- `src/modules/warehouse/transporter/transporter.routes.ts` -> `/api/transporter`
- `src/modules/warehouse/unit-business/unit-business.routes.ts` -> `/api/unit-business`
- `src/modules/inventory/stock/stock.routes.ts` -> `/api/stock`

Nao pluralizar rotas manualmente.

---

## 4. Padrao de modulo

Modulo CRUD normalmente segue:

```txt
src/modules/<dominio>/<entidade>/
├── <entidade>.model.ts
├── <entidade>.types.ts
├── <entidade>.repository.ts
├── <entidade>.service.ts
├── <entidade>.controller.ts
└── <entidade>.routes.ts
```

Nem todos os modulos seguem o mesmo nome de arquivo no singular/plural, mas a separacao de responsabilidades deve ser preservada:

- Model: campos Sequelize, `tableName`, `underscored`, hooks e validacoes de persistencia.
- Types: interfaces e DTOs TypeScript.
- Repository: somente queries, includes, SQL bruto quando necessario.
- Service: regra de negocio, cache, filas, orquestracao.
- Controller: HTTP, extracao de `req`, chamada de service e resposta.
- Routes: exporta o router do controller ou um router manual quando o modulo nao usa `BaseController`.

**Regra fixa para tabela nova ou alterada (sempre, sem excecao):**

1. Criar a migration com `sequelize-cli`, seguindo exatamente o padrao das migrations ja existentes no projeto (nome de arquivo com timestamp, `up`/`down`, tipos e defaults compativeis com o que ja esta em uso, `underscored`, UUID `DataTypes.UUIDV4`). Nao alterar tabela direto no banco sem migration.
2. Registrar/atualizar as associacoes correspondentes em `src/config/sequelize-associations.ts`, dentro de `setupAssociations()` — toda tabela nova, FK nova ou relacionamento novo precisa entrar la, nao deixar associacao implicita so no model.
3. So depois disso seguir para repository/service/controller/routes.

Isso vale tanto para modulos novos quanto para qualquer mudanca de schema em tabela existente (ex.: as mudancas de `batch_invoice_items` e `invoice_unit_business_attributes` descritas na secao 10-A).

Associacoes ficam centralizadas em `src/config/sequelize-associations.ts`, dentro de `setupAssociations()`.

---

## 5. BaseController

`BaseController<T, TService>` registra automaticamente, nesta ordem:

- `GET /`
- `GET /:id`
- `POST /`
- `POST /bulk`
- `PUT /:id`
- `DELETE /bulk`
- `DELETE /:id`

Padroes:

- `middlewaresFor()` retorna um mapa por chave de rota (`index`, `show`, `create`, `bulkCreate`, `update`, `bulkDestroy`, `destroy` e chaves customizadas).
- `mw(key)` injeta middlewares configurados.
- `extractQueryParams(req)` extrai: `page`, `perPage`, `sortBy`, `sortDir`, `search`, `filters`, `dateFrom`, `dateTo`, `dateField`, `userId`.
- Erros seguem `{ error: error.message }`.
- `bulkDestroy` espera body `{ ids: string[] }` e usa `Op.in`.

Ao criar rotas extras no controller, adicionar no construtor apos `super(service)` e proteger via `middlewaresFor()`.

---

## 6. BaseService, BaseRepository e QueryParser

`BaseService` expoe:

- `findAll(options?, params?, config?)`
- `paginate(params, extraOptions?)`
- `findById(id, options?)`
- `findOne(options?)`
- `create(data, options?)`
- `bulkCreate(datas, options?)`
- `update(id, data, options?)`
- `bulkUpdate(data, options)`
- `delete(id, options?)`
- `bulkDelete(options)`

`queryConfig` default:

- `perPage: 20`
- `sortBy: createdAt`
- `sortDir: DESC`

`QueryParser` suporta:

- paginacao por `page` e `perPage`
- ordenacao por `sortBy` e `sortDir`, inclusive listas separadas por virgula
- `filters[field]=value`, arrays e ranges `{ start, end }`
- conversao de strings booleanas e numericas
- `dateFrom`, `dateTo`, `dateField`
- `search` com `ILIKE` em `searchFields`
- `filterableFields`, `sortableFields`, `stringFields`, `customFields`

Ao customizar listagens, preferir `queryConfig` e `normalizeFilters` no service.

---

## 7. Redis e filas

Usar sempre o singleton:

- `redisService` de `src/shared/utils/base-models/base-redis.ts`
- `redisConnection` para BullMQ/locks

`RedisService`:

- `get<T>(key)` desserializa JSON quando possivel
- `set<T>(key, value, options?)`
- `delete(key)`
- `deleteByPattern(pattern)`

`set` aceita:

- `mode`: `EX`, `PX`, `EXAT`, `PXAT`, `KEEPTTL`
- `duration`
- `condition`: `NX`, `XX`
- `specialMethod`: `GET`

`BaseQueueService<T>` usa BullMQ. Para criar fila:

- estender `BaseQueueService<T>`
- implementar `process(job: Job<T>)`
- usar `add(data, jobId?)`, `addDelayed(data, jobId, delayMs)`, `scheduleRepeat({ every })`, `removeJob(jobId)`, `getJob(jobId)`

Comportamentos atuais:

- retry exponencial padrao: 5 tentativas, 30s
- `removeOnComplete: true`
- falhas mantidas por ate 7 dias
- limiter padrao: 3 jobs por segundo
- concurrency padrao: 2
- aceita `workless: true` para instancia sem worker
- aceita `sharedLock` com TTL, renovacao, release seguro via Lua e prioridade por recurso
- prioridade pode ser resolvida por `data.resource`, `data.apiFetch.resource`, `data.event.split('.')[0]` ou fila `BLING_ORDER_INGESTION`

Para jobs incrementais, capturar timestamp de inicio antes das queries e usar esse timestamp como novo checkpoint. Nao usar `NOW()` no final.

---

## 8. Autenticacao, permissoes e applications

Ha dois tipos de acesso:

1. Usuario interno via cookie `token`.
2. Aplicacao externa via `Authorization: Bearer <token>` emitido por `/api/applications/login`.

`externalApiAccess` permite seguir se:

- origem esta em `ALLOWED_ORIGINS`
- existe cookie `token`
- rota publica e `/api/applications/login` ou `/api/applications/test-webhook/post`
- rota com prefixo externo `bling` ou `bling-orders`
- existe Bearer token

`authenticate`:

- le cookie `token` ou Bearer token
- para token de usuario, popula `req.user`
- para token de application (`type: "application"`), busca app ativo em cache/DB, valida `token_version`, mescla `allowed_routes` com rotas permitidas pela role, valida rota e aplica rate limit

`userPermissions`:

- converte metodo HTTP em acao: `GET=read`, `POST=write`, `PUT/PATCH=update`, `DELETE=delete`
- resolve entidade via `ROUTE_TO_TABLE` e `CUSTOM_ROUTE_MAP`
- confere permissoes da role

`src/shared/constants/roles.ts` contem scopes e rotas. Ha permissoes customizadas:

- `financial-pdt`
- `multiply-stk-inventory`
- `multiply-stk-entrance`
- `visualize-all-unit-business`

`CUSTOM_ROUTE_MAP` atual em `src/config/routes.ts`:

- `financial-batch-info` -> `financial-pdt`
- `sales-report` -> `financial-pdt`
- `sales-report/run` -> `financial-pdt`
- `multiplier-scan-inventory` -> `multiply-stk-inventory`
- `multiplier-scan-entrance` -> `multiply-stk-entrance`
- `all-unit-business` -> `visualize-all-unit-business`

Rotas excluidas de permissao por entidade:

- `integration-mapping`
- `bling`
- `bling-orders`
- `stores`

---

## 9. Applications e webhooks externos

Tabela `applications` representa aplicativos externos autorizados.

Campos principais:

- `name`
- `description`
- `role_id`
- `api_key`
- `api_secret_hash`
- `allowed_routes`
- `webhook_url`
- `rate_limit_max_requests`
- `rate_limit_window_seconds`
- `token_version`
- `last_login_at`
- `revoked_at`
- `is_active`

Fluxo:

1. Usuario interno cria application em `POST /api/applications`.
2. A resposta retorna `application` e `credentials`.
3. `credentials.api_secret` so e exibido na criacao/rotacao.
4. Aplicacao faz `POST /api/applications/login` com `api_key` e `api_secret`.
5. Recebe JWT Bearer por 1h.
6. Usa `Authorization: Bearer <token>` nas rotas liberadas.

Seguranca:

- segredo e SHA-256 antes de bcrypt para evitar truncamento de bcrypt em 72 bytes
- `rotate-secret` troca segredo e incrementa `token_version`
- `revoke-token` incrementa `token_version`
- autenticacao de application e cacheada em Redis por 1h em `application:<id>:auth`

Rate limit:

- por app + IP (`application-rate:usage:<appId>:<ip>`)
- ban por IP (`application-rate:ban:<ip>`)
- strikes progressivos dentro de 1h
- duracoes: 30s, 30min, 1h

Webhooks:

- middleware `applicationWebhookEvents` intercepta mutacoes `POST`, `PUT`, `PATCH`, `DELETE`
- ignora `applications`
- so dispara para rotas com entidade em `ROUTE_TO_TABLE`
- evento: `POST=create`, `PUT/PATCH=edit`, `DELETE=delete`
- payload enviado: `{ event, entity, data }`
- headers enviados: `X-Pax-Webhook-Event`, `X-Pax-Webhook-Entity`
- aplica filtro por `allowed_routes`: `*`, rota base ou entidade
- envio via `axios.post(webhook_url, payload, timeout 10000)`

---

## 10. Dominios/tabelas principais

Fonte detalhada: Se precisar, pedir um sql completo do banco

Dominios atuais:

- Integracoes: `integrations`, `config_tokens`, `integration_mappings`, `applications`
- Vendas: `customers`, `contacts`, `stores`, `orders`, `order_items`, `steps`, `order_histories`, `integration_order_status_mappings`
- Warehouse: `unit_businesses`, `unit_business_tax_configs`, `transporters`, `carrier_label_ranges`, `carrier_import_layouts`, `printer_configs`
- Usuarios: `roles`, `users`, `user_config`, `user_unit_business`
- Entrada/notas: `invoices`, `invoice_items`, `invoice_fiscal_items`, `invoice_unit_business_attributes`, `entrance_scan_logs`, `unmapped_invoice_products`
- Expedicao: `expedition_batches`, `expedition_batch_items`, `expedition_batch_invoices`, `batch_invoice_items`, `expedition_scan_logs`
- Estoque/inventario: `products`, `suppliers`, `product_supplier_maps`, `stocks`, `inventory_batches`, `inventory_batch_items`, `inventory_batch_logs`
- Operacoes: `operations`, `operations_itens`, `operation_comments`
- Analitico: `report_job_checkpoints`, `invoice_operation_snapshots`, `daily_operation_facts`, `daily_transporter_facts`, `daily_sales_facts`, `daily_sales_product_facts`, `daily_sales_state_facts`, `daily_sales_status_facts`, `daily_sales_store_facts`, `sales_order_snapshots`, `sales_order_item_snapshots`

> `invoice_unit_business_attributes` e `batch_invoice_items` sao tabelas novas em relacao a modelagem anterior. Ver secao 10-A para detalhes. Se voce for criar/ajustar essas tabelas via migration, siga a regra fixa da secao 4 (migration no padrao existente + registrar em `setupAssociations()`).

---

## 10-A. Nova modelagem de invoice / expedicao (ATUALIZADO)

Esta secao substitui a antiga regra unica de "total lido / total esperado" da nota. Houve uma migracao de responsabilidade de colunas:

- **O que era `invoice_items.quantity_received` (quantidade lida) e o "status" por item de nota** passou a viver em `batch_invoice_items` (quantidade lida e status por combinacao invoice x batch x item).
- **O que era `status`, `batch_generated` e `type` diretamente em `invoices`** passou a viver em `invoice_unit_business_attributes` (um registro por combinacao invoice x unit_business).
- **Devolucoes/retornos de nota** (fluxo de "retorno") passam a usar em conjunto: `expedition_batch_invoices` (batch invoice), `batch_invoice_items` (batch invoice item) e `invoice_unit_business_attributes` (invoice atributes). Nao usar mais campos soltos em `invoices` ou `invoice_items` para esse fluxo.

### 10-A.1 `invoices`

Tabela apenas com dados fiscais/cadastrais da nota (sem status, sem type, sem batch_generated, sem total_read/total_expected). Colunas relevantes atuais:

- Identificacao/fiscal: `customer_name`, `customer_document`, `sender_cnpj`, `sender_name`, `receiver_cnpj`, `receiver_name`, `xml_path`, `xml_url`, `xml_key` (unique), `danfe_path`, `invoice_series`, `bonded_invoice`, `description`
- Valores: `invoice_value`, `invoice_products_value`, `invoice_freight_value`, `invoice_discount_value`, `invoice_other_value`, `invoice_total_tax_value`, `icms_value`, `ipi_value`, `pis_value`, `cofins_value`, `difal_value`, `ibs_value`, `cbs_value`
- Relacionamentos: `unit_business_id`, `transporter_id` (+ `transporter_name`, `transporter_document`), `integrations_id`, `store_id`, `seller_id` -> `contacts`, `supplier_id` -> `suppliers`
- Datas/operacionais: `received_at`, `expected_receiving`, `emitted_at`, `printed_label`, `destination_uf`, `destination_city`
- SEFAZ (manifestacao/consulta XML completo): `sefaz_manifestation_status`, `sefaz_n_seq_evento`, `sefaz_nsu`, `sefaz_full_xml_attempts`, `sefaz_full_xml_last_query_at`
- Outros: `id_system` (unique), `number_system`, `source_payload` (jsonb)

**Nao existem mais em `invoices`:** `status`, `type`, `batch_generated`, `total_read`, `total_expected`. Nao inventar essas colunas.

### 10-A.2 `invoice_items`

Continua existindo, mas apenas com o esperado por produto da nota:

- `product_id`, `invoice_id`, `quantity_expected` (integer, default 0)
- unique em `(invoice_id, product_id)`

**Nao possui mais** `quantity_received`/`quantity_read` nem `status`. Isso foi movido para `batch_invoice_items`.

### 10-A.3 `invoice_unit_business_attributes`

Substitui o antigo status/type/batch_generated que ficava direto em `invoices`. Um invoice pode ter um registro de atributos por unit_business (unique em `invoice_id, unit_business_id`):

- `invoice_id`, `unit_business_id`
- `type` (enum `enum_invoice_unit_business_attributes_type`) — equivalente ao antigo `type` da invoice (ex.: incoming/outgoing/devolucao)
- `status` (enum `enum_invoice_unit_business_attributes_status`, default `PENDING`)
- `batch_generated` (boolean, default `false`)

Qualquer logica que antes lia `invoice.status`, `invoice.type` ou `invoice.batch_generated` deve agora buscar o registro correspondente em `invoice_unit_business_attributes` filtrando por `invoice_id` + `unit_business_id`.

### 10-A.4 `expedition_batches`

Batch de expedicao/entrada. Colunas: `id`, `number` (unique), `status` (enum `enum_expedition_batches_status`, default `OPEN`), `integrations_id`, `id_system`, `unit_business_id`, `total_volumes`, `total_volumes_received`, `type` (enum `enum_expedition_batches_type`, default `OUTGOING`), `transporters_id`, `justification`, `description`, `mode` (enum `enum_expedition_batches_mode`, default `REGULAR`), `delivery_note_generated_at`, `finished_at`, `operator_id`.

### 10-A.5 `expedition_batch_items`

Item do batch por produto (agregado, sem vinculo direto com uma invoice especifica): `expedition_batch_id`, `product_id`, `quantity` (integer, default 0), `quantity_scanned` (integer, default 0).

### 10-A.6 `expedition_batch_invoices`

Vinculo entre um batch e uma invoice (uma invoice pode estar em um batch): `id`, `expedition_batch_id`, `invoice_id`. Referenciada por `batch_invoice_items` e por `expedition_scan_logs`.

### 10-A.7 `batch_invoice_items` (NOVA)

Granularidade fina: quantidade esperada/lida e status **por invoice, por item do batch**. E aqui que fica o que antes era `invoice_items.quantity_received`/`status`:

- `expedition_batch_item_id` -> `expedition_batch_items`
- `expedition_batch_invoice_id` -> `expedition_batch_invoices`
- `quantity_expected` (numeric 10,2, default 0)
- `quantity_read` (numeric 10,2, default 0)
- `status` (enum `enum_batch_invoice_items_status`, default `PENDING`)
- unique em `(expedition_batch_invoice_id, expedition_batch_item_id)`

### 10-A.8 `expedition_scan_logs`

Log de cada bipagem/leitura de volume, agora vinculado tambem a invoice do batch:

- `expedition_batch_id`, `expedition_batch_items_id`, `expedition_batch_invoices_id`
- `label_full_code` (varchar 255), `vol_number` (varchar 6)
- `user_id`
- FKs de `expedition_batch_items_id` e `expedition_batch_invoices_id` com `ON DELETE CASCADE`; `expedition_batch_id` com `ON DELETE SET NULL`

### 10-A.9 Regras de calculo atualizadas

- **Total esperado da nota:** continua sendo `SUM(invoice_items.quantity_expected)`.
- **Total lido da nota:** deixou de ser `SUM(invoice_items.quantity_received)` (coluna nao existe mais). Agora e `SUM(batch_invoice_items.quantity_read)` juntando por `expedition_batch_invoices.invoice_id = invoice.id` (join `batch_invoice_items -> expedition_batch_invoices -> invoices`).
- **Status/tipo da nota por filial:** consultar `invoice_unit_business_attributes` (`invoice_id` + `unit_business_id`), nao mais `invoices.status`/`invoices.type`.
- **Entrada (INCOMING) completa:** soma lida (via `batch_invoice_items.quantity_read`) = soma esperada (via `invoice_items.quantity_expected`).
- **Saida (OUTGOING) completa:** `expedition_batches.delivery_note_generated_at IS NOT NULL` no batch vinculado (regra inalterada).
- **Retorno/devolucao de nota:** usar em conjunto `expedition_batch_invoices` + `batch_invoice_items` + `invoice_unit_business_attributes`; nao usar mais campos soltos em `invoices`/`invoice_items` para esse fluxo.
- `Invoice.total_read` e `Invoice.total_expected` continuam nao existindo como colunas no banco — sempre calcular via `SUM`, nunca assumir coluna direta.

### 10-A.10 Se for preciso alterar/criar essas tabelas

Seguir a regra fixa da secao 4: migration `sequelize-cli` no padrao existente (up/down, `underscored`, UUID) **e** atualizacao correspondente em `setupAssociations()` (`src/config/sequelize-associations.ts`) para `batch_invoice_items`, `invoice_unit_business_attributes`, `expedition_batch_invoices`, `expedition_batch_items` e `expedition_scan_logs`. Nao deixar FK sem associacao Sequelize registrada.

---

## 11. Rotas principais registradas

Toda rota fica sob `/api`, exceto `/health`.

Rotas com `BaseController` tem CRUD base:

- `GET /api/<resource>`
- `GET /api/<resource>/:id`
- `POST /api/<resource>`
- `POST /api/<resource>/bulk`
- `PUT /api/<resource>/:id`
- `DELETE /api/<resource>/bulk`
- `DELETE /api/<resource>/:id`

Recursos com CRUD base descobertos:

- `applications`
- `config_tokens`
- `integration-mapping`
- `integrations`
- `products`
- `inventory-batch-items`
- `inventory-batch-logs`
- `inventory-batch`
- `stock`
- `supplier-mapping`
- `suppliers`
- `unmapped-invoice-product`
- `contacts`
- `customers`
- `order`
- `order_history`
- `order_items`
- `steps`
- `stores`
- `entrance-scan-logs`
- `invoice-items`
- `invoice`
- `batch-invoices`
- `batch-items`
- `batch`
- `scan-logs`
- `operation-comment`
- `operation`
- `operations-itens`
- `carrier-import-layouts`
- `carrier-label-ranges`
- `transporter`
- `unit-business`
- `roles`
- `user_config`
- `user_unit_business`
- `users`
- `printer`

Rotas manuais/nao BaseController:

- `GET /api/daily-operation-report`
- `POST /api/daily-operation-report/run`
- `GET /api/sales-report`
- `POST /api/sales-report/run`
- `POST /api/bling/webhook`
- `GET /api/bling/auth/bling`
- `GET /api/bling/callback`
- `POST /api/bling-orders/webhook`
- `GET /api/bling-orders/auth/bling`
- `GET /api/bling-orders/callback`

> Se `batch_invoice_items` e `invoice_unit_business_attributes` ganharem modulo/rota propria, confirmar no `src/config/routes.ts` (nome da pasta define a rota) e atualizar esta lista — na ultima verificacao esses dados ainda nao tinham CRUD base mapeado aqui.

Consultar `API_ROUTES_DOCUMENTATION.md` para parametros de cada rota.

---

## 12. Observacoes e pontos de atencao

- `printer.routes.ts` declara um router local com `/printers` e `/print`, mas exporta `printerController.router`; pelo codigo atual, essas duas rotas locais nao sao registradas. A rota ativa extra do modulo e `GET /api/printer/active`.
- `OperationsController.markAsReceived` registra `PUT /confirm-received/:id`, mas tenta ler `userId` de `req.params`; a rota nao possui `:userId`. Conferir antes de consumir.
- `ROLE_PERMISSIONS` usa alguns nomes de rota no singular/plural que nem sempre coincidem com a rota real; `resolveEntityFromRoute` e `ROUTE_TO_TABLE` sao a fonte operacional para permissoes.
- Algumas controllers ainda usam apenas `authenticate` sem `userPermissions`; preserve o padrao existente ao alterar.
- Nao mover logica de negocio para controller ou repository.
- Nao alterar model para adicionar coluna sem migration Sequelize.
- Toda tabela nova, coluna nova ou FK nova precisa: (1) migration `sequelize-cli` no padrao ja existente no repo e (2) entrada correspondente em `setupAssociations()` em `src/config/sequelize-associations.ts`. Isso vale mesmo para ajustes pontuais — nunca alterar schema so no banco/model sem os dois passos.
- Usar `underscored: true`, `tableName` explicito e UUID com `DataTypes.UUIDV4` em novos models.
- Usar snake_case no TypeScript e snake_case no banco via Sequelize.
- Para upsert/idempotencia, usar `ON CONFLICT DO UPDATE`, `upsert` ou `bulkCreate` com `updateOnDuplicate`.
- Para webhooks e integracoes externas, preferir jobs idempotentes com `jobId` deterministico.
- **Cuidado com codigo legado**: qualquer trecho ainda lendo `invoice_items.quantity_received`, `invoice_items.status`, `invoices.status`, `invoices.type` ou `invoices.batch_generated` esta desatualizado e precisa ser migrado para `batch_invoice_items` / `invoice_unit_business_attributes` conforme secao 10-A. Nao assumir que essas colunas existem sem conferir a migration/model atual.