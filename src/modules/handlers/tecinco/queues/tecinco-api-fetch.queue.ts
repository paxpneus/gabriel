import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import {
  ProductConfig,
  Product,
  SupplierMapping,
  Stock,
} from "../../../inventory";
import Customer from "../../../sales/customers/customers.model";
import UnitBusiness from "../../../warehouse/unit-business/unit-business.model";
import {
  TCarProdutoPayload,
  TCarClientePayload,
  TCarResource,
  TCarAction,
} from "../service/tecinco/tecinco.types";
import { getTCarIntegration } from "../api/tecinco_api";

export interface TCarUpsertJobPayload {
  eventId: string;
  resource: TCarResource;
  action: TCarAction;
  companyId: string;
  branchId?: number;
  data: unknown;
}

function normalizeEan(ean?: string): string | undefined {
  if (!ean || ean.trim() === "" || ean.trim().toUpperCase() === "SEM GTIN")
    return undefined;
  return ean.trim();
}

export class TCarUpsertQueue extends BaseQueueService<TCarUpsertJobPayload> {
  constructor(options: { workless?: boolean } = {}) {
    super("TCAR_UPSERT", {
      concurrency: 1,
      limiter: { max: 5, duration: 1000 },
      workless: options.workless,
    });
  }

  async process(job: Job<TCarUpsertJobPayload>): Promise<void> {
    const { resource, action, data, branchId } = job.data;

    console.log(
      `[TCAR_UPSERT] ${resource}.${action} | eventId=${job.data.eventId}`,
    );

    switch (resource) {
      case "product":
        await this.processProduct(action, data as TCarProdutoPayload, branchId);
        break;

      case "customer":
        await this.processCustomer(action, data as TCarClientePayload);
        break;

      default:
        console.warn(`[TCAR_UPSERT] Resource desconhecido: ${resource}`);
    }
  }

  // ─── Produto ───────────────────────────────────────────────────────────────

