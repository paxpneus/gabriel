# Pipeline de automação de pedidos (Mercado Livre → Bling)

Este documento é a referência de como o pedido flui pelas filas, o que cada
fila espera encontrar e o que ela escreve, o mecanismo de lock que protege
tudo isso, e os cuidados de coordenação entre filas que leem/escrevem o
mesmo estado. Mantenha este arquivo representando o estado **atual** da
automação — não é um changelog: descreva como ela funciona hoje, não o
histórico de bugs encontrados/corrigidos (isso fica no `CLAUDE.md`).
Atualize sempre que uma fila nova passar a ler/escrever `internal_status` —
veja a seção final antes de adicionar uma.

## Visão geral

```
BLING_ORDER_INGESTION → CNPJ_VERIFY_CNAE → ML_ORDER_SYNC → NFE_EMISSION
        (webhook)         (verifica CNAE)   (casa com ML)   (emite NFe)
```

`NFE_RECONCILER` e `BLING_RECONCILER` rodam em paralelo, em intervalos
próprios, como rede de segurança — recriam jobs perdidos e corrigem
pedidos que ficaram presos, sem fazer parte do fluxo principal.

Cada pedido avança por essas etapas sequencialmente, mas **pedidos
diferentes correm 100% em paralelo entre si**, em todas as filas ao mesmo
tempo — não existe uma fila "principal" nem uma ordem de prioridade entre
elas. A única coisa que serializa é o **mesmo pedido** sendo tocado por mais
de uma fila ao mesmo tempo (ver "Lock por pedido" abaixo).

## Máquina de estados

| `OrderInternalStatus` | situação Bling | Fila que normalmente escreve |
|---|---|---|
| `OPEN` | 6 | `BLING_ORDER_INGESTION` |
| `WAITING_CHANNEL_VALIDATION` | 748743 | `CNPJ_VERIFY_CNAE` |
| `WAITING_FOR_NFE_EMISSION` | 748748 | `ML_ORDER_SYNC` |
| `EMITTED` | 9 | `NFE_EMISSION` |
| `SENT_TO_TRANSPORTER` | 834029 | espelhado da Bling (não gerado pela automação) |
| `DELIVERED` | 834030 | espelhado da Bling (não gerado pela automação) |
| `CANCELLED` | 12, 21, **e 748772** | `CNPJ_VERIFY_CNAE`, `NFE_EMISSION`, `NFE_RECONCILER` |

`EMITTED`/`SENT_TO_TRANSPORTER`/`DELIVERED` são os
`COMPLETED_ORDER_INTERNAL_STATUSES` — toda fila do pipeline checa isso
antes de agir, pra nunca reabrir um pedido já concluído.

Situação `748772` ("aguardando verificação humana") é escrita por 3 lugares
diferentes com motivos diferentes (CNAE bloqueado, falha na emissão de NFe,
pedido preso sem match no scraping), e `mapOrderInternalStatus` colapsa
todos eles no mesmo `CANCELLED` de um cancelamento real do cliente
(situação 12/21) — **essa distinção agora existe na coluna `orders.reason_cancelled`**
(enum, nullable), gravada de forma síncrona pela fila que decide o
cancelamento, no mesmo momento em que escreve `internal_status=CANCELLED`:

| `reason_cancelled` | Quem grava | Motivo |
|---|---|---|
| `DOCUMENT_INVALID` | `CNPJ_VERIFY_CNAE` (`markOrderError`, errorId 1) | Documento do cliente ausente/inválido |
| `CNAE_BLOCKED` | `CNPJ_VERIFY_CNAE` (`markOrderError`, errorId 2) | CNAE do cliente bloqueado |
| `NFE_WRONG_STATUS` | `NFE_EMISSION` (`markOrderCancelled`) | Situação divergiu de NFE_AGENDADA (748748) ao tentar emitir |
| `NFE_MISSING_FIELDS` | `NFE_EMISSION` (`markOrderCancelled`) | Campos obrigatórios ausentes pra emissão |
| `NFE_NO_STOCK` | `NFE_EMISSION` (`markOrderCancelled`) | Bling recusou emissão por falta de estoque (field code 74) |
| `NFE_EMISSION_FAILED` | `NFE_EMISSION` (`onFailed`, após esgotar retries) | Falha genérica ao gerar NFe na Bling |
| `ML_SCRAPING_NO_MATCH` | `NFE_RECONCILER` (`reconcileStuckOrders`) | Pedido preso >30min sem match na planilha do Mercado Livre |
| `CUSTOMER_CANCELLED` | `BLING_ORDER_INGESTION` (webhook, situação 12/21) | Cancelamento real, feito pelo cliente ou direto na Bling |

