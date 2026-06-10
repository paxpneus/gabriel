import { AxiosInstance, AxiosError } from "axios";
import { createAxiosInstance } from "../../../../config/axios";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { FullIntegration } from "../../../integrations/integrations/integrations.types";

// ─── Busca a integração Magento ───────────────────────────────────────────────
export const getMagentoIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: "Magento",
        type: "SYSTEM",
      },
    },
    cacheKey ? "Magento" : undefined,
  );

  if (!integration) throw new Error("Magento: integração não encontrada");

  return integration;
};

// ─── Instância Axios para Magento REST API ────────────────────────────────────
//
// A autenticação é via Bearer token (Access Token da Integration do Magento).
// Diferente do Bling (OAuth 2.0 com refresh), o token de Integration do Magento
// não expira — é revogado apenas manualmente no admin.
// Ref: https://ajuda.mageshop.com.br/api/magento2-rest-authentication
//
// O api_url da integração deve ser a base da loja, ex:
//   https://paxpneus.com.br
// O path /rest/V1 é concatenado aqui como baseURL.
//
export const magentoApi: AxiosInstance = createAxiosInstance({
  // api_url vem do banco (ex: "https://paxpneus.com.br")
  // baseURL será resolvido dinamicamente no interceptor de request
  baseURL: "",

  onRequest: async (config) => {
    const integration = await getMagentoIntegration("Magento");
    const token = integration.tokens;

    if (!token?.access_token) {
      throw new Error("Magento: access_token não encontrado no config_token");
    }

    // Monta a baseURL dinamicamente a partir do api_url cadastrado na integração
    // Garante que não haja barra dupla
    const base = integration.api_url.replace(/\/$/, "");
    config.baseURL = `${base}/rest/V1`;

    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token.access_token}`;
    config.headers["Content-Type"] = "application/json";
    config.headers["Accept"] = "application/json";

    return config;
  },

  onResponseError: async (error: unknown) => {
    
    // O token do Magento não expira — não há refresh automático.
    // Em caso de 401, o token foi revogado manualmente no admin e
    // precisa ser reemitido e atualizado no config_tokens.
    if (
    error instanceof AxiosError &&
    error.response?.status === 401
  ) {
      console.error(
        "[MagentoApi] 401 Unauthorized — o Access Token pode ter sido revogado. " +
          "Gere um novo token no admin do Magento em System > Integrations e " +
          "atualize o campo access_token no config_tokens.",
      );
    }

    return Promise.reject(error);
  },
});