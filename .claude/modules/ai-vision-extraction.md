# Extração estruturada por IA (Gemini)

Primeira integração de IA do projeto. Dois níveis, do mais genérico pro mais específico:

## Cliente (`src/shared/providers/ai/gemini-vision.service.ts`)

`GeminiVisionService` — singleton, sem estado de negócio, **prompt-parametrizado**: não sabe nada sobre comprovante, DANFE ou qualquer domínio. Usa `@google/generative-ai`, lê `GEMINI_API_KEY`/`GEMINI_MODEL` (default `gemini-2.0-flash`) do `.env`. Cliente HTTP (`GoogleGenerativeAI`) é criado sob demanda (`getClient()`, lazy) na primeira chamada, não no construtor — o módulo é importado no boot da app independente de o recurso estar em uso, então falhar cedo por falta de API key derrubaria o processo à toa.

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

- **Comprovante de pagamento** — `pdv-sales-request/payment-receipt-extraction.service.ts`. Prompt fixo (`helpers/payment-receipt-prompt.ts`) pede um schema de 12 campos (`PaymentReceiptExtraction`, `pdv-sales-request.types.ts`), nunca JSON solto. Resposta validada com Zod (`helpers/payment-receipt-extraction.schema.ts`) antes de confiar em qualquer campo. Também calcula, no mesmo `analyze()`:
  - `payment_receipt_validated` — só quando `tipo_comprovante === "cartao_credito"`: `qtd_parcelas * valor_parcela ≈ valor_total` (tolerância de 1 centavo). `null` quando não aplicável (PIX, débito, crédito à vista).
  - `payment_receipt_fingerprint` — `sha256(cnpj|data|hora|valor_total|instrumento)`, `instrumento = cartao_final ?? codigo_autorizacao ?? nsu_cv`. `null` quando falta qualquer um dos campos-chave.
- **Chave de acesso do DANFE fotografado/escaneado** — `pdv-sales-request/helpers/danfe-interpreter.ts`. Regex local (PDF nativo) tenta primeiro; só cai pro pipeline de IA (prompt em `helpers/danfe-access-key-prompt.ts`) quando a regex não encontra nada — cobre o caso que ficou pendente na Etapa 1/Passo A (documento sem texto selecionável).

## Falha da IA nunca bloqueia o fluxo de negócio (só a duplicidade de comprovante bloqueia)

`PdvSalesRequestService.analyzeReceipt` (privado, chamado por `attachReceiptAndShippingType`) envolve a chamada a `paymentReceiptExtractionService.analyze` em try/catch: Gemini fora do ar, resposta malformada ou fora do schema Zod → loga e segue com todos os campos de análise `null`, sem impedir o anexo do comprovante (o financeiro ainda revisa manualmente, é a mesma garantia da Etapa 1). A ÚNICA falha que bloqueia de propósito é fingerprint duplicado — `findByReceiptFingerprint` roda ANTES do upload pro storage (barato desistir cedo), e só é tratado como duplicidade real se pertencer a uma solicitação **diferente** da atual (reenviar o mesmo comprovante pra corrigir a própria solicitação não é bloqueado).

## Comparação forma de pagamento × comprovante

`helpers/payment-method-match.ts::paymentMethodMatchesReceipt(paymentMethodDescription, tipo_comprovante)` — comparação por palavra-chave (normaliza maiúsculas + remove acento antes de comparar, já que a descrição da forma de pagamento na Bling é texto livre por conta, ex. "Cartão de Crédito Itaú"), nunca igualdade. Resultado é informativo (`payment_method_matches_receipt`, nullable), não bloqueia nenhuma transição de status. Precisa da forma de pagamento do pedido já resolvida — `OrderRepository.findByIdWithPaymentMethod`/`OrderService.findByIdWithPaymentMethod` (novo `include` de `PaymentMethod`, permitido pela regra de layering por ficar na repository).
