// src/modules/fiscal/wizard.singleton.ts

import NFeWizard from "nfewizard-io";
import { CertificateService } from "./sefaz.service";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// ─── Estado do singleton ───────────────────────────────────────────────────────

let wizardInstance: NFeWizard | null = null;
let tempCertPath: string | null = null;

// Promise em andamento — evita race condition onde duas chamadas simultâneas
// a getWizard() criam dois arquivos de certificado e duas instâncias do wizard.
let initPromise: Promise<NFeWizard> | null = null;

// ─── Limpeza do certificado temporário ────────────────────────────────────────

function cleanupCert(): void {
  if (!tempCertPath) return;

  try {
    if (fs.existsSync(tempCertPath)) {
      // Sobrescreve com zeros antes de deletar para impedir recuperação
      // em sistemas sem full-disk encryption.
      const size = fs.statSync(tempCertPath).size;
      if (size > 0) {
        fs.writeFileSync(tempCertPath, Buffer.alloc(size, 0));
      }
      fs.unlinkSync(tempCertPath);
    }
  } catch {
    // Silencia — estamos em um handler de sinal, não podemos lançar
  } finally {
    tempCertPath = null;
  }
}

// Invalida o singleton para forçar recarga na próxima chamada a getWizard().
// Útil quando o certificado expira ou após um erro de autenticação na SEFAZ.
export function invalidateWizard(): void {
  cleanupCert();
  wizardInstance = null;
  initPromise = null;
}

// ─── Registro de sinais — feito uma única vez no módulo ───────────────────────
// Cobre todos os cenários de encerramento do processo:
//   exit             → encerramento normal (sync, sem async)
//   SIGINT           → Ctrl+C em dev
//   SIGTERM          → kill padrão, shutdown do PM2/Docker
//   uncaughtException → exceção não tratada (loga e encerra)
//   unhandledRejection → Promise rejeitada sem .catch() (loga e encerra)

process.once("exit", cleanupCert);

process.once("SIGINT", () => {
  cleanupCert();
  process.exit(130); // convenção: 128 + número do sinal (SIGINT = 2)
});

process.once("SIGTERM", () => {
  cleanupCert();
  process.exit(143); // 128 + 15 (SIGTERM)
});

process.once("uncaughtException", (err) => {
  console.error("[wizard] uncaughtException — limpando certificado:", err);
  cleanupCert();
  process.exit(1);
});

process.once("unhandledRejection", (reason) => {
  console.error("[wizard] unhandledRejection — limpando certificado:", reason);
  cleanupCert();
  process.exit(1);
});

// ─── Validação de variáveis de ambiente ───────────────────────────────────────

function assertEnv(): { ambient: 1 | 2; cnpj: string; uf: string } {
  const ambient = Number(process.env.SEFAZ_AMBIENTE ?? "2");
  if (ambient !== 1 && ambient !== 2) {
    throw new Error(
      `[wizard] SEFAZ_AMBIENTE inválido: "${process.env.SEFAZ_AMBIENTE}" — esperado 1 (produção) ou 2 (homologação)`,
    );
  }

  const cnpj = process.env.SEFAZ_CNPJ?.replace(/\D/g, "") ?? "";
  if (cnpj.length !== 14) {
    throw new Error(
      `[wizard] SEFAZ_CNPJ ausente ou inválido: "${process.env.SEFAZ_CNPJ}" — deve ter 14 dígitos`,
    );
  }

  const uf = process.env.SEFAZ_UF ?? "";
  if (!uf) {
    throw new Error(`[wizard] SEFAZ_UF não definida`);
  }

  return { ambient: ambient as 1 | 2, cnpj, uf };
}

// ─── Inicialização ────────────────────────────────────────────────────────────

async function initWizard(): Promise<NFeWizard> {
  const { ambient, cnpj, uf } = assertEnv();
  const { pfxBuffer, passphrase } = CertificateService.loadPfx();

  // Arquivo temporário com permissão mínima (somente dono lê/escreve)
  const certPath = path.join(
    os.tmpdir(),
    `pax-nfe-cert-${process.pid}-${Date.now()}.pfx`,
  );

  fs.writeFileSync(certPath, pfxBuffer, { mode: 0o600 });
  tempCertPath = certPath;

  // Limpa o buffer do PFX da memória o quanto antes
  pfxBuffer.fill(0);

  const wizard = new NFeWizard();

  try {
    await wizard.NFE_LoadEnvironment({
      config: {
        dfe: {
          pathCertificado: certPath,
          senhaCertificado: passphrase,
          UF: uf,
          CPFCNPJ: cnpj,
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
          ambiente: ambient,
          versaoDF: "4.00",
          idCSC: Number(process.env.SEFAZ_ID_CSC ?? "1"),
          tokenCSC: process.env.SEFAZ_TOKEN_CSC ?? "",
        },
        lib: {
          connection: { timeout: 30000 },
          log: {
            // Logs no console apenas em homologação
            exibirLogNoConsole: ambient === 2,
            armazenarLogs: false,
            pathLogs: "tmp/Logs",
          },
          useOpenSSL: false,
          useForSchemaValidation: "validateSchemaJsBased",
        },
      },
    });
  } catch (err) {
    // Se o NFE_LoadEnvironment falhar, garante limpeza e não guarda instância
    cleanupCert();
    initPromise = null;
    throw err;
  }

  wizardInstance = wizard;
  return wizard;
}

// ─── Exportação pública ───────────────────────────────────────────────────────

/**
 * Retorna a instância singleton do NFeWizard, inicializando-a se necessário.
 *
 * É seguro chamar em paralelo — apenas uma inicialização ocorre por vez
 * graças ao `initPromise`.
 *
 * Para forçar recarga (ex: certificado expirado), chame `invalidateWizard()`
 * antes de chamar `getWizard()` novamente.
 */
export async function getWizard(): Promise<NFeWizard> {
  // Singleton já pronto
  if (wizardInstance) return wizardInstance;

  // Inicialização em andamento — aguarda a mesma Promise
  if (initPromise) return initPromise;

  // Primeira chamada — inicia e guarda a Promise para chamadas concorrentes
  initPromise = initWizard().catch((err) => {
    initPromise = null; // permite nova tentativa na próxima chamada
    throw err;
  });

  return initPromise;
}