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
  TERMINAL_ORDER_INTERNAL_STATUSES,
} from "./orders.types";
import { Op, fn, col, literal, WhereOptions } from "sequelize";
import { Invoice } from "../../../warehouse";
import InvoiceUnitBusinessAttributes from "../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import {
  collectionDateDayRangeCompat,
  collectionDateFutureStartCompat,
  nowTz,
  SHIPPING_WINDOW_END_HOUR_OPERATION,
  SHIPPING_WINDOW_START_HOUR_OPERATION,
  startOfDayTz,
} from "../../../../shared/utils/normalizers/date";
import { collectionDateBucketLiteral, tomorrowBucketKey } from "./helpers/aggregates";
import { translateOrderInternalStatus } from "./helpers/translations";
import Store from "../../stores/stores.model";
import PaymentMethod from "../payment_method/payment_method.model";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import OrderItems from "../order_items/order_items.model";

const MERCADO_LIVRE_STORE_NAME = "MercadoLivre";

// Janela de embarque do dia: a nota só "vale pra hoje" se foi emitida
// entre 06h e 14h. Substitui o antigo `isBeforeShippingCutoff()` —
// aquilo era uma checagem de RELÓGIO (agora é antes das 14h?), isso aqui
// é uma checagem de DADO (a nota foi emitida dentro da janela?). A
// diferença importa: o resultado das abas não muda mais só porque o
// relógio passou das 14h, muda porque a nota entrou (ou não) na janela.

// Status da NOTA (InvoiceUnitBusinessAttributes.status) que ainda contam
// como pendente. CONFIRMAR se existe enum próprio pra isso — se existir,
// trocar as strings pelos membros do enum.
const PENDING_INVOICE_ATTRIBUTE_STATUSES = ["PENDING", "OPEN"];

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

  // Nota SEM pedido, ainda pendente de embarque hoje — espelha o caso (B)
// de pendingMercadoLivreWhere (invoice-filters.helper.ts), mas aqui do
// lado do OrderRepository, escopado por unitBusinessId (mesmo escopo de
// countShipTodayPending). Sem isso, uma nota que a Bling nunca amarrou a
// nenhum Order simplesmente não aparecia em lugar nenhum, mesmo emitida
// dentro da janela. type: OUTGOING — nota onde a loja é quem despacha,
// não a recebedora (ela pode ter attributes INCOMING pra outra ponta).
private orphanInvoicePendingWhere(unitBusinessId: string): WhereOptions | null {
  const { start: windowStart, end: windowEnd } = this.shippingWindowRange();
  if (nowTz().isAfter(windowEnd)) return null;

  return {
    "$store.name$": MERCADO_LIVRE_STORE_NAME,
    "$order.id$": { [Op.is]: null } as any,
    "$unitBusinessAttributes.unit_business_id$": unitBusinessId,
    "$unitBusinessAttributes.type$": "OUTGOING",
    "$unitBusinessAttributes.batch_generated$": false,
    "$unitBusinessAttributes.status$": {
      [Op.in]: PENDING_INVOICE_ATTRIBUTE_STATUSES,
    },
    emitted_at: { [Op.between]: [windowStart, windowEnd] },
  };
}

