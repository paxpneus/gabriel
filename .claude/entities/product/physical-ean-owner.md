# Confirmar EAN físico + validação de EAN por integração

## Regra geral de EAN (todos os fluxos)

- **Sempre por integração, nunca por loja**: `gtin` de qualquer unit business da integração + DE x PARA (`integrations_id`). Centro em `src/modules/handlers/tecinco/queues/helpers/product.helpers.ts`.
- **Zero à esquerda**: `buildEanZeroVariants(ean)` (exato + variações de zero, 12–14 dígitos), `eanZeroInsensitiveKey(code)` (chave de agrupamento). Resolução normal segue exata; variações só em bipe e checagem de conflito (ver memória `ean-leading-zeros-are-significant`).
- **Ambiguidade (EAN → mais de um produto)**: bipe (inventário `resolveProductByEanWithStock`, expedição/entrada `productService.findByCode`, `GET /product/by-code`) dá erro; fluxo automático (sync, XML, backfill) omite/pula; fluxo manual dá erro com `code`.
- Helpers: `isEanBlockedForProduct` (override de outro em qualquer variação OU gtin de outro exato/variação OU DE x PARA de outro com outro zero — o DE x PARA exato fica pro `assertEanNotOwnedByAnotherProduct`, que remove), `findAnotherProductUsingEan`, `resolveProductIdBySupplierMappingEan` (ambíguo → null), `isCodeOwnedByAnotherProduct` (gtin com variações, sku exato).
- Sync com EAN bloqueado: `eanOmitted` — produto sincroniza, só sem `gtin`/DE x PARA; `gtin_erp` continua gravado.

## Confirmar EAN físico (`is_physical_override`)

`POST /supplier-mapping/product/:productId/physical-owner`, body `{ supplier_product_code, integrations_id? }` — `integrations_id` do body (desktop) ou da loja do usuário (coletor). Permissão RBAC própria "Confirmar EAN físico" (entity `physical_ean_owner`, rota `physical-owner` no `CUSTOM_ROUTE_MAP`); admin/developer sempre passam (bypass do `userPermissions` por `FULL_ACCESS_USER_TYPES`).

`supplierMappingService.assignPhysicalOwner`, uma transação:
1. Produto sem integration mapping na integração → `PRODUCT_NOT_MAPPED_IN_INTEGRATION`.
2. Donos do EAN (variações) na integração; algum é override de **outro** produto → `EAN_HAS_PHYSICAL_OVERRIDE` com quem/quando (`audit_logs`), nada alterado. **Override nunca derruba override.**
3. Zera `gtin` dos ProductConfigs donos e **depois** apaga os DE x PARA donos (ordem por causa dos triggers `m263`/`m272`).
4. Upsert do DE x PARA `(produto, código exato, integração, is_physical_override: true)`. `ProductConfig.gtin` do dono não é gravado (o sync sobrescreveria) — bipe resolve pelo DE x PARA.
5. `unmappedInvoiceProductService.closeScanRowsByEan` apaga os `ERROR_SCAN` do EAN (variações) na integração.
6. Auditoria: entrada principal no PRODUCT + uma por entidade afetada.

- **Proteção no sync** (Bling `fetchAndUpsertProduct`, Tecinco `processProduct`/nota): EAN com override de outro produto → `eanOmitted`; `assertEanNotOwnedByAnotherProduct` nunca apaga override (lança `EanConflictError`); upsert direto de DE x PARA do Bling nunca reaproveita linha com override. Sync **nunca cria** override.
- **Quem cria override**: só `assignPhysicalOwner` e `createFromUnmapped` (sempre `true`; reaproveitando DE x PARA do mesmo produto, marca o existente).
- **Desativar override**: `PUT /supplier-mapping/product/:productId/:id` com `is_physical_override: false` (só admin/developer, auditado) — vira DE x PARA comum do mesmo produto: o próximo sync do outro produto cujo ERP manda o EAN pode removê-lo (`assertEanNotOwnedByAnotherProduct`) e gravar o gtin lá. `true` nesse PUT → erro (confirmar só pela rota própria).
- **Alterar/apagar override**: só admin/developer (`FULL_ACCESS_USER_TYPES` em `user_config.type`); rotas genéricas descartam `is_physical_override` do body. Depois de apagar, o próximo sync devolve o EAN do ERP aos outros produtos.
- Erros: `SupplierMappingError(code, msg, owners?, override?)` → HTTP 400 via `supplierMappingService.buildErrorResponse(error, token)` (supplier-mapping e invoice-items controllers) → `{ error, code, owners?, override?, can_confirm_physical_owner }`. Flag só `true` em `EAN_OWNED_BY_ANOTHER_PRODUCT` com permissão (`canConfirmPhysicalOwner`: admin/developer ou papel com `PHYSICAL_EAN_OWNER_ENTITY`); a mensagem final (Confirmar EAN físico vs. foto) é montada no back. `EAN_OWNED_BY_ANOTHER_PRODUCT` (com `owners`) → front oferece "Confirmar EAN físico"; `EAN_HAS_PHYSICAL_OVERRIDE` → front mostra quem/quando e abre o modal de foto.
