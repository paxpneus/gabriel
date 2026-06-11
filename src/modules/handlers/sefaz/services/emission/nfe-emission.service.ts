// src/modules/fiscal/nfe-emission/nfe-emission.service.ts

import NFeWizard from "nfewizard-io";
import type { NFe, LayoutNFe } from "@nfewizard/types/nfe";
import { CertificateService } from "../sefaz.service";
import { NfeEmissionResult, NfeStatusResult } from "./nfe-emission.types";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process"; // move pro topo do arquivo

// NFeWizard não aceita Buffer diretamente na config — precisa de path.
// Usamos um arquivo temporário em /tmp, criado uma vez na inicialização.
// O arquivo não persiste entre reinicializações do processo.

let wizardInstance: NFeWizard | null = null;
let tempCertPath: string | null = null;

async function getWizard(): Promise<NFeWizard> {
  if (wizardInstance) return wizardInstance;

  const { pfxBuffer, passphrase } = CertificateService.loadPfx();

  // Escreve o PFX em arquivo temporário apenas em memória do SO (tmp)
  tempCertPath = path.join(os.tmpdir(), `pax-nfe-cert-${process.pid}.pfx`);
  fs.writeFileSync(tempCertPath, pfxBuffer, { mode: 0o600 });

  try {
    const subject = execSync(
      `openssl pkcs12 -in ${tempCertPath} -nokeys -clcerts -passin pass:${passphrase} 2>/dev/null | openssl x509 -noout -subject`,
    )
      .toString()
      .trim();
  } catch (e) {
    console.log("[DEBUG CERT] Erro ao inspecionar cert:", e);
  }

  const ambient = Number(process.env.SEFAZ_AMBIENTE ?? "2"); // 2 = homolog, 1 = producao
  console.log('AMBIENTE:', ambient)
  const wizard = new NFeWizard();

  await wizard.NFE_LoadEnvironment({
    config: {
      dfe: {
        pathCertificado: tempCertPath,
        senhaCertificado: passphrase,
        UF: process.env.SEFAZ_UF ?? "SP",
        CPFCNPJ: process.env.SEFAZ_CNPJ!,

        // Em homolog não precisamos persistir XMLs em disco — desativa tudo
        armazenarXMLAutorizacao: false,
        pathXMLAutorizacao: "tmp/Autorizacao",
        armazenarXMLRetorno: false,
        pathXMLRetorno: "tmp/RequestLogs",
        armazenarXMLConsulta: false,
        pathXMLConsulta: "tmp/RequestLogs",
        armazenarXMLConsultaComTagSoap: false,
        baixarXMLDistribuicao: false,
        pathXMLDistribuicao: "tmp/DistribuicaoDFe",
        armazenarRetornoEmJSON: false,
        pathRetornoEmJSON: "tmp/DistribuicaoDFe",
      },
      nfe: {
        ambiente: ambient as 1 | 2,
        versaoDF: "4.00",
        idCSC: Number(process.env.SEFAZ_ID_CSC ?? "1"),
        tokenCSC: process.env.SEFAZ_TOKEN_CSC ?? "",
      },
      lib: {
        connection: { timeout: 30000 },
        log: {
          exibirLogNoConsole: ambient === 2, // só loga no console em homolog
          armazenarLogs: false,
          pathLogs: "tmp/Logs",
        },
        useOpenSSL: false,
        useForSchemaValidation: "validateSchemaJsBased",
      },
    },
  });

  wizardInstance = wizard;
  return wizard;
}

// Limpa o arquivo temporário ao encerrar o processo
process.on("exit", () => {
  if (tempCertPath && fs.existsSync(tempCertPath)) {
    fs.unlinkSync(tempCertPath);
  }
});

export class NfeEmissionService {
  /**
   * Consulta o status do serviço SEFAZ.
   * Útil para validar a conexão antes de emitir.
   */
  async checkServiceStatus(): Promise<NfeStatusResult> {
    const wizard = await getWizard();
    const result = await wizard.NFE_ConsultaStatusServico();

    const ret = result?.retConsStatServ ?? result;
    return {
      cStat: String(ret.cStat),
      xMotivo: ret.xMotivo,
      tpAmb: String(ret.tpAmb),
      verAplic: ret.verAplic ?? "",
      dhRecbto: ret.dhRecbto,
    };
  }

  /**
   * Emite uma NF-e a partir de um objeto JSON com o leiaute da SEFAZ.
   * Para homolog, o xNome do destinatário deve ser "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL".
   */
  async emitNfe(lote: NFe): Promise<NfeEmissionResult> {
    //@ts-ignore

    const wizard = await getWizard();
    const result = await wizard.NFE_Autorizacao(lote);

    const retEnviNFe = result?.retEnviNFe ?? result;
    const infProt = result?.protNFe?.infProt ?? retEnviNFe?.protNFe?.infProt;

    return {
      cStat: String(infProt?.cStat ?? retEnviNFe?.cStat ?? ""),
      xMotivo: infProt?.xMotivo ?? retEnviNFe?.xMotivo ?? "",
      chNFe: infProt?.chNFe,
      nProt: infProt?.nProt,
      dhRecbto: infProt?.dhRecbto,
      xml: result?.xml,
    };
  }

  /**
   * Atalho: recebe só o LayoutNFe (a nota), monta o envelope por baixo.
   */
  async emitSingleNfe(nota: LayoutNFe): Promise<NfeEmissionResult> {
    console.log("[DEBUG] dest:", JSON.stringify(nota.infNFe.dest, null, 2)); // temporário
    return this.emitNfe({
      idLote: Date.now(),
      indSinc: 1,
      NFe: nota,
    });
  }

  /**
   * Emite a partir de um XML string já montado.
   * Útil para testes com o XML que você já tem em mãos.
   */
  async emitNfeFromXml(xmlString: string): Promise<NfeEmissionResult> {
    
    const wizard = await getWizard();
    const result = await wizard.NFE_Autorizacao(xmlString);

    const retEnviNFe = result?.retEnviNFe ?? result;
    const infProt = result?.protNFe?.infProt ?? retEnviNFe?.protNFe?.infProt;

    return {
      cStat: String(infProt?.cStat ?? retEnviNFe?.cStat ?? ""),
      xMotivo: infProt?.xMotivo ?? retEnviNFe?.xMotivo ?? "",
      chNFe: infProt?.chNFe,
      nProt: infProt?.nProt,
      dhRecbto: infProt?.dhRecbto,
      xml: result?.xml,
    };
  }
}

export const nfeEmissionService = new NfeEmissionService();
