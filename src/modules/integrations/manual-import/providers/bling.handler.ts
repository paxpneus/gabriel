import { Op } from "sequelize";
import { blingApi, getBlingIntegration } from "../../../handlers/bling/api/bling_api.service";
import { blingGet } from "../../../handlers/bling/services/bling/helpers/get-with-sleep";
import {
  BLING_INVOICE_CUTOFF_DATE_PARAM,
  getBlingInvoiceReferenceDate,
  isKnownBlingInvoiceBeforeCutoff,
} from "../../../handlers/bling/services/bling/bling-invoice-cutoff";
import {
  BLING_LIST_PAGE_SIZE,
  BlingQuery,
  buildBlingApiFetchPayload,
  fetchBlingListPage,
  mapBlingInvoiceStatus,
} from "../../../handlers/bling/services/bling-sync/helpers/bling-list";
import invoiceService from "../../../warehouse/fiscal/invoices/invoice/invoice.service";
import orderService from "../../../sales/orders/order/orders.service";
import integrationOrderStatusMappingService from "../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";
import { ManualImportError } from "../manual-import.errors";
import { manualImportJobOptions } from "../manual-import.constants";
import {
  findProductExternalId,
  findProductLocalIds,
} from "../helpers/product-mapping";
import {
  ManualImportEntity,
  ManualImportExternalSearchBy,
  ManualImportFoundItem,
  ManualImportHandler,
  ManualImportJobRef,
  ManualImportQueueKey,
  ManualImportQueues,
  ManualImportSavedItem,
  ManualImportSearchOutput,
} from "../manual-import.types";

// Campos da Bling usados na busca (listagem e detalhe trazem os mesmos).
interface BlingProductSummary {
  id: number;
  nome?: string;
  codigo?: string;
  gtin?: string;
  situacao?: string;
}

interface BlingInvoiceSummary {
  id: number;
  numero?: string;
  serie?: string | number;
  tipo?: number;
  situacao?: number;
  dataEmissao?: string;
  dataOperacao?: string;
  contato?: { nome?: string };
}

interface BlingOrderSummary {
  id: number;
  numero?: number | string;
  numeroLoja?: string;
  data?: string;
  contato?: { nome?: string };
  situacao?: { id?: number };
}

// O que o job de nota precisa e não dá pra tirar do externalId.
interface BlingInvoiceEnqueueData {
  number?: string;
  situacao?: number;
}

// Import manual da Bling só traz nota de venda: NF-e (sem NFC-e) de saída.
const INVOICE_ENDPOINT = "/nfe";
const SALE_INVOICE_TYPE = 1;

const ORDER_ENDPOINT = "/pedidos/vendas";

// Normaliza campo opcional da API pra string | null na exibição.
function toNullableString(value: unknown): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}

// Id da Bling é inteiro positivo; qualquer outra coisa vira 400 antes de chamar a API.
function parseBlingId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ManualImportError(400, {
      code: "INVALID_SEARCH_VALUE",
      message: "Id da Bling inválido",
    });
  }
  return id;
}

