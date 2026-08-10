import {
  FullInvoiceForAllUnits,
  InvoiceStatus,
  ItemWithFiscal,
} from "../../../modules/warehouse/fiscal/invoices/invoice/invoice.types";
import {
  Invoice,
  InvoiceItems,
  UnitBusiness,
  Transporter,
} from "../../../modules/warehouse";
import {
  Product,
  ProductConfig,
  SupplierMapping,
} from "../../../modules/inventory";
import InvoiceFiscalItem from "../../../modules/warehouse/fiscal/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import UnmappedInvoiceProduct from "../../../modules/inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import Store from "../../../modules/sales/stores/stores.model";
import parser from "../../../shared/utils/xml/xml-parser";
import { cleanDocument } from "../../../shared/utils/normalizers/document";
import { encryptXml } from "../../../shared/utils/xml/xml-cipher";
import { getBlingIntegration } from "../../../modules/handlers/bling/api/bling_api.service";
import { logDbError } from "../logging/db-errors-logs";
import { Op } from "sequelize";
import invoiceService from "../../../modules/warehouse/fiscal/invoices/invoice/invoice.service";
import { InvoiceUnitBusinessAttributesStatus } from "../../../modules/warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import unitBusinessService from "../../../modules/company/unit-business/unit-business.service";
import { getTCarIntegration } from "../../../modules/handlers/tecinco/api/tecinco_api";
import integrationsService from "../../../modules/integrations/integrations/integrations.service";

const BLING_UNIT_BUSINESS_ID = process.env.BLING_UNIT_BUSINESS_ID;
const NO_TRANSPORTER_NAME = "Sem transporte";
const NO_TRANSPORTER_DOCUMENT = "0000000";

export interface InvoiceOperationalItemFromXml {
  product_id: string;
  quantity_expected: number;
  item_number?: number;
  sku?: string | null;
  gtin?: string | null;
  description?: string | null;
  unit_price?: number;
  total_value?: number;
}

export interface UnmappedInvoiceItemFromXml {
  sku: string | null;
  gtin: string | null;
  qty: number;
  xProd: string | null;
  reason: string;
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

function parseBlingDate(date: string): Date {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(date)) {
    return new Date(date);
  }
  return new Date(date.replace(" ", "T") + "-03:00");
}

function extractPartiesFromXml(xml: string) {
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
  const destEnder = dest?.enderDest ?? {};
  const transporter = transp?.transporta ?? {};

  return {
    senderCnpj: emit?.CNPJ ?? "",
    senderName: emit?.xNome ?? "",
    receiverCnpj: dest?.CNPJ || dest?.CPF || dest?.cnpj || dest?.cpf || "",
    receiverName: dest?.xNome ?? "",
    destinationUf: destEnder?.UF ?? "",
    destinationCity: destEnder?.xMun ?? "",
    transporterName: transporter?.xNome ?? "",
    transporterDocument: transporter?.CNPJ ?? transporter?.CPF ?? "",
    transporterCity: transporter?.xMun ?? "",
    transporterUf: transporter?.UF ?? "",
    refNFe: refNFe !== null ? String(refNFe) : null,
  };
}

function extractInvoiceFiscalTotalsFromXml(xml: string) {
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
    difalValue: Number(tot?.vICMSUFDest ?? 0),
    ibsValue: 0,
    cbsValue: 0,
  };
}

async function findOrCreateTransporter(params: {
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
    const existing = await Transporter.findOne({
      where: {
        [Op.or]: [
          { cnpj: NO_TRANSPORTER_DOCUMENT },
          { name: NO_TRANSPORTER_NAME },
        ],
      },
    });

    if (existing) {
      if (!existing.cnpj)
        await existing.update({ cnpj: NO_TRANSPORTER_DOCUMENT });
      return existing;
    }

    return Transporter.create({
      name: NO_TRANSPORTER_NAME,
      cnpj: NO_TRANSPORTER_DOCUMENT,
      city: city ?? "",
      uf: uf ?? "",
    });
  }

  if (!document) return null;

  const cleanDoc = cleanDocument(document);
  if (!cleanDoc) return null;

  const existing = await Transporter.findOne({ where: { cnpj: cleanDoc } });
  if (existing) return existing;

  if (!name) return null;

  return Transporter.create({
    name,
    cnpj: cleanDoc,
    city: city ?? "",
    uf: uf ?? "",
  });
}

