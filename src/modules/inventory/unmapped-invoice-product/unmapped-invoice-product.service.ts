import { DestroyOptions, FindOptions, Op, Transaction } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../shared/query/query.types";
import BaseService from "../../../shared/utils/base-models/base-service";
import UnmappedInvoiceProduct from "./unmapped-invoice-product.model";
import unmappedInvoiceProductRepository, {
  UnmappedInvoiceProductRepository,
} from "./unmapped-invoice-product.repository";
import { Invoice } from "../../warehouse";
import sequelize from "../../../config/sequelize";
import {
  UnmappedInvoiceProductAttributes,
  UnmappedInvoiceProductCreationAttributes,
  UnmappedInvoiceProductWithImagePreview,
} from "./unmapped-invoice-product.types";
import uploaderService, {
  UploaderService,
  UploadInput,
} from "../../handlers/uploader/services/uploader.service";
import { cleanDocument } from "../../../shared/utils/normalizers/document";
import integrationsService from "../../integrations/integrations/integrations.service";
import { BlingApiFetchQueue } from "../../handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { TCarUpsertQueue } from "../../handlers/tecinco/queues/tecinco-api-fetch.queue";
import { resolveTecincoBranchId } from "../../../shared/utils/tecinco/resolve-branch-id";
import { TCarProdutoPayload } from "../../handlers/tecinco/service/tecinco/tecinco.types";

// Quanto tempo o job de criação de produto fica visível no Redis depois de
// concluir (ver createProduct/getCreateProductJobStatus) — a fila por
// padrão apaga job concluído na hora (removeOnComplete:true, pensado pra
// sync de alto volume), o que faria getJob nunca ver "completed".
const CREATE_PRODUCT_JOB_RETENTION_SECONDS = 24 * 3600;

export class UnmappedInvoiceProductService extends BaseService<
  UnmappedInvoiceProduct,
  UnmappedInvoiceProductRepository
