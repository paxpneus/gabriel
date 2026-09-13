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
        (webhook)         (verifica CNAE)   (confirma coleta   (emite NFe)
                                              via API do ML)
```

`NFE_RECONCILER` e `BLING_RECONCILER` rodam em paralelo, em intervalos
próprios, como rede de segurança — recriam jobs perdidos e corrigem
pedidos que ficaram presos, sem fazer parte do fluxo principal.
`MARKETPLACE_WEBHOOK_SYNC` (reage a webhooks do Mercado Livre) e
`MARKETPLACE_RECONCILER` (duas cadências próprias) também rodam ao lado do
pipeline, alimentando o mesmo par de campos (`collection_date`,
`market_place_label_status`) que `ML_ORDER_SYNC` escreve — ver "Convergência
em `collection_date`/`market_place_label_status`" abaixo.

`collection_date` é resolvido consultando a **API oficial do Mercado
Livre** (`GET /orders/:id` → `GET /shipments/:id`, via
`getMarketplaceCollectionAndLabelStatus`,
`src/modules/handlers/marketplace/services/marketplace-order-shipment.service.ts`)
— não mais por scraping de planilha. Não existe mais um passo assíncrono
separado (a antiga fila `ML-SCRAPING`, removida) entre "pedido chegou" e
"collection_date resolvida": `ML_ORDER_SYNC` resolve isso dentro do mesmo
job que processa o webhook do pedido.

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
| `WAITING_FOR_NFE_EMISSION` | 748748 | `ML_ORDER_SYNC` (via `CollectionDateSchedulerService`) |
| `EMITTED` | 9 | `NFE_EMISSION` |
| `SENT_TO_TRANSPORTER` | 834029 | espelhado da Bling (não gerado pela automação) |
| `DELIVERED` | 834030 | espelhado da Bling (não gerado pela automação) |
| `CANCELLED` | 12, 21, **e 748772** | `CNPJ_VERIFY_CNAE`, `NFE_EMISSION`, `NFE_RECONCILER` |

`EMITTED`/`SENT_TO_TRANSPORTER`/`DELIVERED` são os
`COMPLETED_ORDER_INTERNAL_STATUSES` — toda fila do pipeline checa isso
antes de agir, pra nunca reabrir um pedido já concluído.

Situação `748772` ("aguardando verificação humana") é escrita por 3 lugares
diferentes com motivos diferentes (CNAE bloqueado, falha na emissão de NFe,
pedido preso sem confirmação de coleta/etiqueta), e `mapOrderInternalStatus`
colapsa todos eles no mesmo `CANCELLED` de um cancelamento real do cliente
(situação 12/21) — **essa distinção agora existe na coluna `orders.reason_cancelled`**
(enum, nullable), gravada de forma síncrona pela fila que decide o
cancelamento, no mesmo momento em que escreve `internal_status=CANCELLED`.

**Ponto único de decisão pra escalar — `escalateToHumanVerificationIfStillPending`
(`orders/order/helpers/order-status.ts`, this session)**: os 7 pontos de
código que decidem mandar um pedido pra `748772` (2 em `CNPJ_VERIFY_CNAE`,
4 em `NFE_EMISSION`, 1 em `NFE_RECONCILER`) passaram a chamar essa única
função em vez de decidir/fazer o PATCH cada um por conta própria. Ela
sempre busca a situação **ao vivo** na Bling logo antes de decidir (nunca
confia numa checagem feita antes, ainda que segundos atrás) e:
1. Se a situação ao vivo já é terminal (`EMITTED`/`SENT_TO_TRANSPORTER`/
   `DELIVERED`/`CANCELLED` — "Atendido"/"Enviado pro transporte"/
   "Entregue"/"Cancelado"), **nunca escala** — só sincroniza
   `internal_status` com a realidade. Fecha um caso real: antes, um pedido
   podia avançar sozinho (ex: cliente cancelou, ou já foi entregue) no
   intervalo entre a checagem de quem ia chamar `markOrderCancelled`/
   `markOrderError` e o PATCH de fato, e ainda assim acabava marcado pra
   verificação humana por cima de um estado já resolvido.
2. Se não é terminal, só escala se a situação ao vivo bater com o
   `allowedPendingStatuses` que quem chamou declarou como precondição
   legítima pra aquele call site específico (`CNPJ_VERIFY_CNAE`: `[OPEN]`;
   `NFE_EMISSION`'s `NFE_WRONG_STATUS`: `[OPEN, WAITING_CHANNEL_VALIDATION]`;
   `NFE_EMISSION`'s outros 3 call sites e `NFE_RECONCILER`:
   `[WAITING_FOR_NFE_EMISSION]`/`[WAITING_CHANNEL_VALIDATION]` respectivamente).
   Caso contrário, também não escala — só sincroniza.
3. Fecha de graça o único call site que antes não tinha checagem ao vivo
   nenhuma: `NFE_EMISSION`'s `onFailed` (`NFE_EMISSION_FAILED`, disparado
   depois de esgotar os retries do BullMQ) fazia o PATCH `748772` às cegas;
   agora passa pela mesma checagem que todo o resto.

Cada call site ainda faz sua própria escrita de observação
(`observacoesInternas`) e pacing (sleeps de 1s/3s) via um hook
`beforeEscalate`, que só roda **depois** de confirmado que vai escalar
mesmo — não antes, como no design anterior de alguns call sites.

| `reason_cancelled` | Quem grava | Motivo |
|---|---|---|
| `DOCUMENT_INVALID` | `CNPJ_VERIFY_CNAE` (`markOrderError`, errorId 1) | Documento do cliente ausente/inválido |
| `CNAE_BLOCKED` | `CNPJ_VERIFY_CNAE` (`markOrderError`, errorId 2) | CNAE do cliente bloqueado |
| `NFE_WRONG_STATUS` | `NFE_EMISSION` (`markOrderCancelled`) | Situação divergiu de NFE_AGENDADA (748748) ao tentar emitir |
| `NFE_MISSING_FIELDS` | `NFE_EMISSION` (`markOrderCancelled`) | Campos obrigatórios ausentes pra emissão |
| `NFE_NO_STOCK` | `NFE_EMISSION` (`markOrderCancelled`) | Bling recusou emissão por falta de estoque (field code 74) |
| `NFE_EMISSION_FAILED` | `NFE_EMISSION` (`onFailed`, após esgotar retries) | Falha genérica ao gerar NFe na Bling |
| `ML_SCRAPING_NO_MATCH` | *(histórico — não gravado mais)* | Pedido preso >30min sem match na antiga planilha do Mercado Livre; sucedido por `MARKETPLACE_SYNC_STUCK` |
| `MARKETPLACE_SYNC_STUCK` | `NFE_RECONCILER` (`reconcileStuckOrders`) | Pedido preso >30min sem conseguir confirmar dados de coleta/etiqueta junto à API do marketplace |
| `CUSTOMER_CANCELLED` | `BLING_ORDER_INGESTION` (webhook, situação 12/21) | Cancelamento real, feito pelo cliente ou direto na Bling |

O webhook (`BLING_ORDER_INGESTION`) só grava `reason_cancelled` para
situação `12`/`21` — para qualquer outra situação (inclusive `748772`
chegando como confirmação tardia de um cancelamento que uma fila já
decidiu e já gravou) a chave é **omitida**, nunca zerada, pra não
sobrescrever um motivo mais específico já gravado antes. O branch de
`reconcileStuckOrders` que só resincroniza uma mudança de situação feita
por fora da automação (não é ele quem decidiu cancelar) também não grava
motivo nenhum.

## As 8 filas

- **`BLING_ORDER_INGESTION`** (`bling-order.queue.ts`) — recebe webhooks de
  pedido (`order.created`/`order.updated`), cria/atualiza a linha local
  espelhando a situação Bling atual (busca ao vivo, não confia no payload
  do webhook), e só segue a cadeia (enfileira pro `CNPJ_VERIFY_CNAE`) se a
  situação buscada for `6` (OPEN). Pedidos de outras lojas (não Mercado
  Livre) são só salvos, sem entrar na automação. Também grava/reconcilia
  `collection_date` direto a partir do campo `dataPrevista` do pedido Bling
  (`BlingOrderService`, create e update, via
  `CollectionDateSchedulerService.syncCollectionDateLocked`) quando
  presente — **sem consultar o marketplace**; se `dataPrevista` vier vazia,
  simplesmente não chama o scheduler, preservando qualquer valor já
  gravado antes. Inicializa `market_place_label_status` (só na criação, pra
  não sobrescrever um valor que outra fila já tenha gravado depois) como
  `WAITING_FOR_SYSTEM_NFE` se o canal do pedido estiver em
  `Integration.allowed_channels`, senão `UNKNOWN`.
- **`CNPJ_VERIFY_CNAE`** (`cnpj.queue.ts`) — rebusca o pedido ao vivo,
  confirma que ainda está em situação `6`, valida documento/CNAE do
  cliente. Sucesso: PATCH situação `748743` + `internal_status:
  WAITING_CHANNEL_VALIDATION`, enfileira pro `ML_ORDER_SYNC`. Falha
  (documento inválido ou CNAE bloqueado): PATCH `748772` +
  `internal_status: CANCELLED`.
- **`ML_ORDER_SYNC`** (`mercado-livre-sync.queue.ts`) — reage ao webhook de
  pedido (`{orderSystem, customer}`). Confirma sempre, ao vivo, que o
  pedido ainda está em `WAITING_CHANNEL_VALIDATION`/`748743` antes de agir
  (`isEligibleForSync`, `collection-date-scheduler.service.ts`). Consulta a
  API do marketplace **sempre**, tenha o pedido já uma `collection_date` ou
  não (`getMarketplaceCollectionAndLabelStatusWithRetry` — até 3 tentativas
  antes de desistir): sucesso grava `market_place_label_status`
  incondicionalmente e usa a `collection_date` retornada; falha após
  esgotar o retry cai para a `collection_date` já gravada localmente (por
  `dataPrevista`), se houver — sem nenhuma, o job falha e é retentado pelo
  BullMQ. Ao ter uma `collection_date` (de qualquer origem), delega pra
  `CollectionDateSchedulerService.syncCollectionDateLocked`, que decide
  gravar/reagendar e eventualmente faz PATCH `748748` +
  `internal_status: WAITING_FOR_NFE_EMISSION` + agenda o job delayed no
  `NFE_EMISSION`. Também expõe `resumeAfterAcceptance`, usada pra retomar o
  agendamento de um pedido que ficou travado esperando aceite manual (ver
  "Coordenação entre filas" abaixo) — delega a finalização pro mesmo
  `CollectionDateSchedulerService`.
- **`MARKETPLACE_WEBHOOK_SYNC`** (`marketplace-webhook-sync.queue.ts`) —
  reage a webhooks de `orders`/`shipments` do marketplace (rota
  `POST /api/mercado_livre/webhook`). Nunca confia em dado nenhum do corpo
  do webhook, só usa `resource`/`topic` pra saber qual recurso re-buscar ao
  vivo e em qual direção: uma notificação de `orders` é sempre 1 pedido; uma
  de `shipments` pode cobrir mais de um pedido local (agrupamento por
  `pack_id`), resolvido via `getMarketplaceOrdersFromShipment` — todo id
  devolvido é sincronizado. Pra cada pedido: grava
  `market_place_label_status` sempre (mesmo partindo de `UNKNOWN` — a
  chegada do webhook já prova que é um pedido de marketplace) e, se veio
  `collectionDate`, aciona `CollectionDateSchedulerService.syncCollectionDateLocked`
  — as duas escritas dentro do mesmo `withOrderLock`. Ignora pedidos já em
  `COMPLETED_ORDER_INTERNAL_STATUSES`.
- **`MARKETPLACE_RECONCILER`** (`marketplace-reconciler.queue.ts`) — duas
  cadências independentes num componente só (mesmo padrão de
  `BLING_RECONCILER`, dispatch por `job.data.task`): `collection_date` (1h)
  confirma/reagenda `collection_date` via `CollectionDateSchedulerService`
  pra todo pedido ainda pendente (`OPEN`/`WAITING_CHANNEL_VALIDATION`, de
  uma store em `allowed_channels` —
  `OrderRepository.findPendingMarketplaceOrders`); `label_status` (5min) só
  atualiza `market_place_label_status` (sem efeito colateral de
  agendamento, por isso roda bem mais frequente). Rede de segurança pra
  quando o webhook falha silenciosamente ou nunca chega.
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
    (verificação humana) com `reason_cancelled: MARKETPLACE_SYNC_STUCK`.
- **`BLING_RECONCILER`** (`bling-reconciler.queue.ts`) — 2 rotinas:
  - `reconcileOpenOrders` (a cada 2h): cria localmente pedidos que já
    existem na Bling em situação `6` mas ainda não foram sincronizados.
  - `syncInvoicedOrCollectedOrders` (a cada 30min): pedidos em situação `6`
    que já existem localmente e já deveriam ter avançado — se já tem NF
    vinculada, PATCH `9`; se não tem NF mas já tem `collection_date` local,
    PATCH `748748`.

## `CollectionDateSchedulerService` (ponto único de escrita de `collection_date`)

`src/modules/handlers/bling/services/bling-nfe/collection-date/collection-date-scheduler.service.ts`.
Todo caminho que grava/reconcilia `collection_date` (`BLING_ORDER_INGESTION`,
`ML_ORDER_SYNC`, `MARKETPLACE_WEBHOOK_SYNC`, `MARKETPLACE_RECONCILER`) passa
por aqui — `syncCollectionDateLocked(idOrderSystem, newDate, orderSystem)`,
assumindo que quem chama já está dentro do `withOrderLock` do pedido (a
variante pública `syncCollectionDate` pega o lock sozinha, pra quem ainda
não está dentro dele).

- **Compara por dia civil (BRT), não por instante exato** — duas chamadas
  pro mesmo dia com horários de resposta diferentes (API do marketplace vs.
  `dataPrevista` da Bling) não contam como uma mudança real. A normalização
  pra início do dia BRT (`startOfDayTz`) é sempre feita aqui, nunca no call
  site.
- Só 3 dos `OrderInternalStatus` são "agendáveis": `OPEN`,
  `WAITING_CHANNEL_VALIDATION`, `WAITING_FOR_NFE_EMISSION` — qualquer outro
  (já emitido, cancelado, etc.) é no-op total.
- Se já está em `WAITING_FOR_NFE_EMISSION` (job já agendado): dia igual é
  no-op total (sem `removeJob`/`addDelayed`); dia diferente remove o job
  atual e reagenda (`finalizeNfeScheduling`).
- Se está em `OPEN`/`WAITING_CHANNEL_VALIDATION` (nenhum job ainda):
  **sempre** chama `scheduleNfe`, mesmo que o dia não tenha mudado — o
  agendamento em si pode ainda não ter acontecido (ex: `BLING_ORDER_INGESTION`
  gravou via `dataPrevista` e `ML_ORDER_SYNC` só confirmou o mesmo dia
  depois). `scheduleNfe`/`finalizeNfeScheduling` são seguros de chamar de
  novo, e `isEligibleForSync` dentro de `scheduleNfe` garante que nada
  acontece de fato enquanto o pedido não estiver em
  `WAITING_CHANNEL_VALIDATION` — é por isso que chamar isso a partir de
  `BLING_ORDER_INGESTION` (pedido ainda `OPEN`, `CNPJ_VERIFY_CNAE` não
  rodou) é seguro: o único efeito ali é permitir a gravação de
  `collection_date`, nunca agendar/emitir uma NFe antes da hora.
- `finalizeNfeScheduling` não confia só no snapshot local — antes do PATCH
  pra `748748`, busca a situação da Bling ao vivo e só segue se ainda for
  `748743`; se divergiu por fora, só sincroniza `internal_status` e não
  agenda nada.

## Lock por pedido (`withOrderLock`)

`BaseQueueService.withOrderLock` (`base-queue-service.ts`) — método de
instância de toda fila, que delega pra uma função standalone
(`withOrderLock`, exportada do mesmo arquivo) reaproveitada também por
`CollectionDateSchedulerService`, que não é uma fila. Mutex Redis
(`SET key NX PX`) com chave **dinâmica** — `locks:bling:order:${idOrderSystem}`
— em vez de uma chave fixa compartilhada entre filas. Isso significa:

- Pedidos diferentes correm em paralelo total, mesmo entre filas
  diferentes, mesmo dentro da mesma fila (todas rodam com `concurrency` >
  1).
- Só serializa quando duas coisas tentam tocar o **mesmo** pedido ao mesmo
  tempo — quem pede o lock primeiro pega; o outro espera (retry curto, até
  2min de teto) e, se estourar, o job falha e tenta de novo depois pelo
  mecanismo normal de retry do BullMQ.
- **Não é reentrante** — cada fluxo pega o lock uma única vez, no ponto de
  entrada, e todo o resto da cadeia daquele fluxo (incluindo chamadas
  internas tipo `CollectionDateSchedulerService.scheduleNfe`/
  `finalizeNfeScheduling`) assume que já está dentro do lock, sem pegar de
  novo.
- A chave usada é o **id do pedido na Bling** (`id_order_system` uma vez
  persistido; o `data.id` cru do webhook antes disso) — o único
  identificador presente em toda etapa do pipeline, garantindo que todas as
  filas disputem corretamente pelo mesmo pedido físico.

## Rate limit da Bling

`waitForBlingRateLimit()` (`bling_api.service.ts`) — gate atômico via
Redis, independente de qual fila faz a chamada. Não tem relação nenhuma com
o lock por pedido acima — mesmo com todos os pedidos rodando em paralelo,
toda chamada HTTP pra Bling ainda respeita o mesmo espaçamento global.

**Redesenhado nesta sessão** — o design anterior *reservava* um horário
futuro de antemão (via um script Lua que distribuía `now`, `now+interval`,
`now+2*interval`...) e só dormia (`setTimeout`) até lá antes de disparar,
sem checar de novo. Cada reserva individual era correta (o `EVAL` é
atômico), mas nada revalidava nada no momento real do disparo — sob event
loop mais ocupado (mais filas rodando concorrentemente no mesmo processo),
vários timers reservados podiam ficar atrasados ao mesmo tempo e, quando o
loop finalmente liberava, disparavam em rajada sem gap nenhum entre eles.
Confirmado em produção pelo usuário: pausar todas as filas Bling exceto uma
de cada vez eliminava o 429 por completo; rodar várias juntas reintroduzia
rajadas — mesmo com o rate limiter "correto" no papel. O novo design é um
loop de **checa-e-reivindica**: cada chamada pergunta atomicamente ao Redis
"já se passou `BLING_RATE_LIMIT_INTERVAL_MS` desde o último disparo REAL
concedido?"; se sim, reivindica e dispara; se não, dorme o tempo indicado e
**pergunta de novo** (não dispara só porque o timer venceu). Sob contenção
real (várias chamadas acordando juntas), só uma vence cada checagem; as
demais recebem um novo tempo de espera e voltam pro topo do loop — imune a
jitter de timer por construção, porque nunca confia num plano calculado
antes, só no que o Redis confirma bem na hora. Detalhes completos, incluindo
o contador diagnóstico de gap real entre disparos, no `CLAUDE.md`. **A API
do Mercado Livre não tem um limiter equivalente ainda** — os limites reais
são desconhecidos até validação em produção (ver `CLAUDE.md`).

## Watchdog de job (`maxProcessingMs`)

`CNPJ_VERIFY_CNAE`/`NFE_EMISSION`/`ML_ORDER_SYNC` tinham `maxProcessingMs:
60_000` — menor que o pior caso do retry de 429 da Bling (5 tentativas, até
60s cada, até 300s no total). Como o watchdog usa `Promise.race` (não
cancela a chamada perdedora), ele abortava o job BullMQ no meio de um retry
ainda válido, deixando-o órfão segurando o lock do pedido enquanto uma nova
tentativa (recriada pelo retry normal do BullMQ) esbarrava em "Timeout
aguardando lock do pedido". **Fixed nesta sessão**: as 3 filas subiram pra
`5 * 60 * 1000` (300s), cobrindo o pior caso do retry por completo.

## Gate: reconcilers só rodam com o pipeline vazio

`NFE_RECONCILER`/`BLING_RECONCILER` agora checam, no topo do `process()`,
se `BLING_ORDER_INGESTION`/`CNPJ_VERIFY_CNAE`/`ML_ORDER_SYNC` têm **zero**
jobs pendentes (`BaseQueueService.hasPendingJobs()`) antes de rodar
qualquer uma de suas rotinas — se alguma das 3 ainda tem job
waiting/active/delayed/prioritized, a execução inteira é pulada nesse ciclo
(o próprio `scheduleRepeat` tenta de novo no próximo). Motivo: os
reconcilers competem pelo mesmo rate limit compartilhado da Bling bem no
pior momento (backlog grande), piorando exatamente o travamento que
existem pra destravar. `NFE_EMISSION` fica de fora do gate de propósito —
ela sempre tem job agendado (delay até a hora da coleta), então "vazia"
nunca seria um estado real pra ela.

## Coordenação entre filas que leem/escrevem o mesmo estado

O lock por pedido garante que duas filas nunca **corrompem** o mesmo
pedido escrevendo ao mesmo tempo — mas ele não impede, por si só, uma fila
de **chegar primeiro** num pedido que outra está prestes a processar: uma
leitura de "situação atual" pode ser correta no instante em que é feita, e
mesmo assim levar a uma decisão que só faz sentido enquanto a outra fila
ainda não terminou o trabalho dela naquele pedido. Cada caso abaixo
descreve como isso é evitado hoje.

### Convergência em `collection_date`/`market_place_label_status`

Quatro produtores independentes podem tocar o mesmo pedido: `ML_ORDER_SYNC`,
`MARKETPLACE_WEBHOOK_SYNC`, e as duas cadências do `MARKETPLACE_RECONCILER`.
(`BLING_ORDER_INGESTION` fica de fora dessa convergência — ela só grava
`collection_date` a partir de `dataPrevista`, sem nunca consultar o
marketplace; quem reconcilia um valor ainda não confirmado é sempre
`ML_ORDER_SYNC`, na sequência normal do pipeline.) A coordenação entre os
quatro é inteiramente feita por `withOrderLock` (serializa dois produtores
tocando o mesmo pedido) + o guard de no-op-por-dia de
`CollectionDateSchedulerService` (uma escrita redundante de um segundo
produtor chegando logo depois, pro mesmo dia civil, é um no-op barato, não
um duplo agendamento) — não existe nenhum guard de precedência por "origem"
além disso, porque não é necessário: `ML_ORDER_SYNC` é o único ponto que
efetivamente confirma `collection_date` contra o marketplace na chegada do
pedido, então qualquer divergência com um valor ainda não confirmado
(`dataPrevista`) é resolvida na primeira vez que `ML_ORDER_SYNC` rodar —
uma sequência determinística no pipeline, não uma corrida entre fontes.
`market_place_label_status` não tem guard equivalente (nenhuma comparação,
sempre sobrescreve) — aceitável porque essa escrita não tem efeito
colateral de agendamento; dois produtores correndo no mesmo pedido só
significam que o campo reflete brevemente qual busca chegou por último,
ambas vindas da mesma API dentro de instantes uma da outra.

### `reconcileStuckOrders` (NFE_RECONCILER)

Considera um pedido preso quando a situação ainda é `748743`
(`WAITING_CHANNEL_VALIDATION`) há mais de 30min, e marca `748772`
(`reason_cancelled: MARKETPLACE_SYNC_STUCK`). Não precisa mais esperar
nenhuma outra fila ficar livre antes de rodar (diferente do antigo design
baseado em scraping): `ML_ORDER_SYNC` resolve `collection_date` via uma
chamada de API síncrona (do ponto de vista da fila) dentro do mesmo job que
marca `WAITING_CHANNEL_VALIDATION`, então não existe mais um backlog de
segunda fila que possa fazer um pedido em trânsito parecer abandonado. O
modo de falha que essa rotina cobre hoje é diferente: a chamada à API do
marketplace (de `ML_ORDER_SYNC`, do webhook ou do reconciler) pode falhar
repetidamente (API do ML fora do ar, refresh de token quebrado, rate
limit) e deixar um pedido preso indefinidamente.

### Retomada de `waiting_acceptance` (`ML_ORDER_SYNC` ↔ `NFE_EMISSION`)

Quando um pedido chega no mesmo dia com coleta hoje/futuro e
`lock_today_orders` está ativo, `CollectionDateSchedulerService.scheduleNfe`
trava o pedido pra aceite manual: grava `internal_status:
WAITING_FOR_NFE_EMISSION, waiting_acceptance: true`, sem ainda fazer o PATCH
da situação Bling pra `748748`. A liberação
(`POST /orders/release-waiting-acceptance-for-today`) só seleciona os
pedidos afetados e zera a flag — quem de fato completa o agendamento (PATCH
`748748` + job delayed no `NFE_EMISSION`) é
`MLOrderSyncQueue.resumeAfterAcceptance`, chamado uma vez por pedido
liberado (`OrdersController` enfileira um job `{resumeOrderId}` pra cada
um), que delega a finalização pro mesmo
`CollectionDateSchedulerService.finalizeNfeScheduling`.
`resumeAfterAcceptance` confirma o estado esperado pós-liberação
(`WAITING_FOR_NFE_EMISSION` + `waiting_acceptance: false`) antes de agir —
não reusa `isEligibleForSync`, que exige `WAITING_CHANNEL_VALIDATION`, um
status anterior a esse.

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

### `reconcileWaitingNfe` e `CollectionDateSchedulerService.scheduleNfe`

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
   transição que já vai acontecer — considere se sua fila já reconfere os
   dados frescos o suficiente, dentro do lock, pra não precisar de nenhuma
   espera adicional (padrão de `syncInvoicedOrCollectedOrders`).
3. Se sua fila grava `collection_date`, faça isso através de
   `CollectionDateSchedulerService` — nunca grave/reagende esse campo
   direto, pra não duplicar o guard de no-op-por-dia nem o agendamento de
   NFe.
4. Atualize esta tabela e a lista de filas acima com o que sua fila lê e
   escreve.
