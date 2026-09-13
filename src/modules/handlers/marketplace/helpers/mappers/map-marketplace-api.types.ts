import { AxiosInstance } from "axios";
import { MarketPlaceLabelStatus } from "../../../../sales/orders/order/orders.types";

// Resultado genérico do GET de order — só o que qualquer marketplace precisa
// devolver pra alimentar a busca de shipment em seguida.
export interface MarketplaceOrderResult {
  shipmentId: string | null;
}

// Resultado genérico do GET de shipment. `collectionDate`/`labelStatus` já
// mapeados para o vocabulário do sistema — cada marketplace concreto
// (mercadoLivreHandler, futuramente Shopee) é quem sabe traduzir seu próprio
// status/substatus cru pra isso (ver map-label-status.ts de cada um).
export interface MarketplaceShipmentResult {
  collectionDate: Date | null;
  labelStatus: MarketPlaceLabelStatus;
}

/**
 * Contrato que todo marketplace precisa implementar. Espelha
 * TransporterHandler (src/modules/handlers/logistic/helpers/mappers/map-transporter-api.types.ts),
 * sem o mapParams/TParams daquele contrato — aqui o request já é sempre um
 * id genérico (número do pedido no canal, id do shipment), sem forma
 * específica por marketplace do lado do request.
 */
export interface MarketplaceHandler<
  TOrderResponse = any,
  TShipmentResponse = any,
> {
  api: AxiosInstance;
  fetchOrder: (numberOrderChannel: string) => Promise<TOrderResponse>;
  mapOrderResponse: (response: TOrderResponse) => MarketplaceOrderResult;
  fetchShipment: (shipmentId: string) => Promise<TShipmentResponse>;
  mapShipmentResponse: (response: TShipmentResponse) => MarketplaceShipmentResult;

  /**
   * Resolve o(s) pedido(s) do marketplace atrelados a um shipment — sentido
   * inverso do fluxo normal, necessário quando uma notificação de webhook é
   * sobre um shipment em vez de um order. Devolve array porque um shipment
   * pode agrupar mais de um pedido (ex: pack_id do Mercado Livre).
   *
   * Formato exato do request/response ainda não confirmado contra a API
   * real — ver TODO no mercadoLivreHandler.
   */
  resolveOrdersFromShipment: (shipmentId: string) => Promise<string[]>;
}
