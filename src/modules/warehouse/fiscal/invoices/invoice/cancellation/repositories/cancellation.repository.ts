import { Op, WhereOptions } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { InvoiceAttributes } from "../../invoice.types";
import { InvoiceCancellationTarget } from "../types/cancellation.types";
import InvoiceUnitBusinessAttributes from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import UnitBusiness from "../../../../../../company/unit-business/unit-business.model";
import Order from "../../../../../../sales/orders/order/orders.model";
import expeditionBatchInvoiceRepository from "../../../../../expedition/batch-invoices/batch-invoices.repository";
import { pendingCancellationWhere } from "../../shared";

// Consultas de cancelamento de nota (alvo, vínculos em lote aberto, pendências e xml_keys não canceladas).
export class InvoiceCancellationRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  // Nota de saída referenciada pelo refNFe de uma devolução.
  async findOutgoingByXmlKey(
    xmlKey: string,
  ): Promise<InvoiceCancellationTarget | null> {
    return this.findCancellationTarget({ xml_key: xmlKey }, { type: "OUTGOING" });
  }

  async findCancellationTargetById(
    invoiceId: string,
  ): Promise<InvoiceCancellationTarget | null> {
    return this.findCancellationTarget({ id: invoiceId });
  }

  // Status de cada unit business + vínculos em lote aberto (todos: a nota pode estar em lotes de várias lojas/tipos).
  private async findCancellationTarget(
    where: WhereOptions,
    attrWhere?: WhereOptions,
  ): Promise<InvoiceCancellationTarget | null> {
    const data = await this.findOne({
      where,
      attributes: ["id", "number_system", "return_invoice_reference"],
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          ...(attrWhere && { where: attrWhere }),
          attributes: ["status"],
        },
      ],
    });
    if (!data) return null;

    const plain = data.get({ plain: true }) as any;
    return {
      id: plain.id,
      number_system: plain.number_system,
      return_invoice_reference: plain.return_invoice_reference ?? null,
      statuses: plain.unitBusinessAttributes.map((attr: any) => attr.status),
      openBatchInvoiceIds:
        await expeditionBatchInvoiceRepository.findOpenIdsByInvoiceId(plain.id),
    };
  }

  // Notas da unit business com pedido cancelado e nota ainda não CANCELLED —
  // mesmo critério do filtro `pending_cancellation` da listagem.
  async countPendingCancellation(unitBusinessId: string): Promise<number> {
    return this.model.count({
      distinct: true,
      col: "id",
      where: pendingCancellationWhere(),
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          attributes: [],
          where: { unit_business_id: unitBusinessId },
        },
        { model: Order, as: "order", required: true, attributes: [] },
      ],
    });
  }

  // xml_keys (dentre `xmlKeys`) com nota ainda não CANCELLED em alguma das unit businesses (por número) informadas.
  async findXmlKeysNotCancelledInUnitBusinesses(
    xmlKeys: string[],
    unitBusinessNumbers: string[],
  ): Promise<string[]> {
    if (!xmlKeys.length) return [];
    const rows = (await this.model.findAll({
      where: { xml_key: { [Op.in]: xmlKeys } },
      attributes: ["xml_key"],
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
    })) as unknown as Pick<InvoiceAttributes, "xml_key">[];
    return [...new Set(rows.map((row) => row.xml_key).filter((key): key is string => !!key))];
  }
}

export default new InvoiceCancellationRepository();
