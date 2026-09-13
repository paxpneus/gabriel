import { WhereOptions, Op } from "sequelize";
import {
  nowTz,
  collectionDateDayRangeCompat,
} from "../../../../../../shared/utils/normalizers/date";

/**
 * `where` reutilizável para "nota de uma loja X cujo pedido (`order`) tem
 * `collection_date` dentro do dia de hoje" — usado pelas 4 abas do filtro de
 * embarque Mercado Livre em `invoice.service.ts`. Exige que a query já tenha
 * as associations `store` e `order` no `include` (dot-notation `$assoc.field$`
 * não funciona sem isso).
 *
 * Usa `collectionDateDayRangeCompat` (não só `startOfDayTz`/`endOfDayTz`)
 * porque `collection_date` pode ainda estar com a codificação antiga
 * (meia-noite UTC em vez de meia-noite BRT) em pedidos já agendados antes
 * da correção em `mercado-livre-scraping.service.ts` — ver o comentário lá
 * pra o motivo completo.
 */


export function storeCollectionDateTodayWhere(
  storeName: string,
): WhereOptions {
  const { start, end } = collectionDateDayRangeCompat();

  return {
    "$store.name$": storeName,
    "$order.collection_date$": { [Op.between]: [start, end] },
  };
}
