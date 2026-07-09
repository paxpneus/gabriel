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

// Detecta sufixo de KIT no SKU, ex: "15409210000K2" -> kit de 2 unidades
const KIT_SKU_REGEX = /K(\d+)$/i;

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

  private appendMissingOrderFiscalFields(
    existingOrder: any,
    fiscalFields: ReturnType<BlingOrderService["extractFiscalFields"]>,
    icmsValue: number,
  ) {
    const update: Record<string, any> = {};

    if (existingOrder.destination_uf == null) {
      update.destination_uf = fiscalFields.destination_uf;
    }
    if (existingOrder.destination_city == null) {
      update.destination_city = fiscalFields.destination_city;
    }
    if (existingOrder.ipi_value == null) {
      update.ipi_value = fiscalFields.ipi_value;
    }
    if (existingOrder.pis_value == null) {
      update.pis_value = fiscalFields.pis_value;
    }
    if (existingOrder.cofins_value == null) {
      update.cofins_value = fiscalFields.cofins_value;
    }
    if (existingOrder.difal_value == null) {
      update.difal_value = fiscalFields.difal_value;
    }
    if (existingOrder.ibs_value == null) {
      update.ibs_value = fiscalFields.ibs_value;
    }
    if (existingOrder.cbs_value == null) {
      update.cbs_value = fiscalFields.cbs_value;
    }
    if (existingOrder.approx_tax_value == null) {
      update.approx_tax_value = fiscalFields.approx_tax_value;
    }
    if (existingOrder.icms_value == null) {
      update.icms_value = icmsValue;
    }

    return update;
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
    seller:
      | { id?: number | string | null; nome?: string | null }
      | null
      | undefined,
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

    const isUnassignedSeller = sellerSystemId === "0";

    const sellerName = isUnassignedSeller
      ? "Vendedor 0"
      : seller?.nome
        ? String(seller.nome).trim()
        : null;

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

  private costUnitBusinessId: string | null = null;

  private async resolveCostUnitBusinessId(): Promise<string> {
    if (this.costUnitBusinessId) return this.costUnitBusinessId;

    const unitBusiness = await UnitBusiness.findOne({
      where: { cnpj: "02316749002111" },
      attributes: ["id"],
    });

    if (!unitBusiness) {
      throw new Error(
        `[BlingOrderService] UnitBusiness com CNPJ 02316749002111 não encontrada. Impossível resolver custo do produto.`,
      );
    }

    this.costUnitBusinessId = unitBusiness.id;
    return this.costUnitBusinessId;
  }

  private async resolveProductWithConfig(
    externalProductId: string | undefined,
    sku: string | undefined,
    name: string | undefined,
  ): Promise<{
    product: ProductAttributes & { brandRegister?: Brand };
    averageCost: number | null;
    resolvedSku: string;
  }> {
    if (!externalProductId && !sku) {
      throw new Error(
        `[BlingOrderService] Item sem id externo e sem sku, impossível resolver product config`,
      );
    }

    const costUnitBusinessId = await this.resolveCostUnitBusinessId();

    let config: ProductConfig | null = null;

    let product: Product | null = null;

    // Tenta localizar pelo id_system primeiro
    if (externalProductId) {
      product = await Product.findOne({
        where: { id_system: externalProductId },
        attributes: ["id"],
      });
    }

    // Se não encontrou, tenta pelo nome
    if (!product && name) {
      product = await Product.findOne({
        where: { name },
        attributes: ["id"],
      });
    }

    if (product) {
      config = await ProductConfig.findOne({
        where: {
          product_id: product.id,
          unit_business_id: costUnitBusinessId,
        },
        include: [
          {
            model: Product,
            as: "product",
            include: [
              {
                model: Brand,
                as: "brandRegister",
              },
            ],
          },
        ],
      });
    }

    if (!config && sku) {
      config = await ProductConfig.findOne({
        where: { sku, unit_business_id: costUnitBusinessId },
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
        `[BlingOrderService] ProductConfig não encontrado (externalProductId=${externalProductId ?? "-"}, sku=${sku ?? "-"}) na unit_business de custo. Item não pode ser criado sem custo médio.`,
      );
    }

    let averageCost: number | null = Number(config.average_cost ?? 0);

    if (config.product.type === "KIT" && config.sku) {
      averageCost = null;

      const unitSku = config.sku.replace(KIT_SKU_REGEX, "");
      const unitConfig = await ProductConfig.findOne({
        where: { sku: unitSku, unit_business_id: costUnitBusinessId },
        include: [
          {
            model: Product,
            as: "product",
            attributes: ["id", "type"],
            where: { type: "UNIT" },
            required: true,
          },
        ],
      });

      if (unitConfig) {
        averageCost = Number(unitConfig.average_cost ?? 0);
      }
    }
    return {
      product: config.product as ProductAttributes & { brandRegister?: Brand },
      averageCost,
      resolvedSku: config.sku!,
    };
  }

  // ─── Detecta se o SKU é um KIT (sufixo K{n}) e retorna o multiplicador ─────
  // "15409210000K2" -> kit de 2 unidades reais por "quantidade" do item.
  // SKU sem sufixo K{n} -> multiplicador 1 (item unitário).
  private getKitMultiplier(sku: string | undefined): number {
    if (!sku) return 1;
    const match = sku.match(KIT_SKU_REGEX);
    if (!match) return 1;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  // ─── Calcula os campos financeiros de um item de pedido ────────────────────
  // Regra:
  //   average_cost_snapshot = product_config.average_cost (valor unitário puro)
  //   unidades_reais        = (n do KIT, se houver) × quantidade do item
  //   custo_medio_total     = average_cost_snapshot × unidades_reais
  //   commission_base       = itens.valor (valor bruto do item no pedido)
  //   commission_rate       = brand.seller_comission_tax_rate
  //   commission_value      = commission_base × (commission_rate / 100)
  //   total_cost_snapshot   = custo_medio_total + commission_value
  //   comission_manager_rate = brand.manager_comission_tax_rate (apenas salvo, não usado em cálculo)
  private buildItemFinancialFields(
    product: ProductAttributes & { brandRegister?: Brand },
    averageCostUnit: number | null,
    sku: string | undefined,
    quantity: number,
    itemValue: number,
    hasSellerCommission: boolean,
  ) {
    const brand = product.brandRegister;
    const kitMultiplier = this.getKitMultiplier(sku);

    const averageCostSnapshot =
      averageCostUnit == null ? null : averageCostUnit * kitMultiplier;

    const custoMedioTotal =
      averageCostSnapshot == null ? null : averageCostSnapshot * quantity;

    const sellerRate = hasSellerCommission
      ? Number(brand?.seller_comission_tax_rate ?? product.commission ?? 0)
      : 0;
    const managerRate = hasSellerCommission
      ? Number(brand?.manager_comission_tax_rate ?? 0)
      : 0;

    const commissionBase = hasSellerCommission ? itemValue : 0;
    const commissionValue = (commissionBase * sellerRate) / 100;

    const totalCostSnapshot =
      custoMedioTotal == null ? null : custoMedioTotal + commissionValue;

    return {
      commission_base: commissionBase,
      commission_rate: sellerRate,
      comission_manager_rate: managerRate,
      commission_value: commissionValue,
      average_cost_snapshot: averageCostSnapshot,
      total_cost_snapshot: totalCostSnapshot,
      cost_source: "average_cost_plus_commission",
    };
  }
  private appendMissingFinancialFields(
    existingItem: any,
    fields: {
      commission_base?: number;
      commission_rate?: number;
      comission_manager_rate?: number;
      commission_value?: number;
      average_cost_snapshot?: number | null;
      total_cost_snapshot?: number | null;
      cost_source?: string;
    },
  ) {
    const update: Partial<orderItemsCreationAttributes> = {};

    if (
      existingItem.commission_base == null &&
      fields.commission_base !== undefined
    ) {
      update.commission_base = fields.commission_base;
    }
    if (
      existingItem.commission_rate == null &&
      fields.commission_rate !== undefined
    ) {
      update.commission_rate = fields.commission_rate;
    }
    if (
      existingItem.comission_manager_rate == null &&
      fields.comission_manager_rate !== undefined
    ) {
      update.comission_manager_rate = fields.comission_manager_rate;
    }
    if (
      existingItem.commission_value == null &&
      fields.commission_value !== undefined
    ) {
      update.commission_value = fields.commission_value;
    }
    if (
      existingItem.average_cost_snapshot == null &&
      fields.average_cost_snapshot !== undefined
    ) {
      update.average_cost_snapshot = fields.average_cost_snapshot;
    }
    if (
      existingItem.total_cost_snapshot == null &&
      fields.total_cost_snapshot !== undefined
    ) {
      update.total_cost_snapshot = fields.total_cost_snapshot;
    }
    if (existingItem.cost_source == null && fields.cost_source !== undefined) {
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

  // ─── Resolve a alíquota de ICMS (%) do estado de destino ────────────────────
  // Retorna 0 quando não há UF de destino ou o estado não é encontrado — nesse
  // caso icms_value acaba ficando 0 e total_cost não é penalizado indevidamente.
  private async resolveIcmsRate(
    destinationUf: string | undefined,
  ): Promise<number> {
    if (!destinationUf) return 0;

    const state = await stateService.findOne({
      where: { acronym: destinationUf.trim().toUpperCase() },
    });

    return Number(state?.icms_rate ?? 0);
  }

  // ─── Extrai campos fiscais "estáticos" do payload de pedido da Bling ───────
  // PIS, COFINS, DIFAL, IBS e CBS não estão disponíveis no payload de pedido
  // da Bling — ficam zerados e podem ser enriquecidos via NF-e futuramente.
  // icms_value NÃO é calculado aqui — depende de total_price, que só existe
  // depois que os itens são processados (ver computeOrderFinancials).
  private extractFiscalFields(
    orderData: any,
    destination: { destination_uf?: string; destination_city?: string },
  ) {
    return {
      destination_uf: destination.destination_uf,
      destination_city: destination.destination_city,
      ipi_value: Number(orderData.tributacao?.totalIPI ?? 0),
      pis_value: 0,
      cofins_value: 0,
      difal_value: 0,
      ibs_value: 0,
      cbs_value: 0,
      approx_tax_value: 0,
    };
  }

  // ─── Calcula os totais financeiros do pedido ────────────────────────────────
  // Regra:
  //   total_price = total - taxas.taxaComissao (loja online tem taxa; PDV tem
  //                 taxaComissao = 0, então a mesma fórmula serve para os dois)
  //   icms_value  = total_price × state.icms_rate%
  //   total_cost  = total_price - icms_value - custo_total_produtos
  private async computeOrderFinancials(
    orderData: any,
    destinationUf: string | undefined,
    custoTotalProdutos: number,
  ): Promise<{ total_price: number; icms_value: number; total_cost: number }> {
    const total = Number(orderData.totalProdutos ?? 0);
    const taxaComissao = Number(orderData.taxas?.taxaComissao ?? 0);
    const custoFrete = Number(orderData.taxas?.custoFrete ?? 0);

    // total_price agora já desconta comissão E custo de frete — essa é a base
    // sobre a qual o ICMS é calculado, e é o que sobra pra comparar com o
    // custo dos produtos.
    const totalPrice = total - taxaComissao - custoFrete;

    const icmsRate = await this.resolveIcmsRate(destinationUf);
    const icmsValue = totalPrice * (icmsRate / 100);

    const totalCost = icmsValue + custoTotalProdutos;

    return {
      total_price: totalPrice,
      icms_value: icmsValue,
      total_cost: totalCost,
    };
  }
  // ─── Monta payload de itens (com product_id e campos financeiros já resolvidos) ─
  // Retorna também a soma de total_cost_snapshot, usada em computeOrderFinancials.
  private async buildItemsPayload(
    integrationId: string,
    blingItems: any[],
    hasSellerCommission: boolean,
  ): Promise<{
    items: Omit<orderItemsCreationAttributes, "order_id">[];
    custoTotalProdutos: number;
  }> {
    const items = await Promise.all(
      blingItems.map(async (i: any) => {
        const quantity = Number(i.quantidade ?? i.quantity ?? 0);
        const itemValue = Number(i.valor ?? 0); // valor UNITÁRIO
        const itemName = i.descricao;
        const discountValue = Number(i.desconto ?? 0);
        const externalProductId = i.produto?.id
          ? String(i.produto.id)
          : undefined;
        const sku = i.codigo ? String(i.codigo) : undefined;

        const { product, averageCost, resolvedSku } =
          await this.resolveProductWithConfig(externalProductId, sku, itemName);

        // valor total da linha = unitário x quantidade
        const grossTotalLine = itemValue * quantity;
        const netTotal = grossTotalLine - discountValue;

        const financialFields = this.buildItemFinancialFields(
          product,
          averageCost,
          resolvedSku,
          quantity,
          grossTotalLine,
          hasSellerCommission,
        );

        return {
          name: i.descricao,
          sku: resolvedSku ?? "",
          unit: i.unidade,
          quantity,
          price: itemValue,
          product_id: product.id,
          integrations_id: integrationId,
          source_payload: i,
          unit_price: itemValue,
          gross_total: grossTotalLine,
          discount_value: discountValue,
          net_total: netTotal,
          ...financialFields,
        };
      }),
    );

    const custoTotalProdutos = items.reduce(
      (acc, item) => acc + Number(item.total_cost_snapshot ?? 0),
      0,
    );

    return { items, custoTotalProdutos };
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

      // ─── Processa itens primeiro para obter custo_total_produtos ──────────

      const hasSellerCommission =
        !!orderData.vendedor?.id && Number(orderData.vendedor.id) !== 0;

      const { items: itemsPayload, custoTotalProdutos } =
        await this.buildItemsPayload(
          integration.id,
          orderData.itens ?? [],
          hasSellerCommission,
        );

      const orderFinancials = await this.computeOrderFinancials(
        orderData,
        fiscalFields.destination_uf,
        custoTotalProdutos,
      );

      const orderFiscalFieldsToUpdate = this.appendMissingOrderFiscalFields(
        existingOrder,
        fiscalFields,
        orderFinancials.icms_value,
      );

      await ordersService.update(existingOrder.id, {
        unit_business_id: unitBusinessId,
        invoice_id: invoiceId,
        number_order_channel: String(orderData.numeroLoja),
        actual_situation: String(orderData.situacao.id),
        date: new Date(orderData.data),
        internal_status: internalStatus,
        source_payload: orderData,
        total_products: Number(orderData.totalProdutos ?? 0),
        total_order: Number(orderData.totalProdutos ?? 0),
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
        total_price: orderFinancials.total_price,
        total_cost: orderFinancials.total_cost,
        ...(sellerId ? { seller_id: sellerId } : {}),
        ...orderFiscalFieldsToUpdate,
      });

      if (orderData.itens?.length) {
        for (let idx = 0; idx < orderData.itens.length; idx++) {
          const i = orderData.itens[idx];
          const computedItem = itemsPayload[idx];
          const sku = computedItem.sku || undefined;

          const existingItem = sku
            ? await orderItemsService.findOne({
                where: { order_id: existingOrder.id, sku },
              })
            : null;

          if (existingItem) {
            const financialFieldsUpdate = this.appendMissingFinancialFields(
              existingItem,
              computedItem,
            );

            await orderItemsService.update(existingItem.id, {
              quantity: computedItem.quantity,
              price: computedItem.price,
              unit_price: computedItem.unit_price,
              gross_total: computedItem.gross_total,
              discount_value: computedItem.discount_value,
              net_total: computedItem.net_total,
              product_id: computedItem.product_id,
              source_payload: i,
              ...financialFieldsUpdate,
            });
          } else {
            await orderItemsService.create({
              ...computedItem,
              order_id: existingOrder.id,
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
      const fiscalFields = this.extractFiscalFields(orderData, destination);
      const invoiceId = await this.resolveInvoiceId(orderData.notaFiscal?.id);
      const sellerId = await this.upsertSellerContact(
        orderData.vendedor,
        integration.id,
      );

      // ─── Processa itens primeiro para obter custo_total_produtos ──────────

      const hasSellerCommission =
        !!orderData.vendedor?.id && Number(orderData.vendedor.id) !== 0;

      const { items: itemsPayloadWithoutOrderId, custoTotalProdutos } =
        await this.buildItemsPayload(
          integration.id,
          orderData.itens ?? [],
          hasSellerCommission,
        );

      const orderFinancials = await this.computeOrderFinancials(
        orderData,
        fiscalFields.destination_uf,
        custoTotalProdutos,
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
        store_id: store?.id ?? null,
        source_payload: orderData,
        total_products: Number(orderData.totalProdutos ?? 0),
        total_order: Number(orderData.totalProdutos ?? 0),
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
        ...orderFinancials,
      };

      const createdOrder = await ordersService.create(ordersPayload);

      const itemsPayload: orderItemsCreationAttributes[] =
        itemsPayloadWithoutOrderId.map((item) => ({
          ...item,
          order_id: createdOrder.id,
        }));

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
