import { BlingApiFetchQueue } from "./../../bling/services/bling/queues/bling-api-fetch.queue";
import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { sefazApiService } from "../api/sefaz_api.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import UnitBusiness from "../../../warehouse/unit-business/unit-business.model";

export type SefazDistribuicaoJobData = Record<string, never>;

// NCMs relevantes para PAX Pneus
const NCM_PERMITIDOS = [
  "40111000", // pneus novos de borracha para automóveis
  "40112000", // pneus para ônibus/caminhões
  "40113000", // pneus para aeronaves
  "40114000", // pneus para motos
  "40115000", // pneus para bicicletas
  "40116200", // pneus recauchutados
  "40116910", // pneus usados
  "84832000", // rolamentos
  "87082100", // cintos de segurança
  "87083019", // freios e componentes
  // adicione conforme necessário
];

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
    // verifica se algum item tem NCM de interesse
    // usa regex simples para não precisar parsear o XML inteiro
    return NCM_PERMITIDOS.some((ncm) => xml.includes(`<NCM>${ncm}</NCM>`));
  }

  private FILIAIS_ATIVAS = [
  '02316749001220', // Loja 12 - ASSIS
  '02316749001735', // Loja 17 - LONDRINA
  '02316749001573', // Loja 15 - Itu
  '02316749002111', // Loja 21 - CD MG
];

async process(job: Job<SefazDistribuicaoJobData>): Promise<void> {
  console.log(`[SEFAZ] Iniciando consulta de distribuição DFe`);

  const filiais = await UnitBusiness.findAll({
    attributes: ['id', 'cnpj', 'name', 'ult_nsu'],
    where: { cnpj: this.FILIAIS_ATIVAS },
  });

  console.log(`[SEFAZ] ${filiais.length} filial(is) para consultar`);

  for (const filial of filiais) {
    await this.processarFilial(filial);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  console.log(`[SEFAZ] Consulta finalizada`);
}

  private async processarFilial(filial: UnitBusiness): Promise<void> {
    const cnpj = filial.cnpj.replace(/\D/g, "");
    let ultNSU = filial.ult_nsu ?? "000000000000000";
    const cUF = process.env.SEFAZ_CUF ?? "42";
    const label = filial.name ?? cnpj;

    console.log(`[SEFAZ] Filial=${label} | CNPJ=${cnpj} | ultNSU=${ultNSU}`);

    let hasMore = true;
    let totalDocumentos = 0;

    while (hasMore) {
      const response = await sefazApiService.consultarDistribuicao({
        cnpj,
        ultNSU,
        cUF,
      });

      console.log(
        `[SEFAZ] Filial=${label} | cStat=${response.cStat} | docs=${response.documentos.length} | ultNSU=${response.ultNSU} | maxNSU=${response.maxNSU}`,
      );

      for (const doc of response.documentos) {
        if (!doc.schema.startsWith("procNFe")) {
          console.log(`[SEFAZ] NSU=${doc.NSU} schema=${doc.schema} ignorado`);
          continue;
        }

        try {
          const xml = sefazApiService.decodeDocumento(doc.xmlBase64);
          if (!this.temProdutoRelevante(xml)) {
            console.log(
              `[SEFAZ] NSU=${doc.NSU} ignorado — sem produtos relevantes`,
            );
            continue;
          }

          await this.apiFetchQueue.upsertInvoiceFromXml(xml);
          console.log(`[SEFAZ] NSU=${doc.NSU} processado`);
          totalDocumentos++;
        } catch (err) {
          console.warn(`[SEFAZ] NSU=${doc.NSU} falhou:`, err);
        }
      }

      await filial.update({ ult_nsu: response.ultNSU });
      ultNSU = response.ultNSU;
      hasMore = response.ultNSU !== response.maxNSU;
    }

    console.log(
      `[SEFAZ] Filial=${label} | ${totalDocumentos} doc(s) processado(s) | novo ultNSU=${ultNSU}`,
    );
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
