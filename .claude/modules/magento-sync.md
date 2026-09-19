# Sincronização Bling → Magento (produtos)

Fluxo em `bling-api-fetch.queue.ts`: pra cada produto UNIT vindo da Bling (KIT nunca sincroniza com o Magento), tenta achar/mapear o produto correspondente no Magento e sincroniza preço/custo_medio.

## `integration_mapping.external_id` = `entity_id` do Magento (não o sku)

O Magento permite renomear o sku de um produto sem trocar sua identidade (`entity_id`/`id` interno, imutável). Por isso `external_id` guardado no `integration_mapping` (entity_type `PRODUCT`, integração Magento) é sempre o `id` numérico interno do produto, nunca o sku — senão o mapping quebra silenciosamente se o sku for renomeado no catálogo.

Consequência prática: a REST API do Magento **não tem** `GET /products/:id` (só `GET /products/:sku`). Toda busca por id é via `searchCriteria` filtrando `entity_id` (`MagentoCatalogService.buscarProdutoPorId`, `products.service.ts`). Operações de escrita num produto específico (`atualizarProduto`/`atualizarCustomAttribute`, ex.: sync de `custo_medio`) exigem o sku *atual* — por isso sempre resolvem o produto pelo id primeiro (via `fetchMagentoProductById`) pra pegar o sku corrente antes de fazer o PUT.

## Resolução do produto (`fetchMagentoProduct`)

- **Já mapeado** (existe `integration_mapping` com `external_id`): busca só por id (`fetchMagentoProductById`). Não encontrar (produto excluído no Magento) → trata como não encontrado, não tenta sku/nome de novo.
- **Sem mapping ainda** (1ª vez): tenta por sku (`ProductConfig.sku`, via `GET /products/:sku`). Se der 404, cai no fallback por nome (`fetchMagentoProductByName` → `buscarProdutosPorNome`, `LIKE` no nome) — só aceita o match se vier **exatamente 1 resultado** e o nome bater igual (normalizado: trim/lowercase/sem acento). Nome ambíguo ou parcial não mapeia, cai pro fluxo de `unmapped_invoice_products`.

Ao mapear (achou o produto, por qualquer via), grava `external_id: String(magentoProduct.id)`.

## Histórico: mappings antigos guardavam sku, não id

Mappings criados antes desta mudança guardavam o **sku** em `external_id` (semântica antiga). Buscar esses por `entity_id` não acha nada e o produto era erroneamente tratado como excluído no Magento, rebaixando pra `unmapped_invoice_products`. Correção: apagar todos os `integration_mappings` da integração Magento (`DELETE FROM integration_mappings WHERE integrations_id = (SELECT id FROM integrations WHERE name = 'Magento' AND type = 'SYSTEM')`) e deixar a fila remapear do zero pelo fluxo sku→nome — não existe fallback de compat pra sku legado no código, produto mapeado que não resolve por id vai direto pro unmapped.
