// src/modules/fiscal/wizard.singleton.ts

import NFeWizard from "nfewizard-io";
import { CertificateService } from "./sefaz.service";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

let wizardInstance: NFeWizard | null = null;
let tempCertPath: string | null = null;

export async function getWizard(): Promise<NFeWizard> {
  if (wizardInstance) return wizardInstance;

  const { pfxBuffer, passphrase } = CertificateService.loadPfx();

  tempCertPath = path.join(os.tmpdir(), `pax-nfe-cert-${process.pid}.pfx`);
  fs.writeFileSync(tempCertPath, pfxBuffer, { mode: 0o600 });

  const ambient = Number(process.env.SEFAZ_AMBIENTE ?? "2");
  const wizard = new NFeWizard();

  await wizard.NFE_LoadEnvironment({
    config: {
      dfe: {
        pathCertificado: tempCertPath,
        senhaCertificado: passphrase,
        UF: process.env.SEFAZ_UF ?? "SP",
        CPFCNPJ: process.env.SEFAZ_CNPJ!,
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
          exibirLogNoConsole: ambient === 2,
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

process.on("exit", () => {
  if (tempCertPath && fs.existsSync(tempCertPath)) {
    fs.unlinkSync(tempCertPath);
  }
});