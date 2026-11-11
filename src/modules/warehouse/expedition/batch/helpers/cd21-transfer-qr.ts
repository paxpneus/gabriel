import invoiceService from "../../../fiscal/invoices/invoice/invoice.service";
import { extractTransferReferenceNumber } from "../../../fiscal/invoices/invoice/helpers/transfer-reference";
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../../company/unit-business/helpers/cd21-unit-business-number";
import {
  ADT_TRANSPORTER_CDS,
  extractTransporterCd,
} from "../../../../sales/pdv-management/sales-request/helpers/transporter-cd";
import transporterService from "../../../transporter/transporter.service";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";

interface SaleInvoice {
  id: string;
  number_system?: string | null;
  sender_cnpj?: string | null;
  transfer_invoice_reference?: string | null;
  transporter_name?: string | null;
}

// Regra do QR do CD21: romaneio de nota emitida pelo CD21 lida por loja 12/17 gera o lote das notas de transferência.
// Vale só se a loja é 12/17 e toda nota é do CD21 com logística própria (CD 12/17) ou sem transportadora.
export function isCd21TransferQrRule(
  sourceUnit: { number: string; cnpj: string },
  readerUnitNumber: string,
  invoices: SaleInvoice[],
): boolean {
  if (sourceUnit.number !== CD21_UNIT_BUSINESS_NUMBER || !ADT_TRANSPORTER_CDS.includes(readerUnitNumber)) return false;
  return invoices.every((invoice) => {
    if (cleanDocument(invoice.sender_cnpj ?? "") !== cleanDocument(sourceUnit.cnpj)) return false;
    // Sem transportador = vazio ou o placeholder "Sem transporte" gravado pelo import da nota.
    if (transporterService.isNoTransporterName(invoice.transporter_name)) return true;
    const transporterCd = extractTransporterCd(invoice.transporter_name);
    return !!transporterCd && ADT_TRANSPORTER_CDS.includes(transporterCd);
  });
}

// Ids das notas de transferência (de outra loja → loja que leu) apontadas por "REF: <número>" em cada nota de venda.
export async function resolveCd21TransferInvoiceIds(
  invoices: SaleInvoice[],
  readerCnpj: string,
): Promise<string[]> {
  const referenced = invoices.map((invoice) => ({
    invoice,
    transferNumber: extractTransferReferenceNumber(invoice.transfer_invoice_reference),
  }));
  const withoutReference = referenced.filter((ref) => !ref.transferNumber);
  if (withoutReference.length) {
    throw new Error(
      `Nota(s) de venda sem número da nota de transferência: ${withoutReference.map((ref) => ref.invoice.number_system).join(", ")}.`,
    );
  }

  const numbers = [...new Set(referenced.map((ref) => ref.transferNumber as string))];
  const transfers = await invoiceService.findTransfersToReceiverByNumbers(numbers, readerCnpj);
  const foundNumbers = new Set(transfers.map((transfer) => transfer.normalized_number));
  const notFound = referenced.filter((ref) => !foundNumbers.has(ref.transferNumber as string));
  if (notFound.length) {
    throw new Error(
      `Nota(s) de transferência para esta loja não encontradas no sistema: ${notFound.map((ref) => `${ref.transferNumber} (ref. a nota de venda ${ref.invoice.number_system})`).join(", ")}.`,
    );
  }
  return [...new Set(transfers.map((transfer) => transfer.id))];
}
