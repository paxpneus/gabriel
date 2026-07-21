
// ─── Formatação de datas específica da Datafrete ─────────────────────────────

/**
 * Combina dt_ocorrencia ("DD/MM/YYYY") + hora_ocorrencia ("HH:mm:ss") do GET
 * num ISO string com offset fixo de Brasília (-03:00, sem horário de verão).
 */
export function parseDatafreteDateTime(dtOcorrencia: string, horaOcorrencia: string): string | undefined {
  if (!dtOcorrencia || !horaOcorrencia) return undefined;

  const [day, month, year] = dtOcorrencia.split('/');
  if (!day || !month || !year) return undefined;

  return `${year}-${month}-${day}T${horaOcorrencia}-03:00`;
}

/**
 * Formata uma Date do nosso banco para o formato exigido pelo POST da Datafrete:
 * "YYYY-MM-DD HH:mm:ss", sempre em horário de Brasília.
 */
export function formatToDatafretePayloadDate(date: string | Date): string {
  const d = new Date(date);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}