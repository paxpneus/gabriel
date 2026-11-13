import { Op, Sequelize, Transaction } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { FullInvoice } from "../../invoice.types";
import InvoiceUnitBusinessAttributes from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import UnitBusiness from "../../../../../../company/unit-business/unit-business.model";

// Leitura da nota por unit business e anexo de observação, usados pelas operações de ciclo de vida.
export class InvoiceLifecycleRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  async getInvoice(
    invoiceId: string,
    unitBusinessId: string,
  ): Promise<FullInvoice> {
    const data = await this.findById(invoiceId, {
      attributes: { exclude: ["xml_path", "source_payload"] },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: { unit_business_id: unitBusinessId },
          required: false,
          attributes: ["status", "type", "batch_generated", "unit_business_id"],
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
            },
          ],
        },
      ],
    });

    if (!data) throw new Error(`Nota não encontrada`);

    const plain = data.get({ plain: true }) as any;

    return {
      ...plain,
      unitBusinessAttributes: plain.unitBusinessAttributes?.[0] ?? null,
    } as FullInvoice;
  }

  // Acrescenta texto em observation numa linha nova, sem sobrescrever o que já existe (concatena no próprio UPDATE).
  async appendObservation(
    invoiceIds: string[],
    text: string,
    transaction?: Transaction,
  ): Promise<void> {
    const escaped = Invoice.sequelize!.escape(text);
    await Invoice.update(
      {
        observation: Sequelize.literal(
          `CASE WHEN observation IS NULL OR observation = '' THEN ${escaped} ELSE observation || E'\\n' || ${escaped} END`,
        ),
      },
      { where: { id: { [Op.in]: invoiceIds } }, transaction },
    );
  }
}

export default new InvoiceLifecycleRepository();
