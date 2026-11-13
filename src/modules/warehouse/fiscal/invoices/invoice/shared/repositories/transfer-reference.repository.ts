import { col, fn, Op, Sequelize, Transaction, WhereOptions } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { invoiceCancelledSql } from "../helpers/custom-filters";
import { notInternalInvoiceWhere } from "../helpers/invoice-operation";
import invoiceAttributesRepository from "./invoice-attributes.repository";
import invoiceOperationRepository from "../../../invoice-operation/invoice-operation.repository";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";
import { InvoiceUnitBusinessAttributesStatus } from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.types";

// Nota de venda alvo do vínculo de transferência (before/after da auditoria + regra de admin).
export interface TransferLinkRow {
  id: string;
  number_system: string;
  transfer_invoice_id: string | null;
  transfer_invoice_reference: string | null;
  finished_at_sender: boolean;
}

// Consultas de nota de transferência / vínculo de transferência (validação 1 venda ↔ 1 transferência). Nota interna nunca conta.
export class TransferReferenceRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  // Números (sem zeros à esquerda) de notas de TRANSFERÊNCIA com esses números (fallback das notas antigas, sem transfer_invoice_id).
  async findExistingTransferNumbers(numbers: string[]): Promise<Set<string>> {
    if (!numbers.length) return new Set();
    const normalizedNumber = fn("LTRIM", col("number_system"), "0");
    const rows = await this.model.findAll({
      attributes: [[normalizedNumber, "normalized_number"]],
      where: {
        [Op.and]: [Sequelize.where(normalizedNumber, { [Op.in]: numbers }), await this.transferBetweenStoresWhere()],
      },
      group: [normalizedNumber],
      raw: true,
    });
    return new Set(rows.map((row) => (row as unknown as { normalized_number: string }).normalized_number));
  }

  // Notas de TRANSFERÊNCIA com esses ids e o número sem zeros à esquerda (pra mensagem e pro "REF: <n>").
  async findTransfersByIds(ids: string[]): Promise<Array<{ id: string; number_system: string; normalized_number: string }>> {
    if (!ids.length) return [];
    const rows = await this.model.findAll({
      attributes: ["id", "number_system", [fn("LTRIM", col("number_system"), "0"), "normalized_number"]],
      where: { [Op.and]: [{ id: { [Op.in]: ids } }, await this.transferBetweenStoresWhere()] },
      raw: true,
    });
    return rows as unknown as Array<{ id: string; number_system: string; normalized_number: string }>;
  }

  // Notas de transferência (emitente = outra loja própria, destinatário = receiverCnpj) por id (vínculo novo) ou número (antigas);
  // usada pelo QR do romaneio CD21 (a transferência pode sair de qualquer loja, não só do CD21).
  async findTransfersToReceiver(
    { ids, numbers }: { ids: string[]; numbers: string[] },
    receiverCnpj: string,
  ): Promise<Array<{ id: string; number_system: string; normalized_number: string }>> {
    if (!ids.length && !numbers.length) return [];
    const [unitBusinessCnpjs, internalOperationId] = await Promise.all([
      invoiceAttributesRepository.findAllUnitBusinessCnpjs(),
      invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER),
    ]);
    const normalizedNumber = fn("LTRIM", col("number_system"), "0");
    const rows = await this.model.findAll({
      attributes: ["id", "number_system", [normalizedNumber, "normalized_number"]],
      where: {
        [Op.and]: [
          {
            [Op.or]: [
              { id: { [Op.in]: ids } },
              Sequelize.where(normalizedNumber, { [Op.in]: numbers }),
            ],
          },
          { sender_cnpj: { [Op.in]: unitBusinessCnpjs, [Op.ne]: receiverCnpj }, receiver_cnpj: receiverCnpj },
          notInternalInvoiceWhere(internalOperationId),
        ],
      },
      raw: true,
    });
    return rows as unknown as Array<{ id: string; number_system: string; normalized_number: string }>;
  }

  // Notas vinculadas (transfer_invoice_id) a uma dessas transferências. Nota de venda cancelada não segura a transferência.
  async findByTransferInvoiceIds(
    ids: string[],
  ): Promise<Array<{ id: string; number_system: string; transfer_invoice_id: string }>> {
    if (!ids.length) return [];
    const internalOperationId = await invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    const rows = await this.model.findAll({
      attributes: ["id", "number_system", "transfer_invoice_id"],
      where: {
        [Op.and]: [
          { transfer_invoice_id: { [Op.in]: ids } },
          Sequelize.literal(`NOT ${invoiceCancelledSql('"Invoice"."id"')}`),
          notInternalInvoiceWhere(internalOperationId),
        ],
      },
      raw: true,
    });
    return rows as unknown as Array<{ id: string; number_system: string; transfer_invoice_id: string }>;
  }

  // Notas cuja transfer_invoice_reference aponta pra um desses números — mesma extração de extractTransferReferenceNumber
  // (1º grupo de dígitos, sem zeros à esquerda). Nota de venda cancelada não segura a transferência: fica de fora.
  async findByTransferReferenceNumbers(
    numbers: string[],
  ): Promise<Array<{ id: string; number_system: string; transfer_number: string }>> {
    if (!numbers.length) return [];
    const internalOperationId = await invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    const transferNumber = fn("LTRIM", fn("SUBSTRING", col("transfer_invoice_reference"), "\\d+"), "0");
    const rows = await this.model.findAll({
      attributes: ["id", "number_system", [transferNumber, "transfer_number"]],
      where: {
        [Op.and]: [
          Sequelize.where(transferNumber, { [Op.in]: numbers }),
          Sequelize.literal(`NOT ${invoiceCancelledSql('"Invoice"."id"')}`),
          notInternalInvoiceWhere(internalOperationId),
        ],
      },
      raw: true,
    });
    return rows as unknown as Array<{ id: string; number_system: string; transfer_number: string }>;
  }

  // Notas de venda alvo do vínculo, com flag de finalizada na loja emitente (exige admin); com transação, travadas (before da auditoria).
  // NO KEY UPDATE (não UPDATE): o lote já segura KEY SHARE na nota (FK de expedition_batch_invoices) e FOR UPDATE esperava por ele pra sempre.
  async findForTransferLink(
    ids: string[],
    transaction?: Transaction,
    lock = true,
  ): Promise<TransferLinkRow[]> {
    if (!ids.length) return [];
    const finished: InvoiceUnitBusinessAttributesStatus = "FINISHED";
    const rows = await this.model.findAll({
      attributes: [
        "id",
        "number_system",
        "transfer_invoice_id",
        "transfer_invoice_reference",
        [
          Sequelize.literal(`EXISTS (
            SELECT 1
            FROM invoice_unit_business_attributes iuba_finished
            JOIN unit_businesses ub_finished ON ub_finished.id = iuba_finished.unit_business_id
            WHERE iuba_finished.invoice_id = "Invoice"."id"
              AND iuba_finished.status = '${finished}'
              AND ub_finished.cnpj = "Invoice"."sender_cnpj"
          )`),
          "finished_at_sender",
        ],
      ],
      where: { id: { [Op.in]: ids } },
      ...(lock && transaction && { lock: transaction.LOCK.NO_KEY_UPDATE }),
      transaction,
      raw: true,
    });
    return rows as unknown as TransferLinkRow[];
  }

  // Grava o vínculo (id + "REF: <n>" pra exibição) nas notas de venda.
  async updateTransferLink(
    ids: string[],
    values: { transfer_invoice_id: string | null; transfer_invoice_reference: string | null },
    transaction: Transaction,
  ): Promise<void> {
    await this.model.update(values, { where: { id: { [Op.in]: ids } }, transaction });
  }

  // TRANSFERÊNCIA = emitente e destinatário lojas próprias e diferentes, fora da nota interna — mesma definição de
  // listTransferInvoices; real ou provisória (createStub do PDV já grava os dois CNPJs).
  private async transferBetweenStoresWhere(): Promise<WhereOptions> {
    const [unitBusinessCnpjs, internalOperationId] = await Promise.all([
      invoiceAttributesRepository.findAllUnitBusinessCnpjs(),
      invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER),
    ]);
    return {
      [Op.and]: [
        { sender_cnpj: { [Op.in]: unitBusinessCnpjs } },
        { receiver_cnpj: { [Op.in]: unitBusinessCnpjs } },
        Sequelize.where(col("sender_cnpj"), Op.ne, col("receiver_cnpj")),
        notInternalInvoiceWhere(internalOperationId),
      ],
    };
  }
}

export default new TransferReferenceRepository();
