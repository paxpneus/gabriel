import { AxiosInstance } from "axios";
import { createAxiosInstance } from "../../../../config/axios";
import { cleanDocument } from "../../../../shared/utils/normalizers/document";
import { NormalizedCNPJ } from "./cnpj_api.types";
const CNPJ_PROVIDERS = [
  {
    api: "openCNPJ",
    url: "https://api.opencnpj.org/",
    buildPath: (cnpj: string) => cnpj,
    normalize: (data: any): NormalizedCNPJ => ({
      cnpj: data.cnpj,
      razao_social: data.razao_social,
      situacao_cadastral: data.situacao_cadastral.toUpperCase(),
      cnae_principal: String(data.cnae_principal),
      cnaes: [
        String(data.cnae_principal),
        ...(data.cnaes_secundarios || []).map((c: any) => String(c)),
      ],
    }),
  },
  {
    api: "brasilAPI",
    url: "https://brasilapi.com.br/api/cnpj/v1/",
    buildPath: (cnpj: string) => cnpj,
    normalize: (data: any): NormalizedCNPJ => ({
      cnpj: data.cnpj,
      razao_social: data.razao_social,
      situacao_cadastral: data.descricao_situacao_cadastral.toUpperCase(),
      cnae_principal: String(data.cnae_fiscal),
      cnaes: [
        String(data.cnae_fiscal),
        ...(data.cnaes_secundarios || []).map((c: any) => String(c.codigo)),
      ],
    }),
  },
];

// Cria uma instância por provider
const providerInstances: AxiosInstance[] = CNPJ_PROVIDERS.map(({ url }) =>
  createAxiosInstance({ baseURL: url }),
);

// Tenta cada provider em sequência até um responder com sucesso
export const fetchCNPJ = async (cnpj: string | number): Promise<NormalizedCNPJ> => {
  const cleanedCNPJ = cleanDocument(String(cnpj))
  console.log("CNPJ PARA VERIFICAR", cleanedCNPJ)

  if (cleanedCNPJ.length !== 14) {
    throw new Error(`[CNPJ] CNPJ inválido: ${cnpj}`);
  }

  let lastError: unknown;

  for (let i = 0; i < CNPJ_PROVIDERS.length; i++) {
    const provider = CNPJ_PROVIDERS[i];
    const instance = providerInstances[i];

    try {
      const { data } = await instance.get(provider.buildPath(cleanedCNPJ));
      return provider.normalize(data);
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.warn(`[CNPJ] CNPJ ${cleanedCNPJ} não encontrado no provider ${provider.api}`);
        throw new Error(`[CNPJ] CNPJ ${cleanedCNPJ} não encontrado em nenhum provider`);
      }

      console.warn(`[CNPJ] Provider ${provider.api} falhou:`, error.response?.status, error.message);
      const sleep = Math.floor(Math.random() * 2000) + 1000;
      console.log(`[CNPJ] Aguardando ${sleep}ms antes de tentar próximo provider...`);
      await new Promise((resolve) => setTimeout(resolve, sleep));
      lastError = error;
    }
  }

  throw new Error(`[CNPJ] Todos os providers falharam. Último erro: ${lastError}`);
};
