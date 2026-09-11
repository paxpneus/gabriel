import { Op, WhereOptions } from "sequelize";
import {
  startOfDayTz,
  endOfDayTz,
} from "../../../../../../shared/utils/normalizers/date";

/**
 * `where` reutilizável para "nota de uma loja X cujo pedido (`order`) tem
 * `collection_date` dentro do dia de hoje" — usado pelas 4 abas do filtro de
 * embarque Mercado Livre em `invoice.service.ts`. Exige que a query já tenha
 * as associations `store` e `order` no `include` (dot-notation `$assoc.field$`
 * não funciona sem isso).
 */
export function storeCollectionDateTodayWhere(
  storeName: string,
): WhereOptions {
  return {
    "$store.name$": storeName,
    "$order.collection_date$": {
      [Op.between]: [startOfDayTz().toDate(), endOfDayTz().toDate()],
    },
  };
}
