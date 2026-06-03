# Documentacao de Rotas da API - PAX PNEUS Backend

Documento gerado a partir da leitura do backend em `src/modules`, `src/config/routes.ts`, controllers, middlewares, models e `modelagem_banco_dados.txt`. Serve como insumo para gerar uma documentacao VitePress.

Base URL local/padrao: `/api`

Healthcheck fora do prefixo: `GET /health` -> `{ "status": "ok" }`

---

## Convencoes gerais

### Autenticacao

Ha dois modos:

- Usuario interno: cookie HTTP-only `token`, emitido por `POST /api/users/login`.
- Aplicacao externa: `Authorization: Bearer <token>`, emitido por `POST /api/applications/login`.

Rotas publicas sem token:

- `POST /api/users/login`
- `POST /api/applications/login`
- `POST /api/applications/test-webhook/post`
- rotas com prefixo `/api/bling` e `/api/bling-orders` passam pelo middleware externo sem exigir Bearer/cookie.

### Query de listagem paginada

Rotas CRUD base `GET /api/<resource>` aceitam:

| Parametro | Tipo | Descricao |
|---|---:|---|
| `page` | number | Pagina, default `1` |
| `perPage` | number | Itens por pagina, default `20` |
| `sortBy` | string ou CSV | Campo de ordenacao |
| `sortDir` | `ASC`/`DESC` ou CSV | Direcao da ordenacao |
| `search` | string | Busca global nos campos configurados pelo service |
| `filters` | object | Filtros por campo. Ex.: `filters[status]=OPEN` |
| `dateFrom` | string date | Inicio do range |
| `dateTo` | string date | Fim do range |
| `dateField` | string | Campo de data usado com `dateFrom/dateTo`; default `createdAt` |
| `userId` | UUID | Disponivel para services que usam contexto de usuario |

Resposta paginada padrao:

