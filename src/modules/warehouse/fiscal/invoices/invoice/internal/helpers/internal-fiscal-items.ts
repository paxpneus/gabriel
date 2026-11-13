import type { TCarNotaFiscalItem } from "../../../../../../handlers/tecinco/service/tecinco/tecinco.types";
import type { InvoiceOperationalItemFromXml } from "../../../../../../../shared/utils/xml/invoice-xml";
import { ItemWithFiscal } from "../../invoice.types";

// Itens da nota interna (sem XML): produto já resolvido pelo ensureProductsFromInvoiceItems + item fiscal do detalhe Tecinco (mesmo epeit_seq).
export function buildInternalInvoiceItems(
  operationalItems: InvoiceOperationalItemFromXml[],
  detailItems: TCarNotaFiscalItem[],
): ItemWithFiscal[] {
  const detailBySeq = new Map(detailItems.map((item) => [Number(item.epeit_seq), item]));

  return operationalItems.map((item) => {
    const detail = detailBySeq.get(Number(item.item_number));
    return {
      product_id: item.product_id,
      quantity_expected: Math.trunc(Number(item.quantity_expected ?? 0)),
      fiscal: {
        product_id: item.product_id,
        item_number: item.item_number,
        sku: item.sku ?? null,
        gtin: item.gtin ?? null,
        description: item.description ?? null,
        quantity: Number(detail?.epeit_qtdade ?? item.quantity_expected ?? 0),
        unit_price: Number(detail?.epeit_vlrunit ?? item.unit_price ?? 0),
        total_value: Number(detail?.epeit_vlrliquido ?? item.total_value ?? 0),
        icms_rate: Number(detail?.epeit_percicm ?? 0),
        icms_value: Number(detail?.epeit_vlricm ?? 0),
      },
    };
  });
}
