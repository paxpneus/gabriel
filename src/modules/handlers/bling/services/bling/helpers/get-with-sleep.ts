import { AxiosInstance } from "axios";
const BLING_ORDER_REQUEST_DELAY_MS = Number(
  process.env.BLING_ORDER_REQUEST_DELAY_MS ?? 0,
);
export const blingGet = async (url: string, blingApi: AxiosInstance): Promise<any> => {
  if (BLING_ORDER_REQUEST_DELAY_MS > 0) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, BLING_ORDER_REQUEST_DELAY_MS),
    );
  }
  return blingApi.get(url);
};
