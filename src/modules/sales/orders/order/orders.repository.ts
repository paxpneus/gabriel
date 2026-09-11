import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import Order from "./orders.model";
import Customer from "../../customers/customers.model";
import SalesOrderSnapshot from "../../../reports/daily-sales/sales-order-snapshot/sales-order-snapshot.model";
import SalesOrderItemSnapshot from "../../../reports/daily-sales/sales-order-item-snapshot/sales-order-item-snapshot.model";
import {
  OrderWithSalesSnapshotRaw,
  ShipTodayPendingDetailRow,
  ShipToDefineDetailRow,
  OrderInternalStatus,
} from "./orders.types";
import { Op, fn, col, literal, WhereOptions } from "sequelize";
import { Invoice } from "../../../warehouse";
import InvoiceUnitBusinessAttributes from "../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import {
  collectionDateDayRangeCompat,
  collectionDateFutureStartCompat,
} from "../../../../shared/utils/normalizers/date";
import { collectionDateBucketLiteral } from "./helpers/aggregates";
import { translateOrderInternalStatus } from "./helpers/translations";
import Store from "../../stores/stores.model";

const MERCADO_LIVRE_STORE_NAME = "MercadoLivre";

export class OrderRepository extends BaseRepository<Order> {
  constructor() {
    super(Order);
  }

  // Usado pelos métodos baseados em collection_date (só preenchido por
  // MLOrderSyncQueue — nenhum outro canal jamais tem esse campo): sem esse
  // filtro, ship_to_define contaria todo pedido de qualquer canal que
  // nunca teve collection_date, basicamente todo pedido não-ML.
  // countHumanVerification/groupHumanVerificationByReason NÃO usam isso —
  // 748772 é um status geral da Bling, não restrito a nenhum canal.
  // Cacheado na instância porque é chamado várias vezes por request
  // (Promise.all dos 4 counts).
  private mercadoLivreStoreId: string | null | undefined;

  private async resolveMercadoLivreStoreId(): Promise<string | null> {
    if (this.mercadoLivreStoreId !== undefined) return this.mercadoLivreStoreId;

    const store = await Store.findOne({
      where: { name: MERCADO_LIVRE_STORE_NAME },
      attributes: ["id"],
    });

    this.mercadoLivreStoreId = store?.id ?? null;
    return this.mercadoLivreStoreId;
  }

  async findWithSalesReportSnapshot(
    orderId: string,
  ): Promise<OrderWithSalesSnapshotRaw | null> {
    const data = await this.model.findOne({
      where: { id: orderId },
      include: [
        { model: Customer, as: "customer" },
        {
          model: SalesOrderSnapshot,
          as: "salesSnapshot",
          include: [{ model: SalesOrderItemSnapshot, as: "items" }],
        },
      ],
    });

    if (!data) return null;

    return data.get({ plain: true }) as unknown as OrderWithSalesSnapshotRaw;
  }

  // ─── Resumo de status (contagens) ────────────────────────────────────────
  // Nenhum destes escopa por unit_business_id: orders.unit_business_id só é
  // preenchido quando a `loja` da Bling mapeia pra uma filial física
  // (UnitBusiness) — pedidos de canal de marketplace (Mercado Livre,
  // Shopee, etc.) não têm essa relação e ficam com unit_business_id nulo
  // na prática, então escopar por ele zera os 3 que dependem de
  // collection_date. O escopo real desses 3 é a loja; human_verification
  // nem isso (ver comentário abaixo).

  // Situação 748772 é um status geral da Bling, não restrito a nenhum
  // canal — sem escopo nenhum além do próprio status.
  async countHumanVerification(): Promise<number> {
    return this.model.count({
      where: { actual_situation: "748772" },
    });
  }

