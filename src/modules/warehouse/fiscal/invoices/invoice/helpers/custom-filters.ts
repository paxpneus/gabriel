import { WhereOptions, Op, Sequelize } from "sequelize";
import {
  startOfDayTz,
  collectionDateDayRangeCompat,
  isBeforeShippingCutoff,
  SHIPPING_CUTOFF_HOUR,
} from "../../../../../../shared/utils/normalizers/date";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Condições (pra usar dentro de um `[Op.or]`) de "essa nota está elegível
 * pra embarcar HOJE" — usadas pelas 4 abas do filtro de embarque Mercado
 * Livre em `invoice.service.ts`. Não inclui o `$store.name$`, quem chama
 * decide isso (cada `*Where` abaixo adiciona).
 *
 * Uma nota é elegível se:
 * - o pedido (`order`) não existe (`invoice_id` sem `Order` vinculado) —
 *   não dá pra saber a data de coleta, então não some de nenhum filtro;
 * - `$order.collection_date$` cai hoje (em America/Sao_Paulo); OU
 * - a nota já foi emitida E ainda não passou do horário-limite de embarque
 *   (`SHIPPING_CUTOFF_HOUR`) — despacho antecipado, mesmo com
 *   `collection_date` num dia futuro. Depois do corte, uma nota já emitida
 *   com coleta futura deixa de contar como "hoje" (vira embarque futuro).
 *
 * Exige que a query já tenha as associations `store` e `order` no
 * `include` (dot-notation `$assoc.field$` não funciona sem isso).
 */
function shipTodayEligibilityConditions(): WhereOptions[] {
  const { start, end } = collectionDateDayRangeCompat();

  const conditions: WhereOptions[] = [
    { "$order.id$": { [Op.is]: null } as any },
    { "$order.collection_date$": { [Op.between]: [start, end] } },
  ];

  if (isBeforeShippingCutoff()) {
    conditions.push({ emitted_at: { [Op.ne]: null } });
  }

  return conditions;
}

/**
 * "O lote (romaneio) da nota foi finalizado hoje, ainda dentro do horário
 * de embarque" — usado por `finished`/`dispatched`/`all_today` pra
 * reconhecer o que JÁ embarcou hoje (ao contrário de
 * `shipTodayEligibilityConditions`, que é sobre o que ainda PODE embarcar
 * hoje). Um lote finalizado depois do corte não conta como "embarcou hoje"
 * pro propósito dessas abas. Exige a mesma association `batchInvoice.batch`
 * que `batchStatus`/`dispatched_mercado_livre` já usam.
 */
function batchFinishedTodayBeforeCutoffCondition(): WhereOptions {
  return {
    "$batchInvoice.batch.finished_at$": {
      [Op.gte]: startOfDayTz().toDate(),
      [Op.lt]: startOfDayTz().hour(SHIPPING_CUTOFF_HOUR).toDate(),
    },
  };
}

/** "O que ainda precisa ser embarcado hoje" — elegível pra hoje e ainda não batido lote. */
export function pendingMercadoLivreWhere(storeName: string): WhereOptions {
  return {
    "$store.name$": storeName,
    [Op.or]: shipTodayEligibilityConditions(),
    "$unitBusinessAttributes.batch_generated$": false,
  };
}

/** União de "precisa embarcar hoje" com "já embarcou hoje" (lote finalizado hoje). */
export function allTodayMercadoLivreWhere(storeName: string): WhereOptions {
  return {
    "$store.name$": storeName,
    [Op.or]: [
      ...shipTodayEligibilityConditions(),
      batchFinishedTodayBeforeCutoffCondition(),
    ],
  };
}

/** Elegível pra hoje, lote já finalizado hoje (antes do corte) e processo concluído. */
export function finishedMercadoLivreWhere(storeName: string): WhereOptions {
  return {
    "$store.name$": storeName,
    [Op.or]: shipTodayEligibilityConditions(),
    ...batchFinishedTodayBeforeCutoffCondition(),
    "$unitBusinessAttributes.batch_generated$": true,
    "$unitBusinessAttributes.status$": { [Op.in]: ["FINISHED", "CANCELLED"] },
  };
}

/** Elegível pra hoje, lote já finalizado hoje (antes do corte) e romaneio gerado. */
export function dispatchedMercadoLivreWhere(storeName: string): WhereOptions {
  return {
    "$store.name$": storeName,
    [Op.or]: shipTodayEligibilityConditions(),
    ...batchFinishedTodayBeforeCutoffCondition(),
    "$batchInvoice.batch.delivery_note_generated_at$": { [Op.ne]: null },
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