```json
{
  "data": [],
  "meta": {
    "total": 0,
    "page": 1,
    "perPage": 20,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

### CRUD base

Todo recurso baseado em `BaseController` expoe:

| Metodo | Rota | Parametros |
|---|---|---|
| `GET` | `/api/<resource>` | query de paginacao/filtros |
| `GET` | `/api/<resource>/:id` | path `id` UUID |
| `POST` | `/api/<resource>` | body com campos de criacao do model |
| `POST` | `/api/<resource>/bulk` | body array de objetos de criacao |
| `PUT` | `/api/<resource>/:id` | path `id`, body parcial |
| `DELETE` | `/api/<resource>/bulk` | body `{ "ids": ["uuid"] }` |
| `DELETE` | `/api/<resource>/:id` | path `id` UUID |

Erros seguem em geral:

```json
{ "error": "mensagem" }
```

### Webhooks para applications

O middleware `applicationWebhookEvents` dispara webhooks automaticamente apos mutacoes bem-sucedidas (`POST`, `PUT`, `PATCH`, `DELETE`) em recursos mapeados para tabelas. Payload:

```json
{
  "event": "create | edit | delete",
  "entity": "nome_da_tabela",
  "data": {}
}
```

Headers enviados:

- `X-Pax-Webhook-Event`
- `X-Pax-Webhook-Entity`

---

## Mapa de recursos CRUD base

Os recursos abaixo usam `BaseController` e possuem as sete rotas CRUD base descritas acima.

| Recurso HTTP | Tabela/modelo principal | Campos principais para body |
|---|---|---|
| `/api/applications` | `applications` | `name`, `description`, `role_id`, `allowed_routes`, `webhook_url`, `rate_limit_max_requests`, `rate_limit_window_seconds`, `is_active` |
| `/api/config_tokens` | `config_tokens` | `integrations_id`, `access_token`, `refresh_token`, `client_id`, `client_secret`, `access_token_url`, `auth_url`, `oauth_state`, `callback_url` |
| `/api/integration-mapping` | `integration_mappings` | `entity_type`, `internal_id`, `integrations_id`, `external_id`, `unit_business_id` |
| `/api/integrations` | `integrations` | `name`, `type`, `lock_today_orders`, `api_url`, `document`, `cnaes`, `allowed_channels` |
| `/api/products` | `products` | `id_system`, `name`, `sku`, `ean`, `ean_tribut`, `price`, `type`, `integrations_id`, `supplier_id`, `supplier_cost_price`, `supplier_purchase_price`, `unit`, `brand`, `line`, `measure`, `gross_weight` |
| `/api/inventory-batch-items` | `inventory_batch_items` | `product_id`, `inventory_batch_id`, `ean`, `sku`, `quantity_stock`, `quantity_read`, `divergency`, `status`, `stock_id`, `price` |
| `/api/inventory-batch-logs` | `inventory_batch_logs` | `user_id`, `quantity_read`, `inventory_batch_item_id`, `label_code`, `date` |
| `/api/inventory-batch` | `inventory_batches` | `status`, `justification`, `BatchIdForDivergency`, `type`, `mode`, `date`, `unit_business_id`, `total_quantity_stock`, `total_quantity_read`, `number`, `total_price` |
| `/api/stock` | `stocks` | `product_id`, `unit_business_id`, `quantity`, `total_price` |
| `/api/supplier-mapping` | `product_supplier_maps` | `product_id`, `supplier_cnpj`, `supplier_product_code` |
| `/api/suppliers` | `suppliers` | `name`, `document`, `fantasy_name`, `city`, `uf`, `id_system`, `code` |
| `/api/unmapped-invoice-product` | `unmapped_invoice_products` | `invoice_id`, `quantity`, `ean`, `sku`, `product_name`, `status`, `reason`, `image_path` |
| `/api/contacts` | `contacts` | `name`, `type`, `id_system`, `integrations_id`, `unit_business_id` |
| `/api/customers` | `customers` | `name`, `type`, `document` |
| `/api/order` | `orders` | `integrations_id`, `customer_id`, `store_id`, `unit_business_id`, `invoice_id`, `id_order_system`, `number_order_system`, `number_order_channel`, `actual_step`, `actual_situation`, `collection_date`, `date`, `totalPrice`, `nfe_emitted`, `waiting_acceptance`, `internal_status`, `source_payload` |
| `/api/order_history` | `order_histories` | `order_id`, `step_id`, `situation`, `date`, `json_data`, `result` |
| `/api/order_items` | `order_items` | `order_id`, `name`, `sku`, `unit`, `quantity`, `price`, `product_id`, `integrations_id`, `source_payload`, `unit_price`, `gross_total`, `discount_value`, `net_total`, `commission_base`, `commission_rate`, `commission_value`, `average_cost_snapshot` |
| `/api/steps` | `steps` | `label_admin`, `label_system`, `sequence` |
| `/api/stores` | `stores` | `name`, `id_store_system` |
| `/api/entrance-scan-logs` | `entrance_scan_logs` | `invoice_items_id`, `label_full_code`, `vol_number`, `user_id` |
| `/api/invoice-items` | `invoice_items` | `product_id`, `invoice_id`, `quantity_expected`, `quantity_received`, `status` |
| `/api/invoice` | `invoices` | `customer_name`, `customer_document`, `description`, `bonded_invoice`, `xml_path`, `xml_key`, `danfe_path`, `unit_business_id`, `store_id`, `sender_cnpj`, `sender_name`, `receiver_cnpj`, `receiver_name`, `integrations_id`, `id_system`, `transporter_id`, `seller_id`, `number`, `number_system`, `type`, `status`, `emitted_at`, `expected_date`, `advance_payment`, `cancelled` |
| `/api/batch-invoices` | `expedition_batch_invoices` | `expedition_batch_id`, `invoice_id` |
| `/api/batch-items` | `expedition_batch_items` | `expedition_batch_id`, `product_id`, `quantity`, `quantity_scanned` |
| `/api/batch` | `expedition_batches` | `description`, `number`, `justification`, `status`, `integrations_id`, `id_system`, `transporters_id`, `unit_business_id`, `total_volumes`, `total_volumes_received`, `type`, `mode`, `delivery_note_generated_at`, `finished_at`, `operator_id` |
| `/api/scan-logs` | `expedition_scan_logs` | `expedition_batch_id`, `expedition_batch_items_id`, `expedition_batch_invoices_id`, `label_full_code`, `vol_number`, `user_id` |
| `/api/operation-comment` | `operation_comments` | `user_id`, `unit_business_id`, `operation_id`, `comment`, `point_to`, `date` |
| `/api/operation` | `operations` | `code`, `description`, `date`, `due_at`, `expected_at`, `status`, `priority_level`, `justification_priority_level`, `request_user`, `receiver_user`, `invoice_id`, `invoice_number`, `from_unit`, `to_unit`, `transporter_name`, `total_quantity`, `receiver_confirmation` |
| `/api/operations-itens` | `operations_itens` | `description`, `operation_id`, `product_id`, `code`, `quantity` |
| `/api/carrier-import-layouts` | `carrier_import_layouts` | `transporter_id`, `name`, `type`, `sheet_name`, `data_start_row`, `mapping_mode`, labels de colunas, `metadata`, `active` |
| `/api/carrier-label-ranges` | `carrier_label_ranges` | `transporter_id`, `cep_start`, `cep_end`, `route_acronym`, `destination`, `route_code`, `transporter_code`, `metadata`, `active` |
| `/api/transporter` | `transporters` | `id_system`, `name`, `cnpj`, `city`, `uf` |
| `/api/unit-business` | `unit_businesses` | `id_system`, `number`, `ult_nsu`, `name`, `cnpj`, `integrations_id`, `head_office`, `certificate_password`, `certificate_path`, `emails` |
| `/api/roles` | `roles` | `name`, `type`, `permissions` |
| `/api/user_config` | `user_config` | `user_id`, `theme`, `profile_photo`, `language`, `timezone`, `items_per_page`, `notifications_enabled`, `visualize_only_current_unit_business`, `compact_mode` |
| `/api/user_unit_business` | `user_unit_business` | `user_id`, `unit_business_id` |
| `/api/users` | `users` | `name`, `cpf`, `unit_business_id`, `role_id`, `email`, `password` |
| `/api/printer` | `printer_configs` | campos do model de configuracao de impressora |

---

## Applications

### `POST /api/applications/login`

Login de aplicacao externa.

Body:

```json
{
  "api_key": "pax_...",
  "api_secret": "secret"
}
```

Resposta:

```json
{
  "token": "jwt",
  "expires_in": 3600,
  "token_type": "Bearer",
  "application": {}
}
```

### `POST /api/applications`

Cria uma aplicacao externa. Requer usuario autenticado e permissao.

Body:

```json
{
  "name": "Minha integracao",
  "description": "Opcional",
  "role_id": "uuid",
  "allowed_routes": ["/api/invoice", "/api/batch"],
  "webhook_url": "https://example.com/webhook",
  "rate_limit_max_requests": 120,
  "rate_limit_window_seconds": 60,
  "is_active": true
}
```

Resposta inclui `credentials.api_key` e `credentials.api_secret`. O segredo aberto so aparece na criacao/rotacao.

### `GET /api/applications/metadata/allowed-routes`

Retorna templates de rotas permitidas para applications:

- `GET /api/:resource`
- `GET /api/:resource/:id`
- `POST /api/:resource`
- `POST /api/:resource/bulk`
- `PUT /api/:resource/:id`
- `PATCH /api/:resource/:id`
- `DELETE /api/:resource/:id`
- `DELETE /api/:resource/bulk`

### `POST /api/applications/:id/revoke-token`

Path:

- `id`: UUID da application.

Incrementa `token_version`, invalida tokens emitidos e limpa cache.

### `POST /api/applications/:id/rotate-secret`

Path:

- `id`: UUID da application.

Gera novo `api_secret`, incrementa `token_version` e invalida tokens antigos.

### `POST /api/applications/clean-timeout/post`

Remove ban de rate limit do IP atual.

### `GET /api/applications/ban-time/get`

Retorna TTL restante do ban do IP atual, em segundos, ou `null`.

### `POST /api/applications/test-webhook/post`

Rota publica de teste. Body livre. Resposta atual: `"ok"`.

---

## Integracoes

### `POST /api/integrations/mark-lock-orders`

Alterna a trava de pedidos do dia para uma integracao.

Body:

```json
{ "name": "Bling" }
```

Resposta:

```json
{ "message": "Trava de pedidos na integração Habilitado " }
```

---

## Usuarios, roles e unidades

### `POST /api/users/login`

Body:

```json
{
  "email": "user@example.com",
  "password": "senha"
}
```

Resposta:

```json
{ "user": {} }
```

Tambem seta cookie HTTP-only `token` por 8h.

### `POST /api/users/logout`

Body:

```json
{ "userId": "uuid" }
```

Limpa cookie `token` e remove cache `user:<userId>`.

### `GET /api/users/me/get`

Requer autenticacao. Retorna usuario atual e renova cookie.

### `GET /api/roles/entities/get`

Retorna `ROLE_PERMISSIONS`, com escopos, entidades, rotas, permissoes e filhos.

### `GET /api/unit-business/head-office/get`

Retorna a unidade marcada como matriz.

### `GET /api/unit-business/all-unit-business/get`

Rota de permissao customizada para visualizar todas as lojas. Resposta atual: `true`.

---

## Notas fiscais e entrada

### `GET /api/invoice/full/:id`

Path:

- `id`: UUID da nota.

Retorna nota completa via `findByIdFull`.

### `GET /api/invoice/labels/data`

Query:

- `invoiceIds`: lista por query array ou CSV.

Exemplos:

- `/api/invoice/labels/data?invoiceIds=id1,id2`
- `/api/invoice/labels/data?invoiceIds[]=id1&invoiceIds[]=id2`

Retorna dados para etiquetas.

### `GET /api/invoice/danfe/data`

Query:

- `invoiceIds`: lista por query array ou CSV.

Gera PDF mesclado de DANFEs. Resposta `application/pdf`.

### `GET /api/invoice/xml/batch`

Query:

- `invoiceIds`: lista por query array ou CSV.

Gera ZIP com XMLs. Resposta `application/zip`.

### `POST /api/invoice/bulk/open`

Body:

```json
["uuid-da-nota-1", "uuid-da-nota-2"]
```

Altera notas com `status=OPEN` para `PENDING`.

### `PUT /api/invoice/schedule/invoice/:id`

Path:

- `id`: UUID da nota.

Body:

```json
{ "expectedDate": "2026-06-02" }
```

Agenda data esperada da nota.

### `PUT /api/invoice/bond/invoice/:id`

Path:

- `id`: UUID da nota pendente/cancelada.

Body:

```json
{ "bondedInvoiceId": "uuid-da-nota-vinculada" }
```

Vincula uma nota relacionada.

### `POST /api/invoice/import/xml`

Multipart form-data:

- `xml`: arquivo XML.

Enfileira upsert da nota a partir do XML.

### `GET /api/invoice/report/products`

Aceita os mesmos query params de paginacao/filtros. Retorna relatorio de produtos de notas.

### `POST /api/invoice-items/add/item`

Body:

```json
{
  "invoiceItem": {},
  "newEan": "789...",
  "unMappedProductId": "uuid"
}
```

Cria item de nota e pode resolver produto nao mapeado.

### `POST /api/unmapped-invoice-product/mark-updated/update`

Body:

```json
{ "ids": ["uuid"] }
```

Marca produtos nao mapeados como mapeados.

### `POST /api/unmapped-invoice-product/from-ean/create`

Multipart form-data:

- `image`: imagem obrigatoria.
- `ean`: codigo EAN.

Cria registro de produto nao mapeado a partir de leitura por EAN.

### `GET /api/unmapped-invoice-product/full/:id`

Path:

- `id`: UUID.

Retorna registro completo.

### `GET /api/unmapped-invoice-product/:id/image`

Path:

- `id`: UUID.

Retorna imagem armazenada com `Content-Type: image/<ext>`.

---

## Expedicao e lotes

### `POST /api/batch/generate-from-invoices`

Body:

```json
{
  "invoiceIds": ["uuid"],
  "unitBusinessId": "uuid",
  "type": "OUTGOING"
}
```

Gera lote(s) a partir de notas.

### `GET /api/batch/by-invoices/get`

Query:

- `invoiceIds`: array ou CSV.

Retorna lotes vinculados as notas.

### `GET /api/batch/by-ids/get`

Query:

- `batchesIds`: array ou CSV.

Retorna lotes por IDs.

### `GET /api/batch/full/get`

Query:

- `batchId`: UUID opcional.
- `number`: numero opcional.

Retorna lote completo por ID ou numero.

### `GET /api/batch/delivery-note/get`

Query:

- `batchId`: UUID do lote.
- `userId`: UUID do usuario.

Gera romaneio/nota de entrega.

### `GET /api/batch/delivery-notes/get`

Query:

- `batchIds`: lista de IDs.

Baixa/gera notas de entrega em lote.

### `POST /api/batch/add-invoice`

Body:

```json
{
  "invoiceKey": "chave-ou-id",
  "unitBusinessId": "uuid",
  "type": "INCOMING | OUTGOING",
  "batchId": "uuid"
}
```

Adiciona uma nota ao lote.

### `POST /api/batch/add-invoices`

Body:

```json
{
  "invoicesKey": ["chave-ou-id"],
  "unitBusinessId": "uuid",
  "type": "INCOMING | OUTGOING",
  "batchId": "uuid"
}
```

Adiciona varias notas ao lote.

### `PUT /api/batch/finish/:batchId`

Path:

- `batchId`: UUID do lote.

Body:

```json
{ "justification": "opcional" }
```

Finaliza lote.

### `GET /api/batch/is-complete/:batchId`

Path:

- `batchId`: UUID.

Retorna status de completude.

### `GET /api/batch/multiplier-scan-entrance/get`

Rota de permissao customizada para multiplicador de entrada. Resposta atual: `true`.

### `DELETE /api/batch-invoices/remove/:id`

Path:

- `id`: UUID do vinculo `expedition_batch_invoices`.

Remove nota do lote.

### `POST /api/scan-logs/scan/product`

Body:

```json
{
  "labelcode": "codigo-etiqueta",
  "productcode": "sku-ou-ean",
  "batchId": "uuid",
  "userId": "uuid"
}
```

Escaneia produto de saida.

### `POST /api/scan-logs/scan/product/incoming`

Body:

```json
{
  "labelcode": "codigo-etiqueta",
  "batchId": "uuid",
  "userId": "uuid",
  "quantity": 1
}
```

Escaneia produto de entrada.

### `POST /api/scan-logs/scan/product/incoming/by-invoice`

Body:

```json
{
  "labelcode": "codigo-etiqueta",
  "batchId": "uuid",
  "invoiceId": "uuid",
  "userId": "uuid",
  "quantity": 1
}
```

Escaneia entrada vinculada a nota especifica.

### `POST /api/scan-logs/bulk-remove-logs`

Body:

```json
{
  "batchId": "uuid",
  "items": []
}
```

Remove logs de saida em massa.

### `POST /api/scan-logs/bulk-remove-logs-incoming`

Body:

```json
{
  "batchId": "uuid",
  "items": []
}
```

Remove logs de entrada em massa.

---

## Inventario

### `POST /api/inventory-batch/create`

Body:

```json
{
  "unitBusinessId": "uuid",
  "mode": "opcional"
}
```

Cria lote de inventario.

### `GET /api/inventory-batch/full/get`

Query:

- `batchId`: UUID opcional.
- `number`: numero opcional.
- `userId`: UUID opcional.

Retorna lote completo por ID ou numero.

### `POST /api/inventory-batch/finish/post`

Body:

```json
{ "batchId": "uuid" }
```

Finaliza inventario.

### `POST /api/inventory-batch/create/divergency`

Body:

```json
{ "parentBatchId": "uuid" }
```

Cria lote de divergencia.

### `GET /api/inventory-batch/financial-batch-info/get`

Rota de permissao customizada financeira. Resposta atual: `true`.

### `GET /api/inventory-batch/multiplier-scan-inventory/get`

Rota de permissao customizada para multiplicador de inventario. Resposta atual: `true`.

### `DELETE /api/inventory-batch-items/remove-item/:id/batch/:batchId`

Path:

- `id`: UUID do item.
- `batchId`: UUID do lote.

Remove item do lote.

### `POST /api/inventory-batch-logs/scan/product`

Body:

```json
{
  "unitBusinessId": "uuid",
  "productCode": "sku-ou-ean",
  "inventoryBatchId": "uuid",
  "userId": "uuid",
  "quantity": 1
}
```

Registra leitura no inventario.

### `PUT /api/inventory-batch-logs/update/quantity`

Body:

```json
{
  "logId": "uuid",
  "userId": "uuid",
  "newQuantity": 2
}
```

Atualiza quantidade de um log.

---

## Operacoes

### `GET /api/operation/full/:id`

Path:

- `id`: UUID da operacao.

Retorna operacao completa.

### `PUT /api/operation/confirm-received/:id`

Path:

- `id`: UUID da operacao.

Observacao tecnica: o controller tenta ler `userId` de `req.params`, mas a rota atual nao declara `:userId`.

---

## Transportadoras e layouts

### `POST /api/carrier-label-ranges/from-excel`

Multipart form-data:

- `file`: Excel obrigatorio.
- `transporter_id`: UUID da transportadora.

Retorna `202` e processa importacao em background.

### `POST /api/carrier-import-layouts/with-file`

Multipart form-data:

- `file`: Excel obrigatorio.
- demais campos do layout: `transporter_id`, `name`, `type`, `sheet_name`, `data_start_row`, `mapping_mode`, labels de colunas, `active`.

Cria layout e inicia importacao de nomenclaturas.

---

## Pedidos

### `POST /api/order/release-waiting-acceptance-for-today`

Sem body.

Libera pedidos de hoje que estavam em `waiting_acceptance`.

---

## Relatorios

### `GET /api/daily-operation-report`

Query:

| Parametro | Alias | Descricao |
|---|---|---|
| `date` | `data` | Data do relatorio |
| `unitBusinessId` | `unit_business_id` | Unidade de negocio |
| `transporterId` | `transporter_id` | Transportadora |
| `drillDown` | - | `"true"` para detalhar |

### `POST /api/daily-operation-report/run`

Executa job incremental do relatorio operacional.

### `GET /api/sales-report`

Query:

| Parametro | Alias | Descricao |
|---|---|---|
| `dateFrom` | `date_from` | Inicio do periodo |
| `dateTo` | `date_to` | Fim do periodo |
| `unitBusinessId` | `unit_business_id` | Unidade |
| `storeId` | `store_id` | Loja |
| `state` | `destination_uf` | UF destino |
| `productId` | `product_id` | Produto |
| `sku` | - | SKU |
| `statusId` | `status_id` | Status |
| `drillDown` | - | `"true"` para detalhar |

### `POST /api/sales-report/run`

Executa job incremental do relatorio de vendas.

---

## Bling

### `POST /api/bling/webhook`

Endpoint unificado de webhook Bling.

Headers:

- `X-Bling-Signature-256`: assinatura HMAC SHA-256.

Body esperado:

```json
{
  "eventId": "id",
  "date": "2026-06-02T12:00:00Z",
  "version": "v1",
  "event": "order.created",
  "companyId": "id",
  "data": {}
}
```

Recursos suportados pelo orquestrador:

- `order`
- `product`
- `stock`
- `invoice`
- `consumer_invoice`
- `product_supplier`
- `virtual_stock` e derivado/ignorado

Responde `200` para eventos recebidos/ignorados e tambem para erros internos ja alertados, evitando retentativas indevidas. Assinatura invalida retorna `401`.

### `GET /api/bling/auth/bling`

Inicia OAuth Bling. Gera `oauth_state`, salva no config token e redireciona para Bling.

### `GET /api/bling/callback`

Query:

- `code`
- `state`

Valida state e salva tokens OAuth.

### `POST /api/bling-orders/webhook`

Endpoint legado de webhook de pedidos Bling.

Body esperado:

```json
{
  "event": "order.created",
  "data": {
    "id": 123456,
    "numero": "000123",
    "numeroLoja": "ORDER-001",
    "contato": {
      "nome": "Cliente",
      "tipoPessoa": "F",
      "numeroDocumento": "12345678901"
    }
  }
}
```

Enfileira em `BlingOrderQueue` com jobId `bling-order-<action>-<orderId>`.

### `GET /api/bling-orders/auth/bling`

OAuth legado Bling para pedidos.

### `GET /api/bling-orders/callback`

Callback OAuth legado. Query `code` e `state`.

---

## Impressoras

### `GET /api/printer/active`

Query:

- `unitBusinessId`: UUID obrigatorio.

Retorna configuracao ativa de impressora da unidade.

Observacao: `src/modules/handlers/printer/printer.routes.ts` contem rotas locais `GET /printers` e `POST /print`, mas exporta `printerController.router`; pelo codigo atual essas rotas locais nao ficam ativas no app.

---

## Resumo de parametros por tipo

### IDs em path

Usar UUID para `:id`, `:batchId`, `:invoiceId`, `:userId`, salvo quando indicado como numero/chave externa.

### Listas em query

Controllers aceitam listas como array de query ou CSV em:

- `invoiceIds`
- `batchesIds`
- `batchIds`

### Uploads multipart

- `POST /api/invoice/import/xml`: campo `xml`
- `POST /api/unmapped-invoice-product/from-ean/create`: campo `image`
- `POST /api/carrier-label-ranges/from-excel`: campo `file`
- `POST /api/carrier-import-layouts/with-file`: campo `file`

### Permissoes customizadas

Rotas que mapeiam para entidades customizadas:

- `financial-batch-info` e `sales-report` -> `financial-pdt`
- `multiplier-scan-inventory` -> `multiply-stk-inventory`
- `multiplier-scan-entrance` -> `multiply-stk-entrance`
- `all-unit-business` -> `visualize-all-unit-business`
