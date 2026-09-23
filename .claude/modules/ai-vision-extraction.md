# Extração estruturada por IA (Gemini)

Primeira integração de IA do projeto. Dois níveis, do mais genérico pro mais específico:

## Cliente (`src/shared/providers/ai/gemini-vision.service.ts`)

`GeminiVisionService` — singleton, sem estado de negócio, **prompt-parametrizado**: não sabe nada sobre comprovante, DANFE ou qualquer domínio. Usa `@google/genai` (SDK oficial atual — `@google/generative-ai`, legado, foi removido do projeto), lê `GEMINI_API_KEY`/`GEMINI_MODEL` (default `gemini-3.6-flash`) do `.env`. Cliente HTTP (`GoogleGenAI`) é criado sob demanda (`getClient()`, lazy) na primeira chamada, não no construtor — o módulo é importado no boot da app independente de o recurso estar em uso, então falhar cedo por falta de API key derrubaria o processo à toa. Chamada de geração é `client.models.generateContent({ model, contents })`, resposta em `result.text` (getter, não `result.response.text()` como no SDK antigo).

**Migração do SDK legado, `@google/generative-ai` → `@google/genai`.** Motivo: 404 recorrente de modelo (nomes de modelo saindo de suporte com frequência, ver incidente abaixo) e o SDK antigo estava sem atualização/suporte oficial da Google. `ApiError.status` (novo SDK) mantém o mesmo formato de erro do antigo (`error.status` numérico), então `withRetry` não precisou mudar a lógica, só a chamada em si.

`extractFromText`/`extractFromInlineData` passam pelo `withRetry` privado: até 4 retries com backoff linear (2s, 4s, 6s, 8s), pra erro com `status` 429/500/503 — 429 incluído de propósito pra picos de chamada simultânea no PDV (várias lojas analisando ao mesmo tempo) esperarem o retry em vez de falhar na hora; 500/503 são os picos de demanda passageiros já vistos em produção. Qualquer outro status (404, 400, auth) propaga na primeira tentativa. Mais tolerante que antes porque a análise roda em background (ver seção "Análise assíncrona" em `.claude/entities/pdv-sales-request/index.md`) e não bloqueia mais a resposta HTTP.

**Atenção — retry aqui compete com o teto de 5s do caller.** `PdvSalesRequestService.withReceiptAnalysisTimeout` (`RECEIPT_ANALYSIS_TIMEOUT_MS = 5000`) desiste de esperar a análise depois de 5s — com backoff de 2s/4s/6s/8s, isso deixa espaço pra no máximo 1 retry (às vezes nem isso, dependendo da latência do próprio Gemini) antes do caller já ter desistido e avisado o front que a análise falhou. A chamada ao Gemini continua rodando em background depois disso (não é cancelada), então ainda pode terminar e gravar no banco mais tarde — só não é mais esperada por ninguém nesse momento. Se o objetivo é aproveitar os 4 retries de verdade, os dois valores (timeout do caller vs. backoff daqui) precisam ser revistos juntos.

**Incidente já corrigido: default hardcoded apontava pra modelo descontinuado.** `DEFAULT_MODEL` era `gemini-2.0-flash`, que a API do Google passou a rejeitar com 404 ("no longer available") — como a falha da IA nunca bloqueia o fluxo (ver seção abaixo), o sintoma em produção não era erro visível, e sim toda análise de comprovante saindo `null` silenciosamente. Corrigido pro modelo vigente, `gemini-3.6-flash`. Se o mesmo sintoma voltar (campos de análise sempre `null`, log `[PDV] Falha ao analisar comprovante via IA`), suspeitar primeiro de `DEFAULT_MODEL`/`GEMINI_MODEL` desatualizado antes de qualquer outra causa.

Dois métodos:
- `extractFromText({ text, prompt })` — texto já extraído localmente (ex.: PDF nativo), sem custo de visão computacional.
- `extractFromInlineData({ buffer, mimeType, prompt })` — manda o binário (imagem ou PDF) direto pro Gemini, como base64.

Ambos retornam a resposta bruta (string) do modelo — quem chama decide como parsear/validar.

## Pipeline de extração de documento (`src/shared/utils/documents/document-extraction.ts`)

`extractStructuredDataFromDocument({ buffer, mimeType, prompt, minNativeTextLength? })` — decide PDF nativo vs. binário:
1. Se `mimeType === "application/pdf"`, tenta `pdf-parse` local primeiro. Texto extraído com `length >= minNativeTextLength` (default 40) → `extractFromText` (barato, sem visão computacional).
2. Caso contrário (imagem, PDF escaneado/sem texto suficiente, ou `pdf-parse` falhou) → `extractFromInlineData` com o binário original.

