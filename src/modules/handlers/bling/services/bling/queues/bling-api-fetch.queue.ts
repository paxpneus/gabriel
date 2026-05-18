import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { ApiFetchRequest, WebhookQueuePayload } from "../bling-webhook.types";
import { blingApi, getBlingIntegration } from "../../../api/bling_api.service";
import { Product, Supplier } from "../../../../../inventory";
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

export function extractPartiesFromXml(xml: string) {
  const parsed = parser.parse(xml);

  const nfe =
    parsed?.nfeProc?.NFe?.infNFe ||
    parsed?.procNFe?.NFe?.infNFe ||
    parsed?.NFe?.infNFe;

   const refNFeMatch = xml.match(/<refNFe>(\d{44})<\/refNFe>/);
    const refNfeResult = refNFeMatch ? refNFeMatch[1] : null;
    const refNFe = refNfeResult ? Number(refNfeResult.slice(25, 34)) : null

  const emit = nfe?.emit ?? {};
  const dest = nfe?.dest ?? {};
  const transp = nfe?.transp ?? {};

  const senderCnpj = emit?.CNPJ ?? "";
  const senderName = emit?.xNome ?? "";

  const receiverCnpj = dest?.CNPJ || dest?.CPF || dest?.cnpj || dest?.cpf || "";

  const receiverName = dest?.xNome ?? "";

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
    transporterName,
    transporterDocument,
    transporterCity,
    transporterUf,
    refNFe: refNFe !== null ? String(refNFe) : null
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
  gtin?: string; // EAN
  gtinEmbalagem?: string;
  preco: number;
  precoCusto: number;
  precoCompra: number;
  formato?: string;
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
  // Emitente / destinatário para CNPJ sender/receiver
  emitente?: { cnpj?: string; nome?: string };
  destinatario?: { cnpj?: string; cpf?: string; nome?: string };
  xml?: string;
  linkPDF?: string;
}

