import { Op } from "sequelize";
import dayjs from "dayjs";
import { PDFDocument } from "pdf-lib";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import sequelize from "../../../../../../../config/sequelize";
import { APP_TIMEZONE } from "../../../../../../../shared/utils/normalizers/date";
import { decryptXml, isEncrypted } from "../../../../../../../shared/utils/xml/xml-cipher";
import { generateDanfePdfBuffer } from "../../../../../../../shared/utils/xml/danfe-generator";
import Invoice from "../../invoice.model";
import invoiceDocumentsRepository, { InvoiceDocumentsRepository } from "../repositories/documents.repository";
import { internalInvoiceScopeService, invoiceAttributesRepository, invoiceXmlRepository, normalizeInvoiceNumber } from "../../shared";
import { extractCorrectionLetterIdentification } from "../helpers/correction-letter";
import { correctionLetterAttachedAudit } from "../helpers/audit";
import uploaderService from "../../../../../../handlers/uploader/services/uploader.service";
import tempFileService from "../../../../../../handlers/temp-file/temp-file.service";
import {
  isTempFileSentinelPath,
  extractTempFileId,
  buildTempFileSentinelPath,
  resolveDeleteTarget,
} from "../../../../../../handlers/temp-file/temp-file.constants";
import uploaderQueue from "../../../../../../handlers/uploader/uploader.queue";
import auditLogService from "../../../../../../global/audit-logs/audit-log.service";
import pdvSalesRequestService from "../../../../../../sales/pdv-management/sales-request/pdv-sales-request.service";

// Pasta da nuvem das cartas de correção (arquivo carta_correcao_<nº da nota>_<data>.pdf).
const CORRECTION_LETTER_DIRECTORY = "/cartas-correcao";

// Documentos da nota: DANFE, lote de XMLs e carta de correção.
export class InvoiceDocumentsService extends BaseService<Invoice, InvoiceDocumentsRepository> {
  constructor() {
    super(invoiceDocumentsRepository);
  }

  // Carta de correção (CC-e em PDF) da nota emitida por engano pra logística própria (CD 12/17) quando era por
  // transportadora: confere chave + número lidos do PDF contra a nota e a libera sem transferência no lote/romaneio.
  async attachCorrectionLetter(id: string, file: { buffer: Buffer; mimeType: string }, userId: string | null) {
    if (file.mimeType !== "application/pdf") throw new Error("Envie a carta de correção em PDF.");
    // Nota interna só pelos fluxos de internal/.
    await internalInvoiceScopeService.assertNotInternalInvoices({ id });

    const letter = await extractCorrectionLetterIdentification(file.buffer);
    if (!letter.isCorrectionLetter) throw new Error("O arquivo enviado não é uma carta de correção.");
    if (!letter.accessKey || !letter.number) {
      throw new Error("Não foi possível ler a chave de acesso e o número da nota na carta de correção.");
    }

    // A nota da carta é achada pela chave de acesso e precisa ser a mesma da rota, com o mesmo número.
    const [invoice, letterInvoice] = await Promise.all([
      this.findById(id, { attributes: ["id", "number_system"] }),
      this.findOne({ where: { xml_key: letter.accessKey }, attributes: ["id", "number_system"] }),
    ]);
    if (!invoice) throw new Error("Nota fiscal não encontrada");
    if (!letterInvoice) {
      throw new Error(`A nota da carta de correção (nº ${letter.number}) não foi encontrada no sistema.`);
    }
    if (letterInvoice.id !== invoice.id) {
      throw new Error(
        `A carta de correção enviada é da nota ${letterInvoice.number_system}, não da nota ${invoice.number_system}.`,
      );
    }
    if (normalizeInvoiceNumber(letter.number) !== normalizeInvoiceNumber(invoice.number_system ?? "")) {
      throw new Error(
        `O número da nota na carta de correção (${letter.number}) não confere com a nota ${invoice.number_system}.`,
      );
    }

    const auditFields = ["correction_letter_path", "correction_letter_attached_at"];
    const { tempFileId, previousPath } = await sequelize.transaction(async (t) => {
      const before = await this.findById(id, { attributes: auditFields, lock: t.LOCK.UPDATE, transaction: t });
      // Mesmo staging do DANFE: o arquivo sobe em background e o finalizer troca o temp:// pelo path real.
      const tempFile = await tempFileService.create(
        {
          buffer: file.buffer,
          mime_type: file.mimeType,
          original_filename: `carta_correcao_${invoice.number_system}_${dayjs().tz(APP_TIMEZONE).format("DD-MM-YYYY_HH-mm-ss")}.pdf`,
          upload_directory: CORRECTION_LETTER_DIRECTORY,
          preserve_filename: true,
          entity_type: "INVOICE_CORRECTION_LETTER",
          entity_id: id,
        },
        { transaction: t },
      );
      await this.repository.bulkUpdate(
        { correction_letter_path: buildTempFileSentinelPath(tempFile.id), correction_letter_attached_at: new Date() },
        { where: { id }, transaction: t },
      );
      const after = await this.findById(id, { attributes: auditFields, transaction: t });
      await auditLogService.record(
        correctionLetterAttachedAudit({
          userId,
          invoiceId: id,
          invoiceNumber: invoice.number_system ?? "",
          before: before!,
          after: after!,
        }),
        t,
      );
      return { tempFileId: tempFile.id, previousPath: before?.correction_letter_path ?? null };
    });

    // Depois do commit: o job precisa achar o temp_files. Carta substituída → apaga a anterior (staging ou nuvem).
    await uploaderQueue.enqueueUpload(tempFileId, "INVOICE_CORRECTION_LETTER");
    if (previousPath) {
      await uploaderQueue.enqueueDelete(resolveDeleteTarget(previousPath), "INVOICE_CORRECTION_LETTER");
    }

    return this.findById(id, { attributes: ["id", "number_system", ...auditFields] });
  }