Único ponto de decisão "texto local vs. IA visual" do projeto — qualquer novo caso de uso de extração por IA deve passar por aqui, não reimplementar a lógica de PDF-nativo-vs-escaneado.

## Consumidores atuais (só o módulo PDV, ver `.claude/entities/pdv-sales-request/index.md`)

- **Comprovante de pagamento** — `pdv-sales-request/payment-receipt-extraction.service.ts`. Prompt fixo (`helpers/payment-receipt-prompt.ts`) pede um schema de 13 campos (`PaymentReceiptExtraction`, `pdv-sales-request.types.ts`), nunca JSON solto. Resposta validada com Zod (`helpers/payment-receipt-extraction.schema.ts`) antes de confiar em qualquer campo. `instituicao_pagamento` é texto livre transcrito do comprovante (nunca normalizado pela IA) — cobre tanto banco/instituição (ex.: "Itaú") quanto nome/apelido de maquininha de cartão (ex.: "Laranjinha Itaú"), já que comprovante de maquininha frequentemente não mostra o nome "limpo" do banco. Também calcula, no mesmo `analyze()` (via `computeDerived`, também reaproveitado por `updateReceiptAnalysis` na edição manual, ver `.claude/entities/pdv-sales-request/index.md`):
  - `payment_receipt_validated` — só quando `tipo_comprovante === "cartao_credito"`: `qtd_parcelas * valor_parcela ≈ valor_total` (tolerância de 1 centavo). `null` quando não aplicável (PIX, débito, crédito à vista).
  - `payment_receipt_fingerprint` — `sha256(cnpj|data|hora|valor_total|instrumento)`, `instrumento = cartao_final ?? codigo_autorizacao ?? nsu_cv`. `null` quando falta qualquer um dos campos-chave.
- **Chave de acesso do DANFE fotografado/escaneado** — `pdv-sales-request/helpers/danfe-interpreter.ts`. Regex local (PDF nativo) tenta primeiro; só cai pro pipeline de IA (prompt em `helpers/danfe-access-key-prompt.ts`) quando a regex não encontra nada — cobre o caso que ficou pendente na Etapa 1/Passo A (documento sem texto selecionável).

## Falha da IA nunca bloqueia o fluxo de negócio — duplicidade virou advisória (era bloqueante)

`PdvSalesRequestService.analyzeReceipt` (privado, chamado por `runReceiptAnalysisAsync`) envolve a chamada a `paymentReceiptExtractionService.analyze` em try/catch: Gemini fora do ar, resposta malformada ou fora do schema Zod → loga e segue com todos os campos de análise `null`, sem impedir o anexo do comprovante (o financeiro ainda revisa manualmente, é a mesma garantia da Etapa 1).

Fingerprint duplicado (`DuplicateReceiptError`, `finalizeReceiptAnalysis`) é a única falha tratada como "erro de verdade" dentro do job, mas **desde que a análise passou a rodar em background (ver `.claude/entities/pdv-sales-request/index.md`, seção "Análise assíncrona"), duplicidade não bloqueia mais o attach em si** — não tem mais como (a extração, que dá o fingerprint, só termina DEPOIS do upload). Vira uma notificação de falha via websocket (`reason: "DUPLICATE_RECEIPT"`), o comprovante fica anexado mesmo assim, e cabe ao usuário trocar. Só é tratado como duplicidade real se pertencer a uma solicitação **diferente** da atual (reenviar o mesmo comprovante pra corrigir a própria solicitação não é bloqueado).

## Comparação forma de pagamento × comprovante

`helpers/payment-method-match.ts::paymentMethodMatchesReceipt(paymentMethodDescription, tipo_comprovante)` — comparação por palavra-chave (normaliza maiúsculas + remove acento antes de comparar, já que a descrição da forma de pagamento na Bling é texto livre por conta, ex. "Cartão de Crédito Itaú"), nunca igualdade. Resultado é informativo (`payment_method_matches_receipt`, nullable), não bloqueia nenhuma transição de status. Precisa da forma de pagamento do pedido já resolvida — `OrderRepository.findByIdWithPaymentMethod`/`OrderService.findByIdWithPaymentMethod` (novo `include` de `PaymentMethod`, permitido pela regra de layering por ficar na repository).
