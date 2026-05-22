import orderItemsService from "./../../../../sales/orders/order_items/order_items.service";
import { AxiosInstance } from "axios";
import { getBlingIntegration } from "../../api/bling_api.service";
import { blingOrderWebHookData } from "./bling-order.types";
import ordersService from "../../../../sales/orders/order/orders.service";
import { orderCreationAttributes } from "../../../../sales/orders/order/orders.types";
import { BlingCustomerService } from "../bling-customers/bling-customer.service";
import { executeWebhookAction } from "../../../../../shared/utils/normalizers/webhook";
import { orderItemsCreationAttributes } from "../../../../sales/orders/order_items/order_items.types";
import { StoreService } from "../../../../sales/stores/stores.service";
import { mapOrder } from "../../../../../shared/utils/normalizers/bling/status-mapper";
import { Product } from "../../../../inventory";
import { Op } from "sequelize";

export class BlingOrderService {
  public blingApi: AxiosInstance;
  private blingCustomerService: BlingCustomerService;
  private storeService: StoreService;

  constructor(blingApi: AxiosInstance) {
    this.blingApi = blingApi;
    this.blingCustomerService = new BlingCustomerService(blingApi);
    this.storeService = new StoreService();
  }

  async processWebhook(
    action: string,
    body: any,
  ): Promise<{ customer: any; cnaes: any[]; orderSystem: any } | null> {
    const handlers = {
      "order.created": (data: any) => this.createOrderFromBling(data),
      "order.updated": (data: any) => this.updateOrderFromBling(data),
      "order.deleted": (data: any) => this.deleteOrderFromBling(data),
    };

    return await executeWebhookAction(action, body, handlers);
  }

  // ─── Resolve product_id interno para um item da Bling ──────────────────────
  // Tenta por id_system (= external_product_id da Bling) e depois por sku.
  private async resolveProductId(
    externalProductId: string | undefined,
    sku: string | undefined,
  ): Promise<string | undefined> {
    if (!externalProductId && !sku) return undefined;

    const conditions: any[] = [];
    if (externalProductId) conditions.push({ id_system: externalProductId });
    if (sku) conditions.push({ sku });

    const product = await Product.findOne({
      where: { [Op.or]: conditions },
      attributes: ["id"],
    });

    return product?.id ?? undefined;
  }

  // ─── Monta payload de itens com product_id resolvido ───────────────────────
  private async buildItemsPayload(
    orderId: string,
    integrationId: string,
    blingItems: any[],
  ): Promise<orderItemsCreationAttributes[]> {
    return Promise.all(
      blingItems.map(async (i: any) => {
        const quantity = Number(i.quantidade ?? i.quantity ?? 0);
        const unitPrice = Number(i.valor ?? 0);
        const discountValue = Number(i.desconto ?? 0);
        const externalProductId = i.produto?.id
          ? String(i.produto.id)
          : undefined;
        const sku = i.codigo ? String(i.codigo) : undefined;

        const productId = await this.resolveProductId(externalProductId, sku);

        return {
          name: i.descricao,
          order_id: orderId,
          sku: sku ?? "",
          unit: i.unidade,
          quantity,
          price: unitPrice,
          product_id: productId,
          source_payload: i,
          unit_price: unitPrice,
          gross_total: unitPrice * quantity,
          discount_value: discountValue,
          net_total: unitPrice * quantity - discountValue,
          commission_base: Number(i.comissao?.base ?? 0),
          commission_rate: Number(i.comissao?.aliquota ?? 0),
          commission_value: Number(i.comissao?.valor ?? 0),
        };
      }),
    );
  }

