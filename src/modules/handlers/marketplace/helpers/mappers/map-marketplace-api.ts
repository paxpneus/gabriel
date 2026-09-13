import { MarketplaceHandler } from "./map-marketplace-api.types";
import { mercadoLivreHandler } from "../../../mercado-livre/services/mercado-livre-order-shipment.service";

/**
 * Registry central: cada marketplace novo (ex: Shopee) só precisa de uma
 * entrada aqui. Espelha resolveTransporterHandler
 * (src/modules/handlers/logistic/helpers/mappers/map-transporter-api.ts).
 */
const marketplaceHandlers: Record<string, MarketplaceHandler> = {
  MercadoLivre: mercadoLivreHandler,
};

/**
 * "Descobre" o handler (api + funções) do marketplace pelo nome da store
 * do pedido (Store.name — mesma taxonomia já usada em
 * bling-order.service.ts's allowed_channels).
 */
export const resolveMarketplaceHandler = (storeName: string): MarketplaceHandler => {
  const handler = marketplaceHandlers[storeName];

  if (!handler) {
    throw new Error(`Marketplace "${storeName}" não possui integração implementada.`);
  }

  return handler;
};
