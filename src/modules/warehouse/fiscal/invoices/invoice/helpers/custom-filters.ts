import { WhereOptions, Op, Sequelize } from "sequelize";
import {
  startOfDayTz,
  collectionDateDayRangeCompat,
  SHIPPING_WINDOW_END_HOUR_OPERATION,
  SHIPPING_WINDOW_START_HOUR_OPERATION,
  nowTz,
} from "../../../../../../shared/utils/normalizers/date";
import { OrderInternalStatus } from "../../../../../sales/orders/order/orders.types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Janela de embarque do dia: 06h–14h, agora centralizada em
// shared/utils/normalizers/date (SHIPPING_WINDOW_START_HOUR_OPERATION /
// SHIPPING_WINDOW_END_HOUR_OPERATION) — mesmas constantes usadas por
// orders.repository.ts#shippingWindowRange, evitando duas fontes de
// verdade pro mesmo horário.
function shippingWindowRange(): { start: Date; end: Date } {
  return {
    start: startOfDayTz().hour(SHIPPING_WINDOW_START_HOUR_OPERATION).toDate(),
    end: startOfDayTz().hour(SHIPPING_WINDOW_END_HOUR_OPERATION).toDate(),
  };
}

/**
 * "O pedido dessa nota está cancelado" — usado só pra EXCLUIR de
 * `pending`. Nota sem `Order` vinculado (`$order.id$ IS NULL`) não é
 * considerada cancelada — não dá pra saber, então não exclui.
 * Exige a association `order` (required: false) no include da query.
 */
function orderNotCancelledCondition(): WhereOptions {
  return {
    [Op.or]: [
      { "$order.id$": { [Op.is]: null } as any },
      {
        "$order.internal_status$": { [Op.ne]: OrderInternalStatus.CANCELLED },
      },
    ],
  };
}

/**
 * Espelha `orders.repository.ts#shipTodayPendingWhere` — mesmo critério,
 * só que do ponto de vista da Invoice (lá se conta Order, aqui se busca
 * Invoice). Mesmas duas vias:
 *
 * (A) O pedido tem essa nota vinculada e a `collection_date` do pedido é
 *     hoje — não importa se/quando a nota foi emitida.
 *
 * (B) A nota foi emitida hoje, na janela 06h–14h — a `collection_date` do
 *     pedido é irrelevante nesse caso, mesmo que seja amanhã (ou não
 *     exista pedido vinculado). Exige `batch_generated = false` e status
 *     da nota em OPEN/PENDING.
 *
 * Pedido cancelado exclui os dois casos (`orderNotCancelledCondition`).
 * Nota sem nenhum pedido vinculado só pode entrar pelo caso (B).
 */
export function pendingMercadoLivreWhere(storeName: string): WhereOptions {
  const { start, end } = collectionDateDayRangeCompat();
  const { start: windowStart, end: windowEnd } = shippingWindowRange();

  // Depois das 14h a janela de hoje já fechou — nada mais pode ser
  // "pendente de embarque hoje" (A e B). Espelha
  // orders.repository.ts#shipTodayPendingWhere.
  if (nowTz().isAfter(windowEnd)) {
    return { [Op.and]: [Sequelize.literal("FALSE")] };
  }

  return {
    "$store.name$": storeName,
    "$unitBusinessAttributes.batch_generated$": false,
    "$unitBusinessAttributes.status$": {
      [Op.in]: ["OPEN", "PENDING"],
    },
    [Op.and]: [
      orderNotCancelledCondition(),
      {
        [Op.or]: [
          // (A) pedido vinculado com collection_date de hoje
          {
            "$order.id$": { [Op.ne]: null } as any,
            "$order.collection_date$": { [Op.between]: [start, end] },
          },
          // (B) nota emitida hoje na janela
          { emitted_at: { [Op.between]: [windowStart, windowEnd] } },
        ],
      },
    ],
  };
}

/**
 * União de tudo que "aconteceu hoje" pra essa nota, na janela 06h–14h:
 * emissão, fechamento de lote (`finished_at`) OU criação de lote
 * (`created_at`) — qualquer um dos três já qualifica.
 * CONFIRMAR o nome do campo de criação do lote em `ExpeditionBatch`
 * (assumido `created_at`, mesmo padrão snake_case de `finished_at`/
 * `delivery_note_generated_at`).
 */
export function allTodayMercadoLivreWhere(storeName: string): WhereOptions {
  const { start, end } = shippingWindowRange();

  return {
    "$store.name$": storeName,
    [Op.or]: [
      { emitted_at: { [Op.between]: [start, end] } },
      { "$batchInvoice.batch.finished_at$": { [Op.between]: [start, end] } },
      { "$batchInvoice.batch.created_at$": { [Op.between]: [start, end] } },
    ],
  };
}

