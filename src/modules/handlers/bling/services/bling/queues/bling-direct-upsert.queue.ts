import {
  WebhookQueuePayload,
  DirectUpsertPayload,
} from "./../bling-webhook.types";
import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { Product } from "../../../../../inventory";
import { Stock } from "../../../../../inventory/index";
import { SupplierMapping } from "../../../../../inventory";
import { Supplier } from "../../../../../inventory";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { Invoice, UnitBusiness } from "../../../../../warehouse";
import { blingApi } from "../../../api/bling_api.service";
import InventoryBatchItems from "../../../../../inventory/stock-inventory/inventory-batch-items/inventory-batch-items.model";
import InventoryBatch from "../../../../../inventory/stock-inventory/inventory-batch/inventory-batch.model";
import { Op, UniqueConstraintError } from "sequelize";
export interface DirectUpsertJobPayload extends WebhookQueuePayload {
  directUpsert: DirectUpsertPayload;
}

export class BlingDirectUpsertQueue extends BaseQueueService<DirectUpsertJobPayload> {
  private api = blingApi;

  constructor(options: { workless?: boolean } = {}) {
    super("BLING_DIRECT_UPSERT", {
      concurrency: 3,
      limiter: {
        max: 10,
        duration: 1000,
      },
      workless: options.workless,
    });
  }

  async process(job: Job<DirectUpsertJobPayload>): Promise<void> {
    const { eventId, resource, action, directUpsert } = job.data;

    console.log(
      `[BLING_DIRECT_UPSERT] Processando ${resource}.${action} | eventId: ${eventId}`,
    );

    try {
      switch (directUpsert.table) {
        case "products":
          await this.upsertProduct(directUpsert.data);
          break;

        case "stocks":
          await this.upsertStock(directUpsert.data);
          break;

        case "product_supplier_maps":
          await this.upsertSupplierMapping(directUpsert.data);
          break;

        case "suppliers":
          await this.upsertSupplier(directUpsert.data);
          break;

        case "delete":
          await this.handleDelete(directUpsert.resource, directUpsert.blingId);
          break;

        default:
          console.warn(
            `[BLING_DIRECT_UPSERT] Tabela desconhecida no payload`,
            directUpsert,
          );
      }
    } catch (error: any) {
      console.error(
        `[BLING_DIRECT_UPSERT] Erro ao processar job ${job.id}:`,
        error,
      );
      throw error; // relança para BullMQ registrar falha e fazer retry
    }
  }

  // ─── Handlers por tabela ──────────────────────────────────────────────────

