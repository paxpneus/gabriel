import {
  WebhookQueuePayload,
  DirectUpsertPayload,
} from "./../bling-webhook.types";
import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { Product, ProductConfig } from "../../../../../inventory";
import { Stock } from "../../../../../inventory/index";
import { SupplierMapping } from "../../../../../inventory";
import { Supplier } from "../../../../../inventory";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { Invoice, UnitBusiness } from "../../../../../warehouse";
import { blingApi, getBlingIntegration } from "../../../api/bling_api.service";
import InventoryBatchItems from "../../../../../inventory/stock-inventory/inventory-batch-items/inventory-batch-items.model";
import InventoryBatch from "../../../../../inventory/stock-inventory/inventory-batch/inventory-batch.model";
import { Op, UniqueConstraintError } from "sequelize";
import { BLING_SHARED_QUEUE_LOCK } from "./bling-queue-lock";
import Contact from "../../../../../sales/contacts/contacts.model";
import { logDbError } from "../../../../../../shared/utils/logging/db-errors-logs";
export interface DirectUpsertJobPayload extends WebhookQueuePayload {
  directUpsert: DirectUpsertPayload;
}

export class BlingDirectUpsertQueue extends BaseQueueService<DirectUpsertJobPayload> {
  private api = blingApi;

