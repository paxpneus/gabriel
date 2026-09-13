import { resolveMarketplaceHandler } from "../helpers/mappers/map-marketplace-api";
import { MarketplaceShipmentResult } from "../helpers/mappers/map-marketplace-api.types";
import { MarketPlaceLabelStatus } from "../../../sales/orders/order/orders.types";

/**
 * Ponto de entrada único e genérico: dado apenas a store do pedido e o
 * número do pedido no canal, resolve sozinho qual marketplace consultar
 * (Mercado Livre hoje, Shopee amanhã) sem o chamador precisar saber qual
 * API está por trás. Espelha listOccurrencyByTransporter
 * (src/modules/warehouse/fiscal/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.service.ts):
 * resolve handler pelo nome → busca order → extrai shipmentId → busca
 * shipment → mapeia pro formato interno.
 */
export const getMarketplaceCollectionAndLabelStatus = async (
  storeName: string,
  numberOrderChannel: string,
): Promise<MarketplaceShipmentResult> => {
  const handler = resolveMarketplaceHandler(storeName);

  const orderResponse = await handler.fetchOrder(numberOrderChannel);
  const { shipmentId } = handler.mapOrderResponse(orderResponse);

  if (!shipmentId) {
    return { collectionDate: null, labelStatus: MarketPlaceLabelStatus.UNKNOWN };
  }

  const shipmentResponse = await handler.fetchShipment(shipmentId);
  return handler.mapShipmentResponse(shipmentResponse);
};

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

/**
 * Igual getMarketplaceCollectionAndLabelStatus, mas tolerante a falha:
 * tenta até RETRY_ATTEMPTS vezes (backoff linear curto) e devolve `null`
 * (nunca lança) se todas falharem. `null` significa especificamente "a
 * chamada falhou mesmo após retry" — diferente de uma chamada bem-sucedida
 * que só ainda não tem collectionDate (shipment não pronto), que continua
 * devolvendo o objeto normalmente com collectionDate: null dentro. Usado por
 * ML_ORDER_SYNC (o único chamador cuja falha, sem tratamento, deixaria o
 * pedido sem nenhum caminho de avanço no pipeline) — os demais chamadores
 * (webhook, reconciler) rodam em cadências próprias e podem simplesmente
 * tentar de novo no próximo ciclo/retry do BullMQ.
 */
export const getMarketplaceCollectionAndLabelStatusWithRetry = async (
  storeName: string,
  numberOrderChannel: string,
): Promise<MarketplaceShipmentResult | null> => {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await getMarketplaceCollectionAndLabelStatus(storeName, numberOrderChannel);
    } catch (error) {
      if (attempt === RETRY_ATTEMPTS) return null;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
  return null;
};

/**
 * Sentido inverso — usado pela fila de webhook (Etapa 2) quando a
 * notificação é sobre um shipment em vez de um order. Devolve os id(s) de
 * pedido do marketplace atrelados ao shipment (mais de um quando o shipment
 * agrupa vários pedidos, ex: pack_id no Mercado Livre).
 */
export const getMarketplaceOrdersFromShipment = async (
  storeName: string,
  shipmentId: string,
): Promise<string[]> => resolveMarketplaceHandler(storeName).resolveOrdersFromShipment(shipmentId);
