import { z } from "zod";

// Valida a saída do parser local (payment-receipt-text-parser.ts) antes de
// persistir — qualquer desvio (campo faltando, tipo errado, valor fora do
// enum) é rejeitado em vez de salvo como está. Também usado pra validar
// edição manual do front (PATCH /:id/receipt/analysis).
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
