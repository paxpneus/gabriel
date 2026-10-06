import orderItemsService from "./../../../../sales/orders/order_items/order_items.service";
import { AxiosInstance } from "axios";
import { Op } from "sequelize";
import { ORDER_DISCOUNT_TYPE_PERCENT } from "../../../../sales/orders/order/helpers/discount";
import { getBlingIntegration } from "../../api/bling_api.service";
import { blingOrderWebHookData } from "./bling-order.types";
import ordersService from "../../../../sales/orders/order/orders.service";
import {
  COMPLETED_ORDER_INTERNAL_STATUSES,
  OrderInternalStatus,
  OrderReasonCancelled,
  orderCreationAttributes,
} from "../../../../sales/orders/order/orders.types";
import { BlingCustomerService } from "../bling-customers/bling-customer.service";
import { executeWebhookAction } from "../../../../../shared/utils/normalizers/webhook";
import { orderItemsCreationAttributes } from "../../../../sales/orders/order_items/order_items.types";
import { StoreService } from "../../../../sales/stores/stores.service";
import { mapOrderInternalStatus } from "../../../../../shared/utils/normalizers/bling/status-mapper";
import { Product, ProductConfig } from "../../../../inventory";
import { UnitBusiness } from "../../../../warehouse";
import invoiceService from "../../../../warehouse/fiscal/invoices/invoice/invoice.service";
import type { BlingApiInvoice } from "../bling/queues/bling-api-fetch.queue";
import Contact from "../../../../sales/contacts/contacts.model";
import integrationOrderStatusMappingService from "../../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";
import { ProductAttributes } from "../../../../inventory/products/product.types";
import Brand from "../../../../inventory/brands/brands.model";
import stateService from "../../../../warehouse/address/state/state.service";
import { blingGet } from "../bling/helpers/get-with-sleep";
import productService from "../../../../inventory/products/services/product.service";
import integrationMappingService from "../../../../integrations/integration-mapping/integration-mapping.service";
import { startOfDayTz } from "../../../../../shared/utils/normalizers/date";
import { OrderPaymentCreationAttributes } from "../../../../sales/orders/order_payment/order_payment.types";
import { paymentMethodGroupForBlingType } from "../../../../sales/orders/payment_method/helpers/payment-method-groups";
import orderPaymentService from "../../../../sales/orders/order_payment/order_payment.service";
import paymentMethodService from "../../../../sales/orders/payment_method/payment_method.service";
import pdvSalesRequestService from "../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import { isPdvCancelledSituation } from "../../../../sales/orders/order/helpers/eligible-for-pdv-filters";
import { notifyPdvStoreSync } from "../../../../sales/pdv-management/sales-request/helpers/notify-pdv-store-sync";
import {
  SEM_LOJA_ID_SYSTEM,
  findOrCreateSemLojaUnitBusiness,
} from "./helpers/sem-loja-unit-business";

interface BlingInstallmentApi {
  id?: number;
  dataVencimento?: string;
  valor?: number;
  observacoes?: string;
  formaPagamento?: { id?: number };
}

interface BlingPaymentMethodApi {
  id: number;
  descricao: string;
  tipoPagamento?: number;
}

// formaPagamento.id (Bling) -> tipo e nome da forma; o tipo de uma forma não muda.
const blingFormById = new Map<
  string,
  { type: number | null; description: string | null }
>();

const LOJA_SEM_LOJA = { id: "sem-loja", tipo: "Sem Loja" };
const BLING_ORDER_REQUEST_DELAY_MS = Number(
  process.env.BLING_ORDER_REQUEST_DELAY_MS ?? 0,
);

// Situações Bling de cancelamento real pelo cliente/Bling (não confundir
// com 748772 "aguardando verificação humana" — essa é decidida e já tem
// reason_cancelled gravado por uma das filas de automação antes de o
// webhook chegar aqui, então NÃO entra nesta lista).
const CUSTOMER_CANCELLED_SITUACAO_IDS = ["12", "21"];

// Só inclui a chave reason_cancelled quando dá pra saber o motivo (12/21)
// — omitida (não gravada como null) em qualquer outra situação, pra nunca
// sobrescrever um motivo mais específico que uma fila já gravou antes.
function reasonCancelledFields(situacaoId: unknown) {
  return CUSTOMER_CANCELLED_SITUACAO_IDS.includes(String(situacaoId))
    ? { reason_cancelled: OrderReasonCancelled.CUSTOMER_CANCELLED }
    : {};
}

