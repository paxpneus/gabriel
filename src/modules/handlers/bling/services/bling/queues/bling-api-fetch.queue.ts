import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { ApiFetchRequest, WebhookQueuePayload } from "../bling-webhook.types";
import { blingApi } from "../../../api/bling_api.service";
import { Product, Supplier } from "../../../../../inventory";
import { SupplierMapping } from "../../../../../inventory";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { Invoice, InvoiceItems, UnitBusiness } from "../../../../../warehouse";
import parser from "../../../../../../shared/utils/xml/xml-parser";
import { cleanDocument } from "../../../../../../shared/utils/normalizers/document";

export function extractPartiesFromXml(xml: string) {
  const parsed = parser.parse(xml);

  const nfe =
    parsed?.nfeProc?.NFe?.infNFe ||
    parsed?.procNFe?.NFe?.infNFe ||
    parsed?.NFe?.infNFe;

  const emit = nfe?.emit ?? {};
  const dest = nfe?.dest ?? {};

  const senderCnpj = emit?.CNPJ ?? "";
  const senderName = emit?.xNome ?? "";

  const receiverCnpj = dest?.CNPJ || dest?.CPF || dest?.cnpj || dest?.cpf || "";

  const receiverName = dest?.xNome ?? "";

  return {
    senderCnpj,
    senderName,
    receiverCnpj,
    receiverName,
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
    numeroDocumento?: string;
  };
  loja?: { id: number };
  naturezaOperacao?: { id: number };
  transportador?: { id: number };
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

    if (!blingProduct?.codigo) {
      console.warn(
        `[BLING_API_FETCH] Produto ${apiFetch.blingId} sem SKU na Bling. Ignorado.`,
      );
      return;
    }

    await Product.upsert(
      {
        name: blingProduct.nome,
        id_system: String(blingProduct.id),
        sku: blingProduct.codigo,
        ean: blingProduct.gtin ?? `NO-EAN-${blingProduct.id}`,
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

    // Validação: produto deve estar presente
    if (!ps?.produto?.id) {
      throw new Error(
        `[BLING_API_FETCH] Produto-fornecedor ${apiFetch.blingId} sem produto.id na resposta da API. Retry.`,
      );
    }

    const product = await Product.findOne({
      where: { id_system: String(ps.produto.id) },
    });

    if (!product) {
      console.warn(
        `[BLING_API_FETCH] Produto blingId=${ps.produto.id} não encontrado para supplier mapping. Ignorado.`,
      );
      return;
    }

    let cnpj = ps.fornecedor?.cnpj ?? ps.fornecedor?.cpf ?? "";
    const supplierId = ps.fornecedor?.id ? String(ps.fornecedor.id) : null;

    // 🔥 NOVO: busca no banco primeiro
    if (!cnpj && supplierId) {
      const supplierDb = await Supplier.findOne({
        where: { id_system: supplierId },
      });

      if (supplierDb) {
        cnpj = supplierDb.document;

        console.log(
          `[BLING_API_FETCH] CNPJ encontrado no banco: supplierId=${supplierId}`,
        );
      }
    }

    if (!cnpj && supplierId) {
      try {
        const { data: contatoRes } = await this.api.get<{ data: any }>(
          `/contatos/${supplierId}`,
        );

        const contato = contatoRes.data;

        cnpj = contato?.numeroDocumento;

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

          console.log(
            `[BLING_API_FETCH] Supplier salvo no banco: supplierId=${supplierId}`,
          );
        }
      } catch (error: any) {
        if (error?.response?.status === 404) {
          console.warn(
            `[BLING_API_FETCH] Contato ${supplierId} não existe na Bling. Erro: ${error}`,
          );
          return;
        }

        throw error;
      }
    }

    if (!cnpj) {
      console.warn(
        `[BLING_API_FETCH] Fornecedor ${supplierId} sem CNPJ/CPF. Usando placeholder.`,
      );
    }

    await SupplierMapping.upsert({
      product_id: product.id,
      supplier_cnpj: cnpj || `NO-DOC-${supplierId}`,
      supplier_product_code: ps.codigo ?? "",
    });

    console.log(
      `[BLING_API_FETCH] SupplierMapping atualizado: productId=${product.id}, cnpj=${cnpj}`,
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

    const partial = apiFetch.partialData ?? {};

    // ─── Resolve tipo e status a partir dos dados completos da API ───────────

    const invoiceType: "INCOMING" | "OUTGOING" =
      nf.tipo === 1 ? "INCOMING" : "OUTGOING";

    const invoiceStatus: "OPEN" | "PENDING" | "FINISHED" =
      partial.status === "CANCELLED"
        ? "OPEN" // Bling cancelada → mantemos como OPEN para revisão manual
        : ((partial.status as "OPEN" | "PENDING" | "FINISHED") ?? "PENDING");

    let senderCnpj = nf.emitente?.cnpj ?? "";
    let senderName = nf.emitente?.nome ?? "";
    let receiverCnpj = nf.destinatario?.cnpj ?? nf.destinatario?.cpf ?? "";
    let receiverName = nf.destinatario?.nome ?? "";

    if (nf.xml) {
      try {
        const xmlData = await fetch(nf.xml).then((r) => r.text());
        const extracted = extractPartiesFromXml(xmlData);

        senderCnpj = cleanDocument(extracted.senderCnpj || senderCnpj);
        senderName = extracted.senderName || senderName;
        receiverCnpj = cleanDocument(extracted.receiverCnpj || receiverCnpj);
        receiverName = extracted.receiverName || receiverName;
      } catch (err) {
        console.warn("[XML PARSE ERROR]", err);
      }
    }

    const customerDoc = nf.contato
      ? (nf.destinatario?.cnpj ?? nf.destinatario?.cpf ?? "")
      : "";
    const customerName = nf.contato?.nome ?? nf.destinatario?.nome ?? "";
    const key = nf.chaveAcesso ?? `PENDING-KEY-${nf.id}`;

    const unit_business = await UnitBusiness.findOne({
      where: { id_system: String(nf?.loja?.id) },
    });

    if (!unit_business) {
      console.log("[ERRO NO MAPEAMENTO DE NFE] - Loja não encontrada");
      throw new Error("[ERRO NO MAPEAMENTO DE NFE] - Loja não encontrada");
    }

    const [invoice] = await Invoice.upsert({
      id_system: String(nf.id),
      customer_name: customerName,
      customer_document: customerDoc,
      key,
      type: invoiceType,
      status: invoiceStatus,
      sender_cnpj: senderCnpj,
      sender_name: senderName,
      receiver_cnpj: receiverCnpj,
      receiver_name: receiverName,
      unit_business_id: unit_business.id,
      danfe_path: nf.linkPDF,
      xml_path: nf.xml,
      // unit_business_id: deve ser resolvido via loja → unit_business conforme regra de negócio
      // transporter_id: idem
    });

    console.log(
      `[BLING_API_FETCH] Invoice upsertada: id_system=${nf.id}, key=${key}`,
    );

    // ─── Itens da nota ────────────────────────────────────────────────────────

    if (!nf.itens?.length) return;

    for (const item of nf.itens) {
      const product = await Product.findOne({
        where: { sku: item?.codigo ?? String(item.id) },
      });

      if (!product) {
        console.warn(
          `[BLING_API_FETCH] Produto sku=${item.codigo} não encontrado para InvoiceItem. Pulando.`,
        );
        continue;
      }

      await InvoiceItems.upsert({
        product_id: product.id,
        invoice_id: invoice.id,
        quantity_expected: item.quantidade ?? 0,
        quantity_received: 0,
        status: "PENDING",
      });
    }

    console.log(
      `[BLING_API_FETCH] ${nf.itens?.length} item(ns) upsertado(s) para invoice ${nf.id}`,
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
