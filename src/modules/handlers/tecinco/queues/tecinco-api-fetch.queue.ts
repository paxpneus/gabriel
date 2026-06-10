import { Job } from 'bullmq';
import { BaseQueueService } from '../../../../shared/utils/base-models/base-queue-service';
import { alertService } from '../../../../shared/providers/mail-provider/nodemailer.alert';
import { ProductConfig, Product } from '../../../inventory';
import Customer from '../../../sales/customers/customers.model';
import UnitBusiness from '../../../warehouse/unit-business/unit-business.model';
import { TCarProdutoPayload, TCarClientePayload, TCarResource, TCarAction } from '../service/tecinco/tecinco.types';

export interface TCarUpsertJobPayload {
  eventId: string;
  resource: TCarResource;
  action: TCarAction;
  companyId: string;
  branchId?: number;
  data: unknown;
}

function normalizeEan(ean?: string): string | undefined {
  if (!ean || ean.trim() === '' || ean.trim().toUpperCase() === 'SEM GTIN') return undefined;
  return ean.trim();
}

export class TCarUpsertQueue extends BaseQueueService<TCarUpsertJobPayload> {
  constructor(options: { workless?: boolean } = {}) {
    super('TCAR_UPSERT', {
      concurrency: 1,
      limiter: { max: 5, duration: 1000 },
      workless: options.workless,
    });
  }

  async process(job: Job<TCarUpsertJobPayload>): Promise<void> {
    const { resource, action, data, branchId } = job.data;

    console.log(`[TCAR_UPSERT] ${resource}.${action} | eventId=${job.data.eventId}`);

    switch (resource) {
      case 'product':
        await this.processProduct(action, data as TCarProdutoPayload, branchId);
        break;

      case 'customer':
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

    if (action === 'deleted') {
      const deleted = await Product.destroy({ where: { id_system: systemId } });
      console.log(`[TCAR_UPSERT] Produto deletado: id_system=${systemId} (${deleted} reg)`);
      return;
    }

    // fll_codigo é o número da filial na TeCinco — usa pra resolver UnitBusiness
    // fazemos isso antes do upsert para logar o warn cedo, mas não bloqueia o produto
    const filialNumber = String(data.fll_codigo ?? branchId ?? '').padStart(2, '0');

    const unitBusiness = filialNumber
      ? await UnitBusiness.findOne({ where: { number: filialNumber } })
      : null;

    if (!unitBusiness) {
      console.warn(`[TCAR_UPSERT] UnitBusiness não encontrada para fll_codigo=${filialNumber} — product_config será ignorado`);
    }

    const ean = normalizeEan(data.epctb_ean);

    const [product] = await Product.upsert(
      {
        id_system: systemId,
        name: data.epctb_nome?.trim() ?? '',
        ean,
        unit: data.epctb_unidade,
        gross_weight: data.epctb_pesobruto,
        net_weight: data.epctb_pesoliq,
        category: 'TIRE',
        source_payload: data as unknown as Record<string, unknown>,
      },
      { conflictFields: ['id_system'] },
    );

    if (!unitBusiness) return;

    await ProductConfig.upsert(
      {
        product_id: product.id,
        unit_business_id: unitBusiness.id,
        sku: systemId,
        price: data.epprc_preco ?? 0,
        supplier_cost_price: data.epcte_custcont ?? 0,
        average_cost: data.epcte_custcont ?? 0,
      },
      { conflictFields: ['product_id', 'unit_business_id'] },
    );

    console.log(`[TCAR_UPSERT] Produto upsertado: id_system=${systemId} | filial=${filialNumber}`);
  }

  // ─── Cliente ───────────────────────────────────────────────────────────────

  private async processCustomer(
    action: TCarAction,
    data: TCarClientePayload,
  ): Promise<void> {
    const systemId = String(data.cln_codigo);
    const document = data.cln_cpfcnpj?.replace(/\D/g, '') || null;

    if (action === 'deleted') {
      // Customer não tem id_system — deleta pelo document se disponível
      if (!document) {
        console.warn(`[TCAR_UPSERT] Delete de cliente cln_codigo=${systemId} sem document — ignorado`);
        return;
      }
      const deleted = await Customer.destroy({ where: { document } });
      console.log(`[TCAR_UPSERT] Cliente deletado: document=${document} (${deleted} reg)`);
      return;
    }

    if (!document) {
      console.warn(`[TCAR_UPSERT] Cliente cln_codigo=${systemId} sem CPF/CNPJ — ignorado`);
      return;
    }

    const name = data.cln_nome?.trim() ?? '';
    const type: 'F' | 'J' = data.cln_fisjur === 'J' ? 'J' : 'F';


    const existing = await Customer.findOne({ where: { document } });

    if (existing) {
      await existing.update({ name, type });
    } else {
      await Customer.create({ name, type, document });
    }

    console.log(`[TCAR_UPSERT] Cliente upsertado: document=${document}`);
  }

  protected override onFailed(job: Job<TCarUpsertJobPayload>, error: Error): void {
    alertService.sendAlert({
      severity: 'HIGH',
      title: 'TCarUpsertQueue — job esgotou tentativas',
      message: `Job: ${job.id} | Resource: ${job.data.resource} | Action: ${job.data.action} | EventId: ${job.data.eventId} | Erro: ${error.message}`,
    });
  }
}