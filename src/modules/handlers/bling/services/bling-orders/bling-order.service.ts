import orderItemsService from './../../../../sales/orders/order_items/order_items.service';
import { AxiosInstance } from "axios";
import { getBlingIntegration } from "../../api/bling_api.service";
import { blingOrderWebHookData } from "./bling-order.types";
import ordersService, {
  OrderService,
} from "../../../../sales/orders/order/orders.service";
import { orderCreationAttributes } from "../../../../sales/orders/order/orders.types";
import { BlingCustomerService } from "../bling-customers/bling-customer.service";
import { CNPJQueue } from "../../../cnpj/services/cnpj.queue";
import { executeWebhookAction } from "../../../../../shared/utils/normalizers/webhook";
import { orderItemsCreationAttributes } from "../../../../sales/orders/order_items/order_items.types";
import { StoreService } from '../../../../sales/stores/stores.service';
export class BlingOrderService {
  public blingApi: AxiosInstance;
  private blingCustomerService: BlingCustomerService;
  private storeService: StoreService

  constructor(blingApi: AxiosInstance) {
    this.blingApi = blingApi;
    this.blingCustomerService = new BlingCustomerService(blingApi);
    this.storeService = new StoreService();
  }

  async processWebhook(
    action: string,
    body: any,
  ): Promise<{ customer: any; cnaes: any[]; orderSystem: any } | null> {
    // Definimos o mapa de ações para este serviço específico
    const handlers = {
      "order.created": (data: any) => this.createOrderFromBling(data),
      "order.updated": (data: any) => this.updateOrderFromBling(data),
      "order.deleted": (data: any) => this.deleteOrderFromBling(data),
    };

    // Chama a função global utilitária
    return await executeWebhookAction(action, body, handlers);
  }

  async updateOrderFromBling(body: blingOrderWebHookData): Promise<null> {
    try {
      const integration = await getBlingIntegration("Bling");
      if (!integration)
        throw new Error("Bling Integration não encontrada no cache");

      // Busca o pedido completo na Bling
      const { data } = await this.blingApi.get(
        `/pedidos/vendas/${body.data.id}`,
      );
      console.log("token info", data);
      const orderData = data.data;

      // Busca o pedido no banco
      const existingOrder = await ordersService.findOne({
        where: {
          integration_id: integration.id,
          number_order_system: String(orderData.numero),
        },
      });

      if (!existingOrder) {
        console.log(
          `[BlingOrderService] Pedido ${orderData.numero} não encontrado para atualizar, pulando...`,
        );
        // await this.createOrderFromBling(body);
        return null;
      }

      // Atualiza o customer
      await this.blingCustomerService.updateCustomer(orderData.contato);

      // Atualiza o pedido
      await ordersService.update(existingOrder.id, {
        number_order_channel: String(orderData.numeroLoja),
        actual_situation: String(orderData.situacao.id),
        totalPrice: Number(orderData.total),
        date: new Date(orderData.data),
      });

      console.log(
        `[BlingOrderService] Pedido ${orderData.numero} atualizado com sucesso`,
      );

      // Se status virou 15, dispara NFe
      if (orderData.situacao.id === 15) {
        console.log(
          `[BlingOrderService] Status 15 detectado, disparando NFe...`,
        );
        // await this.nfeQueue.add({ order_id: orderData.id, collection_date: '' }, `nfe-generation-${orderData.id}`)
        return null;
      }

      if (orderData.situacao.id === 12) {
        console.log(`[BlingOrderService] Status 12 detectado, cancelando jobs`);

        await ordersService.update(existingOrder.id, {
          internal_status: "CANCELLED",
        });

        return null;
      }

      return null;
    } catch (error: any) {
      console.error(
        "[BlingOrderService] Erro ao atualizar pedido:",
        error.response?.data ?? error.message,
      );
      throw error;
    }
  }

  async deleteOrderFromBling(body: any): Promise<null> {
    try {
      const integration = await getBlingIntegration("Bling");
      if (!integration)
        throw new Error("Bling Integration não encontrada no cache");

      const orderId = body.data.id;

      const existingOrder = await ordersService.findOne({
        where: {
          id_order_system: String(orderId),
        },
      });

      if (!existingOrder) {
        console.log(
          `[BlingOrderService] Pedido ${orderId} não encontrado para deletar. Pulando...`,
        );
        return null;
      }

      await ordersService.delete(existingOrder.id);
      console.log(`[BlingOrderService] Pedido ${orderId} removido com sucesso`);

      return null;
    } catch (error: any) {
      console.error(
        "[BlingOrderService] Erro ao deletar pedido:",
        error.response?.data ?? error.message,
      );
      throw error;
    }
  }

  //Método principal para processar o webhook e criar o pedido

  async createOrderFromBling(
    body: blingOrderWebHookData | {data: {id: number | string}},
  ): Promise<{ customer: any; cnaes: any[], orderSystem: any } | null> {
    console.log(body.data.id);
    try {
      const { data } = await this.blingApi.get(
        `/pedidos/vendas/${body.data.id}`,
      );
      const orderData = data.data;
      const integration = await getBlingIntegration("Bling");

      let store
      store = await this.storeService.findOne({
        where: {id_store_system: String(orderData.loja.id)}
      })

      if (!store) {
        const blingStore = await this.blingApi.get(`/canais-venda/${orderData.loja.id}`)


        store = await this.storeService.create({
             name: blingStore.data.data.tipo,
             id_store_system: blingStore.data.data.id

        })
      }

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
        return null;
      }

      if (!integration.allowed_channels?.includes(store.name)) {
        console.log("[DEBUG] channel.data.tipo:", store.name);
        console.log(
          "[DEBUG] integration.allowed_channels:",
          integration.allowed_channels,
        );
        console.log(
          "[DEBUG] includes?",
          integration.allowed_channels?.includes(store.name),
        );
        return null;
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
        date: new Date(orderData.data),
        totalPrice: Number(orderData.total),
        store_id: store.id,
      };

      // 3. Cria o pedido
      const createdOrder = await ordersService.create(ordersPayload);

      const itemsPayload: orderItemsCreationAttributes[] = orderData.itens.map((i: Record<string, string | number>) => {
        return {
          name: i.descricao,
          order_id: createdOrder.id,
          sku: String(i.codigo),
          unit: i.unidade,
          quantity: i.quantity,
          price: i.valor,
        }
      })

      const createdItems = await orderItemsService.bulkCreate(itemsPayload)

      if (orderData.situacao.id != 6) {
        console.log(
          'Pedido com status diferente de "EM ABERTO", pulando etapas de automação apenas salvando no sistema.',
        );
        return null;
      }


      return { customer, cnaes: integration.cnaes, orderSystem: {
        ...createdOrder,
        ...customer,
        ...createdItems
      } };
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
