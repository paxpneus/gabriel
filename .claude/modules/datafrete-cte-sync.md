# Datafrete CT-e sync

## Fluxo

`CteIngestionQueue` (`src/modules/handlers/fiscal/documents/cte/queues/cte-ingestion.queue.ts`) busca CT-es na Sieg por `role="tom"` (CNPJ da unit business como tomador do frete) **pra todas as unit businesses comerciais** (`unitBusinessService.getComercialUnitBusinessOnly()`, tipo `PHYSICAL` + `number != '0'`) — isso só popula a tabela `ctes` local, não decide quem vai pra Datafrete.

Antes de processar os documentos retornados pelo Sieg, `fetchAndProcess` chama `filterNewDocuments`: extrai só a `chave` de cada documento (parse leve, via `extractCteFromXml`) e faz **uma única query em lote** (`cteService.findExistingXmlKeys(chaves)`) pra descobrir quais já existem em `ctes`. Só os documentos com chave nova seguem pro loop de processamento — os que já existem são descartados ali mesmo, sem passar pelo `fetchAndUpsertCte` (evita reparse pesado, resolve de transportador, encrypt e upload de novo pra CT-e que não mudou). Isso é só uma otimização de custo de processamento; `fetchAndUpsertCte` continua fazendo create-or-update de verdade internamente (é chamado só com CT-e novos na prática, mas mantém o update como fallback caso a checagem em lote e o processamento fiquem fora de sincronia).

Pra cada documento novo, dentro de `fetchAndProcess`, chama `fetchAndUpsertCte`. Se o registro criado/atualizado ainda não estiver `synched` **e** a loja da iteração for tomadora de frete de verdade (`isDatafreteFreightTakerNumber(unit.number)`), chama `syncDatafreteCteService.syncCte(cte)` **imediatamente** — não espera o restante do lote.

**Importante**: mesmo com `ROLES_TO_QUERY = ["tom"]`, o Sieg retorna CT-es marcando qualquer loja comercial como tomador (`cnpjTom`) — não só as 4 configuradas em `DATAFRETE_TAKER_UNIT_BUSINESS_NUMBERS`. Confirmado em produção: Loja 24 - Curitiba (não está na lista) teve CT-e retornado pelo Sieg com `cnpjTom` dela e, antes desse filtro existir, chegou a ser enviado de verdade pra Datafrete (chave `...849`, já importado lá, irreversível pelo nosso lado). Por isso o filtro de "é tomadora de frete pra Datafrete" **não pode vir do papel usado na busca ao Sieg** — precisa ser checado explicitamente contra a lista de lojas configuradas antes de qualquer envio.

Ao final de cada execução (`process` e `runBackfill`, ambos passam por `runForDateRanges`), ainda chama `syncDatafreteCteService.syncPendingCtes()` como catch-up: reprocessa qualquer CT-e que ficou `synched = false` (falha pontual no envio inline, ou backlog histórico de antes dessa sincronização por CT-e existir).

`SyncDatafreteCteService` (`src/modules/handlers/logistic/services/sync-datafrete-cte.service.ts`) expõe:
- `DATAFRETE_TAKER_UNIT_BUSINESS_NUMBERS` (`["21", "12", "17", "15"]`) / `isDatafreteFreightTakerNumber(number)` — única lista de lojas que são tomadoras de frete de verdade pra Datafrete. Configurado pelo usuário, não vem do Sieg nem de nenhuma flag em `unit_businesses` (não existe coluna pra isso ainda).
- `syncCte(cte)` — sincroniza um único CT-e (usado tanto pelo envio inline quanto internamente pelo catch-up em lote).
- `syncPendingCtes()` — busca as unit businesses cujo `number` está em `DATAFRETE_TAKER_UNIT_BUSINESS_NUMBERS`, pega os CNPJs, busca pendentes com `cteService.findUnsyncedTakenByCnpjs(cnpjs)` (`taker_tax_id IN (cnpjs)` e `synched = false`) e chama `syncCte` pra cada um.

`syncCte`: **não** checa existência antes de enviar (não chama mais `isCteImported`/`GET /conhecimento-transporte`) — insere direto. Descriptografa o `xml_path` (campo `ctes.xml_path` guarda o XML — às vezes cifrado via `xml-cipher`, às vezes plano), converte pra base64 e importa via `importCteJson` (`POST /conhecimento-transporte`, JSON `{ xml: base64 }`). Se a Datafrete responder que o CT-e já está cadastrado (`isDatafreteCteAlreadyCadastrado`, ver seção de códigos de erro abaixo), trata como sucesso equivalente — marca `synched = true` sem reenviar. Qualquer outro erro propaga normalmente. Essa mudança (de "checar antes" pra "inserir direto e tratar o erro de duplicidade") foi decisão explícita do usuário pra economizar uma requisição por CT-e — a pré-checagem via `isCteImported`/`listCte` continua existindo no client (`cte.service.ts` da Datafrete) mas não é mais usada nesse fluxo.

## Códigos de erro da Datafrete (`codigo_retorno`)

Mapa central em `src/modules/handlers/logistic/transporters/data-frete/helpers/error-codes.ts` (`DatafreteCodigoRetorno`, `describeDatafreteCodigoRetorno`, `extractDatafreteCodigoRetorno`, `isDatafreteCteAlreadyCadastrado`) — **nunca comparar `codigo_retorno` como número solto no código, sempre via esse helper**. Confirmados em produção:
- **714** (`CTE_JA_CADASTRADO`, HTTP 400): `"O conhecimento de transporte já está cadastrada na base de dados do DATAFRETE"` — duplicidade genuína, não é erro real.
- **712** (`TRANSPORTADOR_NAO_ENCONTRADO`, HTTP 302): `"O documento do transportador '<cnpj>' não encontrado na base de dados"` — erro real (transportador emissor do CT-e não cadastrado na conta Datafrete), não tem relação com duplicidade apesar do HTTP 302.

O ponto crítico dessa tabela: **o HTTP status não é confiável pra decidir o que fazer** — 712 (erro real) e um eventual 714 podem vir com status diferentes (400 vs 302 observados). A decisão tem que ser sempre por `codigo_retorno`, nunca por status HTTP.

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

Por isso `importCteXml`/`importCteJson` propagam a exception normalmente em qualquer status fora de 2xx (incluindo 302) — quem decide o que fazer com isso é `syncCte`, via `codigo_retorno` (ver seção "Códigos de erro" abaixo), nunca via status HTTP. O `onResponseError` em `data-frete_api.service.ts` só loga o body da resposta em qualquer erro, não interpreta nada.

### Retry de 429 (rate limit)

`data-frete_api.service.ts` tem retry automático com backoff pra 429, no mesmo padrão do client da Sieg (`sieg_api.service.ts`) e da Jadlog: até `DATAFRETE_429_MAX_RETRIES` tentativas (default 5), respeitando o header `Retry-After` quando presente, senão delay exponencial `DATAFRETE_429_BASE_DELAY_MS` (default 3s) até `DATAFRETE_429_MAX_DELAY_MS` (default 60s). Esgotadas as tentativas, propaga o erro normalmente (mesmo tratamento de falha de sempre). Isso cobre tanto o envio inline quanto o catch-up em lote, já que ambos passam pelo mesmo `datafreteApi`. Só 429 tem retry — outros erros (incluindo 302, 5xx) não retentam automaticamente, só via reprocessamento do próximo ciclo da fila (`synched` continua `false`).