// Nota SEM pedido que passou da janela de hoje sem se resolver — só
// existe DEPOIS que a janela fecha (antes disso ela ainda pode virar
// "pending" ou ganhar um Order a qualquer momento). Sem collection_date
// pra saber "pra quando", o critério é: passou das 14h → é pra amanhã,
// não importa se emitiu tarde ou nem emitiu ainda. Se um Order vier a
// existir depois, ela sai daqui e passa a seguir futureShipmentWhere
// normal (bucket certo, pelo collection_date do pedido).
private orphanFutureInvoiceWhere(): WhereOptions | null {
  const { end: windowEnd } = this.shippingWindowRange();
  if (!nowTz().isAfter(windowEnd)) return null;

  return {
    "$store.name$": MERCADO_LIVRE_STORE_NAME,
    "$order.id$": { [Op.is]: null } as any,
    [Op.or]: [
      { emitted_at: { [Op.is]: null } as any },
      { emitted_at: { [Op.gt]: windowEnd } },
    ],
  };
}

  // Janela 06h–14h de HOJE, derivada do mesmo início-de-dia que
  // `collectionDateDayRangeCompat()` já usa — assim a janela e o range de
  // coleta ficam no mesmo referencial de fuso, sem duas fontes de verdade.
  // Se/quando virar utilitário compartilhado (invoice.service precisa da
  // mesma janela nas 4 abas), mover pra shared/utils/normalizers/date.
  private shippingWindowRange(): { start: Date; end: Date } {
  return {
    start: startOfDayTz().hour(SHIPPING_WINDOW_START_HOUR_OPERATION).toDate(),
    end: startOfDayTz().hour(SHIPPING_WINDOW_END_HOUR_OPERATION).toDate(),
  };
}

  // Usado pra comparar a forma de pagamento do pedido (Bling) com o
  // comprovante extraído por IA (pdv-sales-request — payment-method-match.ts).
  async findByIdWithPaymentMethod(orderId: string): Promise<Order | null> {
    return this.model.findOne({
      where: { id: orderId },
      include: [{ model: PaymentMethod, as: "paymentMethod" }],
    });
  }

  // Usado só pelo PDV (pdv-sales-request.service.ts) pra listar pedidos de
  // uma loja elegíveis pra virar solicitação — cliente + loja só, sem os
  // includes pesados de pagamento/itens. Exclui pedido em status
  // finalizador (completo ou cancelado, TERMINAL_ORDER_INTERNAL_STATUSES) —
  // não faz sentido abrir solicitação PDV pra pedido que já terminou. Regra
  // é específica desse fluxo, não um "find genérico por loja" — nome reflete
  // isso. `unitBusinessId` aceita uma loja só (fluxo normal) ou uma lista
  // (acesso global sem loja selecionada, ex.: Televendas — ver
  // pdv-sales-request.service.ts::findEligibleOrders).
  async findEligibleForPdvByUnitBusiness(
    unitBusinessId: string | string[],
    limit: number,
  ): Promise<Order[]> {
    return this.model.findAll({
      where: {
        unit_business_id: Array.isArray(unitBusinessId)
          ? { [Op.in]: unitBusinessId }
          : unitBusinessId,
        internal_status: { [Op.notIn]: TERMINAL_ORDER_INTERNAL_STATUSES },
      },
      attributes: { exclude: ["source_payload"] },
      include: [
        { model: Customer, as: "customer" },
        { model: UnitBusiness, as: "unitBusiness" },
      ],
      order: [["date", "ASC"]],
      limit,
    });
  }

  // Usado pelo PDV pro card expandido do pedido — cliente, forma de
  // pagamento e itens completos.
  async findByIdWithFullDetail(orderId: string): Promise<Order | null> {
    return this.model.findOne({
      where: { id: orderId },
      include: [
        { model: Customer, as: "customer" },
        { model: PaymentMethod, as: "paymentMethod" },
        { model: UnitBusiness, as: "unitBusiness" },
        { model: OrderItems, as: "items" },
      ],
    });
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
  // na prática, então escopar por ele zera os que dependem de
  // collection_date. O escopo real desses é a loja; human_verification
  // nem isso (ver comentário abaixo).

  // Situação 748772 é um status geral da Bling, não restrito a nenhum
  // canal. Só conta quando o pedido também está CANCELLED —
  // 748772 sozinho não basta mais.
  async countHumanVerification(): Promise<number> {
    return this.model.count({
      where: {
        actual_situation: "748772",
        internal_status: OrderInternalStatus.CANCELLED,
        reason_cancelled: {[Op.ne]: null}
      },
    });
  }

  // Where compartilhado entre countShipTodayPending e
  // findShipTodayPendingDetail — mesmo critério, um só conta e o outro
  // lista. Retorna null quando a loja MercadoLivre nem existe (ambos os
  // chamadores tratam isso como "vazio", sem query nenhuma).
  //
  // Duas formas de um pedido ser "pendente de embarque hoje". O
  // `internal_status` do PEDIDO só desqualifica em um caso: CANCELLED. Fora
  // isso não importa se é OPEN, WAITING_CHANNEL_VALIDATION, EMITTED,
  // SENT_TO_TRANSPORTER ou DELIVERED — quem precisa estar pendente é a
  // NOTA, não o pedido (as duas colunas divergem: várias filas avançam
  // `internal_status` sem tocar `batch_generated`/status da nota).
  //
  // A) JÁ tem nota, mas ela não precisa ter sido emitida hoje — só a
  //    `collection_date` do pedido precisa ser hoje. Cobre o caso da nota
  //    emitida em outro dia (ou ainda sem `emitted_at`) cujo pedido, ainda
  //    assim, tem coleta marcada pra hoje.
  //
  // B) A nota manda e a coleta é irrelevante — se a nota foi emitida hoje
  //    na janela 06h–14h, o pedido embarca hoje mesmo que a
  //    `collection_date` seja amanhã (ou não exista). Exige
  //    `batch_generated = false` (lote da filial ainda não gerado) e
  //    status da nota em PENDING/OPEN.
  //
  // Pedido totalmente SEM nota não entra em nenhum dos dois casos.
  private async shipTodayPendingWhere(): Promise<WhereOptions | null> {
    const storeId = await this.resolveMercadoLivreStoreId();
    if (!storeId) return null;

    const { start, end } = collectionDateDayRangeCompat();
    const { start: windowStart, end: windowEnd } = this.shippingWindowRange();

    // Depois das 14h a janela de hoje já fechou — nada pode mais ser
    // "pendente de embarque hoje" (A e B, os dois casos). Quem ainda não
    // foi batched já é responsabilidade de futureShipmentWhere.
    if (nowTz().isAfter(windowEnd)) return null;

    return {
      store_id: storeId,
      internal_status: { [Op.ne]: OrderInternalStatus.CANCELLED },
      invoice_id: { [Op.ne]: null } as any,
      "$invoice.unitBusinessAttributes.batch_generated$": false,
      "$invoice.unitBusinessAttributes.status$": {
        [Op.in]: PENDING_INVOICE_ATTRIBUTE_STATUSES,
      },
      [Op.or]: [
        // (A) collection_date de hoje
        { collection_date: { [Op.between]: [start, end] } },
        // (B) nota emitida hoje na janela
        { "$invoice.emitted_at$": { [Op.between]: [windowStart, windowEnd] } },
      ],
    };
  }

  // batch_generated/status são por (invoice_id, unit_business_id) —
  // diferente dos outros escopos deste arquivo, esse aqui é sobre QUEM
  // gerou o lote (a filial do usuário logado), não sobre o pedido/canal em
  // si. Único método que recebe unitBusinessId.
 async countShipTodayPending(unitBusinessId: string): Promise<number> {
  const orderWhere = await this.shipTodayPendingWhere();
  const orderCount = orderWhere
    ? await this.model.count({
        distinct: true,
        col: "id",
        where: orderWhere,
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
                where: { unit_business_id: unitBusinessId, type: "OUTGOING" },
              },
            ],
          },
        ],
      })
    : 0;

  const orphanWhere = this.orphanInvoicePendingWhere(unitBusinessId);
  const orphanCount = orphanWhere
    ? await Invoice.count({
        distinct: true,
        col: "id",
        where: orphanWhere,
        include: [
          { model: Store, as: "store", required: true, attributes: [] },
          { model: Order, as: "order", required: false, attributes: [] },
          {
            model: InvoiceUnitBusinessAttributes,
            as: "unitBusinessAttributes",
            required: true,
            attributes: [],
          },
        ],
      })
    : 0;

  return orderCount + orphanCount;
}

  // Where compartilhado entre countShipToDefine e findShipToDefineDetail —
  // mesmo critério pros dois. Só pedidos ainda pendentes: um pedido já
  // FINISHED/CANCELLED/EMITTED/WAITING_FOR_NFE_EMISSION (ou qualquer outro
  // status além dos 2 abaixo) não precisa de coleta "a definir" nenhuma,
  // mesmo sem collection_date.
  //
  // E, agora, só pedido SEM nota vinculada: se já existe invoice, o embarque
  // deixou de ser "a definir" — ele já é resolvido por
  // shipTodayPendingWhere (nota na janela 06h–14h) ou por
  // futureShipmentWhere (nota emitida depois das 14h).
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
      invoice_id: { [Op.is]: null } as any,
    };
  }

  async countShipToDefine(): Promise<number> {
    const where = await this.shipToDefineWhere();
    if (!where) return 0;

    return this.model.count({ where });
  }

  // Corte de "future" é dinâmico: antes das 14h, só entra quem tem
  // collection_date >= amanhã (hoje ainda pode embarcar hoje, dando tempo
  // da nota sair dentro da janela). Depois das 14h, a janela de hoje já
  // fechou — collection_date de HOJE sem nota emitida a tempo também já
  // é "future" na prática (só vai embarcar amanhã), então o corte desce
  // pro início de hoje.
  private futureShipmentWhere(storeId: string): WhereOptions {
    const { end: windowEnd } = this.shippingWindowRange();
    const pastTodaysCutoff = nowTz().isAfter(windowEnd);

    const futureStart = pastTodaysCutoff
      ? startOfDayTz().toDate()
      : collectionDateFutureStartCompat();

    return {
      store_id: storeId,
      collection_date: { [Op.gte]: futureStart },
      [Op.or]: [
        { invoice_id: { [Op.is]: null } as any },
        { "$invoice.emitted_at$": { [Op.is]: null } as any },
        { "$invoice.emitted_at$": { [Op.gt]: windowEnd } },
      ],
    };
  }