interface BlingApiInvoiceItem {
  id: number;
  codigo?: string;
  quantidade: number;
  gtin: string | number;
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export class BlingApiFetchQueue extends BaseQueueService<ApiFetchJobPayload> {
  private api: AxiosInstance;

  constructor(options: { workless?: boolean } = {}) {
    super("BLING_API_FETCH", {
      concurrency: 1, // respeita rate limit Bling
      limiter: {
        max: 1, // máximo 3 req/s conforme limite Bling
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
          await existingNoTransporter.update({
            cnpj: NO_TRANSPORTER_DOCUMENT,
          });
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
      ? (await SupplierMapping.findOne({
          where: {
            supplier_product_code: supplierProductCode,
            supplier_cnpj: cleanSupplierCnpj,
          },
          order: [["updatedAt", "DESC"]],
        })) ??
        (await SupplierMapping.findOne({
          where: { supplier_product_code: supplierProductCode },
          order: [["updatedAt", "DESC"]],
        }))
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
          await this.fetchAndUpsertProductSupplier(apiFetch);
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

  /**
   * Busca o produto completo na Bling (inclui EAN/GTIN) e complementa o registro.
   */
  private async fetchAndUpsertProduct(
    apiFetch: ApiFetchRequest,
  ): Promise<void> {
    const { data } = await this.api.get<{ data: BlingApiProduct }>(
      `/produtos/${apiFetch.blingId}`,
    );

    const blingProduct = data.data;

    await Product.upsert(
      {
        name: blingProduct.nome,
        id_system: String(blingProduct.id),
        sku: blingProduct.codigo,
        ean: blingProduct.gtin ?? `NO-EAN-${blingProduct.id}`,
        ean_tribut: blingProduct.gtinEmbalagem ?? `NO-EAN-${blingProduct.id}`,
        price: blingProduct.precoCusto,
        type: blingProduct.formato === "E" ? "KIT" : "UNIT",
      },
      { conflictFields: ["id_system"] },
    );

    console.log(
      `[BLING_API_FETCH] Produto ${blingProduct.codigo} complementado com EAN=${blingProduct.gtin ?? "N/A"}`,
    );
  }

  /**
   * Busca o produto-fornecedor na Bling para obter o CNPJ do fornecedor
   * e atualiza o SupplierMapping.
   */

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

    // 1. Tenta resolver CNPJ pelo banco
    if (!cnpj && supplierId) {
      const supplierDb = await Supplier.findOne({
        where: { id_system: supplierId },
      });
      if (supplierDb?.document && !supplierDb.document.startsWith("PENDING-")) {
        cnpj = supplierDb.document;
      }
    }

    // 2. Tenta resolver CNPJ pela API Bling
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
          return; // sem CNPJ e sem contato → não há o que salvar
        }
        throw error;
      }
    }

    // 3. Sem CNPJ resolvível → aborta sem criar registro duplicado
    if (!cnpj) {
      console.warn(
        `[BLING_API_FETCH] Fornecedor ${supplierId} sem CNPJ/CPF resolvível. SupplierMapping não atualizado.`,
      );
      return; // ← era aqui que entrava NO-DOC-null e causava o conflito
    }

    const cleanCnpj = cleanDocument(cnpj); // garante formatação consistente

    // 4. Atualiza o registro existente (criado pelo DirectUpsert com PENDING-)
    //    ou cria se por algum motivo não existir ainda
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

  /**
   * Busca a nota fiscal completa na Bling e persiste Invoice + InvoiceItems.
   * Endpoint difere entre NF-e e NFC-e.
   */
  private async fetchAndUpsertInvoice(
    apiFetch: ApiFetchRequest,
    type: "NF-e" | "NFC-e",
  ): Promise<void> {
    // Import dinâmico para evitar dependências circulares

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

    const partial = apiFetch.partialData ?? {};
    const emittedAt = parseBlingDate(
      nf.dataOperacao ?? nf.dataEmissao ?? invoiceReferenceDate.toISOString(),
    );

    // ─── Resolve tipo e status a partir dos dados completos da API ───────────

    const invoiceType: "INCOMING" | "OUTGOING" =
      nf.tipo === 0 ? "INCOMING" : "OUTGOING";

    const existingInvoice = await Invoice.findOne({
      where: { id_system: String(nf.id) },
      attributes: ["status"],
    });

    const invoiceStatus: "OPEN" | "PENDING" | "FINISHED" =
      partial.status === "CANCELLED"
        ? "OPEN" // Bling cancelada → mantemos como OPEN para revisão manual
        : ((partial.status as "OPEN" | "PENDING" | "FINISHED") ?? "PENDING");

    const incomingStatus = existingInvoice?.status ?? "WAITING_SCHEDULE_SALES";

    const encryptedKey = nf.chaveAcesso ? nf.chaveAcesso : null;

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

    if (nf.xml) {
      try {
        const text = await fetch(nf.xml).then((r) => r.text());
        if (text && text.trim().length > 0) {
          xmlContent = text; // só atribui se vier conteúdo real
          const extracted = extractPartiesFromXml(xmlContent);
          senderCnpj = cleanDocument(extracted.senderCnpj || senderCnpj);
          senderName = extracted.senderName || senderName;
          receiverCnpj = cleanDocument(extracted.receiverCnpj || receiverCnpj);
          receiverName = extracted.receiverName || receiverName;
          transporter_name = extracted.transporterName;
          transporter_document = extracted.transporterDocument;
          transporter_city = extracted.transporterCity;
          transporter_uf = extracted.transporterUf;
          nfeRef = extracted.refNFe
        }
      } catch (err) {
        console.warn("[XML PARSE ERROR]", err);
      }
    }

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
      store_id = await Store.findOne({
        where: { name: "Outros" },
      });
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
        xml_path: xmlContent ? encryptXml(xmlContent!) : null,
        xml_key: encryptedKey,
        emitted_at: emittedAt,
        number_system: String(nf.numero),
        integrations_id: integration.id,
        store_id: store_id!.id ?? null,
        transporter_id: transporter?.id ?? null,
        transporter_document: transporter_document ?? null,
        transporter_name: transporter_name ?? null,
        description: nfeRef ? `REF: ${nfeRef}` : null
      },
      { conflictFields: ["id_system"] },
    );

    console.log(
      `[BLING_API_FETCH] Invoice upsertada: id_system=${nf.id}, key=${key}`,
    );

    // ─── Itens da nota ────────────────────────────────────────────────────────

    // ─── Itens da nota ────────────────────────────────────────────────────────────

    if (!nf.itens?.length) return;

    // ─── 1. Primeiro loop: resolve produtos e acumula quantidades ─────────────
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
    ...(item.gtin 
      ? { ean: String(item.gtin) } 
      : { sku: sku ?? null } 
    ),
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

      // Acumula — garante soma correta se vier duplicado no XML
      const current = quantityByProduct.get(String(product.id)) ?? 0;
      quantityByProduct.set(
        String(product.id),
        current + (item.quantidade ?? 0),
      );
    }

