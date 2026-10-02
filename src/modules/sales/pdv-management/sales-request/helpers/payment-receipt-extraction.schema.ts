import { z } from "zod";

// Valida a saída do parser local (payment-receipt-text-parser.ts) antes de
// persistir — qualquer desvio (campo faltando, tipo errado, valor fora do
// enum) é rejeitado em vez de salvo como está. Também usado pra validar
// edição manual do front (PATCH /:id/receipt/analysis).
// Campo limpo no formulário do front chega como "" — nas edições manuais isso
// significa "sem valor" (null), não um erro de tipo.
function emptyStringsToNull(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value === "" ? null : value,
    ]),
  );
}

export const PaymentReceiptExtractionSchema = z.object({
  tipo_comprovante: z
    .enum(["cartao_credito", "cartao_debito", "pix", "transferencia"])
    .nullable(),
  estabelecimento_nome: z.string().nullable(),
  estabelecimento_cnpj: z.string().nullable(),
  valor_total: z.number().nullable(),
  qtd_parcelas: z.number().int().nullable(),
  valor_parcela: z.number().nullable(),
  data_transacao: z.string().nullable(),
  hora_transacao: z.string().nullable(),
  bandeira_cartao: z.string().nullable(),
  instituicao_pagamento: z.string().nullable(),
  titular_cartao: z.string().nullable(),
  cartao_final: z.string().nullable(),
  codigo_autorizacao: z.string().nullable(),
  nsu_cv: z.string().nullable(),
});

// Entrada de edição manual (PATCH /:id/receipt/:receiptId/analysis): além dos
// campos da extração, aceita payment_method_id — o backend resolve a forma
// no catálogo e deriva tipo_comprovante dela. `payment_method` (snapshot
// salvo) nunca é aceito do cliente.
export const PaymentReceiptEditSchema = z.preprocess(
  emptyStringsToNull,
  PaymentReceiptExtractionSchema.extend({
    payment_method_id: z.string().uuid().nullable(),
  }).partial(),
);

export type PaymentReceiptExtractionInput = z.infer<
  typeof PaymentReceiptExtractionSchema
>;

// Mesmo shape, mas tipo_comprovante é texto livre em vez do enum fechado —
// a conciliação (ver receipt-reconciliation.ts) pode juntar mais de um tipo
// num só campo (ex.: "pix + cartao_credito"). Usado só pra validar edição
// manual de PdvSalesRequest.payment_receipt_analysis (PATCH
// /:id/payment-receipt-analysis), nunca a análise de um comprovante isolado.
export const PaymentReceiptReconciledAnalysisSchema =
  PaymentReceiptExtractionSchema.extend({
    tipo_comprovante: z.string().nullable(),
  });

// Edição manual do resumo conciliado: lista de formas de pagamento do catálogo
// (o resumo pode combinar mais de um tipo).
export const PaymentReceiptReconciledEditSchema = z.preprocess(
  emptyStringsToNull,
  PaymentReceiptReconciledAnalysisSchema.extend({
    payment_method_ids: z.array(z.string().uuid()),
  }).partial(),
);
