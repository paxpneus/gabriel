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
import { Invoice, UnitBusiness } from "../../../../warehouse";
import Contact from "../../../../sales/contacts/contacts.model";
import integrationOrderStatusMappingService from "../../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";
import { ProductAttributes } from "../../../../inventory/products/product.types";
import Brand from "../../../../inventory/brands/brands.model";
import stateService from "../../../../warehouse/address/state/state.service";

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

  private async resolveInvoiceId(
    notaFiscalId: string | number | undefined,
  ): Promise<string | null> {
    if (!notaFiscalId) return null;

    const invoice = await Invoice.findOne({
      where: { id_system: String(notaFiscalId) },
      attributes: ["id"],
    });

    return invoice?.id ?? null;
  }

  private async upsertSellerContact(
    seller: { id?: number | string | null; nome?: string | null } | null | undefined,
    integrationId: string,
  ): Promise<string | null> {
    const sellerSystemId = seller?.id != null ? String(seller.id) : null;

    if (!sellerSystemId) return null;

    const existing = await Contact.findOne({
      where: {
        id_system: sellerSystemId,
        type: "SELLER",
        integrations_id: integrationId,
      },
    });

    const sellerName = seller?.nome ? String(seller.nome).trim() : null;

    if (existing) {
      const needsUpdate =
        (sellerName && existing.name !== sellerName) ||
        existing.integrations_id !== integrationId;

      if (needsUpdate) {
        await existing.update({
          name: sellerName ?? existing.name,
          integrations_id: integrationId,
        });
      }
      return existing.id;
    }

    const created = await Contact.create({
      id_system: sellerSystemId,
      name: sellerName ?? `Vendedor ${sellerSystemId}`,
      type: "SELLER",
      integrations_id: integrationId,
      unit_business_id: null,
    });

    return created.id;
  }

  private async resolveProductWithConfig(
    externalProductId: string | undefined,
    sku: string | undefined,
  ): Promise<{ product: ProductAttributes & { brandRegister?: Brand }; config: ProductConfig }> {
    if (!externalProductId && !sku) {
      throw new Error(
        `[BlingOrderService] Item sem id externo e sem sku, impossível resolver product config`,
      );
    }

    let config: ProductConfig | null = null;

    // Tenta via id_system do produto primeiro
    if (externalProductId) {
      const product = await Product.findOne({
        where: { id_system: externalProductId },
        attributes: ["id"],
      });

      if (product) {
        config = await ProductConfig.findOne({
          where: { product_id: product.id },
          include: [
            {
              model: Product,
              as: "product",
              include: [{ model: Brand, as: "brandRegister", required: false }],
            },
          ],
        });
      }
    }

    if (!config && sku) {
      config = await ProductConfig.findOne({
        where: { sku },
        include: [
          {
            model: Product,
            as: "product",
            include: [{ model: Brand, as: "brandRegister", required: false }],
          },
        ],
      });
    }

    if (!config || !config.product) {
      throw new Error(
        `[BlingOrderService] ProductConfig não encontrado (externalProductId=${externalProductId ?? "-"}, sku=${sku ?? "-"}). Item não pode ser criado sem custo médio.`,
      );
    }

    return { product: config.product as ProductAttributes & { brandRegister?: Brand }, config };
  }

  private buildItemFinancialFields(
    product: ProductAttributes & { brandRegister?: Brand },
    config: ProductConfig,
    quantity: number,
    netTotal: number,
  ) {
    const brand = product.brandRegister;
    const averageCost = Number(config.average_cost ?? 0);
    const blingUnitCost = Number(
      config.supplier_cost_price ??
        config.supplier_purchase_price ??
        config.average_cost ??
        0,
    );
    const commissionBase = netTotal;
    const sellerRate = Number(
      brand?.seller_comission_tax_rate ?? product.commission ?? 0,
    );
    const managerRate = Number(brand?.manager_comission_tax_rate ?? 0);

    return {
      commission_base: commissionBase,
      commission_rate: sellerRate,
      comission_manager_rate: managerRate,
      commission_value: (commissionBase * sellerRate) / 100,
      average_cost_snapshot: averageCost,
      total_cost_snapshot: blingUnitCost * quantity,
      cost_source: "bling_supplier_cost",
    };
  }

  private appendMissingFinancialFields(
    existingItem: any,
    fields: ReturnType<BlingOrderService["buildItemFinancialFields"]>,
  ) {
    const update: Partial<orderItemsCreationAttributes> = {};

    if (existingItem.commission_base == null) {
      update.commission_base = fields.commission_base;
    }
    if (existingItem.commission_rate == null) {
      update.commission_rate = fields.commission_rate;
    }
    if (existingItem.comission_manager_rate == null) {
      update.comission_manager_rate = fields.comission_manager_rate;
    }
    if (existingItem.commission_value == null) {
      update.commission_value = fields.commission_value;
    }
    if (existingItem.average_cost_snapshot == null) {
      update.average_cost_snapshot = fields.average_cost_snapshot;
    }
    if (existingItem.total_cost_snapshot == null) {
      update.total_cost_snapshot = fields.total_cost_snapshot;
    }
    if (existingItem.cost_source == null) {
      update.cost_source = fields.cost_source;
    }

    return update;
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
  private async extractFiscalFields(
    orderData: any,
    destination: { destination_uf?: string; destination_city?: string },
  ) {
    const fallbackIcmsValue = Number(orderData.tributacao?.totalICMS ?? 0);
    let icmsValue = fallbackIcmsValue;

    if (destination.destination_uf) {
      const state = await stateService.findOne({
        where: { acronym: destination.destination_uf.trim().toUpperCase() },
      });
      icmsValue = Number(state?.icms_rate ?? fallbackIcmsValue);
    }

    return {
      destination_uf: destination.destination_uf,
      destination_city: destination.destination_city,
      icms_value: icmsValue,
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

        const { product, config } = await this.resolveProductWithConfig(
          externalProductId,
          sku,
        );

        const netTotal = unitPrice * quantity - discountValue;
        const financialFields = this.buildItemFinancialFields(
          product,
          config,
          quantity,
          netTotal,
        );

        return {
          name: i.descricao,
          order_id: orderId,
          sku: sku ?? "",
          unit: i.unidade,
          quantity,
          price: unitPrice,
          product_id: product.id,
          source_payload: i,
          unit_price: unitPrice,
          gross_total: unitPrice * quantity,
          discount_value: discountValue,
          net_total: netTotal,
          ...financialFields,
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
      const fiscalFields = await this.extractFiscalFields(
        orderData,
        destination,
      );
      const sellerId = await this.upsertSellerContact(
        orderData.vendedor,
        integration.id,
      );

      // ─── Resolve unit_business_id se ainda estiver nulo ──────────────────
      let unitBusinessId: string | null =
        existingOrder.unit_business_id ?? null;
      if (!unitBusinessId && orderData.loja?.id) {
        const unitBusiness = await UnitBusiness.findOne({
          where: { id_system: String(orderData.loja.id) },
        });
        unitBusinessId = unitBusiness?.id ?? null;
      }

      const invoiceId = await this.resolveInvoiceId(orderData.notaFiscal?.id);

      await ordersService.update(existingOrder.id, {
        unit_business_id: unitBusinessId,
        invoice_id: invoiceId,
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
        ...(sellerId ? { seller_id: sellerId } : {}),
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

          const { product, config } = await this.resolveProductWithConfig(
            externalProductId,
            sku,
          );
          const netTotal = unitPrice * quantity - discountValue;
          const financialFields = this.buildItemFinancialFields(
            product,
            config,
            quantity,
            netTotal,
          );

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
              net_total: netTotal,
              ...this.appendMissingFinancialFields(
                existingItem,
                financialFields,
              ),
              product_id: product.id,
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
              product_id: product.id,
              integrations_id: integration.id,
              source_payload: i,
              unit_price: unitPrice,
              gross_total: unitPrice * quantity,
              discount_value: discountValue,
              net_total: netTotal,
              ...financialFields,
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

      const { data } = await this.blingGet(`/pedidos/vendas/${body.data.id}`);
      const orderData = data.data;

      const existingOrder = await ordersService.findOne({
        where: {
          integrations_id: integration.id,
          number_order_system: String(orderData.numero),
        },
      });

      if (existingOrder) {
        console.log(
          `[BlingOrderService] Pedido ${orderData.numero} já cadastrado. Pulando...`,
        );
        return await this.updateOrderFromBling({
          data: orderData,
        } as any);
      }

      let store = null;

      if (orderData.loja?.id) {
        store = await this.storeService.findOne({
          where: { id_store_system: String(orderData.loja.id) },
        });

        if (!store) {
          const blingStore = await this.blingGet(
            `/canais-venda/${orderData.loja.id}`,
          );
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
      }

      if (!unitBusiness) {
        unitBusiness = await UnitBusiness.findOne({
          where: { id_system: "SEM_LOJA" },
        });

        if (!unitBusiness) {
          unitBusiness = await UnitBusiness.create({
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
      const fiscalFields = await this.extractFiscalFields(
        orderData,
        destination,
      );
      const invoiceId = await this.resolveInvoiceId(orderData.notaFiscal?.id);
      const sellerId = await this.upsertSellerContact(
        orderData.vendedor,
        integration.id,
      );

      const ordersPayload: orderCreationAttributes = {
        integrations_id: integration.id,
        customer_id: customer.id,
        invoice_id: invoiceId,
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
        ...(sellerId ? { seller_id: sellerId } : {}),
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
