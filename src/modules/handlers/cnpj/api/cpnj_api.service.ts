import { AxiosInstance } from "axios";
import { createAxiosInstance } from "../../../../config/axios";
import { cleanDocument } from "../../../../shared/utils/normalizers/document";

const CNPJ_PROVIDERS = [
  {
    api: 'openCNPJ',
    url: 'https://api.opencnpj.org/',
    buildPath: (cnpj: string) => cnpj,
  },
  {
    api: 'brasilAPI',
    url: 'https://brasilapi.com.br/api/cnpj/v1/',
    buildPath: (cnpj: string) => cnpj,
  },
]

// Cria uma instância por provider
const providerInstances: AxiosInstance[] = CNPJ_PROVIDERS.map(({ url }) =>
  createAxiosInstance({ baseURL: url })
)

// Tenta cada provider em sequência até um responder com sucesso
export const fetchCNPJ = async <T = unknown>(cnpj: string): Promise<T> => {
  let lastError: unknown
  const cleanCNPJ = cleanDocument(cnpj)

  for (let i = 0; i < CNPJ_PROVIDERS.length; i++) {
    const provider = CNPJ_PROVIDERS[i]
    const instance = providerInstances[i]

    try {
      const { data } = await instance.get<T>(provider.buildPath(cleanCNPJ))
      return data
    } catch (error) {
      console.warn(`[CNPJ] Falha no provider "${provider.api}", tentando próximo...`, error)
      lastError = error
    }
  }

  throw new Error(`[CNPJ] Todos os providers falharam. Último erro: ${lastError}`)
}