  // PDF da carta de correção: da nuvem, ou do staging (temp_files) enquanto o upload não terminou. Não há como gerar a carta.
  async getCorrectionLetterFile(id: string): Promise<{ buffer: Buffer; filename: string }> {
    // Nota interna só pelos fluxos de internal/.
    await internalInvoiceScopeService.assertNotInternalInvoices({ id });
    const invoice = await this.findById(id, { attributes: ["id", "correction_letter_path"] });
    if (!invoice) throw new Error("Nota fiscal não encontrada");
    let path = invoice.correction_letter_path;
    if (!path) throw new Error("A nota não tem carta de correção anexada.");

    if (isTempFileSentinelPath(path)) {
      const tempFile = await tempFileService.findById(extractTempFileId(path), {
        attributes: ["id", "buffer", "original_filename"],
      });
      if (tempFile) return { buffer: tempFile.buffer, filename: tempFile.original_filename };

      // Corrida: o upload terminou (e apagou o staging) entre as leituras — relê o path já real.
      const refreshed = await this.findById(id, { attributes: ["id", "correction_letter_path"] });
      path = refreshed?.correction_letter_path ?? null;
      if (!path || isTempFileSentinelPath(path)) {
        throw new Error("A carta de correção ainda não está disponível. Tente novamente em instantes.");
      }
    }

    return { buffer: await uploaderService.getFile(path), filename: path.split("/").pop()! };
  }


  async getDanfeBuffer(id: string): Promise<Buffer> {
    // Nota interna não tem DANFE (só pelos fluxos de internal/).
    await internalInvoiceScopeService.assertNotInternalInvoices({ id });
    const invoice = await this.repository.findById(id, {
      attributes: ["id", "danfe_path", "xml_path"],
    });
    if (!invoice) throw new Error("Nota fiscal não encontrada");

    return this.resolveDanfeBuffer(invoice);
  }

  // DANFE já salvo (Bling entrega pronto, Tecinco gera na criação) serve o arquivo
  // direto; sem danfe_path, gera na hora a partir do XML. Leitura pura, nunca grava danfe_path.
  private async resolveDanfeBuffer(
    invoice: Pick<Invoice, "id" | "danfe_path" | "xml_path">,
  ): Promise<Buffer> {
    if (invoice.danfe_path) {
      // Link hospedado externamente (ex.: linkPDF da nota de venda Bling,
      // salvo direto no vínculo rápido do pedido — ver
      // bling-order.service.ts::resolveInvoiceId) — busca direto por HTTP,
      // nunca via uploaderService (que anexaria a credencial do storage
      // interno numa requisição pra fora).
      if (invoice.danfe_path.startsWith("http")) {
        const response = await fetch(invoice.danfe_path);
        if (!response.ok) {
          throw new Error(
            `Falha ao baixar DANFE externo: ${response.status}`,
          );
        }
        return Buffer.from(await response.arrayBuffer());
      }

      // Anexo em staging (vínculo rápido de nota de transferência — ver
      // pdv-sales-request.service.ts::attachTransferInvoice) cujo upload
      // real pro storage ainda não terminou — lê o buffer direto de
      // temp_files, mesmo padrão de getReceiptBuffer.
      if (isTempFileSentinelPath(invoice.danfe_path)) {
        const tempFile = await tempFileService.findById(
          extractTempFileId(invoice.danfe_path),
          { attributes: ["id", "buffer"] },
        );
        if (tempFile) return tempFile.buffer;

        // corrida: o job de upload terminou entre a leitura acima e agora —
        // recarrega o path já atualizado.
        const refreshed = await this.repository.findById(invoice.id, {
          attributes: ["id", "danfe_path"],
        });
        if (
          !refreshed?.danfe_path ||
          isTempFileSentinelPath(refreshed.danfe_path)
        ) {
          throw new Error("DANFE ainda não disponível, tente novamente");
        }
        return uploaderService.getFile(refreshed.danfe_path);
      }

      return uploaderService.getFile(invoice.danfe_path);
    }

    const xml = invoice.xml_path;
    if (!xml || xml.startsWith("http")) {
      throw new Error("XML da nota não disponível para gerar o DANFE");
    }

    return generateDanfePdfBuffer(isEncrypted(xml) ? decryptXml(xml) : xml);
  }

