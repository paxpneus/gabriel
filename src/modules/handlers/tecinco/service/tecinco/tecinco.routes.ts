import { Router, Request, Response } from 'express';
import { alertService } from '../../../../../shared/providers/mail-provider/nodemailer.alert';
import { TCarProdutoService } from '../produtos/produtos.service';
import TCarClienteService from '../clientes/clientes.service';
import { TCarUpsertJobPayload } from '../../queues/tecinco-api-fetch.queue';

const router = Router();

function getQueue(req: Request): { add: (payload: TCarUpsertJobPayload, jobId: string) => Promise<void> } {
  return req.app.locals.TCarUpsertQueue;
}

function extractItems(response: unknown): unknown[] {
  if (Array.isArray((response as any)?.data)) return (response as any).data;
  if (Array.isArray(response)) return response as unknown[];
  return [];
}

// ─── Sync produtos ────────────────────────────────────────────────────────────

router.post('/sync/products', async (req: Request, res: Response) => {
  try {
    const {
      companyId = req.app.locals.defaultCompanyId ?? 'default',
      branchId = 1,
      nome,
    } = req.body ?? {};

    const response = await new TCarProdutoService().listarProdutos(branchId, {
      nome: nome ? `${nome}+` : undefined,
    });

    const items = extractItems(response);
    const queue = getQueue(req);

    for (const produto of items) {
      const p = produto as any;
      await queue.add(
        { eventId: `sync-product-${p.epctb_codigo}-${Date.now()}`, resource: 'product', action: 'sync', companyId, branchId, data: p },
        `sync-product-${p.epctb_codigo}`,
      );
    }

    res.json({ status: 'received', enqueued: items.length, filter: nome ?? null });
  } catch (error: any) {
    alertService.sendAlert({ severity: 'MEDIUM', title: 'TeCinco Sync Products — erro', message: error.message });
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// ─── Sync clientes ────────────────────────────────────────────────────────────

router.post('/sync/customers', async (req: Request, res: Response) => {
  try {
    const {
      companyId = req.app.locals.defaultCompanyId ?? 'default',
      branchId = 1,
      alterado_desde,
    } = req.body ?? {};

    const response = await new TCarClienteService().listarClientes(branchId, { alterado_desde });

    const items = extractItems(response);
    const queue = getQueue(req);

    for (const cliente of items) {
      const c = cliente as any;
      await queue.add(
        { eventId: `sync-customer-${c.cln_codigo}-${Date.now()}`, resource: 'customer', action: 'sync', companyId, branchId, data: c },
        `sync-customer-${c.cln_codigo}`,
      );
    }

    res.json({ status: 'received', enqueued: items.length });
  } catch (error: any) {
    alertService.sendAlert({ severity: 'MEDIUM', title: 'TeCinco Sync Customers — erro', message: error.message });
    res.status(500).json({ status: 'error', error: error.message });
  }
});

export default router;