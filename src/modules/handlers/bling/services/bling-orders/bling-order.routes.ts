import { Router, Request, Response } from 'express'
import BlingOrderService from './bling-order.service'
import { blingApi, getBlingIntegration, handleBlingOAuthCallback } from '../../api/bling_api.service'

const router = Router()
const blingOrderService = new BlingOrderService(blingApi)

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
    await blingOrderService.createOrderFromBling(req.body)
    res.status(200).json({ received: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /bling-orders/test-api
 *
 * Testa se o blingApi está funcionando: faz uma chamada real para a API do Bling
 * e retorna os dados. Use para validar token, refresh e conexão.
 *
 * Não precisa de payload — só chame a rota e veja o retorno.
 */
router.get('/test-api', async (req: Request, res: Response) => {
  try {
    const { data } = await blingApi.get('/pedidos/vendas', {
      params: { limite: 1 } // busca só 1 pedido para não pesar
    })
    res.status(200).json({
      ok: true,
      message: 'blingApi funcionando',
      sample: data
    })
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      message: 'blingApi com erro',
      error: error.message
    })
  }
})

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