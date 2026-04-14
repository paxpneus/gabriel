import { Router, Request, Response } from 'express';
import { getBlingIntegration, handleBlingOAuthCallback } from '../../api/bling_api.service';
import { v4 as uuidv4 } from 'uuid';
import { alertService } from '../../../../../shared/providers/mail-provider/nodemailer.alert';
import { orchestrateBlingWebhook } from './bling-webhook.orchestrator';
import { BlingWebhookEnvelope } from './bling-webhook.types';

const router = Router();

// ─── Webhook ──────────────────────────────────────────────────────────────────

/**
 * POST /bling-orders/webhook
 *
 * Endpoint unificado para todos os eventos Bling via webhook.
 *
 * Recursos suportados:
 *   order            → BlingOrderQueue (fila legada)
 *   product          → blingDirectUpsertQueue + blingApiFetchQueue
 *   stock            → blingDirectUpsertQueue
 *   invoice          → blingApiFetchQueue
 *   consumer_invoice → blingApiFetchQueue
 *   product_supplier → blingDirectUpsertQueue + blingApiFetchQueue
 *   virtual_stock    → ignorado (derivado de stock)
 *
 * Autenticação: HMAC SHA-256 via header X-Bling-Signature-256
 *
 * O endpoint responde 200 imediatamente (idempotente) — qualquer
 * processamento pesado ocorre de forma assíncrona nas filas.
 *
 * Payload esperado (envelope Bling):
 * {
 *   "eventId": "01945027-150e-72b4-e7cf-4943a042cd9c",
 *   "date": "2025-01-10T12:18:46Z",
 *   "version": "v1",
 *   "event": "<resource>.<action>",
 *   "companyId": "d4475...",
 *   "data": { ... }
 * }
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    console.log('[Webhook] Headers:', JSON.stringify(req.headers));
    console.log('[Webhook] Body:', JSON.stringify(req.body));

    const envelope = req.body as BlingWebhookEnvelope;

    // Guard mínimo antes de qualquer processamento
    if (!envelope?.event || !envelope?.data) {
      res.status(200).json({ ignored: true, reason: 'Missing event or data' });
      return;
    }

    const signatureHeader = (req.headers['x-bling-signature-256'] as string) ?? '';

    // rawBody precisa ser preservado para validação HMAC.
    // Recomenda-se usar express.raw() antes deste router para ter req.rawBody.
    // Fallback: re-serializar (funciona se o payload não foi modificado pelo middleware).
    const rawBody: string =
      (req as any).rawBody ?? JSON.stringify(req.body);

    const integration = await getBlingIntegration();
    const clientSecret: string = integration.tokens.client_secret;

    const result = await orchestrateBlingWebhook(
      envelope,
      rawBody,
      signatureHeader,
      {
        blingOrderQueue: req.app.locals.BlingOrderQueue,
        blingDirectUpsertQueue: req.app.locals.BlingDirectUpsertQueue, // TODO FILA — registrar no app.locals
        blingApiFetchQueue: req.app.locals.BlingApiFetchQueue,         // TODO FILA — registrar no app.locals
        clientSecret,
      },
    );

    if (result.status === 'error') {
      // Assinatura inválida → 401 para que o Bling saiba que houve problema
      // (não faz retentativa automática neste caso, mas registra o erro)
      console.warn('[Webhook] Signature validation failed:', result.reason);
      res.status(401).json({ error: result.reason });
      return;
    }

    // 200 para tudo mais (received ou ignored) — garante idempotência e
    // evita que o Bling marque o endpoint como falho e desabilite o webhook.
    res.status(200).json({ status: result.status, reason: result.reason });
  } catch (error: any) {
    alertService.sendAlert({
      severity: 'HIGH',
      title: 'Webhook Bling — erro inesperado no orquestrador',
      message: `Evento: "${req.body?.event}" | EventId: "${req.body?.eventId}" | Erro: ${error.message}`,
    });

    // Retorna 200 mesmo em erro interno para evitar retentativas indevidas.
    // O alerta já notifica o time para investigar.
    res.status(200).json({ status: 'error', error: error.message });
  }
});

// ─── OAuth ────────────────────────────────────────────────────────────────────

router.get('/auth/bling', async (req: Request, res: Response) => {
  const integration = await getBlingIntegration();
  const configToken = integration.tokens;

  const newState = uuidv4();
  await configToken.update({ oauth_state: newState });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: configToken.client_id,
    state: newState,
    redirect_uri: configToken.callback_url,
  });

  res.redirect(`https://www.bling.com.br/Api/v3/oauth/authorize?${params.toString()}`);
});

router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as Record<string, string>;

  const integration = await getBlingIntegration();
  const configToken = integration.tokens;

  if (state !== configToken.oauth_state) {
    res.status(400).json({ error: 'State inválido' });
    return;
  }

  await handleBlingOAuthCallback(code);
  res.status(200).json({ ok: true, message: 'Tokens salvos com sucesso' });
});

export default router;