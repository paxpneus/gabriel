import { MLExcelRow } from "../mercado-livre.types";

// Mesma data (dia UTC) + nome do cliente contendo o "buyer" do Excel do ML
// — critério usado tanto pra achar o pedido que uma linha da planilha
// corresponde (MLOrderSyncQueue.syncFromExcel) quanto pra decidir, antes
// de baixar/enfileirar, se uma linha pode interessar a algum pedido ainda
// pendente de collection_date (MLScrapingQueue.process). Mantido num só
// lugar pra não divergir entre os dois usos.
export function matchesOrderByDateAndBuyer(
  orderDate: Date | string | null | undefined,
  customerName: string | null | undefined,
  row: Pick<MLExcelRow, "sale_date" | "buyer">,
): boolean {
  if (!orderDate) return false;

  const parsedOrderDate = new Date(orderDate);
  const saleDate = new Date(row.sale_date);
  const sameDay =
    parsedOrderDate.getUTCFullYear() === saleDate.getUTCFullYear() &&
    parsedOrderDate.getUTCMonth() === saleDate.getUTCMonth() &&
    parsedOrderDate.getUTCDate() === saleDate.getUTCDate();

  const nameMatch = customerName
    ?.toLowerCase()
    .includes(row.buyer.toLowerCase());

  return sameDay && !!nameMatch;
}
