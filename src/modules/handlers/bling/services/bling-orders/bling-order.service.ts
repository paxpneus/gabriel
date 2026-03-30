import { AxiosInstance } from "axios";
import { getBlingIntegration } from "../../api/bling_api.service";
import { blingOrderWebHookData } from "./bling-order.types";
import ordersService, {
  OrderService,
} from "../../../../sales/orders/orders.service";
import { orderCreationAttributes } from "../../../../sales/orders/orders.types";
import { BlingCustomerService } from "../bling-customers/bling-customer.service";
import { CNPJQueue } from "../../../cnpj/services/cnpj.queue";
import { executeWebhookAction } from "../../../../../shared/utils/normalizers/webhook";
export class BlingOrderService {
  public blingApi: AxiosInstance;
  private blingCustomerService: BlingCustomerService;
  private cnpjQueue: CNPJQueue;

  constructor(blingApi: AxiosInstance, cnpjQueue: CNPJQueue) {
    this.blingApi = blingApi;
    this.blingCustomerService = new BlingCustomerService(blingApi);
    this.cnpjQueue = cnpjQueue;
  }

  async processWebhook(action: string, body: any): Promise<void> {
    // Definimos o mapa de ações para este serviço específico
    const handlers = {
      'order.created': (data: any) => this.createOrderFromBling(data),
      'order.updated': (data: any) => this.updateOrderFromBling(data),
      'order.deleted': (data: any) => this.deleteOrderFromBling(data),
    };

    // Chama a função global utilitária
    await executeWebhookAction(action, body, handlers);
  }

async updateOrderFromBling(body: blingOrderWebHookData): Promise<void> {
  try {
    const integration = await getBlingIntegration("Bling")
    if (!integration) throw new Error("Bling Integration não encontrada no cache")

    // Busca o pedido completo na Bling
    const { data } = await this.blingApi.get(`/pedidos/vendas/${body.data.id}`)
    console.log('token info', data)
    const orderData = data.data

    // Busca o pedido no banco
    const existingOrder = await ordersService.findOne({
      where: {
        integration_id: integration.id,
        number_order_system: String(orderData.numero),
      },
    })

    if (!existingOrder) {
      console.log(`[BlingOrderService] Pedido ${orderData.numero} não encontrado para atualizar, criando...`)
      await this.createOrderFromBling(body)
      return
    }

    // Atualiza o customer
    await this.blingCustomerService.updateCustomer(orderData.contato)

    // Atualiza o pedido
    await ordersService.update(
      existingOrder.id,
      {
        number_order_channel: String(orderData.numeroLoja),
        actual_situation: String(orderData.situacao.id),
      },
    )

    console.log(`[BlingOrderService] Pedido ${orderData.numero} atualizado com sucesso`)

    // Se status virou 15, dispara NFe
    if (orderData.situacao.id === 15) {
      console.log(`[BlingOrderService] Status 15 detectado, disparando NFe...`)
      // await this.nfeQueue.add({ order_id: orderData.id, collection_date: '' }, `nfe-generation-${orderData.id}`)
    }

  } catch (error: any) {
    console.error("[BlingOrderService] Erro ao atualizar pedido:", error.response?.data ?? error.message)
    throw error
  }
}

async deleteOrderFromBling(body: any): Promise<void> {
  try {
    const integration = await getBlingIntegration("Bling")
    if (!integration) throw new Error("Bling Integration não encontrada no cache")

    const orderId = body.data.id

    const existingOrder = await ordersService.findOne({
      where: {
        id_order_system: String(orderId)
      },
    })

    if (!existingOrder) {
      console.log(`[BlingOrderService] Pedido ${orderId} não encontrado para deletar. Pulando...`)
      return
    }

    await ordersService.delete(existingOrder.id)
    console.log(`[BlingOrderService] Pedido ${orderId} removido com sucesso`)

  } catch (error: any) {
    console.error("[BlingOrderService] Erro ao deletar pedido:", error.response?.data ?? error.message)
    throw error
  }
}

  //Método principal para processar o webhook e criar o pedido

  async createOrderFromBling(body: blingOrderWebHookData): Promise<void> {
    console.log(body.data.id)
    try {
      const { data } = await this.blingApi.get(`/pedidos/vendas/${body.data.id}`);
      const orderData = data.data;
      const integration = await getBlingIntegration("Bling");

      if (!integration) {
        throw new Error("Bling Integration não encontrada no cache");
      }

      const existingOrder = await ordersService.findOne({
        where: {
          integration_id: integration.id,
          number_order_system: String(orderData.numero),
        },
      });

      if (existingOrder) {
        console.log(
          `[BlingOrderService] Pedido ${orderData.numero} já cadastrado. Pulando...`,
        );
        return;
      }

      // 1. Resolve o cliente (Busca ou Cria)
      const customer = await this.blingCustomerService.getOrCreateCustomer(
        orderData.contato,
      );

      // 2. Prepara o payload do pedido
      const ordersPayload: orderCreationAttributes = {
        integration_id: integration.id,
        customer_id: customer.id,
        id_order_system: String(orderData.id),
        number_order_system: String(orderData.numero),
        number_order_channel: String(orderData.numeroLoja),
      };

      // 3. Cria o pedido
      const createdOrder = await ordersService.create(ordersPayload);
      
      if (orderData.situacao.id != 6) {
        console.log('Pedido com status diferente de "EM ABERTO", pulando etapas de automação apenas salvando no sistema.')
        return
      }

        await this.cnpjQueue.add(
          { customer, cnaes: integration.cnaes, order: orderData},
          `document-check-${customer.id}`,
        );
    } catch (error: any) {
      console.error(
        "[BlingOrderService] Erro ao processar pedido:",
        error.response?.data ?? error.message,
      );
      throw error;
    }
  }
}

export default BlingOrderService;
