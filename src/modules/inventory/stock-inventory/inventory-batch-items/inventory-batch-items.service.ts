import { includes } from "zod";
import BaseService from "../../../../shared/utils/base-models/base-service";
import inventoryBatchLogsService from "../inventory-batch-logs/inventory-batch-logs.service";
import InventoryBatch from "../inventory-batch/inventory-batch.model";
import inventoryBatchService, {
  InventoryBatchService,
} from "../inventory-batch/inventory-batch.service";
import InventoryBatchItems from "./inventory-batch-items.model";
import inventoryBatchItemsRepository, {
  InventoryBatchItemsRepository,
} from "./inventory-batch-items.repository";
import sequelize from "../../../../config/sequelize";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import integrationMappingService from "../../../integrations/integration-mapping/integration-mapping.service";
import inventorySubgroupsService from "../inventory-subgroups/inventory-subgroups.service";
import productService from "../../products/services/product.service";
import stockService from "../../stock/stock/stock.service";
import productConfigService from "../../product-config/product_config.service";

export class InventoryBatchItemsService extends BaseService<
  InventoryBatchItems,
  InventoryBatchItemsRepository
> {
  constructor() {
    super(inventoryBatchItemsRepository);
  }

  async removeItem(id: string, batchId: string): Promise<void> {
      const inventoryBatch =
        await inventoryBatchService.findByIdFullBatch(batchId);
      if (!inventoryBatch) throw new Error("Lote não encontrado");

      if (!["OPEN", "PENDING"].includes(inventoryBatch.status)) throw new Error("Não permitido remover itens de lotes com processo encerrado!")

     await this.repository.removeItem(id, batchId)
  }

  // Inclusão manual de produto em lote aberto/pendente (FIXED ou CYCLIC), com o estoque do produto na loja do lote.
  // Mesmas regras do scan (mapping na integração da loja + subgrupo do lote); totais do lote recalculados no upsertItem.
  async addProduct(batchId: string, productId: string): Promise<InventoryBatchItems> {
    const batch = await inventoryBatchService.findById(batchId, {
      attributes: ["id", "status", "unit_business_id"],
    });
    if (!batch) throw new Error("Lote não encontrado");
    if (!["OPEN", "PENDING"].includes(batch.status))
      throw new Error("Não permitido adicionar itens de lotes com processo encerrado!");

    const unitBusinessId = batch.unit_business_id;
    const [product, unitBusiness, stock, config, batchSubgroups, existingItem] =
      await Promise.all([
        productService.findById(productId, { attributes: ["id", "subgroup_id", "type"] }),
        unitBusinessService.findById(unitBusinessId, { attributes: ["integrations_id"] }),
        stockService.findOne({
          where: { product_id: productId, unit_business_id: unitBusinessId },
          attributes: ["id", "quantity", "reserved_quantity", "virtual_stock"],
        }),
        productConfigService.findOne({
          where: { product_id: productId, unit_business_id: unitBusinessId },
          attributes: ["gtin", "sku", "price"],
        }),
        inventorySubgroupsService.findAll({
          where: { inventory_batch_id: batchId },
          attributes: ["subgroup_id"],
        }),
        this.findOne({
          where: { inventory_batch_id: batchId, product_id: productId },
          attributes: ["id"],
        }),
      ]);

    if (!product) throw new Error("Produto não encontrado");
    // mesmo recorte do pré-cadastro FIXED: lote de inventário só conta produto unitário
    if (product.type !== "UNIT") throw new Error("Só produtos do tipo unidade podem entrar no lote de inventário");
    if (existingItem) throw new Error("Produto já está neste lote de inventário");
    if (!stock) throw new Error("Produto sem estoque na loja do lote");

    const mappedProductIds = unitBusiness?.integrations_id
      ? await integrationMappingService.findExternalIdsMap(
          "PRODUCT",
          unitBusiness.integrations_id,
          [productId],
        )
      : new Map<string, string>();
    if (!mappedProductIds.has(productId))
      throw new Error("Produto não possui mapeamento para a integração desta loja");

    if (
      batchSubgroups.length > 0 &&
      !batchSubgroups.some((s) => s.subgroup_id === product.subgroup_id)
    )
      throw new Error("Produto não pertence a nenhum subgrupo permitido neste lote de inventário");

    const quantityStock = Number(stock.quantity);
    return sequelize.transaction((t) =>
      this.repository.upsertItem(
        {
          batchId,
          productId,
          stockId: stock.id,
          ean: config?.gtin ?? "",
          sku: config?.sku ?? "",
          quantityStock,
          reservedQuantity: stock.reserved_quantity,
          virtualStock: stock.virtual_stock,
          // mesmo cálculo do pré-cadastro FIXED: preço do product config × estoque
          price: Number(config?.price ?? 0) * quantityStock,
        },
        t,
      ),
    );
  }

  // Correção manual de admin: delega pro inventoryBatchLogsService, que reusa syncItemAndBatchAfterScan (mesmo caminho do scanProduct).
  updateItemQuantity(
    itemId: string,
    quantity: number,
    userId: string,
    roleId: string,
  ): Promise<boolean> {
    return inventoryBatchLogsService.updateItemQuantity(
      itemId,
      quantity,
      userId,
      roleId,
    );
  }
}
export default new InventoryBatchItemsService();
