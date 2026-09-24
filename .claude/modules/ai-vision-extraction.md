# Extração estruturada de documentos (IA + OCR local)

Dois pipelines **independentes**, um por domínio — deixaram de compartilhar um pipeline único desde que o comprovante de pagamento saiu do Gemini (ver seção própria abaixo). O cliente Gemini e `document-extraction.ts` continuam existindo, mas hoje só atendem o fallback de DANFE fotografado.

## Cliente Gemini (`src/shared/providers/ai/gemini-vision.service.ts`)

`GeminiVisionService` — singleton, sem estado de negócio, **prompt-parametrizado**: não sabe nada sobre comprovante, DANFE ou qualquer domínio. Usa `@google/genai` (SDK oficial atual — `@google/generative-ai`, legado, foi removido do projeto), lê `GEMINI_API_KEY`/`GEMINI_MODEL` (default `gemini-3.6-flash`) do `.env`. Cliente HTTP (`GoogleGenAI`) é criado sob demanda (`getClient()`, lazy) na primeira chamada, não no construtor — o módulo é importado no boot da app independente de o recurso estar em uso, então falhar cedo por falta de API key derrubaria o processo à toa. Chamada de geração é `client.models.generateContent({ model, contents })`, resposta em `result.text` (getter, não `result.response.text()` como no SDK antigo).

**Migração do SDK legado, `@google/generative-ai` → `@google/genai`.** Motivo: 404 recorrente de modelo (nomes de modelo saindo de suporte com frequência, ver incidente abaixo) e o SDK antigo estava sem atualização/suporte oficial da Google. `ApiError.status` (novo SDK) mantém o mesmo formato de erro do antigo (`error.status` numérico), então `withRetry` não precisou mudar a lógica, só a chamada em si.

`extractFromText`/`extractFromInlineData` passam pelo `withRetry` privado: até 4 retries com backoff linear (2s, 4s, 6s, 8s), pra erro com `status` 429/500/503. Hoje só quem chama isso é o fallback de DANFE (seção abaixo) — o comprovante de pagamento não usa mais Gemini, então o timeout de 5s do PDV (`RECEIPT_ANALYSIS_TIMEOUT_MS`) não compete mais com esse retry no caso do comprovante.

**Incidente já corrigido: default hardcoded apontava pra modelo descontinuado.** `DEFAULT_MODEL` era `gemini-2.0-flash`, que a API do Google passou a rejeitar com 404 ("no longer available") — corrigido pro modelo vigente, `gemini-3.6-flash`. Se a extração de DANFE via IA parar de funcionar silenciosamente, suspeitar primeiro de `DEFAULT_MODEL`/`GEMINI_MODEL` desatualizado.

Dois métodos:
- `extractFromText({ text, prompt })` — texto já extraído localmente (ex.: PDF nativo), sem custo de visão computacional.
- `extractFromInlineData({ buffer, mimeType, prompt })` — manda o binário (imagem ou PDF) direto pro Gemini, como base64.

Ambos retornam a resposta bruta (string) do modelo — quem chama decide como parsear/validar.

## Pipeline de extração de documento via IA (`src/shared/utils/documents/document-extraction.ts`)

`extractStructuredDataFromDocument({ buffer, mimeType, prompt, minNativeTextLength? })` — decide PDF nativo vs. binário:
1. Se `mimeType === "application/pdf"`, tenta `pdf-parse` local primeiro. Texto extraído com `length >= minNativeTextLength` (default 40) → `extractFromText` (barato, sem visão computacional).
2. Caso contrário (imagem, PDF escaneado/sem texto suficiente, ou `pdf-parse` falhou) → `extractFromInlineData` com o binário original.

Hoje o único consumidor é o fallback de DANFE fotografado (seção abaixo) — o comprovante de pagamento tem seu próprio pipeline local, não passa mais por aqui (ver "Comprovante de pagamento" abaixo antes de reusar isto pra outro caso).

## DANFE fotografado/escaneado — `pdv-sales-request/helpers/danfe-interpreter.ts`

Regex local (PDF nativo) tenta primeiro; só cai pro pipeline de IA acima (prompt em `helpers/danfe-access-key-prompt.ts`) quando a regex não encontra nada — cobre o caso de documento sem texto selecionável (foto/scan). **Não mudou** nesta sessão — só o comprovante de pagamento saiu do Gemini.

## Comprovante de pagamento — pipeline local, sem IA (`pdv-sales-request/payment-receipt-extraction.service.ts`)

Trocado de Gemini pra extração 100% local — decisão consciente de abrir mão de flexibilidade em favor de zero dependência de IA/rede nesse fluxo específico. Dois passos, ambos em `helpers/`:

