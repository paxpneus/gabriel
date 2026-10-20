# Bling poll (TEMPORÁRIO — substituto dos webhooks)

Código: `src/modules/handlers/bling/services/bling-poll/bling-poll.service.ts` (`BlingPollService`). Existe porque os webhooks da Bling não estão chegando; remover quando voltarem.

## Liga/desliga
- Env `BLING_POLL_ENABLED` (`true` em qualquer caixa liga; lida por `isBlingPollEnabled()` na hora de agendar, não no import — `server.ts` importa `./admin` antes do `dotenv/config`) no `worker-automation`. Default no compose: prod `true`, dev `false`.
- Dois job schedulers no `BLING_RECONCILER`, criados em `startAutomationWorkers` (`attempts: 1`, a próxima rodada já é o retry):
  - `bling-reconciler-poll-new-records`: a cada 1min, task `poll-new-records` → `pollNewRecords()`.
  - `bling-reconciler-poll-recent-changes`: a cada 20min, task `poll-recent-changes` → `pollRecentChanges()`.
- Com a flag `false`, o boot chama `removeJobScheduler` nos dois. Só parar de agendar não basta, porque o repeat continua salvo no Redis.
- Pra remover o código: desligar a flag e fazer deploy uma vez (pros schedulers saírem do Redis). Depois apagar o serviço, as duas tasks no reconciler, o bloco em `queues/index.ts` e a env.

## Prioridade e gate: criação sempre na frente
- **Prioridade:**
  - Jobs de criação (`pollNewRecords`) entram com a prioridade padrão de webhook: nota 2 no `BLING_API_FETCH`, pedido `NORMAL_ORDER_PRIORITY` no `BLING_ORDER_INGESTION`.
  - Jobs de atualização (`pollRecentChanges`) entram com prioridade 10 (`BULK_FORCE_UPDATE_PRIORITY`) e nome `bling-poll-update` (`BLING_POLL_UPDATE_JOB_NAME`). Ficam abaixo de tudo nas duas filas (BullMQ: menor número = maior prioridade).
- **Gate de `pollNewRecords`:** pula a rodada se `BLING_API_FETCH` ou `BLING_ORDER_INGESTION` tiver job pendente **que não seja** `bling-poll-update` (`hasPendingJobsExcept`, em `BaseQueueService`). Com atualização na fila, ele busca coisa nova e enfileira, e a criação fura a fila na frente.
- **Gate de `pollRecentChanges`:** só roda com as duas filas totalmente vazias (`hasPendingJobs`), inclusive sem atualização anterior pendente. Assim atualizações não acumulam.
- **Estados considerados pendentes:** waiting/active/delayed/prioritized.
- **Sem sobreposição:** rodada pulada não acumula nem se sobrepõe, porque as tasks rodam uma por vez no `BLING_RECONCILER` (concurrency 1). O job só lista e enfileira (segundos); o tempo longo é o processamento nas filas.
- 1ª rodada de cada job gera backlog: a de novos manda tudo que falta desde ontem; a de alterações vê todas as notas pela 1ª vez (até 150 refetch + até 50 pedidos).
- Esse gate fica no serviço e é diferente do `automationQueuesAreClear` do reconciler, que essas tasks não usam.

## `pollNewRecords` (1min): só registros faltantes
- **NF-e:** três listagens de `/nfe`, cada uma paginada até o fim (sem limite):
  - `tipo=1`: saída, mas **não traz canceladas**;
  - `tipo=1&situacao=2`: saídas canceladas;
  - `tipo=0`: entrada.
- **Filtro de emissão:** `dataEmissaoInicial` = ontem às `00:00:00` (BRT, com hora). NFC-e fica fora.
- **Nota faltante:** `id_system` ausente em `invoices` (integração Bling) → `BLING_API_FETCH`, jobId `bling-poll-invoice-fetch-<id>`, com o mesmo corte de data do webhook.
- **Pedidos:** `/pedidos/vendas?dataInicial=<ontem>` (só data, aqui funciona). Faltante = `id_order_system` ausente → `BLING_ORDER_INGESTION` com `order.created`, jobId `bling-order-created-<id>` (o mesmo do webhook).
- **Checagem de existência:** uma query por página.
- **Anti-reenvio:** marca Redis `bling-poll:enqueued:<invoice|order>:<id>` (SET NX, TTL 30min). Se o `add` falhar, a marca é apagada.
- **Situação inicial da nota:** a nota enfileirada aqui grava sua situação em `bling-poll:invoice-situacao:<id>` com NX, pro job de 20min não refazer o fetch logo depois.

## `pollRecentChanges` (20min): alterações, até 50 por listagem
- **Pedidos:**
  - Busca `/pedidos/vendas?dataAlteracaoInicial=<cursor − 1min>&limite=50` (só a 1ª página).
  - Todos vão como `order.updated`, jobId `bling-order-updated-<id>` (cria o pedido se não existir).
  - O cursor (`bling-poll:orders-changed-cursor`, início da última rodada que deu certo) só avança com sucesso. Sem cursor, olha os últimos 20min.
- **NF-e:**
  - A listagem de `/nfe` **não tem filtro nem campo de alteração**: a Bling ignora `dataAlteracaoInicial` nesse endpoint.
  - Pega as 50 primeiras (emissão mais recente) de cada uma das três listagens e compara com a situação vista em `bling-poll:invoice-situacao:<id>` (MGET, TTL 7d).
  - Situação diferente ou nunca vista → `BLING_API_FETCH`, jobId `bling-poll-invoice-refetch-<id>-<situacao>`, e grava a situação nova.
  - "Nunca vista" cobre notas canceladas/alteradas enquanto o webhook estava fora.

## Comportamento da API Bling (confirmado ao vivo)
- **Datas com hora:** filtro com hora precisa de espaço como `%20`; com `+` a Bling ignora o filtro. O `fetchBlingListPage` (`bling-sync/helpers/bling-list.ts`) serializa assim.
- **`dataEmissaoInicial` só com data em `/nfe`:** com a data de hoje volta 0, então use sempre com hora.
- **Ordem:** listagens vêm da emissão/número mais recente pra mais antiga.

## Não coberto
- **Pedidos:** mais de 50 alterados numa janela → só os 50 primeiros da listagem (por número, decrescente).
- **NF-e:** mudança que não altera `situacao`, ou em nota fora das 50 mais recentes de cada listagem.
- **Outros recursos:** NFC-e, produto, estoque e contato não entram no poll.
