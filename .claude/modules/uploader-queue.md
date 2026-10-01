# Uploader queue (upload/delete assíncrono, rate limit, cache)

## Por que existe

Antes desta mudança, todo ponto do código que precisava subir um arquivo pro storage externo (Nextcloud via WebDAV, `UploaderService`) chamava `uploaderService.upload(...)` direto, de forma síncrona, sem nenhuma proteção de rate limit e sem nenhum throttling compartilhado entre os vários consumidores. Dois desses pontos (PDV — anexar comprovante; unmapped-invoice-product — criar a partir de leitura de EAN) faziam o usuário esperar o round-trip completo até o Nextcloud antes do request HTTP responder.

A solução: uma fila BullMQ única (`UploaderQueue`, `src/modules/handlers/uploader/uploader.queue.ts`) por onde **todo** upload e delete passa a transitar, com dois modos de uso, mais um staging genérico em Postgres (`temp_files`) que evita colocar buffers no payload do job Redis.

## `temp_files` — staging genérico (`src/modules/handlers/temp-file/`)

Toda operação de upload primeiro vira uma linha em `temp_files` (BYTEA), via `BaseRepository`/`BaseService` genéricos — sem método customizado. O job BullMQ carrega só o `id` dessa linha, nunca o buffer (Redis é dimensionado pra filas/lock, não pra blobs; Postgres cobre isso nativamente via TOAST).

`entity_type`/`entity_id` são NULLABLE — só preenchidos quando há finalização automática. Quatro hoje (`src/shared/constants/temp-file-entity-type.ts`): `PDV_SALES_REQUEST_RECEIPT` (`pdv_sales_request_receipts.path`), `UNMAPPED_INVOICE_PRODUCT` (`unmapped_invoice_products.image_path`), `INVOICE_DANFE` (`invoices.danfe_path`), `CTE` (`JobTracker`/Redis, não uma tabela — ver abaixo). Path sentinela (`temp://<tempFileId>`, helpers em `temp-file.constants.ts`) sempre se aplica às 2 primeiras; `INVOICE_DANFE` também passou a usar o sentinela, mas só num caso específico (ver abaixo) — `CTE` continua diferente.

## Os três modos de uso da fila

**Staging com finalização automática** (os 4 entity_type acima — todos os casos onde algo já existe/responde antes do arquivo estar pronto): o "destino" cria/atualiza seu próprio registro (sem esperar o upload) e o `temp_files` correspondente, e chama `uploaderQueue.enqueueUpload(tempFileId, entityType)` **depois** de persistido. O job (`processUpload`) sobe o arquivo, aquece o cache (ver abaixo), grava o path real de volta via `FINALIZERS` (`uploader-finalizers.ts`) e apaga a linha `temp_files`. Se o destino sumiu nesse meio tempo, desfaz o upload (`uploaderService.delete`) em vez de deixar arquivo órfão.

`PDV_SALES_REQUEST_RECEIPT`/`UNMAPPED_INVOICE_PRODUCT` usam o path sentinela porque a coluna é `NOT NULL`/sempre populada, e uma transação Postgres cria a linha de destino + o `temp_files` juntos. `INVOICE_DANFE` é diferente na maioria dos casos: `invoices.danfe_path` já aceita `NULL`, então a invoice normalmente é criada/atualizada com `danfe_path: null` (sem sentinela) enquanto o upload não termina. **Exceção**: `pdv-sales-request.service.ts::attachTransferInvoice`, ao vincular uma nota de transferência provisória (ver `.claude/entities/pdv-sales-request/index.md`), grava o sentinela `temp://<tempFileId>` DIRETO em `danfe_path` na criação (pro DANFE que o próprio usuário enviou já ficar "vinculado" e servível na hora, sem esperar o upload real terminar) — por isso `FINALIZE_CHECKERS.INVOICE_DANFE` trata "ainda não subiu" como `danfe_path` falsy **OU** prefixo `temp://` (checa `isTempFileSentinelPath` antes de cair pra truthiness simples); sem essa checagem, o sweep de reconciliação apagaria o `temp_files` dessa nota provisória achando que "já tem valor = já subiu". `CTE` (só `cte-download.queue.ts`/`CteXmlBatchQueue`, export em lote de XMLs) é o único cujo destino não é uma entidade Sequelize: é o `JobTracker` (Redis, `cte-download.tracker.ts`, já usado direto pelo controller pra status/polling) — `FINALIZERS.CTE`/`FINALIZE_CHECKERS.CTE` chamam `JobTracker.get`/`update` no lugar do `<entity>Service`, e o finalizer também dispara o `socket.emitToUser("job:completed", ...)` que antes rodava logo após o `uploadAndWait` (por isso `JobState` ganhou `userId`). Em todos os 3, `FINALIZERS` respeita o layering das entidades Sequelize que têm um (nunca repository/model direto) — `CTE` é a única exceção porque seu "destino" nunca foi uma entidade Sequelize pra começar.

