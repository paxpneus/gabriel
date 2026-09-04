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

export class UnmappedInvoiceProductService extends BaseService<
  UnmappedInvoiceProduct,
  UnmappedInvoiceProductRepository
> {
  constructor() {
    super(unmappedInvoiceProductRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["product_name", "ean", "sku"],
      filterableFields: ["status", "invoice_id"],
      sortableFields: ["product_name", "ean", "sku"],
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
        { priority: 1 },
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
        { priority: 1 },
      );
    } else {
      throw new Error(
        `Integração "${integration.name}" não suportada para criação automática de produto`,
      );
    }
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
