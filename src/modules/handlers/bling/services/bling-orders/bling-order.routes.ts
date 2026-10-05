import { Router, Request, Response, NextFunction } from "express";
import { Op } from "sequelize";
import {
  getBlingIntegration,
  handleBlingOAuthCallback,
} from "../../api/bling_api.service";
import { v4 as uuidv4 } from "uuid";
import {
  BlingOrderQueue,
  ORDER_WEBHOOK_INGESTION_DELAY_MS,
  FORCE_UPDATE_PRIORITY,
  BULK_FORCE_UPDATE_PRIORITY,
  BULK_FORCE_UPDATE_JOB_NAME,
} from "./bling-order.queue";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";
import { authenticate, AuthRequest } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import ordersService from "../../../../sales/orders/order/orders.service";
import pdvSalesRequestService from "../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import { PdvSalesRequestStatus } from "../../../../sales/pdv-management/sales-request/pdv-sales-request.types";
import { pdvAccess } from "../../../../sales/pdv-management/pdv-access/pdv-access.middleware";
import { PdvAccessScreen } from "../../../../sales/pdv-management/pdv-access/pdv-access.types";
import userService from "../../../../company/users/users/user.service";
import roleService from "../../../../company/users/roles/role.service";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import { PDV_EXCLUDED_STORE_NUMBERS } from "../../../../sales/pdv-management/helpers/pdv-excluded-unit-business";

const router = Router();

// Só usuário logado com Role "Administrador" pode disparar/consultar o
// force-update em massa — enfileira potencialmente muitos jobs de uma vez,
// não é ação de tela PDV (loja/financeiro/CD21) como o resto deste arquivo.
async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  const roleId = (req as AuthRequest).user?.role;
  if (!roleId || !(await roleService.isAdminRole(roleId))) {
    return res
      .status(403)
      .json({ error: "Apenas administradores podem executar esta ação." });
  }
  next();
}

/**
 * POST /bling-orders/webhook
 *
 * Endpoint que recebe (ou simula) o webhook do Bling.
 * Em produção: configure essa URL no painel do Bling em Configurações → Notificações.
 * Em desenvolvimento: chame manualmente com o payload abaixo para testar.
 *
 * Payload esperado (shape do Bling):
 * {
 *   "event": "order.created | updated | deleted"
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
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    console.log("[Webhook] Headers:", JSON.stringify(req.headers));
    console.log("[Webhook] Body:", JSON.stringify(req.body));

    const blingOrderQueue: BlingOrderQueue = req.app.locals.BlingOrderQueue;
    const event: string = req.body.event; // "order.created" | "order.updated" | "order.deleted"
    const orderId = req.body.data?.id;

    if (!orderId) {
      res.status(200).json({ ignored: true });
      return;
    }

    if (!event || !event.startsWith("order.")) {
      res.status(200).json({ ignored: true });
      return;
    }

    const action = event.split(".")[1]; // "created" | "updated" | "deleted"

    await blingOrderQueue.addDelayed(
      { ...req.body, action },
      `bling-order-${action}-${orderId}`,
      ORDER_WEBHOOK_INGESTION_DELAY_MS,
    );

    res.status(200).json({ received: true });
  } catch (error: any) {
    alertService.sendAlert({
    severity: 'HIGH',
    title: 'Webhook Bling — erro inesperado',
    message: `Erro ao enfileirar evento "${req.body?.event}" do pedido ${req.body?.data?.id}. Erro: ${error.message}`,
    })
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /bling-orders/:orderId/force-update
 *
 * Uso do front-end: força a reingestão imediata de um pedido específico
 * (busca direta em GET /pedidos/vendas/{id} na Bling), furando tanto o
 * delay de 2s quanto qualquer backlog de webhook já enfileirado — usa a
 * maior prioridade possível na fila BLING_ORDER_INGESTION.
 */
