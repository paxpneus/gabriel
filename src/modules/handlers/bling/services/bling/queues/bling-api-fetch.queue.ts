import {
  FullInvoiceForAllUnits,
  InvoiceStatus,
  ItemWithFiscal,
} from "../../../../../warehouse/invoices/invoice/invoice.types";
import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { ApiFetchRequest, WebhookQueuePayload } from "../bling-webhook.types";
import { blingApi, getBlingIntegration } from "../../../api/bling_api.service";
import {
  Product,
  ProductConfig,
  Stock,
  Supplier,
} from "../../../../../inventory";
import { SupplierMapping } from "../../../../../inventory";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import {
  Invoice,
  InvoiceItems,
  UnitBusiness,
  Transporter,
  ExpeditionBatch,
  ExpeditionBatchItems,
  ExpeditionBatchInvoice,
} from "../../../../../warehouse";
import parser from "../../../../../../shared/utils/xml/xml-parser";
import { cleanDocument } from "../../../../../../shared/utils/normalizers/document";
import { encryptXml } from "../../../../../../shared/utils/xml/xml-cipher";
import Store from "../../../../../sales/stores/stores.model";
import Contact from "../../../../../sales/contacts/contacts.model";
import { Op } from "sequelize";
import UnmappedInvoiceProduct from "../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import InvoiceFiscalItem from "../../../../../warehouse/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import {
  formatBlingInvoiceCutoffForLog,
  getBlingInvoiceReferenceDate,
  isBlingInvoiceOnOrAfterCutoff,
} from "../bling-invoice-cutoff";
import { BLING_SHARED_QUEUE_LOCK } from "./bling-queue-lock";
import {
  logDbError,
  rethrowWithLog,
} from "../../../../../../shared/utils/logging/db-errors-logs";
import magentoCatalogService from "../../../../magentoV2/service/catalog/products/products.service";
import invoiceService from "../../../../../warehouse/invoices/invoice/invoice.service";
import { InvoiceUnitBusinessAttributesStatus } from "../../../../../warehouse/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import invoiceItemsService from "../../../../../warehouse/invoices/invoice-items/invoice-items.service";
import { upsertInvoiceFromXml } from "../../../../../../shared/utils/xml/invoice-xml";
import brandsService from "../../../../../inventory/brands/brands.service";
import Group from "../../../../../inventory/groups/group/group.model";
import Subgroup from "../../../../../inventory/groups/subgroup/subgroup.model";
import { GroupType } from "../../../../../inventory/groups/group/group.types";
import { resolveProductWithMapping } from "../../../../tecinco/queues/helpers/product.helpers";
import integrationMappingService from "../../../../../integrations/integration-mapping/integration-mapping.service";
import { getMagentoIntegration } from "../../../../magentoV2/api/magentoV2_api";
import stockMovementsService from "../../../../../inventory/stock/stock-movements/stock-movements.service";
import InventoryBatchItems from "../../../../../inventory/stock-inventory/inventory-batch-items/inventory-batch-items.model";
import InventoryBatch from "../../../../../inventory/stock-inventory/inventory-batch/inventory-batch.model";

const BLING_UNIT_BUSINESS_ID = process.env.BLING_UNIT_BUSINESS_ID;
const BLING_UNIT_BUSINESS_CNPJ = "02316749002111";
const NO_TRANSPORTER_NAME = "Sem transporte";
const NO_TRANSPORTER_DOCUMENT = "0000000";
const BLING_IMPORTED_TIRE_GROUP_NAME = "PNEUS IMPORTADOS";

function parseBlingDate(date: string) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(date)) {
    return new Date(date);
  }
  return new Date(date.replace(" ", "T") + "-03:00");
}

// ─── Extrai measure e line do nome do produto ─────────────────────────────────
// measure: token com padrão numérico + barra + letra  ex: "165/70R14", "192/20R"
// line:    tokens após a measure até o final, excluindo a própria marca
export function extractProductMeasureAndLine(
  nome: string,
  marca?: string,
): { measure: string | null; line: string | null } {
  if (!nome) return { measure: null, line: null };

  const tokens = nome.trim().split(/\s+/);

  // Measure: primeiro token que começa com dígito e contém barra seguida de letra
  // Exemplos válidos: 165/70R14, 192/20R, 205/55R16, 7.50R16
  const measureIndex = tokens.findIndex((t) =>
    /^\d[\d.,]*\/\d+[A-Za-z]/i.test(t),
  );

  if (measureIndex === -1) return { measure: null, line: null };

  const measure = tokens[measureIndex];

  // Line: tokens após a measure
  const afterMeasure = tokens.slice(measureIndex + 1);

  if (!afterMeasure.length) return { measure, line: null };

  // Remove a marca do final se bater (case-insensitive)
  // ex: "Bravuris 5HM Barum" com marca "Barum" → "Bravuris 5HM"
  let lineTokens = [...afterMeasure];

  if (marca) {
    const brandTokens = marca.trim().split(/\s+/);
    const brandLen = brandTokens.length;

    const tailMatches = lineTokens
      .slice(-brandLen)
      .every((t, i) => t.toLowerCase() === brandTokens[i].toLowerCase());

    if (tailMatches) {
      lineTokens = lineTokens.slice(0, -brandLen);
    }
  }

  const line = lineTokens.length ? lineTokens.join(" ") : null;

  return { measure, line };
}

function extractRimFromMeasure(measure?: string | null): string | null {
  const match = measure?.match(/R\s*(\d{1,2})/i);
  return match?.[1] ?? null;
}

async function resolveBlingImportedTireSubgroup(
  measure?: string | null,
  logPrefix = "[BLING_API_FETCH]",
): Promise<Subgroup | null> {
  let group = await Group.findOne({
    where: {
      type: GroupType.PRODUCTS,
      name: { [Op.iLike]: BLING_IMPORTED_TIRE_GROUP_NAME },
    },
  });

  if (!group) {
    group = await Group.create({
      name: BLING_IMPORTED_TIRE_GROUP_NAME,
      type: GroupType.PRODUCTS,
    });
    console.log(`${logPrefix} Grupo criado: ${group.name}`);
  }

  const rim = extractRimFromMeasure(measure);

  if (!rim) {
    console.warn(
      `${logPrefix} Aro não resolvido para measure=${measure ?? "N/A"}; produto salvo sem subgroup_id.`,
    );
    return null;
  }

  const subgroupName = `ARO ${rim}`;
  let subgroup = await Subgroup.findOne({
    where: {
      group_id: group.id,
      name: { [Op.iLike]: subgroupName },
    },
  });

  if (!subgroup) {
    subgroup = await Subgroup.create({
      name: subgroupName,
      group_id: group.id,
    });
    console.log(
      `${logPrefix} Subgrupo criado: ${group.name} > ${subgroup.name}`,
    );
  }

  return subgroup;
}

// ─── Extrai partes da NF-e do XML ─────────────────────────────────────────────
// CORREÇÃO 1: adicionados destinationUf e destinationCity a partir de dest.enderDest
export function extractPartiesFromXml(xml: string) {
  const parsed = parser.parse(xml);

  const nfe =
    parsed?.nfeProc?.NFe?.infNFe ||
    parsed?.procNFe?.NFe?.infNFe ||
    parsed?.NFe?.infNFe;

  const refNFeMatch = xml.match(/<refNFe>(\d{44})<\/refNFe>/);
  const refNfeResult = refNFeMatch ? refNFeMatch[1] : null;
  const refNFe = refNfeResult ? Number(refNfeResult.slice(25, 34)) : null;

  const emit = nfe?.emit ?? {};
  const dest = nfe?.dest ?? {};
  const transp = nfe?.transp ?? {};

  const senderCnpj = emit?.CNPJ ?? "";
  const senderName = emit?.xNome ?? "";

  const receiverCnpj = dest?.CNPJ || dest?.CPF || dest?.cnpj || dest?.cpf || "";
  const receiverName = dest?.xNome ?? "";

  // UF e município real do destinatário — fonte fiscal confiável para o relatório
  const destEnder = dest?.enderDest ?? {};
  const destinationUf: string = destEnder?.UF ?? "";
  const destinationCity: string = destEnder?.xMun ?? "";

  const transporter = transp?.transporta ?? {};

  const transporterName = transporter?.xNome ?? "";
  const transporterDocument = transporter?.CNPJ ?? transporter?.CPF ?? "";
  const transporterCity = transporter?.xMun ?? "";
  const transporterUf = transporter?.UF ?? "";

  return {
    senderCnpj,
    senderName,
    receiverCnpj,
    receiverName,
    destinationUf,
    destinationCity,
    transporterName,
    transporterDocument,
    transporterCity,
    transporterUf,
    refNFe: refNFe !== null ? String(refNFe) : null,
  };
}

