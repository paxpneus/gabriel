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

// `mensagem` da própria resposta da Datafrete — mais específica que o label
// genérico de `describeDatafreteCodigoRetorno` (ex.: já vem com o CNPJ do
// transportador não encontrado, o label genérico não tem esse dado).
export function extractDatafreteMensagem(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;

  const data = error.response?.data as { mensagem?: string } | undefined;
  return typeof data?.mensagem === 'string' ? data.mensagem : null;
}

export function isDatafreteCteAlreadyCadastrado(error: unknown): boolean {
  return extractDatafreteCodigoRetorno(error) === DatafreteCodigoRetorno.CTE_JA_CADASTRADO;
}