  private async upsertProduct(
    data: Extract<DirectUpsertPayload, { table: "products" }>["data"],
  ): Promise<void> {
    if (!data.blingId) {
      throw new Error(
        `[BLING_DIRECT_UPSERT] Produto sem blingId no payload de upsert direto: ${JSON.stringify(data)}`,
      );
    }

    const idSystem = String(data.blingId);

    const updateProductFields = async (product: Product) => {
      // só atualiza os campos que vieram — nunca sobrescreve EAN real com PENDING
      const fieldsToUpdate: Record<string, any> = {};
      if (data.name) fieldsToUpdate.name = data.name;
      if (data.sku) fieldsToUpdate.sku = data.sku;

      if (Object.keys(fieldsToUpdate).length > 0) {
        await product.update(fieldsToUpdate);
      }
    };

    let product: Product;
    let created = false;

    try {
      [product, created] = await Product.findOrCreate({
        where: { id_system: idSystem },
        defaults: {
          name: data.name,
          sku: data.sku,
          id_system: idSystem,
          ean: `PENDING-${data.blingId}`,
          ean_tribut: `PENDING-TRIBUT-${data.blingId}`,
        },
      });
    } catch (error: any) {
      const isUniqueConstraintError =
        error instanceof UniqueConstraintError ||
        error?.name === "SequelizeUniqueConstraintError";

      if (!isUniqueConstraintError) {
        throw error;
      }

      const existingProduct = await Product.findOne({
        where: { id_system: idSystem },
      });

      if (!existingProduct) {
        console.error("[BLING_DIRECT_UPSERT] UniqueConstraintError não recuperável ao criar produto", {
          blingId: data.blingId,
          idSystem,
          sku: data.sku,
          constraint: error?.parent?.constraint,
          detail: error?.parent?.detail,
          fields: error?.fields,
        });
        throw error;
      }

      product = existingProduct;
    }

    if (!created) {
      await updateProductFields(product);
    }

    console.log(
      `[BLING_DIRECT_UPSERT] Produto ${created ? "criado" : "atualizado parcialmente"}: sku=${data.sku}`,
    );
  }
  private async upsertStock(
    data: Extract<DirectUpsertPayload, { table: "stocks" }>["data"],
  ): Promise<void> {
    let product = await Product.findOne({
      where: { id_system: String(data.productBlingId) },
    });

    if (!product) {
      try {
        const { data: res } = await this.api.get<{ data: any }>(
          `/produtos/${data.productBlingId}`,
        );
        const p = res.data;

        if (!p?.codigo) {
          throw new Error(
            `[BLING_DIRECT_UPSERT] Produto blingId=${data.productBlingId} não encontrado nem na Bling. Retry.`,
          );
        }

        [product] = await Product.upsert(
          {
            id_system: String(p.id),
            name: p.nome,
            sku: p.codigo,
            ean: p.gtin ?? `NO-EAN-${p.id}`,
            ean_tribut: p.gtinEmbalagem ?? `NO-EAN-${p.id}`,
          },
          { conflictFields: ["id_system"] },
        );

        product = await Product.findOne({
          where: { id_system: String(data.productBlingId) },
        });
      } catch (err: any) {
        throw new Error(
          `[BLING_DIRECT_UPSERT] Produto blingId=${data.productBlingId} não encontrado. Retry agendado.`,
        );
      }
    }

    if (!product) {
      throw new Error(
        `[BLING_DIRECT_UPSERT] Produto blingId=${data.productBlingId} não encontrado após fallback. Retry agendado.`,
      );
    }

    const unitBusiness = await UnitBusiness.findOne({
      where: { cnpj: "02316749002111" },
    });

    if (!unitBusiness) {
      throw new Error(
        "[BLING_DIRECT_UPSERT] UnitBusiness CD Minas Gerais não encontrado.",
      );
    }

    // 1. Atualiza o stock do produto
    const [stock] = await Stock.upsert(
      {
        product_id: product.id,
        quantity: data.quantity,
        unit_business_id: unitBusiness.id,
        total_price: data.quantity * (product.price ?? 0)
      },
      { conflictFields: ["product_id"] },
    );

    // 2. Busca todos os InventoryBatches que possuem um batch item com este produto
    console.log(`[DEBUG] Buscando batches para product_id=${product.id}`);
    const affectedBatches = await InventoryBatch.findAll({
      where: {
        mode: "CYCLIC",
        status: { [Op.in]: ["OPEN", "PENDING"] },
      },
      include: [
        {
          model: InventoryBatchItems,
          as: "items",
          where: { product_id: product.id },
          required: true,
        },
      ],
    });
    console.log(`[DEBUG] Batches encontrados: ${affectedBatches.length}`);

    for (const batch of affectedBatches) {
      // 3. Atualiza quantity_stock apenas dos batch items deste lote que têm o produto
      await InventoryBatchItems.update(
        { quantity_stock: data.quantity },
        {
          where: {
            inventory_batch_id: batch.id,
            product_id: product.id,
          },
        },
      );

      // 4. Recalcula total_quantity_stock do batch como soma dos quantity_stock de todos os seus itens
      const newTotalQuantityStock =
        (await InventoryBatchItems.sum("quantity_stock", {
          where: { inventory_batch_id: batch.id },
        })) ?? 0;

      await batch.update({ total_quantity_stock: newTotalQuantityStock });

      console.log(
        `[BLING_DIRECT_UPSERT] InventoryBatch ${batch.id} atualizado | total_quantity_stock=${newTotalQuantityStock}`,
      );
    }

    console.log(
      `[BLING_DIRECT_UPSERT] Stock upsertado: productId=${product.id}, quantity=${data.quantity} | ${affectedBatches.length} batch(es) sincronizado(s)`,
    );
  }

