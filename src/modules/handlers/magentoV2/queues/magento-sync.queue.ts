import { Job } from "bullmq";
import { Op, Transaction } from "sequelize";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import sequelize from "../../../../config/sequelize";
import productService from "../../../inventory/products/services/product.service";
import productConfigService from "../../../inventory/product-config/product_config.service";
import unmappedInvoiceProductService from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import integrationMappingService from "../../../integrations/integration-mapping/integration-mapping.service";
import { getMagentoIntegration } from "../api/magentoV2_api";
import magentoCatalogService from "../service/catalog/products/products.service";

const BLING_UNIT_BUSINESS_ID = process.env.BLING_UNIT_BUSINESS_ID;

export type MagentoSyncJobPayload =
  | { kind: "sync-product"; productId: string }
  | { kind: "sync-all" };

// Fila única de sincronização com o Magento (preço/mapping/unmapped/
// custo_medio). Antes esse trabalho rodava embutido no job da
// BLING_API_FETCH — só disparava quando a Bling mandava webhook, e como
// populate-from-bling não varre mais o catálogo inteiro todo dia (só
// produto com movimento de estoque), o resto do catálogo parava de
// receber sync com o Magento. Aqui: BLING_API_FETCH só enfileira
// "sync-product" e retorna (não bloqueia no Magento), e um job diário
// "sync-all" cobre o catálogo inteiro (ver .claude/modules/magento-sync.md).
export class MagentoSyncQueue extends BaseQueueService<MagentoSyncJobPayload> {
  constructor(options: { workless?: boolean } = {}) {
    super("MAGENTO_SYNC", {
      concurrency: 2,
      limiter: { max: 2, duration: 1000 },
      maxProcessingMs: 5 * 60 * 1000,
      workless: options.workless,
    });
  }

  async process(job: Job<MagentoSyncJobPayload>): Promise<void> {
    if (job.data.kind === "sync-all") {
      await this.enqueueAllProducts();
      return;
    }
    await this.syncProduct(job.data.productId);
  }

  // ─── job diário (23h BRT) — enfileira 1 "sync-product" por produto UNIT ───
  // mapeado na unit business da Bling. Reaproveita a própria fila/limiter
  // pra não estourar rate limit do Magento numa varrida do catálogo inteiro.
  private async enqueueAllProducts(): Promise<void> {
    const configs = await productConfigService.findAll({
      where: {
        unit_business_id: BLING_UNIT_BUSINESS_ID,
        sku: { [Op.ne]: null },
      },
      attributes: ["product_id"],
    });
    const productIds = [...new Set(configs.map((c) => c.product_id))];
    if (!productIds.length) return;

    const products = await productService.findAll({
      where: { id: { [Op.in]: productIds }, type: "UNIT" },
      attributes: ["id"],
    });

    console.log(
      `[MAGENTO_SYNC] sync-all: enfileirando ${products.length} produto(s)`,
    );

    for (const product of products) {
      await this.add(
        { kind: "sync-product", productId: product.id },
        `magento-sync-product-${product.id}`,
      );
    }
  }

  private async syncProduct(productId: string): Promise<void> {
    const logPrefix = `[MAGENTO_SYNC] product=${productId}`;

    const product = await productService.findById(productId, {
      attributes: ["id", "name", "type"],
    });
    if (!product) {
      console.warn(`${logPrefix} produto não encontrado — ignorado.`);
      return;
    }
    // KIT nunca sincroniza com o Magento — código sintético, sem contrapartida
    // real no catálogo (mesma regra de BLING_API_FETCH).
    if (product.type === "KIT") return;

    const config = await productConfigService.findOne({
      where: {
        product_id: productId,
        unit_business_id: BLING_UNIT_BUSINESS_ID,
      },
      attributes: ["product_id", "unit_business_id", "sku", "gtin", "price", "average_cost"],
    });
    if (!config?.sku) {
      console.warn(`${logPrefix} sem SKU na unit business Bling — ignorado.`);
      return;
    }

    const magentoIntegration = await getMagentoIntegration("Magento");
    const magentoIdMap = await integrationMappingService.findExternalIdsMap(
      "PRODUCT",
      magentoIntegration.id,
      [productId],
    );
    const magentoIdFromMapping = magentoIdMap.get(productId) ?? null;

    const magentoProduct = await this.fetchMagentoProduct(
      magentoIdFromMapping,
      config.sku,
      product.name,
      logPrefix,
    );

    const resolvedPrice =
      magentoProduct?.price !== undefined && magentoProduct?.price !== null
        ? Number(magentoProduct.price)
        : Number(config.price ?? 0);

    await sequelize.transaction(async (transaction) => {
      await productConfigService.bulkUpdate(
        { price: resolvedPrice },
        {
          where: {
            product_id: productId,
            unit_business_id: BLING_UNIT_BUSINESS_ID,
          },
          transaction,
        },
      );

      await this.syncProductMapping({
        productId,
        sku: config.sku!,
        ean: config.gtin ?? null,
        productName: product.name,
        magentoProduct,
        magentoIntegration,
        logPrefix,
        transaction,
      });
    });

    await this.pushAverageCostToMagento(productId, magentoIntegration, logPrefix);
  }

