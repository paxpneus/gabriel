# Sincronização Bling → Magento (produtos)

Desacoplada numa fila própria: `magento-sync.queue.ts` (`MagentoSyncQueue`, fila `MAGENTO_SYNC`). `bling-api-fetch.queue.ts` só enfileira um job `{kind:"sync-product", productId}` (jobId `magento-sync-product-<id>`) ao final de `fetchAndUpsertProduct` para produto UNIT (KIT nunca sincroniza com o Magento) e retorna — não fala mais com a API do Magento nem bloqueia nela. O worker da `MAGENTO_SYNC` (rodando no container `startBlingWorkers`, ver `queues/index.ts`) que tenta achar/mapear o produto correspondente no Magento e sincroniza preço/custo_medio.

## Por que existe uma fila separada

Antes esse trabalho rodava embutido no job da `BLING_API_FETCH`, então só disparava quando a Bling mandava webhook. Isso bastava enquanto `populate-from-bling` varria o catálogo inteiro todo dia — mas esse script passou a buscar só produto com movimento de estoque, então o resto do catálogo parou de receber sync com o Magento. A fila `MAGENTO_SYNC` tem dois tipos de job:

- `sync-product` (`productId`): sincroniza 1 produto — disparado pela Bling a cada update/stock, ou pelo job diário abaixo.
- `sync-all`: sem payload além do `kind`; agendado via cron fixo (`0 23 * * *` BRT, jobId `magento-sync-all-cron`, registrado em `startBlingWorkers`) — varre todo `ProductConfig` da unit business da Bling com `sku` preenchido, filtra só produto `type=UNIT`, e enfileira um `sync-product` por produto. Cobre o catálogo inteiro, substituindo a cobertura diária que `populate-from-bling` dava antes.

`BlingApiFetchQueue` instancia seu próprio client `MagentoSyncQueue({workless:true})` internamente (só produtor, nunca consumidor) — não precisa de injeção de dependência, então todo lugar que já cria `new BlingApiFetchQueue(...)` (scripts, `sefaz-procnfe-retry.queue.ts`, etc.) continua funcionando sem alteração.

## `integration_mapping.external_id` = `entity_id` do Magento (não o sku)

O Magento permite renomear o sku de um produto sem trocar sua identidade (`entity_id`/`id` interno, imutável). Por isso `external_id` guardado no `integration_mapping` (entity_type `PRODUCT`, integração Magento) é sempre o `id` numérico interno do produto, nunca o sku — senão o mapping quebra silenciosamente se o sku for renomeado no catálogo.

Consequência prática: a REST API do Magento **não tem** `GET /products/:id` (só `GET /products/:sku`). Toda busca por id é via `searchCriteria` filtrando `entity_id` (`MagentoCatalogService.buscarProdutoPorId`, `products.service.ts`). Operações de escrita num produto específico (`atualizarProduto`/`atualizarCustomAttribute`, ex.: sync de `custo_medio`) exigem o sku *atual* — por isso sempre resolvem o produto pelo id primeiro (via `fetchMagentoProductById`) pra pegar o sku corrente antes de fazer o PUT.

## Resolução do produto (`fetchMagentoProduct`, em `magento-sync.queue.ts`)

- **Já mapeado** (existe `integration_mapping` com `external_id`): busca só por id (`fetchMagentoProductById`). Não encontrar (produto excluído no Magento) → trata como não encontrado, não tenta sku/nome de novo.
- **Sem mapping ainda** (1ª vez): tenta por sku (`ProductConfig.sku`, via `GET /products/:sku`). Se der 404, cai no fallback por nome (`fetchMagentoProductByName` → `buscarProdutosPorNome`, `LIKE` no nome) — só aceita o match se vier **exatamente 1 resultado** e o nome bater igual (normalizado: trim/lowercase/sem acento). Nome ambíguo ou parcial não mapeia, cai pro fluxo de `unmapped_invoice_products`.

Ao mapear (achou o produto, por qualquer via), grava `external_id: String(magentoProduct.id)` e apaga qualquer `unmapped_invoice_products` obsoleto pro mesmo sku/ean+integração (`status=UNMAPPED`, `invoice_id IS NULL`) — roda sempre que o produto resolve no Magento nessa passada, tanto mapping novo quanto já existente, então também limpa retroativamente unmapped antigo de produto que já tinha sido mapeado antes dessa limpeza existir (basta o `sync-all` diário passar por ele de novo).

## Preço (`ProductConfig.price`): a Bling só escreve antes de existir mapping

A checagem é do lado da **Bling**, não da `MAGENTO_SYNC`: dentro da transaction de `fetchAndUpsertProduct` (`bling-api-fetch.queue.ts`), antes do `ProductConfig.upsert`, o código consulta `integrationMappingService.findExternalIdsMap` pra saber se o produto (não-KIT) já tem `integration_mapping` pro Magento. Se **já tem mapping**, o campo `price` é omitido do objeto passado pro `upsert` — Sequelize não toca a coluna no `ON CONFLICT UPDATE`, preservando o que já está lá. Se **ainda não tem mapping**, escreve `price: Number(blingProduct.preco)` normalmente. KIT sempre escreve o preço vindo da Bling (nunca é mapeado pro Magento, a checagem nem roda).

Isso faz da Bling a dona do preço só até o produto ser mapeado pela primeira vez; a partir daí, quem mantém `price` atualizado é o job `sync-product` da `MAGENTO_SYNC` (que sempre escreve o preço achado no Magento, incondicionalmente — ver `syncProduct` em `magento-sync.queue.ts`).

## Histórico: mappings antigos guardavam sku, não id

Mappings criados antes desta mudança guardavam o **sku** em `external_id` (semântica antiga). Buscar esses por `entity_id` não acha nada e o produto era erroneamente tratado como excluído no Magento, rebaixando pra `unmapped_invoice_products`. Correção: apagar todos os `integration_mappings` da integração Magento (`DELETE FROM integration_mappings WHERE integrations_id = (SELECT id FROM integrations WHERE name = 'Magento' AND type = 'SYSTEM')`) e deixar a fila remapear do zero pelo fluxo sku→nome — não existe fallback de compat pra sku legado no código, produto mapeado que não resolve por id vai direto pro unmapped.