**Espera síncrona** (nenhum consumidor hoje — `auto-backup.service.ts` usava, migrou pra streaming direto, ver "Consumidores migrados"): `uploaderQueue.uploadAndWait(input, category)` cria o staging sem `entity_type` (sem finalização automática), enfileira e usa `job.waitUntilFinished(this.queueEvents, timeoutMs)` (mecanismo nativo do BullMQ — funciona entre processos diferentes porque é pub/sub via Redis pela chave da fila, não por identidade de instância) pra devolver o path real de forma síncrona do ponto de vista de quem chama. Mantido como capacidade genérica da fila pra um futuro fluxo sem entidade própria que precise do path de volta na hora — mas só serve pra arquivos pequenos: `input.buffer` vira uma linha BYTEA em `temp_files` (Postgres), então qualquer arquivo grande nesse caminho materializa o arquivo inteiro em memória (Node) e em disco (Postgres) — exatamente o problema que tirou o backup desse caminho.

**Fire-and-forget sem entidade** (`uploaderQueue.uploadFireAndForget(input, category)`): igual ao staging do `uploadAndWait` (`entity_type`/`entity_id` null), sem `job.waitUntilFinished`. Nenhum consumidor hoje — o XML do CT-e saiu daqui porque este modo não tem ponteiro durável (ver "Arquivamento do XML do CT-e").

Delete segue o mesmo padrão de "sempre enfileirado": `uploaderQueue.enqueueDelete(target, category, cacheKey?)`, fire-and-forget. `target` é `{type: "temp-file", tempFileId}` (upload ainda não subiu — apaga só a linha de staging) ou `{type: "real-path", path}` (já subiu — apaga da nuvem via `uploaderService.delete`). Quem chama decide o `target` lendo o path ATUAL da entidade no momento do delete (`resolveDeleteTarget`, em `temp-file.constants.ts`).

`BaseQueueService<T, R>` ganhou um segundo parâmetro genérico (`R`, default `void`) especificamente pra viabilizar `uploadAndWait` — sem isso `process()` não conseguiria devolver o path real pra `job.waitUntilFinished` ler. Mudança aditiva/retrocompatível: toda fila existente continua com `R = void` implícito, sem precisar mudar nada.

## Prioridade (`uploader-priority.ts`)

BullMQ nativo (`priority` no `add()`, número menor = mais prioritário), pra um lote de fotos de EAN não atrasar um comprovante de PDV que o financeiro está esperando aprovar. `UploaderPriorityCategory` é um superset dos 4 valores de `TempFileEntityType` — por isso o staging automático (PDV/unmapped/DANFE/CTE) resolve a prioridade sozinho a partir do próprio `entityType` (o chamador nunca escolhe um número), enquanto o consumidor sem entidade (`cte-upsert.service.ts`) passa a categoria explícita (`"CTE"`) em `uploadFireAndForget`/`enqueueDelete`. `auto-backup.service.ts` não usa mais essa fila (ver "Consumidores migrados"), então não tem categoria/prioridade.

