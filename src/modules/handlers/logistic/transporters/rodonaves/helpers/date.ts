/**
 * A Rodonaves retorna datas já em ISO 8601 com offset
 * (ex: "2026-07-17T17:41:25-03:00"), formato que o Date nativo do JS
 * já parseia sem problemas.
 *
 * O parse manual aqui existe só pra:
 * - validar o formato antes de confiar na string,
 * - filtrar as datas "vazias" que a API manda como sentinela
 *   (ex: "0001-01-01T00:00:00-03:06", presentes em OccurrenceDate e
 *   NewDateSchedule quando o evento não tem essa informação).
 */

const RODONAVES_EMPTY_DATE_YEAR = '0001';

export const parseRodonavesDate = (raw?: string): Date | undefined => {
  if (!raw) return undefined;

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-]\d{2}:\d{2}|Z)$/,
  );
  if (!match) return undefined;

  const [, year] = match;

  // Data sentinela da API indicando "sem data" (ex: OccurrenceDate zerada).
  if (year === RODONAVES_EMPTY_DATE_YEAR) return undefined;

  const date = new Date(raw);
  return isNaN(date.getTime()) ? undefined : date;
};