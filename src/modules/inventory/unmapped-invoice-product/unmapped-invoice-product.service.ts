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
import invoiceItemsService from "../../warehouse/fiscal/invoices/invoice-items/invoice-items.service";

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

  // Resolve a linha unmapped que originou a criação manual de um Product
  // (ver fetchAndUpsertProduct/processProduct com create:true) — se ela
  // pertence a uma nota, cria o InvoiceItem/SupplierMapping retroativamente
  // e apaga o unmapped (reaproveita createInvoiceItemForUnmappedProducts,
  // que já faz isso); senão (unmapped de catálogo, sem invoice_id), só
  // apaga. NÃO resolve outros unmapped com o mesmo EAN em outras notas —
  // isso é tratado separadamente pela cascata de auto-mapeamento.
  async resolveFromCreatedProduct(params: {
    externalId: string;
    integrationsId: string;
    productId: string;
  }): Promise<void> {
    const unmapped = await this.findOne({
      where: {
        external_id: params.externalId,
        integrations_id: params.integrationsId,
        status: "UNMAPPED",
      },
    });

    if (!unmapped) return;

    if (unmapped.invoice_id) {
      await invoiceItemsService.createInvoiceItemForUnmappedProducts(
        {
          product_id: params.productId,
          invoice_id: unmapped.invoice_id,
          quantity_expected: unmapped.quantity ?? 0,
        },
        unmapped.ean ?? "",
        unmapped.id,
      );
    } else {
      await this.delete(unmapped.id);
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
