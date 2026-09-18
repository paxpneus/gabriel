import axios from 'axios';

// ─── codigo_retorno da Datafrete — mapa central, não usar o número solto no código ──

export enum DatafreteCodigoRetorno {
  CTE_JA_CADASTRADO = 714,
  TRANSPORTADOR_NAO_ENCONTRADO = 712,
}

const DATAFRETE_CODIGO_RETORNO_LABELS: Record<number, string> = {
  [DatafreteCodigoRetorno.CTE_JA_CADASTRADO]:
    'CT-e já cadastrado na base da Datafrete (duplicado, não é erro real)',
  [DatafreteCodigoRetorno.TRANSPORTADOR_NAO_ENCONTRADO]:
    'Transportador do CT-e não cadastrado na conta Datafrete',
};

export function describeDatafreteCodigoRetorno(codigoRetorno: number): string {
  return DATAFRETE_CODIGO_RETORNO_LABELS[codigoRetorno] ?? `codigo_retorno desconhecido (${codigoRetorno})`;
}

export function extractDatafreteCodigoRetorno(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;

  const data = error.response?.data as { codigo_retorno?: number } | undefined;
  return typeof data?.codigo_retorno === 'number' ? data.codigo_retorno : null;
}

export function isDatafreteCteAlreadyCadastrado(error: unknown): boolean {
  return extractDatafreteCodigoRetorno(error) === DatafreteCodigoRetorno.CTE_JA_CADASTRADO;
}
