import { Router, Request, Response } from 'express'
import BlingOrderService from './bling-order.service'
import { blingApi, getBlingIntegration, handleBlingOAuthCallback } from '../../api/bling_api.service'
import { v4 as uuidv4 } from 'uuid';
import { BlingOrderQueue } from './bling-order.queue';

const router = Router()

/**
 * POST /bling-orders/webhook
 *
 * Endpoint que recebe (ou simula) o webhook do Bling.
 * Em produção: configure essa URL no painel do Bling em Configurações → Notificações.
 * Em desenvolvimento: chame manualmente com o payload abaixo para testar.
 *
 * Payload esperado (shape do Bling):
 * {
 *   "data": {
 *     "id": 123456,              <- id do pedido na Bling
 *     "numero": "000123",        <- número do pedido no sistema
 *     "numeroLoja": "ORDER-001", <- número do pedido no canal de venda
 *     "contato": {
 *       "nome": "João Silva",
 *       "tipoPessoa": "F",
 *       "numeroDocumento": "12345678901"
 *     }
 *   }
 * }
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    console.log('[Webhook] Headers:', JSON.stringify(req.headers))
    console.log('[Webhook] Body:', JSON.stringify(req.body))

    const blingOrderQueue: BlingOrderQueue = req.app.locals.BlingOrderQueue
    const event: string = req.body.event  // "order.created" | "order.updated" | "order.deleted"
    const orderId = req.body.data?.id

    if (!orderId) {
      res.status(400).json({ error: 'Payload inválido: data.id ausente' })
      return
    }

    if (!event || !event.startsWith('order.')) {
      res.status(400).json({ error: 'Evento inválido ou não suportado' })
      return
    }

    const action = event.split('.')[1] // "created" | "updated" | "deleted"

    await blingOrderQueue.add(
      { ...req.body, action },
      `bling-order-${action}-${orderId}`
    )

    res.status(200).json({ received: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Rota para primeiro contato com a bling, para registrar o refresh token e estabelecer a conexão com a api da bling
router.get('/auth/bling', async (req: Request, res: Response) => {
  const integration = await getBlingIntegration();
  const configToken = integration.tokens;

  // Gera um novo UUID para cada tentativa
  const newState = uuidv4();

  // Salva no banco IMEDIATAMENTE
  await configToken.update({ oauth_state: newState });

  // Monta a URL 
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: configToken.client_id,
    state: newState,
    redirect_uri: configToken.callback_url // O que está no banco deve ser igual ao do painel
  });

  const authUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?${params.toString()}`;

  // Redireciona o usuário para rota de auth do ouath da bling (mesma rota de convite que tem no painel da bling no aplicativo cadastrado)
  res.redirect(authUrl);
});

// Rota Callback para colocar no campo de callback url na bling
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as Record<string, string>

  const integration = await getBlingIntegration()
  const configToken = integration.tokens

  if (state !== configToken.oauth_state) {
    res.status(400).json({ error: 'State inválido' })
    return
  }

  await handleBlingOAuthCallback(code)
  res.status(200).json({ ok: true, message: 'Tokens salvos com sucesso' })
})



export default router