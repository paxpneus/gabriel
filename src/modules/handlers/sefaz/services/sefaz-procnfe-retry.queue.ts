// src/modules/fiscal/sefaz/queues/sefaz-procnfe-retry.queue.ts

import { Job } from "bullmq";
import { Op } from "sequelize";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { sefazApiService } from "../api/sefaz_api.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import Invoice from "../../../warehouse/fiscal/invoices/invoice/invoice.model";
import { BlingApiFetchQueue } from "./../../bling/services/bling/queues/bling-api-fetch.queue";

export type SefazProcNFeRetryJobData = Record<string, never>;

const CSTAT_XML_INDISPONIVEL = new Set(["641", "642"]);
const MAX_TENTATIVAS_PROCNFE = 48;
const SEFAZ_CNPJ = (process.env.SEFAZ_CNPJ ?? "").replace(/\D/g, "");

const NCM_PERMITIDOS = [
  "40111000", "40112000", "40113000", "40114000", "40115000",
  "40116200", "40116910", "84832000", "87082100", "87083019",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function temProdutoRelevante(xml: string): boolean {
  return NCM_PERMITIDOS.some((ncm) => xml.includes(`<NCM>${ncm}</NCM>`));
}

export class SefazProcNFeRetryQueue extends BaseQueueService<SefazProcNFeRetryJobData> {
  private apiFetchQueue: BlingApiFetchQueue;

  constructor(options: { workless?: boolean } = {}) {
    super("SEFAZ_PROCNFE_RETRY", {
      concurrency: 1,
      limiter: { max: 1, duration: 3000 },
      // 1h de lock — uma única chamada cStat=656 (660) já encerra a execução,
      // mas no pior caso (todas as chaves precisam consulta) o número de
      // chaves * sleep deve ficar bem abaixo disso.
      lockDuration: 55 * 60 * 1000,
      workless: options.workless,
    });

    this.apiFetchQueue = new BlingApiFetchQueue({ workless: true });
  }

  async process(_job: Job<SefazProcNFeRetryJobData>): Promise<void> {
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);

    // Pega chaves pendentes que NÃO foram consultadas na última hora
    // (ou nunca foram consultadas), limitado a um lote por execução.
    const pendentes = await Invoice.findAll({
      where: {
        sefaz_manifestation_status: "AGUARDANDO_PROCNFE",
        sefaz_full_xml_attempts: { [Op.lt]: MAX_TENTATIVAS_PROCNFE },
        [Op.or]: [
          { sefaz_full_xml_last_query_at: null },
          { sefaz_full_xml_last_query_at: { [Op.lt]: umaHoraAtras } },
        ],
      },
      attributes: ["id", "xml_key", "sefaz_full_xml_attempts"],
      limit: 50, // ajuste conforme volume — cada chave = 1 consulta
      order: [["sefaz_full_xml_last_query_at", "ASC"]],
    });

    console.log(
      `[SEFAZ-RETRY] ${pendentes.length} chave(s) pendente(s) de procNFe`,
    );

    for (const invoice of pendentes) {
      const chave = invoice.xml_key;

      let xmlCompleto: string | null = null;
      let cStat656 = false;

      try {
        xmlCompleto = await sefazApiService.consultarPorChave(chave!, SEFAZ_CNPJ);
      } catch (err: any) {
        const cStatMatch = err.message?.match(/cStat=(\d+)/);
        const cStat = cStatMatch?.[1];

        if (cStat && CSTAT_XML_INDISPONIVEL.has(cStat)) {
          console.log(
            `[SEFAZ-RETRY] chNFe=${chave} XML ainda indisponível (cStat=${cStat}) — tentativa ${invoice.sefaz_full_xml_attempts! + 1}`,
          );
        } else if (err.message?.includes("cStat=656")) {
          // Consumo indevido — para TUDO imediatamente, não conta tentativa,
          // não consulta mais nada nesta execução.
          console.warn(
            `[SEFAZ-RETRY] cStat=656 ao consultar chNFe=${chave} — abortando execução SEM contar tentativa`,
          );
          cStat656 = true;
        } else {
          console.warn(`[SEFAZ-RETRY] chNFe=${chave} erro inesperado:`, err);
        }
      }

      if (cStat656) {
        return; // aborta a execução inteira, próxima tentativa só na próxima hora
      }

      if (xmlCompleto) {
        if (temProdutoRelevante(xmlCompleto)) {
          await this.apiFetchQueue.upsertInvoiceFromXml(xmlCompleto);
          console.log(`[SEFAZ-RETRY] chNFe=${chave} procNFe obtido e processado`);
        } else {
          console.log(
            `[SEFAZ-RETRY] chNFe=${chave} procNFe obtido sem produtos relevantes`,
          );
        }

        await invoice.update({
          sefaz_manifestation_status: "CONFIRMADO",
          sefaz_full_xml_last_query_at: new Date(),
        });
      } else {
        // 641/642 ou erro tratado — incrementa tentativa, marca timestamp
        const attempts = invoice.sefaz_full_xml_attempts! + 1;
        const desistiu = attempts >= MAX_TENTATIVAS_PROCNFE;

        await invoice.update({
          sefaz_full_xml_attempts: attempts,
          sefaz_full_xml_last_query_at: new Date(),
          ...(desistiu
            ? { sefaz_manifestation_status: "PROCNFE_DESISTIDO" }
            : {}),
        });

        if (desistiu) {
          console.warn(
            `[SEFAZ-RETRY] chNFe=${chave} excedeu ${MAX_TENTATIVAS_PROCNFE} tentativas — desistindo`,
          );
        }
      }

      // Rate limit entre consultas — bem espaçado, já que rodamos 1x/hora
      await sleep(5000);
    }
  }

  protected override onFailed(
    job: Job<SefazProcNFeRetryJobData>,
    error: Error,
  ): void {
    alertService.sendAlert({
      severity: "CRITICAL",
      title: "SEFAZ — retry de procNFe falhou após todas tentativas",
      message: `Erro: ${error.message}`,
    });
  }
}