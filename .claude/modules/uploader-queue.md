# Uploader queue (upload/delete assíncrono, rate limit, cache)

## Por que existe

Antes desta mudança, todo ponto do código que precisava subir um arquivo pro storage externo (Nextcloud via WebDAV, `UploaderService`) chamava `uploaderService.upload(...)` direto, de forma síncrona, sem nenhuma proteção de rate limit e sem nenhum throttling compartilhado entre os vários consumidores. Dois desses pontos (PDV — anexar comprovante; unmapped-invoice-product — criar a partir de leitura de EAN) faziam o usuário esperar o round-trip completo até o Nextcloud antes do request HTTP responder.

A solução: uma fila BullMQ única (`UploaderQueue`, `src/modules/handlers/uploader/uploader.queue.ts`) por onde **todo** upload e delete passa a transitar, com dois modos de uso, mais um staging genérico em Postgres (`temp_files`) que evita colocar buffers no payload do job Redis.

## `temp_files` — staging genérico (`src/modules/handlers/temp-file/`)

Toda operação de upload primeiro vira uma linha em `temp_files` (BYTEA), via `BaseRepository`/`BaseService` genéricos — sem método customizado. O job BullMQ carrega só o `id` dessa linha, nunca o buffer (Redis é dimensionado pra filas/lock, não pra blobs; Postgres cobre isso nativamente via TOAST).

`entity_type`/`entity_id` são NULLABLE — só preenchidos quando há finalização automática. Quatro hoje (`src/shared/constants/temp-file-entity-type.ts`): `PDV_SALES_REQUEST_RECEIPT` (`pdv_sales_request_receipts.path`), `UNMAPPED_INVOICE_PRODUCT` (`unmapped_invoice_products.image_path`), `INVOICE_DANFE` (`invoices.danfe_path`), `CTE` (`JobTracker`/Redis, não uma tabela — ver abaixo). Path sentinela (`temp://<tempFileId>`, helpers em `temp-file.constants.ts`) só se aplica às 2 primeiras, reaproveitando a coluna TEXT já existente nas tabelas de destino — `INVOICE_DANFE`/`CTE` são diferentes (ver abaixo).

## Os três modos de uso da fila

**Staging com finalização automática** (os 4 entity_type acima — todos os casos onde algo já existe/responde antes do arquivo estar pronto): o "destino" cria/atualiza seu próprio registro (sem esperar o upload) e o `temp_files` correspondente, e chama `uploaderQueue.enqueueUpload(tempFileId, entityType)` **depois** de persistido. O job (`processUpload`) sobe o arquivo, aquece o cache (ver abaixo), grava o path real de volta via `FINALIZERS` (`uploader-finalizers.ts`) e apaga a linha `temp_files`. Se o destino sumiu nesse meio tempo, desfaz o upload (`uploaderService.delete`) em vez de deixar arquivo órfão.

`PDV_SALES_REQUEST_RECEIPT`/`UNMAPPED_INVOICE_PRODUCT` usam o path sentinela porque a coluna é `NOT NULL`/sempre populada, e uma transação Postgres cria a linha de destino + o `temp_files` juntos. `INVOICE_DANFE` é diferente: `invoices.danfe_path` já aceita `NULL`, então a invoice é criada/atualizada com `danfe_path: null` (sem sentinela) enquanto o upload não termina — `FINALIZE_CHECKERS.INVOICE_DANFE` trata "ainda não subiu" como `danfe_path` falsy, não como prefixo `temp://`. `CTE` (só `cte-download.queue.ts`/`CteXmlBatchQueue`, export em lote de XMLs) é o único cujo destino não é uma entidade Sequelize: é o `JobTracker` (Redis, `cte-download.tracker.ts`, já usado direto pelo controller pra status/polling) — `FINALIZERS.CTE`/`FINALIZE_CHECKERS.CTE` chamam `JobTracker.get`/`update` no lugar do `<entity>Service`, e o finalizer também dispara o `socket.emitToUser("job:completed", ...)` que antes rodava logo após o `uploadAndWait` (por isso `JobState` ganhou `userId`). Em todos os 3, `FINALIZERS` respeita o layering das entidades Sequelize que têm um (nunca repository/model direto) — `CTE` é a única exceção porque seu "destino" nunca foi uma entidade Sequelize pra começar.

**Espera síncrona** (só `auto-backup.service.ts` hoje): `uploaderQueue.uploadAndWait(input, category)` cria o staging sem `entity_type` (sem finalização automática), enfileira e usa `job.waitUntilFinished(this.queueEvents, timeoutMs)` (mecanismo nativo do BullMQ — funciona entre processos diferentes porque é pub/sub via Redis pela chave da fila, não por identidade de instância) pra devolver o path real de forma síncrona do ponto de vista de quem chama. Existe porque o backup não tem uma entidade de negócio própria pra consultar depois — o resultado (path) só interessa a quem já está esperando ali mesmo.

**Fire-and-forget sem entidade** (`cte-upsert.service.ts`, arquivamento do XML do CT-e individual): `uploaderQueue.uploadFireAndForget(input, category)` — igual ao staging do `uploadAndWait` (`entity_type`/`entity_id` null), mas sem `job.waitUntilFinished`. Existe porque, diferente do que se presumia inicialmente, `ctes.xml_path` **não** é um path — é o XML criptografado (`encryptXml`) guardado no próprio banco; não há campo na entidade `Cte` apontando pro arquivo arquivado na nuvem, então não há o que finalizar. Migrado de `uploadAndWait` porque essa chamada roda dentro de `CteIngestionQueue.process` — esperar o upload ali prendia aquele job `active`, disputando concorrência da fila de ingestão à toa.