// Listagens da Bling não filtram por id — o detalhe responde 404 quando não existe.
async function fetchBlingByIdOrNull<T>(
  endpoint: string,
  id: number,
): Promise<T | null> {
  try {
    const { data } = await blingGet<{ data: T }>(`${endpoint}/${id}`, blingApi);
    return data?.data ?? null;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}

// Produto Bling → item da busca (sempre importável).
function toProductItem(product: BlingProductSummary): ManualImportFoundItem {
  return {
    externalId: String(product.id),
    label: `${product.codigo ?? product.id} - ${product.nome ?? ""}`.trim(),
    details: {
      name: toNullableString(product.nome),
      ean: toNullableString(product.gtin),
      code: toNullableString(product.codigo),
      status: toNullableString(product.situacao),
    },
    importable: true,
    enqueueData: null,
  };
}

// Motivo de não importar a nota: entrada (busca por id acha qualquer tipo) ou anterior ao corte.
function invoiceBlockReason(
  invoice: BlingInvoiceSummary,
  tipo: number | undefined,
): string | undefined {
  if (tipo !== undefined && tipo !== SALE_INVOICE_TYPE) {
    return "Só nota de venda (NF-e de saída) pode ser importada";
  }
  const referenceDate = getBlingInvoiceReferenceDate(invoice);
  if (referenceDate && isKnownBlingInvoiceBeforeCutoff(referenceDate)) {
    return `Nota anterior ao corte (${BLING_INVOICE_CUTOFF_DATE_PARAM})`;
  }
  return undefined;
}

// NF-e Bling → item da busca; bloqueada vem importable:false com o motivo.
function toInvoiceItem(
  invoice: BlingInvoiceSummary,
  queriedType?: number,
): ManualImportFoundItem {
  const tipo = invoice.tipo ?? queriedType;
  const reason = invoiceBlockReason(invoice, tipo);
  const enqueueData: BlingInvoiceEnqueueData = {
    number: invoice.numero,
    situacao: invoice.situacao,
  };

  return {
    externalId: String(invoice.id),
    label: `NF-e ${invoice.numero ?? invoice.id}`,
    details: {
      number: toNullableString(invoice.numero),
      series: toNullableString(invoice.serie),
      model: "NF-e",
      type: tipo === 0 ? "IN" : tipo === SALE_INVOICE_TYPE ? "OUT" : null,
      issuedAt: toNullableString(invoice.dataEmissao ?? invoice.dataOperacao),
      contact: toNullableString(invoice.contato?.nome),
      status: toNullableString(invoice.situacao),
    },
    importable: !reason,
    ...(reason ? { reason } : {}),
    enqueueData,
  };
}

// Import manual da Bling: produto, nota de venda (NF-e de saída) e pedido.
export class BlingManualImportHandler implements ManualImportHandler {
  supportedSearches: ManualImportHandler["supportedSearches"] = {
    product: ["id", "name"],
    invoice: ["id", "number"],
    order: ["id", "number"],
  };

  localIdSearchBy: ManualImportHandler["localIdSearchBy"] = {
    product: "id",
    invoice: "id",
    order: "id",
  };

  queueKeys: ManualImportQueueKey[] = ["blingApiFetch", "blingOrder"];

  // Com cacheKey: usa o cache de integração em vez de consultar o banco a cada chamada.
  getIntegration() {
    return getBlingIntegration("Bling");
  }

  // Pedido vai pro pipeline de pedidos; produto e nota pro BLING_API_FETCH.
  queueFor(entity: ManualImportEntity): ManualImportQueueKey {
    return entity === "order" ? "blingOrder" : "blingApiFetch";
  }

  // Despacha pra busca da entidade; o service já validou que o `by` é suportado.
  async search(
    entity: ManualImportEntity,
    by: ManualImportExternalSearchBy,
    value: string,
  ): Promise<ManualImportSearchOutput> {
    if (entity === "product") return this.searchProducts(by, value);
    if (entity === "invoice") return this.searchInvoices(by, value);
    return this.searchOrders(by, value);
  }

  // Existe localmente: produto via mapping, nota por id_system, pedido por id_order_system.
  async findLocalIds(
    entity: ManualImportEntity,
    externalIds: string[],
  ): Promise<Map<string, string>> {
    const { id: integrationId } = await this.getIntegration();

    if (entity === "product") {
      return findProductLocalIds(integrationId, externalIds);
    }

    if (entity === "invoice") {
      const invoices = await invoiceService.findAll({
        where: {
          integrations_id: integrationId,
          id_system: { [Op.in]: externalIds },
        },
        attributes: ["id", "id_system"],
      });
      return new Map(invoices.map((invoice) => [invoice.id_system!, invoice.id]));
    }

    const orders = await orderService.findAll({
      where: {
        integrations_id: integrationId,
        id_order_system: { [Op.in]: externalIds },
      },
      attributes: ["id", "id_order_system"],
    });
    return new Map(orders.map((order) => [order.id_order_system!, order.id]));
  }

  // by: local_id — filtra pela integração, então registro de outra integração volta null (422).
  async findExternalIdByLocalId(
    entity: ManualImportEntity,
    localId: string,
  ): Promise<string | null> {
    const { id: integrationId } = await this.getIntegration();

    if (entity === "product") {
      return findProductExternalId(integrationId, localId);
    }

    if (entity === "invoice") {
      const invoice = await invoiceService.findOne({
        where: { id: localId, integrations_id: integrationId },
        attributes: ["id_system"],
      });
      return invoice?.id_system ?? null;
    }

    const order = await orderService.findOne({
      where: { id: localId, integrations_id: integrationId },
      attributes: ["id_order_system"],
    });
    return order?.id_order_system ?? null;
  }

  // Mesmos payloads do sync/webhook, só com prioridade e nome de job manual.
  async enqueue(
    entity: ManualImportEntity,
    item: ManualImportSavedItem,
    jobRef: ManualImportJobRef,
    queues: ManualImportQueues,
  ): Promise<void> {
    const blingId = Number(item.externalId);

    // Sem create: produto sem mapping vira unmapped, igual ao webhook.
    if (entity === "product") {
      await queues.blingApiFetch.add(
        buildBlingApiFetchPayload("product", blingId),
        jobRef.jobId,
        manualImportJobOptions(),
      );
      return;
    }

    if (entity === "invoice") {
      const data = item.enqueueData as BlingInvoiceEnqueueData;
      await queues.blingApiFetch.add(
        buildBlingApiFetchPayload("invoice", blingId, {
          blingId,
          number: data.number,
          id_system: item.externalId,
          status: mapBlingInvoiceStatus(data.situacao),
        }),
        jobRef.jobId,
        manualImportJobOptions(),
      );
      return;
    }

    // "order.updated" cria o pedido se ele ainda não existir.
    await queues.blingOrder.add(
      { event: "order.updated", action: "updated", data: { id: blingId } },
      jobRef.jobId,
      manualImportJobOptions(),
    );
  }

  // GET /produtos filtrando por idsProdutos[] ou nome; só a 1ª página.
  private async searchProducts(
    by: ManualImportExternalSearchBy,
    value: string,
  ): Promise<ManualImportSearchOutput> {
    const query: BlingQuery =
      by === "id" ? { idsProdutos: [parseBlingId(value)] } : { nome: value };
    const products = await fetchBlingListPage<BlingProductSummary>(
      "/produtos",
      query,
    );
    return {
      items: products.map(toProductItem),
      truncated: products.length >= BLING_LIST_PAGE_SIZE,
    };
  }

  // Por id: detalhe da NF-e. Por número: listagem de NF-e de saída (tipo=1).
  private async searchInvoices(
    by: ManualImportExternalSearchBy,
    value: string,
  ): Promise<ManualImportSearchOutput> {
    if (by === "id") {
      const invoice = await fetchBlingByIdOrNull<BlingInvoiceSummary>(
        INVOICE_ENDPOINT,
        parseBlingId(value),
      );
      return { items: invoice ? [toInvoiceItem(invoice)] : [], truncated: false };
    }

    const invoices = await fetchBlingListPage<BlingInvoiceSummary>(
      INVOICE_ENDPOINT,
      { numero: value, tipo: SALE_INVOICE_TYPE },
    );
    return {
      items: invoices.map((invoice) => toInvoiceItem(invoice, SALE_INVOICE_TYPE)),
      truncated: invoices.length >= BLING_LIST_PAGE_SIZE,
    };
  }

  // Por id: detalhe do pedido (a listagem não filtra por id). Por número: listagem.
  private async searchOrders(
    by: ManualImportExternalSearchBy,
    value: string,
  ): Promise<ManualImportSearchOutput> {
    let orders: BlingOrderSummary[];
    if (by === "id") {
      const order = await fetchBlingByIdOrNull<BlingOrderSummary>(
        ORDER_ENDPOINT,
        parseBlingId(value),
      );
      orders = order ? [order] : [];
    } else {
      orders = await fetchBlingListPage<BlingOrderSummary>(ORDER_ENDPOINT, {
        numero: value,
      });
    }

    if (!orders.length) return { items: [], truncated: false };

    const statusNames = await this.findOrderStatusNames();

    return {
      items: orders.map((order) => {
        const situationId = toNullableString(order.situacao?.id);
        return {
          externalId: String(order.id),
          label: `Pedido ${order.numero ?? order.id}`,
          details: {
            number: toNullableString(order.numero),
            storeNumber: toNullableString(order.numeroLoja),
            date: toNullableString(order.data),
            contact: toNullableString(order.contato?.nome),
            status: situationId
              ? (statusNames.get(situationId) ?? situationId)
              : null,
          },
          importable: true,
          enqueueData: null,
        };
      }),
      truncated: by !== "id" && orders.length >= BLING_LIST_PAGE_SIZE,
    };
  }

  // id de situação da Bling → nome exibível, pelo mapeamento de status da integração.
  private async findOrderStatusNames(): Promise<Map<string, string>> {
    const { id: integrationId } = await this.getIntegration();
    const mappings =
      await integrationOrderStatusMappingService.findByIntegration(integrationId);
    return new Map(
      mappings.map((mapping) => [mapping.external_status_id, mapping.display_name]),
    );
  }
}

export default new BlingManualImportHandler();