  // ─── Magento: busca o produto já mapeado ───────────────────────────────────
  // external_id do integration_mapping é o entity_id do Magento (estável),
  // não o sku (que pode mudar) — por isso a busca é sempre via searchCriteria
  // (não existe GET /products/:id na REST API do Magento, só por sku). Sem
  // fallback pra sku/nome aqui — produto já mapeado que não resolve por id
  // foi excluído no Magento (cai pro unmapped normalmente).
  private async fetchMagentoProductById(
    magentoId: string,
    logPrefix: string,
  ): Promise<any | null> {
    try {
      const result = await magentoCatalogService.buscarProdutoPorId(magentoId);
      const items = result?.items ?? [];
      if (items.length === 1) return items[0];

      console.warn(
        `${logPrefix} Produto do Magento com id=${magentoId} (mapeado) não encontrado — pode ter sido excluído no Magento.`,
      );
      return null;
    } catch (error: any) {
      console.warn(
        `${logPrefix} Falha ao consultar produto no Magento por id | id=${magentoId} | erro=${error?.message}`,
      );
      return null;
    }
  }

  // ─── Magento: busca produto por SKU (primeira vez, sem mapping ainda) ──────
  // Se não achar por SKU, cai pro fallback por nome (fetchMagentoProductByName)
  // antes de desistir — cobre produto cujo SKU no Magento diverge do nosso.
  private async fetchMagentoProductBySku(
    sku: string,
    productName: string,
    logPrefix: string,
  ): Promise<any | null> {
    try {
      return await magentoCatalogService.obterProduto(sku);
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return await this.fetchMagentoProductByName(productName, sku, logPrefix);
      }

      console.warn(
        `${logPrefix} Falha ao consultar produto no Magento | sku=${sku} | erro=${error?.message}`,
      );
      return null;
    }
  }

  // ─── Magento: resolve o produto — por id (já mapeado) ou por sku/nome (1ª vez) ──
  private async fetchMagentoProduct(
    magentoId: string | null,
    sku: string,
    productName: string,
    logPrefix: string,
  ): Promise<any | null> {
    if (magentoId) {
      return await this.fetchMagentoProductById(magentoId, logPrefix);
    }
    return await this.fetchMagentoProductBySku(sku, productName, logPrefix);
  }

  // ─── Magento: fallback por nome quando o SKU não é encontrado ─────────────
  // Só aceita o match se vier exatamente 1 resultado e o nome bater
  // integralmente (normalizado) — nome ambíguo/parcial cai pro unmapped, não
  // arrisca vincular o produto errado.
  private async fetchMagentoProductByName(
    productName: string,
    sku: string,
    logPrefix: string,
  ): Promise<any | null> {
    if (!productName?.trim()) return null;

    try {
      const result = await magentoCatalogService.buscarProdutosPorNome(productName);
      const items = result?.items ?? [];
      if (items.length !== 1) return null;

      const normalize = (value: string) =>
        value?.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (normalize(items[0].name) !== normalize(productName)) return null;

      console.log(
        `${logPrefix} Produto do Magento resolvido por nome (SKU=${sku} não encontrado) | magento_sku=${items[0].sku}`,
      );
      return items[0];
    } catch (error: any) {
      console.warn(
        `${logPrefix} Falha ao buscar produto no Magento por nome | nome=${productName} | erro=${error?.message}`,
      );
      return null;
    }
  }

  // ─── Sincronização de produto com o Magento (mapping / unmapped) ──────────
  private async syncProductMapping(params: {
    productId: string;
    sku: string;
    ean: string | null;
    productName: string;
    magentoProduct: any | null;
    magentoIntegration: { id: string };
    logPrefix: string;
    transaction: Transaction;
  }): Promise<void> {
    const {
      productId,
      sku,
      ean,
      productName,
      magentoProduct,
      magentoIntegration,
      logPrefix,
      transaction,
    } = params;

    // unique_ean_integration_null_invoice é UNIQUE(ean, integrations_id)
    // WHERE invoice_id IS NULL — dois skus diferentes com o mesmo EAN na
    // mesma integração batem nesse índice, então o dedup precisa checar por
    // ean também, não só por sku (mas sempre escopado à integração, já que
    // o mesmo EAN pode legitimamente existir em integrações diferentes).
    const normalizedEan = ean && ean.trim() !== "" ? ean : null;
    const unmappedWhere = {
      invoice_id: null,
      integrations_id: magentoIntegration.id,
      ...(normalizedEan
        ? { [Op.or]: [{ sku }, { ean: normalizedEan }] }
        : { sku }),
    };

    if (!magentoProduct) {
      await unmappedInvoiceProductService.upsertByFind(
        unmappedWhere,
        { sku, ean: normalizedEan, product_name: productName, type: "ERROR_INTEGRATION" },
        {
          invoice_id: null,
          integrations_id: magentoIntegration.id,
          sku,
          ean: normalizedEan,
          product_name: productName,
          quantity: 0,
          reason: "Produto não encontrado no Magento",
          type: "ERROR_INTEGRATION",
          status: "UNMAPPED",
        },
        { transaction },
      );
      console.log(
        `${logPrefix} Produto não encontrado no Magento — unmapped registrado/atualizado | sku=${sku}`,
      );
      return;
    }

    await integrationMappingService.createOrUpdateIntegrationMapping(
      {
        entity_type: "PRODUCT",
        internal_id: productId,
        // external_id é o entity_id do Magento (estável), não o sku (que
        // pode ser renomeado no catálogo sem que o produto mude de fato).
        external_id: String(magentoProduct.id),
        integrations_id: magentoIntegration.id,
      },
      transaction,
    );

    // Produto resolvido no Magento (mapping novo ou já existente) — qualquer
    // unmapped antigo de "não encontrado" pro mesmo sku/ean fica obsoleto.
    const deletedUnmapped = await unmappedInvoiceProductService.bulkDelete({
      where: { ...unmappedWhere, status: "UNMAPPED" },
      transaction,
    });
    if (deletedUnmapped > 0) {
      console.log(
        `${logPrefix} ${deletedUnmapped} unmapped obsoleto(s) removido(s) | sku=${sku}`,
      );
    }

    console.log(
      `${logPrefix} Produto mapeado no Magento | sku=${sku} | magento_id=${magentoProduct.id} | magento_sku=${magentoProduct.sku ?? sku}`,
    );
  }

  // ─── custo_medio no Magento — best effort, fora da transaction ────────────
  private async pushAverageCostToMagento(
    productId: string,
    magentoIntegration: { id: string },
    logPrefix: string,
  ): Promise<void> {
    try {
      const config = await productConfigService.findOne({
        where: {
          product_id: productId,
          unit_business_id: BLING_UNIT_BUSINESS_ID,
        },
        attributes: ["average_cost"],
      });

      if (!config?.average_cost) return;

      const magentoIdMap = await integrationMappingService.findExternalIdsMap(
        "PRODUCT",
        magentoIntegration.id,
        [productId],
      );
      const magentoId = magentoIdMap.get(productId);
      // atualizarCustomAttribute (PUT /products/:sku) exige o sku atual —
      // resolve pelo id (estável) antes, já que o sku pode ter mudado desde
      // que o mapping foi criado.
      const magentoProductForCost = magentoId
        ? await this.fetchMagentoProductById(magentoId, logPrefix)
        : null;

      if (!magentoProductForCost?.sku) {
        console.log(
          `${logPrefix} Produto sem mapping no Magento — custo_medio não sincronizado.`,
        );
        return;
      }

      await magentoCatalogService.atualizarCustomAttribute(
        magentoProductForCost.sku,
        "custo_medio",
        Number(config.average_cost).toFixed(2),
      );
      console.log(
        `${logPrefix} custo_medio sincronizado para Magento: sku=${magentoProductForCost.sku} | average_cost=${config.average_cost}`,
      );
    } catch (error: any) {
      if (error?.response?.status === 404) {
        console.log(
          `${logPrefix} Produto não encontrado no Magento — custo_medio ignorado.`,
        );
      } else {
        console.warn(
          `${logPrefix} Falha ao sincronizar custo_medio para Magento | erro=${error?.message}`,
        );
      }
    }
  }
}
