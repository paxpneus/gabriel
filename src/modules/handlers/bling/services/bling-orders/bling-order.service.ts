import { AxiosInstance } from "axios";
import { getBlingIntegration } from "../../api/bling_api.service";
import { blingOrderWebHookData } from "./bling-order.types";
import ordersService, { OrderService } from "../../../../sales/orders/orders.service";
import { orderCreationAttributes } from "../../../../sales/orders/orders.types";
import {BlingCustomerService} from "../bling-customers/bling-customer.service";
import { CNPJQueue } from "../../../cnpj/services/cnpj.queue";
export class BlingOrderService {
  public blingApi: AxiosInstance;
  private blingCustomerService: BlingCustomerService
  private cnpjQueue: CNPJQueue

  constructor(blingApi: AxiosInstance, cnpjQueue: CNPJQueue) {
    this.blingApi = blingApi;
    this.blingCustomerService = new BlingCustomerService(blingApi)
    this.cnpjQueue = cnpjQueue
  }

  
   //Método principal para processar o webhook e criar o pedido
   
  async createOrderFromBling(body: blingOrderWebHookData): Promise<void> {
    try {
    const {data} = await this.blingApi.get(`/pedidos/vendas/${body.id}`);
      const orderData = data.data
    const integration = await getBlingIntegration('Bling')

    if (!integration) {
      throw new Error("Bling Integration não encontrada no cache");
    }

      const existingOrder = await ordersService.findOne({
      where: {
        integration_id: integration.id,
        number_order_system: String(orderData.numero),
      }
    })

    if (existingOrder) {
      console.log(`[BlingOrderService] Pedido ${orderData.numero} já cadastrado. Pulando...`);
      return; 
    }


    // 1. Resolve o cliente (Busca ou Cria)
    const customer = await this.blingCustomerService.getOrCreateCustomer(orderData.contato);

    // 2. Prepara o payload do pedido
    const ordersPayload: orderCreationAttributes = {
      integration_id: integration.id,
      customer_id: customer.id,
      number_order_system: String(orderData.numero),
      number_order_channel: String(orderData.numeroLoja),
    };

  
    // 3. Cria o pedido
    await ordersService.create(ordersPayload);

    if (customer.document && orderData.contato.tipoPessoa === 'J') {
    await this.cnpjQueue.add(
        { customer, cnaes: integration.cnaes },
        `cnpj-check-${customer.id}`
    )
} else if (customer.document && orderData.contato.tipoPessoa === 'F') {
      console.log(`[BlingOrderService] Cliente CPF ${customer.document}, pulando validação de CNAE`)

}
  } catch (error: any) {
      console.error('[BlingOrderService] Erro ao processar pedido:', error.response?.data ?? error.message)
        throw error
  }
  }   
  
}

export default BlingOrderService