  private async processProduct(
    action: TCarAction,
    data: TCarProdutoPayload,
    branchId?: number,
  ): Promise<void> {
    const systemId = String(data.epctb_codigo);

    if (action === "deleted") {
      const deleted = await Product.destroy({ where: { id_system: systemId } });
      console.log(
        `[TCAR_UPSERT] Produto deletado: id_system=${systemId} (${deleted} reg)`,
      );
      return;
    }

    const filialNumber = String(data.fll_codigo ?? branchId ?? "").padStart(
      2,
      "0",
    );
    const unitBusiness = filialNumber
      ? await UnitBusiness.findOne({ where: { number: filialNumber } })
      : null;

    if (!unitBusiness) {
      console.warn(
        `[TCAR_UPSERT] UnitBusiness não encontrada para fll_codigo=${filialNumber} — product_config será ignorado`,
      );
    }

    const integrations = await getTCarIntegration("Tecinco");
    const ean = normalizeEan(data.epctb_ean);

    // ─── Verifica se já existe produto com esse EAN de outra integração ──────
    // Se existir e NÃO for da Tecinco, apenas registra o SupplierMapping (de x para)
    // e NÃO faz upsert do produto em si
    if (ean) {
      const existingProduct = await Product.findOne({
        where: { ean },
      });

      if (
        existingProduct &&
        existingProduct.integrations_id !== integrations.id
      ) {
        console.log(
          `[TCAR_UPSERT] Produto EAN=${ean} pertence a outra integração (id=${existingProduct.integrations_id}) — registrando SupplierMapping apenas`,
        );

        // CNPJ do emitente/fornecedor Tecinco — precisa vir da UnitBusiness
        // ou de um campo fixo configurado para a integração
        const supplierCnpj = unitBusiness?.cnpj ?? null;

        if (supplierCnpj) {
          const existingMapping = await SupplierMapping.findOne({
            where: {
              product_id: existingProduct.id,
              supplier_cnpj: supplierCnpj,
            },
          });

          if (existingMapping) {
            await existingMapping.update({
              supplier_product_code: ean,
            });
          } else {
            await SupplierMapping.create({
              product_id: existingProduct.id,
              supplier_cnpj: supplierCnpj,
              supplier_product_code: ean,
            });
          }

          console.log(
            `[TCAR_UPSERT] SupplierMapping ${existingMapping ? "atualizado" : "criado"}: product_id=${existingProduct.id} | sku_tecinco=${systemId} | cnpj=${supplierCnpj}`,
          );
        } else {
          console.warn(
            `[TCAR_UPSERT] CNPJ do fornecedor Tecinco não resolvível para filial=${filialNumber} — SupplierMapping não registrado`,
          );
        }

        return; // não toca no produto de outra integração
      }
    }

    // ─── Produto é da Tecinco (ou não existe ainda) — faz upsert normal ──────
    const [product] = await Product.upsert(
      {
        id_system: systemId,
        name: data.epctb_nome?.trim() ?? "",
        ean,
        unit: data.epctb_unidade,
        gross_weight: data.epctb_pesobruto,
        net_weight: data.epctb_pesoliq,
        category: "TIRE",
        integrations_id: integrations.id,
        source_payload: data as unknown as Record<string, unknown>,
      },
      { conflictFields: ["id_system"] },
    );

    // ─── SupplierMapping para produtos próprios da Tecinco também ────────────
    // Permite que o findProductForInvoiceItem resolva por supplier_product_code
    const supplierCnpj = unitBusiness?.cnpj ?? null;

    if (supplierCnpj) {
      const existingMapping = await SupplierMapping.findOne({
        where: { product_id: product.id, supplier_cnpj: supplierCnpj },
      });

      if (existingMapping) {
        await existingMapping.update({ supplier_product_code: ean });
      } else if (!existingMapping && ean) {
        await SupplierMapping.create({
          product_id: product.id,
          supplier_cnpj: supplierCnpj,
          supplier_product_code: ean,
        });
      }
    }

    if (!unitBusiness) return;

    // ─── Upsert de estoque ────────────────────────────────────────────────────
    const stockQty = Number(data.epcte_estoque ?? 0);
    const entryUnitCost = Number(data.epcte_custcont ?? 0);

    const existingStock = await Stock.findOne({
      where: { product_id: product.id, unit_business_id: unitBusiness.id },
    });

    const oldQuantity = Number(existingStock?.quantity ?? 0);
    const oldTotalPrice = Number(existingStock?.total_price ?? 0);

    const newAverageCost =
      entryUnitCost > 0
        ? entryUnitCost
        : oldQuantity > 0
          ? oldTotalPrice / oldQuantity
          : 0;

    await ProductConfig.upsert(
      {
        product_id: product.id,
        unit_business_id: unitBusiness.id,
        sku: systemId,
        price: data.epprc_preco ?? 0,
        supplier_cost_price: entryUnitCost,
        average_cost: newAverageCost,
        average_cost_updated_at: new Date(),
      },
      { conflictFields: ["product_id", "unit_business_id"] },
    );

    await Stock.upsert(
      {
        product_id: product.id,
        unit_business_id: unitBusiness.id,
        quantity: stockQty,
        total_price: stockQty * newAverageCost,
      },
      { conflictFields: ["product_id", "unit_business_id"] },
    );

    console.log(
      `[TCAR_UPSERT] Stock upsertado: id_system=${systemId} | qty=${stockQty} | avg_cost=${newAverageCost.toFixed(4)} | total_price=${(stockQty * newAverageCost).toFixed(2)}`,
    );
  }

  // ─── Cliente ───────────────────────────────────────────────────────────────

  private async processCustomer(
    action: TCarAction,
    data: TCarClientePayload,
  ): Promise<void> {
    const systemId = String(data.cln_codigo);
    const document = data.cln_cpfcnpj?.replace(/\D/g, "") || null;

    if (action === "deleted") {
      // Customer não tem id_system — deleta pelo document se disponível
      if (!document) {
        console.warn(
          `[TCAR_UPSERT] Delete de cliente cln_codigo=${systemId} sem document — ignorado`,
        );
        return;
      }
      const deleted = await Customer.destroy({ where: { document } });
      console.log(
        `[TCAR_UPSERT] Cliente deletado: document=${document} (${deleted} reg)`,
      );
      return;
    }

    if (!document) {
      console.warn(
        `[TCAR_UPSERT] Cliente cln_codigo=${systemId} sem CPF/CNPJ — ignorado`,
      );
      return;
    }

    const name = data.cln_nome?.trim() ?? "";
    const type: "F" | "J" = data.cln_fisjur === "J" ? "J" : "F";

    const existing = await Customer.findOne({ where: { document } });

    if (existing) {
      await existing.update({ name, type });
    } else {
      await Customer.create({ name, type, document });
    }

    console.log(`[TCAR_UPSERT] Cliente upsertado: document=${document}`);
  }

  protected override onFailed(
    job: Job<TCarUpsertJobPayload>,
    error: Error,
  ): void {
    alertService.sendAlert({
      severity: "HIGH",
      title: "TCarUpsertQueue — job esgotou tentativas",
      message: `Job: ${job.id} | Resource: ${job.data.resource} | Action: ${job.data.action} | EventId: ${job.data.eventId} | Erro: ${error.message}`,
    });
  }
}
