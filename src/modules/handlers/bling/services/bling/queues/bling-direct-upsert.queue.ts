import { WebhookQueuePayload, DirectUpsertPayload } from './../bling-webhook.types';
import { Job } from 'bullmq';
import { BaseQueueService } from '../../../../../../shared/utils/base-models/base-queue-service';
import { Product } from '../../../../../inventory';
import { Stock } from '../../../../../inventory/index';
import { SupplierMapping } from '../../../../../inventory';
import { Supplier } from '../../../../../inventory';
import { alertService } from '../../../../../../shared/providers/mail-provider/nodemailer.alert';
import { Invoice, UnitBusiness } from '../../../../../warehouse';

export interface DirectUpsertJobPayload extends WebhookQueuePayload {
  directUpsert: DirectUpsertPayload;
}

export class BlingDirectUpsertQueue extends BaseQueueService<DirectUpsertJobPayload> {
  constructor(options: { workless?: boolean } = {}) {
    super('BLING_DIRECT_UPSERT', {
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

    console.log(`[BLING_DIRECT_UPSERT] Processando ${resource}.${action} | eventId: ${eventId}`);

    try {
      switch (directUpsert.table) {
        case 'products':
          await this.upsertProduct(directUpsert.data);
          break;

        case 'stocks':
          await this.upsertStock(directUpsert.data);
          break;

        case 'product_supplier_maps':
          await this.upsertSupplierMapping(directUpsert.data);
          break;

        case 'suppliers':
          await this.upsertSupplier(directUpsert.data);
          break;

        case 'delete':
          await this.handleDelete(directUpsert.resource, directUpsert.blingId);
          break;

        default:
          console.warn(`[BLING_DIRECT_UPSERT] Tabela desconhecida no payload`, directUpsert);
      }
    } catch (error: any) {
      console.error(`[BLING_DIRECT_UPSERT] Erro ao processar job ${job.id}:`, error);
      throw error; // relança para BullMQ registrar falha e fazer retry
    }
  }

  // ─── Handlers por tabela ──────────────────────────────────────────────────

  private async upsertProduct(
  data: Extract<DirectUpsertPayload, { table: 'products' }>['data'],
): Promise<void> {
  if (!data.sku) {
    console.warn('[BLING_DIRECT_UPSERT] Produto sem SKU, ignorando upsert parcial', data);
    return;
  }

  const [product, created] = await Product.findOrCreate({
    where: { id_system: String(data.blingId) },
    defaults: {
      name: data.name,
      sku: data.sku,
      id_system: String(data.blingId),
      ean: `PENDING-${data.blingId}`,
    },
  });

  if (!created) {
    // só atualiza os campos que vieram — nunca sobrescreve com PENDING
    const fieldsToUpdate: Record<string, any> = {};
    if (data.name) fieldsToUpdate.name = data.name;
    if (data.sku)  fieldsToUpdate.sku  = data.sku;

    if (Object.keys(fieldsToUpdate).length > 0) {
      await product.update(fieldsToUpdate);
    }
  }

  console.log(`[BLING_DIRECT_UPSERT] Produto ${created ? 'criado' : 'atualizado parcialmente'}: sku=${data.sku}`);
}
 private async upsertStock(
  data: Extract<DirectUpsertPayload, { table: 'stocks' }>['data'],
): Promise<void> {
  const product = await Product.findOne({
    where: { id_system: String(data.productBlingId) },
  });

  if (!product) {
    throw new Error(
      `[BLING_DIRECT_UPSERT] Produto blingId=${data.productBlingId} não encontrado. Retry agendado.`,
    );
  }

  // Todo estoque vindo da Bling pertence ao CD Minas Gerais
  const unitBusiness = await UnitBusiness.findOne({
    where: { cnpj: '02316749002111' },
  });

  if (!unitBusiness) {
    throw new Error('[BLING_DIRECT_UPSERT] UnitBusiness CD Minas Gerais não encontrado.');
  }

  await Stock.upsert({
    product_id: product.id,
    quantity: data.quantity,
    unit_business_id: unitBusiness.id,
  }, {
    conflictFields: ['product_id'],
  });
}

  private async upsertSupplierMapping(
  data: Extract<DirectUpsertPayload, { table: 'product_supplier_maps' }>['data'],
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
    if (data.supplier_product_code) fieldsToUpdate.supplier_product_code = data.supplier_product_code;

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

  console.log(`[BLING_DIRECT_UPSERT] SupplierMapping ${existing ? 'atualizado parcialmente' : 'criado'}: productId=${product.id}`);
}

  private async upsertSupplier(
    data: Extract<DirectUpsertPayload, { table: 'suppliers' }>['data'],
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
      case 'product': {
        const deleted = await Product.destroy({ where: { sku: String(blingId) } });
        console.log(`[BLING_DIRECT_UPSERT] Produto deletado blingId=${blingId}: ${deleted} reg(s)`);
        break;
      }

      case 'product_supplier': {
        console.warn(
          `[BLING_DIRECT_UPSERT] Delete de product_supplier blingId=${blingId} — sem chave direta. Ignorado.`,
        );
        break;
      }

      case 'invoice':
      case 'consumer_invoice': {
        const deleted = await Invoice.destroy({ where: { id_system: String(blingId) } });
        console.log(`[BLING_DIRECT_UPSERT] Invoice deletada blingId=${blingId}: ${deleted} reg(s)`);
        break;
      }

      default:
        console.warn(
          `[BLING_DIRECT_UPSERT] Sem handler de delete para resource=${resource}, blingId=${blingId}`,
        );
    }
  }

  protected override onFailed(job: Job<DirectUpsertJobPayload>, error: Error): void {
    alertService.sendAlert({
      severity: 'HIGH',
      title: 'BlingDirectUpsertQueue — job esgotou tentativas',
      message: `Job: ${job.id} | Resource: ${job.data.resource} | Action: ${job.data.action} | EventId: ${job.data.eventId} | Erro: ${error.message}`,
    });
  }
}