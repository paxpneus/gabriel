import { z } from "zod";

// Valida a resposta do Gemini antes de persistir — o schema é o mesmo
// contrato fixo do prompt (payment-receipt-prompt.ts); qualquer desvio
// (campo faltando, tipo errado, valor fora do enum) é rejeitado em vez de
// salvo como está.
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
