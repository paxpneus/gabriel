# Datafrete CT-e sync

## Fluxo

`CteIngestionQueue` (`src/modules/handlers/fiscal/documents/cte/queues/cte-ingestion.queue.ts`) busca CT-es na Sieg por `role="tom"` (CNPJ da unit business como tomador do frete). Pra cada documento retornado, dentro de `fetchAndProcess`, faz upsert em `ctes` via `fetchAndUpsertCte` (que agora retorna a instância `Cte` criada/atualizada) e, se o registro ainda não estiver `synched`, chama `syncDatafreteCteService.syncCte(cte)` **imediatamente** — não espera o restante do lote. Como `ROLES_TO_QUERY` só busca `tom`, todo CT-e que chega aqui já satisfaz "unit business é tomadora do frete" por construção.

Ao final de cada execução (`process` e `runBackfill`, ambos passam por `runForDateRanges`), ainda chama `syncDatafreteCteService.syncPendingCtes()` como catch-up: reprocessa qualquer CT-e que ficou `synched = false` (falha pontual no envio inline, ou backlog histórico de antes dessa sincronização por CT-e existir).

`SyncDatafreteCteService` (`src/modules/handlers/logistic/services/sync-datafrete-cte.service.ts`) expõe dois métodos:
- `syncCte(cte)` — sincroniza um único CT-e (usado tanto pelo envio inline quanto internamente pelo catch-up em lote).
- `syncPendingCtes()` — busca todos os CNPJs de unit business via `unitBusinessService.getComercialUnitBusinessOnly()` (mesmo filtro `PHYSICAL` + `number != '0'` da ingestão), busca pendentes com `cteService.findUnsyncedTakenByCnpjs(cnpjs)` (`taker_tax_id IN (cnpjs)` e `synched = false`) e chama `syncCte` pra cada um.

`syncCte`: checa na própria Datafrete se o CT-e já existe (`isCteImported`, via `GET /conhecimento-transporte?chave_ct=...`, olhando `evento.qtd_registro > 0`). Se já existe lá, só marca `synched = true` local sem reenviar. Se não existe, descriptografa o `xml_path` (campo `ctes.xml_path` guarda o XML — às vezes cifrado via `xml-cipher`, às vezes plano), converte pra base64 e importa via `importCteJson` (`POST /conhecimento-transporte`, JSON `{ xml: base64 }`).

## Coluna `synched` (`ctes`)

`false` = CT-e ainda não confirmado na Datafrete. `true` = já sincronizado (seja porque foi importado agora, seja porque a checagem via `listCte` já achou lá) — não deve ser reenviado. Migration `m281-add-synched-to-ctes.js`.

## Client Datafrete (endpoints de CT-e)

`src/modules/handlers/logistic/transporters/data-frete/services/invoices/cte/cte.service.ts`, usando o axios `datafreteApi` (`.../api/data-frete_api.service.ts`, já injeta `X-api-key`):
- `importCteXml(base64)` — `POST /conhecimento-transporte/xml`, body é um envelope XML (`<ct><xml>{base64}</xml></ct>`), `Content-Type: application/xml`.
- `importCteJson(base64)` — `POST /conhecimento-transporte`, body JSON `{ xml: base64 }` (Datafrete aceita os dois formatos pro mesmo import; o sync usa este).
- `listCte(filters)` / `isCteImported(chaveCt)` — `GET /conhecimento-transporte?chave_ct=...` (aceita também `dt_emi_ini_ct`/`dt_emi_fim_ct`/`cod_empresa`/`doc_empresa`/`numero_ct`/`id_fatura`/`id_ct`). É como se sabe se um CT-e já foi importado antes de reenviar.
- `fetchCteXml(chaveCt)` — `GET /conhecimento-transporte/xml?chave_ct=...`, retorna o XML (`cteProc`) já processado do lado da Datafrete.

Esse client é específico da Datafrete (não passa pelo `TransporterHandler`/`resolveTransporterHandler` genérico usado por ocorrências de outras transportadoras) porque importação de CT-e não é um conceito cross-transportadora — só a Datafrete tem esse endpoint.

### HTTP 302 no import — NÃO tratar como "já existe" sem checar o corpo

A doc da Datafrete diz "302 significa que o dado já consta na base... analisar a resposta fornecida". Uma tentativa anterior tratou todo 302 do import como sucesso automático (marcava `synched = true` direto). Isso causou um falso positivo em produção: um CT-e (transportador CNPJ `07770042000231`) recebeu 302 com `codigo_retorno: 712` e mensagem `"O documento do transportador '07770042000231' não encontrado na base de dados"` — ou seja, o transportador emissor do CT-e não está cadastrado na conta Datafrete, um erro real e não-relacionado a duplicidade, mas a Datafrete respondeu com o mesmo status HTTP 302 usado pra duplicidade genuína. Marcar isso como `synched = true` teria escondido o problema pra sempre (nunca mais reenviado, nunca investigado).

Por isso `importCteXml`/`importCteJson` voltaram a propagar a exception normalmente em qualquer status fora de 2xx (incluindo 302) — `syncCte` conta como falha (`synched` continua `false`, entra de novo no catch-up da próxima execução) e loga o `codigo_retorno`/`mensagem` reais (via `onResponseError` em `data-frete_api.service.ts`, que já loga o body da resposta em qualquer erro). Ainda não existe mapeamento confiável de quais `codigo_retorno` significam duplicidade genuína vs. outros erros — se/quando essa distinção for necessária, ela precisa ser feita por `codigo_retorno` específico, nunca só pelo status HTTP 302.
