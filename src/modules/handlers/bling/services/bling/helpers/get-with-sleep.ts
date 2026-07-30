import { AxiosInstance, AxiosResponse } from "axios";

const BLING_ORDER_REQUEST_DELAY_MS = Number(
  process.env.BLING_ORDER_REQUEST_DELAY_MS ?? 0,
);

export const blingGet = async <T = any>(
  url: string,
  blingApi: AxiosInstance,
): Promise<AxiosResponse<T>> => {
  if (BLING_ORDER_REQUEST_DELAY_MS > 0) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, BLING_ORDER_REQUEST_DELAY_MS),
    );
  }

  return blingApi.get<T>(url);
};