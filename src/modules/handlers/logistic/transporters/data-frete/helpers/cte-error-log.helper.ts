import Cte from "../../../../../warehouse/fiscal/ctes/cte/cte.model";
import {
  extractDatafreteTransportadorCnpj,
  isDatafreteTransportadorNaoEncontrado,
} from "./error-codes";

export interface CteDatafreteErrorLogFields {
  internalId: string | null;
  externalId: string | null;
  reference: string;
}

// Transportador não encontrado é falha do transportador (conta Datafrete sem
// aquele CNPJ cadastrado), não do CT-e — agrupa por CNPJ (external_id) em vez
// de por CT-e (internal_id), senão cada CT-e do mesmo transportador não
// mapeado vira uma linha nova em integration_errors (chegou a 300+ linhas
// pro mesmo transportador em produção).
export function buildCteDatafreteErrorLogFields(
  error: unknown,
  cte: Cte,
): CteDatafreteErrorLogFields {
  if (isDatafreteTransportadorNaoEncontrado(error)) {
    const transportadorCnpj = extractDatafreteTransportadorCnpj(error);
    if (transportadorCnpj) {
      return { internalId: null, externalId: transportadorCnpj, reference: transportadorCnpj };
    }
  }

  return {
    internalId: cte.id,
    externalId: null,
    reference: cte.xml_key ?? String(cte.number),
  };
}
