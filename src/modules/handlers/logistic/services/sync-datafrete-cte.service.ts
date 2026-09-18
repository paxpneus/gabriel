import { Op } from "sequelize";
import cteService from "../../../warehouse/fiscal/ctes/cte/services/cte.service";
import Cte from "../../../warehouse/fiscal/ctes/cte/cte.model";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import { importCteJson } from "../transporters/data-frete/services/invoices/cte/cte.service";
import {
  describeDatafreteCodigoRetorno,
  extractDatafreteCodigoRetorno,
  isDatafreteCteAlreadyCadastrado,
} from "../transporters/data-frete/helpers/error-codes";
import { decryptXml, isEncrypted } from "../../../../shared/utils/xml/xml-cipher";
import { getDatafreteIntegration } from "../transporters/data-frete/api/data-frete_api.service";
import integrationLoggerService from "../../../integrations/integration-errors/integration-logger.service";
import { IntegrationErrorEntity } from "../../../integrations/integration-errors/integration-error.types";

export interface SyncPendingCtesResult {
  ctesProcessed: number;
  alreadyImported: number;
  failed: number;
}

// Só essas lojas são tomadoras de frete de verdade — outras aparecem como
// "tom" no Sieg (CNPJ do documento) mas não devem ir pra Datafrete.
export const DATAFRETE_TAKER_UNIT_BUSINESS_NUMBERS = ["21", "12", "17", "15"];

export const isDatafreteFreightTakerNumber = (number: string): boolean =>
  DATAFRETE_TAKER_UNIT_BUSINESS_NUMBERS.includes(number);

// Limita quantos CT-es pendentes são sincronizados por execução — útil pra testar
// o fluxo contra a API real da Datafrete sem disparar o backlog inteiro de uma vez.
// undefined/0 = sem limite.
const DATAFRETE_CTE_SYNC_LIMIT = Number(process.env.DATAFRETE_CTE_SYNC_LIMIT ?? 0);

export class SyncDatafreteCteService {
  async syncPendingCtes(): Promise<SyncPendingCtesResult> {
    const result: SyncPendingCtesResult = {
      ctesProcessed: 0,
      alreadyImported: 0,
      failed: 0,
    };

    const unitBusinesses = await unitBusinessService.findAll({
      where: { number: { [Op.in]: DATAFRETE_TAKER_UNIT_BUSINESS_NUMBERS } },
    });
    const cnpjs = unitBusinesses
      .map((unit) => unit.cnpj)
      .filter((cnpj): cnpj is string => !!cnpj);

    console.log(
      `[SyncDatafreteCte] ${cnpjs.length} unit business(es) considerada(s) tomadora(s) de frete.`,
    );

    if (!cnpjs.length) return result;

    const allPending = (await cteService.findUnsyncedTakenByCnpjs(
      cnpjs,
    )) as Cte[];

    const pending =
      DATAFRETE_CTE_SYNC_LIMIT > 0
        ? allPending.slice(0, DATAFRETE_CTE_SYNC_LIMIT)
        : allPending;

    console.log(
      `[SyncDatafreteCte] ${allPending.length} CT-e(s) pendente(s) de sincronização` +
        (pending.length !== allPending.length
          ? ` (limitado a ${pending.length} via DATAFRETE_CTE_SYNC_LIMIT para teste).`
          : "."),
    );

    if (!pending.length) return result;

    for (const cte of pending) {
      console.log(
        `[SyncDatafreteCte] Processando CT-e id=${cte.id} numero=${cte.number} chave=${cte.xml_key}...`,
      );

      try {
        const wasAlreadyImported = await this.syncCte(cte);
        result.ctesProcessed++;
        if (wasAlreadyImported) result.alreadyImported++;

        console.log(
          `[SyncDatafreteCte] CT-e chave=${cte.xml_key} ${
            wasAlreadyImported ? "já existia na Datafrete, marcado" : "importado e marcado"
          } como synched=true.`,
        );
      } catch (error: any) {
        result.failed++;
        console.error(
          `[SyncDatafreteCte] Falha ao sincronizar CT-e ${cte.xml_key}:`,
          error?.response?.data ?? error?.message ?? error,
        );

        const codigoRetorno = extractDatafreteCodigoRetorno(error);
        const integration = await getDatafreteIntegration();
        await integrationLoggerService.log({
          entity: IntegrationErrorEntity.CTE,
          type: codigoRetorno?.toString() ?? "UNKNOWN",
          integrationsId: integration.id,
          internalId: cte.id,
          reference: cte.xml_key ?? String(cte.number),
          message: codigoRetorno
            ? describeDatafreteCodigoRetorno(codigoRetorno)
            : (error?.message ?? "Erro desconhecido ao sincronizar CT-e com a Datafrete"),
          createIntegrationError: true,
        });
      }
    }

    return result;
  }

  // pública pra ser chamada logo após o upsert de um CT-e, sem esperar o
  // catch-up em lote de `syncPendingCtes`
  async syncCte(cte: Cte): Promise<boolean> {
    // Guarda redundante: os dois chamadores já filtram por synched=false,
    // mas isso evita gastar requisição na Datafrete se alguém chamar direto.
    if (cte.synched) return true;

    if (!cte.xml_path || cte.xml_path.startsWith("http")) {
      throw new Error("CT-e sem XML disponível para envio.");
    }

    const xml = isEncrypted(cte.xml_path)
      ? decryptXml(cte.xml_path)
      : cte.xml_path;

    const xmlBase64 = Buffer.from(xml, "utf-8").toString("base64");

    console.log(
      `[SyncDatafreteCte] chave=${cte.xml_key} enviando XML (${xml.length} chars) para a Datafrete...`,
    );

    // Insere direto, sem checar existência antes — a Datafrete já retorna
    // codigo_retorno=714 se o CT-e já estiver cadastrado (ver error-codes.ts).
    try {
      await importCteJson(xmlBase64);
    } catch (error) {
      if (!isDatafreteCteAlreadyCadastrado(error)) throw error;

      console.log(
        `[SyncDatafreteCte] chave=${cte.xml_key} já cadastrado na Datafrete (${describeDatafreteCodigoRetorno(
          extractDatafreteCodigoRetorno(error)!,
        )}).`,
      );

      await cteService.markAsSynched(cte.id);
      return true;
    }

    await cteService.markAsSynched(cte.id);
    return false;
  }
}

export default new SyncDatafreteCteService();