1. **Texto** — `receipt-text-extraction.ts::extractReceiptText(buffer, mimeType)`: PDF nativo (texto selecionável, `length >= 40`) via `pdf-parse`, mesma regra de antes; qualquer imagem via OCR local (`tesseract.js`, idioma `por`, `createWorker("por", ...)`, worker/core 100% locais — `tesseract.js-core` já traz o WASM, nenhuma chamada de rede pra isso). PDF sem texto nativo suficiente (escaneado/só imagem embutida dentro do PDF) **não é rasterizado** — volta texto vazio (ver limitação abaixo).
2. **Campos** — `payment-receipt-text-parser.ts::parsePaymentReceiptText(text)`: regex/heurísticas pros mesmos 13 campos de sempre (`PaymentReceiptExtraction`), sem nenhum entendimento de linguagem natural. Cobre formatos comuns (data `dd/mm/aaaa`, valor `R$ x,xx`, parcelamento `NxR$ y,yy`, CNPJ, cartão final, autorização, NSU/CV) e uma lista fechada de bancos/maquininhas/bandeiras conhecidas pra `instituicao_pagamento`/`bandeira_cartao` — fora dessa lista, fica `null` em vez de arriscar um trecho de texto qualquer (mesmo espírito de "nunca inventar valor" do prompt de IA antigo). `PaymentReceiptExtractionSchema` (Zod) continua validando a saída antes de persistir, mesmo o parser sendo interno.

Comprovantes em formatos atípicos tendem a deixar mais campos `null` do que a extração por IA deixava — aceitável porque a análise nunca bloqueia o fluxo (financeiro/CD21 sempre revisam manualmente, ver seção abaixo).

### Dados do Tesseract (`resources/tessdata/`)

`por.traineddata.gz` (variante `4.0.0_best_int`, ~1,4MB, mesma que `tesseract.js` usaria por padrão via CDN) baixado uma vez de `@tesseract.js-data`/jsdelivr e **versionado no repo** — nunca baixado de rede em runtime. `createWorker` recebe `langPath: TESSDATA_DIR` (local, não URL) + `cacheMethod: "none"` (evita o worker tentar escrever um cache decodificado em disco, já que `resources/` pode estar montado read-only em produção). Verificado manualmente: apontar `langPath` pra um diretório inexistente lança `ENOENT` em vez de cair pro CDN — confirma que não há fallback de rede escondido.

`TESSDATA_DIR` vem de `src/config/resource-paths.ts`, resolvido a partir de `__dirname` com exatamente 2 níveis (`config/` → `src/`ou`dist/` → raiz do projeto) — funciona igual em dev (`tsx` rodando direto de `src/`) e produção (compilado em `dist/`), sem depender de `process.cwd()` (que pode divergir conforme quem sobe o processo). `Dockerfile` copia `resources/` em todo estágio que copia `dist`/`migrations` (`builder`, `base-prod`, `worker-scraping`) — pasta nova fora de `src`/`dist`, não é compilada pelo `tsc`; se um novo estágio de build for adicionado, precisa da mesma cópia.

### Limitação conhecida: PDF escaneado/só-imagem

Diferente do pipeline de IA (que mandava o PDF binário direto pro Gemini, capaz de "ler" a imagem embutida no PDF), o Tesseract não rasteriza PDF — só processa imagem já decodificada. Um PDF sem texto nativo selecionável (comprovante escaneado, ou só uma foto colada dentro do PDF) hoje volta texto vazio da extração, e a análise sai inteira `null` — mesmo efeito de "falha de extração", nunca bloqueia o fluxo. Se isso se mostrar comum na prática, precisa de uma etapa de rasterização PDF→imagem antes do OCR (não implementado agora, dependência nova a avaliar).

## Falha de extração nunca bloqueia o fluxo de negócio — duplicidade virou advisória (era bloqueante)

`PdvSalesRequestService.analyzeReceipt` (privado, chamado por `runReceiptAnalysisAsync`) envolve a chamada a `paymentReceiptExtractionService.analyze` em try/catch: documento ilegível, OCR sem texto, ou resultado fora do schema Zod → loga e segue com todos os campos de análise `null`, sem impedir o anexo do comprovante (o financeiro ainda revisa manualmente, é a mesma garantia de sempre — só a causa comum de falha mudou de "Gemini fora do ar" pra "OCR sem texto/documento atípico").

Fingerprint duplicado (`DuplicateReceiptError`, `finalizeReceiptAnalysis`) é a única falha tratada como "erro de verdade" dentro do job, mas **desde que a análise passou a rodar em background (ver `.claude/entities/pdv-sales-request/index.md`, seção "Análise assíncrona"), duplicidade não bloqueia mais o attach em si** — não tem mais como (a extração, que dá o fingerprint, só termina DEPOIS do upload). Vira uma notificação de falha via websocket (`reason: "DUPLICATE_RECEIPT"`), o comprovante fica anexado mesmo assim, e cabe ao usuário trocar. Só é tratado como duplicidade real se pertencer a uma solicitação **diferente** da atual (reenviar o mesmo comprovante pra corrigir a própria solicitação não é bloqueado).

## Comparação forma de pagamento × comprovante

`helpers/payment-method-match.ts::paymentMethodMatchesReceipt(paymentMethodDescription, tipo_comprovante)` — comparação por palavra-chave (normaliza maiúsculas + remove acento antes de comparar, já que a descrição da forma de pagamento na Bling é texto livre por conta, ex. "Cartão de Crédito Itaú"), nunca igualdade. Resultado é informativo (`payment_method_matches_receipt`, nullable), não bloqueia nenhuma transição de status. Precisa da forma de pagamento do pedido já resolvida — `OrderRepository.findByIdWithPaymentMethod`/`OrderService.findByIdWithPaymentMethod` (novo `include` de `PaymentMethod`, permitido pela regra de layering por ficar na repository).