Ordem: `PDV_SALES_REQUEST_RECEIPT` (1) > `UNMAPPED_INVOICE_PRODUCT` (2) > `INVOICE_DANFE` (3) > `CTE` (4).

## Cache de imagem (`uploader-image-cache.ts`)

Centralizado dentro do próprio `UploaderService` — `upload`/`getFile`/`delete` aceitam um `cacheKey?: string` opcional; quem passa ganha cache automático, quem não passa não muda de comportamento. Chave por ENTIDADE (`entityType:entityId`, `buildEntityCacheKey`), não por path — é isso que faz a troca de `temp://...` pro path real não precisar de nenhuma invalidação: o cache só é lido/escrito no ramo de path real (enquanto sentinela, o GET lê direto do Postgres), e o `upload()` já aquece o cache com o buffer correto no exato momento em que o path vira real (`processUpload`, usando o buffer já em memória — sem round-trip extra no WebDAV).

TTL deslizante: `getCachedImage` reemite `EXPIRE` a cada hit (1 dia a partir da última leitura, não da escrita) — uma imagem em uso contínuo nunca expira; só expira depois de 24h seguidas sem nenhuma leitura. `delete(path, cacheKey)` invalida incondicionalmente.

Escopo: só PDV/unmapped usam `cacheKey` hoje (são os únicos com endpoint de GET que serve a mesma imagem repetidamente). DANFE já é servido via `getDanfeBuffer`, mas não passa `cacheKey` (fora de escopo desta mudança); CT-e/backup também não. A infra já suporta se algum precisar no futuro, é só passar a flag.

## Rate limit

Dois mecanismos independentes, pra propósitos diferentes:
- **Escrita (upload/delete)**: throttling proativo — `UploaderQueue` limita a 3 jobs/5s (`limiter` do BullMQ), compartilhado por todos os consumidores.
- **Qualquer request (GET incluso)**: backoff exponencial reativo em `uploader_api.ts` (`onResponseError`, 429) — mesmo mecanismo de `bling_api.service.ts` (contador de tentativa no `error.config`, delay exponencial capado, respeita `Retry-After`, reenvia a mesma request). Não replica o pacing proativo do Bling (`waitForBlingRateLimit`) — aquele intervalo foi calibrado pra cota conhecida da conta Bling, e aqui o throttling proativo já é o limiter da fila.

GET não passa pela fila nem tem limiter algum (pedido explícito: leitura é liberada, ~4 simultâneos sem restrição — quem reduz a pressão de releitura é o cache, não uma fila).

Antes desta mudança, `invoice-xml.ts` (upload de DANFE gerado da Tecinco) tinha seu próprio pacer em memória (`waitForDanfeUploadSlot`, 1 upload/5s, só dentro do mesmo processo) — removido nesta mudança porque ficou redundante: o throttling da `UploaderQueue` já cobre isso de forma real (compartilhada entre processos, via Redis) e melhor (coordenada com os outros consumidores, não só DANFE).

## Sweep de reconciliação (`UploaderQueue.processReconcile`)

Repeatable job do BullMQ, registrado uma única vez em `startWorkers()` com `jobId: "uploader-reconcile-cron"` fixo (evita duplicar o agendamento a cada restart — BullMQ substitui pelo id, nunca soma), cron `0 22 * * *` com `tz: "America/Sao_Paulo"` explícito (sem isso o cron roda em UTC; Brasil não observa horário de verão desde 2019, então "22h" sem `tz` rodaria às 19h BRT). Registrado via `uploaderQueue.queue.add(...)` direto (não `scheduleRepeat()`, cujo `data` é tipado fixo como `{task?: string}` na base compartilhada por toda fila do projeto — bypassar só aqui evita alargar essa base pra uma necessidade de uma fila só).

