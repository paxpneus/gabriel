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

  "02316749002111", // Loja 21 - CD MG
];

const FILIAIS_CUF: Record<string, string> = {

  "02316749002111": "31", // Loja 21 - CD MG
};

// FIX B: Tempo de espera após receber cStat=656 (Consumo Indevido).
// Disparar nova requisição imediatamente piora o score do IP na SEFAZ.
// Aguardamos 60 minutos antes de tentar novamente na próxima execução
// do job — por isso simplesmente retornamos após gravar o cursor corrigido.
const SLEEP_APOS_656_MS = 0; // sem sleep aqui — o retorno já encerra o loop da filial

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

  // FIX D: temProdutoRelevante só deve ser chamado para procNFe.
  // resNFe não contém lista de produtos — a checagem aqui seria sempre falsa.
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
    const cUF = FILIAIS_CUF[cnpj] ?? process.env.SEFAZ_CUF ?? "42";
    const label = filial.name ?? cnpj;

    if (!filial.ult_nsu || filial.ult_nsu === "000000000000000") {
      console.warn(
        `[SEFAZ] Filial=${label} | ult_nsu zerado — inicializando via consNSU`,
      );
      const maxNSU = await sefazApiService.descobrirMaxNSU(cnpj, cUF);
      await filial.update({ ult_nsu: maxNSU });
      filial.ult_nsu = maxNSU;
      console.log(
        `[SEFAZ] Filial=${label} | ult_nsu inicializado em ${maxNSU}`,
      );
      return;
    }

    let ultNSU = filial.ult_nsu;
    let hasMore = true;
    let totalDocumentos = 0;

    while (hasMore) {
      let response;

      try {
        response = await sefazApiService.consultarDistribuicao({
          cnpj,
          ultNSU,
          cUF,
        });
      } catch (err: any) {
        // FIX B: ao receber 656 (Consumo Indevido), atualizamos o cursor para o
        // maxNSU atual e encerramos o processamento desta filial imediatamente.
        // NÃO fazemos nova requisição — a execução seguinte do job (agendada
        // com intervalo de pelo menos 1h) retomará do cursor correto.
        if (err.message?.includes("cStat=656")) {
          console.warn(
            `[SEFAZ] Filial=${label} | cStat=656 — recuperando cursor via consNSU`,
          );
          const maxNSU = await sefazApiService.descobrirMaxNSU(cnpj, cUF);
          await filial.update({ ult_nsu: maxNSU });
          console.warn(
            `[SEFAZ] Filial=${label} | cursor corrigido para ${maxNSU} — aguardando próxima execução (mín. 1h)`,
          );
          // Encerra o loop desta filial sem disparar nova consulta à SEFAZ
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

    console.log(
      `[SEFAZ] Filial=${label} | ${totalDocumentos} doc(s) processado(s) | ultNSU=${ultNSU}`,
    );
  }

  private async processarDocumento(
    doc: SefazDocumento,
    cnpj: string,
    label: string,
  ): Promise<boolean> {
    const xml = sefazApiService.decodeDocumento(doc.xmlBase64);

    // FIX D: procNFe — XML completo disponível, valida NCMs e processa
    if (doc.schema.startsWith("procNFe")) {
      if (!this.temProdutoRelevante(xml)) {
        console.log(
          `[SEFAZ] NSU=${doc.NSU} procNFe ignorado — sem produtos relevantes`,
        );
        return false;
      }
      await this.apiFetchQueue.upsertInvoiceFromXml(xml);
      console.log(`[SEFAZ] NSU=${doc.NSU} procNFe processado`);
      return true;
    }

    // FIX D: resNFe — XML de resumo (sem lista de produtos).
    // NÃO tentamos baixar o XML completo via consChNFe aqui porque:
    //   1. A SEFAZ retorna Rejeição 632 se a nota não tiver sido manifestada.
    //   2. O XML completo será disponibilizado automaticamente na fila após
    //      a Manifestação do Destinatário (Ciência da Emissão).
    //
    // Fluxo correto:
    //   a) Extraímos e registramos a chave de acesso.
    //   b) Disparamos a fila de Manifestação (Ciência da Emissão).
    //   c) Nas próximas varreduras o loop capturará o procNFe completo.
    if (doc.schema.startsWith("resNFe")) {
      const chave = this.extrairChaveAcesso(xml);
      if (!chave) {
        console.warn(
          `[SEFAZ] NSU=${doc.NSU} resNFe sem chaveAcesso — ignorado`,
        );
        return false;
      }

      console.log(
        `[SEFAZ] NSU=${doc.NSU} resNFe chave=${chave} — registrando e aguardando manifestação`,
      );

      // TODO: persistir `chave` no banco (tabela de pendentes de manifestação)
      // e disparar a fila de Manifestação do Destinatário (Ciência da Emissão).
      // Exemplo:
      //   await sefazManifestacaoQueue.add({ chave, cnpj, tpEvento: "210210" });
      //
      // O procNFe completo chegará nos NSUs seguintes após a manifestação.
      // A checagem de NCM_PERMITIDOS ocorrerá quando o procNFe for processado.

      return false;
    }

    // Cancelamento
    if (doc.schema.startsWith("procEventoNFe")) {
      const tpEvento = this.extrairTpEvento(xml);

      if (tpEvento === "110111") {
        const chave = this.extrairChaveAcesso(xml);
        console.log(`[SEFAZ] NSU=${doc.NSU} cancelamento chave=${chave}`);
        await this.apiFetchQueue.upsertInvoiceFromXml(xml, "CANCELLED");
        return true;
      }

      // Ciência da Operação — tenta buscar o procNFe completo por chave
      if (tpEvento === "210210") {
        const chave = this.extrairChaveAcesso(xml);
        if (!chave) {
          console.warn(
            `[SEFAZ] NSU=${doc.NSU} 210210 sem chaveAcesso — ignorado`,
          );
          return false;
        }

        const xmlCompleto = await sefazApiService.consultarPorChave(
          chave,
          cnpj,
        );
        if (!xmlCompleto) {
          console.log(
            `[SEFAZ] NSU=${doc.NSU} 210210 chave=${chave} — procNFe ainda não disponível`,
          );
          return false;
        }

        if (!this.temProdutoRelevante(xmlCompleto)) {
          console.log(
            `[SEFAZ] NSU=${doc.NSU} 210210 ignorado — sem produtos relevantes`,
          );
          return false;
        }

        await this.apiFetchQueue.upsertInvoiceFromXml(xmlCompleto);
        console.log(
          `[SEFAZ] NSU=${doc.NSU} 210210 procNFe obtido e processado chave=${chave}`,
        );
        return true;
      }

      console.log(
        `[SEFAZ] NSU=${doc.NSU} evento tpEvento=${tpEvento} ignorado`,
      );
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
