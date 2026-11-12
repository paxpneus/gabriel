import { Job, UnrecoverableError } from "bullmq";
import {
  TCAR_INVOICE_XML_UNAVAILABLE,
  TCarUpsertJobPayload,
  TCarUpsertQueue,
} from "./tecinco-api-fetch.queue";
import {
  TCarInvoiceByKeyPayload,
  TCarInvoiceTransferPayload,
  TCarInvoiceXmlPayload,
  TCarNotaFiscalDetail,
} from "../service/tecinco/tecinco.types";
import { ImportJobResult } from "../../../../shared/utils/queues/job-status";
import {
  TCarConferenciaEstoqueService,
  TCarNotaFiscalXmlByChaveComposta,
} from "../service/conferencias-estoque/conferencias-estoque.service";
import { upsertCustomerFromTCar } from "./helpers/customer.helper";
import { getCachedTCarIntegration, getCachedUnitBusinessByNumber } from "./helpers/lookup-cache";
import { cleanDocument } from "../../../../shared/utils/normalizers/document";
import {
  internalInvoiceService,
  invoiceCancellationService,
} from "../../../warehouse/fiscal/invoices/invoice";
import invoiceItemsService from "../../../warehouse/fiscal/invoices/invoice-items/invoice-items.service";
import pdvSalesRequestService from "../../../sales/pdv-management/sales-request/pdv-sales-request.service";

// Nomes de job usados tanto ao enfileirar (tecinco-migration.runner.ts)
// quanto ao checar prioridade aqui — nunca hardcoded nos dois lugares.
export const TCAR_INVOICE_NEW_JOB_NAME = "invoice-new";
export const TCAR_INVOICE_UPDATE_JOB_NAME = "invoice-update";
// Nota interna (série B): jobId invoice-internal-<new|update>-<filial>-<E|S>-<nota>, montado no runner.
export const TCAR_INVOICE_INTERNAL_NEW_JOB_NAME = "invoice-internal-new";
export const TCAR_INVOICE_INTERNAL_UPDATE_JOB_NAME = "invoice-internal-update";

// Prioridades da TCAR_INVOICE: 1 (MANUAL_IMPORT_PRIORITY) fica pro import manual e pro invoice_transfer do PDV, à frente do sync.
export const TCAR_INVOICE_NEW_PRIORITY = 2;
export const TCAR_INVOICE_UPDATE_PRIORITY = 3;

export const TCAR_INVOICE_XML_RETRY_DELAY_MS = 5 * 60 * 1000;
export const TCAR_INVOICE_XML_MAX_ATTEMPTS = 5;
// Prefixo do failedReason — o sync usa pra não reenfileirar essas notas (ver migrateNovasNotasFiscais).
export const TCAR_INVOICE_XML_UNAVAILABLE_FAILURE = "XML indisponível na Tecinco";

/** Processa XMLs de nota em uma fila independente de produtos e clientes. */
export class TCarInvoiceQueue extends TCarUpsertQueue {
  constructor(options: { workless?: boolean } = {}) {
    super(options, "TCAR_INVOICE", 2);
  }

  // Sem priority explícita entra junto do invoice-update, abaixo do invoice-new.
  override async add(
    data: TCarUpsertJobPayload,
    jobId?: string,
    jobOptions?: {
      priority?: number;
      name?: string;
      removeOnComplete?: boolean | { age: number; count?: number };
    },
  ) {
    return super.add(data, jobId, {
      ...jobOptions,
      priority: jobOptions?.priority ?? TCAR_INVOICE_UPDATE_PRIORITY,
    });
  }

  override async process(
    job: Job<TCarUpsertJobPayload>,
  ): Promise<ImportJobResult | void> {
    const { resource, data, branchId } = job.data;

    console.log(`[TCAR_INVOICE] ${resource} | eventId=${job.data.eventId}`);

    switch (resource) {
      case "invoice_xml": {
        const result = await this.processInvoiceXml(
          data as TCarInvoiceXmlPayload,
          branchId,
        );
        // Nota nova sem XML não completa (sairia da janela do sync e nunca mais entraria): reagenda até o máximo, depois failed.
        if (
          result !== TCAR_INVOICE_XML_UNAVAILABLE ||
          job.name !== TCAR_INVOICE_NEW_JOB_NAME
        ) {
          return;
        }
        // retryJobLater não conta como attempt no BullMQ, então o contador fica no próprio job.
        const attempts = (job.data.xmlUnavailableAttempts ?? 0) + 1;
        if (attempts >= TCAR_INVOICE_XML_MAX_ATTEMPTS) {
          throw new UnrecoverableError(
            `${TCAR_INVOICE_XML_UNAVAILABLE_FAILURE} após ${attempts} tentativas`,
          );
        }
        await job.updateData({ ...job.data, xmlUnavailableAttempts: attempts });
        console.warn(
          `[TCAR_INVOICE] XML ainda indisponível — job ${job.id} reagendado em ${TCAR_INVOICE_XML_RETRY_DELAY_MS / 60000}min (tentativa ${attempts}/${TCAR_INVOICE_XML_MAX_ATTEMPTS})`,
        );
        await this.retryJobLater(job, TCAR_INVOICE_XML_RETRY_DELAY_MS);
        return;
      }
      case "invoice_transfer":
        await this.processInvoiceTransfer(
          data as TCarInvoiceTransferPayload,
          branchId,
        );
        return;
      // Import manual por chave de acesso (módulo manual-import) — o retorno vira o returnvalue do job.
      case "invoice_by_key": {
        if (!branchId) {
          throw new UnrecoverableError("invoice_by_key sem branchId");
        }
        const { numero, chaveAcesso } = data as TCarInvoiceByKeyPayload;
        return this.upsertInvoiceFromTecinco(numero, chaveAcesso, branchId);
      }
      case "invoice_internal":
        await this.processInternalInvoice(data as TCarInvoiceXmlPayload, branchId);
        return;
      default:
        console.warn(`[TCAR_INVOICE] Resource não suportado: ${resource}`);
    }
  }