  // Marca danfe_printed (só com unitBusinessId) na mesma transação da geração: qualquer erro reverte a marcação.
  async getDanfeBatch(
    invoiceIds: string[],
    unitBusinessId?: string,
  ): Promise<Buffer | null> {
    // Nota interna não tem DANFE (só pelos fluxos de internal/).
    await internalInvoiceScopeService.assertNotInternalInvoices({ id: invoiceIds });
    const pdf = await sequelize.transaction(async (transaction) => {
      const invoices = await this.repository.findAll({
        where: { id: { [Op.in]: invoiceIds } },
        attributes: ["id", "xml_path", "danfe_path"],
        transaction,
      });
      if (!invoices.length) return null;

      if (unitBusinessId) {
        await invoiceAttributesRepository.updateWithAttributes(
          invoiceIds,
          unitBusinessId,
          { danfe_printed: true },
          undefined,
          transaction,
        );
      }

      // TEMPORÁRIO: com XML sempre gera do XML (não usa o danfe_path da nuvem); depois volta a usar resolveDanfeBuffer(invoice).
      // Sem XML (provisória do PDV, ainda sem import) usa o DANFE salvo — senão a nota saía em branco.
      const invoicePdfs = await Promise.all(
        invoices.map(async (invoice) => {
          try {
            return await PDFDocument.load(
              await this.resolveDanfeBuffer({
                id: invoice.id,
                danfe_path: invoice.xml_path ? undefined : invoice.danfe_path,
                xml_path: invoice.xml_path,
              }),
            );
          } catch (err: any) {
            console.error(`[DANFE] Erro invoice ${invoice.id}:`, err.message);
            return null;
          }
        }),
      );

      const mergedPdf = await PDFDocument.create();

      for (const invoicePdf of invoicePdfs) {
        if (!invoicePdf) continue;

        const pages = await mergedPdf.copyPages(
          invoicePdf,
          invoicePdf.getPageIndices(),
        );
        pages.forEach((p) => mergedPdf.addPage(p));
      }

      // Nenhuma nota gerou DANFE: erro em vez de PDF em branco (e desfaz o danfe_printed).
      if (!mergedPdf.getPageCount()) {
        throw new Error("DANFE indisponível para as notas informadas (sem XML nem DANFE salvo)");
      }

      return Buffer.from(await mergedPdf.save());
    });

    // Fora da transação: front do PDV refaz o fetch e precisa ver danfe_printed já commitado.
    if (pdf && unitBusinessId) {
      await pdvSalesRequestService.notifyChangedBySaleInvoiceIds(invoiceIds);
    }

    return pdf;
  }


  async *streamXmlEntries(
    ids: string[],
    chunkSize = 100,
  ): AsyncGenerator<{ filename: string; xml: string }> {
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunkIds = ids.slice(i, i + chunkSize);
      const invoices = await invoiceXmlRepository.findXmlPathsByIds(chunkIds);

      for (const invoice of invoices) {
        let xml = invoice.xml_path;

        if (!xml || xml.startsWith("http")) {
          console.warn(
            `[XML BATCH] Invoice ${invoice.id}: XML não disponível, pulando.`,
          );
          continue;
        }

        try {
          if (isEncrypted(xml)) xml = decryptXml(xml);
          const filename = `nfe-${invoice.number_system ?? invoice.id}.xml`;
          yield { filename, xml };
        } catch (err: any) {
          console.error(`[XML BATCH] Erro invoice ${invoice.id}:`, err.message);
        }
      }
    }
  }
}

export default new InvoiceDocumentsService();
