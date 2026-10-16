// Formato do number de ExpeditionBatch (ENTRANCE/EXPEDITION em setBatchNumber) — puro, sem model,
// pra builder e parser nunca divergirem.
const EXPEDITION_BATCH_NUMBER_PATTERN = /^.*_LOJA\d+_(\d+)$/
// Mesmo formato, em regex POSIX do Postgres (substring ... from), pro MAX da sequência em setBatchNumber.
export const EXPEDITION_BATCH_SEQUENCE_SQL_PATTERN = '_LOJA[0-9]+_([0-9]+)$'

export const formatBatchSequence = (num: number, digits: number = 4): string =>
  String(num).padStart(digits, '0')

export const buildExpeditionBatchNumber = (
  transporterName: string | null | undefined,
  unitBusinessNumber: string,
  sequence: number,
): string => `${transporterName}_LOJA${unitBusinessNumber}_${formatBatchSequence(sequence)}`

// "RODONAVES TRANSPS E ENCOMENDAS LTDA_LOJA21_0842" → "0842"; fora do formato → null.
export const extractExpeditionBatchSequence = (
  number: string | null | undefined,
): string | null => number?.match(EXPEDITION_BATCH_NUMBER_PATTERN)?.[1] ?? null
