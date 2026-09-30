// Aritmética decimal exata (BigInt em escala fixa) pra valores monetários — o
// projeto não tem lib de decimal e Number acumula erro de ponto flutuante.

export const DECIMAL_SCALE = 4;

const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function pow10(exp: number): bigint {
  return 10n ** BigInt(exp);
}

/** Divide arredondando meio pra longe do zero (simétrico pra negativos). */
function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n + d / 2n) / d;
  return negative ? -quotient : quotient;
}

/**
 * String/number decimal -> BigInt na escala informada (arredondado). Retorna
 * null pra null/vazio/inválido — nunca assume 0.
 */
export function toScaled(
  value: string | number | null | undefined,
  scale: number = DECIMAL_SCALE,
): bigint | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!raw || !DECIMAL_PATTERN.test(raw)) return null;

  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [intPart = "0", fracPart = ""] = unsigned.split(".");
  const digits = BigInt((intPart || "0") + fracPart.padEnd(scale, "0").slice(0, scale));

  // Dígito seguinte ao corte decide o arredondamento (meio pra cima).
  const roundUp = fracPart.length > scale && fracPart.charCodeAt(scale) >= 53;
  const scaled = roundUp ? digits + 1n : digits;
  return negative ? -scaled : scaled;
}

export function formatScaled(
  value: bigint,
  scale: number = DECIMAL_SCALE,
): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = pow10(scale);
  const intPart = abs / base;
  const fracPart = (abs % base).toString().padStart(scale, "0");
  const text = scale > 0 ? `${intPart}.${fracPart}` : `${intPart}`;
  return negative && abs !== 0n ? `-${text}` : text;
}

/** a * b, ambos em `scale`, resultado em `scale`. */
export function mulScaled(
  a: bigint,
  b: bigint,
  scale: number = DECIMAL_SCALE,
): bigint {
  return divRound(a * b, pow10(scale));
}

/** a / b, ambos em `scale`, resultado em `scale`. */
export function divScaled(
  a: bigint,
  b: bigint,
  scale: number = DECIMAL_SCALE,
): bigint {
  return divRound(a * pow10(scale), b);
}

/** Reduz de `fromScale` pra `toScale` com arredondamento. */
export function rescale(
  value: bigint,
  fromScale: number,
  toScale: number,
): bigint {
  if (fromScale === toScale) return value;
  if (toScale > fromScale) return value * pow10(toScale - fromScale);
  return divRound(value, pow10(fromScale - toScale));
}
