import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(timezone);

export const APP_TIMEZONE = "America/Sao_Paulo";

export const getBrazilDate = (): string => {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '') 
}

export function formatToBRDate(date: string | Date) {
  if (!date) return '—'

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatToBRISOString(date: string | Date) {
  if (!date) return null

  const brDate = new Date(
    new Date(date).toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
    }),
  )

  return brDate.toISOString()
}


/**
 * Retorna o dayjs atual já ajustado pro timezone da aplicação.
 * Use isso em vez de `dayjs()` puro sempre que precisar saber "que dia é hoje",
 * pra não cair em bug de UTC perto da meia-noite.
 */
export function nowTz(): Dayjs {
  return dayjs().tz(APP_TIMEZONE);
}
 
/**
 * Retorna uma data (string ou Date) já ajustada pro timezone da aplicação.
 */
export function toTz(date: string | Date | Dayjs): Dayjs {
  return dayjs(date).tz(APP_TIMEZONE);
}
 
/**
 * Formata uma data. Default YYYY-MM-DD (formato mais comum pra filtros de API).
 * Passe outro formato (ex: "DD/MM/YYYY") se a API de destino exigir.
 */
export function formatDate(date: Dayjs, format = "YYYY-MM-DD"): string {
  return date.format(format);
}
 
/**
 * Range de datas [inicio, fim] cobrindo os últimos N dias (incluindo hoje),
 * no timezone da aplicação, já como STRING. Por padrão N=2 (ontem + hoje),
 * que é o caso mais comum de ingestão incremental (ex: CT-e).
 * Formato default YYYY-MM-DD; passe `format` se a API exigir outro (ex: "DD/MM/YYYY").
 *
 * Exemplo (hoje = 10/08, days=2, format default):
 *   inicio = "2026-08-09"
 *   fim    = "2026-08-10"
 */
export function getDateRange(
  days = 2,
  format = "YYYY-MM-DD",
): { inicio: string; fim: string } {
  const fim = nowTz();
  const inicio = fim.subtract(days - 1, "day");
 
  return {
    inicio: formatDate(inicio, format),
    fim: formatDate(fim, format),
  };
}
 
/**
 * Mesmo range de getDateRange(), mas retornando objetos Date nativos
 * em vez de string formatada. Útil quando a API/lib consumidora exige Date
 * (ex: parâmetros tipados como Date em vez de string).
 *
 * Os Dates retornados representam início e fim do dia (00:00:00 e 23:59:59.999)
 * no timezone da aplicação, convertidos pra Date nativo (UTC internamente, como
 * qualquer Date do JS — a conversão de timezone já foi aplicada antes de gerar o Date).
 */
export function getDateRangeAsDate(days = 2): { inicio: Date; fim: Date } {
  const fim = nowTz();
  const inicio = fim.subtract(days - 1, "day");
 
  return {
    inicio: startOfDayTz(inicio).toDate(),
    fim: endOfDayTz(fim).toDate(),
  };
}
 
/**
 * Interpreta uma string de data/hora "solta" no formato "DD/MM/YYYY HH:mm:ss"
 * (sem timezone, como as exportadas pela Bling) como horário local de
 * APP_TIMEZONE, e devolve o Date UTC correspondente.
 *
 * Use isso em vez de `new Date(ano, mes, dia, h, m, s)` sempre que a origem
 * for uma string de wall-clock em horário brasileiro — o construtor nativo
 * assume o timezone do processo Node, que em produção (container sem `TZ`
 * definido) é UTC, produzindo um erro de 3h (o valor vira "UTC" em vez de
 * "America/Sao_Paulo", sem nenhuma conversão de fato).
 */
export function parseBrazilianDateTime(value: string): Date {
  const [datePart, timePart] = value.trim().split(" ");
  const [day, month, year] = datePart.split("/").map(Number);
  const time = timePart ?? "00:00:00";
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}`;
  return dayjs.tz(iso, APP_TIMEZONE).toDate();
}

/**
 * Início do dia (00:00:00.000) no timezone da aplicação.
 */
export function startOfDayTz(date: string | Date | Dayjs = nowTz()): Dayjs {
  return toTz(date).startOf("day");
}
 
/**
 * Fim do dia (23:59:59.999) no timezone da aplicação.
 */
export function endOfDayTz(date: string | Date | Dayjs = nowTz()): Dayjs {
  return toTz(date).endOf("day");
}

export function getChunkedDateRangesAsDate(
  startDate: string | Date | Dayjs,
  monthsPerChunk = 2,
  endDate: string | Date | Dayjs = nowTz(),
): Array<{ inicio: Date; fim: Date }> {
  const ranges: Array<{ inicio: Date; fim: Date }> = [];

  let cursor = startOfDayTz(startDate);
  const end = endOfDayTz(endDate);

  while (cursor.isBefore(end) || cursor.isSame(end)) {
    let chunkEnd = cursor.add(monthsPerChunk, "month").subtract(1, "day");
    chunkEnd = chunkEnd.isAfter(end) ? end : endOfDayTz(chunkEnd);

    ranges.push({
      inicio: cursor.toDate(),
      fim: chunkEnd.toDate(),
    });

    cursor = startOfDayTz(chunkEnd.add(1, "day"));
  }

  return ranges;
}

export function getIncrementalDateRangeAsDate(days = 2): { inicio: Date; fim: Date } {
  const fim = nowTz();
  const inicio = startOfDayTz(fim.subtract(days, "day"));

  return {
    inicio: inicio.toDate(),
    fim: fim.toDate(),
  };
}
 