import { AxiosInstance } from "axios";
import { blingApi } from "../../api/bling_api.service";
import { blingOrderResponse, blingOrdersParams } from "./bling.types";
import { blingGet } from "./helpers/get-with-sleep";

export class BlingService {
  private blingApi: AxiosInstance;
  constructor() {
    this.blingApi = blingApi;
  }

  async getOrders(params: blingOrdersParams): Promise<blingOrderResponse[]> {
    try {
      const { data } = await blingGet(`/pedidos/vendas/`, this.blingApi, {
        params: params,
        paramsSerializer: {
          indexes: null,
        },
      });

      return data.data;
    } catch (error) {
      throw error;
    }
  }

  async getOrderById(id: number | string): Promise<void> {

  }
}