async function upsertTecincoCrossConfig(
  det: any[],
  senderCnpj: string,
  logPrefix: string,
): Promise<void> {
  // Só faz sentido se o emitente for uma UnitBusiness Tecinco
  const unitBusiness = await UnitBusiness.findOne({
    where: { cnpj: senderCnpj },
  });
  if (!unitBusiness) return;

  for (const item of det) {
    const prod = item.prod ?? {};
    const sku = prod.cProd ? String(prod.cProd).trim() : null;
    const gtin =
      prod.cEAN && prod.cEAN !== "SEM GTIN" ? String(prod.cEAN).trim() : null;
    const unitPrice = Number(prod.vUnCom ?? 0);

    if (!sku && !gtin) continue;

    // Tenta encontrar o produto pelo EAN ou pelo SupplierMapping
    const product = await findProductForInvoiceItem({
      sku,
      ean: gtin,
      supplierCnpj: senderCnpj,
      logPrefix,
    });

    if (!product) continue;

    // ─── SupplierMapping ────────────────────────────────────────────────────
    const supplierProductCode = gtin ?? sku!;

    const existingMapping = await SupplierMapping.findOne({
      where: { product_id: product.id, supplier_cnpj: senderCnpj },
    });

    if (existingMapping) {
      await existingMapping.update({
        supplier_product_code: supplierProductCode,
      });
    } else {
      if (supplierProductCode) {
      await SupplierMapping.create({
        product_id: product.id,
        supplier_cnpj: senderCnpj,
        supplier_product_code: supplierProductCode,
      });
    }
    }

    // ─── ProductConfig ──────────────────────────────────────────────────────
    const existingConfig = await ProductConfig.findOne({
      where: { product_id: product.id, unit_business_id: unitBusiness.id },
    });

    await ProductConfig.upsert(
      {
        product_id: product.id,
        unit_business_id: unitBusiness.id,
        sku: sku ?? existingConfig?.sku ?? "",
        price: existingConfig?.price ?? unitPrice, // não sobrescreve preço se já existe
        supplier_cost_price: unitPrice,
        average_cost: existingConfig?.average_cost // não sobrescreve custo médio já calculado
          ? existingConfig.average_cost
          : unitPrice,
      },
      { conflictFields: ["product_id", "unit_business_id"] },
    );

    console.log(
      `${logPrefix} ProductConfig+SupplierMapping upsertado | product_id=${product.id} | sku=${sku} | ean=${gtin} | cnpj=${senderCnpj}`,
    );
  }
}