  // Where compartilhado entre countShipTodayPending e
  // findShipTodayPendingDetail — mesmo critério, um só conta e o outro
  // lista. Retorna null quando a loja MercadoLivre nem existe (ambos os
  // chamadores tratam isso como "vazio", sem query nenhuma).
  private async shipTodayPendingWhere(): Promise<WhereOptions | null> {
    const storeId = await this.resolveMercadoLivreStoreId();
    if (!storeId) return null;

    const { start, end } = collectionDateDayRangeCompat();

    return {
      store_id: storeId,
      collection_date: { [Op.between]: [start, end] },
      [Op.or]: [
        { invoice_id: null },
        { "$invoice.unitBusinessAttributes.batch_generated$": false },
      ],
    };
  }

  // batch_generated é por (invoice_id, unit_business_id) — diferente dos
  // outros escopos deste arquivo, esse aqui é sobre QUEM gerou o lote (a
  // filial do usuário logado), não sobre o pedido/canal em si. Único
  // método que recebe unitBusinessId.
  async countShipTodayPending(unitBusinessId: string): Promise<number> {
    const where = await this.shipTodayPendingWhere();
    if (!where) return 0;

    return this.model.count({
      distinct: true,
      col: "id",
      where,
      include: [
        {
          model: Invoice,
          as: "invoice",
          required: false,
          attributes: [],
          include: [
            {
              model: InvoiceUnitBusinessAttributes,
              as: "unitBusinessAttributes",
              required: false,
              attributes: [],
              where: { unit_business_id: unitBusinessId },
            },
          ],
        },
      ],
    });
  }

  // Where compartilhado entre countShipToDefine e findShipToDefineDetail —
  // mesmo critério pros dois. Só pedidos ainda pendentes: um pedido já
  // FINISHED/CANCELLED/EMITTED/WAITING_FOR_NFE_EMISSION (ou qualquer outro
  // status além dos 2 abaixo) não precisa de coleta "a definir" nenhuma,
  // mesmo sem collection_date.
  private async shipToDefineWhere(): Promise<WhereOptions | null> {
    const storeId = await this.resolveMercadoLivreStoreId();
    if (!storeId) return null;

    return {
      store_id: storeId,
      internal_status: {
        [Op.in]: [
          OrderInternalStatus.OPEN,
          OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
        ],
      },
      // Sequelize tipa Op.is como exigindo um Literal, não `null` puro —
      // cast pontual, é o idiom padrão do Sequelize pra "IS NULL".
      collection_date: { [Op.is]: null } as any,
    };
  }

  async countShipToDefine(): Promise<number> {
    const where = await this.shipToDefineWhere();
    if (!where) return 0;

    return this.model.count({ where });
  }

  async countShipToFuture(): Promise<number> {
    const storeId = await this.resolveMercadoLivreStoreId();
    if (!storeId) return 0;

    return this.model.count({
      where: {
        store_id: storeId,
        collection_date: { [Op.gte]: collectionDateFutureStartCompat() },
      },
    });
  }

  // ─── Detalhe ──────────────────────────────────────────────────────────────

  // Mesmo where de countShipTodayPending, listando os pedidos em vez de
  // só contar — mesmo escopo de unit_business_id (via
  // shipTodayPendingWhere/o include de unitBusinessAttributes).
  async findShipTodayPendingDetail(
    unitBusinessId: string,
  ): Promise<ShipTodayPendingDetailRow[]> {
    const where = await this.shipTodayPendingWhere();
    if (!where) return [];

    const rows = await this.model.findAll({
      subQuery: false,
      where,
      attributes: ["number_order_system", "date", "collection_date"],
      include: [
        { model: Customer, as: "customer", required: false, attributes: ["name"] },
        {
          model: Invoice,
          as: "invoice",
          required: false,
          attributes: ["number_system", "emitted_at"],
          include: [
            {
              model: InvoiceUnitBusinessAttributes,
              as: "unitBusinessAttributes",
              required: false,
              attributes: [],
              where: { unit_business_id: unitBusinessId },
            },
          ],
        },
      ],
      order: [["collection_date", "ASC"]],
    });

    return rows.map((r) => {
      const plain = r.get({ plain: true }) as any;
      return {
        number_order_system: plain.number_order_system,
        customer_name: plain.customer?.name ?? null,
        sale_date: plain.date,
        collection_date: plain.collection_date,
        invoice_number: plain.invoice?.number_system ?? null,
        invoice_emitted_at: plain.invoice?.emitted_at ?? null,
      };
    });
  }