/** Lote da nota finalizado hoje, na janela 06h–14h, processo concluído. */
export function finishedMercadoLivreWhere(storeName: string): WhereOptions {
  const { start, end } = shippingWindowRange();

  return {
    "$store.name$": storeName,
    "$batchInvoice.batch.finished_at$": { [Op.between]: [start, end] },
    "$unitBusinessAttributes.batch_generated$": true,
    "$unitBusinessAttributes.status$": { [Op.in]: ["FINISHED"] },
  };
}

/** Romaneio (delivery note) da nota gerado hoje, na janela 06h–14h. */
export function dispatchedMercadoLivreWhere(storeName: string): WhereOptions {
  const { start, end } = shippingWindowRange();

  return {
    "$store.name$": storeName,
    "$batchInvoice.batch.delivery_note_generated_at$": {
      [Op.between]: [start, end],
    },
  };
}

/**
 * Valores de filtro vêm direto do client (`?filters[x][]=...`) — nunca
 * confiar neles pra montar SQL cru. Descarta qualquer valor que não seja
 * um UUID de verdade (em vez de só escapar aspas), então o resultado só
 * tem material seguro pra interpolar num `Sequelize.literal`.
 */
function sqlUuidArrayLiteral(ids: string[]): string {
  const validIds = ids.filter((id) => UUID_RE.test(id));
  return `ARRAY[${validIds.map((id) => `'${id}'`).join(", ")}]::uuid[]`;
}

/** Curinga (`TRUE`) quando `ids` está vazio, senão `column = ANY(ids)`. */
function scopeColumnConditionSql(column: string, ids: string[]): string {
  return ids.length ? `${column} = ANY(${sqlUuidArrayLiteral(ids)})` : "TRUE";
}

/**
 * Notas com algum item cujo produto tem um dos aros informados (`rim_id`).
 * `rimIds` funciona como "esse OU qualquer um desses outros" (OR, não AND).
 */
export function productRimWhere(rimIds: string[]): WhereOptions {
  if (!rimIds.length) return {};
  return {
    [Op.and]: [
      Sequelize.literal(`EXISTS (
        SELECT 1
        FROM invoice_items ii
        JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = "Invoice"."id"
          AND ${scopeColumnConditionSql("p.rim_id", rimIds)}
      )`),
    ],
  };
}

/**
 * Notas com algum item que REALMENTE recebeu o desconto de UMA das regras
 * informadas (OR entre regras) — não "se encaixaria no escopo da regra".
 * Versão revisada: a primeira versão checava marca/aro/medida/loja/período
 * contra o escopo da regra (a mesma lógica "candidata" de `matchBatch`),
 * mas isso trazia notas cujo produto se encaixava na regra só não tinha
 * quantidade suficiente pra formar um bloco (`quantity_step`) — o desconto
 * nunca foi de fato concedido pra elas. Corrigido a pedido do usuário: "não
 * faz sentido pegar nota onde não bate o desconto". Agora lê diretamente
 * `sales_order_item_snapshots.supplier_discount_rule_id` — o resultado já
 * decidido por `supplierDiscountRuleService.resolveForItems` — em vez de
 * recalcular o matching aqui.
 *
 * `sales_order_item_snapshots` é keyed por `(order_id, product_id)`, e uma
 * venda por KIT registra o `product_id` do KIT ali, não do componente que a
 * NF-e realmente emite — por isso o `LEFT JOIN kit_components` casa tanto
 * pelo produto direto quanto pelo produto KIT cujo componente é o item da
 * nota (mesmo problema documentado em
 * `InvoiceService.buildSupplierDiscountLookup`, que resolve isso do lado
 * dos relatórios).
 */
export function supplierDiscountMatchWhere(ruleIds: string[]): WhereOptions {
  if (!ruleIds.length) return {};
  return {
    [Op.and]: [
      Sequelize.literal(`EXISTS (
        SELECT 1
        FROM invoice_items ii
        JOIN orders o ON o.invoice_id = "Invoice"."id"
        JOIN sales_order_item_snapshots sois
          ON sois.order_id = o.id
          AND ${scopeColumnConditionSql("sois.supplier_discount_rule_id", ruleIds)}
        LEFT JOIN kit_components kc ON kc.product_kit_id = sois.product_id
        WHERE (sois.product_id = ii.product_id OR kc.product_component_id = ii.product_id)
      )`),
    ],
  };
}