> {
  constructor() {
    super(unmappedInvoiceProductRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["product_name", "ean", "sku", "reason"],
      stringFields: ["ean", "sku", "external_id"],
      filterableFields: [
        "status",
        "invoice_id",
        "type",
        "integrations_id",
        "reason",
        "product_name",
        "external_id",
        "ean",
        "sku",
      ],
      sortableFields: ["product_name", "ean", "sku", "type", "status", "external_id"],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<UnmappedInvoiceProduct>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: Invoice,
          as: "invoice",
          attributes: ["number_system", "id"],
        },
      ],
    });
  }

  async createUnmappedFromReadingEan(
    ean: string,
    image: UploadInput,
    integrations_id: string
  ): Promise<UnmappedInvoiceProductAttributes> {
    let id: string;
    let imagePath: string;
    console.log(ean

      
    )

    try {
      imagePath = await uploaderService.upload(image);
    } catch (error) {
      throw new Error(`Erro ao fazer upload de imagem: ${error}`);
    }
    try {
    await sequelize.transaction(async (t) => {
      const alreadyExists = await this.repository.findOne({
        where: {
          ean,
          invoice_id: { [Op.eq]: null },
        },
        transaction: t,
      });

      if (alreadyExists) {
        throw new Error(
          "Produto não mapeado já registrado para ajuste no ERP!",
        );
      }

      const payload = {
        ean,
        integrations_id,
        reason:
          "EAN não encontrado no sistema, verificar ERP para ajustar cadastro!",
        type: "ERROR_SCAN" as const,
        image_path: imagePath,
      };
      const createdUnmapped = await this.repository.create(payload, {
        transaction: t,
      });

      id = createdUnmapped.id;
    });
  } catch (error) {
     await uploaderService.delete?.(imagePath);
    throw error;
  }
    return (await this.findById(id!))!;
  }

  async markMapped(ids: string[]): Promise<void> {
    return await sequelize.transaction(async (t) => {
      const unmapped = await this.findAll({
        where: {
          id: ids,
        },
        transaction: t,
      });

      if (!unmapped.length) {
        throw new Error("Produto(s) não mapeado(s) não encontrado(s)");
      }

      await this.bulkUpdate(
        {
          status: "MAPPED",
        },
        {
          where: {
            id: ids,
          },
          transaction: t,
        },
      );
    });
  }

  async findUnmappedByInvoiceIds(
    invoiceIds: string[],
    transaction?: Transaction,
  ): Promise<UnmappedInvoiceProduct[]> {
    return this.repository.findUnmappedByInvoiceIds(invoiceIds, transaction);
  }

  // Apaga a linha unmapped de catálogo que originou a criação manual de um
  // Product (ver fetchAndUpsertProduct/processProduct com create:true).
  // NÃO cria invoice item nem toca em nenhuma nota — criar o produto é um
  // passo isolado. Pra vincular o produto recém-criado a uma nota, o
  // usuário usa o fluxo de mapeamento manual (POST /add/item, ver
  // InvoiceItemsService.createInvoiceItemForUnmappedProducts), que já
  // cascateia sozinho pra outras notas com o mesmo código+CNPJ emissor —
  // funciona igual esteja o produto atrás do product_id recém-criado ou
  // já existente antes.
  async resolveFromCreatedProduct(params: {
    externalId: string;
    integrationsId: string;
  }): Promise<void> {
    const unmapped = await this.findOne({
      where: {
        external_id: params.externalId,
        integrations_id: params.integrationsId,
        status: "UNMAPPED",
      },
    });

    if (!unmapped) return;

    await this.delete(unmapped.id);
  }

  // Busca outros unmapped (em outras notas) com o mesmo código de
  // fornecedor de um unmapped que acabou de ser mapeado manualmente, para
  // avaliar se podem ser auto-mapeados também (ver
  // InvoiceItemsService.cascadeAutoMapUnmapped). A busca por código vem do
  // repository (é query/include); a normalização de CNPJ pra comparar
  // "mesmo fornecedor" é regra de negócio e fica aqui.
  async findCascadeMatches(
    params: { supplierProductCode: string | null; excludeId: string; senderCnpj: string },
    transaction?: Transaction,
  ): Promise<UnmappedInvoiceProduct[]> {
    if (!params.supplierProductCode) return [];

    const candidates = await this.repository.findByCodeExcluding(
      params.supplierProductCode,
      params.excludeId,
      transaction,
    );

    const normalizedSenderCnpj = cleanDocument(params.senderCnpj);

    return candidates.filter(
      (candidate: any) =>
        cleanDocument(candidate.invoice?.sender_cnpj ?? "") ===
        normalizedSenderCnpj,
    );
  }

  // Único disparador de criação de produto a partir de um unmapped — sempre
  // manual, via POST .../create-product (nunca automático em nenhum outro
  // fluxo). Só funciona pra unmapped com external_id preenchido (ver
  // fetchAndUpsertProduct/processProduct com create:true). Enfileira com
  // prioridade máxima (BullMQ priority:1) na própria fila de fetch da
  // integração — não cria fila/lock dedicados, só fura a fila de espera.
  async createProduct(
    id: string,
    params: {
      blingApiFetchQueue: BlingApiFetchQueue;
      tcarUpsertQueue: TCarUpsertQueue;
      userId?: string;
    },
  ): Promise<void> {
    const unmapped = await this.findById(id);
    if (!unmapped) {
      throw new Error("Produto não mapeado não encontrado!");
    }
    if (!unmapped.external_id) {
      throw new Error(
        "Produto não mapeado não tem id do ERP, não é possível criar produto automaticamente",
      );
    }

    const integration = await integrationsService.findById(
      unmapped.integrations_id!,
    );
    if (!integration) {
      throw new Error("Integração do produto não mapeado não encontrada");
    }

    if (integration.name === "Bling") {
      await params.blingApiFetchQueue.add(
        {
          eventId: `product-create-${unmapped.id}`,
          resource: "product",
          action: "created",
          companyId: "",
          date: new Date().toISOString(),
          rawData: null,
          apiFetch: {
            resource: "product",
            blingId: Number(unmapped.external_id),
            action: "created",
            companyId: "",
            create: true,
          },
        },
        `bling-product-create-${unmapped.id}`,
        // removeOnComplete com retenção: getCreateProductJobStatus precisa
        // achar o job depois de concluído (default da fila é apagar na
        // hora — ver BaseQueueService.add) pra reportar "completed" em vez
        // de "not_found".
        { priority: 1, removeOnComplete: { age: CREATE_PRODUCT_JOB_RETENTION_SECONDS } },
      );
    } else if (integration.name === "Tecinco") {
      const branchId = await resolveTecincoBranchId(params.userId);
      if (!branchId) {
        throw new Error(
          "Não foi possível resolver a filial Tecinco do usuário",
        );
      }

      // Payload mínimo — só o suficiente pra identificar o produto. Quem
      // busca o detalhe completo na Tecinco é o próprio worker
      // (processProduct, quando create:true), não o request HTTP; assim o
      // endpoint só enfileira e responde rápido.
      const minimalData: TCarProdutoPayload = {
        fll_codigo: branchId,
        epctb_codigo: unmapped.external_id,
        epctb_nome: unmapped.product_name ?? "",
      };

      await params.tcarUpsertQueue.add(
        {
          eventId: `product-create-${unmapped.id}`,
          resource: "product",
          action: "created",
          companyId: "",
          branchId,
          data: minimalData,
          create: true,
        },
        `tecinco-product-create-${unmapped.id}`,
        { priority: 1, removeOnComplete: { age: CREATE_PRODUCT_JOB_RETENTION_SECONDS } },
      );
    } else {
      throw new Error(
        `Integração "${integration.name}" não suportada para criação automática de produto`,
      );
    }
  }

  // Status do job de criação de produto enfileirado por createProduct — o
  // endpoint só enfileira e responde rápido, então o front usa isso pra dar
  // polling e saber se deu erro ou sucesso no processamento (assíncrono, no
  // worker). Os jobIds são determinísticos (um por integração, baseados no
  // id do unmapped), então dá pra procurar direto sem guardar qual
  // integração foi usada.
  async getCreateProductJobStatus(
    id: string,
    params: {
      blingApiFetchQueue: BlingApiFetchQueue;
      tcarUpsertQueue: TCarUpsertQueue;
    },
  ): Promise<{
    status:
      | "not_found"
      | "waiting"
      | "active"
      | "delayed"
      | "completed"
      | "failed"
      | "unknown";
    error?: string;
  }> {
    const job =
      (await params.blingApiFetchQueue.queue.getJob(
        `bling-product-create-${id}`,
      )) ??
      (await params.tcarUpsertQueue.queue.getJob(
        `tecinco-product-create-${id}`,
      ));

    if (!job) {
      return { status: "not_found" };
    }

    const state = await job.getState();

    if (state === "failed") {
      return { status: "failed", error: job.failedReason };
    }

    // "prioritized": estado próprio do BullMQ pra job com priority explícita
    // (ver createProduct, priority:1) enquanto ele ainda não foi pego por um
    // worker — equivalente a "waiting" pro que o front precisa saber.
    if (state === "prioritized") {
      return { status: "waiting" };
    }

    if (
      state === "waiting" ||
      state === "active" ||
      state === "delayed" ||
      state === "completed"
    ) {
      return { status: state };
    }

    return { status: "unknown" };
  }

  async getFullById(id: string): Promise<UnmappedInvoiceProduct> {
    const unmapped = await this.repository.getFullById(id)
    
    return unmapped
  }

  async delete(id: string, options?: DestroyOptions) {
    const unMapped = await this.repository.findById(id)
    // await uploaderService.delete?.(unMapped!.image_path);
    return this.repository.delete(id, options);
  }
}

export default new UnmappedInvoiceProductService();