O webhook (`BLING_ORDER_INGESTION`) só grava `reason_cancelled` para
situação `12`/`21` — para qualquer outra situação (inclusive `748772`
chegando como confirmação tardia de um cancelamento que uma fila já
decidiu e já gravou) a chave é **omitida**, nunca zerada, pra não
sobrescrever um motivo mais específico já gravado antes. O branch de
`reconcileStuckOrders` que só resincroniza uma mudança de situação feita
por fora da automação (não é ele quem decidiu cancelar) também não grava
motivo nenhum.

## As 6 filas

- **`BLING_ORDER_INGESTION`** (`bling-order.queue.ts`) — recebe webhooks de
  pedido (`order.created`/`order.updated`), cria/atualiza a linha local
  espelhando a situação Bling atual (busca ao vivo, não confia no payload
  do webhook), e só segue a cadeia (enfileira pro `CNPJ_VERIFY_CNAE`) se a
  situação buscada for `6` (OPEN). Pedidos de outras lojas (não Mercado
  Livre) são só salvos, sem entrar na automação.
- **`CNPJ_VERIFY_CNAE`** (`cnpj.queue.ts`) — rebusca o pedido ao vivo,
  confirma que ainda está em situação `6`, valida documento/CNAE do
  cliente. Sucesso: PATCH situação `748743` + `internal_status:
  WAITING_CHANNEL_VALIDATION`, enfileira pro `ML_ORDER_SYNC`. Falha
  (documento inválido ou CNAE bloqueado): PATCH `748772` +
  `internal_status: CANCELLED`.
- **`ML_ORDER_SYNC`** (`mercado-livre-sync.queue.ts`) — a única fila que
  escreve `collection_date`. Duas origens de job: match do Excel de
  scraping (`{row}`) ou webhook de pedido (`{orderSystem, customer}`).
  Confirma sempre, ao vivo, que o pedido ainda está em
  `WAITING_CHANNEL_VALIDATION`/`748743` antes de agir
  (`isEligibleForSync`). Ao achar `collection_date`: PATCH situação
  `748748` + `internal_status: WAITING_FOR_NFE_EMISSION`, agenda job
  delayed no `NFE_EMISSION`. Também expõe `resumeAfterAcceptance`, usada
  pra retomar o agendamento de um pedido que ficou travado esperando
  aceite manual (ver "Coordenação entre filas" abaixo).
- **`NFE_EMISSION`** (`nfe.queue.ts`) — confirma ao vivo que a situação
  ainda é `748748` (`NFE_AGENDADA`) antes de emitir. Sucesso: `nfe_emitted:
  true`, `internal_status: EMITTED`. Falha (situação divergente, campos
  faltando, erro da Bling): PATCH `748772` + `internal_status: CANCELLED`.
- **`NFE_RECONCILER`** (`nfe-reconciler.queue.ts`) — 3 rotinas
  independentes, disparadas juntas via `Promise.allSettled`:
  - `reconcileWaitingNfe`: recria job de emissão faltando no Redis pra
    pedido já em `WAITING_FOR_NFE_EMISSION` com `collection_date`.
  - `reconcileOpenOrders`: reenfileira `document-check` faltando pro
    `CNPJ_VERIFY_CNAE`, pra pedido preso em `OPEN`.
  - `reconcileStuckOrders`: pedido em `WAITING_CHANNEL_VALIDATION` há mais
    de 30min — se a situação ao vivo ainda confirmar isso, marca `748772`
    (verificação humana). Espera `ML_ORDER_SYNC` ficar livre antes de
    rodar (ver "Coordenação entre filas" abaixo).
