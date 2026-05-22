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
import { mapOrder } from '../../../../../shared/utils/normalizers/bling/status-mapper';
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

      if (body.data.situacao.id === 6) {
        console.log(`[BLING ORDER SERVICE] Pedido: ${body.data.numero} com status em aberto, ignorando atualização`)
        return null;
      }

      // Busca o pedido completo na Bling
      const { data } = await this.blingApi.get(
        `/pedidos/vendas/${body.data.id}`,
      );
      console.log("token info", data);
      const orderData = data.data;

      // Busca o pedido no banco
      const existingOrder = await ordersService.findOne({
        where: {
          integrations_id: integration.id,
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

      const internalStatus = mapOrder(orderData.situacao.id)
      // Atualiza o pedido
      await ordersService.update(existingOrder.id, {
        number_order_channel: String(orderData.numeroLoja),
        actual_situation: String(orderData.situacao.id),
        totalPrice: Number(orderData.total),
        date: new Date(orderData.data),
        internal_status: internalStatus,
        source_system: "BLING",
        external_id: String(orderData.id),
        external_number: String(orderData.numero),
        external_store_order_number: String(orderData.numeroLoja ?? ""),
        external_status_id: String(orderData.situacao?.id ?? ""),
        external_status_name: String(orderData.situacao?.valor ?? ""),
        external_invoice_id: orderData.notaFiscal?.id
          ? String(orderData.notaFiscal.id)
          : undefined,
        external_store_id: orderData.loja?.id
          ? String(orderData.loja.id)
          : undefined,
        external_unit_business_id: orderData.loja?.unidadeNegocio?.id
          ? String(orderData.loja.unidadeNegocio.id)
          : undefined,
        source_payload: orderData,
        total_products: Number(orderData.totalProdutos ?? 0),
        total_order: Number(orderData.total ?? 0),
        discount_value: Number(orderData.desconto?.valor ?? 0),
        discount_type: orderData.desconto?.unidade
          ? String(orderData.desconto.unidade)
          : undefined,
        other_expenses: Number(orderData.outrasDespesas ?? 0),
        freight_charged: Number(orderData.transporte?.frete ?? 0),
        freight_cost: Number(orderData.taxas?.custoFrete ?? 0),
        freight_by_account:
          orderData.transporte?.fretePorConta !== undefined
            ? Number(orderData.transporte.fretePorConta)
            : undefined,
        gross_weight: Number(orderData.transporte?.pesoBruto ?? 0),
        tax_commission: Number(orderData.taxas?.taxaComissao ?? 0),
        tax_base_value: Number(orderData.taxas?.valorBase ?? 0),
      });

      console.log(
        `[BlingOrderService] Pedido ${orderData.numero} atualizado com sucesso`,
      );


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
    body: blingOrderWebHookData | {data: {id: number | string, numero?: string | number}},
  ): Promise<{ customer: any; cnaes: any[], orderSystem: any } | null> {
    console.log(body.data.id);
    try {

       const integration = await getBlingIntegration("Bling");

        const existingOrder = await ordersService.findOne({
        where: {
          integrations_id: integration.id,
          number_order_system: String(body.data.numero),
        },
      });

      if (existingOrder) {
        console.log(
          `[BlingOrderService] Pedido ${body.data.numero} já cadastrado. Pulando...`,
        );
        return await this.updateOrderFromBling(body as any);
      }


      const { data } = await this.blingApi.get(
        `/pedidos/vendas/${body.data.id}`,
      );
      const orderData = data.data;
     

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

    //TESTE

      if (!integration.allowed_channels?.includes(store.name)) {
        console.log("[BLING ORDER] Pedido não originado do mercado livre, ignorando...")
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
        integrations_id: integration.id,
        customer_id: customer.id,
        id_order_system: String(orderData.id),
        number_order_system: String(orderData.numero),
        number_order_channel: String(orderData.numeroLoja),
        date: new Date(orderData.data),
        totalPrice: Number(orderData.total),
        store_id: store.id,
        source_system: "BLING",
        external_id: String(orderData.id),
        external_number: String(orderData.numero),
        external_store_order_number: String(orderData.numeroLoja ?? ""),
        external_status_id: String(orderData.situacao?.id ?? ""),
        external_status_name: String(orderData.situacao?.valor ?? ""),
        external_invoice_id: orderData.notaFiscal?.id
          ? String(orderData.notaFiscal.id)
          : undefined,
        external_store_id: orderData.loja?.id
          ? String(orderData.loja.id)
          : undefined,
        external_unit_business_id: orderData.loja?.unidadeNegocio?.id
          ? String(orderData.loja.unidadeNegocio.id)
          : undefined,
        source_payload: orderData,
        total_products: Number(orderData.totalProdutos ?? 0),
        total_order: Number(orderData.total ?? 0),
        discount_value: Number(orderData.desconto?.valor ?? 0),
        discount_type: orderData.desconto?.unidade
          ? String(orderData.desconto.unidade)
          : undefined,
        other_expenses: Number(orderData.outrasDespesas ?? 0),
        freight_charged: Number(orderData.transporte?.frete ?? 0),
        freight_cost: Number(orderData.taxas?.custoFrete ?? 0),
        freight_by_account:
          orderData.transporte?.fretePorConta !== undefined
            ? Number(orderData.transporte.fretePorConta)
            : undefined,
        gross_weight: Number(orderData.transporte?.pesoBruto ?? 0),
        tax_commission: Number(orderData.taxas?.taxaComissao ?? 0),
        tax_base_value: Number(orderData.taxas?.valorBase ?? 0),
      };

      // 3. Cria o pedido
      const createdOrder = await ordersService.create(ordersPayload);

      const itemsPayload: orderItemsCreationAttributes[] = orderData.itens.map((i: any) => {
        const quantity = Number(i.quantidade ?? i.quantity ?? 0);
        const unitPrice = Number(i.valor ?? 0);
        const discountValue = Number(i.desconto ?? 0);
        return {
          name: i.descricao,
          order_id: createdOrder.id,
          sku: String(i.codigo),
          unit: i.unidade,
          quantity,
          price: unitPrice,
          source_system: "BLING",
          integrations_id: integration.id,
          external_item_id: i.id ? String(i.id) : undefined,
          external_product_id: i.produto?.id ? String(i.produto.id) : undefined,
          source_payload: i,
          unit_price: unitPrice,
          gross_total: unitPrice * quantity,
          discount_value: discountValue,
          net_total: unitPrice * quantity - discountValue,
          commission_base: Number(i.comissao?.base ?? 0),
          commission_rate: Number(i.comissao?.aliquota ?? 0),
          commission_value: Number(i.comissao?.valor ?? 0),
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
        ...createdOrder.dataValues,
        customer,
        items: createdItems
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
