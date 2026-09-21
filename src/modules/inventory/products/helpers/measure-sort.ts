
export interface ParsedMeasure {
  width: number;   // 265
  ratio: number;   // 60
  rim: number;     // 18
  raw: string;     // "265/60R18"
}

const MEASURE_REGEX = /^(\d+)\s*\/\s*(\d+)\s*R\s*(\d+)/i;

/**
 * Faz o parse de uma medida de pneu no formato "265/60R18".
 * Retorna null se a string não bater com o padrão esperado.
 */
export function parseMeasure(measure?: string | null): ParsedMeasure | null {
  if (!measure) return null;

  const match = measure.trim().match(MEASURE_REGEX);
  if (!match) return null;

  const [, width, ratio, rim] = match;

  return {
    width: Number(width),
    ratio: Number(ratio),
    rim: Number(rim),
    raw: measure,
  };
}

/**
 * Compara duas medidas de pneu: primeiro pelo aro, depois pela largura,
 * depois pelo perfil (número depois da barra).
 * Itens que não batem com o padrão vão para o final.
 */
export function compareMeasures(
  measureA?: string | null,
  measureB?: string | null
): number {
  const a = parseMeasure(measureA);
  const b = parseMeasure(measureB);

  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  if (a.rim !== b.rim) return a.rim - b.rim;
  if (a.width !== b.width) return a.width - b.width;
  return a.ratio - b.ratio;
}

/**
 * Helper genérico para ordenar qualquer array de itens que tenham
 * uma medida de pneu acessível via `getMeasure`.
 *
 * Não muta o array original.
 */
export function sortByMeasure<T>(
  items: T[],
  getMeasure: (item: T) => string | null | undefined
): T[] {
  return [...items].sort((itemA, itemB) =>
    compareMeasures(getMeasure(itemA), getMeasure(itemB))
  );
}