- **`BLING_RECONCILER`** (`bling-reconciler.queue.ts`) — 2 rotinas:
  - `reconcileOpenOrders` (a cada 2h): cria localmente pedidos que já
    existem na Bling em situação `6` mas ainda não foram sincronizados.
  - `syncInvoicedOrCollectedOrders` (a cada 30min): pedidos em situação `6`
    que já existem localmente e já deveriam ter avançado — se já tem NF
    vinculada, PATCH `9`; se não tem NF mas já tem `collection_date` local,
    PATCH `748748`.

## Lock por pedido (`withOrderLock`)

`BaseQueueService.withOrderLock` (`base-queue-service.ts`). Mutex Redis
(`SET key NX PX`) com chave **dinâmica** —
`locks:bling:order:${idOrderSystem}` — em vez de uma chave fixa
compartilhada entre filas. Isso significa:

- Pedidos diferentes correm em paralelo total, mesmo entre filas
  diferentes, mesmo dentro da mesma fila (todas as 6 rodam com
  `concurrency` > 1).
- Só serializa quando duas coisas tentam tocar o **mesmo** pedido ao mesmo
  tempo — quem pede o lock primeiro pega; o outro espera (retry curto, até
  2min de teto) e, se estourar, o job falha e tenta de novo depois pelo
  mecanismo normal de retry do BullMQ.
- **Não é reentrante** — cada fluxo pega o lock uma única vez, no ponto de
  entrada, e todo o resto da cadeia daquele fluxo (incluindo chamadas
  internas tipo `scheduleNfe`/`finalizeNfeScheduling`) assume que já está
  dentro do lock, sem pegar de novo.
- A chave usada é o **id do pedido na Bling** (`id_order_system` uma vez
  persistido; o `data.id` cru do webhook antes disso) — o único
  identificador presente em toda etapa do pipeline, garantindo que as 6
  filas disputem corretamente pelo mesmo pedido físico.

## Rate limit da Bling

`waitForBlingRateLimit()` (`bling_api.service.ts`) — leaky bucket via Redis,
independente de qual fila faz a chamada. Não tem relação nenhuma com o lock
por pedido acima — mesmo com todos os pedidos rodando em paralelo, toda
chamada HTTP pra Bling ainda respeita o mesmo espaçamento global. Detalhes
completos no `CLAUDE.md`.

## Coordenação entre filas que leem/escrevem o mesmo estado

O lock por pedido garante que duas filas nunca **corrompem** o mesmo
pedido escrevendo ao mesmo tempo — mas ele não impede, por si só, uma fila
de **chegar primeiro** num pedido que outra está prestes a processar: uma
leitura de "situação atual" pode ser correta no instante em que é feita, e
mesmo assim levar a uma decisão que só faz sentido enquanto a outra fila
ainda não terminou o trabalho dela naquele pedido. Cada caso abaixo
descreve como isso é evitado hoje.

### `reconcileStuckOrders` e `ML_ORDER_SYNC`

`reconcileStuckOrders` considera um pedido preso quando a situação ainda é
`748743` (`WAITING_CHANNEL_VALIDATION`) há mais de 30min. Essa leitura
sozinha não diferencia um pedido genuinamente abandonado de um que só está
esperando a vez de ser processado pelo `ML_ORDER_SYNC` — a única fila que
move um pedido pra fora desse status. Por isso, antes de rodar o sweep,
`reconcileStuckOrders` espera o `ML_ORDER_SYNC` ficar sem nenhum job
pendente (`BaseQueueService.waitUntilIdle`, event-driven via o evento
`"drained"` do BullMQ — não faz polling por intervalo), com teto de 5min;
se estourar, pula o sweep desta execução e tenta de novo no próximo ciclo
agendado. Esse gate é restrito a essa rotina e essa fila especificamente —
as demais rotinas do pipeline não competem pelo mesmo status.

### Retomada de `waiting_acceptance` (`ML_ORDER_SYNC` ↔ `NFE_EMISSION`)