router.post(
  "/:orderId/force-update",
  pdvAccess([PdvAccessScreen.CD21, PdvAccessScreen.FINANCE, PdvAccessScreen.STORE_REQUEST]),
  async (req: Request, res: Response) => {
    try {
      const blingOrderQueue: BlingOrderQueue = req.app.locals.BlingOrderQueue;
      const { orderId } = req.params;

      const order = await ordersService.findOne({ where: { id: orderId } });
      if (!order?.id_order_system) {
        res
          .status(404)
          .json({ error: "Pedido não encontrado ou sem vínculo com a Bling." });
        return;
      }

      await blingOrderQueue.add(
        {
          event: "order.updated",
          action: "updated",
          data: { id: Number(order.id_order_system) },
        },
        `bling-order-force-update-${order.id_order_system}`,
        { priority: FORCE_UPDATE_PRIORITY },
      );

      res.status(202).json({ enqueued: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

/**
 * GET /bling-orders/force-update-bulk/can-run
 *
 * Diz se o botão de force-update em massa pode ser acionado agora — false
 * enquanto ainda houver job de um disparo anterior pendente na fila
 * (esperando, ativo, delayed ou já prioritizado), pra não empilhar dois
 * disparos em massa ao mesmo tempo.
 */
router.get(
  "/force-update-bulk/can-run",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const blingOrderQueue: BlingOrderQueue = req.app.locals.BlingOrderQueue;
      const hasPending = await blingOrderQueue.hasPendingJobsNamed([
        BULK_FORCE_UPDATE_JOB_NAME,
      ]);

      res.status(200).json({ canRun: !hasPending });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

/**
 * POST /bling-orders/force-update-bulk
 *
 * Enfileira reingestão de TODOS os pedidos que casam com o filtro (mesmo
 * shape/endpoint da força-update individual, um job por pedido), sempre com
 * BULK_FORCE_UPDATE_PRIORITY — pior prioridade da fila BLING_ORDER_INGESTION,
 * então nunca fura webhook/automação, só some no backlog depois deles.
 *
 * Body:
 * {
 *   "onlyMineUnitBusiness": true | false,        // opcional (default false) — true escopa pro unit_business_id do próprio usuário logado; false/omitido escopa pra todas as lojas físicas normais (mesmo universo do link de Televendas — CD21 inclusa, nunca online/marketplace/loja fora do fluxo PDV)
 *   "orderStatus": "CANCELADO" | [...],          // opcional — normalized_status (mesmo vocabulário de filters[status] do GET /order)
 *   "hasPdvSalesRequest": true | false,          // opcional — tri-state: omitido = não filtra
 *   "pdvStatus": "OPEN" | [...]                  // opcional — status da PdvSalesRequest (implica hasPdvSalesRequest=true)
 * }
 */
router.post(
  "/force-update-bulk",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const blingOrderQueue: BlingOrderQueue = req.app.locals.BlingOrderQueue;
      const { onlyMineUnitBusiness, orderStatus, hasPdvSalesRequest, pdvStatus } =
        req.body ?? {};

      const orderFilters: Record<string, string | string[] | undefined> = {};
      if (onlyMineUnitBusiness) {
        const userId = (req as AuthRequest).user!.id;
        const loggedUser = await userService.findById(userId, {
          attributes: ["unit_business_id"],
        });
        if (!loggedUser?.unit_business_id) {
          res.status(400).json({
            error: "Usuário logado não possui loja vinculada (unit_business_id).",
          });
          return;
        }
        orderFilters.unit_business_id = loggedUser.unit_business_id;
      } else {
        // Mesmo universo de lojas que o link de Televendas enxerga (ver
        // resolveUnitBusinessScope em pdv-sales-request.service.ts) — nunca
        // "todo pedido do banco": exclui online/marketplace (sem
        // unit_business_id) e loja fora do fluxo PDV por decisão de produto.
        orderFilters.unit_business_id =
          await unitBusinessService.getPhysicalNumberedUnitBusinessIds(
            PDV_EXCLUDED_STORE_NUMBERS,
          );
      }
      if (orderStatus) orderFilters.status = orderStatus;

      let orderIds = await ordersService.findIdsMatchingFilters({
        filters: orderFilters,
      });

      if (hasPdvSalesRequest !== undefined || pdvStatus) {
        const statuses: PdvSalesRequestStatus[] | undefined = pdvStatus
          ? (Array.isArray(pdvStatus) ? pdvStatus : [pdvStatus])
          : undefined;
        const pdvOrderIds = new Set(
          await pdvSalesRequestService.findOrderIdsByStatus(statuses),
        );

        orderIds =
          hasPdvSalesRequest === false
            ? orderIds.filter((id) => !pdvOrderIds.has(id))
            : orderIds.filter((id) => pdvOrderIds.has(id));
      }

      if (!orderIds.length) {
        res.status(202).json({ enqueued: 0 });
        return;
      }

      const orders = await ordersService.findAll({
        where: { id: { [Op.in]: orderIds }, id_order_system: { [Op.ne]: null } },
        attributes: ["id_order_system"],
        raw: true,
      });

      await Promise.all(
        orders.map((order: any) =>
          blingOrderQueue.add(
            {
              event: "order.updated",
              action: "updated",
              data: { id: Number(order.id_order_system) },
            },
            `bling-order-force-update-${order.id_order_system}`,
            {
              priority: BULK_FORCE_UPDATE_PRIORITY,
              name: BULK_FORCE_UPDATE_JOB_NAME,
            },
          ),
        ),
      );

      res.status(202).json({ enqueued: orders.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// Rota para primeiro contato com a bling, para registrar o refresh token e estabelecer a conexão com a api da bling
router.get("/auth/bling", async (req: Request, res: Response) => {
  const integration = await getBlingIntegration();
  const configToken = integration.tokens;

  // Gera um novo UUID para cada tentativa
  const newState = uuidv4();

  // Salva no banco IMEDIATAMENTE
  await configToken.update({ oauth_state: newState });

  // Monta a URL
  const params = new URLSearchParams({
    response_type: "code",
    client_id: configToken.client_id,
    state: newState,
    redirect_uri: configToken.callback_url, // O que está no banco deve ser igual ao do painel
  });

  const authUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?${params.toString()}`;

  // Redireciona o usuário para rota de auth do ouath da bling (mesma rota de convite que tem no painel da bling no aplicativo cadastrado)
  res.redirect(authUrl);
});

// Rota Callback para colocar no campo de callback url na bling
router.get("/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as Record<string, string>;

  const integration = await getBlingIntegration();
  const configToken = integration.tokens;

  if (state !== configToken.oauth_state) {
    res.status(400).json({ error: "State inválido" });
    return;
  }

  await handleBlingOAuthCallback(code);
  res.status(200).json({ ok: true, message: "Tokens salvos com sucesso" });
});

export default router;
