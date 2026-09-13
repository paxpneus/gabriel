import { resolveMarketplaceHandler } from "../helpers/mappers/map-marketplace-api";
import { MarketplaceShipmentResult } from "../helpers/mappers/map-marketplace-api.types";

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
    return { collectionDate: null, labelStatus: "UNKNOWN" };
  }

  const shipmentResponse = await handler.fetchShipment(shipmentId);
  return handler.mapShipmentResponse(shipmentResponse);
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
