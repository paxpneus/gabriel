import { Op } from "sequelize";
import { getTCarIntegration } from "../../../handlers/tecinco/api/tecinco_api";
import { TCarProdutoService } from "../../../handlers/tecinco/service/produtos/produtos.service";
import { TCarConferenciaEstoqueService } from "../../../handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service";
import {
  TCarInvoiceByKeyPayload,
  TCarProdutoPayload,
} from "../../../handlers/tecinco/service/tecinco/tecinco.types";
import { tecincoUnitBusinessForPopulate } from "../../../../shared/constants/tecinco-units";
import { parseAccessKey } from "../../../../shared/utils/xml/access-key";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import invoiceService from "../../../warehouse/fiscal/invoices/invoice/invoice.service";
import { ManualImportError } from "../manual-import.errors";
import { manualImportJobOptions } from "../manual-import.constants";
import {
  findProductExternalId,
  findProductLocalIds,
} from "../helpers/product-mapping";
import {
  ManualImportEntity,
  ManualImportExternalSearchBy,
  ManualImportFoundItem,
  ManualImportHandler,
  ManualImportJobRef,
  ManualImportQueueKey,
  ManualImportQueues,
  ManualImportSavedItem,
  ManualImportSearchOutput,
} from "../manual-import.types";

// Tamanho da 1ª página da listagem de produtos; cheia → truncated.
const PRODUCT_LIST_LIMIT = 100;
// Modelo na chave de acesso: 55 NF-e, 65 NFC-e.
const NFCE_MODEL = "65";
// Filiais Tecinco (fll_codigo) — as mesmas do sync de catálogo.
const TECINCO_BRANCH_IDS = tecincoUnitBusinessForPopulate.map(Number);
// A sessão da listagem usa a primeira filial; branch_ids define quais filiais vêm em `filiais`.
const PRIMARY_BRANCH_ID = TECINCO_BRANCH_IDS[0];

// Payload completo da busca: o job não consulta a Tecinco de novo pra pegar o produto.
interface TecincoProductEnqueueData {
  payload: TCarProdutoPayload;
}

// Filial onde a nota foi achada na busca.
interface TecincoInvoiceEnqueueData extends TCarInvoiceByKeyPayload {
  branchId: number;
}

// Normaliza campo opcional da API pra string | null na exibição.
function toNullableString(value: unknown): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}

// Produto Tecinco → item da busca; sku = código de fábrica, coded como fallback.
function toProductItem(product: TCarProdutoPayload): ManualImportFoundItem {
  const code = product.epctb_codigofabrica || product.epctb_coded;
  const enqueueData: TecincoProductEnqueueData = { payload: product };

  return {
    externalId: String(product.epctb_codigo),
    label: `${code ?? product.epctb_codigo} - ${product.epctb_nome ?? ""}`.trim(),
    details: {
      name: toNullableString(product.epctb_nome),
      ean: toNullableString(product.epctb_ean),
      code: toNullableString(code),
      status: null,
    },
    importable: true,
    enqueueData,
  };
}

// 404 da Tecinco = registro não existe naquela filial (não é falha).
function isNotFound(err: any): boolean {
  return err?.response?.status === 404;
}

// Import manual da Tecinco: produto e nota (cliente fica pra depois).
export class TecincoManualImportHandler implements ManualImportHandler {
  supportedSearches: ManualImportHandler["supportedSearches"] = {
    product: ["id", "name"],
    invoice: ["access_key"],
  };

  localIdSearchBy: ManualImportHandler["localIdSearchBy"] = {
    product: "id",
    invoice: "access_key",
  };

  queueKeys: ManualImportQueueKey[] = ["tcarApiFetch", "tcarInvoice"];

  // Com cacheKey: usa o cache de integração em vez de consultar o banco a cada chamada.
  getIntegration() {
    return getTCarIntegration("Tecinco");
  }

  // Nota vai pra TCAR_INVOICE (fila própria de notas); produto pra TCAR_API_FETCH.
  queueFor(entity: ManualImportEntity): ManualImportQueueKey {
    return entity === "invoice" ? "tcarInvoice" : "tcarApiFetch";
  }

  // Nota só busca por chave; produto por id (codigo_integracao) ou nome.
  async search(
    entity: ManualImportEntity,
    by: ManualImportExternalSearchBy,
    value: string,
  ): Promise<ManualImportSearchOutput> {
    return entity === "invoice"
      ? this.searchInvoice(value)
      : this.searchProducts(by, value);
  }

  // Existe localmente: produto via mapping, nota por xml_key.
  async findLocalIds(
    entity: ManualImportEntity,
    externalIds: string[],
  ): Promise<Map<string, string>> {
    if (entity === "product") {
      const { id: integrationId } = await this.getIntegration();
      return findProductLocalIds(integrationId, externalIds);
    }

    // O upsert da nota casa por xml_key, independente de qual integração gravou.
    const invoices = await invoiceService.findAll({
      where: { xml_key: { [Op.in]: externalIds } },
      attributes: ["id", "xml_key"],
    });
    return new Map(invoices.map((invoice) => [invoice.xml_key!, invoice.id]));
  }

  // by: local_id — nota precisa ser da Tecinco e ter xml_key; senão null (422).
  async findExternalIdByLocalId(
    entity: ManualImportEntity,
    localId: string,
  ): Promise<string | null> {
    const { id: integrationId } = await this.getIntegration();

    if (entity === "product") {
      return findProductExternalId(integrationId, localId);
    }

    const invoice = await invoiceService.findOne({
      where: { id: localId, integrations_id: integrationId },
      attributes: ["xml_key"],
    });
    return invoice?.xml_key ?? null;
  }

