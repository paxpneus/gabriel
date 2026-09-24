import {
  PaymentReceiptExtraction,
  PaymentReceiptReconciledAnalysis,
} from "../pdv-sales-request.types";

// Combina a extração de N comprovantes (um PdvSalesRequestReceipt por
// comprovante) numa única visão, persistida em
// pdv_sales_requests.payment_receipt_analysis — ver
// PdvSalesRequestService.reconcileReceipts, chamado toda vez que um
// comprovante é adicionado/editado/removido. Cada campo tem sua própria regra
// de junção (nunca um merge genérico): valor monetário soma, campo
// textual/identificador junta os valores distintos com " + " (ex.: dois
// comprovantes PIX+cartão viram tipo_comprovante "pix + cartao_credito"),
// data/hora pega qualquer um dos comprovantes (mesma transação, "qualquer um
// serve"), e parcelas/valor_parcela só passam quando exatamente 1 comprovante
// os tem — 2+ comprovantes com parcela cada não têm uma soma que faça
// sentido (fica null, financeiro revisa olhando os comprovantes individuais).
export function reconcileReceiptAnalyses(
  analyses: PaymentReceiptExtraction[],
): PaymentReceiptReconciledAnalysis | null {
  if (!analyses.length) return null;

  return {
    tipo_comprovante: joinDistinct(analyses.map((a) => a.tipo_comprovante)),
    estabelecimento_nome: joinDistinct(
      analyses.map((a) => a.estabelecimento_nome),
    ),
    estabelecimento_cnpj: joinDistinct(
      analyses.map((a) => a.estabelecimento_cnpj),
    ),
    valor_total: sum(analyses.map((a) => a.valor_total)),
    qtd_parcelas: onlyIfSingleContributor(analyses.map((a) => a.qtd_parcelas)),
    valor_parcela: onlyIfSingleContributor(
      analyses.map((a) => a.valor_parcela),
    ),
    data_transacao: firstNonNull(analyses.map((a) => a.data_transacao)),
    hora_transacao: firstNonNull(analyses.map((a) => a.hora_transacao)),
    bandeira_cartao: joinDistinct(analyses.map((a) => a.bandeira_cartao)),
    instituicao_pagamento: joinDistinct(
      analyses.map((a) => a.instituicao_pagamento),
    ),
    titular_cartao: joinDistinct(analyses.map((a) => a.titular_cartao)),
    cartao_final: joinDistinct(analyses.map((a) => a.cartao_final)),
    codigo_autorizacao: joinDistinct(
      analyses.map((a) => a.codigo_autorizacao),
    ),
    nsu_cv: joinDistinct(analyses.map((a) => a.nsu_cv)),
  };
}

// AND lógico ignorando null ("não se aplica" desse comprovante, ex.: PIX) —
// só false se algum comprovante bateu errado na conta, só true se todos os
// que se aplicam bateram, null se nenhum comprovante tem validação aplicável.
export function reconcileReceiptValidation(
  validations: (boolean | null)[],
): boolean | null {
  const known = validations.filter((v): v is boolean => v !== null);
  if (!known.length) return null;
  return known.every(Boolean);
}

function joinDistinct(values: (string | null)[]): string | null {
  const distinct = Array.from(
    new Set(values.filter((v): v is string => v !== null)),
  );
  return distinct.length ? distinct.join(" + ") : null;
}

function sum(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) return null;
  return Math.round(known.reduce((acc, v) => acc + v, 0) * 100) / 100;
}

function onlyIfSingleContributor(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 1 ? known[0] : null;
}

function firstNonNull(values: (string | null)[]): string | null {
  return values.find((v) => v !== null) ?? null;
}

const TOTAL_MATCH_TOLERANCE = 0.01;

// Informativo pro front mostrar aviso — nunca bloqueia nenhuma transição.
// null quando não dá pra comparar (nenhum comprovante com valor ainda, ou
// pedido sem total). Usado por reconcileReceipts (automático) e
// updatePaymentReceiptAnalysis (edição manual do resumo) — os dois momentos
// em que receiptTotal pode mudar.
export function receiptTotalMatchesOrder(
  receiptTotal: number | null,
  orderTotal: number | null,
): boolean | null {
  if (receiptTotal === null || orderTotal === null) return null;
  return Math.abs(receiptTotal - orderTotal) <= TOTAL_MATCH_TOLERANCE;
}