async countShipToFuture(): Promise<number> {
  const storeId = await this.resolveMercadoLivreStoreId();
  const orderCount = storeId
    ? await this.model.count({
        distinct: true,
        col: "id",
        where: this.futureShipmentWhere(storeId),
        include: [{ model: Invoice, as: "invoice", required: false, attributes: [] }],
      })
    : 0;

  const orphanWhere = this.orphanFutureInvoiceWhere();
  const orphanCount = orphanWhere
    ? await Invoice.count({
        distinct: true,
        col: "id",
        where: orphanWhere,
        include: [
          { model: Store, as: "store", required: true, attributes: [] },
          { model: Order, as: "order", required: false, attributes: [] },
        ],
      })
    : 0;

  return orderCount + orphanCount;
}

  // ─── Detalhe ──────────────────────────────────────────────────────────────

  // Mesmo where de countShipTodayPending, listando os pedidos em vez de
  // só contar — mesmo escopo de unit_business_id (via
  // shipTodayPendingWhere/o include de unitBusinessAttributes).
  async findShipTodayPendingDetail(
  unitBusinessId: string,
): Promise<ShipTodayPendingDetailRow[]> {
  const where = await this.shipTodayPendingWhere();
  const orderRows = where
  ? await this.model.findAll({
      subQuery: false,
      where,
      attributes: ["number_order_system", "date", "collection_date"],
      include: [
        {
          model: Customer,
          as: "customer",
          required: false,
          attributes: ["name"],
        },
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
              where: { unit_business_id: unitBusinessId, type: "OUTGOING" },
            },
          ],
        },
      ],
      order: [["collection_date", "ASC"]],
    })
  : [];

  const orderDetail = orderRows.map((r) => {
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

  const orphanWhere = this.orphanInvoicePendingWhere(unitBusinessId);
  const orphanRows = orphanWhere
    ? await Invoice.findAll({
        subQuery: false,
        where: orphanWhere,
        attributes: ["number_system", "emitted_at", "receiver_name"],
        include: [
          { model: Store, as: "store", required: true, attributes: [] },
          { model: Order, as: "order", required: false, attributes: [] },
          {
            model: InvoiceUnitBusinessAttributes,
            as: "unitBusinessAttributes",
            required: true,
            attributes: [],
          },
        ],
        order: [["emitted_at", "ASC"]],
      })
    : [];

  // Nota sem pedido: customer_name vem do receiver_name da própria
  // Invoice (não tem Customer/Order pra puxar). number_order_system,
  // sale_date e collection_date ficam null — não existe pedido.
  const orphanDetail: ShipTodayPendingDetailRow[] = orphanRows.map((r) => {
    const plain = r.get({ plain: true }) as any;
    return {
      number_order_system: null,
      customer_name: plain.receiver_name ?? null,
      sale_date: null,
      collection_date: null,
      invoice_number: plain.number_system,
      invoice_emitted_at: plain.emitted_at,
    };
  });

  return [...orderDetail, ...orphanDetail];
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
        {
          model: Customer,
          as: "customer",
          required: false,
          attributes: ["name"],
        },
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
      where: { actual_situation: "748772", reason_cancelled: {[Op.ne]: null}, internal_status: OrderInternalStatus.CANCELLED },
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

  // `subQuery: false` + include de invoice (mesmo sem atributos) porque
  // futureShipmentWhere referencia `$invoice.emitted_at$`.
  // COUNT(DISTINCT id): invoice é 1:1 via orders.invoice_id, mas o DISTINCT
  // protege o agrupamento caso o join deixe de ser 1:1.
  async groupShipToFutureByDate(): Promise<Array<{ date: string; quantity: number }>> {
  const storeId = await this.resolveMercadoLivreStoreId();
  const orderGroups = storeId
    ? await this.model.findAll({
      subQuery: false,
      attributes: [
        [collectionDateBucketLiteral(), "date_bucket"],
        [fn("COUNT", fn("DISTINCT", col("Order.id"))), "quantity"],
      ],
      where: this.futureShipmentWhere(storeId),
      include: [
        { model: Invoice, as: "invoice", required: false, attributes: [] },
      ],
      group: ["date_bucket"],
      order: [[literal("date_bucket"), "ASC"]],
      raw: true,
    })
    : [];

  const buckets = orderGroups.map((r: any) => ({
    date: r.date_bucket,
    quantity: Number(r.quantity),
  }));

  const orphanWhere = this.orphanFutureInvoiceWhere();
  if (orphanWhere) {
    const orphanCount = await Invoice.count({
      distinct: true,
      col: "id",
      where: orphanWhere,
      include: [
        { model: Store, as: "store", required: true, attributes: [] },
        { model: Order, as: "order", required: false, attributes: [] },
      ],
    });

    if (orphanCount > 0) {
      const tomorrowKey = tomorrowBucketKey();
      const existing = buckets.find((b) => b.date === tomorrowKey);
      if (existing) {
        existing.quantity += orphanCount;
      } else {
        buckets.push({ date: tomorrowKey, quantity: orphanCount });
      }
    }
  }

  return buckets;
}
}

export default new OrderRepository();