  // Nota → invoice_by_key (upsertInvoiceFromTecinco); produto → mesmo job do sync de catálogo.
  async enqueue(
    entity: ManualImportEntity,
    item: ManualImportSavedItem,
    jobRef: ManualImportJobRef,
    queues: ManualImportQueues,
  ): Promise<void> {
    if (entity === "invoice") {
      const { numero, chaveAcesso, branchId } =
        item.enqueueData as TecincoInvoiceEnqueueData;
      await queues.tcarInvoice.add(
        {
          eventId: jobRef.jobId,
          resource: "invoice_by_key",
          action: "sync",
          companyId: "",
          branchId,
          data: { numero, chaveAcesso },
        },
        jobRef.jobId,
        manualImportJobOptions(),
      );
      return;
    }

    const { payload } = item.enqueueData as TecincoProductEnqueueData;
    await queues.tcarApiFetch.add(
      {
        eventId: jobRef.jobId,
        resource: "product",
        action: "sync",
        companyId: "",
        branchId: PRIMARY_BRANCH_ID,
        data: payload,
        // Flags de duplicidade calculadas no worker, onde o sync mantém o índice do catálogo em cache.
        detectCatalogDuplicates: true,
      },
      jobRef.jobId,
      manualImportJobOptions(),
    );
  }

  // GET /produtos com include=filiais nas filiais Tecinco; só a 1ª página, sem nenhuma outra chamada.
  private async searchProducts(
    by: ManualImportExternalSearchBy,
    value: string,
  ): Promise<ManualImportSearchOutput> {
    const response = await new TCarProdutoService().listarProdutos(
      PRIMARY_BRANCH_ID,
      {
        ...(by === "id" ? { codigo_integracao: value } : { nome: value }),
        include: "filiais",
        branch_ids: TECINCO_BRANCH_IDS.join(","),
        limit: PRODUCT_LIST_LIMIT,
        offset: 0,
      },
    );
    const products: TCarProdutoPayload[] = Array.isArray(response?.data)
      ? response.data
      : [];

    return {
      items: products.map(toProductItem),
      truncated: products.length >= PRODUCT_LIST_LIMIT,
    };
  }

  // Número e CNPJ do emitente saem da chave; o detalhe da nota confirma que ela existe na Tecinco.
  private async searchInvoice(value: string): Promise<ManualImportSearchOutput> {
    const accessKey = value.replace(/\D/g, "");
    const parts = parseAccessKey(accessKey);
    if (!parts) {
      throw new ManualImportError(400, {
        code: "INVALID_SEARCH_VALUE",
        message: "Chave de acesso inválida — informe os 44 dígitos",
      });
    }

    const branchIds = await this.resolveInvoiceBranchIds(parts.emitterCnpj);
    const found = await this.findInvoiceInBranches(
      parts.number,
      accessKey,
      branchIds,
    );
    if (!found) return { items: [], truncated: false };

    const { nota, branchId } = found;
    const model = parts.model === NFCE_MODEL ? "NFC-e" : "NF-e";
    const entradaSaida = nota?.cabecalho?.entrada_saida ?? nota?.entrada_saida;
    const enqueueData: TecincoInvoiceEnqueueData = {
      numero: parts.number,
      chaveAcesso: accessKey,
      branchId,
    };

    return {
      items: [
        {
          externalId: accessKey,
          label: `${model} ${parts.number}`,
          details: {
            number: parts.number,
            series: parts.series,
            model,
            type: entradaSaida === "E" ? "IN" : entradaSaida === "S" ? "OUT" : null,
            issuedAt: toNullableString(
              nota?.cabecalho?.data_emissao ?? nota?.cabecalho?.data_movimento,
            ),
            contact: toNullableString(nota?.cliente?.nome),
            status: toNullableString(
              nota?.cabecalho?.situacao ?? nota?.situacao,
            ),
          },
          importable: true,
          enqueueData,
        },
      ],
      truncated: false,
    };
  }

  // Filial emitente primeiro, mesmo fora de TECINCO_BRANCH_IDS: numa transferência é lá que a saída tem XML (a entrada na loja destino pode não ter).
  // As filiais Tecinco ficam de fallback pra nota de emitente de fora (fornecedor).
  private async resolveInvoiceBranchIds(emitterCnpj: string): Promise<number[]> {
    const unitBusiness = await unitBusinessService.findOne({
      where: { cnpj: emitterCnpj },
      attributes: ["number"],
    });
    const emitterBranchId = Number(unitBusiness?.number);
    return emitterBranchId
      ? [emitterBranchId, ...TECINCO_BRANCH_IDS.filter((id) => id !== emitterBranchId)]
      : TECINCO_BRANCH_IDS;
  }

  // Consulta as filiais em paralelo; fica com a primeira que achou, só 404 em todas = não existe.
  private async findInvoiceInBranches(
    numero: string,
    accessKey: string,
    branchIds: number[],
  ): Promise<{ nota: any; branchId: number } | null> {
    const service = new TCarConferenciaEstoqueService();
    const responses = await Promise.allSettled(
      branchIds.map((branchId) =>
        service.getNotaFiscal(numero, branchId, { chave_nfe: accessKey }),
      ),
    );

    const foundIndex = responses.findIndex(
      (response) => response.status === "fulfilled" && !!response.value,
    );
    if (foundIndex !== -1) {
      const response = responses[foundIndex] as PromiseFulfilledResult<any>;
      return {
        nota: response.value?.data ?? response.value,
        branchId: branchIds[foundIndex],
      };
    }

    const unexpected = responses.find(
      (response): response is PromiseRejectedResult =>
        response.status === "rejected" && !isNotFound(response.reason),
    );
    if (unexpected) throw unexpected.reason;
    return null;
  }
}

export default new TecincoManualImportHandler();