// A Bling às vezes manda dataPrevista preenchida mas com o sentinel de
// "data zero" do MySQL ("0000-00-00", com ou sem hora) em vez de vir vazia
// — convenção de coluna NOT NULL sem valor real definido. Checado por regex
// ANTES de tentar parsear: passar "0000-00-00" pro dayjs.tz cai no ano 0000
// e, por causa do offset histórico (pré-1914) de America/Sao_Paulo na base
// IANA (-03:06:28, hora solar média local, não um -03:00 redondo), o
// resultado é um Date por volta de novembro de 1899 — confirmado batendo
// exatamente com um caso de produção. Curto-circuita esse parse frágil
// (o minuto exato varia por versão do ICU) em vez de depender dele pra
// cair no filtro genérico de ano abaixo.
const MYSQL_ZERO_DATE_REGEX = /^0000-00-00/;

// Rede de segurança genérica pra qualquer OUTRA data implausível que chegue
// preenchida (não só o sentinel MySQL acima) — um pedido real nunca tem
// coleta prevista antes disso. Sem essa checagem, uma data desse tipo virava
// um delay negativo em setDelayBasedOnDate → NFe agendada pra ~30s (o piso
// MIN_DELAY_MS de finalizeNfeScheduling), ou seja, emissão praticamente
// imediata em vez de esperar a coleta de verdade.
const MIN_PLAUSIBLE_COLLECTION_YEAR = 2000;

