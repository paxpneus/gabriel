import { WhereOptions, Op } from "sequelize";
import {
  startOfDayTz,
  collectionDateDayRangeCompat,
  isBeforeShippingCutoff,
  SHIPPING_CUTOFF_HOUR,
} from "../../../../../../shared/utils/normalizers/date";

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
