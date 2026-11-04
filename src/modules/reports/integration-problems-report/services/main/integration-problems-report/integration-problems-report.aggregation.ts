import {
  SalesReturnLineRow,
  ReturnInvoiceCandidateRow,
} from "../../../../sales-return-report/models/sales-return-report.types";
import {
  IntegrationProblemRow,
  IntegrationProblemsReport,
  IntegrationProblemType,
  SaleInvoiceWithoutMovementRow,
  SaleMovementInvoiceRow,
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

/** Problema da nota de um movimento de saída, na ordem da cadeia movimento → nota → pedido; null = sem problema. */
export function saleInvoiceProblem(row: SaleMovementInvoiceRow): IntegrationProblemType | null {
  if (!row.invoice_id && !row.is_order_adjustment) return "sale_movement_without_invoice";
  if (row.invoice_cancelled && row.has_return_invoice) return "cancelled_invoice_return_without_movement";
  if (row.invoice_cancelled) return "cancelled_invoice_without_return";
  if (!row.order_id) return "sale_invoice_without_order";
  return null;
}

const problemRow = (
  problem: IntegrationProblemType,
  fields: Omit<IntegrationProblemRow, "problem" | "description">,
): IntegrationProblemRow => ({ problem, description: PROBLEM_DESCRIPTIONS[problem], ...fields });

/** Problemas das saídas: notas dos movimentos de saída do CD21 + notas de venda sem movimento. */
export function saleProblems(
  invoices: SaleMovementInvoiceRow[],
  withoutMovement: SaleInvoiceWithoutMovementRow[],
): IntegrationProblemRow[] {
  const rows: IntegrationProblemRow[] = [];
  for (const invoice of invoices) {
    // Cancelada e devolvida: a saída já foi estornada no Kardex, não é problema.
    if (invoice.invoice_cancelled && invoice.has_return) continue;
    const problem = saleInvoiceProblem(invoice);
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