  // Nota interna (série B, sem XML): grava pelo detalhe da chave composta; depois a mesma sequência pós-upsert do invoice-xml.ts.
  private async processInternalInvoice(
    data: TCarInvoiceXmlPayload,
    branchId?: number,
  ): Promise<void> {
    if (!branchId) {
      console.warn("[TCAR_INVOICE] invoice_internal sem branchId — ignorado");
      return;
    }
    const { numero, entrada_saida, ...chaveComposta } = data;
    const logPrefix = `[TCAR_INVOICE] invoice_internal numero=${numero} branchId=${branchId}`;

    let detail: TCarNotaFiscalDetail | null = null;
    try {
      const response = await new TCarConferenciaEstoqueService().getNotaFiscal(
        numero,
        branchId,
        chaveComposta as TCarNotaFiscalXmlByChaveComposta,
      );
      detail = response?.data ?? response ?? null;
    } catch (err: any) {
      if (err?.response?.status === 404) {
        console.warn(`${logPrefix} — nota não encontrada na Tecinco (404), ignorada`);
        return;
      }
      throw err;
    }

    const itens = detail?.itens ?? [];
    if (!detail || !itens.length) {
      console.warn(`${logPrefix} — nota sem itens retornados, não processada`);
      return;
    }

    // Falha no customer não derruba os itens (mesmo tratamento do processInvoiceXml).
    const clnCodigo = detail.cliente?.codigo ?? data.cln_codigo;
    let customerUpsert: Promise<unknown> = Promise.resolve();
    if (clnCodigo) {
      customerUpsert = upsertCustomerFromTCar(branchId, clnCodigo, logPrefix).catch((err: any) =>
        console.error(`${logPrefix} — falha ao upsertar customer: ${err?.message ?? err}`),
      );
    }
    const [, ensured, branchUnitBusiness, integration] = await Promise.all([
      customerUpsert,
      this.ensureProductsFromInvoiceItems(itens, branchId),
      getCachedUnitBusinessByNumber(String(branchId).padStart(2, "0")),
      getCachedTCarIntegration(),
    ]);

    // Mesma regra de nota ignorada do processInvoiceXml (item sem código / fora dos grupos de pneu).
    if (!ensured.operationalItems.length && !ensured.unmappedItems.length) {
      console.warn(`${logPrefix} — nenhum item de pneu na nota, invoice não processada`);
      return;
    }

    const side = entrada_saida ?? detail.cabecalho?.entrada_saida;
    const branch = {
      cnpj: cleanDocument(branchUnitBusiness?.cnpj ?? ""),
      name: detail.filial?.nome ?? branchUnitBusiness?.name ?? "",
    };
    const counterparty = {
      cnpj: cleanDocument(detail.cliente?.cnpj_cpf ?? ""),
      name: detail.cliente?.nome ?? "",
    };
    // Sem os 2 CNPJs não há id_system canônico (emitente + número) nem as unit businesses da transferência.
    if (!branch.cnpj || !counterparty.cnpj || (side !== "E" && side !== "S")) {
      console.warn(
        `${logPrefix} — filial/cliente sem CNPJ ou entrada_saida "${side}" inválido, nota interna não gravada`,
      );
      return;
    }

    // S: a filial emite pro cliente; E: o cliente (outra loja) emite pra filial.
    let sender = branch;
    let receiver = counterparty;
    if (side === "E") {
      sender = counterparty;
      receiver = branch;
    }

    const seqCancelamento = String(detail.chave?.seq_cancelamento ?? data.seq_cancelamento ?? "0").trim();
    const cancelled =
      [detail.cabecalho?.situacao, detail.fiscal?.situacao_nfe].some(
        (situacao) => String(situacao ?? "").trim().toUpperCase() === "C",
      ) ||
      (seqCancelamento !== "" && seqCancelamento !== "0");

    const invoiceId = await internalInvoiceService.upsertInternalInvoice({
      detail,
      numero: String(numero),
      invoiceType: side === "S" ? "OUTGOING" : "INCOMING",
      sender,
      receiver,
      integrationsId: integration.id,
      operationalItems: ensured.operationalItems,
      unmappedItems: ensured.unmappedItems,
      cancelled,
    });

    if (cancelled) {
      await invoiceCancellationService.cancelInvoice(invoiceId);
      await pdvSalesRequestService.handleInvoiceCancelled(invoiceId);
    }
    await pdvSalesRequestService.syncCriticalErrorByInvoiceIds([invoiceId]);
    await invoiceItemsService.syncBatchesByInvoiceIds([invoiceId]);
    console.log(`${logPrefix} — nota interna upsertada`);
  }

  // Nota sem XML esgotada é esperada (fica registrada como failed no Redis) — sem alerta por email.
  protected override onFailed(job: Job<TCarUpsertJobPayload>, error: Error): void {
    if (error.message.startsWith(TCAR_INVOICE_XML_UNAVAILABLE_FAILURE)) return;
    super.onFailed(job, error);
  }
}