Delete segue o mesmo padrão de "sempre enfileirado": `uploaderQueue.enqueueDelete(target, category, cacheKey?)`, fire-and-forget. `target` é `{type: "temp-file", tempFileId}` (upload ainda não subiu — apaga só a linha de staging) ou `{type: "real-path", path}` (já subiu — apaga da nuvem via `uploaderService.delete`). Quem chama decide o `target` lendo o path ATUAL da entidade no momento do delete (`resolveDeleteTarget`, em `temp-file.constants.ts`).

`BaseQueueService<T, R>` ganhou um segundo parâmetro genérico (`R`, default `void`) especificamente pra viabilizar `uploadAndWait` — sem isso `process()` não conseguiria devolver o path real pra `job.waitUntilFinished` ler. Mudança aditiva/retrocompatível: toda fila existente continua com `R = void` implícito, sem precisar mudar nada.

## Prioridade (`uploader-priority.ts`)

BullMQ nativo (`priority` no `add()`, número menor = mais prioritário), pra um lote de fotos de EAN ou o backup diário não atrasarem um comprovante de PDV que o financeiro está esperando aprovar. `UploaderPriorityCategory` é um superset dos 4 valores de `TempFileEntityType` — por isso o staging automático (PDV/unmapped/DANFE/CTE) resolve a prioridade sozinho a partir do próprio `entityType` (o chamador nunca escolhe um número), enquanto os consumidores sem entidade (`auto-backup.service.ts`, `cte-upsert.service.ts`) passam a categoria explícita (`"BACKUP"`, `"CTE"`) em `uploadAndWait`/`uploadFireAndForget`/`enqueueDelete`.

Ordem: `PDV_SALES_REQUEST_RECEIPT` (1) > `UNMAPPED_INVOICE_PRODUCT` (2) > `INVOICE_DANFE` (3) > `CTE` (4) > `BACKUP` (5).

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
- **B** (`entity_type` setado, `still-sentinel`): upload nunca rodou (ou falhou) — reenfileira com `enqueueUpload` (mesma prioridade de sempre) e incrementa `reconcile_attempts` (`temp_files.reconcile_attempts`, migration `m291`); passado `UPLOADER_RECONCILE_MAX_ATTEMPTS` (default 5), para de tentar e só loga erro. Pra `INVOICE_DANFE`, "still-sentinel" é `danfe_path` falsy (não prefixo `temp://`, ver acima).
- **C** (`entity_type` setado, `missing`): entidade de destino não existe mais — apaga a linha, log `warn`.
- **D** (sem `entity_type` — `uploadAndWait`/`uploadFireAndForget`, hoje `auto-backup.service.ts` e `cte-upsert.service.ts`): checa o estado do job na fila (`queue.getJob(tempFile.id).getState()`); se ainda `waiting`/`active`/`delayed`/`prioritized`, não mexe; senão (job `failed` ou nem encontrado mais), **não reenfileira** — só apaga e loga erro pra investigação manual. Diferença chave pro caso B: nos fluxos com `entity_type`, o destino guarda um ponteiro durável que sobrevive a um crash do processo, então reenfileirar é seguro (o resultado tem pra onde ir); nos fluxos sem entidade, ninguém guarda esse ponteiro — reenfileirar cegamente só geraria um arquivo órfão na nuvem que nada mais referencia.

## Consumidores migrados

- `PdvSalesRequestService.attachReceipt`/`deleteReceipt`/`deleteRequest`/`getReceiptBuffer` — staging com finalização (`PDV_SALES_REQUEST_RECEIPT`).
- `UnmappedInvoiceProductService.createUnmappedFromReadingEan`/`delete`/`markMapped`/novo `getImageBuffer` — staging com finalização (`UNMAPPED_INVOICE_PRODUCT`). `getImage` do controller migrou pro service (antes chamava `uploaderService` direto no controller, violando "controller só request/response").
- `bling-api-fetch.queue.ts` e `invoice-xml.ts` (upsert da invoice, DANFE Bling e Tecinco) — staging com finalização (`INVOICE_DANFE`): baixam/geram o buffer do DANFE, mas upsertam a invoice imediatamente com `danfe_path: null` e só criam o `temp_files`/`enqueueUpload` **depois** de ter o `invoice.id` (create ou update já resolvido) — a nota nunca espera o upload.
- `cte-upsert.service.ts` (`uploadXmlToCloud`, dentro de `CteIngestionQueue.process`) — `uploadFireAndForget` (categoria `CTE`, sem entidade — `ctes.xml_path` guarda o XML criptografado, não um path pra finalizar).
- `cte-download.queue.ts` (`CteXmlBatchQueue.process`) — staging com finalização (`CTE`, `entity_id` = `jobId`): o job desta fila conclui sem esperar o upload real; `FINALIZERS.CTE` grava o `filePath` no `JobTracker` e reemite o `socket` `job:completed` quando o upload termina de verdade.
- `auto-backup.service.ts` (`run`) — `uploadAndWait` (categoria `BACKUP`) — único que ainda espera, porque não tem entidade própria com campo consultável depois; timeout já configurável via `AUTO_BACKUP_UPLOAD_TIMEOUT_MS` (default 10min), generoso o bastante pra prioridade mais baixa (5) da fila.
- `cte.controller.ts` (`downloadXmlBatchFile`) — `enqueueDelete` (categoria `CTE`) no lugar do delete síncrono pós-download.