// Só inclui a chave collection_date quando a Bling manda dataPrevista
// preenchida e plausível — omitida (nunca null, e nunca um valor chutado)
// quando vier vazia, zerada ou implausível. Isso faz o pedido cair
// exatamente no mesmo fluxo de "sem collection_date" de quando a Bling não
// manda nada: MLOrderSyncQueue marca WAITING_CHANNEL_VALIDATION e dispara o
// scraping do ML pra buscar a data real, em vez de aceitar um valor
// inventado — e também não apaga um collection_date já resolvido antes por
// scraping/ML_ORDER_SYNC.
function collectionDateFromBling(dataPrevista: string | undefined | null) {
  if (!dataPrevista) return {};

  const trimmed = dataPrevista.trim();

  if (MYSQL_ZERO_DATE_REGEX.test(trimmed)) {
    console.warn(
      `[BlingOrderService] dataPrevista "zerada" (sentinel MySQL) ignorada: "${dataPrevista}"`,
    );
    return {};
  }

  const parsed = startOfDayTz(trimmed);
  if (!parsed.isValid() || parsed.year() < MIN_PLAUSIBLE_COLLECTION_YEAR) {
    console.warn(
      `[BlingOrderService] dataPrevista implausível ignorada: "${dataPrevista}"`,
    );
    return {};
  }

  return { collection_date: parsed.toDate() };
}

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

  // Pedido já chega com o id da nota fiscal na Bling (orderData.notaFiscal.id)
  // antes do webhook de invoice/consumer_invoice terminar o import completo
  // dela (assíncrono, pode demorar) — sem isso, o pedido ficava com
  // invoice_id nulo até essa outra fila processar por conta própria. Busca
  // local primeiro (id_system); sem achar, busca só o essencial na Bling
  // (GET /nfe/:id, uma chamada) e vincula uma nota PROVISÓRIA (só
  // number_system + o link do DANFE que a própria Bling hospeda) — o
  // processo lento de verdade (itens, totais fiscais, notificação) continua
  // sendo o webhook/reconciler de invoice, que localiza esta mesma linha por
  // id_system e atualiza em cima dela (ver fetchAndUpsertInvoice).
  private async resolveInvoiceId(
    notaFiscalId: string | number | undefined,
  ): Promise<string | null> {
    if (!notaFiscalId) return null;

    const idSystem = String(notaFiscalId);
    const existing = await invoiceService.findOne({
      where: { id_system: idSystem },
    });
    if (existing) return existing.id;

    try {
      const { data } = await blingGet<{ data: BlingApiInvoice }>(
        `/nfe/${notaFiscalId}`,
        this.blingApi,
      );
      const nf = data.data;
      if (!nf?.numero) return null;

      // Pode já existir uma linha criada pelo fluxo Tecinco/XML (ver
      // upsertInvoiceFromXml) pela mesma chaveAcesso, antes do pedido Bling
      // chegar — reaproveita em vez de criar uma segunda linha pra mesma nota.
      if (nf.chaveAcesso) {
        const existingByKey = await invoiceService.findOne({
          where: { xml_key: nf.chaveAcesso },
        });
        if (existingByKey) {
          if (!existingByKey.id_system) {
            await invoiceService.update(existingByKey.id, { id_system: idSystem });
          }
          return existingByKey.id;
        }
      }

      const integration = await getBlingIntegration();
      const created = await invoiceService.createStub({
        integrationsId: integration.id,
        numberSystem: nf.numero,
        idSystem,
        xmlKey: nf.chaveAcesso ?? null,
        danfePath: nf.linkPDF ?? null,
        senderCnpj: nf.emitente?.cnpj,
        senderName: nf.emitente?.nome,
      });
      return created.id;
    } catch (err: any) {
      console.warn(
        `[BLING_ORDER] Falha ao vincular nota provisória (notaFiscalId=${notaFiscalId}): ${err?.message ?? err}`,
      );
      return null;
    }
  }

  // Forma da Bling -> linha agrupada por tipoPagamento em payment_methods
  // (ver payment-method-groups.ts). Tipo/nome de cada forma ficam em cache de
  // memória — evita bater em /formas-pagamentos/{id} a cada pedido, já que o
  // rate-limit da Bling é compartilhado entre todas as filas.
  private async resolvePaymentMethod(
    formaPagamentoId: number | string,
  ): Promise<{ paymentMethodId: string; formDescription: string | null }> {
    const formId = String(formaPagamentoId);

    let form = blingFormById.get(formId);
    if (!form) {
      const { data } = await blingGet<{ data: BlingPaymentMethodApi }>(
        `/formas-pagamentos/${formId}`,
        this.blingApi,
      );
      form = {
        type: data.data.tipoPagamento ?? null,
        description: data.data.descricao || null,
      };
      blingFormById.set(formId, form);
    }

    const group = paymentMethodGroupForBlingType(form.type);
    const existing = await paymentMethodService.findOne({
      where: { id_system: group.key },
      attributes: ["id"],
    });
    if (existing) {
      return { paymentMethodId: existing.id, formDescription: form.description };
    }

    const integration = await getBlingIntegration();
    const created = await paymentMethodService.create({
      integrations_id: integration.id,
      id_system: group.key,
      description: group.description,
      payment_type: Number(group.key),
      raw_payload: { blingTypes: group.blingTypes },
    });

    return { paymentMethodId: created.id, formDescription: form.description };
  }

  // Uma linha por parcela da Bling (parcelas[]) — um pedido pode ter várias
  // formas de pagamento, e a mesma forma pode repetir em várias parcelas.
  // Resolve as formas (pode bater na Bling) antes de gravar o pedido, pra uma
  // falha de API não deixar pedido criado sem pagamentos.
  private async resolveOrderPayments(
    parcelas: BlingInstallmentApi[] | undefined,
  ): Promise<Omit<OrderPaymentCreationAttributes, "order_id">[]> {
    const installments = (parcelas ?? []).filter(
      (parcela) => parcela.formaPagamento?.id,
    );

    const uniqueMethodIds = [
      ...new Set(
        installments.map((parcela) => String(parcela.formaPagamento!.id)),
      ),
    ];
    const resolved = await Promise.all(
      uniqueMethodIds.map(
        async (id) => [id, await this.resolvePaymentMethod(id)] as const,
      ),
    );
    const resolvedByFormId = new Map(resolved);

    return installments.map((parcela) => {
      const form = resolvedByFormId.get(String(parcela.formaPagamento!.id))!;
      return {
        payment_method_id: form.paymentMethodId,
        form_description: form.formDescription,
        id_system: parcela.id != null ? String(parcela.id) : null,
        amount: Number(parcela.valor ?? 0),
        due_date:
          parcela.dataVencimento && parcela.dataVencimento !== "0000-00-00"
            ? parcela.dataVencimento
            : null,
        notes: parcela.observacoes || null,
      };
    });
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
    product: (ProductAttributes & { brandRegister?: Brand }) | null;
    averageCost: number | null;
    resolvedSku: string;
    kitMultiplier: number;
  }> {
    if (!externalProductId && !sku) {
      console.warn(
        `[BlingOrderService] Item sem id externo e sem sku — seguindo sem custo/product_id.`,
      );
      return {
        product: null,
        averageCost: null,
        resolvedSku: sku ?? "",
        kitMultiplier: 1,
      };
    }

    const costUnitBusinessId = await this.resolveCostUnitBusinessId();

    let config: ProductConfig | null = null;
    let product: Product | null = null;

    if (externalProductId) {
      const integration = await getBlingIntegration("Bling");
      product = await integrationMappingService.findEntityByMapping(
        "PRODUCT",
        integration.id,
        externalProductId,
      );
    }

    if (!product && name) {
      product = await Product.findOne({ where: { name }, attributes: ["id"] });
    }

    if (product) {
      config = await ProductConfig.findOne({
        where: { product_id: product.id, unit_business_id: costUnitBusinessId },
        include: [
          {
            model: Product,
            as: "product",
            include: [{ model: Brand, as: "brandRegister" }],
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
      console.warn(
        `[BlingOrderService] ProductConfig não encontrado (externalProductId=${externalProductId ?? "-"}, sku=${sku ?? "-"}). Item será salvo sem custo/comissão.`,
      );
      return {
        product: null,
        averageCost: null,
        resolvedSku: sku ?? "",
        kitMultiplier: 1,
      };
    }

    let averageCost: number | null = Number(config.average_cost ?? 0);
    let kitMultiplier = 1;

    if (config.product.type === "KIT") {
      averageCost = null;
      const [kitComponent] = await productService.getKitComponents(
        config.product.id,
      );

      if (kitComponent) {
        kitMultiplier = kitComponent.quantity;
        const unitConfig = await ProductConfig.findOne({
          where: {
            product_id: kitComponent.product_component_id,
            unit_business_id: costUnitBusinessId,
          },
        });
        if (unitConfig) averageCost = Number(unitConfig.average_cost ?? 0);
      } else {
        console.warn(
          `[BlingOrderService] KIT sem kit_components cadastrado (product_id=${config.product.id}, sku=${config.sku}). Item será salvo sem custo.`,
        );
      }
    }

    return {
      product: config.product as ProductAttributes & { brandRegister?: Brand },
      averageCost,
      resolvedSku: config.sku ?? sku ?? "",
      kitMultiplier,
    };
  }

  // Comissão é sobre o preço após o desconto do pedido (desconto.valor em R$ ou % de totalProdutos).
  private orderNetProductsFactor(orderData: any): number {
    const totalProducts = Number(orderData.totalProdutos ?? 0);
    if (totalProducts <= 0) return 1;
    const discount = Number(orderData.desconto?.valor ?? 0);
    const discountAmount =
      orderData.desconto?.unidade === ORDER_DISCOUNT_TYPE_PERCENT
        ? (totalProducts * discount) / 100
        : discount;
    return (totalProducts - discountAmount) / totalProducts;
  }

  // ─── Calcula os campos financeiros de um item de pedido ────────────────────
  // Regra:
  //   average_cost_snapshot = product_config.average_cost (valor unitário puro)
  //   unidades_reais        = (n do KIT, se houver) × quantidade do item
  //   custo_medio_total     = average_cost_snapshot × unidades_reais
  //   commission_base       = itens.valor × quantidade × fator do desconto do pedido
  //                           (itens.desconto é informativo, já embutido em itens.valor)
  //   commission_rate       = brand.seller_comission_tax_rate
  //   commission_value      = commission_base × (commission_rate / 100)
  //   total_cost_snapshot   = custo_medio_total + commission_value
  //   comission_manager_rate = brand.manager_comission_tax_rate (apenas salvo, não usado em cálculo)
  // 2) buildItemFinancialFields: product agora pode ser null
  private buildItemFinancialFields(
    product: (ProductAttributes & { brandRegister?: Brand }) | null,
    averageCostUnit: number | null,
    kitMultiplier: number,
    quantity: number,
    itemValue: number,
    hasSellerCommission: boolean,
  ) {
    const brand = product?.brandRegister;

    const averageCostSnapshot =
      averageCostUnit == null ? null : averageCostUnit * kitMultiplier;

    const custoMedioTotal =
      averageCostSnapshot == null ? null : averageCostSnapshot * quantity;

    const sellerRate = hasSellerCommission
      ? Number(brand?.seller_comission_tax_rate ?? product?.commission ?? 0)
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
      cost_source: product
        ? "average_cost_plus_commission"
        : "product_config_not_found",
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
      const { data } = await blingGet(`/contatos/${contatoId}`, this.blingApi);
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
  // 3) buildItemsPayload: try/catch por item, product_id vira nullable
  private async buildItemsPayload(
    integrationId: string,
    blingItems: any[],
    hasSellerCommission: boolean,
    orderNetFactor: number,
  ): Promise<{
    items: Omit<orderItemsCreationAttributes, "order_id">[];
    custoTotalProdutos: number;
  }> {
    const items = await Promise.all(
      blingItems.map(async (i: any) => {
        const quantity = Number(i.quantidade ?? i.quantity ?? 0);
        const itemValue = Number(i.valor ?? 0);
        const discountValue = Number(i.desconto ?? 0);
        const externalProductId = i.produto?.id
          ? String(i.produto.id)
          : undefined;
        const sku = i.codigo ? String(i.codigo) : undefined;

        let product: (ProductAttributes & { brandRegister?: Brand }) | null =
          null;
        let averageCost: number | null = null;
        let resolvedSku = sku ?? "";
        let kitMultiplier = 1;

        try {
          const resolved = await this.resolveProductWithConfig(
            externalProductId,
            sku,
            i.descricao,
          );
          product = resolved.product;
          averageCost = resolved.averageCost;
          resolvedSku = resolved.resolvedSku;
          kitMultiplier = resolved.kitMultiplier;
        } catch (error: any) {
          // Falha inesperada (ex.: banco fora do ar) — não derruba o pedido,
          // só esse item fica sem custo/comissão.
          console.error(
            `[BlingOrderService] Falha ao resolver produto do item (sku=${sku ?? "-"}):`,
            error.message,
          );
        }

        const grossTotalLine = itemValue * quantity;
        // itens[].desconto é informativo (já embutido em `valor`; NF e parcelas = valor × qtd).
        const netTotal = grossTotalLine;

        const financialFields = this.buildItemFinancialFields(
          product,
          averageCost,
          kitMultiplier,
          quantity,
          grossTotalLine * orderNetFactor,
          hasSellerCommission,
        );

        return {
          name: i.descricao,
          sku: resolvedSku ?? "",
          unit: i.unidade,
          quantity,
          price: itemValue,
          product_id: product?.id ?? undefined,
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

  // Store is a small, fixed taxonomy of Bling channel *types* (`tipo`, e.g.
  // "LojaFisica", "MercadoLivre") shared across every branch of that type —
  // not one row per physical branch. `name` (the `tipo`) is the real
  // identity other code keys off directly (nfe-reconciler's
  // `where: { name: "MercadoLivre" }`, `ALLOWED_STORE_NAME`,
  // `integration.allowed_channels`), so dedup must happen on `name`, backed
  // by a DB unique index (see migration) — `id_store_system` is just a
  // cheap lookup cache for a channel id already known to resolve here, not
  // a real per-row identity.
  private async resolveStore(lojaId: number | undefined): Promise<any> {
    if (!lojaId) return null;

    const existing = await this.storeService.findOne({
      where: { id_store_system: String(lojaId) },
    });
    if (existing) return existing;

    const blingStore = await blingGet(`/canais-venda/${lojaId}`, this.blingApi);
    const tipo = blingStore.data.data.tipo;

    return this.storeService.findOrCreateByName(
      tipo,
      String(blingStore.data.data.id),
    );
  }

  async updateOrderFromBling(
    body: blingOrderWebHookData,
  ): Promise<{ customer: any; cnaes: any[]; orderSystem: any } | null> {
    try {
      const integration = await getBlingIntegration("Bling");
      if (!integration)
        throw new Error("Bling Integration não encontrada no cache");

      const { data } = await blingGet(
        `/pedidos/vendas/${body.data.id}`,
        this.blingApi,
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
          `[BlingOrderService] Pedido ${orderData.numero} não encontrado para atualizar, criando...`,
        );
        return await this.createOrderFromBling(
          {
            data: { id: orderData.id, numero: orderData.numero },
          },
          orderData,
        );
      }

      const internalStatus = mapOrderInternalStatus(orderData.situacao.id);
      const isCompleted =
        COMPLETED_ORDER_INTERNAL_STATUSES.includes(internalStatus);

      // Resolve unit_business_id se ainda estiver nulo (ou em "Sem Loja",
      // ver isUnresolved abaixo) — precisa vir antes do write defensivo
      // abaixo (não depois, como antes) pra já entrar nele e disparar a
      // criação da PdvSalesRequest o quanto antes, mesmo que as etapas de
      // enriquecimento mais abaixo (contato, endereço, item, financeiro)
      // falhem.
      let unitBusinessId: string | null =
        existingOrder.unit_business_id ?? null;

      // Além de nulo, também tenta re-resolver quando a loja atual é o
      // fallback "Sem Loja" — pedido pode ter caído nele por falta de
      // mapeamento na Bling (id_system ainda não cadastrado) e a loja
      // certa ser configurada depois; sem isso, ficaria presa em "Sem
      // Loja" pra sempre, já que nenhum outro código corrige esse campo.
      const isUnresolved =
        !unitBusinessId ||
        unitBusinessId ===
          (
            await UnitBusiness.findOne({
              where: { id_system: SEM_LOJA_ID_SYSTEM },
              attributes: ["id"],
            })
          )?.id;

      if (isUnresolved && orderData.loja?.id) {
        const unitBusiness = await UnitBusiness.findOne({
          where: { id_system: String(orderData.loja.id) },
          attributes: ["id"],
        });
        unitBusinessId = unitBusiness?.id ?? unitBusinessId;
      }

      // Grava actual_situation/internal_status/unit_business_id JÁ, antes de
      // qualquer etapa de enriquecimento abaixo (contato, endereço,
      // custo/comissão de item, financeiro) que pode lançar em pedido com
      // dado faltante ou inesperado. Sem isso, um erro em qualquer uma
      // dessas etapas secundárias deixava o pedido com status desatualizado
      // no banco, mesmo já sabendo o status real vindo da Bling. O update
      // completo mais abaixo regrava os campos de novo — redundante, mas
      // garante que o essencial nunca fica pra trás por causa de algo
      // secundário.
      let invoiceId: string | null | undefined;
      let invoiceSynced = false;
      try {
        await ordersService.update(existingOrder.id, {
          actual_situation: String(orderData.situacao.id),
          internal_status: internalStatus,
          unit_business_id: unitBusinessId,
          ...reasonCancelledFields(orderData.situacao.id),
        });
        notifyPdvStoreSync(unitBusinessId, "ORDER_STATUS_CHANGED", {
          orderId: existingOrder.id,
        });

        if (isPdvCancelledSituation(orderData.situacao.id)) {
          await pdvSalesRequestService.cancelIfActiveByOrderId(
            existingOrder.id,
          );
        } else {
          // Por estado, não por transição 12→outra: reprocessar o pedido
          // também reativa solicitação que ficou cancelada.
          await pdvSalesRequestService.reactivateIfCancelledByOrder(
            existingOrder.id,
          );
        }

        // Reavalia elegibilidade PDV em TODO update, não só quando a loja
        // resolve de nula pra preenchida — um pedido pode voltar a ficar
        // elegível depois de ter sido cancelado (situação Bling 12/21) e
        // reemitido, e nenhum outro código recria a solicitação nesse caso.
        // createEmptyRequestForNewOrderIfEligible é idempotente (no-op se
        // já existe solicitação ativa), então é seguro chamar sempre. Fica
        // junto do write defensivo acima, como garantia — não pode depender
        // de nenhuma etapa de enriquecimento abaixo que possa falhar.
        await pdvSalesRequestService.createEmptyRequestForNewOrderIfEligible(
          existingOrder.id,
        );

        // Nota também fica no bloco defensivo: PDV precisa dela rápido e
        // sempre, mesmo se o enriquecimento abaixo falhar. invoice_id vai
        // pro pedido antes porque markSaleInvoiceReady relê order.invoice_id.
        invoiceId = await this.resolveInvoiceId(orderData.notaFiscal?.id);
        if (invoiceId) {
          await ordersService.update(existingOrder.id, {
            invoice_id: invoiceId,
          });
          await pdvSalesRequestService.syncSaleInvoiceFromOrder(
            existingOrder.id,
            invoiceId,
          );
          invoiceSynced = true;
        }
      } catch (statusError: any) {
        console.error(
          `[BlingOrderService] Falha ao gravar actual_situation/internal_status/unit_business_id/nota do pedido ${orderData.numero} (seguindo mesmo assim):`,
          statusError.message,
        );
      }

      const customer = await this.blingCustomerService.updateCustomer(
        orderData.contato,
      );

      const destination = await this.resolveDestination(orderData.contato?.id);
      const fiscalFields = this.extractFiscalFields(orderData, destination);
      const sellerId = await this.upsertSellerContact(
        orderData.vendedor,
        integration.id,
      );

      const store = await this.resolveStore(orderData.loja?.id);

      if (invoiceId === undefined) {
        invoiceId = await this.resolveInvoiceId(orderData.notaFiscal?.id);
      }
      const orderPayments = await this.resolveOrderPayments(orderData.parcelas);

      // ─── Processa itens primeiro para obter custo_total_produtos ──────────
      const hasSellerCommission =
        !!orderData.vendedor?.id && Number(orderData.vendedor.id) !== 0;

      const { items: itemsPayload, custoTotalProdutos } =
        await this.buildItemsPayload(
          integration.id,
          orderData.itens ?? [],
          hasSellerCommission,
          this.orderNetProductsFactor(orderData),
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

      // ─── Guardamos os campos atualizados numa variável pra reaproveitar no retorno ───
      const orderUpdateFields = {
        unit_business_id: unitBusinessId,
        invoice_id: invoiceId,
        number_order_channel: String(orderData.numeroLoja),
        actual_situation: String(orderData.situacao.id),
        // Sempre grava meia-noite no timezone da aplicação (America/Sao_Paulo),
        // não o horário exato que o Bling manda em orderData.data — em UTC
        // isso é 03:00. Pedido pra normalizar a granularidade da venda pro
        // dia, independente da hora que o Bling registrou.
        date: startOfDayTz(orderData.data).toDate(),
        customer_id: customer.id,

        internal_status: internalStatus,
        ...reasonCancelledFields(orderData.situacao.id),
        nfe_emitted: isCompleted
          ? true
          : internalStatus === OrderInternalStatus.CANCELLED
            ? false
            : existingOrder.nfe_emitted,
        source_payload: orderData,
        total_products: Number(orderData.totalProdutos ?? 0),
        total_order: Number(orderData.totalProdutos ?? 0),
        // `total` do Bling já vem com desconto aplicado; usado só pelo PDV.
        net_total_order: Number(orderData.total ?? 0),
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
        ...collectionDateFromBling(orderData.dataPrevista),
      };

      await ordersService.update(existingOrder.id, orderUpdateFields);
      await orderPaymentService.replaceForOrder(
        existingOrder.id,
        orderPayments.map((payment) => ({
          ...payment,
          order_id: existingOrder.id,
        })),
      );

      // Fallback: o sync da nota no bloco defensivo acima não completou.
      if (invoiceId && !invoiceSynced) {
        await pdvSalesRequestService.syncSaleInvoiceFromOrder(
          existingOrder.id,
          invoiceId,
        );
      }

      // ─── NOVO: acumula os itens sincronizados pra devolver no orderSystem ────
      const syncedItems: any[] = [];

      if (orderData.itens?.length) {
        const existingItems = await orderItemsService.findAll({
          where: { order_id: existingOrder.id },
          attributes: [
            "id",
            "sku",
            "commission_base",
            "commission_rate",
            "comission_manager_rate",
            "commission_value",
            "average_cost_snapshot",
            "total_cost_snapshot",
            "cost_source",
          ],
          order: [["createdAt", "ASC"]],
        });

        // Mesmo SKU pode vir em mais de uma linha: cada linha do Bling consome um registro existente.
        const existingBySku = new Map<string, typeof existingItems>();
        for (const item of existingItems) {
          if (!item.sku) continue;
          existingBySku.set(item.sku, [
            ...(existingBySku.get(item.sku) ?? []),
            item,
          ]);
        }

        const matchedItems = (orderData.itens as any[]).map((i, idx) => {
          const computedItem = itemsPayload[idx];
          const existingItem = computedItem.sku
            ? existingBySku.get(computedItem.sku)?.shift()
            : undefined;
          return { i, computedItem, existingItem };
        });

        syncedItems.push(
          ...(await Promise.all(
            matchedItems.map(async ({ i, computedItem, existingItem }) => {
              if (!existingItem) {
                return orderItemsService.create({
                  ...computedItem,
                  order_id: existingOrder.id,
                });
              }

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

              return {
                id: existingItem.id,
                order_id: existingOrder.id,
                ...computedItem,
                ...financialFieldsUpdate,
                source_payload: i,
              };
            }),
          )),
        );

        // Linha removida/trocada no Bling: sem isso o item antigo fica órfão e distorce rateio/comissão nos relatórios.
        const removedCount = await orderItemsService.bulkDelete({
          where: {
            order_id: existingOrder.id,
            id: { [Op.notIn]: syncedItems.map((item) => item.id) },
          },
        });
        if (removedCount > 0) {
          await ordersService.touch(existingOrder.id);
        }
      }

      console.log(
        `[BlingOrderService] Pedido ${orderData.numero} atualizado com sucesso`,
      );

      if (!integration.allowed_channels?.includes(store?.name ?? "")) {
        console.log(
          "[BLING ORDER] Pedido não originado do mercado livre, apenas atualizando no sistema, pulando etapas de automação.",
        );
        return null;
      }

      if (orderData.situacao.id != 6) {
        console.log(
          'Pedido com status diferente de "EM ABERTO", pulando etapas de automação apenas atualizando no sistema.',
        );
        return null;
      }

      return {
        customer,
        cnaes: integration.cnaes,
        orderSystem: {
          ...existingOrder.dataValues,
          ...orderUpdateFields,
          customer,
          items: syncedItems,
        },
      };
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
    prefetchedOrderData?: any,
  ): Promise<{ customer: any; cnaes: any[]; orderSystem: any } | null> {
    console.log(body.data.id);
    try {
      const integration = await getBlingIntegration("Bling");

      let orderData = prefetchedOrderData;
      if (!orderData) {
        const { data } = await blingGet(
          `/pedidos/vendas/${body.data.id}`,
          this.blingApi,
        );
        orderData = data.data;
      }

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

      const store = await this.resolveStore(orderData.loja?.id);

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
        unitBusiness = await findOrCreateSemLojaUnitBusiness();
      }

      const customer = await this.blingCustomerService.getOrCreateCustomer(
        orderData.contato,
      );
      const destination = await this.resolveDestination(orderData.contato?.id);
      const fiscalFields = this.extractFiscalFields(orderData, destination);
      const invoiceId = await this.resolveInvoiceId(orderData.notaFiscal?.id);
      const orderPayments = await this.resolveOrderPayments(orderData.parcelas);
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
          this.orderNetProductsFactor(orderData),
        );

      const orderFinancials = await this.computeOrderFinancials(
        orderData,
        fiscalFields.destination_uf,
        custoTotalProdutos,
      );

      const internalStatus = mapOrderInternalStatus(orderData.situacao.id);
      const isCompleted =
        COMPLETED_ORDER_INTERNAL_STATUSES.includes(internalStatus);

      const ordersPayload: orderCreationAttributes = {
        integrations_id: integration.id,
        customer_id: customer.id,
        invoice_id: invoiceId,
        actual_situation: String(orderData.situacao.id),
        internal_status: internalStatus,
        ...reasonCancelledFields(orderData.situacao.id),
        nfe_emitted: isCompleted,
        unit_business_id: unitBusiness?.id ?? null,
        id_order_system: String(orderData.id),
        number_order_system: String(orderData.numero),
        number_order_channel: String(orderData.numeroLoja),
        // Sempre grava meia-noite no timezone da aplicação (America/Sao_Paulo),
        // não o horário exato que o Bling manda em orderData.data — em UTC
        // isso é 03:00. Pedido pra normalizar a granularidade da venda pro
        // dia, independente da hora que o Bling registrou.
        date: startOfDayTz(orderData.data).toDate(),
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
        ...collectionDateFromBling(orderData.dataPrevista),
      };

      const createdOrder = await ordersService.create(ordersPayload);
      await orderPaymentService.replaceForOrder(
        createdOrder.id,
        orderPayments.map((payment) => ({
          ...payment,
          order_id: createdOrder.id,
        })),
      );
      // Só na criação (nunca no update) — pedido já nasce com uma
      // PdvSalesRequest vazia se for elegível pro fluxo PDV (ver
      // createEmptyRequestForNewOrderIfEligible).
      const createdRequest =
        await pdvSalesRequestService.createEmptyRequestForNewOrderIfEligible(
          createdOrder.id,
        );

      if (invoiceId) {
        await pdvSalesRequestService.syncSaleInvoiceFromOrder(
          createdOrder.id,
          invoiceId,
        );
      }

      // Só depois da solicitação pronta (criada + nota sincronizada) — senão o
      // front recarrega o quadro antes do card existir.
      if (createdRequest) {
        notifyPdvStoreSync(createdOrder.unit_business_id, "NEW_ORDER", {
          orderId: createdOrder.id,
        });
      }

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
