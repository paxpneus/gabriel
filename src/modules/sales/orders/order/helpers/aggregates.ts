import { Sequelize } from "sequelize";
import { APP_TIMEZONE } from "../../../../../shared/utils/normalizers/date";

/**
 * Literal SQL bucketing `collection_date` pro dia calendário em
 * APP_TIMEZONE (America/Sao_Paulo), formatado "YYYY-MM-DD" — usado pra
 * agrupar a contagem de `ship_to_future` por dia de coleta.
 *
 * Normaliza as duas codificações possíveis de `collection_date` (ver
 * `collectionDateDayRangeCompat` em `shared/utils/normalizers/date.ts`):
 * pedidos agendados antes da correção em `mercado-livre-scraping.service.ts`
 * têm o campo gravado como meia-noite UTC em vez de meia-noite BRT — sem
 * essa normalização, cada um desses cairia bucketado no dia calendário
 * ANTERIOR ao pretendido. Um valor é "codificação antiga" quando sua hora
 * em UTC é exatamente 0 (a codificação correta sempre cai às 3h UTC,
 * meia-noite em America/Sao_Paulo).
 */
export function collectionDateBucketLiteral() {
  return Sequelize.literal(`to_char(
    (CASE
      WHEN date_part('hour', "collection_date" AT TIME ZONE 'UTC') = 0
      THEN "collection_date" + INTERVAL '3 hours'
      ELSE "collection_date"
    END) AT TIME ZONE '${APP_TIMEZONE}',
    'YYYY-MM-DD'
  )`);
}
