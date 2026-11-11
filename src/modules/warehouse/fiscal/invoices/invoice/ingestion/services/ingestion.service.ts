import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import invoiceIngestionRepository, {
  InvoiceIngestionRepository,
} from "../repositories/ingestion.repository";
import storeService from "../../../../../../sales/stores/stores.service";
import { resolveTecincoBranchId } from "../../../../../../../shared/utils/tecinco/resolve-branch-id";
import type { BlingApiFetchQueue } from "../../../../../../handlers/bling/services/bling/queues/bling-api-fetch.queue";
import type { TCarUpsertQueue } from "../../../../../../handlers/tecinco/queues/tecinco-api-fetch.queue";

// Ingestão de notas: nota provisória (createStub) e import manual de XML (importInvoiceXml).
export class InvoiceIngestionService extends BaseService<Invoice, InvoiceIngestionRepository> {
  constructor() {
    super(invoiceIngestionRepository);
  }

  // Nota "provisória" — vínculo rápido (pedido/solicitação PDV não pode
  // esperar o processo lento de importação): só os campos já conhecidos no
  // momento do vínculo são preenchidos, o resto fica vazio até o upsert real
  // da integração (Tecinco/Bling) completar a nota. Localiza esta mesma
  // linha por xml_key/id_system (ver upsertInvoiceFromXml em
  // shared/utils/xml/invoice-xml.ts e fetchAndUpsertInvoice em
  // bling-api-fetch.queue.ts) e atualiza em cima dela — nunca cria uma
  // segunda linha, desde que idSystem/xmlKey aqui sejam os mesmos que aquele
  // upsert real vai resolver.
  async createStub(params: {
    id?: string;
    integrationsId: string;
    numberSystem: string;
    idSystem?: string | null;
    xmlKey?: string | null;
    danfePath?: string | null;
    senderCnpj?: string | null;
    senderName?: string | null;
    receiverCnpj?: string | null;
  }): Promise<Invoice> {
    const defaultStore = await storeService.findOne({
      where: { name: "Outros" },
    });
    if (!defaultStore) {
      throw new Error(
        'Loja padrão "Outros" não cadastrada — não é possível criar a nota provisória',
      );
    }

    return this.create({
      ...(params.id ? { id: params.id } : {}),
      integrations_id: params.integrationsId,
      number_system: params.numberSystem,
      id_system: params.idSystem ?? undefined,
      xml_key: params.xmlKey ?? null,
      danfe_path: params.danfePath ?? null,
      store_id: defaultStore.id,
      customer_name: params.senderName ?? "",
      customer_document: params.senderCnpj ?? "",
      sender_cnpj: params.senderCnpj ?? "",
      sender_name: params.senderName ?? "",
      receiver_cnpj: params.receiverCnpj ?? "",
      receiver_name: "",
    });
  }

  /**
   * Importa uma NF-e a partir de um XML enviado manualmente. Roda sempre
   * de forma síncrona (nunca enfileira), pra que um erro no processamento
   * propague de verdade pro chamador em vez de só ser logado por um worker
   * em background.
   */
  async importInvoiceXml(params: {
    integration?: string;
    xmlContent: string;
    userId?: string;
    blingQueue: BlingApiFetchQueue;
    tecincoQueue: TCarUpsertQueue;
  }): Promise<void> {
    const { integration, xmlContent, userId, blingQueue, tecincoQueue } =
      params;

    if (integration === "bling") {
      await blingQueue.upsertInvoiceFromXml(xmlContent);
    } else if (integration === "tecinco") {
      const branchId = await resolveTecincoBranchId(userId);
      if (!branchId) {
        throw new Error(
          "Não foi possível resolver a filial do usuário para importar via Tecinco",
        );
      }
      await tecincoQueue.upsertInvoiceFromXml(xmlContent, branchId);
    } else {
      throw new Error(
        `Integração inválida ou ausente: ${integration ?? "(nenhuma)"}`,
      );
    }
  }
}

export default new InvoiceIngestionService();
