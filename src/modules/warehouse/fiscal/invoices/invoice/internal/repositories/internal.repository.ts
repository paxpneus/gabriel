import { Op } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { InvoiceAttributes } from "../../invoice.types";
import InvoiceUnitBusinessAttributes from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import UnitBusiness from "../../../../../../company/unit-business/unit-business.model";

// Lado da filial na listagem Tecinco: S = filial emitente, E = filial destinatária.
export type InternalInvoiceBranchSide = "E" | "S";

// Consultas da nota interna (série B, sem chave): upsert por id_system e dedup do sync Tecinco por número.
export class InternalInvoiceRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  // Nota interna já gravada (id_system canônico, ver helpers/internal-invoice-id.ts).
  async findIdByIdSystem(idSystem: string): Promise<Pick<InvoiceAttributes, "id"> | null> {
    return this.model.findOne({ where: { id_system: idSystem }, attributes: ["id"], raw: true });
  }

  // Números de nota interna já gravados com a filial no lado da listagem (S → emitente, E → destinatária).
  async findExistingInternalNumbers(
    operationId: string,
    side: InternalInvoiceBranchSide,
    branchCnpj: string,
    numbers: string[],
  ): Promise<string[]> {
    if (!numbers.length) return [];
    const branchColumn = side === "S" ? "sender_cnpj" : "receiver_cnpj";
    const rows = (await this.model.findAll({
      where: {
        invoice_operation_id: operationId,
        [branchColumn]: branchCnpj,
        number_system: { [Op.in]: numbers },
      },
      attributes: ["number_system"],
      raw: true,
    })) as unknown as Pick<InvoiceAttributes, "number_system">[];
    return rows.map((row) => row.number_system).filter((n): n is string => !!n);
  }

  // Dos números acima, os que ainda não estão CANCELLED em alguma das unit businesses (por number) — mesmo critério de findXmlKeysNotCancelledInUnitBusinesses.
  async findInternalNumbersNotCancelledInUnitBusinesses(
    operationId: string,
    side: InternalInvoiceBranchSide,
    branchCnpj: string,
    numbers: string[],
    unitBusinessNumbers: string[],
  ): Promise<string[]> {
    if (!numbers.length) return [];
    const branchColumn = side === "S" ? "sender_cnpj" : "receiver_cnpj";
    const rows = (await this.model.findAll({
      where: {
        invoice_operation_id: operationId,
        [branchColumn]: branchCnpj,
        number_system: { [Op.in]: numbers },
      },
      attributes: ["number_system"],
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          attributes: [],
          where: { status: { [Op.ne]: "CANCELLED" } },
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
              required: true,
              attributes: [],
              where: { number: { [Op.in]: unitBusinessNumbers } },
            },
          ],
        },
      ],
      raw: true,
    })) as unknown as Pick<InvoiceAttributes, "number_system">[];
    return [...new Set(rows.map((row) => row.number_system).filter((n): n is string => !!n))];
  }
}

export default new InternalInvoiceRepository();
