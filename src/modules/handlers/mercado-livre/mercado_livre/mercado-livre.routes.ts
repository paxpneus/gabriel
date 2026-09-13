import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  getMercadoLivreIntegration,
  handleMercadoLivreOAuthCallback,
} from "../api/mercado-livre_api.service";

const router = Router();

// Este arquivo mora numa pasta-folha chamada "mercado_livre" (underscore),
// separada do resto do módulo "mercado-livre" (hífen) de propósito — o
// mount path é literalmente o nome desta pasta (src/config/routes.ts's
// loadModules), e as rotas obrigatórias exigem "/api/mercado_livre/...".
// Ver plano (Etapa 1, seção 1.1) para a justificativa completa.

// POST /webhook entra na Etapa 2 (precisa de MarketplaceWebhookSyncQueue,
// que ainda não existe) — esta etapa só cobre o fluxo de OAuth.

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

export default router;
