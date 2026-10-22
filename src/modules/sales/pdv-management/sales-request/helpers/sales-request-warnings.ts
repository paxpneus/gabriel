import { PdvWarning, PdvWarningCode } from "../pdv-sales-request.types";

// Colunas persistidas da conciliação de comprovantes + flags ao vivo de
// helpers/transfer-invoice-divergence.ts (vêm do SQL como boolean).
export interface PdvWarningSource {
  payment_receipt_validated?: boolean | null;
  payment_method_matches_receipt?: boolean | null;
  receipt_total_matches_order?: boolean | null;
  receipt_total_difference?: number | string | null;
  transfer_quantity_mismatch?: boolean | null;
  transfer_products_mismatch?: boolean | null;
  transfer_products_unchecked?: boolean | null;
  transfer_sender_unit_business_mismatch?: boolean | null;
}

const TRANSFER_QUANTITY_MISMATCH_WARNING: PdvWarning = {
  code: PdvWarningCode.TRANSFER_QUANTITY_MISMATCH,
  label: "Quantidade da NF de transferência diverge da NF de venda",
  color: "red",
};

const TRANSFER_PRODUCTS_MISMATCH_WARNING: PdvWarning = {
  code: PdvWarningCode.TRANSFER_PRODUCTS_MISMATCH,
  label: "Produtos da NF de transferência divergem da NF de venda",
  color: "red",
};

const TRANSFER_SENDER_UNIT_BUSINESS_MISMATCH_WARNING: PdvWarning = {
  code: PdvWarningCode.TRANSFER_SENDER_UNIT_BUSINESS_MISMATCH,
  label: "Loja emitente da NF de transferência difere da loja do pedido",
  color: "red",
};

function formatBrl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Diferença em valor (red) substitui o aviso genérico de soma (yellow) — nunca os dois.
function receiptTotalWarning(source: PdvWarningSource): PdvWarning | null {
  if (source.receipt_total_matches_order !== false) return null;

  const difference = Number(source.receipt_total_difference ?? 0);
  if (difference !== 0) {
    return {
      code: PdvWarningCode.RECEIPT_TOTAL_DIFFERENCE,
      label: `Comprovantes ${formatBrl(Math.abs(difference))} ${
        difference < 0 ? "abaixo" : "acima"
      } do valor do pedido`,
      color: "red",
    };
  }
  return {
    code: PdvWarningCode.RECEIPT_TOTAL_MISMATCH,
    label: "Soma dos comprovantes não bate com o valor do pedido",
    color: "yellow",
  };
}

// Críticos primeiro, depois atenção, depois informação.
export function buildSalesRequestWarnings(source: PdvWarningSource): PdvWarning[] {
  const warnings: (PdvWarning | null)[] = [
    ...buildCriticalWarnings(source),
    receiptTotalWarning(source),
    source.transfer_products_unchecked
      ? {
          code: PdvWarningCode.TRANSFER_PRODUCTS_UNCHECKED,
          label: "Nota(s) com produto não mapeado, impossível verificar nota de venda x transferência",
          color: "yellow",
        }
      : null,
    source.payment_receipt_validated === false
      ? {
          code: PdvWarningCode.RECEIPT_INSTALLMENTS_MISMATCH,
          label: "Parcelas × valor da parcela não bate com o valor de algum comprovante",
          color: "yellow",
        }
      : null,
    source.payment_method_matches_receipt === false
      ? {
          code: PdvWarningCode.PAYMENT_METHOD_MISMATCH,
          label: "Forma de pagamento do pedido pode divergir do comprovante",
          color: "yellow",
        }
      : null,
  ];

  return warnings.filter((warning): warning is PdvWarning => warning !== null);
}

// Card do quadro e critical_warnings: quantidade/produto divergente entre NF de venda e transferência,
// ou transferência emitida por outra loja que não a do pedido.
export function buildCriticalWarnings(source: PdvWarningSource): PdvWarning[] {
  const warnings: (PdvWarning | null)[] = [
    source.transfer_quantity_mismatch ? TRANSFER_QUANTITY_MISMATCH_WARNING : null,
    source.transfer_products_mismatch ? TRANSFER_PRODUCTS_MISMATCH_WARNING : null,
    source.transfer_sender_unit_business_mismatch
      ? TRANSFER_SENDER_UNIT_BUSINESS_MISMATCH_WARNING
      : null,
  ];
  return warnings.filter((warning): warning is PdvWarning => warning !== null);
}