  // Mesmo where de countShipToDefine, listando os pedidos em vez de só
  // contar.
  //
  // `status` é o `internal_status` puro — NÃO a mesma precedência de
  // OrderService.paginate() (`status_snapshot ?? internal_status`).
  // status_snapshot vem de `actual_situation` (código bruto da Bling) via
  // `integration_order_status_mappings` — uma fonte INDEPENDENTE de
  // internal_status, que várias filas (cnpj.queue, mercado-livre-sync.queue,
  // nfe.queue...) avançam sozinho sem tocar actual_situation. Como esse
  // filtro (shipToDefineWhere) restringe por internal_status, exibir
  // status_snapshot no lugar já mostrou, em produção, pedidos filtrados
  // como "ainda pendentes" (OPEN/WAITING_CHANNEL_VALIDATION) com status
  // exibido "CANCELADO"/"ATENDIDO" — coerente com o próprio dado (as duas
  // colunas realmente divergem), mas contraditório com o filtro que gerou
  // a lista. Aqui o campo exibido tem que ser exatamente o que foi
  // filtrado.
  async findShipToDefineDetail(): Promise<ShipToDefineDetailRow[]> {
    const where = await this.shipToDefineWhere();
    if (!where) return [];

    const rows = await this.model.findAll({
      subQuery: false,
      where,
      attributes: ["number_order_system", "internal_status", "date"],
      include: [
        { model: Customer, as: "customer", required: false, attributes: ["name"] },
      ],
      order: [["date", "ASC"]],
    });

    return rows.map((r) => {
      const plain = r.get({ plain: true }) as any;
      return {
        number_order_system: plain.number_order_system,
        customer_name: plain.customer?.name ?? null,
        status: translateOrderInternalStatus(plain.internal_status),
        sale_date: plain.date,
      };
    });
  }

  // Mesmo motivo do countHumanVerification: 748772 não é exclusivo de
  // nenhum canal, não escopa por nada além do status.
  async groupHumanVerificationByReason(): Promise<
    Array<{ reason: string | null; quantity: number }>
  > {
    const rows = (await this.model.findAll({
      attributes: ["reason_cancelled", [fn("COUNT", col("id")), "quantity"]],
      where: { actual_situation: "748772" },
      group: ["reason_cancelled"],
      raw: true,
    })) as unknown as Array<{
      reason_cancelled: string | null;
      quantity: string;
    }>;

    return rows.map((r) => ({
      reason: r.reason_cancelled,
      quantity: Number(r.quantity),
    }));
  }

  async groupShipToFutureByDate(): Promise<
    Array<{ date: string; quantity: number }>
  > {
    const storeId = await this.resolveMercadoLivreStoreId();
    if (!storeId) return [];

    const rows = (await this.model.findAll({
      attributes: [
        [collectionDateBucketLiteral(), "date_bucket"],
        [fn("COUNT", col("id")), "quantity"],
      ],
      where: {
        store_id: storeId,
        collection_date: { [Op.gte]: collectionDateFutureStartCompat() },
      },
      group: ["date_bucket"],
      order: [[literal("date_bucket"), "ASC"]],
      raw: true,
    })) as unknown as Array<{ date_bucket: string; quantity: string }>;

    return rows.map((r) => ({
      date: r.date_bucket,
      quantity: Number(r.quantity),
    }));
  }
}

export default new OrderRepository();
