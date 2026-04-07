import { AxiosInstance } from "axios";
import { blingApi } from "../../api/bling_api.service";
import { blingOrderResponse, blingOrdersParams } from "./bling.types";

export class BlingService {
  private blingApi: AxiosInstance;
  constructor() {
    this.blingApi = blingApi;
  }

  async getOrders(params: blingOrdersParams): Promise<blingOrderResponse[]> {
    try {
      const { data } = await this.blingApi.get(`/pedidos/vendas/`, {
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
