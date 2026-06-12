// src/modules/fiscal/sefaz/queues/sefaz-distribuicao.queue.ts

import { BlingApiFetchQueue } from "./../../bling/services/bling/queues/bling-api-fetch.queue";
import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { sefazApiService } from "../api/sefaz_api.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import UnitBusiness from "../../../warehouse/unit-business/unit-business.model";
import { SefazDocumento } from "../api/sefaz_api.types";
import { nfeManifestacaoService } from "./nfe-manifestation";

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

// cStats que indicam que o XML da NF-e ainda não está disponível para consulta
// por chave. Não é erro — o procNFe virá nos próximos NSUs da distribuição.
// 641 = NF-e indisponível para o emitente
// 642 = NF-e indisponível
const CSTAT_XML_INDISPONIVEL = new Set(["641", "642"]);

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

  // ─── Helpers de extração de XML ─────────────────────────────────────────────

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

  /**
   * Extrai o CNPJ do destinatário do XML do resNFe.
   *
   * Busca SOMENTE dentro do bloco <dest> — sem fallback para o restante
   * do documento, para não capturar o CNPJ do emitente por engano.
   *
   * Retorna string com 14 dígitos, ou null se não encontrar.
   */
  private extrairCnpjDestinatario(xml: string): string | null {
    // CNPJ dentro de <dest> (destinatário pessoa jurídica)
    const cnpjMatch = xml.match(
      /<dest>[\s\S]*?<CNPJ>(\d{14})<\/CNPJ>[\s\S]*?<\/dest>/,
    );
    if (cnpjMatch) return cnpjMatch[1];

    // CPF dentro de <dest> (destinatário pessoa física)
    const cpfMatch = xml.match(
      /<dest>[\s\S]*?<CPF>(\d{11})<\/CPF>[\s\S]*?<\/dest>/,
    );
    if (cpfMatch) return cpfMatch[1];

    // Sem bloco <dest> identificável — não faz fallback
    return null;
  }

  // ─── Processo principal ──────────────────────────────────────────────────────

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
        // if (err.message?.includes("cStat=656")) {
        //   console.warn(
        //     `[SEFAZ] Filial=${label} | cStat=656 — recuperando cursor via consNSU`,
        //   );
        //   // const maxNSU = await sefazApiService.descobrirMaxNSU(cnpj, cUF);
        //   // await filial.update({ ult_nsu: maxNSU });
        //   console.warn(
        //     `[SEFAZ] Filial=${label} | cursor corrigido para ${maxNSU} — aguardando próxima execução (mín. 1h)`,
        //   );
        //   return;
        // }

        if (err.message?.includes("cStat=656")) {
          console.warn(
            `[SEFAZ] Filial=${label} | cStat=656 — aguardando próxima execução SEM mover cursor`,
          );
          // ← NÃO chama descobrirMaxNSU, NÃO atualiza ult_nsu
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

  // ─── Processamento por tipo de documento ────────────────────────────────────

  private async processarDocumento(
    doc: SefazDocumento,
    cnpj: string,
    label: string,
  ): Promise<boolean> {
    const xml = sefazApiService.decodeDocumento(doc.xmlBase64);

    // ── procNFe: XML completo ──────────────────────────────────────────────────
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

    // ── resNFe: XML de resumo ──────────────────────────────────────────────────
    if (doc.schema.startsWith("resNFe")) {
      const chave = this.extrairChaveAcesso(xml);
      if (!chave) {
        console.warn(
          `[SEFAZ] NSU=${doc.NSU} resNFe sem chaveAcesso — ignorado`,
        );
        return false;
      }

      // FIX: busca CNPJ somente dentro de <dest> — sem fallback —
      // para não capturar o CNPJ do emitente quando <dest> está ausente.
      const receiverCnpj = this.extrairCnpjDestinatario(xml);
      if (!receiverCnpj) {
        console.warn(
          `[SEFAZ] NSU=${doc.NSU} resNFe sem CNPJ destinatário em <dest> — ignorado`,
        );
        return false;
      }

      console.log(
        `[SEFAZ] NSU=${doc.NSU} resNFe chave=${chave} receiver=${receiverCnpj} — enviando Ciência da Operação`,
      );

      try {
        const resultado = await nfeManifestacaoService.cienciaDaOperacao(
          chave,
          receiverCnpj,
          doc.NSU,
          label,
        );

        // cStat=000 = validação pré-ciência abortou sem acionar a SEFAZ
        if (resultado.cStat !== "000") {
          console.log(
            `[SEFAZ] NSU=${doc.NSU} Ciência enviada | cStat=${resultado.cStat} | ${resultado.xMotivo}`,
          );
        }
      } catch (err) {
        console.warn(`[SEFAZ] NSU=${doc.NSU} falha ao enviar Ciência:`, err);
      }

      return false;
    }

    // 110111 = Cancelamento
    // ── resEvento: resumo de evento (cancelamento ainda sem XML completo) ─────────
    // if (doc.schema.startsWith("resEvento")) {
    //   const tpEvento = this.extrairTpEvento(xml);
    //   const chave = this.extrairChaveAcesso(xml);

    //   // 110111 = Cancelamento
    //   if (tpEvento === "110111" && chave) {
    //     let xmlCompleto: string | null = null;

    //     try {
    //       xmlCompleto = await sefazApiService.consultarPorChave(chave, cnpj);
    //     } catch (err: any) {
    //       const cStatMatch = err.message?.match(/cStat=(\d+)/);
    //       if (cStatMatch && CSTAT_XML_INDISPONIVEL.has(cStatMatch[1])) {
    //         console.log(
    //           `[SEFAZ] NSU=${doc.NSU} resEvento cancelamento XML indisponível (cStat=${cStatMatch[1]}) — aguardando próximos NSUs`,
    //         );
    //         return false;
    //       }
    //       throw err;
    //     }

    //     if (xmlCompleto) {
    //       await this.apiFetchQueue.upsertInvoiceFromXml(
    //         xmlCompleto,
    //         "CANCELLED",
    //       );
    //       console.log(
    //         `[SEFAZ] NSU=${doc.NSU} resEvento cancelamento processado chave=${chave}`,
    //       );
    //       return true;
    //     }

    //     console.log(
    //       `[SEFAZ] NSU=${doc.NSU} resEvento cancelamento — XML ainda não disponível chave=${chave}`,
    //     );
    //     return false;
    //   }

    //   console.log(
    //     `[SEFAZ] NSU=${doc.NSU} resEvento tpEvento=${tpEvento} ignorado`,
    //   );
    //   return false;
    // }
    if (doc.schema.startsWith("resEvento")) {
  const tpEvento = this.extrairTpEvento(xml);
  const chave = this.extrairChaveAcesso(xml);
  console.log(
    `[SEFAZ] NSU=${doc.NSU} resEvento tpEvento=${tpEvento} chave=${chave} — ignorado`,
  );
  return false;
}
    // ── procEventoNFe: eventos (cancelamento, ciência, etc.) ──────────────────
    if (doc.schema.startsWith("procEventoNFe")) {
      const tpEvento = this.extrairTpEvento(xml);

      // 210210 = Ciência da Operação já registrada — tenta buscar o procNFe completo
      // if (tpEvento === "210210") {
      //   const chave = this.extrairChaveAcesso(xml);
      //   if (!chave) {
      //     console.warn(
      //       `[SEFAZ] NSU=${doc.NSU} 210210 sem chaveAcesso — ignorado`,
      //     );
      //     return false;
      //   }

      //   let xmlCompleto: string | null = null;

      //   try {
      //     xmlCompleto = await sefazApiService.consultarPorChave(chave, cnpj);
      //   } catch (err: any) {
      //     // 641/642 = XML ainda não liberado pelo emitente — não é falha,
      //     // o procNFe virá automaticamente nos próximos NSUs da distribuição.
      //     const cStatMatch = err.message?.match(/cStat=(\d+)/);
      //     if (cStatMatch && CSTAT_XML_INDISPONIVEL.has(cStatMatch[1])) {
      //       console.log(
      //         `[SEFAZ] NSU=${doc.NSU} 210210 chave=${chave} — XML indisponível na SEFAZ (cStat=${cStatMatch[1]}), aguardando próximos NSUs`,
      //       );
      //       return false;
      //     }
      //     throw err;
      //   }

      //   if (!xmlCompleto) {
      //     console.log(
      //       `[SEFAZ] NSU=${doc.NSU} 210210 chave=${chave} — procNFe ainda não disponível`,
      //     );
      //     return false;
      //   }

      //   if (!this.temProdutoRelevante(xmlCompleto)) {
      //     console.log(
      //       `[SEFAZ] NSU=${doc.NSU} 210210 ignorado — sem produtos relevantes`,
      //     );
      //     return false;
      //   }

      //   await this.apiFetchQueue.upsertInvoiceFromXml(xmlCompleto);
      //   console.log(
      //     `[SEFAZ] NSU=${doc.NSU} 210210 procNFe obtido e processado chave=${chave}`,
      //   );
      //   return true;
      // }

       if (tpEvento === "210210") {
    const chave = this.extrairChaveAcesso(xml);
    console.log(
      `[SEFAZ] NSU=${doc.NSU} 210210 ciência confirmada chave=${chave} — aguardando procNFe`,
    );
    return false;
  }

      console.log(
        `[SEFAZ] NSU=${doc.NSU} evento tpEvento=${tpEvento} ignorado`,
      );
      return false;
    }

    console.log(`[SEFAZ] NSU=${doc.NSU} schema=${doc.schema} ignorado`);
    return false;
  }

  // ─── Alerta de falha ─────────────────────────────────────────────────────────

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
