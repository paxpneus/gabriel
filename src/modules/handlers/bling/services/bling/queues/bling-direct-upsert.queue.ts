import { WebhookQueuePayload, DirectUpsertPayload } from './../bling-webhook.types';
import { Job } from 'bullmq';
import { BaseQueueService } from '../../../../../../shared/utils/base-models/base-queue-service';
import { Product } from '../../../../../inventory';
import { Stock } from '../../../../../inventory/index';
import { SupplierMapping } from '../../../../../inventory';
import { alertService } from '../../../../../../shared/providers/mail-provider/nodemailer.alert';
import { Invoice } from '../../../../../warehouse';

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

        case 'delete':
          await this.handleDelete(directUpsert.resource, directUpsert.blingId);
          break;

        default:
          console.warn(`[BLING_DIRECT_UPSERT] Tabela desconhecida no payload`, directUpsert);
      }
    } catch (error: any) {
      console.error(`[BLING_DIRECT_UPSERT] Erro ao processar job ${job.id}:`, error.message);
      throw error; // relança para BullMQ registrar falha e fazer retry
    }
  }

  // ─── Handlers por tabela ──────────────────────────────────────────────────

  private async upsertProduct(
    data: Extract<DirectUpsertPayload, { table: 'products' }>['data'],
  ): Promise<void> {
    // O webhook de produto não traz EAN.
    // O worker ApiFetch irá complementar com o EAN real após buscar na Bling.
    // Usamos sku como chave natural de upsert.
    if (!data.sku) {
      console.warn('[BLING_DIRECT_UPSERT] Produto sem SKU, ignorando upsert parcial', data);
      return;
    }

    await Product.upsert({
      name: data.name,
      sku: data.sku,
      id_system: String(data.blingId),
      // EAN é required — placeholder até ApiFetch completar
      ean: data.ean ?? `PENDING-${data.blingId}`,
    });

    console.log(`[BLING_DIRECT_UPSERT] Produto upsertado: sku=${data.sku}`);
  }

  private async upsertStock(
    data: Extract<DirectUpsertPayload, { table: 'stocks' }>['data'],
  ): Promise<void> {
    // Resolve product_id UUID a partir do blingId (sku = blingId como string é o fallback).
    // Se o produto ainda não existir, o retry do BullMQ dará tempo para o job de produto ser processado.
    const product = await Product.findOne({
      where: { sku: String(data.productBlingId) },
    });

    if (!product) {
      throw new Error(
        `[BLING_DIRECT_UPSERT] Produto blingId=${data.productBlingId} não encontrado. Retry agendado.`,
      );
    }

    await Stock.upsert({
      product_id: product.id,
      quantity: data.quantity,
    });

    console.log(
      `[BLING_DIRECT_UPSERT] Estoque upsertado: productId=${product.id}, qty=${data.quantity}`,
    );
  }

  private async upsertSupplierMapping(
    data: Extract<DirectUpsertPayload, { table: 'product_supplier_maps' }>['data'],
  ): Promise<void> {
    // supplier_cnpj virá do worker ApiFetch após buscar o fornecedor na Bling.
    // Aqui persiste com placeholder; ApiFetch fará update posterior.
    const product = await Product.findOne({
      where: { sku: String(data.productBlingId) },
    });

    if (!product) {
      throw new Error(
        `[BLING_DIRECT_UPSERT] Produto blingId=${data.productBlingId} não encontrado para supplier mapping. Retry agendado.`,
      );
    }

    await SupplierMapping.upsert({
      product_id: product.id,
      supplier_cnpj: `PENDING-${data.supplierBlingId}`, // ApiFetch irá atualizar
      supplier_product_code: data.supplier_product_code,
    });

    console.log(
      `[BLING_DIRECT_UPSERT] SupplierMapping upsertado: productId=${product.id}`,
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