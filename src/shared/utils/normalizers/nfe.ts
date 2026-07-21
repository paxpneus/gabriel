/**
 * Extrai a série da NF-e a partir da chave de acesso (44 dígitos).
 * A série ocupa as posições 23 a 25 (1-indexed) da chave.
 */
export function extractSerieFromChaveNfe(chave?: string | null): string | undefined {
  if (!chave || chave.length !== 44) return undefined;
  return chave.substring(22, 25); 
}