// ─── Extrai totais fiscais do nó ICMSTot do XML ────────────────────────────────
// CORREÇÃO 2: helper que lê total/ICMSTot e retorna campos fiscais da invoice
function extractInvoiceFiscalTotalsFromXml(xml: string): {
  invoiceValue: number;
  invoiceProductsValue: number;
  invoiceFreightValue: number;
  invoiceDiscountValue: number;
  invoiceTotalTaxValue: number;
  icmsValue: number;
  ipiValue: number;
  pisValue: number;
  cofinsValue: number;
  difalValue: number;
  ibsValue: number;
  cbsValue: number;
} {
  const parsed = parser.parse(xml);

  const nfe =
    parsed?.nfeProc?.NFe?.infNFe ||
    parsed?.procNFe?.NFe?.infNFe ||
    parsed?.NFe?.infNFe;

  const tot = nfe?.total?.ICMSTot ?? {};

  return {
    invoiceValue: Number(tot?.vNF ?? 0),
    invoiceProductsValue: Number(tot?.vProd ?? 0),
    invoiceFreightValue: Number(tot?.vFrete ?? 0),
    invoiceDiscountValue: Number(tot?.vDesc ?? 0),
    invoiceTotalTaxValue: Number(tot?.vTotTrib ?? 0),
    icmsValue: Number(tot?.vICMS ?? 0),
    ipiValue: Number(tot?.vIPI ?? 0),
    pisValue: Number(tot?.vPIS ?? 0),
    cofinsValue: Number(tot?.vCOFINS ?? 0),
    // DIFAL vem de vICMSUFDest no ICMSTot
    difalValue: Number(tot?.vICMSUFDest ?? 0),
    // IBS e CBS ainda não têm campo consolidado no ICMSTot padrão — ficam 0 por ora
    // serão preenchidos via soma dos itens quando disponíveis
    ibsValue: 0,
    cbsValue: 0,
  };
}

export interface ApiFetchJobPayload extends WebhookQueuePayload {
  apiFetch: ApiFetchRequest;
}

// ─── Tipos de resposta da API Bling (mínimo necessário) ───────────────────────

interface BlingApiProduct {
  id: number;
  nome: string;
  codigo: string;
  gtin?: string;
  gtinEmbalagem?: string;
  preco: number;
  precoCusto: number;
  precoCompra: number;
  formato?: string;
  unidade?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  marca?: string;
  estoque?: { saldoVirtualTotal?: number };
  fornecedor?: {
    id?: number;
    codigo?: string;
    precoCusto?: number;
    precoCompra?: number;
    contato?: {
      id?: number;
      nome?: string;
    };
  };
  tributacao?: {
    ncm?: string;
    cest?: string;
  };
  // ─── NOVO: estrutura de KIT (formato === "E") ──────────────────────────────
  estrutura?: {
    tipoEstoque?: string;
    lancamentoEstoque?: string;
    componentes?: Array<{
      produto: { id: number };
      quantidade: number;
    }>;
  };
}

interface BlingApiSupplier {
  id: number;
  cnpj?: string;
  cpf?: string;
  nome: string;
}

interface BlingApiProductSupplier {
  id: number;
  codigo?: string;
  produto: { id: number };
  fornecedor: BlingApiSupplier;
}

// CORREÇÃO 2: campos fiscais adicionados ao tipo
interface BlingApiInvoice {
  id: number;
  tipo?: number;
  situacao?: number;
  numero?: string;
  chaveAcesso?: string;
  dataEmissao?: string;
  dataOperacao?: string;
  contato?: {
    id: number;
    nome?: string;
    numeroDocumento?: string;
    endereco?: {
      uf?: string;
      municipio?: string;
    };
  };
  loja?: { id: number };
  vendedor?: { id: number };
  naturezaOperacao?: { id: number };
  transporte: {
    transportador: {
      numeroDocumento: string;
      nome: string;
    };
  };
  itens?: BlingApiInvoiceItem[];
  emitente?: { cnpj?: string; nome?: string };
  destinatario?: { cnpj?: string; cpf?: string; nome?: string };
  xml?: string;
  linkPDF?: string;
  // Campos fiscais vindos da API Bling
  valorNota?: number;
  valorFrete?: number;
  totalProdutos?: number;
  tributacao?: {
    totalICMS?: number;
    totalIPI?: number;
  };
}

interface BlingApiInvoiceItem {
  id: number;
  codigo?: string;
  descricao?: string;
  quantidade: number;
  valor?: number;
  gtin: string | number;
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export class BlingApiFetchQueue extends BaseQueueService<ApiFetchJobPayload> {
  private api: AxiosInstance;

  constructor(options: { workless?: boolean } = {}) {
    super("BLING_API_FETCH", {
      concurrency: 1,
      limiter: {
        max: 2,
        duration: 1000,
      },
      sharedLock: BLING_SHARED_QUEUE_LOCK,
      maxProcessingMs: 120_000,
      lockDuration: 10 * 60 * 1000,
      workless: options.workless,
      backoffStrategy: (attemptsMade, _type, err) => {
        const status = (err as any)?.response?.status;
        const retryAfter = (err as any)?.response?.headers?.["retry-after"];

        // Erros de dados — bull mq não faz backoff
        if (
          err?.name === "SequelizeUniqueConstraintError" ||
          err?.name?.startsWith("Sequelize") ||
          status === 400 ||
          status === 404
        ) {
          return -1; // BullMQ não agenda retry
        }

        if (retryAfter) {
          const waitMs = Number(retryAfter) * 1000;
          console.warn(
            `[BLING_BACKOFF] Retry-After=${retryAfter}s — aguardando`,
          );
          return Math.min(waitMs + 5_000, 12 * 60 * 1000);
        }

        if (status === 429)
          return Math.min(attemptsMade * 30_000, 3 * 60 * 1000);
        if (status === 503) return 60_000;

        if (
          err?.message?.includes("aborted") ||
          err?.message?.includes("fetch")
        ) {
          return 5_000;
        }

        return 3_000;
      },
    });

    this.api = blingApi;
  }

  private async fetchPhysicalStock(blingId: number): Promise<number> {
    const params = new URLSearchParams();
    params.append("idsProdutos[]", String(blingId));
    params.append("filtroSaldoEstoque", "1");

    const { data } = await this.api.get<{
      data: Array<{ produto: { id: number }; saldoFisicoTotal: number }>;
    }>(`/estoques/saldos?${params.toString()}`);

    const saldo = data?.data?.find((s) => s.produto.id === blingId);
    return Number(saldo?.saldoFisicoTotal ?? 0);
  }

  private async syncStockAndBatches(params: {
    product: Product;
    unitBusiness: UnitBusiness;
    newQuantity: number;
    averageCost: number;
  }): Promise<void> {
    const { product, unitBusiness, newQuantity, averageCost } = params;
    const logPrefix = `[BLING_API_FETCH] syncStockAndBatches product=${product.id}`;

    if (newQuantity < 0) {
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Estoque negativo",
        message: `Estoque bling negativo para o produto ${product.name}`,
      });
      throw new Error(
        `${logPrefix} Stock com quantidade negativa, mandando alerta!`,
      );
    }

