import { InvoiceStatus } from './../../../../../warehouse/entrance/invoice/invoice.types';
import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { ApiFetchRequest, WebhookQueuePayload } from "../bling-webhook.types";
import { blingApi, getBlingIntegration } from "../../../api/bling_api.service";
import { Product, Stock, Supplier } from "../../../../../inventory";
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
import { Op } from "sequelize";
import UnmappedInvoiceProduct from "../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import InvoiceFiscalItem from "../../../../../warehouse/entrance/invoice-fiscal-item/invoice-fiscal-item.model";
import {
  formatBlingInvoiceCutoffForLog,
  getBlingInvoiceReferenceDate,
  isBlingInvoiceOnOrAfterCutoff,
} from "../bling-invoice-cutoff";

const BLING_UNIT_BUSINESS_ID = process.env.BLING_UNIT_BUSINESS_ID;
const BLING_UNIT_BUSINESS_CNPJ = "02316749002111";
const NO_TRANSPORTER_NAME = "Sem transporte";
const NO_TRANSPORTER_DOCUMENT = "0000000";

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
    numeroDocumento?: number;
    endereco?: {
      uf?: string;
      municipio?: string;
    };
  };
  loja?: { id: number };
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
        max: 1,
        duration: 3000,
      },
      workless: options.workless,
    });

    this.api = blingApi;
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
      product = await Product.findOne({ where: { sku } });
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

    const newSupplierCost = Number(
      blingProduct.fornecedor?.precoCusto ?? blingProduct.precoCusto ?? 0,
    );

    // Busca produto e estoque atuais antes do upsert para calcular CMP
    const existingProduct = await Product.findOne({
      where: { id_system: String(blingProduct.id) },
    });

    const { measure, line } = extractProductMeasureAndLine(
      blingProduct.nome,
      blingProduct.marca,
    );

    try {
      await Product.upsert(
        {
          name: blingProduct.nome,
          id_system: String(blingProduct.id),
          sku: blingProduct.codigo,
          ean: blingProduct.gtin ?? `NO-EAN-${blingProduct.id}`,
          ean_tribut: blingProduct.gtinEmbalagem ?? `NO-EAN-${blingProduct.id}`,
          price: blingProduct.precoCusto,
          type: blingProduct.formato === "E" ? "KIT" : "UNIT",
          integrations_id: integration.id,
          source_payload: blingProduct as unknown as Record<string, unknown>,
          unit: blingProduct.unidade,
          brand: blingProduct.marca,
          line,
          measure,
          gross_weight: Number(blingProduct.pesoBruto ?? 0),
          net_weight: Number(blingProduct.pesoLiquido ?? 0),
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
          stock_virtual_total: Number(
            blingProduct.estoque?.saldoVirtualTotal ?? 0,
          ),
        },
        { conflictFields: ["id_system"] },
      );
    } catch (error: any) {
      console.error("[BLING_API_FETCH] Erro no upsert do produto", {
        blingId: apiFetch.blingId,
        sku: blingProduct?.codigo,
        ean: blingProduct?.gtin,
        message: error.message,
        detail: error?.parent?.detail,
        fields: error?.fields,
        sql: error?.sql,
      });
      throw error;
    }

    // Se produto já existia sem average_cost e agora temos custo do fornecedor,
    // atualiza o total_price do estoque com o custo inicial
    if (
      existingProduct &&
      !existingProduct.average_cost &&
      newSupplierCost > 0
    ) {
      const stock = await Stock.findOne({
        where: { product_id: existingProduct.id },
      });
      if (stock && Number(stock.quantity) > 0) {
        const qty = Number(stock.quantity);
        await stock.update({
          total_price: qty * newSupplierCost,
        });
        // Agora que temos o custo, atualiza o average_cost no produto
        await Product.update(
          {
            average_cost: newSupplierCost,
            average_cost_updated_at: new Date(),
          },
          { where: { id: existingProduct.id } },
        );
        console.log(
          `[BLING_API_FETCH] average_cost inicializado: sku=${blingProduct.codigo} | custo=${newSupplierCost} | qty=${qty} | total_price=${qty * newSupplierCost}`,
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

    const existingInvoice = await Invoice.findOne({
      where: { id_system: String(nf.id) },
      attributes: ["status"],
    });

    const resolveOutgoingStatus = ():
      | "OPEN"
      | "PENDING"
      | "FINISHED"
      | "PENDING_CANCELLED_SYSTEM" => {
      if (nf.situacao === 2) return "PENDING_CANCELLED_SYSTEM";
      return (existingInvoice?.status as any) ?? "PENDING";
    };

    const invoiceStatus = resolveOutgoingStatus();

    console.log("INVOICE STATUS", invoiceStatus, nf, apiFetch);

    const incomingStatus = existingInvoice?.status ?? "WAITING_SCHEDULE_SALES";
    const encryptedKey = nf.chaveAcesso ?? null;

    let senderCnpj = String(nf.emitente?.cnpj ?? "");
    let senderName = nf.emitente?.nome ?? "";
    let receiverCnpj = String(
      nf.destinatario?.cnpj ?? nf.destinatario?.cpf ?? "",
    );
    let receiverName = nf.destinatario?.nome ?? "";
    let xmlContent: string | null = null;
    let transporter_name: string | null = null;
    let transporter_document: string | null = null;
    let transporter_city: string | null = null;
    let transporter_uf: string | null = null;
    let nfeRef: string | null = null;

    // CORREÇÃO 1: variáveis para UF/cidade do destinatário vindas do XML
    let destinationUfFromXml: string | null = null;
    let destinationCityFromXml: string | null = null;

    // CORREÇÃO 2: variáveis para totais fiscais vindos do XML
    let fiscalTotals: ReturnType<
      typeof extractInvoiceFiscalTotalsFromXml
    > | null = null;

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

          // CORREÇÃO 1: captura UF/cidade do XML (fonte confiável)
          destinationUfFromXml = extracted.destinationUf || null;
          destinationCityFromXml = extracted.destinationCity || null;

          // CORREÇÃO 2: captura totais fiscais do XML
          fiscalTotals = extractInvoiceFiscalTotalsFromXml(xmlContent);
        }
      } catch (err) {
        console.warn("[XML PARSE ERROR]", err);
      }
    }

    // CORREÇÃO 1: fallback para o campo do contato da API Bling quando XML não tiver UF
    const destinationUf =
      destinationUfFromXml || nf.contato?.endereco?.uf || null;
    const destinationCity =
      destinationCityFromXml || nf.contato?.endereco?.municipio || null;

    const customerDoc = nf.contato
      ? (nf.destinatario?.cnpj ?? nf.destinatario?.cpf ?? "")
      : "";
    const customerName = nf.contato?.nome ?? nf.destinatario?.nome ?? "";
    const key = nf.chaveAcesso ?? `PENDING-KEY-${nf.id}`;

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

    // CORREÇÃO 2: monta campos fiscais para o upsert da invoice
    // Prioridade: XML (mais confiável) > API Bling > 0
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

    const [invoice] = await Invoice.upsert(
      {
        id_system: String(nf.id),
        customer_name: customerName,
        customer_document: customerDoc,
        type: invoiceType,
        status: invoiceType === "OUTGOING" ? invoiceStatus : incomingStatus,
        sender_cnpj: senderCnpj,
        sender_name: senderName,
        receiver_cnpj: receiverCnpj,
        receiver_name: receiverName,
        unit_business_id: unit_business.id,
        danfe_path: "",
        xml_path: xmlContent ? encryptXml(xmlContent) : null,
        xml_key: encryptedKey,
        // CORREÇÃO 1: UF/cidade do XML com fallback para API
        destination_uf: destinationUf,
        destination_city: destinationCity,
        xml_url: nf.xml ?? null,
        source_payload: nf as unknown as Record<string, unknown>,
        emitted_at: emittedAt,
        number_system: String(nf.numero),
        integrations_id: integration.id,
        store_id: store_id!.id ?? null,
        transporter_id: transporter?.id ?? null,
        transporter_document: transporter_document ?? null,
        transporter_name: transporter_name ?? null,
        description: nfeRef ? `REF: ${nfeRef}` : null,
        // CORREÇÃO 2: campos fiscais populados
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
      },
      { conflictFields: ["id_system"] },
    ).catch((error) => {
      console.error(
        "[INVOICE UPSERT ERROR DETAIL]",
        JSON.stringify(
          {
            message: error.message,
            original: error.original?.message,
            detail: error.original?.detail,
            hint: error.original?.hint,
            where: error.original?.where,
            table: error.original?.table,
            column: error.original?.column,
            constraint: error.original?.constraint,
            sql: error.sql?.substring(0, 500),
            blingId: nf.id,
            numero: nf.numero,
          },
          null,
          2,
        ),
      );
      throw error;
    });

    console.log(
      `[BLING_API_FETCH] Invoice upsertada: id_system=${nf.id}, key=${key}`,
    );

    // CORREÇÃO 3: upsert dos itens fiscais a partir do XML
    if (xmlContent) {
      try {
        await this.upsertFiscalItems(
          invoice.id,
          xmlContent,
          senderCnpj,
          "[BLING_API_FETCH]",
        );
      } catch (err) {
        // Não bloqueia o fluxo principal se os fiscais falharem
        console.warn(
          `[BLING_API_FETCH] Falha ao upsert fiscal items para invoice ${nf.id}:`,
          err,
        );
      }
    }

    // ─── Itens operacionais da nota ───────────────────────────────────────────

    if (!nf.itens?.length) return;

    const quantityByProduct = new Map<string, number>();

    for (const item of nf.itens) {
      const sku = item.codigo?.trim();
      const product = await this.findProductForInvoiceItem({
        sku,
        ean: item.gtin,
        supplierCnpj: senderCnpj,
        logPrefix: "[BLING_API_FETCH]",
      });

      if (!product) {
        const reason =
          !sku && !item.gtin
            ? "SKU e EAN ausentes no XML"
            : !sku
              ? "SKU ausente — apenas EAN salvo"
              : !item.gtin
                ? "EAN ausente — apenas SKU salvo"
                : "SKU e EAN presentes mas sem produto correspondente no banco";

        const existing = await UnmappedInvoiceProduct.findOne({
          where: {
            invoice_id: invoice.id,
            ...(item.gtin ? { ean: String(item.gtin) } : { sku: sku ?? null }),
          },
        });

        if (!existing) {
          await UnmappedInvoiceProduct.create({
            invoice_id: invoice.id,
            ean: item.gtin ? String(item.gtin) : null,
            sku: sku ?? null,
            product_name: (item as any).descricao ?? null,
            quantity: item.quantidade ?? 0,
            reason,
            status: "UNMAPPED",
          });
        } else {
          await existing.update({ quantity: item.quantidade ?? 0 });
        }

        console.warn(
          `[BLING_API_FETCH] Produto não mapeado | invoice=${invoice.id} | sku=${sku} | ean=${item.gtin} | motivo=${reason}`,
        );
        continue;
      }

      const current = quantityByProduct.get(String(product.id)) ?? 0;
      quantityByProduct.set(
        String(product.id),
        current + (item.quantidade ?? 0),
      );
    }

    for (const [productId, quantity] of quantityByProduct) {
      const existingItem = await InvoiceItems.findOne({
        where: { invoice_id: invoice.id, product_id: productId },
      });

      if (existingItem) {
        await existingItem.update({ quantity_expected: quantity });
      } else {
        await InvoiceItems.create({
          product_id: productId,
          invoice_id: invoice.id,
          quantity_expected: quantity,
          status: "PENDING",
        });
      }
    }

    const invoiceItems = await InvoiceItems.findAll({
      where: { invoice_id: invoice.id },
      include: [{ model: Product, as: "product" }],
    });

    const mappedEans = new Set(
      invoiceItems.map((i) => i.product?.ean).filter(Boolean),
    );
    const mappedSkus = new Set(
      invoiceItems.map((i) => i.product?.sku).filter(Boolean),
    );

    for (const item of nf.itens) {
      const sku = item.codigo?.trim();
      const ean = item.gtin ? String(item.gtin).trim() : null;

      const wasMapped = ean
        ? mappedEans.has(ean)
        : sku
          ? mappedSkus.has(sku)
          : false;
      if (!wasMapped) continue;

      await UnmappedInvoiceProduct.destroy({
        where: {
          invoice_id: invoice.id,
          ...(ean ? { ean } : { sku: sku ?? null }),
        },
      });
    }

    console.log(
      `[BLING_API_FETCH] ${nf.itens?.length} item(ns) upsertado(s) para invoice ${nf.id}`,
    );

    // ─── Sincroniza batch se a invoice já pertencer a um ─────────────────────

    const batchInvoice = await ExpeditionBatchInvoice.findOne({
      where: { invoice_id: invoice.id },
    });

    if (batchInvoice) {
      let volumesAdded = 0;

      for (const item of nf.itens) {
        const sku = item.codigo?.trim();
        const product = await this.findProductForInvoiceItem({
          sku,
          ean: item.gtin,
          supplierCnpj: senderCnpj,
          logPrefix: "[BLING_API_FETCH]",
        });

        if (!product) continue;

        const existingBatchItem = await ExpeditionBatchItems.findOne({
          where: {
            expedition_batch_id: batchInvoice.expedition_batch_id,
            product_id: product.id,
          },
        });

        if (existingBatchItem) continue;

        await ExpeditionBatchItems.create({
          expedition_batch_id: batchInvoice.expedition_batch_id,
          product_id: product.id,
          quantity: item.quantidade ?? 0,
          quantity_scanned: 0,
        });

        volumesAdded += item.quantidade ?? 0;
      }

      if (volumesAdded > 0) {
        await ExpeditionBatch.increment("total_volumes", {
          by: volumesAdded,
          where: { id: batchInvoice.expedition_batch_id },
        });

        console.log(
          `[BLING_API_FETCH] Batch ${batchInvoice.expedition_batch_id} sincronizado | +${volumesAdded} volumes novos`,
        );
      }
    }
  }

  /**
   * Importa uma NF-e a partir de um XML bruto (sem passar pela API Bling).
   * Usado pelo endpoint de importação manual de XML.
   */
  async upsertInvoiceFromXml(xmlContent: string, status?: InvoiceStatus): Promise<void> {
    const parsed = parser.parse(xmlContent);

    const nfe =
      parsed?.nfeProc?.NFe?.infNFe ||
      parsed?.procNFe?.NFe?.infNFe ||
      parsed?.NFe?.infNFe;

    if (!nfe) {
      throw new Error("XML inválido: estrutura de NF-e não reconhecida");
    }

    const ide = nfe.ide ?? {};
    const det = nfe.det ? (Array.isArray(nfe.det) ? nfe.det : [nfe.det]) : [];

    // ─── Chave de acesso ─────────────────────────────────────────────────────

    const rawId: string = nfe["@_Id"] ?? "";
    let chaveAcesso = rawId.replace(/^NFe/, "");

    if (!chaveAcesso) {
      chaveAcesso =
        parsed?.nfeProc?.protNFe?.infProt?.chNFe ??
        parsed?.procNFe?.protNFe?.infProt?.chNFe ??
        "";
    }

    if (!chaveAcesso) {
      const emit = nfe.emit ?? {};
      const cuf = String(ide.cUF ?? "");
      const aamm =
        String(ide.dhEmi ?? "").slice(2, 4) +
        String(ide.dhEmi ?? "").slice(5, 7);
      const cnpj = String(emit.CNPJ ?? "").replace(/\D/g, "");
      const mod = String(ide.mod ?? "55").padStart(2, "0");
      const serie = String(ide.serie ?? "").padStart(3, "0");
      const nnf = String(ide.nNF ?? "").padStart(9, "0");
      const tpemis = String(ide.tpEmis ?? "1");
      const cnf = String(ide.cNF ?? "").padStart(8, "0");
      const cdv = String(ide.cDV ?? "");

      const candidate = `${cuf}${aamm}${cnpj}${mod}${serie}${nnf}${tpemis}${cnf}${cdv}`;
      if (candidate.length === 44) chaveAcesso = candidate;
    }

    const numero = String(ide.nNF ?? "");
    const idSystem = chaveAcesso || `MANUAL-${Date.now()}`;

    // ─── Partes ──────────────────────────────────────────────────────────────

    const extracted = extractPartiesFromXml(xmlContent);
    const senderCnpj = cleanDocument(extracted.senderCnpj);
    const senderName = extracted.senderName;
    const receiverCnpj = cleanDocument(extracted.receiverCnpj);
    const receiverName = extracted.receiverName;
    let transporterName = extracted.transporterName || null;
    let transporterDocument = extracted.transporterDocument || null;
    let nfeRef = extracted.refNFe || null;

    // CORREÇÃO 1: UF/cidade do XML
    const destinationUf = extracted.destinationUf || null;
    const destinationCity = extracted.destinationCity || null;

    // CORREÇÃO 2: totais fiscais do XML
    const fiscalTotals = extractInvoiceFiscalTotalsFromXml(xmlContent);

    // ─── Tipo ────────────────────────────────────────────────────────────────

    const senderUnit = await UnitBusiness.findOne({
      where: { cnpj: senderCnpj },
    });
    const invoiceType: "INCOMING" | "OUTGOING" = senderUnit
      ? "OUTGOING"
      : "INCOMING";

    // ─── UnitBusiness ────────────────────────────────────────────────────────

    let unit_business: UnitBusiness | null = null;

    if (invoiceType === "INCOMING") {
      unit_business = await UnitBusiness.findOne({
        where: { cnpj: receiverCnpj },
      });
      if (!unit_business) {
        unit_business = await UnitBusiness.findOne({
          where: { cnpj: senderCnpj },
        });
      }
    } else {
      unit_business = await UnitBusiness.findOne({
        where: { cnpj: senderCnpj },
      });
    }

    if (!unit_business) {
      console.warn(
        `[IMPORT_XML] UnitBusiness não encontrada | type=${invoiceType} | sender=${senderCnpj} | receiver=${receiverCnpj} | fallback padrão`,
      );
      unit_business = await UnitBusiness.findByPk(BLING_UNIT_BUSINESS_ID);
    }

    if (!unit_business) {
      throw new Error(
        `UnitBusiness não encontrada | id=${BLING_UNIT_BUSINESS_ID}`,
      );
    }

    const integration = await getBlingIntegration("Bling");

    if (!transporterDocument) {
      transporterName = NO_TRANSPORTER_NAME;
      transporterDocument = NO_TRANSPORTER_DOCUMENT;
    } else if (!transporterName) {
      transporterName = NO_TRANSPORTER_NAME;
    }

    const transporter = await this.findOrCreateTransporter({
      document: transporterDocument,
      name: transporterName,
      city: extracted.transporterCity,
      uf: extracted.transporterUf,
    });

    // ─── Upsert Invoice ──────────────────────────────────────────────────────
    
    const existingInvoice = await Invoice.findOne({
      where: { xml_key: chaveAcesso },
      attributes: ["status"],
    });

    const incomingStatus = status ?? existingInvoice?.status ?? "WAITING_SCHEDULE_SALES";
    const outgoingStatus = status ?? existingInvoice?.status ?? "PENDING";

     let store_id = await Store.findOne({
      where: { id: existingInvoice?.store_id },
    });

    if (!store_id) {
      store_id = await Store.findOne({ where: { name: "Outros" } });
    }
    const conflictFields = chaveAcesso ? ["xml_key"] : ["id_system"];


    const [invoice] = await Invoice.upsert(
      {
        id_system: idSystem,
        customer_name: receiverName,
        customer_document: receiverCnpj,
        type: invoiceType,
        status: invoiceType === "OUTGOING" ? outgoingStatus : incomingStatus,
        sender_cnpj: senderCnpj,
        sender_name: senderName,
        receiver_cnpj: receiverCnpj,
        receiver_name: receiverName,
        unit_business_id: unit_business.id,
        danfe_path: "",
        xml_path: encryptXml(xmlContent),
        xml_key: chaveAcesso || null,
        emitted_at: ide.dhEmi ? parseBlingDate(ide.dhEmi) : new Date(),
        number_system: numero,
        integrations_id: integration.id,
        store_id: store_id?.id ?? "",
        transporter_id: transporter?.id ?? null,
        transporter_document: transporterDocument,
        transporter_name: transporterName,
        description: nfeRef ? `REF: ${nfeRef}` : null,
        // CORREÇÃO 1: UF/cidade do XML
        destination_uf: destinationUf,
        destination_city: destinationCity,
        // CORREÇÃO 2: campos fiscais
        invoice_value: fiscalTotals.invoiceValue,
        invoice_products_value: fiscalTotals.invoiceProductsValue,
        invoice_freight_value: fiscalTotals.invoiceFreightValue,
        invoice_discount_value: fiscalTotals.invoiceDiscountValue,
        invoice_total_tax_value: fiscalTotals.invoiceTotalTaxValue,
        icms_value: fiscalTotals.icmsValue,
        ipi_value: fiscalTotals.ipiValue,
        pis_value: fiscalTotals.pisValue,
        cofins_value: fiscalTotals.cofinsValue,
        difal_value: fiscalTotals.difalValue,
        ibs_value: fiscalTotals.ibsValue,
        cbs_value: fiscalTotals.cbsValue,
      },
      { conflictFields: conflictFields as any },
    ).catch((error: any) => {
      console.error(
        "[IMPORT_XML UPSERT ERROR DETAIL]",
        JSON.stringify(
          {
            message: error.message,
            original: error.original?.message,
            detail: error.original?.detail,
            hint: error.original?.hint,
            where: error.original?.where,
            table: error.original?.table,
            column: error.original?.column,
            constraint: error.original?.constraint,
            sql: error.sql?.substring(0, 500),
            idSystem,
            numero,
          },
          null,
          2,
        ),
      );
      throw error;
    });

    console.log(`[IMPORT_XML] Invoice upsertada: id_system=${idSystem}`);

    // CORREÇÃO 3: upsert dos itens fiscais
    try {
      await this.upsertFiscalItems(
        invoice.id,
        xmlContent,
        senderCnpj,
        "[IMPORT_XML]",
      );
    } catch (err) {
      console.warn(
        `[IMPORT_XML] Falha ao upsert fiscal items para invoice ${idSystem}:`,
        err,
      );
    }

    // ─── Itens operacionais ───────────────────────────────────────────────────

    if (!det.length) return;

    const quantityByProduct = new Map<string, number>();

    for (const item of det) {
      const prod = item.prod ?? {};
      const sku = prod.cProd ? String(prod.cProd).trim() : undefined;
      const gtin =
        prod.cEAN && prod.cEAN !== "SEM GTIN" ? prod.cEAN : undefined;
      const qty = Number(prod.qCom ?? 0);

      const product = await this.findProductForInvoiceItem({
        sku,
        ean: gtin,
        supplierCnpj: senderCnpj,
        logPrefix: "[IMPORT_XML]",
      });

      if (!product) {
        const reason =
          !sku && !gtin
            ? "SKU e EAN ausentes no XML"
            : !sku
              ? "SKU ausente — apenas EAN salvo"
              : !gtin
                ? "EAN ausente — apenas SKU salvo"
                : "SKU e EAN presentes mas sem produto correspondente no banco";

        const existing = await UnmappedInvoiceProduct.findOne({
          where: {
            invoice_id: invoice.id,
            ...(gtin ? { ean: String(gtin) } : { sku: sku ?? null }),
          },
        });

        if (!existing) {
          await UnmappedInvoiceProduct.create({
            invoice_id: invoice.id,
            ean: gtin ?? null,
            sku: sku ?? null,
            product_name: prod.xProd ?? null,
            quantity: qty,
            reason,
            status: "UNMAPPED",
          });
        } else {
          await existing.update({ quantity: qty });
        }

        console.warn(
          `[IMPORT_XML] Produto não mapeado | invoice=${invoice.id} | sku=${sku} | ean=${gtin} | motivo=${reason}`,
        );
        continue;
      }

      const current = quantityByProduct.get(String(product.id)) ?? 0;
      quantityByProduct.set(String(product.id), current + qty);
    }

    for (const [productId, quantity] of quantityByProduct) {
      const existingItem = await InvoiceItems.findOne({
        where: { invoice_id: invoice.id, product_id: productId },
      });

      if (existingItem) {
        await existingItem.update({ quantity_expected: quantity });
      } else {
        await InvoiceItems.create({
          product_id: productId,
          invoice_id: invoice.id,
          quantity_expected: quantity,
          status: "PENDING",
        });
      }
    }

    const invoiceItemsXml = await InvoiceItems.findAll({
      where: { invoice_id: invoice.id },
      include: [{ model: Product, as: "product" }],
    });

    const mappedEansXml = new Set(
      invoiceItemsXml.map((i) => i.product?.ean).filter(Boolean),
    );
    const mappedSkusXml = new Set(
      invoiceItemsXml.map((i) => i.product?.sku).filter(Boolean),
    );

    for (const item of det) {
      const prod = item.prod ?? {};
      const sku = prod.cProd ? String(prod.cProd).trim() : null;
      const gtin =
        prod.cEAN && prod.cEAN !== "SEM GTIN" ? String(prod.cEAN).trim() : null;

      const wasMapped = gtin
        ? mappedEansXml.has(gtin)
        : sku
          ? mappedSkusXml.has(sku)
          : false;
      if (!wasMapped) continue;

      await UnmappedInvoiceProduct.destroy({
        where: {
          invoice_id: invoice.id,
          ...(gtin ? { ean: gtin } : { sku: sku ?? null }),
        },
      });
    }

    console.log(
      `[IMPORT_XML] ${det.length} item(ns) processado(s) para invoice ${idSystem}`,
    );
  }

  protected override onFailed(
    job: Job<ApiFetchJobPayload>,
    error: Error,
  ): void {
    alertService.sendAlert({
      severity: "HIGH",
      title: "BlingApiFetchQueue — job esgotou tentativas",
      message: `Job: ${job.id} | Resource: ${job.data.resource} | Action: ${job.data.action} | BlingId: ${job.data.apiFetch?.blingId} | EventId: ${job.data.eventId} | Erro: ${error.message}`,
    });
  }
}
