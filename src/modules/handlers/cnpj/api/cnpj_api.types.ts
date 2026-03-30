export interface NormalizedCNPJ {
  cnpj: string;
  razao_social: string;
  situacao_cadastral: string;
  cnae_principal: string;
  cnaes: string[]; 
}