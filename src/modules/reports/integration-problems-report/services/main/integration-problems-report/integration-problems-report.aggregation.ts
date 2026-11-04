import {
  SalesReturnLineRow,
  ReturnInvoiceCandidateRow,
} from "../../../../sales-return-report/models/sales-return-report.types";
import {
  CommissionInvoiceRow,
  InvoiceWithoutMovementRow,
  SellerCommissionWarningReason,
} from "../../../../seller-commission-report/models/seller-commission-report.types";
import { exclusionReason } from "../../../../seller-commission-report/services/main/seller-commission-report/seller-commission-report.aggregation";
import {
  IntegrationProblemRow,
  IntegrationProblemsReport,
  IntegrationProblemType,
} from "../../../models/integration-problems-report.types";

// Ordem das linhas e texto pro leigo de cada problema.
export const PROBLEM_DESCRIPTIONS: Record<IntegrationProblemType, string> = {
  sale_movement_without_invoice: "Saída no estoque com nota que não existe no sistema",
  sale_invoice_without_movement: "Nota de venda sem saída no estoque",
  cancelled_invoice_return_without_movement: "Nota cancelada com devolução no sistema, mas sem entrada da devolução no estoque",
  cancelled_invoice_without_return: "Nota cancelada sem devolução e com a saída ainda ativa no estoque",
  sale_invoice_without_order: "Nota de venda sem pedido no sistema",
  return_movement_without_invoice: "Devolução no estoque com nota que não existe no sistema",
  return_invoice_without_movement: "Nota de devolução sem entrada no estoque",
};

// Motivos do relatório de comissão que são problema de nota/Kardex; os de pedido (vendedor, custo, situação) ficam lá.
const SALE_REASON_TO_PROBLEM: Partial<Record<SellerCommissionWarningReason, IntegrationProblemType>> = {
  movements_without_invoice: "sale_movement_without_invoice",
  cancelled_invoices_return_without_movement: "cancelled_invoice_return_without_movement",
  cancelled_invoices_without_return: "cancelled_invoice_without_return",
  invoices_without_order: "sale_invoice_without_order",
};

const problemRow = (
  problem: IntegrationProblemType,
  fields: Omit<IntegrationProblemRow, "problem" | "description">,
): IntegrationProblemRow => ({ problem, description: PROBLEM_DESCRIPTIONS[problem], ...fields });

/** Problemas das saídas: notas dos movimentos (mesma cadeia do relatório de comissão) + notas de venda sem movimento. */
export function saleProblems(
  invoices: CommissionInvoiceRow[],
  withoutMovement: InvoiceWithoutMovementRow[],
): IntegrationProblemRow[] {
  const rows: IntegrationProblemRow[] = [];
  for (const invoice of invoices) {
    // Cancelada e devolvida: a saída já foi estornada no Kardex, não é problema.
    if (invoice.invoice_cancelled && invoice.has_return) continue;
    const reason = exclusionReason(invoice);
    const problem = reason ? SALE_REASON_TO_PROBLEM[reason] : undefined;
    if (!problem) continue;
    rows.push(problemRow(problem, {
      invoice_number: invoice.invoice_number,
      date: invoice.movement_date,
      order_number: invoice.order_number,
      return_invoice_number: invoice.return_invoice_number,
    }));
  }
  for (const invoice of withoutMovement) {
    rows.push(problemRow("sale_invoice_without_movement", {
      invoice_number: invoice.invoice_number,
      date: invoice.emitted_date,
      order_number: invoice.order_number,
      return_invoice_number: null,
    }));
  }
  return rows;
}

/** Problemas das devoluções: uma linha por nota dos movimentos sem nota no sistema + NF de devolução sem movimento. */
export function returnProblems(
  lines: SalesReturnLineRow[],
  withoutMovement: ReturnInvoiceCandidateRow[],
): IntegrationProblemRow[] {
  const byInvoice = new Map<string, IntegrationProblemRow>();
  for (const line of lines) {
    if (line.return_invoice_id) continue;
    const key = line.return_invoice_number ?? `movement:${line.movement_id}`;
    if (byInvoice.has(key)) continue;
    byInvoice.set(key, problemRow("return_movement_without_invoice", {
      invoice_number: line.return_invoice_number,
      date: line.return_date,
      order_number: null,
      return_invoice_number: null,
    }));
  }

  const rows = [...byInvoice.values()];
  for (const invoice of withoutMovement) {
    rows.push(problemRow("return_invoice_without_movement", {
      invoice_number: invoice.invoice_number,
      date: invoice.emitted_date,
      order_number: null,
      return_invoice_number: null,
    }));
  }
  return rows;
}

/** Linhas na ordem dos problemas e por data; resumo com a contagem de cada problema e o total. */
export function buildReport(rows: IntegrationProblemRow[]): Pick<IntegrationProblemsReport, "rows" | "summary"> {
  const order = Object.keys(PROBLEM_DESCRIPTIONS) as IntegrationProblemType[];
  const sorted = [...rows].sort(
    (a, b) =>
      order.indexOf(a.problem) - order.indexOf(b.problem) ||
      (a.date ?? "").localeCompare(b.date ?? "") ||
      (a.invoice_number ?? "").localeCompare(b.invoice_number ?? ""),
  );

  const summary = Object.fromEntries(order.map((problem) => [problem, 0])) as IntegrationProblemsReport["summary"];
  for (const row of rows) summary[row.problem] += 1;
  summary.total = rows.length;

  return { rows: sorted, summary };
}
