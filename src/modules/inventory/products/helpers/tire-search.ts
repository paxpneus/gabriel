// Escapa caracteres especiais de regex num texto literal.
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Regex estrita da medida no nome (Postgres `~*` e JS): números iguais, só espaço tolerado em volta dos separadores.
 * Bordas barram dígito colado (`112.5/80-18`, `12.5/80-180`); sufixo de letra (`LT`, `C`) continua casando.
 */
export function buildMeasureNameRegex(measure: string): string {
  const compact = measure.trim().replace(/\s+/g, "");
  // Números (com decimal) intercalados com separadores (`/`, `-`, `R`, `X`, `ZR`...).
  const parts = compact.match(/\d+(?:\.\d+)?|[^\d]+/g) ?? [];
  const body = parts
    .map((part) => (/^\d/.test(part) ? escapeRegex(part) : `\\s*${escapeRegex(part)}\\s*`))
    .join("");
  return `(?<![0-9.])${body}(?![0-9]|\\.[0-9])`;
}

/** Regex JS (case-insensitive) de um termo isolado no nome: `R4` casa em `R4 R3` e não em `R44`; `91` casa em `91V`. */
export function buildTokenRegex(token: string): RegExp {
  return new RegExp(`(?<![0-9a-z])${escapeRegex(token.trim())}(?![0-9])`, "i");
}
