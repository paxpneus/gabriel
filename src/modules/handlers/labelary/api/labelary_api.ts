import axios, { AxiosInstance } from "axios";
import { createAxiosInstance } from "../../../../config/axios";

export const labelaryApi: AxiosInstance = createAxiosInstance({
  baseURL: "https://api.labelary.com",

  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    console.error(
      `[LabelaryApi] Erro na requisição: ${error.response?.status} ${error.response?.statusText}`,
    );

    return Promise.reject(error);
  },
});