  constructor(options: { workless?: boolean } = {}) {
    super("BLING_DIRECT_UPSERT", {
      concurrency: 1,
      limiter: {
        max: 10,
        duration: 1000,
      },
      sharedLock: BLING_SHARED_QUEUE_LOCK,
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

        case "contacts":
          await this.upsertContact(directUpsert.data);
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
      logDbError(
        `[BLING_DIRECT_UPSERT] Erro ao processar job ${job.id}`,
        error,
        {
          jobId: job.id,
          resource: job.data.resource,
          action: job.data.action,
          table: job.data.directUpsert?.table,
        },
      );
      throw error;
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
        logDbError(
          "[BLING_DIRECT_UPSERT] UniqueConstraintError não recuperável ao criar produto",
          error,
          {
            blingId: data.blingId,
            idSystem,
            sku: data.sku,
          },
        );
        throw error;
      }

      product = existingProduct;
    }

    if (!created) {
      await updateProductFields(product);
    }

    const unitBusiness = await UnitBusiness.findOne({
      where: { cnpj: "02316749002111" },
    });

    if (unitBusiness) {
      await ProductConfig.upsert(
        {
          product_id: product.id,
          unit_business_id: unitBusiness.id,
          sku: data.sku,
          price: data.price ?? 0,
        },
        { conflictFields: ["product_id", "unit_business_id"] },
      );
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

    // Busca dados frescos do produto na Bling para ter o precoCusto atual
    let entryUnitCost = 0;
    try {
      const { data: blingProductRes } = await this.api.get<{ data: any }>(
        `/produtos/${data.productBlingId}`,
      );
      const p = blingProductRes.data;
      entryUnitCost = Number(p?.fornecedor?.precoCusto ?? p?.precoCusto ?? 0);

      if (!product && p?.codigo) {
        [product] = await Product.upsert(
          {
            id_system: String(p.id),
            name: p.nome,
            ean: p.gtin ?? `NO-EAN-${p.id}`,
            ean_tribut: p.gtinEmbalagem ?? `NO-EAN-${p.id}`,
          },
          { conflictFields: ["id_system"] },
        );
        product = await Product.findOne({
          where: { id_system: String(data.productBlingId) },
        });
      }
    } catch (err: any) {
      if (!product) {
        throw new Error(
          `[BLING_DIRECT_UPSERT] Produto blingId=${data.productBlingId} não encontrado. Retry agendado.`,
        );
      }
      // Se falhou mas product existe, usa o custo que já está na configuração.
      const existingConfig = await ProductConfig.findOne({
        where: { product_id: product.id },
        order: [["updatedAt", "DESC"]],
      });
      entryUnitCost = Number(
        existingConfig?.average_cost ??
          existingConfig?.supplier_cost_price ??
          0,
      );
      console.warn(
        `[BLING_DIRECT_UPSERT] Falha ao buscar precoCusto na Bling para ${data.productBlingId} — usando custo do banco: ${entryUnitCost}`,
      );
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

    const newQuantity = data.quantity;

    const existingStock = await Stock.findOne({
      where: { product_id: product.id, unit_business_id: unitBusiness.id },
    });

    const oldQuantity = Number(existingStock?.quantity ?? 0);
    const oldTotalPrice = Number(existingStock?.total_price ?? 0);

    let newTotalPrice: number;
    let newAverageCost: number;

    if (!existingStock || oldQuantity === 0) {
      // Sem estoque anterior: inicializa com custo atual da Bling
      newTotalPrice = newQuantity * entryUnitCost;
      newAverageCost = entryUnitCost;
    } else if (newQuantity > oldQuantity) {
      // Entrada: CMP = (valor antigo + quantidade entrada × custo entrada) / nova quantidade
      const enteredQty = newQuantity - oldQuantity;
      newTotalPrice = oldTotalPrice + enteredQty * entryUnitCost;
      newAverageCost =
        newQuantity > 0 ? newTotalPrice / newQuantity : entryUnitCost;
    } else if (newQuantity < oldQuantity) {
      // Saída: desconta pelo CMP atual (custo médio não muda em saída)
      const currentAvg =
        oldQuantity > 0 ? oldTotalPrice / oldQuantity : entryUnitCost;
      newTotalPrice = newQuantity * currentAvg;
      newAverageCost = currentAvg;
    } else {
      // Sem mudança de quantidade
      newTotalPrice = oldTotalPrice;
      newAverageCost =
        oldQuantity > 0 ? oldTotalPrice / oldQuantity : entryUnitCost;
    }

    await ProductConfig.upsert(
      {
        product_id: product.id,
        unit_business_id: unitBusiness.id,
        supplier_cost_price: entryUnitCost,
        average_cost: newAverageCost,
        average_cost_updated_at: new Date(),
      },
      { conflictFields: ["product_id", "unit_business_id"] },
    );
    
    await Stock.upsert(
      {
        product_id: product.id,
        quantity: newQuantity,
        unit_business_id: unitBusiness.id,
        total_price: newTotalPrice,
      },
      { conflictFields: ["product_id", "unit_business_id"] },
    );

    console.log(
      `[BLING_DIRECT_UPSERT] Stock upsertado: ean=${product.ean} | qty=${newQuantity} | entry_cost=${entryUnitCost.toFixed(4)} | avg_cost=${newAverageCost.toFixed(4)} | total_price=${newTotalPrice.toFixed(2)}`,
    );

    // ─── Sincroniza InventoryBatches ──────────────────────────────────────────

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

    for (const batch of affectedBatches) {
      await InventoryBatchItems.update(
        { quantity_stock: newQuantity },
        { where: { inventory_batch_id: batch.id, product_id: product.id } },
      );

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
      `[BLING_DIRECT_UPSERT] ${affectedBatches.length} batch(es) sincronizado(s)`,
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

  private async upsertContact(
    data: Extract<DirectUpsertPayload, { table: "contacts" }>["data"],
  ): Promise<void> {
    const integrationsId =
      data.integrations_id ?? (await getBlingIntegration("Bling")).id;
    const unitBusinessId = data.unit_business_id ?? null;

    const existing = await Contact.findOne({
      where: {
        id_system: data.id_system,
        type: data.type,
        integrations_id: integrationsId,
        unit_business_id: unitBusinessId,
      },
    });

    if (existing) {
      await existing.update({
        name: data.name,
        integrations_id: integrationsId,
        unit_business_id: unitBusinessId,
      });
    } else {
      await Contact.create({
        id_system: data.id_system,
        name: data.name,
        type: data.type,
        integrations_id: integrationsId,
        unit_business_id: unitBusinessId,
      });
    }

    console.log(
      `[BLING_DIRECT_UPSERT] Contact ${existing ? "atualizado" : "criado"}: type=${data.type}, id_system=${data.id_system}`,
    );
  }

  private async handleDelete(resource: string, blingId: number): Promise<void> {
    switch (resource) {

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