Varre `temp_files` mais velhos que `UPLOADER_RECONCILE_AGE_MS` (default 15min — alinhado ao pior caso do backoff nativo do BullMQ pra 5 tentativas: 30s+60s+120s+240s+480s ≈ 15min; registros mais novos ainda podem estar legitimamente em andamento/retry). 4 casos:

- **A** (`entity_type` setado, `FINALIZE_CHECKERS` retorna `already-real`): upload terminou mas a linha não foi limpa (ex.: processo caiu entre o finalize e o delete) — apaga a linha, log `info`.
- **B** (`entity_type` setado, `still-sentinel`): upload nunca rodou (ou falhou) — reenfileira com `enqueueUpload` (mesma prioridade de sempre) e incrementa `reconcile_attempts` (`temp_files.reconcile_attempts`, migration `m291`); passado `UPLOADER_RECONCILE_MAX_ATTEMPTS` (default 5), para de tentar e só loga erro. Pra `INVOICE_DANFE`, "still-sentinel" é `danfe_path` falsy OU prefixo `temp://` (ver acima).
- **C** (`entity_type` setado, `missing`): entidade de destino não existe mais — apaga a linha, log `warn`.
- **D** (sem `entity_type` — `uploadAndWait`/`uploadFireAndForget`, hoje sem consumidor): checa o estado do job na fila (`queue.getJob(tempFile.id).getState()`); se ainda `waiting`/`active`/`delayed`/`prioritized`, não mexe; senão (job `failed` ou nem encontrado mais), **não reenfileira** — só apaga e loga erro pra investigação manual. Diferença chave pro caso B: nos fluxos com `entity_type`, o destino guarda um ponteiro durável que sobrevive a um crash do processo, então reenfileirar é seguro (o resultado tem pra onde ir); nos fluxos sem entidade, ninguém guarda esse ponteiro — reenfileirar cegamente só geraria um arquivo órfão na nuvem que nada mais referencia.

## Consumidores migrados

- `PdvSalesRequestService.attachReceipt`/`deleteReceipt`/`deleteRequest`/`getReceiptBuffer` — staging com finalização (`PDV_SALES_REQUEST_RECEIPT`).
- `UnmappedInvoiceProductService.createUnmappedFromReadingEan`/`delete`/`markMapped`/novo `getImageBuffer` — staging com finalização (`UNMAPPED_INVOICE_PRODUCT`). `getImage` do controller migrou pro service (antes chamava `uploaderService` direto no controller, violando "controller só request/response").
- `bling-api-fetch.queue.ts` e `invoice-xml.ts` (upsert da invoice, DANFE Bling e Tecinco) — staging com finalização (`INVOICE_DANFE`): baixam/geram o buffer do DANFE, mas upsertam a invoice imediatamente com `danfe_path: null` e só criam o `temp_files`/`enqueueUpload` **depois** de ter o `invoice.id` (create ou update já resolvido) — a nota nunca espera o upload.
- `cte-upsert.service.ts` (dentro de `CteIngestionQueue.process`) — só `enqueueCteArchive(cte.id)`; o upload em si é o job `cte-archive` (ver seção abaixo).
- `cte-download.queue.ts` (`CteXmlBatchQueue.process`) — staging com finalização (`CTE`, `entity_id` = `jobId`): o job desta fila conclui sem esperar o upload real; `FINALIZERS.CTE` grava o `filePath` no `JobTracker` e reemite o `socket` `job:completed` quando o upload termina de verdade.
- `auto-backup.service.ts` (`run`) — **não** passa pela `UploaderQueue`. Chama `uploaderService.uploadStream(...)` direto, streamando o `pg_dump` (`streamDatabaseDump`, `shared/utils/database/database-dump.ts`) pro WebDAV sem nunca materializar o dump inteiro em RAM nem em disco. Antes usava `uploadAndWait`, mas isso gravava o dump inteiro (podendo ser vários GB) como BYTEA em `temp_files` — no mesmo Postgres sendo "backupeado" — e ainda retinha o buffer completo 2-3x em memória do processo (chunks do `pg_dump` → linha em `temp_files` → releitura pelo worker → body do PUT), causando os picos de swap na VM durante backup+envio pra nuvem. Categoria `BACKUP` de `uploader-priority.ts` foi removida por ficar sem uso. Timeout do upload segue configurável via `AUTO_BACKUP_UPLOAD_TIMEOUT_MS` (default 10min).
- `cte.controller.ts` (`downloadXmlBatchFile`) — `enqueueDelete` (categoria `CTE`) no lugar do delete síncrono pós-download.

