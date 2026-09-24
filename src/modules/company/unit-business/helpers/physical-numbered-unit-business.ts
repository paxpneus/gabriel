export const PHYSICAL_NUMBERED_STORE_RANGE = { min: 1, max: 24 } as const;

// `number` é STRING no banco — comparação teria que ser lexicográfica se
// feita via WHERE direto ("10" < "2"), por isso o range é checado aqui, em
// memória, sobre o `number` já convertido, em vez de Op.between na query.
export function isWithinPhysicalStoreRange(
  number: string | null | undefined,
  range: { min: number; max: number } = PHYSICAL_NUMBERED_STORE_RANGE,
): boolean {
  if (!number) return false;
  const parsed = Number(number);
  return Number.isInteger(parsed) && parsed >= range.min && parsed <= range.max;
}
