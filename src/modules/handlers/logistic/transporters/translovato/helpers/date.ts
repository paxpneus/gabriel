/**
 * A Translovato retorna data e hora em campos separados, ambos no formato
 * brasileiro: Data_Ocorrencia "dd/MM/yyyy" (ex: "10/07/2026") e
 * Hora_Ocorrencia "HH:mm:ss" (ex: "16:57:43").
 * O Date nativo do JS não parseia esse formato, por isso o parse manual abaixo.
 */

export const parseTranslovatoDate = (
  rawDate?: string,
  rawTime?: string,
): Date | undefined => {
  if (!rawDate) return undefined;

  const dateMatch = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) return undefined;

  const [, day, month, year] = dateMatch;

  const timeMatch = rawTime?.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  const [, hour = '00', minute = '00', second = '00'] = timeMatch ?? [];

  const isoWithOffset = `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`;

  const date = new Date(isoWithOffset);
  return isNaN(date.getTime()) ? undefined : date;
};