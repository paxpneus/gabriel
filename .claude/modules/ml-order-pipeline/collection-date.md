# `collection_date` — origem, scraping da tela de detalhe, bug de timezone

## `collection_date` pode vir de `dataPrevista` (payload Bling) ou da tela de detalhe do pedido no ML

`BlingOrderService` (`createOrderFromBling`/`updateOrderFromBling`) grava `collection_date` direto de `orderData.dataPrevista` (via `startOfDayTz`, mesmo padrão do campo `date`) sempre que a Bling manda essa data preenchida; se vier vazia, a chave é **omitida** do payload de update (nunca gravada como `null`), preservando qualquer valor já resolvido via scraping. `MLOrderSyncQueue.syncFromWebhookLocked` checa `if (orderSystem.collection_date)` pra pular direto pro agendamento da NFe quando a Bling já informou a data prevista.

Pra pedidos sem `dataPrevista`: não existe mais uma fila `ML-SCRAPING` separada baixando a planilha de vendas em lote. `MLScrapingService.scrapeOrderDetail(orderNumber)` (`mercado-livre-scraping.service.ts`) navega direto, via Playwright, pra `ML_ORDER_DETAIL_URL` (env, `{orderNumber}` substituído pelo `number_order_channel` do pedido — já disponível desde o webhook, gravado por `BlingOrderService` a partir de `orderData.numeroLoja`, antes de qualquer scraping) e extrai a `collection_date` do texto da própria página, com as mesmas três regras de negócio de antes:
- Página contém "Informe a NF-e já emitida" → `collection_date` = hoje (`startOfDayTz()`). O corte 6h–13h que decide se a NFe fica agendada pra hoje ou empurra pra amanhã 6h continua em `setDelayBasedOnDate`/`scheduleNfe`, sem mudança.
- Página contém "Para entregar na coleta de amanhã" → `collection_date` = amanhã (`startOfDayTz(nowTz().add(1, "day"))`).
- Página contém "Para entregar na coleta do dia D de MÊS" → `collection_date` = aquela data (mesmo parsing de mês/ano-rollover de antes).

Essa chamada roda **dentro do próprio job da `ML_ORDER_SYNC`**
(`MLOrderSyncQueue.scrapeAndApplyCollectionDate`), disparada de
`syncFromWebhookLocked` quando o pedido chega sem `collection_date` — não
enfileira mais nada em outra fila. Se a página ainda não tiver nenhuma das
três condições (ex: Mercado Livre ainda não atualizou a tela), o pedido
fica em `WAITING_CHANNEL_VALIDATION` e só é resolvido numa tentativa
seguinte — não há mais lote/planilha nem cache `orders_seven_days_ago`
nem matching por data+comprador (`matchesOrderByDateAndBuyer`,
`findSiblingOrders`, SKU-guard contra falso-match): como cada pedido já
sabe seu próprio `number_order_channel`, a extração é sempre exata, sem
matching nenhum.

`ReconcilerQueue.reconcileMissingCollectionDate` (`nfe-reconciler.queue.ts`, roda no `Promise.allSettled` de `NFE_RECONCILER`, a cada 15min) é a rede de segurança: busca ao vivo na Bling todos os pedidos em situação `748743`, filtra os que a Bling ainda não tem `dataPrevista`, cruza com o banco pra achar os com `collection_date` nulo, e reenfileira um job `{orderSystem, customer: null}` por pedido direto na `ML_ORDER_SYNC` (`jobId` fixo por pedido, `ml-order-sync-collection-${order.id}`) — cobre o caso do disparo original ter falhado silenciosamente, nunca ter ocorrido, ou a tela do ML ainda não ter nenhuma das três condições esperadas. `reconcileStuckOrders` só espera `ML_ORDER_SYNC` ficar livre antes do sweep (não existe mais uma fila de scraping separada pra esperar também). Detalhe completo em `docs/automation/order-pipeline.md`.

## `collection_date` (pedidos ML) gravado como meia-noite UTC em vez de meia-noite BRT

Offset real e silencioso de 3 horas, corrigido no passado nas 3 branches que calculavam `collectionDate` a partir da planilha (construíam o valor via `new Date(Date.UTC(y,m,d))` em vez de `startOfDayTz()`/`nowTz()`). A extração atual (`MLScrapingService.extractOrderDetail`) já nasce usando `startOfDayTz()`/`nowTz()` nas duas branches (hoje / "coleta do dia D de MÊS"), então não reintroduz esse bug.

**Gap retroativo, não totalmente autocurável (histórico)**: pedidos agendados antes do fix original mantêm o encoding antigo até serem coletados de verdade — corrigido do lado da leitura por `collectionDateDayRangeCompat(date?)`/`collectionDateFutureStartCompat(date?)` (`date.ts`), que casam com qualquer um dos dois encodings pra um dia calendário sem vazar pro dia adjacente. Usadas por `storeCollectionDateTodayWhere` (`../../entities/invoice/ml-shipping-filters.md`) e `orders.repository.ts`'s `countShipTodayPending`/`countShipToFuture`; `orders/order/helpers/aggregates.ts`'s `collectionDateBucketLiteral` (usado por `groupShipToFutureByDate`) faz a normalização equivalente em SQL.

## `setDelayBasedOnDate(date)` (`src/shared/utils/queues/setDelay.ts`)

Calcula o delay pro job BullMQ de emissão de NFe. Mira o **mesmo dia** que `collection_date` às 06:00 BRT (09:00 UTC); se "agora" já passou das 13:00 BRT (16:00 UTC) nesse dia, mira o **dia seguinte** às 06:00 BRT. Usado por `MLOrderSyncQueue.scheduleNfe` e `ReconcilerQueue.reconcileWaitingNfe` — mesma fórmula pros dois, sem override por chamador.
