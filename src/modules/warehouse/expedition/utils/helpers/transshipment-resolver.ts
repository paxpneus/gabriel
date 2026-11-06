import { Op, Transaction, WhereOptions } from "sequelize";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";
import invoiceRepository from "../../../fiscal/invoices/invoice/invoice.repository";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";

export type BatchType = "INCOMING" | "OUTGOING";

// Loja do lote não é emissora nem destinatária da nota: a nota só passa por ela (transbordo).
export function isTransshipmentInvoice(
  invoice: { sender_cnpj?: string | null; receiver_cnpj?: string | null },
  unitBusinessCnpj: string,
): boolean {
  const unitCnpj = cleanDocument(unitBusinessCnpj);
  return (
    cleanDocument(invoice.sender_cnpj ?? "") !== unitCnpj &&
    cleanDocument(invoice.receiver_cnpj ?? "") !== unitCnpj
  );
}

// Linha de atributo que o lote usa: no transbordo a do type do lote (a loja tem entrada e expedição); fora dele, a única da loja.
export function pickBatchAttribute<T extends { type?: string }>(
  rows: T[] | null | undefined,
  type: string | undefined,
  isTransshipment: boolean,
): T | null {
  if (!rows?.length) return null;
  if (!isTransshipment) return rows[0];
  return rows.find((row) => row.type === type) ?? null;
}

// attrWhere das escritas do lote: nota de transbordo só mexe na linha do type do lote; as demais seguem sem filtro (linha única).
export function batchAttributeWhere(
  type: string,
  transshipmentInvoiceIds: string[],
): WhereOptions | undefined {
  if (!transshipmentInvoiceIds.length) return undefined;
  return {
    [Op.or]: [
      { type },
      { invoice_id: { [Op.notIn]: transshipmentInvoiceIds } },
    ],
  };
}

// Valida se a loja pode ter a nota no lote e devolve se ela entra como transbordo; garante a linha de atributo que o lote usa.
export async function assertTransshipment(
  invoice: {
    id: string;
    number_system?: string | null;
    sender_cnpj: string | null;
    receiver_cnpj: string | null;
  },
  unitBusiness: {
    id?: string;
    cnpj: string;
    transshipment_allowed?: boolean;
  } | null,
  type: BatchType,
  transaction?: Transaction,
): Promise<boolean> {
  if (!unitBusiness) return false;

  if (!invoice.sender_cnpj || !invoice.receiver_cnpj) {
    throw new Error(
      "Cnpj emitente ou destinatário não encontrados pela nota fiscal!",
    );
  }

  const isTransshipment = isTransshipmentInvoice(invoice, unitBusiness.cnpj);

  if (!unitBusiness.transshipment_allowed && isTransshipment) {
    throw new Error(
      "Leitura bloqueada: nota fiscal não pertence à sua unidade de negócio",
    );
  }

  let unitBusinessId = unitBusiness.id;
  if (!unitBusinessId) {
    const foundUnit = await unitBusinessService.findOne({
      where: { cnpj: unitBusiness.cnpj },
      attributes: ["id"],
    });
    unitBusinessId = foundUnit!.id;
  }

  // Transbordo: expedição só depois da entrada da nota finalizada nesta loja.
  if (isTransshipment && type === "OUTGOING") {
    const incoming = await invoiceRepository.findInvoiceAttribute(
      invoice.id,
      unitBusinessId,
      "INCOMING",
      transaction,
    );
    if (incoming?.status !== "FINISHED") {
      throw new Error(
        `Nota ${invoice.number_system ?? invoice.id} ainda não foi recebida nesta loja. Finalize o lote de entrada antes de gerar o de expedição.`,
      );
    }
  }

  // Emissora/destinatária: vale a linha da ingestão, de qualquer type; transbordo: uma linha por type de lote.
  const existing = await invoiceRepository.findInvoiceAttribute(
    invoice.id,
    unitBusinessId,
    isTransshipment ? type : undefined,
    transaction,
  );
  if (existing) return isTransshipment;

  await invoiceRepository.createInvoiceAttributes(
    [
      {
        invoice_id: invoice.id,
        unit_business_id: unitBusinessId,
        type: isTransshipment ? type : "INCOMING",
        status: "OPEN",
        batch_generated: false,
      },
    ],
    transaction,
  );
  return isTransshipment;
}