Quando um pedido chega no mesmo dia com coleta hoje/futuro e
`lock_today_orders` está ativo, `scheduleNfe` trava o pedido pra aceite
manual: grava `internal_status: WAITING_FOR_NFE_EMISSION,
waiting_acceptance: true`, sem ainda fazer o PATCH da situação Bling pra
`748748`. A liberação (`POST /orders/release-waiting-acceptance-for-today`)
só seleciona os pedidos afetados e zera a flag — quem de fato completa o
agendamento (PATCH `748748` + job delayed no `NFE_EMISSION`) é
`MLOrderSyncQueue.resumeAfterAcceptance`, chamado uma vez por pedido
liberado (`OrdersController` enfileira um job `{resumeOrderId}` pra cada
um). `resumeAfterAcceptance` confirma o estado esperado pós-liberação
(`WAITING_FOR_NFE_EMISSION` + `waiting_acceptance: false`) antes de agir —
não reusa `isEligibleForSync`, que exige `WAITING_CHANNEL_VALIDATION`, um
status anterior a esse. A lógica de finalizar o agendamento
(`finalizeNfeScheduling`) é compartilhada entre `scheduleNfe` e
`resumeAfterAcceptance`, então o PATCH/write/addDelayed nunca fica
duplicado entre os dois caminhos.

`finalizeNfeScheduling` não confia só no snapshot local — antes do PATCH
pra `748748`, ela busca a situação da Bling ao vivo e só segue se ainda for
`748743` (`WAITING_CHANNEL_VALIDATION`); se tiver divergido por fora (ex:
alguém cancelou o pedido direto na Bling enquanto ele ficava travado
esperando aceite manual), ela só sincroniza `internal_status` com a
situação real e não agenda nada. Isso importa mais pra
`resumeAfterAcceptance` do que pra `scheduleNfe`: entre um pedido ser
travado e alguém liberar manualmente pode passar um tempo bem maior do que
o intervalo normal entre `isEligibleForSync` (que lê o snapshot local de
`source_payload`) e essa checagem.

### `reconcileWaitingNfe` e `ML_ORDER_SYNC.scheduleNfe`

`reconcileWaitingNfe` roda sob `withOrderLock` por pedido, igual as outras
rotinas do arquivo — evita que ela tente recriar um job de emissão
(`addDelayed`) na mesma janela em que `scheduleNfe` está no meio de gravar
`WAITING_FOR_NFE_EMISSION` e agendar esse mesmo job.

### `reconcileOpenOrders` (NFE_RECONCILER)

Reenfileira `document-check` pro `CNPJ_VERIFY_CNAE` quando não encontra o
job esperado pra um pedido em `OPEN`. Não precisa de lock por pedido nem
de esperar outra fila: `CNPJ_VERIFY_CNAE` sempre reverifica a situação
Bling ao vivo como primeiro passo, então um job redundante simplesmente
não encontra mais `situacao === 6` e não faz nada.

### `syncInvoicedOrCollectedOrders` (BLING_RECONCILER)

Pagina pedidos em situação `6` e, pra cada um que já existe localmente,
decide o PATCH (`9` se já tem NF, `748748` se já tem `collection_date`)
com base em dois dados: a situação Bling e o `collection_date` local. Os
dois são relidos frescos — a situação via `blingGet`, o `collection_date`
via uma busca direta no pedido — **dentro** do `withOrderLock` daquele
pedido especificamente, nunca reaproveitados de uma leitura em lote feita
antes do loop de paginação. Isso garante que a decisão reflita o estado
mais recente do pedido, mesmo que ele tenha avançado (ex: sido sinalizado
pra verificação humana) enquanto o loop ainda processava outros pedidos da
mesma página.

## Antes de adicionar uma fila nova que toque `internal_status`

1. Ela precisa usar `withOrderLock` (chave = `id_order_system`) em volta de
   qualquer sequência ler-decidir-escrever sobre um pedido específico.
2. Confira a tabela de estados: sua fila lê algum status que outra fila
   também escreve? Se sim, existe o risco de chegar cedo demais numa
   transição que já vai acontecer (padrão de `reconcileStuckOrders` acima)
   — considere se precisa de um `waitUntilIdle` na fila produtora, ou se
   sua fila já reconfere os dados frescos o suficiente, dentro do lock,
   pra não precisar disso (padrão de `syncInvoicedOrCollectedOrders`).
3. Atualize esta tabela e a lista de filas acima com o que sua fila lê e
   escreve.
