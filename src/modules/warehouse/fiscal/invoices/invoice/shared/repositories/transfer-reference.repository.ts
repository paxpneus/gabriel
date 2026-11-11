import { col, fn, Op, Sequelize } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { invoiceCancelledSql } from "../helpers/custom-filters";
import invoiceAttributesRepository from "./invoice-attributes.repository";

// Consultas de nota de transferência / referência de transferência (validação 1 venda ↔ 1 transferência).
export class TransferReferenceRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  // Números (sem zeros à esquerda) de notas de TRANSFERÊNCIA — emitente e destinatário lojas próprias e diferentes, mesma
  // definição de listTransferInvoices; real ou provisória (createStub do PDV já grava os dois CNPJs).
  async findExistingTransferNumbers(numbers: string[]): Promise<Set<string>> {
    if (!numbers.length) return new Set();
    const unitBusinessCnpjs = await invoiceAttributesRepository.findAllUnitBusinessCnpjs();
    const normalizedNumber = fn("LTRIM", col("number_system"), "0");
    const rows = await this.model.findAll({
      attributes: [[normalizedNumber, "normalized_number"]],
      where: {
        [Op.and]: [
          Sequelize.where(normalizedNumber, { [Op.in]: numbers }),
          { sender_cnpj: { [Op.in]: unitBusinessCnpjs } },
          { receiver_cnpj: { [Op.in]: unitBusinessCnpjs } },
          Sequelize.where(col("sender_cnpj"), Op.ne, col("receiver_cnpj")),
        ],
      },
      group: [normalizedNumber],
      raw: true,
    });
    return new Set(rows.map((row) => (row as unknown as { normalized_number: string }).normalized_number));
  }

  // Notas de transferência (emitente = outra loja própria, destinatário = receiverCnpj) com esses números, sem zeros à esquerda;
  // usada pelo QR do romaneio CD21 (a transferência pode sair de qualquer loja, não só do CD21).
  async findTransfersToReceiverByNumbers(
    numbers: string[],
    receiverCnpj: string,
  ): Promise<Array<{ id: string; number_system: string; normalized_number: string }>> {
    if (!numbers.length) return [];
    const unitBusinessCnpjs = await invoiceAttributesRepository.findAllUnitBusinessCnpjs();
    const normalizedNumber = fn("LTRIM", col("number_system"), "0");
    const rows = await this.model.findAll({
      attributes: ["id", "number_system", [normalizedNumber, "normalized_number"]],
      where: {
        [Op.and]: [
          Sequelize.where(normalizedNumber, { [Op.in]: numbers }),
          { sender_cnpj: { [Op.in]: unitBusinessCnpjs, [Op.ne]: receiverCnpj }, receiver_cnpj: receiverCnpj },
        ],
      },
      raw: true,
    });
    return rows as unknown as Array<{ id: string; number_system: string; normalized_number: string }>;
  }

  // Notas cuja transfer_invoice_reference aponta pra um desses números — mesma extração de extractTransferReferenceNumber
  // (1º grupo de dígitos, sem zeros à esquerda). Nota de venda cancelada não segura a transferência: fica de fora.
  async findByTransferReferenceNumbers(
    numbers: string[],
  ): Promise<Array<{ id: string; number_system: string; transfer_number: string }>> {
    if (!numbers.length) return [];
    const transferNumber = fn("LTRIM", fn("SUBSTRING", col("transfer_invoice_reference"), "\\d+"), "0");
    const rows = await this.model.findAll({
      attributes: ["id", "number_system", [transferNumber, "transfer_number"]],
      where: {
        [Op.and]: [
          Sequelize.where(transferNumber, { [Op.in]: numbers }),
          Sequelize.literal(`NOT ${invoiceCancelledSql('"Invoice"."id"')}`),
        ],
      },
      raw: true,
    });
    return rows as unknown as Array<{ id: string; number_system: string; transfer_number: string }>;
  }
}

export default new TransferReferenceRepository();
