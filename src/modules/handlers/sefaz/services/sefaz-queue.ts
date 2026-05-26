// sefaz-distribuicao.queue.ts

import { BlingApiFetchQueue } from "./../../bling/services/bling/queues/bling-api-fetch.queue";
import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { sefazApiService } from "../api/sefaz_api.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import UnitBusiness from "../../../warehouse/unit-business/unit-business.model";
import { SefazDocumento } from "../api/sefaz_api.types";

export type SefazDistribuicaoJobData = Record<string, never>;

const NCM_PERMITIDOS = [
  "40111000",
  "40112000",
  "40113000",
  "40114000",
  "40115000",
  "40116200",
  "40116910",
  "84832000",
  "87082100",
  "87083019",
];

const FILIAIS_ATIVAS = [
  "02316749001220", // Loja 12 - ASSIS
  "02316749001735", // Loja 17 - LONDRINA
  "02316749001573", // Loja 15 - Itu
  "02316749002111", // Loja 21 - CD MG
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SefazDistribuicaoQueue extends BaseQueueService<SefazDistribuicaoJobData> {
  private apiFetchQueue: BlingApiFetchQueue;

  constructor(options: { workless?: boolean } = {}) {
    super("SEFAZ_DISTRIBUICAO", {
      concurrency: 1,
      limiter: { max: 1, duration: 3000 },
      lockDuration: 5 * 60 * 1000,
      workless: options.workless,
    });

    this.apiFetchQueue = new BlingApiFetchQueue({ workless: true });
  }

  private temProdutoRelevante(xml: string): boolean {
    return NCM_PERMITIDOS.some((ncm) => xml.includes(`<NCM>${ncm}</NCM>`));
  }

  private extrairChaveAcesso(xml: string): string | null {
    const match =
      xml.match(/<chNFe>(\d{44})<\/chNFe>/) ??
      xml.match(/<chave>(\d{44})<\/chave>/);
    return match?.[1] ?? null;
  }

  private extrairTpEvento(xml: string): string | null {
    const match = xml.match(/<tpEvento>(\d+)<\/tpEvento>/);
    return match?.[1] ?? null;
  }

  async process(job: Job<SefazDistribuicaoJobData>): Promise<void> {
    console.log(`[SEFAZ] Iniciando consulta de distribuição DFe`);

    const filiais = await UnitBusiness.findAll({
      attributes: ["id", "cnpj", "name", "ult_nsu"],
      where: { cnpj: FILIAIS_ATIVAS },
    });

    console.log(`[SEFAZ] ${filiais.length} filial(is) para consultar`);

    for (const filial of filiais) {
      await this.processarFilial(filial);
      await sleep(3000);
    }

    console.log(`[SEFAZ] Consulta finalizada`);
  }

  private async processarFilial(filial: UnitBusiness): Promise<void> {
    const cnpj = filial.cnpj.replace(/\D/g, "");
    const cUF = process.env.SEFAZ_CUF ?? "42";
    const label = filial.name ?? cnpj;

    if (!filial.ult_nsu || filial.ult_nsu === "000000000000000") {
      console.warn(`[SEFAZ] Filial=${label} | ult_nsu zerado — inicializando via consNSU`);
      const maxNSU = await sefazApiService.descobrirMaxNSU(cnpj, cUF);
      await filial.update({ ult_nsu: maxNSU });
      filial.ult_nsu = maxNSU;
      console.log(`[SEFAZ] Filial=${label} | ult_nsu inicializado em ${maxNSU}`);
      return;
    }

    let ultNSU = filial.ult_nsu;
    let hasMore = true;
    let totalDocumentos = 0;

    while (hasMore) {
      let response;

      try {
        response = await sefazApiService.consultarDistribuicao({ cnpj, ultNSU, cUF });
      } catch (err: any) {
        if (err.message?.includes("cStat=656")) {
          console.warn(`[SEFAZ] Filial=${label} | cStat=656 — recuperando cursor via consNSU`);
          const maxNSU = await sefazApiService.descobrirMaxNSU(cnpj, cUF);
          await filial.update({ ult_nsu: maxNSU });
          console.warn(`[SEFAZ] Filial=${label} | cursor corrigido para ${maxNSU} — tente novamente em 1h`);
          return;
        }
        throw err;
      }

      console.log(
        `[SEFAZ] Filial=${label} | cStat=${response.cStat} | docs=${response.documentos.length} | ultNSU=${response.ultNSU} | maxNSU=${response.maxNSU}`,
      );

      for (const doc of response.documentos) {
        try {
          const processado = await this.processarDocumento(doc, cnpj, label);
          if (processado) totalDocumentos++;
        } catch (err) {
          console.warn(`[SEFAZ] NSU=${doc.NSU} falhou:`, err);
        }
        // rate limit entre documentos
        await sleep(1500);
      }

      await filial.update({ ult_nsu: response.ultNSU });
      ultNSU = response.ultNSU;
      hasMore = response.ultNSU !== response.maxNSU;

      // rate limit entre páginas
      if (hasMore) await sleep(2000);
    }

    console.log(`[SEFAZ] Filial=${label} | ${totalDocumentos} doc(s) processado(s) | ultNSU=${ultNSU}`);
  }

  private async processarDocumento(
    doc: SefazDocumento,
    cnpj: string,
    label: string,
  ): Promise<boolean> {
    const xml = sefazApiService.decodeDocumento(doc.xmlBase64);

    // XML completo — processa direto
    if (doc.schema.startsWith("procNFe")) {
      if (!this.temProdutoRelevante(xml)) {
        console.log(`[SEFAZ] NSU=${doc.NSU} procNFe ignorado — sem produtos relevantes`);
        return false;
      }
      await this.apiFetchQueue.upsertInvoiceFromXml(xml);
      console.log(`[SEFAZ] NSU=${doc.NSU} procNFe processado`);
      return true;
    }

    // Resumo — busca XML completo via consChNFe
    if (doc.schema.startsWith("resNFe")) {
      const chave = this.extrairChaveAcesso(xml);
      if (!chave) {
        console.warn(`[SEFAZ] NSU=${doc.NSU} resNFe sem chaveAcesso — ignorado`);
        return false;
      }

      console.log(`[SEFAZ] NSU=${doc.NSU} resNFe → buscando XML completo chave=${chave}`);

      // pausa extra — consChNFe é mais limitado
      await sleep(2000);

      const xmlCompleto = await sefazApiService.consultarPorChave(chave, cnpj);

      if (!this.temProdutoRelevante(xmlCompleto)) {
        console.log(`[SEFAZ] NSU=${doc.NSU} resNFe ignorado — sem produtos relevantes`);
        return false;
      }

      await this.apiFetchQueue.upsertInvoiceFromXml(xmlCompleto);
      console.log(`[SEFAZ] NSU=${doc.NSU} resNFe processado com XML completo`);
      return true;
    }

    // Cancelamento
    if (doc.schema.startsWith("procEventoNFe")) {
      const tpEvento = this.extrairTpEvento(xml);
      if (tpEvento === "110111") {
        const chave = this.extrairChaveAcesso(xml);
        console.log(`[SEFAZ] NSU=${doc.NSU} cancelamento chave=${chave}`);
        await this.apiFetchQueue.upsertInvoiceFromXml(xml, 'CANCELLED');
        return true;
      }
      console.log(`[SEFAZ] NSU=${doc.NSU} evento tpEvento=${tpEvento} ignorado`);
      return false;
    }

    console.log(`[SEFAZ] NSU=${doc.NSU} schema=${doc.schema} ignorado`);
    return false;
  }

  protected override onFailed(
    job: Job<SefazDistribuicaoJobData>,
    error: Error,
  ): void {
    alertService.sendAlert({
      severity: "CRITICAL",
      title: "SEFAZ — distribuição DFe falhou após todas tentativas",
      message: `Erro: ${error.message}`,
    });
  }
}