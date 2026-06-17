import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { TCarProdutoService } from "../service/produtos/produtos.service";
import TCarClienteService from "../service/clientes/clientes.service";
import { TCarConferenciaEstoqueService } from "../service/conferencias-estoque/conferencias-estoque.service";
import { TCarUpsertQueue } from "./tecinco-api-fetch.queue";
import { v4 as uuidv4 } from "uuid";

export interface TCarSyncJobPayload {
  branchId: number;
  companyId: string;
  alteradoDesde: string;
}

const BRANCH_IDS: number[] = (process.env.TCAR_BRANCH_IDS ?? "1")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);

const COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";
const PAGE_SIZE = 50;

function formatAlteradoDesde(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

async function* paginateTCar<T>(
  fetcher: (offset: number, limit: number) => Promise<any>,
): AsyncGenerator<T[]> {
  let offset = 0;
  while (true) {
    const response = await fetcher(offset, PAGE_SIZE);
    const items: T[] = Array.isArray(response?.data) ? response.data : [];
    if (!items.length) break;
    yield items;
    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
}

export class TCarSyncQueue extends BaseQueueService<TCarSyncJobPayload> {
  private readonly upsertQueue: TCarUpsertQueue;

  constructor(options: { workless?: boolean } = {}) {
    super("TCAR_SYNC", {
      concurrency: 1,
      workless: options.workless,
    });
    this.upsertQueue = new TCarUpsertQueue({ workless: false });
  }

  async process(job: Job<TCarSyncJobPayload>): Promise<void> {
    const { branchId, companyId, alteradoDesde } = job.data;

    console.log(
      `[TCAR_SYNC] Iniciando sync | branchId=${branchId} | alterado_desde=${alteradoDesde}`,
    );

    await this.syncProdutos(branchId, companyId, alteradoDesde);
    await this.syncClientes(branchId, companyId, alteradoDesde);
    await this.syncNotasFiscais(branchId, companyId, alteradoDesde);

    console.log(`[TCAR_SYNC] Sync concluído | branchId=${branchId}`);
  }

  // ─── Produtos ───────────────────────────────────────────────────────────────

  private async syncProdutos(
    branchId: number,
    companyId: string,
    alteradoDesde: string,
  ): Promise<void> {
    const service = new TCarProdutoService();
    let count = 0;

    for await (const page of paginateTCar((offset, limit) =>
      service.listarProdutos(branchId, { offset, limit, alterado_desde: alteradoDesde }),
    )) {
      for (const produto of page) {
        const p = produto as any;
        const systemId = String(p.epctb_codigo);

        await this.upsertQueue.add(
          {
            eventId: `sync-product-${branchId}-${systemId}-${Date.now()}`,
            resource: "product",
            action: "sync",
            companyId,
            branchId,
            data: p,
          },
          `sync-product-${branchId}-${systemId}-${Date.now()}`,
        );

        count++;
      }
    }

    console.log(`[TCAR_SYNC] Produtos enfileirados: ${count} | branchId=${branchId}`);
  }

  // ─── Clientes ───────────────────────────────────────────────────────────────

  private async syncClientes(
    branchId: number,
    companyId: string,
    alteradoDesde: string,
  ): Promise<void> {
    const service = new TCarClienteService();
    let count = 0;

    for await (const page of paginateTCar((offset, limit) =>
      service.listarClientes(branchId, { offset, limit, alterado_desde: alteradoDesde }),
    )) {
      for (const cliente of page) {
        const c = cliente as any;
        const systemId = String(c.cln_codigo ?? c.CLN_CODIGO);

        await this.upsertQueue.add(
          {
            eventId: `sync-customer-${branchId}-${systemId}-${Date.now()}`,
            resource: "customer",
            action: "sync",
            companyId,
            branchId,
            data: c,
          },
          `sync-customer-${branchId}-${systemId}-${Date.now()}`,
        );

        count++;
      }
    }

    console.log(`[TCAR_SYNC] Clientes enfileirados: ${count} | branchId=${branchId}`);
  }

  // ─── Notas Fiscais ──────────────────────────────────────────────────────────

  private async syncNotasFiscais(
    branchId: number,
    companyId: string,
    alteradoDesde: string,
  ): Promise<void> {
    const service = new TCarConferenciaEstoqueService();
    let count = 0;

    // alterado_desde não é suportado diretamente em notas-fiscais,
    // mas data_movimento_inicio serve como proxy razoável
    const dataInicio = alteradoDesde.split(" ")[0]; // só a data

    const resultado = await service.listarNotasFiscais(branchId, {
      modelo_documento: 55,
      situacao: "A",
      entrada_saida: "E",
      data_movimento_inicio: dataInicio,
      limit: 500,
    });

    const notas: any[] = (resultado?.data ?? []).filter(
      (n: any) => n.entrada_saida === "E" && n.chave_nfe,
    );

    for (const nota of notas) {
      const { chave } = nota;

      await this.upsertQueue.add(
        {
          eventId: `sync-invoice-xml-${branchId}-${chave.nota}-${uuidv4()}`,
          resource: "invoice_xml",
          action: "sync",
          companyId,
          branchId,
          data: {
            numero: chave.nota,
            entrada_saida: nota.entrada_saida,
            cln_codigo: chave.cln_codigo,
            tpneg_codigo: chave.tpneg_codigo,
            ntz_codigo: chave.ntz_codigo,
            opr_codigo: chave.opr_codigo,
            serie: chave.serie,
            seq_cancelamento: chave.seq_cancelamento ?? "0",
          },
        },
        `sync-invoice-xml-${branchId}-${chave.nota}`,
      );

      count++;
    }

    console.log(`[TCAR_SYNC] Notas enfileiradas: ${count} | branchId=${branchId}`);
  }

  protected override onFailed(
    job: Job<TCarSyncJobPayload>,
    error: Error,
  ): void {
    alertService.sendAlert({
      severity: "MEDIUM",
      title: "TCarSyncQueue — job falhou",
      message: `branchId=${job.data.branchId} | alterado_desde=${job.data.alteradoDesde} | Erro: ${error.message}`,
    });
  }
}

// ─── Scheduler: dispara o sync a cada 2 horas ─────────────────────────────────

export function scheduleTCarSync() {
  const syncQueue = new TCarSyncQueue();

  // Dispara imediatamente na inicialização e depois a cada 2h
  const dispatchSync = async () => {
    const alteradoDesde = formatAlteradoDesde(
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    );

    for (const branchId of BRANCH_IDS) {
      await syncQueue.add(
        {
          branchId,
          companyId: COMPANY_ID,
          alteradoDesde,
        },
        `tcar-sync-${branchId}-${Date.now()}`,
      );

      console.log(
        `[TCAR_SYNC] Job agendado | branchId=${branchId} | alterado_desde=${alteradoDesde}`,
      );
    }
  };

  dispatchSync();
  setInterval(dispatchSync, 2 * 60 * 60 * 1000);
}