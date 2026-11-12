import { Op, Sequelize, Transaction, WhereOptions } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { InvoiceAttributes } from "../../invoice.types";
import InvoiceUnitBusinessAttributes from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import { InvoiceUnitBusinessAttributesStatus } from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import UnitBusiness from "../../../../../../company/unit-business/unit-business.model";

// Escrita de nota + attributes por unit business e consulta de CNPJs das lojas, usadas por vários domínios.
export class InvoiceAttributesRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  async updateWithAttributes(
    invoiceIds: string[],
    unitBusinessId: string,
    data: Partial<
      InvoiceAttributes & {
        status: InvoiceUnitBusinessAttributesStatus;
        batch_generated: boolean;
        danfe_printed: boolean;
      }
    >,
    attrWhere?: WhereOptions,
    transaction?: Transaction,
  ): Promise<void> {
    const { status, batch_generated, danfe_printed, ...invoiceData } = data;

    await Promise.all([
      Object.keys(invoiceData).length > 0
        ? Invoice.update(invoiceData, {
            where: { id: { [Op.in]: invoiceIds } },
            transaction,
          })
        : Promise.resolve(),

      status !== undefined ||
      batch_generated !== undefined ||
      danfe_printed !== undefined
        ? InvoiceUnitBusinessAttributes.update(
            {
              ...(status !== undefined ? { status } : {}),
              ...(batch_generated !== undefined ? { batch_generated } : {}),
              ...(danfe_printed !== undefined ? { danfe_printed } : {}),
            },
            {
              where: {
                invoice_id: { [Op.in]: invoiceIds },
                unit_business_id: unitBusinessId,
                ...attrWhere,
              },
              transaction,
            },
          )
        : Promise.resolve(),
    ]);
  }

  async updateWithAttributesForAllUnits(
    invoiceIds: string[],
    data: Partial<
      InvoiceAttributes & { status: string; batch_generated: boolean }
    >,
    attrWhere?: WhereOptions,
    transaction?: Transaction,
  ): Promise<void> {
    const { status, batch_generated, ...invoiceData } = data;

    await Promise.all([
      Object.keys(invoiceData).length > 0
        ? Invoice.update(invoiceData, {
            where: { id: { [Op.in]: invoiceIds } },
            transaction,
          })
        : Promise.resolve(),

      status !== undefined || batch_generated !== undefined
        ? InvoiceUnitBusinessAttributes.update(
            {
              ...(status !== undefined ? { status: status as any } : {}),
              ...(batch_generated !== undefined ? { batch_generated } : {}),
            },
            {
              where: {
                invoice_id: { [Op.in]: invoiceIds },
                ...attrWhere,
              },
              transaction,
            },
          )
        : Promise.resolve(),
    ]);
  }

  // Notas fiscais "de transferência" — remetente E destinatário são ambos
  // unit_businesses próprias (não um cliente/fornecedor externo). Resolve
  // isso comparando `sender_cnpj`/`receiver_cnpj` contra o conjunto de CNPJs
  // cadastrados em `unit_businesses`, não por um flag/tipo próprio na nota.
  // `unitBusinessId` é opcional (quem chama decide se filtra por uma loja
  // específica) — ausente, lista transferências de todas as unit businesses.
  async findAllUnitBusinessCnpjs(): Promise<string[]> {
    const rows = await UnitBusiness.findAll({
      attributes: ["cnpj"],
      where: { cnpj: { [Op.ne]: null } } as WhereOptions,
      raw: true,
    });
    return rows.map((r) => (r as any).cnpj).filter((cnpj): cnpj is string => !!cnpj);
  }

  // Mapa CNPJ → nome da loja (ex.: "Loja 01 - Assis"), numa query só, pras colunas de loja das listagens de transferência/interna.
  async findUnitBusinessNamesByCnpj(): Promise<Map<string, string>> {
    const rows = (await UnitBusiness.findAll({
      attributes: ["cnpj", "name"],
      where: { cnpj: { [Op.ne]: null } } as WhereOptions,
      raw: true,
    })) as unknown as { cnpj: string; name: string }[];
    return new Map(rows.map((r) => [r.cnpj, r.name]));
  }

  // CNPJ da loja pelo id (null se não cadastrado); escopa a listagem de nota interna pela loja do usuário.
  async findUnitBusinessCnpjById(unitBusinessId: string): Promise<string | null> {
    const row = await UnitBusiness.findByPk(unitBusinessId, { attributes: ["cnpj"], raw: true });
    return (row as { cnpj?: string | null } | null)?.cnpj ?? null;
  }

  async findUnitBusinessesByCnpj(
    cnpjs: string[],
    transaction?: Transaction,
  ): Promise<{ id: string; cnpj: string }[]> {
    const results = await UnitBusiness.findAll({
      where: { cnpj: { [Op.in]: cnpjs } },
      attributes: ["id", "cnpj"],
      transaction,
    });
    return results.map((ub) => ({ id: ub.id, cnpj: (ub as any).cnpj }));
  }
}

export default new InvoiceAttributesRepository();