## Arquivamento do XML do CT-e (`cte-archive`)

Garantia: todo CT-e com `xml_path` termina com `ctes.cloud_path` preenchido — o banco é o ponteiro durável, nunca o Redis nem `temp_files`.

- **Job `cte-archive`** (`{cteId}`, jobId `cte-archive-<cteId>` — dedupa; `add()` recria job `failed`): `CteXmlArchiveService.archive` (`warehouse/fiscal/ctes/cte/services/`) lê `xml_path` do próprio banco (sem `temp_files`, sem buffer no Redis), descriptografa, `uploaderService.uploadIfMissing` (HEAD → PUT só se faltar — 1 HEAD por CT-e realmente ausente, o sweep já filtrou os existentes; `{number}_{id}.xml` em `CTE_XML_DIRECTORY`) e grava `cloud_path`. `xml_path` legado começando com `http` vira `cloud_path` direto. Falha (upload, HEAD ≠ 404, `CTE_XML_DIRECTORY` ausente) propaga → retry do BullMQ; `cloud_path` só é gravado depois do upload confirmado.
- **Enqueue inline**: `fetchAndUpsertCte` enfileira logo após criar o CT-e (prioridade `CTE`); falha ao enfileirar só loga.
- **Sweep** (`UploaderQueue.startCteArchiveSweep`, chamado em `startWorkers` — só o container `workers` roda; `server.ts` não chama `startWorkers`): timer **em processo** a cada `CTE_ARCHIVE_SWEEP_INTERVAL_MS` (default 10min) + uma execução no boot. Não é repeatable do BullMQ de propósito (sobrevive a perda/flush do Redis). O timer **só enfileira** um job `cte-archive-reconcile` (jobId fixo, dedupa) — não chama o storage, então nada fura o limiter.
  - O job `cte-archive-reconcile` (`processCteArchiveReconcile`, mesma prioridade `CTE` — prioridade menor passaria fome se a fila nunca esvaziar; custo: backlog grande atrasa CT-e novo, FIFO) chama `CteXmlArchiveService.reconcilePending`: pega CT-es com `cloud_path IS NULL AND xml_path IS NOT NULL` (`CteService.findPendingCloudArchive`); se há pendentes, **uma** listagem do diretório (`uploaderService.listFileNames`, PROPFIND Depth 1) em vez de um HEAD por CT-e. Os que já estão na nuvem ganham `cloud_path` em lote (`markCloudArchived`, um UPDATE por 1000 ids, sem request ao storage); só os ausentes viram job `cte-archive`.
  - Sem pendentes não há request nenhuma ao Nextcloud. Backlog histórico (linhas anteriores à `m297`) vira 1 PROPFIND + UPDATEs, não N HEADs — N HEADs estouravam o rate limit do Nextcloud. Falha do job (ex.: 429 esgotado) → retry do BullMQ; `failed` é recriado pelo próximo tick do timer.
  - Cobre: falha no enqueue inline, job esgotado (5 tentativas → `failed`), crash entre create e enqueue, Redis perdido.
- Falha permanente (ex.: XML não descriptografa) é retentada a cada sweep e aparece como `[QUEUE] Job cte-archive-<id> falhou` — investigar pelo log.
- Pra saber se um CT-e está na nuvem: `ctes.cloud_path IS NOT NULL`.
