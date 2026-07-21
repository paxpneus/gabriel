/**
 * A Alfa retorna datas no formato "dd/MM/yyyy HH:mm" (ex: "19/02/2024 03:41").
 * O Date nativo do JS não parseia esse formato (só ISO ou MM/dd/yyyy),
 * por isso o parse manual abaixo.
 */

export const parseAlfaDate = (raw?: string): Date | undefined => {
  if (!raw) return undefined;

  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;

  const [, day, month, year, hour, minute, second = '00'] = match;
  const isoWithOffset = `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`;

  const date = new Date(isoWithOffset);
  return isNaN(date.getTime()) ? undefined : date;
};