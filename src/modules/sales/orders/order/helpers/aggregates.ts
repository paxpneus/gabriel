import { Sequelize } from "sequelize";
import { APP_TIMEZONE, startOfDayTz } from "../../../../../shared/utils/normalizers/date";

const DATE_BUCKET_FORMAT = "YYYY-MM-DD";

/**
 * Literal SQL bucketing `collection_date` pro dia calendário em
 * APP_TIMEZONE ... (mesmo comentário de antes)
 */
export function collectionDateBucketLiteral() {
  return Sequelize.literal(`to_char(
    (CASE
      WHEN date_part('hour', "collection_date") = 0
      THEN "collection_date" + INTERVAL '3 hours'
      ELSE "collection_date"
    END) AT TIME ZONE 'UTC' AT TIME ZONE '${APP_TIMEZONE}',
    '${DATE_BUCKET_FORMAT}'
  )`);
}

/**
 * Chave do bucket "amanhã", no MESMO formato que collectionDateBucketLiteral()
 * produz — centralizado aqui de propósito, pra groupShipToFutureByDate não
 * precisar comparar uma string calculada em JS contra uma calculada em SQL
 * usando dois formatos escritos à mão em arquivos diferentes. Não precisa da
 * normalização do CASE acima porque não vem de um collection_date real: é só
 * "hoje + 1 dia", que é exatamente o bucket pra onde as notas órfãs futuras
 * (orphanFutureInvoiceWhere) sempre vão.
 */
export function tomorrowBucketKey(): string {
  return startOfDayTz().add(1, "day").format(DATE_BUCKET_FORMAT);
}