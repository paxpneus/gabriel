// Fragmentos SQL puros (string) — servem tanto a SQL cru quanto a Sequelize.literal(). Expressões vêm do código, nunca de input.
export type SqlExpression = string;

export function coalesceZero(expression: SqlExpression): SqlExpression {
  return `COALESCE(${expression}, 0)`;
}

export function roundTo(expression: SqlExpression, decimals = 2): SqlExpression {
  return `ROUND((${expression})::numeric, ${decimals})`;
}

/** base − d1 − d2 − …, com cada parcela nula tratada como 0. */
export function subtractAll(
  base: SqlExpression,
  deductions: SqlExpression[],
): SqlExpression {
  return [coalesceZero(base), ...deductions.map(coalesceZero)].join(" - ");
}

/** numerator / denominator arredondado; 0 quando o denominador é 0 ou nulo. */
export function safeDivide(
  numerator: SqlExpression,
  denominator: SqlExpression,
  decimals = 2,
): SqlExpression {
  return `CASE WHEN ${coalesceZero(denominator)} = 0 THEN 0 ELSE ${roundTo(
    `(${numerator}) / NULLIF((${denominator}), 0)`,
    decimals,
  )} END`;
}

export function percentOf(
  part: SqlExpression,
  total: SqlExpression,
): SqlExpression {
  return safeDivide(`(${part}) * 100`, total, 2);
}

/** (receita − custo) / custo, em %. */
export function markupPct(
  revenue: SqlExpression,
  cost: SqlExpression,
): SqlExpression {
  return percentOf(subtractAll(revenue, [cost]), cost);
}