  async updateOrderFromBling(body: blingOrderWebHookData): Promise<null> {
    try {
      const integration = await getBlingIntegration("Bling");
      if (!integration)
        throw new Error("Bling Integration não encontrada no cache");

      if (body.data.situacao.id === 6) {
        console.log(
          `[BLING ORDER SERVICE] Pedido: ${body.data.numero} com status em aberto, ignorando atualização`,
        );
        return null;
      }

      const { data } = await this.blingApi.get(
        `/pedidos/vendas/${body.data.id}`,
      );
      const orderData = data.data;

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
        return null;
      }

      await this.blingCustomerService.updateCustomer(orderData.contato);

      const internalStatus = mapOrder(orderData.situacao.id);

      await ordersService.update(existingOrder.id, {
        number_order_channel: String(orderData.numeroLoja),
        actual_situation: String(orderData.situacao.id),
        totalPrice: Number(orderData.total),
        date: new Date(orderData.data),
        internal_status: internalStatus,
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

      // Atualiza itens com product_id resolvido — preserva itens que não vieram
      // no payload fazendo upsert individual por external_item_id
      if (orderData.itens?.length) {
        for (const i of orderData.itens) {
          const quantity = Number(i.quantidade ?? 0);
          const unitPrice = Number(i.valor ?? 0);
          const discountValue = Number(i.desconto ?? 0);
          const externalProductId = i.produto?.id
            ? String(i.produto.id)
            : undefined;
          const sku = i.codigo ? String(i.codigo) : undefined;

          const productId = await this.resolveProductId(externalProductId, sku);

          const existingItem = sku
            ? await orderItemsService.findOne({
                where: { order_id: existingOrder.id, sku },
              })
            : null;

          if (existingItem) {
            await orderItemsService.update(existingItem.id, {
              quantity,
              price: unitPrice,
              unit_price: unitPrice,
              gross_total: unitPrice * quantity,
              discount_value: discountValue,
              net_total: unitPrice * quantity - discountValue,
              commission_base: Number(i.comissao?.base ?? 0),
              commission_rate: Number(i.comissao?.aliquota ?? 0),
              commission_value: Number(i.comissao?.valor ?? 0),

              ...(productId ? { product_id: productId } : {}),
              source_payload: i,
            });
          } else {
            await orderItemsService.create({
              name: i.descricao,
              order_id: existingOrder.id,
              sku: sku ?? "",
              unit: i.unidade,
              quantity,
              price: unitPrice,
              product_id: productId,
              integrations_id: integration.id,
              source_payload: i,
              unit_price: unitPrice,
              gross_total: unitPrice * quantity,
              discount_value: discountValue,
              net_total: unitPrice * quantity - discountValue,
              commission_base: Number(i.comissao?.base ?? 0),
              commission_rate: Number(i.comissao?.aliquota ?? 0),
              commission_value: Number(i.comissao?.valor ?? 0),
            });
          }
        }
      }

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
        where: { id_order_system: String(orderId) },
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

  async createOrderFromBling(
    body:
      | blingOrderWebHookData
      | { data: { id: number | string; numero?: string | number } },
  ): Promise<{ customer: any; cnaes: any[]; orderSystem: any } | null> {
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

      let store = await this.storeService.findOne({
        where: { id_store_system: String(orderData.loja.id) },
      });

      if (!store) {
        const blingStore = await this.blingApi.get(
          `/canais-venda/${orderData.loja.id}`,
        );
        store = await this.storeService.create({
          name: blingStore.data.data.tipo,
          id_store_system: blingStore.data.data.id,
        });
      }

      if (!integration) {
        throw new Error("Bling Integration não encontrada no cache");
      }

      if (!integration.allowed_channels?.includes(store.name)) {
        console.log(
          "[BLING ORDER] Pedido não originado do mercado livre, ignorando...",
        );
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

      const customer = await this.blingCustomerService.getOrCreateCustomer(
        orderData.contato,
      );

      const ordersPayload: orderCreationAttributes = {
        integrations_id: integration.id,
        customer_id: customer.id,
        id_order_system: String(orderData.id),
        number_order_system: String(orderData.numero),
        number_order_channel: String(orderData.numeroLoja),
        date: new Date(orderData.data),
        totalPrice: Number(orderData.total),
        store_id: store.id,
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

      const createdOrder = await ordersService.create(ordersPayload);

      // Monta e cria itens com product_id resolvido
      const itemsPayload = await this.buildItemsPayload(
        createdOrder.id,
        integration.id,
        orderData.itens ?? [],
      );

      const createdItems = await orderItemsService.bulkCreate(itemsPayload);

      if (orderData.situacao.id != 6) {
        console.log(
          'Pedido com status diferente de "EM ABERTO", pulando etapas de automação apenas salvando no sistema.',
        );
        return null;
      }

      return {
        customer,
        cnaes: integration.cnaes,
        orderSystem: {
          ...createdOrder.dataValues,
          customer,
          items: createdItems,
        },
      };
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