async function findProductForInvoiceItem(params: {
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

  const cleanSupplierCnpj = params.supplierCnpj
    ? cleanDocument(params.supplierCnpj)
    : null;

  const supplierMapping = cleanSupplierCnpj
    ? ((await SupplierMapping.findOne({
        where: { supplier_product_code: ean, supplier_cnpj: cleanSupplierCnpj },
        order: [["updatedAt", "DESC"]],
      })) ??
      (await SupplierMapping.findOne({
        where: { supplier_product_code: ean },
        order: [["updatedAt", "DESC"]],
      })))
    : await SupplierMapping.findOne({
        where: { supplier_product_code: ean },
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

async function upsertFiscalItems(
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

  if (!nfe?.det) return;

  const det: any[] = Array.isArray(nfe.det) ? nfe.det : [nfe.det];

  for (let idx = 0; idx < det.length; idx++) {
    const item = det[idx];
    const prod = item.prod ?? {};
    const imposto = item.imposto ?? {};

    const sku = prod.cProd ? String(prod.cProd).trim() : null;
    const gtin =
      prod.cEAN && prod.cEAN !== "SEM GTIN" ? String(prod.cEAN).trim() : null;

    const product = await findProductForInvoiceItem({
      sku,
      ean: gtin,
      supplierCnpj: senderCnpj,
      logPrefix,
    });

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

    const ipiGroup: any = imposto?.IPI?.IPITrib ?? imposto?.IPI?.IPINT ?? {};
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

    await InvoiceFiscalItem.upsert(
      {
        invoice_id: invoiceId,
        product_id: product?.id ?? null,
        item_number: idx + 1,
        sku,
        description: String(prod.xProd ?? "").slice(0, 255) || null,
        quantity: Number(prod.qCom ?? 0),
        unit_price: Number(prod.vUnCom ?? 0),
        total_value: Number(prod.vProd ?? 0),
        ncm: prod.NCM ? String(prod.NCM) : null,
        cest: prod.CEST ? String(prod.CEST) : null,
        cfop: prod.CFOP ? String(prod.CFOP) : null,
        gtin,
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
      },
      { conflictFields: ["invoice_id", "product_id"] as any },
    );
  }

  console.log(
    `${logPrefix} ${det.length} item(ns) fiscal(is) upsertado(s) para invoice ${invoiceId}`,
  );
}

function buildFiscalItemFromXml(params: {
  xmlItem: any;
  productId: string;
  itemNumber: number;
  sku?: string | null;
  gtin?: string | null;
  description?: string | null;
  quantityFallback?: number;
  unitPriceFallback?: number;
  totalValueFallback?: number;
}): ItemWithFiscal["fiscal"] {
  const prod = params.xmlItem?.prod ?? {};
  const imposto = params.xmlItem?.imposto ?? {};

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

  const ipiGroup: any = imposto?.IPI?.IPITrib ?? imposto?.IPI?.IPINT ?? {};
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

  const sku =
    params.sku ?? (prod.cProd ? String(prod.cProd).trim() : null);
  const gtin =
    params.gtin ??
    (prod.cEAN && prod.cEAN !== "SEM GTIN" ? String(prod.cEAN).trim() : null);

  return {
    product_id: params.productId,
    item_number: params.itemNumber,
    sku,
    description:
      String(prod.xProd ?? params.description ?? "").slice(0, 255) || null,
    quantity: Number(prod.qCom ?? params.quantityFallback ?? 0),
    unit_price: Number(prod.vUnCom ?? params.unitPriceFallback ?? 0),
    total_value: Number(prod.vProd ?? params.totalValueFallback ?? 0),
    ncm: prod.NCM ? String(prod.NCM) : null,
    cest: prod.CEST ? String(prod.CEST) : null,
    cfop: prod.CFOP ? String(prod.CFOP) : null,
    gtin,
    approx_tax_value: Number(imposto?.vTotTrib ?? 0),
    icms_rate: Number(icmsGroup?.pICMS ?? 0),
    icms_value: Number(icmsGroup?.vICMS ?? 0),
    ipi_value: Number(ipiGroup?.vIPI ?? 0),
    pis_value: Number(pisGroup?.vPIS ?? 0),
    cofins_value: Number(cofinsGroup?.vCOFINS ?? 0),
    difal_value: Number(
      imposto?.ICMSUFDest?.vICMSUFDest ?? imposto?.ICMSUFDest?.vICMSDest ?? 0,
    ),
    ibs_value:
      Number(ibsCbsGroup?.gIBSUF?.vIBSUF ?? 0) +
      Number(ibsCbsGroup?.gIBSMun?.vIBSMun ?? 0),
    cbs_value: Number(ibsCbsGroup?.gCBS?.vCBS ?? 0),
  };
}

function normalizeMatchValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

function numbersAreClose(a?: number, b?: number): boolean {
  if (a === undefined || b === undefined) return false;
  return Math.abs(Number(a) - Number(b)) < 0.01;
}

function toIntegerQuantity(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
}

function findXmlItemForOperationalItem(params: {
  det: any[];
  operationalItem: InvoiceOperationalItemFromXml;
  fallbackIndex: number;
}): { xmlItem: any | null; itemNumber: number } {
  const { det, operationalItem, fallbackIndex } = params;
  const fallbackItemNumber = operationalItem.item_number ?? fallbackIndex + 1;
  const fallbackXmlItem = det[fallbackItemNumber - 1] ?? det[fallbackIndex];

  const sku = normalizeMatchValue(operationalItem.sku);
  const description = normalizeMatchValue(operationalItem.description);
  const quantity = Number(operationalItem.quantity_expected ?? 0);
  const unitPrice =
    operationalItem.unit_price === undefined
      ? undefined
      : Number(operationalItem.unit_price);
  const totalValue =
    operationalItem.total_value === undefined
      ? undefined
      : Number(operationalItem.total_value);

  const cProdMatches = det
    .map((xmlItem, idx) => {
      const prod = xmlItem?.prod ?? {};
      const xmlSku = normalizeMatchValue(prod.cProd);
      const xmlDescription = normalizeMatchValue(prod.xProd);
      const xmlQuantity = Number(prod.qCom ?? 0);
      const xmlUnitPrice = Number(prod.vUnCom ?? 0);
      const xmlTotalValue = Number(prod.vProd ?? 0);

      let score = 0;
      if (sku && xmlSku === sku) score += 100;
      if (numbersAreClose(quantity, xmlQuantity)) score += 10;
      if (numbersAreClose(unitPrice, xmlUnitPrice)) score += 8;
      if (numbersAreClose(totalValue, xmlTotalValue)) score += 8;
      if (description && xmlDescription === description) score += 5;

      return { xmlItem, idx, score };
    })
    .filter((match) => match.score >= 100)
    .sort((a, b) => b.score - a.score);

  const match = cProdMatches[0];
  if (match) return { xmlItem: match.xmlItem, itemNumber: match.idx + 1 };

  return {
    xmlItem: fallbackXmlItem ?? null,
    itemNumber: fallbackItemNumber,
  };
}

function isInvoiceCancellationStatus(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toUpperCase();
  return [
    "2",
    "C",
    "CANCELADA",
    "CANCELADO",
    "CANCELLED",
    "101",
    "135",
    "151",
    "155",
  ].includes(normalized);
}

function isCancelledInvoice(params: {
  parsedXml: any;
  nfe: any;
  sourcePayload?: Record<string, unknown>;
  explicitCancelled?: boolean;
}): boolean {
  if (params.explicitCancelled !== undefined) return params.explicitCancelled;

  const sourcePayload = params.sourcePayload as any;
  const seqCancelamento =
    sourcePayload?.chave?.seq_cancelamento ?? sourcePayload?.seq_cancelamento;
  if (
    seqCancelamento !== null &&
    seqCancelamento !== undefined &&
    String(seqCancelamento).trim() !== "" &&
    String(seqCancelamento).trim() !== "0"
  ) {
    return true;
  }

  const statusCandidates = [
    sourcePayload?.cabecalho?.situacao,
    sourcePayload?.fiscal?.situacao_nfe,
    sourcePayload?.situacao,
    params.parsedXml?.nfeProc?.protNFe?.infProt?.cStat,
    params.parsedXml?.procNFe?.protNFe?.infProt?.cStat,
    params.parsedXml?.procEventoNFe?.evento?.infEvento?.cStat,
    params.parsedXml?.procEventoNFe?.retEvento?.infEvento?.cStat,
    params.nfe?.protNFe?.infProt?.cStat,
  ];

  return statusCandidates.some(isInvoiceCancellationStatus);
}

// ─── Export público ───────────────────────────────────────────────────────────

export async function upsertInvoiceFromXml(
  xmlContent: string,
  options?: {
    integrationName?: string;
    initialStatus?: InvoiceUnitBusinessAttributesStatus;
    updateStatus?: InvoiceUnitBusinessAttributesStatus;
    skipCrossConfig?: boolean;
    allowUpdateFromAnyIntegration?: boolean;
    operationalItems?: InvoiceOperationalItemFromXml[];
    unmappedItems?: UnmappedInvoiceItemFromXml[];
    sourcePayload?: Record<string, unknown>;
    isCancelled?: boolean;
    invoiceType?: "INCOMING" | "OUTGOING";
  },
): Promise<void> {
  const {
    integrationName = "Tecinco",
    initialStatus = "WAITING_SCHEDULE_SALES",
    skipCrossConfig = false,
    allowUpdateFromAnyIntegration = false,
    invoiceType
  } = options ?? {};
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
  const cancelledInvoice = isCancelledInvoice({
    parsedXml: parsed,
    nfe,
    sourcePayload: options?.sourcePayload,
    explicitCancelled: options?.isCancelled,
  });
 
  const resolvedUpdateStatus: InvoiceUnitBusinessAttributesStatus | undefined =
    cancelledInvoice ? "PENDING_CANCELLED_SYSTEM" : options?.updateStatus;


  const resolveInitialStatus = (): InvoiceUnitBusinessAttributesStatus => {
    if (invoiceType === 'OUTGOING') {
      if (cancelledInvoice) return "PENDING_CANCELLED_SYSTEM"
      return "OPEN";
    }
    return "WAITING_SCHEDULE_SALES"
  }

  // ─── Chave de acesso ───────────────────────────────────────────────────────

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
      String(ide.dhEmi ?? "").slice(2, 4) + String(ide.dhEmi ?? "").slice(5, 7);
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

  // ─── Partes ────────────────────────────────────────────────────────────────

  const extracted = extractPartiesFromXml(xmlContent);
  const senderCnpj = cleanDocument(extracted.senderCnpj);
  const senderName = extracted.senderName;
  const receiverCnpj = cleanDocument(extracted.receiverCnpj);
  const receiverName = extracted.receiverName;
  let transporterName = extracted.transporterName || null;
  let transporterDocument = extracted.transporterDocument || null;
  const nfeRef = extracted.refNFe || null;
  const destinationUf = extracted.destinationUf || null;
  const destinationCity = extracted.destinationCity || null;

  const fiscalTotals = extractInvoiceFiscalTotalsFromXml(xmlContent);

  const integration = await integrationsService.getFullIntegration({
    where: { name: integrationName, type: "SYSTEM" },
  });

  if (!transporterDocument) {
    transporterName = NO_TRANSPORTER_NAME;
    transporterDocument = NO_TRANSPORTER_DOCUMENT;
  } else if (!transporterName) {
    transporterName = NO_TRANSPORTER_NAME;
  }

  const transporter = await findOrCreateTransporter({
    document: transporterDocument,
    name: transporterName,
    city: extracted.transporterCity,
    uf: extracted.transporterUf,
  });

  // ─── Invoice existente ─────────────────────────────────────────────────────

  const existingInvoice = await invoiceService.findByIdFullForAllUnits(
    "",
    chaveAcesso,
  );

  let store_id: Store | null = null;
  if (existingInvoice?.store_id) {
    store_id = await Store.findOne({ where: { id: existingInvoice.store_id } });
  }
  if (!store_id) {
    store_id = await Store.findOne({ where: { name: "Outros" } });
  }

  // ─── Dados base da invoice ─────────────────────────────────────────────────

  const invoiceBaseData = {
    customer_name: receiverName,
    customer_document: receiverCnpj,
    sender_cnpj: senderCnpj,
    sender_name: senderName,
    receiver_cnpj: receiverCnpj,
    receiver_name: receiverName,
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
    destination_uf: destinationUf,
    destination_city: destinationCity,
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
    ...(options?.sourcePayload ? { source_payload: options.sourcePayload } : {}),
  };

  // ─── Monta invoice items + fiscal items a partir do det ───────────────────
  // Feito antes do create/update para passar tudo junto ao createWithRelations.
  // Unmapped só pode ser registrado após ter o invoice.id, então é tratado depois.

  const invoiceItemsForCreate: ItemWithFiscal[] = [];
  const unmappedDet: UnmappedInvoiceItemFromXml[] = [
    ...(options?.unmappedItems ?? []),
  ];

  if (Array.isArray(options?.operationalItems) && !existingInvoice) {
    for (let idx = 0; idx < options.operationalItems.length; idx++) {
      const item = options.operationalItems[idx];
      const { xmlItem, itemNumber } = findXmlItemForOperationalItem({
        det,
        operationalItem: item,
        fallbackIndex: idx,
      });

      invoiceItemsForCreate.push({
        product_id: item.product_id,
        quantity_expected: Math.trunc(Number(item.quantity_expected ?? 0)),
        fiscal: xmlItem
          ? buildFiscalItemFromXml({
              xmlItem,
              productId: item.product_id,
              itemNumber,
              sku: item.sku,
              gtin: item.gtin,
              description: item.description,
              quantityFallback: Number(item.quantity_expected ?? 0),
              unitPriceFallback: item.unit_price,
              totalValueFallback: item.total_value,
            })
          : undefined,
      });
    }
  } else if (det.length && !existingInvoice) {
    for (let idx = 0; idx < det.length; idx++) {
      const item = det[idx];
      const prod = item.prod ?? {};

      const sku = prod.cProd ? String(prod.cProd).trim() : null;
      const gtin =
        prod.cEAN && prod.cEAN !== "SEM GTIN" ? String(prod.cEAN).trim() : null;
      const qty = Number(prod.qCom ?? 0);

      const product = await findProductForInvoiceItem({
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

        unmappedDet.push({ sku, gtin, qty, xProd: prod.xProd ?? null, reason });
        continue;
      }

      invoiceItemsForCreate.push({
        product_id: product.id,
        quantity_expected: Math.trunc(qty),
        fiscal: buildFiscalItemFromXml({
          xmlItem: item,
          productId: product.id,
          itemNumber: idx + 1,
          sku,
          gtin,
          quantityFallback: qty,
        }),
      });
    }
  }

  // ─── Create ou Update da invoice ──────────────────────────────────────────

  let invoice: FullInvoiceForAllUnits | null;

  if (!existingInvoice) {
    const created = await invoiceService
      .createWithRelations(
        {
          ...invoiceBaseData,
          id_system: idSystem,
        },
        invoiceItemsForCreate,
        {
          initialStatus: resolveInitialStatus(),
          invoiceType: options?.invoiceType,
        },
      )
      .catch((error: any) => {
        logDbError("[IMPORT_XML CREATE ERROR DETAIL]", error, {
          idSystem,
          numero,
          chaveAcesso,
        });
        throw error;
      });

    invoice = await invoiceService.findByIdFullForAllUnits(created.id);

    if (!invoice) {
      throw new Error("Invoice não encontrada.");
    }

    if (cancelledInvoice) {
      await invoiceService.updateInvoicesForAllUnitBusiness([invoice.id], {
        status: "PENDING_CANCELLED_SYSTEM",
      });
      invoice = await invoiceService.findByIdFullForAllUnits(invoice.id);
    }
  } else {
    if (
      !allowUpdateFromAnyIntegration &&
      existingInvoice.integrations_id !== integration.id
    ) {
      return;
    }

    await invoiceService.updateInvoicesForAllUnitBusiness(
      [existingInvoice.id],
      {
        ...invoiceBaseData,
        ...(resolvedUpdateStatus ? { status: resolvedUpdateStatus } : {}),
      },
    );

    invoice = await invoiceService.findByIdFullForAllUnits(existingInvoice.id);

    if (!invoice) {
      throw new Error("Invoice não encontrada.");
    }
  }

  if (!invoice) {
    throw new Error("Invoice não encontrada.");
  }

  console.log(`[IMPORT_XML] Invoice upsertada: id_system=${idSystem}`);

  // ─── Unmapped products (requer invoice.id) ─────────────────────────────────

  for (const u of unmappedDet) {
    const quantity = toIntegerQuantity(u.qty);

    const existing = await UnmappedInvoiceProduct.findOne({
      where: {
        invoice_id: invoice.id,
        ...(u.gtin ? { ean: u.gtin } : { sku: u.sku ?? null }),
      },
    });

    if (!existing) {
      await UnmappedInvoiceProduct.create({
        invoice_id: invoice.id,
        integrations_id: integration.id,
        ean: u.gtin ?? null,
        sku: u.sku ?? null,
        product_name: u.xProd,
        quantity,
        reason: u.reason,
        status: "UNMAPPED",
      });
    } else {
      await existing.update({
        quantity,
        integrations_id: integration.id,
      });
    }

    console.warn(
      `[IMPORT_XML] Produto não mapeado | invoice=${idSystem} | sku=${u.sku} | ean=${u.gtin} | motivo=${u.reason}`,
    );
  }

  // ─── ProductConfig + SupplierMapping para produtos Tecinco ────────────────

  try {
    if (!skipCrossConfig) {
      await upsertTecincoCrossConfig(det, senderCnpj, "[IMPORT_XML]");
    }
  } catch (err) {
    logDbError(
      "[IMPORT_XML] Falha ao upsert Tecinco cross config",
      err as Error,
      {
        invoiceId: invoice.id,
        idSystem,
      },
    );
  }

  console.log(
    `[IMPORT_XML] ${det.length} item(ns) processado(s) para invoice ${idSystem}`,
  );
}
