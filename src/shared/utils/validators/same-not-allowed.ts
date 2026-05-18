export function ensureSameBy<T>(
  items: T[],
  getValue: (item: T) => string | null | undefined,
  errorMessage = "Valores diferentes não são permitidos"
): void {
  const values = items.map(getValue).filter(Boolean)

  if (values.length === 0) return

  const first = values[0]

  const hasDifferent = values.some(v => v !== first)

  if (hasDifferent) {
    throw new Error(errorMessage)
  }
}