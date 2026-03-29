import { AxiosInstance } from "axios";
import { blingApi, getBlingIntegration } from "../../api/bling_api.service";
import { blingOrderWebHookData } from "./bling-order.types";
import ordersService from "../../../../sales/orders/orders.service";
import customersService from "../../../../sales/customers/customers.service";
import { orderCreationAttributes } from "../../../../sales/orders/orders.types";
import RedisService from "../../../../../shared/utils/base-models/base-redis";
import { FullIntegration } from "../../../../integrations/integrations/integrations.types";
import { customerCreationAttributes } from "../../../../sales/customers/customers.types";

export class BlingOrderService {
  public blingApi: AxiosInstance;

  constructor(blingApi: AxiosInstance) {
    this.blingApi = blingApi;
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
    const customer = await this.getOrCreateCustomer(orderData.contato);

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

  
   // Lógica separada para gerenciar a existência do cliente
   
  private async getOrCreateCustomer(contato: any) {
    // Tenta encontrar o cliente existente
    let customer = await customersService.findOne({
      where: {
        name: contato.nome,
        document: contato.numeroDocumento,
      },
    });

    // Se não existir, cria um novo
    if (!customer) {
      const customerPayload: customerCreationAttributes = {
        name: contato.nome,
        type: contato.tipoPessoa,
        document: contato.numeroDocumento,
      };

      customer = await customersService.create(customerPayload);
    }

    return customer;
  }
}

export default BlingOrderService