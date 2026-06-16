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
import { Product, ProductConfig } from "../../../../inventory";
import { Op } from "sequelize";
import { UnitBusiness } from "../../../../warehouse";
import integrationOrderStatusMappingService from "../../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";

const LOJA_SEM_LOJA = { id: "sem-loja", tipo: "Sem Loja" };
const BLING_ORDER_REQUEST_DELAY_MS = Number(
  process.env.BLING_ORDER_REQUEST_DELAY_MS ?? 0,
);

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

  private async blingGet(url: string): Promise<any> {
    if (BLING_ORDER_REQUEST_DELAY_MS > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, BLING_ORDER_REQUEST_DELAY_MS),
      );
    }
    return this.blingApi.get(url);
  }

 private async resolveProductId(
  externalProductId: string | undefined,
  sku: string | undefined,
): Promise<string | undefined> {
  if (!externalProductId && !sku) return undefined;

  // Tenta pelo id_system primeiro (sem depender de sku na tabela Product)
  if (externalProductId) {
    const product = await Product.findOne({
      where: { id_system: externalProductId },
      attributes: ["id"],
    });
    if (product) return product.id;
  }

  // Fallback: busca via ProductConfig (sku mora aqui agora)
  if (sku) {
    const config = await ProductConfig.findOne({
      where: { sku },
      attributes: ["product_id"],
    });
    if (config) return config.product_id;
  }

  return undefined;
}

  // ─── Busca UF e cidade do destinatário via contato da Bling ────────────────
  // Usa endereco.geral como fonte primária.
  // Não lança erro — se o contato não tiver endereço válido retorna campos
  // undefined e o pedido é salvo normalmente, só sem geolocalização.
  private async resolveDestination(
    contatoId: string | number | undefined,
  ): Promise<{ destination_uf?: string; destination_city?: string }> {
    if (!contatoId) return {};

    try {
      const { data } = await this.blingGet(`/contatos/${contatoId}`);
      const endereco = data?.data?.endereco?.geral;

      if (!endereco) return {};

      return {
        destination_uf: endereco.uf ? String(endereco.uf).trim() : undefined,
        destination_city: endereco.municipio
          ? String(endereco.municipio).trim()
          : undefined,
      };
    } catch (error: any) {
      console.warn(
        `[BlingOrderService] Não foi possível buscar endereço do contato ${contatoId}:`,
        error.response?.data ?? error.message,
      );
      return {};
    }
  }

  // ─── Extrai campos fiscais do payload de pedido da Bling ───────────────────
  // PIS, COFINS, DIFAL, IBS e CBS não estão disponíveis no payload de pedido
  // da Bling — ficam zerados e podem ser enriquecidos via NF-e futuramente.
  // destination_uf e destination_city são resolvidos separadamente via contato.
  private extractFiscalFields(
    orderData: any,
    destination: { destination_uf?: string; destination_city?: string },
  ) {
    return {
      destination_uf: destination.destination_uf,
      destination_city: destination.destination_city,
      icms_value: Number(orderData.tributacao?.totalICMS ?? 0),
      ipi_value: Number(orderData.tributacao?.totalIPI ?? 0),
      pis_value: 0,
      cofins_value: 0,
      difal_value: 0,
      ibs_value: 0,
      cbs_value: 0,
      approx_tax_value: 0,
    };
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

      const { data } = await this.blingGet(`/pedidos/vendas/${body.data.id}`);
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
      const destination = await this.resolveDestination(orderData.contato?.id);
      const fiscalFields = this.extractFiscalFields(orderData, destination);

      // ─── Resolve unit_business_id se ainda estiver nulo ──────────────────
      let unitBusinessId: string | null =
        existingOrder.unit_business_id ?? null;
      if (!unitBusinessId && orderData.loja?.id) {
        const unitBusiness = await UnitBusiness.findOne({
          where: { id_system: String(orderData.loja.id) },
        });
        unitBusinessId = unitBusiness?.id ?? null;
      }

      await ordersService.update(existingOrder.id, {
        unit_business_id: unitBusinessId,
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
        ...fiscalFields,
      });

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

      const { data } = await this.blingGet(`/pedidos/vendas/${body.data.id}`);
      const orderData = data.data;

      let store = null;

      if (orderData.loja?.id) {
  store = await this.storeService.findOne({
    where: { id_store_system: String(orderData.loja.id) },
  });

  if (!store) {
    const blingStore = await this.blingGet(`/canais-venda/${orderData.loja.id}`);
    const tipo = blingStore.data.data.tipo; 

    store = await this.storeService.findOne({
      where: { name: tipo },
    });

    if (!store) {
      store = await this.storeService.create({
        name: tipo,
        id_store_system: String(blingStore.data.data.id),
      });
    }
  }
}

      if (!integration) {
        throw new Error("Bling Integration não encontrada no cache");
      }

      let unitBusiness = null;

      if (orderData.loja?.id) {
        unitBusiness = await UnitBusiness.findOne({
          where: { id_system: String(orderData.loja.id) },
        });
      } else {
        // Pedido sem loja na Bling → garante que existe um UnitBusiness "Sem Loja"
        unitBusiness = await UnitBusiness.findOne({
          where: { id_system: "SEM_LOJA" },
        });

        if (!unitBusiness) {
          UnitBusiness.create({
            id_system: "SEM_LOJA",
            name: "Sem Loja",
            cnpj: "00000000000000",
            head_office: false,
            number: "0",
          });
        }
      }

      const customer = await this.blingCustomerService.getOrCreateCustomer(
        orderData.contato,
      );
      const destination = await this.resolveDestination(orderData.contato?.id);
      const fiscalFields = this.extractFiscalFields(orderData, destination);

      const ordersPayload: orderCreationAttributes = {
        integrations_id: integration.id,
        customer_id: customer.id,
        actual_situation: String(orderData.situacao.id),
        unit_business_id: unitBusiness?.id ?? null,
        id_order_system: String(orderData.id),
        number_order_system: String(orderData.numero),
        number_order_channel: String(orderData.numeroLoja),
        date: new Date(orderData.data),
        totalPrice: Number(orderData.total),
        store_id: store?.id ?? null,
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
        ...fiscalFields,
      };

      const createdOrder = await ordersService.create(ordersPayload);

      const itemsPayload = await this.buildItemsPayload(
        createdOrder.id,
        integration.id,
        orderData.itens ?? [],
      );

      const createdItems = await orderItemsService.bulkCreate(itemsPayload);

      if (!integration.allowed_channels?.includes(store?.name ?? "")) {
        console.log(
          "[BLING ORDER] Pedido não originado do mercado livre, apenas salvando no sistema, puando etapas de automação.",
        );
        console.log(
          "[DEBUG] channel.data.tipo:",
          store?.name ?? "Não reconhecido",
        );
        console.log(
          "[DEBUG] integration.allowed_channels:",
          integration.allowed_channels,
        );
        console.log(
          "[DEBUG] includes?",
          integration.allowed_channels?.includes(store?.name ?? ""),
        );
        return null;
      }

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