  private async upsertSupplierMapping(
    data: Extract<
      DirectUpsertPayload,
      { table: "product_supplier_maps" }
    >["data"],
  ): Promise<void> {
    const product = await Product.findOne({
      where: { id_system: String(data.productBlingId) },
    });

    if (!product) {
      console.warn(
        `[BLING_DIRECT_UPSERT] Produto blingId=${data.productBlingId} não encontrado para supplier mapping. Ignorado.`,
      );
      return;
    }

    const existing = await SupplierMapping.findOne({
      where: { product_id: product.id },
    });

    if (existing) {
      // só atualiza supplier_product_code se vier — nunca toca o cnpj
      const fieldsToUpdate: Record<string, any> = {};
      if (data.supplier_product_code)
        fieldsToUpdate.supplier_product_code = data.supplier_product_code;

      if (Object.keys(fieldsToUpdate).length > 0) {
        await existing.update(fieldsToUpdate);
      }
    } else {
      await SupplierMapping.create({
        product_id: product.id,
        supplier_cnpj: `PENDING-${data.supplierBlingId}`,
        supplier_product_code: data.supplier_product_code,
      });
    }

    console.log(
      `[BLING_DIRECT_UPSERT] SupplierMapping ${existing ? "atualizado parcialmente" : "criado"}: productId=${product.id}`,
    );
  }

  private async upsertSupplier(
    data: Extract<DirectUpsertPayload, { table: "suppliers" }>["data"],
  ): Promise<void> {
    await Supplier.upsert({
      id_system: data.id_system,
      name: data.name,
      document: data.document,
      fantasy_name: data.fantasy_name,
      city: data.city,
      uf: data.uf,
      code: data.codigo!,
    });

    console.log(
      `[BLING_DIRECT_UPSERT] Supplier upsertado: id_system=${data.id_system}`,
    );
  }

  private async handleDelete(resource: string, blingId: number): Promise<void> {
    switch (resource) {
      case "product": {
        const deleted = await Product.destroy({
          where: { sku: String(blingId) },
        });
        console.log(
          `[BLING_DIRECT_UPSERT] Produto deletado blingId=${blingId}: ${deleted} reg(s)`,
        );
        break;
      }

      case "product_supplier": {
        console.warn(
          `[BLING_DIRECT_UPSERT] Delete de product_supplier blingId=${blingId} — sem chave direta. Ignorado.`,
        );
        break;
      }

      case "invoice":
      case "consumer_invoice": {
        const deleted = await Invoice.destroy({
          where: { id_system: String(blingId) },
        });
        console.log(
          `[BLING_DIRECT_UPSERT] Invoice deletada blingId=${blingId}: ${deleted} reg(s)`,
        );
        break;
      }

      default:
        console.warn(
          `[BLING_DIRECT_UPSERT] Sem handler de delete para resource=${resource}, blingId=${blingId}`,
        );
    }
  }

  protected override onFailed(
    job: Job<DirectUpsertJobPayload>,
    error: Error,
  ): void {
    alertService.sendAlert({
      severity: "HIGH",
      title: "BlingDirectUpsertQueue — job esgotou tentativas",
      message: `Job: ${job.id} | Resource: ${job.data.resource} | Action: ${job.data.action} | EventId: ${job.data.eventId} | Erro: ${error.message}`,
    });
  }
}
