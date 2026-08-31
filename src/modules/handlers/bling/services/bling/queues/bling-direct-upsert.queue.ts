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
import Contact from "../../../../../sales/contacts/contacts.model";
import { logDbError } from "../../../../../../shared/utils/logging/db-errors-logs";
import productController from "../../../../../inventory/products/product.controller";
import unitBusinessController from "../../../../../company/unit-business/unit-business.controller";
import unitBusinessService from "../../../../../company/unit-business/unit-business.service";
import integrationMappingService from "../../../../../integrations/integration-mapping/integration-mapping.service";
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
      maxProcessingMs: 60_000,

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

    const integration = await getBlingIntegration("Bling");

    const existing = await SupplierMapping.findOne({
      where: { product_id: product.id, integrations_id: integration.id },
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
        integrations_id: integration.id,
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
    const logPrefix = `[BLING_DIRECT_UPSERT] upsertContact id_system=${data.id_system} type=${data.type}`;

    let existing = (await integrationMappingService.findEntityByMapping(
      "CONTACT",
      integrationsId,
      data.id_system,
    )) as Contact | null;

    if (existing) {
      console.log(`${logPrefix} — contato resolvido via integration mapping`);
    } else {
      existing = await Contact.findOne({
        where: {
          id_system: data.id_system,
          type: data.type,
          integrations_id: integrationsId,
          unit_business_id: unitBusinessId,
        },
      });
    }

    let contact: Contact;

    if (existing) {
      await existing.update({
        name: data.name,
        integrations_id: integrationsId,
        unit_business_id: unitBusinessId,
      });
      contact = existing;
    } else {
      contact = await Contact.create({
        id_system: data.id_system,
        name: data.name,
        type: data.type,
        integrations_id: integrationsId,
        unit_business_id: unitBusinessId,
      });
    }

    await integrationMappingService.createOrUpdateIntegrationMapping({
      entity_type: "CONTACT",
      internal_id: contact.id,
      external_id: data.id_system,
      integrations_id: integrationsId,
    });

    console.log(
      `${logPrefix} — Contact ${existing ? "atualizado" : "criado"}, integration mapping garantido`,
    );
  }

  private async handleDelete(resource: string, blingId: number): Promise<void> {
    switch (resource) {
      case "product": {
        // Produto nunca é deletado pelo sistema — fica de histórico, só
        // desativado (is_active=false) quando encontrado via integration
        // mapping. Mesma regra aplicada pra Tecinco em tecinco-api-fetch.queue.ts.
        const integrationsId = (await getBlingIntegration("Bling")).id;
        const mapped = await integrationMappingService.findEntityByMapping(
          "PRODUCT",
          integrationsId,
          String(blingId),
        );
        if (mapped) {
          await (mapped as typeof Product.prototype).update({
            is_active: false,
          });
          console.log(
            `[BLING_DIRECT_UPSERT] Produto desativado (is_active=false) blingId=${blingId}, histórico mantido`,
          );
        } else {
          console.warn(
            `[BLING_DIRECT_UPSERT] Produto não encontrado via mapping pra blingId=${blingId}, nada a desativar`,
          );
        }
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
