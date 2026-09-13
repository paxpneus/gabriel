import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  getMercadoLivreIntegration,
  handleMercadoLivreOAuthCallback,
} from "../api/mercado-livre_api.service";
import { MarketplaceWebhookSyncQueue } from "../../marketplace/queues/marketplace-webhook-sync.queue";

const router = Router();

// Este arquivo mora numa pasta-folha chamada "mercado_livre" (underscore),
// separada do resto do módulo "mercado-livre" (hífen) de propósito — o
// mount path é literalmente o nome desta pasta (src/config/routes.ts's
// loadModules), e as rotas obrigatórias exigem "/api/mercado_livre/...".
// Ver plano (Etapa 1, seção 1.1) para a justificativa completa.

// ─── OAuth ────────────────────────────────────────────────────────────────

router.get("/auth/mercado_livre", async (req: Request, res: Response) => {
  const integration = await getMercadoLivreIntegration();
  const configToken = integration.tokens;

  const newState = uuidv4();
  await configToken.update({ oauth_state: newState });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: configToken.client_id,
    state: newState,
    redirect_uri: configToken.callback_url,
  });

  res.redirect(`https://auth.mercadolibre.com.br/authorization?${params.toString()}`);
});

router.get("/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as Record<string, string>;

  const integration = await getMercadoLivreIntegration();
  const configToken = integration.tokens;

  if (state !== configToken.oauth_state) {
    res.status(400).json({ error: "State inválido" });
    return;
  }

  await handleMercadoLivreOAuthCallback(code);
  res.status(200).json({ ok: true, message: "Tokens salvos com sucesso" });
});

// ─── Webhook ──────────────────────────────────────────────────────────────

// Payload do ML: {resource: "/orders/123"|"/shipments/456", topic:
// "orders_v2"|"shipments", ...} — NÃO confia no payload pra dado nenhum, só
// usa pra saber qual recurso re-buscar ao vivo e em qual direção.
//
// TODO: sem verificação de assinatura por ora (mesmo estado honesto do
// webhook do Bling hoje, também não enforçado) — a rota já re-busca ao vivo
// e nunca confia no corpo do payload para dado nenhum, então a exposição
// fica limitada a "um atacante consegue nos fazer re-buscar o estado real e
// atual de um pedido real um pouco mais cedo".
router.post("/webhook", async (req: Request, res: Response) => {
  const queue: MarketplaceWebhookSyncQueue = req.app.locals.MarketplaceWebhookSyncQueue;

  const topic =
    req.body?.topic === "shipments"
      ? "shipments"
      : req.body?.topic === "orders_v2"
        ? "orders"
        : null;

  if (!topic) {
    res.status(200).json({ ignored: true });
    return;
  }

  const resourceId = String(req.body.resource ?? "").split("/").pop();
  if (!resourceId) {
    res.status(200).json({ ignored: true });
    return;
  }

  await queue.add({ store: "MercadoLivre", topic, resourceId }, `marketplace-webhook-${topic}-${resourceId}`);
  res.status(200).json({ received: true });
});

export default router;