    // ─── 2. Segundo loop: persiste InvoiceItems já consolidados ──────────────
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

    console.log(
      `[BLING_API_FETCH] ${nf.itens?.length} item(ns) upsertado(s) para invoice ${nf.id}`,
    );

    // ─── Sincroniza batch se a invoice já pertencer a um ─────────────────────────

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

        if (existingBatchItem) continue; // já existe → não toca

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
  async upsertInvoiceFromXml(xmlContent: string): Promise<void> {
    const parsed = parser.parse(xmlContent);

    const nfe =
      parsed?.nfeProc?.NFe?.infNFe ||
      parsed?.procNFe?.NFe?.infNFe ||
      parsed?.NFe?.infNFe;

    if (!nfe) {
      throw new Error("XML inválido: estrutura de NF-e não reconhecida");
    }

    const ide = nfe.ide ?? {};
    const emit = nfe.emit ?? {};
    const dest = nfe.dest ?? {};
    const transp = nfe.transp ?? {};
    const det = nfe.det ? (Array.isArray(nfe.det) ? nfe.det : [nfe.det]) : [];

    // ─── Chave de acesso ─────────────────────────────────────────────────────

    // Está no atributo Id do infNFe: "NFe35250..." → remove prefixo "NFe"
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

    // ─── Tipo: tpNF 0=entrada, 1=saída ──────────────────────────────────────

    const senderUnit = await UnitBusiness.findOne({
      where: { cnpj: senderCnpj },
    });

    // define tipo baseado nisso
    const invoiceType: "INCOMING" | "OUTGOING" = senderUnit
      ? "OUTGOING"
      : "INCOMING";

    // ─── Infra ───────────────────────────────────────────────────────────────

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

    // CNPJ do destinatário como customer_document (ajuste se precisar)
    const customerDocument = receiverCnpj;
    const customerName = receiverName;

    // ─── Upsert Invoice ──────────────────────────────────────────────────────

    const existingInvoice = await Invoice.findOne({
      where: { id_system: idSystem },
      attributes: ["status"],
    });

    const incomingStatus = existingInvoice?.status ?? "WAITING_SCHEDULE_SALES";

    const store = await Store.findOne({ where: { name: "Outros" } });

    const [invoice] = await Invoice.upsert(
      {
        id_system: idSystem,
        customer_name: customerName,
        customer_document: customerDocument,
        type: invoiceType,
        status: invoiceType === "OUTGOING" ? "PENDING" : incomingStatus,
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
        store_id: store?.id ?? "",
        transporter_id: transporter?.id ?? null,
        transporter_document: transporterDocument,
        transporter_name: transporterName,
        description: nfeRef ? `REF: ${nfeRef}` : null
      },
      { conflictFields: ["id_system"] },
    );

    console.log(invoice);

    console.log(`[IMPORT_XML] Invoice upsertada: id_system=${idSystem}`);

    // ─── Itens ───────────────────────────────────────────────────────────────

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
    ...(item.gtin 
      ? { ean: String(item.gtin) } 
      : { sku: sku ?? null }  
    ),
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