    const newTotalPrice = newQuantity * averageCost;

    await Stock.upsert(
      {
        product_id: product.id,
        quantity: newQuantity,
        unit_business_id: unitBusiness.id,
        total_price: newTotalPrice,
      },
      { conflictFields: ["product_id", "unit_business_id"] },
    );

    const savedStock = await Stock.findOne({
      where: { product_id: product.id, unit_business_id: unitBusiness.id },
    });

    if (savedStock && Number(savedStock.quantity) < 0) {
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Estoque negativo após upsert",
        message: `Produto: ${product.name} | Qty no banco: ${savedStock.quantity}`,
      });
      throw new Error(
        `${logPrefix} Stock com quantidade negativa após upsert, mandando alerta!`,
      );
    }

    console.log(
      `${logPrefix} Stock upsertado: ean=${product.ean} | qty=${newQuantity} | avg_cost=${averageCost.toFixed(4)} | total_price=${newTotalPrice.toFixed(2)}`,
    );

    // ─── Sincroniza InventoryBatches ────────────────────────────────────────
    const affectedBatches = await InventoryBatch.findAll({
      where: {
        mode: "CYCLIC",
        status: { [Op.in]: ["OPEN", "PENDING"] },
      },
      include: [
        {
          model: InventoryBatchItems,
          as: "items",
          where: { product_id: product.id },
          required: true,
        },
      ],
    });

    for (const batch of affectedBatches) {
      await InventoryBatchItems.update(
        { quantity_stock: newQuantity },
        { where: { inventory_batch_id: batch.id, product_id: product.id } },
      );

      const newTotalQuantityStock =
        (await InventoryBatchItems.sum("quantity_stock", {
          where: { inventory_batch_id: batch.id },
        })) ?? 0;

      await batch.update({ total_quantity_stock: newTotalQuantityStock });

      console.log(
        `${logPrefix} InventoryBatch ${batch.id} atualizado | total_quantity_stock=${newTotalQuantityStock}`,
      );
    }

    console.log(
      `${logPrefix} ${affectedBatches.length} batch(es) sincronizado(s)`,
    );
  }

  // ─── Magento: busca produto por SKU (usado tanto pro price quanto pro mapping) ──
  private async fetchMagentoProduct(
    sku: string,
    logPrefix: string,
  ): Promise<any | null> {
    try {
      return await magentoCatalogService.obterProduto(sku);
    } catch (error: any) {
      if (error?.response?.status === 404) return null;

      console.warn(
        `${logPrefix} Falha ao consultar produto no Magento | sku=${sku} | erro=${error?.message}`,
      );
      return null;
    }
  }

  // ─── Sincronização de produto com o Magento (mapping / unmapped) ──────────
  private async syncProductWithMagento(params: {
    product: Product;
    sku: string | null;
    ean?: string | null;
    productName: string;
    magentoProduct: any | null;
    magentoIntegration: { id: string };
    logPrefix: string;
  }): Promise<void> {
    const {
      product,
      sku,
      ean,
      productName,
      magentoProduct,
      magentoIntegration,
      logPrefix,
    } = params;

    if (!sku) {
      console.warn(
        `${logPrefix} Sem SKU para sincronizar com Magento — ignorado.`,
      );
      return;
    }

    if (!magentoProduct) {
      const normalizedEan = ean && ean.trim() !== "" ? ean : null;

      const existingUnmapped = await UnmappedInvoiceProduct.findOne({
        where: {
          invoice_id: null,
          sku,
        },
      });

      if (!existingUnmapped) {
        await UnmappedInvoiceProduct.create({
          invoice_id: null,
          integrations_id: magentoIntegration.id,
          sku,
          ean: normalizedEan,
          product_name: productName,
          quantity: 0,
          reason: "Produto não encontrado no Magento",
          status: "UNMAPPED",
        });
        console.warn(
          `${logPrefix} Produto não encontrado no Magento — unmapped registrado | sku=${sku}`,
        );
      } else {
        console.log(
          `${logPrefix} Produto já registrado como unmapped no Magento | sku=${sku}`,
        );
      }

      return;
    }

    await integrationMappingService.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: product.id,
      external_id: String(magentoProduct.sku ?? sku),
      integrations_id: magentoIntegration.id,
    });

    console.log(
      `${logPrefix} Produto mapeado no Magento | sku=${sku} | magento_sku=${magentoProduct.sku ?? sku}`,
    );
  }

  private async resolveKitComponentSku(
    componentBlingId: number,
    logPrefix: string,
  ): Promise<string | null> {
    const localProduct = await Product.findOne({
      where: { id_system: String(componentBlingId) },
    });

    if (localProduct) {
      const localConfig = await ProductConfig.findOne({
        where: {
          product_id: localProduct.id,
          unit_business_id: BLING_UNIT_BUSINESS_ID,
        },
      });
      if (localConfig?.sku) return localConfig.sku;
    }

    try {
      const { data } = await this.api.get<{ data: BlingApiProduct }>(
        `/produtos/${componentBlingId}`,
      );
      return data.data?.codigo ?? null;
    } catch (error: any) {
      console.warn(
        `${logPrefix} Não foi possível resolver componente do KIT | componentBlingId=${componentBlingId} | erro=${error.response?.data ?? error.message}`,
      );
      return null;
    }
  }

  // ─── Helper: busca ou cria transportadora ────────────────────────────────────
  private async findOrCreateTransporter(params: {
    document: string | null;
    name: string | null;
    city?: string | null;
    uf?: string | null;
  }): Promise<Transporter | null> {
    const { document, name, city, uf } = params;
    const isNoTransporterFallback =
      name === NO_TRANSPORTER_NAME &&
      (!document || cleanDocument(document) === NO_TRANSPORTER_DOCUMENT);

    if (isNoTransporterFallback) {
      const existingNoTransporter = await Transporter.findOne({
        where: {
          [Op.or]: [
            { cnpj: NO_TRANSPORTER_DOCUMENT },
            { name: NO_TRANSPORTER_NAME },
          ],
        },
      });

      if (existingNoTransporter) {
        if (!existingNoTransporter.cnpj) {
          await existingNoTransporter.update({ cnpj: NO_TRANSPORTER_DOCUMENT });
        }
        return existingNoTransporter;
      }

      const createdNoTransporter = await Transporter.create({
        name: NO_TRANSPORTER_NAME,
        cnpj: NO_TRANSPORTER_DOCUMENT,
        city: city ?? "",
        uf: uf ?? "",
      });

      console.log(
        `[TRANSPORTER] Transportadora padrão criada automaticamente: cnpj=${NO_TRANSPORTER_DOCUMENT}, nome=${NO_TRANSPORTER_NAME}`,
      );
      return createdNoTransporter;
    }

    if (!document) return null;

    const cleanDoc = cleanDocument(document);
    if (!cleanDoc) return null;

    const existing = await Transporter.findOne({ where: { cnpj: cleanDoc } });
    if (existing) return existing;

    if (!name) {
      console.warn(
        `[TRANSPORTER] Documento ${cleanDoc} sem nome — transportadora não criada.`,
      );
      return null;
    }

    const created = await Transporter.create({
      name,
      cnpj: cleanDoc,
      city: city ?? "",
      uf: uf ?? "",
    });

    console.log(
      `[TRANSPORTER] Transportadora criada automaticamente: cnpj=${cleanDoc}, nome=${name}`,
    );
    return created;
  }

  private async findProductForInvoiceItem(params: {
    sku?: string | null;
    ean?: string | number | null;
    supplierCnpj?: string | null;
    logPrefix: string;
  }): Promise<Product | null> {
    const sku = params.sku?.trim();
    const ean = params.ean ? String(params.ean).trim() : null;

    let product: Product | null = null;

    if (ean) {
      product = await Product.findOne({
        where: { [Op.or]: [{ ean }, { ean_tribut: ean }] },
      });
    }

    if (!product && sku) {
      const config = await ProductConfig.findOne({
        where: { sku, unit_business_id: BLING_UNIT_BUSINESS_ID },
      });
      if (config) product = await Product.findByPk(config.product_id);
    }

    if (product || !ean) return product;

    const supplierProductCode: string = ean;
    const cleanSupplierCnpj = params.supplierCnpj
      ? cleanDocument(params.supplierCnpj)
      : null;

    const supplierMapping = cleanSupplierCnpj
      ? ((await SupplierMapping.findOne({
          where: {
            supplier_product_code: supplierProductCode,
            supplier_cnpj: cleanSupplierCnpj,
          },
          order: [["updatedAt", "DESC"]],
        })) ??
        (await SupplierMapping.findOne({
          where: { supplier_product_code: supplierProductCode },
          order: [["updatedAt", "DESC"]],
        })))
      : await SupplierMapping.findOne({
          where: { supplier_product_code: supplierProductCode },
          order: [["updatedAt", "DESC"]],
        });

    if (!supplierMapping) return null;

    product = await Product.findByPk(supplierMapping.product_id);

    if (product) {
      console.log(
        `${params.logPrefix} Produto resolvido via SupplierMapping | ean_nf=${ean} | product_id=${product.id} | ean_sistema=${product.ean}`,
      );
    }

    return product;
  }

  // ─── CORREÇÃO 3: helper que parseia det[] do XML e faz upsert em invoice_fiscal_items ──
  private async upsertFiscalItems(
    invoiceId: string,
    xmlContent: string,
    senderCnpj: string,
    logPrefix: string,
  ): Promise<void> {
    const parsed = parser.parse(xmlContent);

    const nfe =
      parsed?.nfeProc?.NFe?.infNFe ||
      parsed?.procNFe?.NFe?.infNFe ||
      parsed?.NFe?.infNFe;

    if (!nfe) return;

    const rawDet = nfe.det;
    if (!rawDet) return;

    const det: any[] = Array.isArray(rawDet) ? rawDet : [rawDet];

    for (let idx = 0; idx < det.length; idx++) {
      const item = det[idx];
      const prod = item.prod ?? {};
      const imposto = item.imposto ?? {};

      const sku = prod.cProd ? String(prod.cProd).trim() : null;
      const gtin =
        prod.cEAN && prod.cEAN !== "SEM GTIN" ? String(prod.cEAN).trim() : null;
      const qty = Number(prod.qCom ?? 0);
      const unitPrice = Number(prod.vUnCom ?? 0);
      const totalValue = Number(prod.vProd ?? 0);

      // Resolve product_id interno (melhor esforço — não bloqueia se não encontrar)
      const product = await this.findProductForInvoiceItem({
        sku,
        ean: gtin,
        supplierCnpj: senderCnpj,
        logPrefix,
      });

      // ─── Impostos por item ──────────────────────────────────────────────────

      // ICMS — pode estar em vários grupos: ICMS00, ICMS10, ICMS20... pegamos o primeiro
      const icmsGroup: any =
        imposto?.ICMS?.ICMS00 ??
        imposto?.ICMS?.ICMS10 ??
        imposto?.ICMS?.ICMS20 ??
        imposto?.ICMS?.ICMS40 ??
        imposto?.ICMS?.ICMS51 ??
        imposto?.ICMS?.ICMS60 ??
        imposto?.ICMS?.ICMS70 ??
        imposto?.ICMS?.ICMS90 ??
        imposto?.ICMS?.ICMSSN101 ??
        imposto?.ICMS?.ICMSSN102 ??
        imposto?.ICMS?.ICMSSN201 ??
        imposto?.ICMS?.ICMSSN202 ??
        imposto?.ICMS?.ICMSSN500 ??
        imposto?.ICMS?.ICMSSN900 ??
        {};

      const icmsRate = Number(icmsGroup?.pICMS ?? 0);
      const icmsValue = Number(icmsGroup?.vICMS ?? 0);

      // DIFAL
      const difalValue = Number(
        imposto?.ICMSUFDest?.vICMSUFDest ?? imposto?.ICMSUFDest?.vICMSDest ?? 0,
      );

      // IPI
      const ipiGroup: any = imposto?.IPI?.IPITrib ?? imposto?.IPI?.IPINT ?? {};
      const ipiValue = Number(ipiGroup?.vIPI ?? 0);

      // PIS
      const pisGroup: any =
        imposto?.PIS?.PISAliq ??
        imposto?.PIS?.PISQtde ??
        imposto?.PIS?.PISNT ??
        imposto?.PIS?.PISOutr ??
        {};
      const pisValue = Number(pisGroup?.vPIS ?? 0);

      // COFINS
      const cofinsGroup: any =
        imposto?.COFINS?.COFINSAliq ??
        imposto?.COFINS?.COFINSQtde ??
        imposto?.COFINS?.COFINSNT ??
        imposto?.COFINS?.COFINSOutr ??
        {};
      const cofinsValue = Number(cofinsGroup?.vCOFINS ?? 0);

      // IBS/CBS (reforma tributária — disponíveis em notas mais novas)
      const ibsCbsGroup: any = imposto?.IBSCBS?.gIBSCBS ?? {};
      const ibsValue =
        Number(ibsCbsGroup?.gIBSUF?.vIBSUF ?? 0) +
        Number(ibsCbsGroup?.gIBSMun?.vIBSMun ?? 0);
      const cbsValue = Number(ibsCbsGroup?.gCBS?.vCBS ?? 0);

      const approxTaxValue = Number(imposto?.vTotTrib ?? 0);

      const conflictFields = ["invoice_id", "item_number"] as any;

      await InvoiceFiscalItem.upsert(
        {
          invoice_id: invoiceId,
          product_id: product?.id ?? null,
          item_number: idx + 1,
          sku,
          description: String(prod.xProd ?? "").slice(0, 255) || null,
          quantity: qty,
          unit_price: unitPrice,
          total_value: totalValue,
          ncm: prod.NCM ? String(prod.NCM) : null,
          cest: prod.CEST ? String(prod.CEST) : null,
          cfop: prod.CFOP ? String(prod.CFOP) : null,
          gtin,
          approx_tax_value: approxTaxValue,
          icms_rate: icmsRate,
          icms_value: icmsValue,
          ipi_value: ipiValue,
          pis_value: pisValue,
          cofins_value: cofinsValue,
          difal_value: difalValue,
          ibs_value: ibsValue,
          cbs_value: cbsValue,
        },
        { conflictFields },
      );
    }

    console.log(
      `${logPrefix} ${det.length} item(ns) fiscal(is) upsertado(s) para invoice ${invoiceId}`,
    );
  }

  async process(job: Job<ApiFetchJobPayload>): Promise<void> {
    const { eventId, resource, action, apiFetch } = job.data;

    console.log(
      `[BLING_API_FETCH] Processando ${resource}.${action} | blingId=${apiFetch.blingId} | eventId=${eventId}`,
    );

    try {
      switch (resource) {
        case "product":
          await this.fetchAndUpsertProduct(apiFetch);
          break;

        case "stock":
          await this.fetchAndUpsertProduct(apiFetch);
          break;

        case "product_supplier":
          // await this.fetchAndUpsertProductSupplier(apiFetch);
          break;

        case "invoice":
          await this.fetchAndUpsertInvoice(apiFetch, "NF-e");
          break;

        case "consumer_invoice":
          await this.fetchAndUpsertInvoice(apiFetch, "NFC-e");
          break;

        default:
          console.warn(
            `[BLING_API_FETCH] Sem handler de fetch para resource=${resource}`,
          );
      }
    } catch (error: any) {
      console.error(
        `[BLING_API_FETCH] Erro ao processar job ${job.id}:`,
        error,
      );
      throw error;
    }
  }

  // ─── Handlers por recurso ─────────────────────────────────────────────────

  private async fetchAndUpsertProduct(
    apiFetch: ApiFetchRequest,
  ): Promise<void> {
    const { data } = await this.api.get<{ data: BlingApiProduct }>(
      `/produtos/${apiFetch.blingId}`,
    );

    const blingProduct = data.data;
    const integration = await getBlingIntegration("Bling");
    const unitBusiness = await UnitBusiness.findByPk(BLING_UNIT_BUSINESS_ID);

    if (!unitBusiness) {
      throw new Error(
        `[BLING_API_FETCH] UnitBusiness padrão Bling não encontrada | id=${BLING_UNIT_BUSINESS_ID}`,
      );
    }

    const newSupplierCost = Number(
      blingProduct.fornecedor?.precoCusto ?? blingProduct.precoCusto ?? 0,
    );

    const logPrefix = `[BLING_API_FETCH] fetchAndUpsertProduct blingId=${blingProduct.id}`;

    const existingProduct = await resolveProductWithMapping({
      integrationsId: integration.id,
      systemId: String(blingProduct.id),
      codigoFabrica: blingProduct.codigo,
      ean: blingProduct.gtin,
      logPrefix,
    });

    const { measure, line } = extractProductMeasureAndLine(
      blingProduct.nome,
      blingProduct.marca,
    );
    const importedTireSubgroup = await resolveBlingImportedTireSubgroup(
      measure,
      `[BLING_API_FETCH] Produto ${blingProduct.codigo}`,
    );

    const matchedBrand = await brandsService.findSimilarBrand(
      blingProduct.marca,
    );

    if (!matchedBrand && blingProduct.marca) {
      console.warn(
        `[BLING_API_FETCH] Marca "${blingProduct.marca}" não encontrada no cadastro de brands (produto=${blingProduct.codigo}). Produto salvo sem brand_id.`,
      );
    }

    const isKit = blingProduct.formato === "E";

    let configSku = blingProduct.codigo;

    if (isKit) {
      const component = blingProduct.estrutura?.componentes?.[0];

      if (component?.produto?.id) {
        const componentSku = await this.resolveKitComponentSku(
          component.produto.id,
          "[BLING_API_FETCH]",
        );

        if (componentSku) {
          configSku = `${componentSku}K${component.quantidade}`;
        } else {
          console.warn(
            `[BLING_API_FETCH] KIT ${blingProduct.codigo} sem SKU de componente resolvível (componentBlingId=${component.produto.id}). Mantendo codigo original: ${blingProduct.codigo}`,
          );
        }
      } else {
        console.warn(
          `[BLING_API_FETCH] KIT ${blingProduct.codigo} sem estrutura.componentes[0]. Mantendo codigo original.`,
        );
      }
    }

    // ─── Resolve a integration do Magento uma única vez (reaproveitada abaixo) ──
    const magentoIntegration = await getMagentoIntegration("Magento");

    // ─── Prioriza o SKU já mapeado; só cai pro código da Bling se não existir mapping ──
    let magentoSkuFromMapping: string | null = null;

    if (existingProduct) {
      const magentoSkuMap = await integrationMappingService.findExternalIdsMap(
        "PRODUCT",
        magentoIntegration.id,
        [existingProduct.id],
      );
      magentoSkuFromMapping = magentoSkuMap.get(existingProduct.id) ?? null;
    }

    const magentoLookupSku = magentoSkuFromMapping ?? configSku;

    if (magentoSkuFromMapping) {
      console.log(
        `${logPrefix} SKU do Magento resolvido via integration mapping: ${magentoSkuFromMapping}`,
      );
    }

    const magentoProduct = await this.fetchMagentoProduct(
      magentoLookupSku,
      logPrefix,
    );
    const resolvedPrice =
      magentoProduct?.price !== undefined && magentoProduct?.price !== null
        ? Number(magentoProduct.price)
        : Number(blingProduct.preco);

    let product: Product;

    try {
      [product] = await Product.upsert(
        {
          name: blingProduct.nome,
          id_system: String(blingProduct.id),
          ean: blingProduct.gtin ?? `NO-EAN-${blingProduct.id}`,
          ean_tribut: blingProduct.gtinEmbalagem ?? `NO-EAN-${blingProduct.id}`,
          type: isKit ? "KIT" : "UNIT",
          integrations_id: integration.id,
          source_payload: blingProduct as unknown as Record<string, unknown>,
          unit: blingProduct.unidade,
          brand: blingProduct.marca,
          brand_id: matchedBrand?.id ?? null,
          subgroup_id: importedTireSubgroup?.id,
          line,
          measure,
          gross_weight: Number(blingProduct.pesoBruto ?? 0),
          net_weight: Number(blingProduct.pesoLiquido ?? 0),
          stock_virtual_total: Number(
            blingProduct.estoque?.saldoVirtualTotal ?? 0,
          ),
        },
        { conflictFields: ["id_system"] },
      );

      await ProductConfig.upsert(
        {
          product_id: product.id,
          unit_business_id: unitBusiness.id,
          sku: configSku,
          price: resolvedPrice,
          gtin: blingProduct.gtin,
          gtin_package: blingProduct.gtinEmbalagem,
          ncm: blingProduct.tributacao?.ncm,
          cest: blingProduct.tributacao?.cest,
          supplier_cost_price: newSupplierCost,
          supplier_purchase_price: Number(
            blingProduct.fornecedor?.precoCompra ??
              blingProduct.precoCompra ??
              0,
          ),
        },
        { conflictFields: ["product_id", "unit_business_id"] },
      );
    } catch (error: any) {
      logDbError("[BLING_API_FETCH] Erro no upsert do produto", error, {
        blingId: apiFetch.blingId,
        sku: blingProduct?.codigo,
        ean: blingProduct?.gtin,
      });
      throw error;
    }

    await this.syncProductWithMagento({
      product,
      sku: configSku,
      ean: blingProduct.gtin,
      productName: blingProduct.nome,
      magentoProduct,
      magentoIntegration,
      logPrefix,
    });

    // ─── Sincroniza o Kardex (stock_movements) e atualiza o average_cost ──────
    let averageCostResolved: number | undefined;
    try {
      const { average_cost, created } =
        await stockMovementsService.syncProductStockMovements(
          product.id,
          unitBusiness.id,
        );
      averageCostResolved = average_cost;

      if (created > 0) {
        await ProductConfig.update(
          { average_cost, average_cost_updated_at: new Date() },
          {
            where: {
              product_id: product.id,
              unit_business_id: unitBusiness.id,
            },
          },
        );
        console.log(
          `[BLING_API_FETCH] Kardex sincronizado: sku=${configSku} | movimentos_criados=${created} | average_cost=${average_cost}`,
        );
      } else {
        console.log(
          `[BLING_API_FETCH] Kardex já atualizado, nenhum movimento novo: sku=${configSku}`,
        );
      }
    } catch (syncErr: any) {
      console.warn(
        `[BLING_API_FETCH] Falha ao sincronizar stock movements | sku=${configSku} | erro=${syncErr?.message}`,
      );
    }

    if (averageCostResolved !== undefined) {
      const physicalQuantity = await this.fetchPhysicalStock(blingProduct.id);

      await this.syncStockAndBatches({
        product,
        unitBusiness,
        newQuantity: physicalQuantity,
        averageCost: averageCostResolved,
      });
    }

    try {
      if (product) {
        const config = await ProductConfig.findOne({
          where: {
            product_id: product.id,
            unit_business_id: BLING_UNIT_BUSINESS_ID,
          },
        });

        if (config?.average_cost) {
          const magentoSkuMap =
            await integrationMappingService.findExternalIdsMap(
              "PRODUCT",
              magentoIntegration.id,
              [product.id],
            );
          const magentoSku = magentoSkuMap.get(product.id);

          if (magentoSku) {
            await magentoCatalogService.atualizarCustomAttribute(
              magentoSku,
              "custo_medio",
              Number(config.average_cost).toFixed(2),
            );
            console.log(
              `[BLING_API_FETCH] custo_medio sincronizado para Magento: sku=${magentoSku} | average_cost=${config.average_cost}`,
            );
          } else {
            console.log(
              `[BLING_API_FETCH] Produto sem mapping no Magento — custo_medio não sincronizado: sku_bling=${blingProduct.codigo}`,
            );
          }
        }
      }
    } catch (magentoErr: any) {
      if (magentoErr?.response?.status === 404) {
        console.log(
          `[BLING_API_FETCH] Produto não encontrado no Magento — custo_medio ignorado: sku=${blingProduct.codigo}`,
        );
      } else {
        console.warn(
          `[BLING_API_FETCH] Falha ao sincronizar custo_medio para Magento | sku=${blingProduct.codigo} | erro=${magentoErr?.message}`,
        );
      }
    }

    console.log(
      `[BLING_API_FETCH] Produto ${blingProduct.codigo} complementado com EAN=${blingProduct.gtin ?? "N/A"}`,
    );
  }

  private async fetchAndUpsertProductSupplier(
    apiFetch: ApiFetchRequest,
  ): Promise<void> {
    const { data } = await this.api.get<{ data: BlingApiProductSupplier }>(
      `/produtos/fornecedores/${apiFetch.blingId}`,
    );

    const ps = data.data;

    if (!ps?.produto?.id) {
      throw new Error(
        `[BLING_API_FETCH] Produto-fornecedor ${apiFetch.blingId} sem produto.id. Retry.`,
      );
    }

    const product = await Product.findOne({
      where: { id_system: String(ps.produto.id) },
    });

    if (!product) {
      console.warn(
        `[BLING_API_FETCH] Produto blingId=${ps.produto.id} não encontrado. Ignorado.`,
      );
      return;
    }

    let cnpj = ps.fornecedor?.cnpj ?? ps.fornecedor?.cpf ?? "";
    const supplierId = ps.fornecedor?.id ? String(ps.fornecedor.id) : null;

    if (!cnpj && supplierId) {
      const supplierDb = await Supplier.findOne({
        where: { id_system: supplierId },
      });
      if (supplierDb?.document && !supplierDb.document.startsWith("PENDING-")) {
        cnpj = supplierDb.document;
      }
    }

    if (!cnpj && supplierId) {
      try {
        const { data: contatoRes } = await this.api.get<{ data: any }>(
          `/contatos/${supplierId}`,
        );
        const contato = contatoRes.data;
        cnpj = contato?.numeroDocumento ?? "";

        if (cnpj) {
          await Supplier.upsert({
            id_system: supplierId,
            name: contato?.nome ?? "SEM NOME",
            document: cnpj,
            fantasy_name: contato?.fantasia ?? null,
            city: contato?.endereco?.municipio ?? "",
            uf: contato?.endereco?.uf ?? "",
            code: contato?.codigo ?? null,
          });
        }
      } catch (error: any) {
        if (error?.response?.status === 404) {
          console.warn(
            `[BLING_API_FETCH] Contato ${supplierId} não existe na Bling.`,
          );
          return;
        }
        throw error;
      }
    }

    if (!cnpj) {
      console.warn(
        `[BLING_API_FETCH] Fornecedor ${supplierId} sem CNPJ/CPF resolvível. SupplierMapping não atualizado.`,
      );
      return;
    }

    const cleanCnpj = cleanDocument(cnpj);

    const existing = await SupplierMapping.findOne({
      where: { product_id: product.id },
    });

    if (existing) {
      await existing.update({
        supplier_cnpj: cleanCnpj,
        supplier_product_code: ps.codigo ?? existing.supplier_product_code,
      });
    } else {
      await SupplierMapping.create({
        product_id: product.id,
        supplier_cnpj: cleanCnpj,
        supplier_product_code: ps.codigo ?? "",
      });
    }

    console.log(
      `[BLING_API_FETCH] SupplierMapping ${existing ? "atualizado" : "criado"}: productId=${product.id}, cnpj=${cleanCnpj}`,
    );
  }

  private async fetchAndUpsertInvoice(
    apiFetch: ApiFetchRequest,
    type: "NF-e" | "NFC-e",
  ): Promise<void> {
    const endpoint =
      type === "NF-e"
        ? `/nfe/${apiFetch.blingId}`
        : `/nfce/${apiFetch.blingId}`;

    const { data } = await this.api.get<{ data: BlingApiInvoice }>(endpoint);
    const nf = data.data;
    const invoiceReferenceDate = getBlingInvoiceReferenceDate(nf);

    if (!invoiceReferenceDate) {
      console.warn(
        `[BLING_API_FETCH] Nota ${apiFetch.blingId} sem dataEmissao/dataOperacao. Ignorada pelo corte de NF.`,
      );
      return;
    }

    if (!isBlingInvoiceOnOrAfterCutoff(invoiceReferenceDate)) {
      console.log(
        `[BLING_API_FETCH] Nota ${apiFetch.blingId} ignorada: anterior a ${formatBlingInvoiceCutoffForLog()}`,
      );
      return;
    }

    const emittedAt = parseBlingDate(
      nf.dataOperacao ?? nf.dataEmissao ?? invoiceReferenceDate.toISOString(),
    );

    const invoiceType: "INCOMING" | "OUTGOING" =
      nf.tipo === 0 ? "INCOMING" : "OUTGOING";

    // ─── XML ──────────────────────────────────────────────────────────────────

    let xmlContent: string | null = null;
    let senderCnpj = String(nf.emitente?.cnpj ?? "");
    let senderName = nf.emitente?.nome ?? "";
    let receiverCnpj = String(
      nf.destinatario?.cnpj ?? nf.destinatario?.cpf ?? "",
    );
    let receiverName = nf.destinatario?.nome ?? "";
    let transporter_name: string | null = null;
    let transporter_document: string | null = null;
    let transporter_city: string | null = null;
    let transporter_uf: string | null = null;
    let nfeRef: string | null = null;
    let destinationUfFromXml: string | null = null;
    let destinationCityFromXml: string | null = null;
    let fiscalTotals: ReturnType<
      typeof extractInvoiceFiscalTotalsFromXml
    > | null = null;
    let xmlDet: any[] = [];

    if (nf.xml) {
      try {
        const text = await fetch(nf.xml).then((r) => r.text());
        if (text && text.trim().length > 0) {
          xmlContent = text;
          const extracted = extractPartiesFromXml(xmlContent);
          senderCnpj = cleanDocument(extracted.senderCnpj || senderCnpj);
          senderName = extracted.senderName || senderName;
          receiverCnpj = cleanDocument(extracted.receiverCnpj || receiverCnpj);
          receiverName = extracted.receiverName || receiverName;
          transporter_name = extracted.transporterName;
          transporter_document = extracted.transporterDocument;
          transporter_city = extracted.transporterCity;
          transporter_uf = extracted.transporterUf;
          nfeRef = extracted.refNFe;
          destinationUfFromXml = extracted.destinationUf || null;
          destinationCityFromXml = extracted.destinationCity || null;
          fiscalTotals = extractInvoiceFiscalTotalsFromXml(xmlContent);

          // Extrai det do XML para montar fiscal items
          const parsed = parser.parse(xmlContent);
          const nfeXml =
            parsed?.nfeProc?.NFe?.infNFe ||
            parsed?.procNFe?.NFe?.infNFe ||
            parsed?.NFe?.infNFe;
          if (nfeXml?.det) {
            xmlDet = Array.isArray(nfeXml.det) ? nfeXml.det : [nfeXml.det];
          }
        }
      } catch (err) {
        console.warn("[XML PARSE ERROR]", { blingId: apiFetch.blingId, err });
      }
    }

    const destinationUf =
      destinationUfFromXml || nf.contato?.endereco?.uf || null;
    const destinationCity =
      destinationCityFromXml || nf.contato?.endereco?.municipio || null;
    const customerDoc =
      nf.contato?.numeroDocumento ?? nf.destinatario?.nome ?? "";
    const customerName = nf.contato?.nome ?? nf.destinatario?.nome ?? "";
    const key = nf.chaveAcesso ?? `PENDING-KEY-${nf.id}`;

    // ─── UnitBusiness + Store + Integration ───────────────────────────────────

    const unit_business = await UnitBusiness.findByPk(BLING_UNIT_BUSINESS_ID);
    if (!unit_business) {
      throw new Error(
        `[ERRO NO MAPEAMENTO DE NFE] - UnitBusiness padrão Bling não encontrada | id=${BLING_UNIT_BUSINESS_ID}`,
      );
    }

    let store_id = await Store.findOne({
      where: { id_store_system: String(nf?.loja?.id) },
    });
    if (!store_id) {
      store_id = await Store.findOne({ where: { name: "Outros" } });
    }

    const integration = await getBlingIntegration("Bling");

    // ─── Seller ───────────────────────────────────────────────────────────────

    let sellerId: string | null = null;
    if (nf.vendedor?.id) {
      const seller = await Contact.findOne({
        where: {
          id_system: String(nf.vendedor.id),
          type: "SELLER",
          integrations_id: integration.id,
        },
      });
      sellerId = seller?.id ?? null;
      if (!sellerId) {
        console.warn(
          `[BLING_API_FETCH] Vendedor Bling ${nf.vendedor.id} não encontrado em contacts. Invoice será gravada sem seller_id.`,
        );
      }
    }

    // ─── Transportador ────────────────────────────────────────────────────────

    if (!transporter_document) {
      const blingDoc = String(
        nf.transporte?.transportador?.numeroDocumento ?? "",
      ).trim();
      const blingName = String(nf.transporte?.transportador?.nome ?? "").trim();
      if (blingDoc) {
        transporter_document = blingDoc;
        transporter_name = transporter_name || blingName || null;
        console.log(
          `[BLING_API_FETCH] Transportador não encontrado no XML — usando dados da API Bling: doc=${blingDoc}, nome=${blingName}`,
        );
      }
    }

    if (!transporter_document) {
      transporter_name = NO_TRANSPORTER_NAME;
      transporter_document = NO_TRANSPORTER_DOCUMENT;
    } else if (!transporter_name) {
      transporter_name = NO_TRANSPORTER_NAME;
    }

    const transporter = await this.findOrCreateTransporter({
      document: transporter_document,
      name: transporter_name,
      city: transporter_city,
      uf: transporter_uf,
    });

    // ─── Totais fiscais ───────────────────────────────────────────────────────

    const invoiceValue =
      fiscalTotals?.invoiceValue ?? Number(nf.valorNota ?? 0);
    const invoiceFreightValue =
      fiscalTotals?.invoiceFreightValue ?? Number(nf.valorFrete ?? 0);
    const invoiceProductsValue =
      fiscalTotals?.invoiceProductsValue ?? Number(nf.totalProdutos ?? 0);
    const invoiceDiscountValue = fiscalTotals?.invoiceDiscountValue ?? 0;
    const invoiceTotalTaxValue = fiscalTotals?.invoiceTotalTaxValue ?? 0;
    const icmsValue =
      fiscalTotals?.icmsValue ?? Number(nf.tributacao?.totalICMS ?? 0);
    const ipiValue =
      fiscalTotals?.ipiValue ?? Number(nf.tributacao?.totalIPI ?? 0);
    const pisValue = fiscalTotals?.pisValue ?? 0;
    const cofinsValue = fiscalTotals?.cofinsValue ?? 0;
    const difalValue = fiscalTotals?.difalValue ?? 0;
    const ibsValue = fiscalTotals?.ibsValue ?? 0;
    const cbsValue = fiscalTotals?.cbsValue ?? 0;

    // ─── Invoice existente ────────────────────────────────────────────────────

    const existingInvoice = await invoiceService.findByIdFullForAllUnits(
      undefined,
      nf.chaveAcesso ?? undefined,
    );

    const invoiceFound = existingInvoice;

    const invoiceBaseData = {
      id_system: String(nf.id),
      customer_name: customerName,
      customer_document: customerDoc,
      sender_cnpj: senderCnpj,
      sender_name: senderName,
      receiver_cnpj: receiverCnpj,
      receiver_name: receiverName,
      danfe_path: "",
      xml_path: xmlContent ? encryptXml(xmlContent) : null,
      xml_key: nf.chaveAcesso ?? null,
      xml_url: nf.xml ?? null,
      source_payload: nf as unknown as Record<string, unknown>,
      emitted_at: emittedAt,
      number_system: String(nf.numero),
      integrations_id: integration.id,
      store_id: store_id!.id ?? null,
      seller_id: sellerId,
      transporter_id: transporter?.id ?? null,
      transporter_document: transporter_document ?? null,
      transporter_name: transporter_name ?? null,
      description: invoiceFound?.description
        ? invoiceFound.description
        : nfeRef
          ? `REF: ${nfeRef}`
          : null,
      destination_uf: destinationUf,
      destination_city: destinationCity,
      invoice_value: invoiceValue,
      invoice_products_value: invoiceProductsValue,
      invoice_freight_value: invoiceFreightValue,
      invoice_discount_value: invoiceDiscountValue,
      invoice_total_tax_value: invoiceTotalTaxValue,
      icms_value: icmsValue,
      ipi_value: ipiValue,
      pis_value: pisValue,
      cofins_value: cofinsValue,
      difal_value: difalValue,
      ibs_value: ibsValue,
      cbs_value: cbsValue,
    };

    // ─── Resolve initialStatus para novas invoices ────────────────────────────

    const resolveInitialStatus = (): InvoiceUnitBusinessAttributesStatus => {
      if (invoiceType === "OUTGOING") {
        if (nf.situacao === 2) return "PENDING_CANCELLED_SYSTEM";
        return "OPEN";
      }
      return "WAITING_SCHEDULE_SALES";
    };

    // ─── Monta ItemWithFiscal[] antes do create ───────────────────────────────
    // Usa nf.itens para invoice items operacionais e xmlDet para fiscal items.
    // Unmapped só é registrado depois que invoice.id existir.

    const invoiceItemsForCreate: ItemWithFiscal[] = [];
    const unmappedItems: Array<{
      sku: string | null;
      ean: string | null;
      qty: number;
      descricao: string | null;
      reason: string;
    }> = [];

    if (nf.itens?.length && !existingInvoice) {
      // Monta mapa de fiscal data por sku/gtin a partir do xmlDet
      const fiscalByItemNumber = new Map<number, any>();
      for (let idx = 0; idx < xmlDet.length; idx++) {
        fiscalByItemNumber.set(idx, xmlDet[idx]);
      }

      for (let idx = 0; idx < nf.itens.length; idx++) {
        const item = nf.itens[idx];
        const sku = item.codigo?.trim() ?? null;
        const ean = item.gtin ? String(item.gtin).trim() : null;
        const qty = item.quantidade ?? 0;

        const product = await this.findProductForInvoiceItem({
          sku,
          ean,
          supplierCnpj: senderCnpj,
          logPrefix: "[BLING_API_FETCH]",
        });

        if (!product) {
          const reason =
            !sku && !ean
              ? "SKU e EAN ausentes no XML"
              : !sku
                ? "SKU ausente — apenas EAN salvo"
                : !ean
                  ? "EAN ausente — apenas SKU salvo"
                  : "SKU e EAN presentes mas sem produto correspondente no banco";

          unmappedItems.push({
            sku,
            ean,
            qty,
            descricao: (item as any).descricao ?? null,
            reason,
          });
          continue;
        }

        // ─── Fiscal item do XML correspondente ──────────────────────────────
        let fiscal: ItemWithFiscal["fiscal"] = undefined;
        const xmlItem = fiscalByItemNumber.get(idx);

        if (xmlItem) {
          const prod = xmlItem.prod ?? {};
          const imposto = xmlItem.imposto ?? {};

          const icmsGroup: any =
            imposto?.ICMS?.ICMS00 ??
            imposto?.ICMS?.ICMS10 ??
            imposto?.ICMS?.ICMS20 ??
            imposto?.ICMS?.ICMS40 ??
            imposto?.ICMS?.ICMS51 ??
            imposto?.ICMS?.ICMS60 ??
            imposto?.ICMS?.ICMS70 ??
            imposto?.ICMS?.ICMS90 ??
            imposto?.ICMS?.ICMSSN101 ??
            imposto?.ICMS?.ICMSSN102 ??
            imposto?.ICMS?.ICMSSN201 ??
            imposto?.ICMS?.ICMSSN202 ??
            imposto?.ICMS?.ICMSSN500 ??
            imposto?.ICMS?.ICMSSN900 ??
            {};

          const ipiGroup: any =
            imposto?.IPI?.IPITrib ?? imposto?.IPI?.IPINT ?? {};
          const pisGroup: any =
            imposto?.PIS?.PISAliq ??
            imposto?.PIS?.PISQtde ??
            imposto?.PIS?.PISNT ??
            imposto?.PIS?.PISOutr ??
            {};
          const cofinsGroup: any =
            imposto?.COFINS?.COFINSAliq ??
            imposto?.COFINS?.COFINSQtde ??
            imposto?.COFINS?.COFINSNT ??
            imposto?.COFINS?.COFINSOutr ??
            {};
          const ibsCbsGroup: any = imposto?.IBSCBS?.gIBSCBS ?? {};

          fiscal = {
            product_id: product.id,
            item_number: idx + 1,
            sku,
            description: String(prod.xProd ?? "").slice(0, 255) || null,
            quantity: Number(prod.qCom ?? qty),
            unit_price: Number(prod.vUnCom ?? item.valor ?? 0),
            total_value: Number(prod.vProd ?? 0),
            ncm: prod.NCM ? String(prod.NCM) : null,
            cest: prod.CEST ? String(prod.CEST) : null,
            cfop: prod.CFOP ? String(prod.CFOP) : null,
            gtin: ean,
            approx_tax_value: Number(imposto?.vTotTrib ?? 0),
            icms_rate: Number(icmsGroup?.pICMS ?? 0),
            icms_value: Number(icmsGroup?.vICMS ?? 0),
            ipi_value: Number(ipiGroup?.vIPI ?? 0),
            pis_value: Number(pisGroup?.vPIS ?? 0),
            cofins_value: Number(cofinsGroup?.vCOFINS ?? 0),
            difal_value: Number(
              imposto?.ICMSUFDest?.vICMSUFDest ??
                imposto?.ICMSUFDest?.vICMSDest ??
                0,
            ),
            ibs_value:
              Number(ibsCbsGroup?.gIBSUF?.vIBSUF ?? 0) +
              Number(ibsCbsGroup?.gIBSMun?.vIBSMun ?? 0),
            cbs_value: Number(ibsCbsGroup?.gCBS?.vCBS ?? 0),
          };
        }

        invoiceItemsForCreate.push({
          product_id: product.id,
          quantity_expected: Math.trunc(qty),
          fiscal,
        });
      }
    }

    // ─── Create ou Update ──────────────────────────────────────────────────────

    let invoice: FullInvoiceForAllUnits | null;

    if (!existingInvoice) {
      const created = await invoiceService
        .createWithRelations(invoiceBaseData, invoiceItemsForCreate, {
          initialStatus: resolveInitialStatus(),
          invoiceType,
        })
        .catch((error) => {
          logDbError("[INVOICE CREATE ERROR DETAIL]", error, {
            blingId: nf.id,
            numero: nf.numero,
            id_system: String(nf.id),
          });
          throw error;
        });

      invoice = await invoiceService.findByIdFullForAllUnits(created.id);
    } else {
      await invoiceService.updateInvoicesForAllUnitBusiness(
        [existingInvoice.id],
        {
          ...invoiceBaseData,
          ...(nf.situacao === 2 ? { status: "PENDING_CANCELLED_SYSTEM" } : {}),
        },
      );

      invoice = await invoiceService.findByIdFullForAllUnits(
        existingInvoice.id,
      );
    }

    if (!invoice) {
      throw new Error(
        `[BLING_API_FETCH] Invoice não encontrada após upsert | blingId=${nf.id}`,
      );
    }

    console.log(
      `[BLING_API_FETCH] Invoice upsertada: id_system=${nf.id}, key=${key}`,
    );

    // ─── Unmapped products (requer invoice.id) ────────────────────────────────

    for (const u of unmappedItems) {
      const quantity = Math.trunc(
        Number.isFinite(Number(u.qty)) ? Number(u.qty) : 0,
      );

      const existing = await UnmappedInvoiceProduct.findOne({
        where: {
          invoice_id: invoice.id,
          ...(u.ean ? { ean: u.ean } : { sku: u.sku ?? null }),
        },
      });

      if (!existing) {
        await UnmappedInvoiceProduct.create({
          invoice_id: invoice.id,
          integrations_id: unit_business.integrations_id ?? integration.id,
          ean: u.ean ?? null,
          sku: u.sku ?? null,
          product_name: u.descricao,
          quantity,
          reason: u.reason,
          status: "UNMAPPED",
        });
      } else {
        await existing.update({
          quantity,
          integrations_id: unit_business.integrations_id ?? integration.id,
        });
      }

      console.warn(
        `[BLING_API_FETCH] Produto não mapeado | invoice=${invoice.id} | sku=${u.sku} | ean=${u.ean} | motivo=${u.reason}`,
      );
    }

    console.log(
      `[BLING_API_FETCH] ${nf.itens?.length ?? 0} item(ns) processado(s) para invoice ${nf.id}`,
    );

    // ─── Sincroniza batch se a invoice já pertencer a um ─────────────────────

    const batchInvoice = await ExpeditionBatchInvoice.findOne({
      where: { invoice_id: invoice.id },
    });

    if (batchInvoice) {
      await invoiceItemsService.syncBatchFromInvoice(batchInvoice);
    }
  }

  /**
   * Importa uma NF-e a partir de um XML bruto (sem passar pela API Bling).
   * Usado pelo endpoint de importação manual de XML.
   */
  async upsertInvoiceFromXml(
    xmlContent: string,
    status?: InvoiceStatus,
  ): Promise<void> {
    await upsertInvoiceFromXml(xmlContent, {
      integrationName: "Bling",
      initialStatus:
        status === "CANCELLED"
          ? "PENDING_CANCELLED_SYSTEM"
          : "WAITING_SCHEDULE_SALES",
      updateStatus:
        status === "CANCELLED" ? "PENDING_CANCELLED_SYSTEM" : undefined,
      skipCrossConfig: true,
      allowUpdateFromAnyIntegration: true,
    });
  }

  protected override onFailed(
    job: Job<ApiFetchJobPayload>,
    error: Error,
  ): void {
    if ((error as any)?.name?.startsWith("Sequelize")) {
      console.warn(
        `[BLING_API_FETCH] Job ${job.id} falhou por erro de dados (sem alerta): ${error.message}`,
      );
      return;
    }

    alertService.sendAlert({
      severity: "HIGH",
      title: "BlingApiFetchQueue — job esgotou tentativas",
      message: `Job: ${job.id} | Resource: ${job.data.resource} | Action: ${job.data.action} | BlingId: ${job.data.apiFetch?.blingId} | EventId: ${job.data.eventId} | Erro: ${error.message}`,
    });
  }
}
