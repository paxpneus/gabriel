import { AxiosInstance } from "axios";
import { getBlingIntegration } from "../../api/bling_api.service";
import { blingOrderWebHookData } from "./bling-order.types";
import ordersService from "../../../../sales/orders/orders.service";
import { orderCreationAttributes } from "../../../../sales/orders/orders.types";
import {BlingCustomerService} from "../bling-customers/bling-customer.service";
export class BlingOrderService {
  public blingApi: AxiosInstance;
  private blingCustomerService: BlingCustomerService

  constructor(blingApi: AxiosInstance) {
    this.blingApi = blingApi;
    this.blingCustomerService = new BlingCustomerService(blingApi)
  }

  
   //Método principal para processar o webhook e criar o pedido
   
  async createOrderFromBling(body: blingOrderWebHookData): Promise<void> {
    const {data} = await this.blingApi.get(`/pedidos/vendas/${body.id}`);
      const orderData = data.data
    const integration = await getBlingIntegration('Bling')

    if (!integration) {
      throw new Error("Bling Integration não encontrada no cache");
    }

    // 1. Resolve o cliente (Busca ou Cria)
    const customer = await this.blingCustomerService.getOrCreateCustomer(orderData.contato);

    // 2. Prepara o payload do pedido
    const ordersPayload: orderCreationAttributes = {
      integration_id: integration.id,
      customer_id: customer.id,
      number_order_system: orderData.numero,
      number_order_channel: orderData.numeroLoja,
    };

    // 3. Cria o pedido
    await ordersService.create(ordersPayload);
  }   
  
}

export default BlingOrderService