import { mercadoLivreApi } from "../api/mercado-livre_api.service";
import {
  MercadoLivreOrderResponse,
  MercadoLivreShipmentResponse,
} from "../api/mercado-livre_api.types";
import {
  MarketplaceHandler,
  MarketplaceOrderResult,
  MarketplaceShipmentResult,
} from "../../marketplace/helpers/mappers/map-marketplace-api.types";
import { mapMercadoLivreLabelStatus } from "../helpers/map-label-status";

const fetchOrder = async (
  numberOrderChannel: string,
): Promise<MercadoLivreOrderResponse> => {
  const { data } = await mercadoLivreApi.get<MercadoLivreOrderResponse>(
    `/orders/${numberOrderChannel}`,
  );
  return data;
};

const mapOrderResponse = (
  response: MercadoLivreOrderResponse,
): MarketplaceOrderResult => ({
  shipmentId: response?.shipping?.id != null ? String(response.shipping.id) : null,
});

const fetchShipment = async (
  shipmentId: string,
): Promise<MercadoLivreShipmentResponse> => {
  const { data } = await mercadoLivreApi.get<MercadoLivreShipmentResponse>(
    `/shipments/${shipmentId}`,
    {
      // Obrigatório — sem esse header o ML devolve o formato de shipment
      // antigo, sem os campos que este mapeamento espera.
      headers: { "x-format-new": "true" },
    },
  );
  return data;
};

const mapShipmentResponse = (
  response: MercadoLivreShipmentResponse,
): MarketplaceShipmentResult => ({
  collectionDate: response?.lead_time?.estimated_handling_limit?.date
    ? new Date(response.lead_time.estimated_handling_limit.date)
    : null,
  labelStatus: mapMercadoLivreLabelStatus(
    response?.status ?? null,
    response?.substatus ?? null,
  ),
});

// TODO (Etapa 1 — validar contra API real, ver pergunta em aberto #5 do
// plano): endpoint/campo exato pra resolver o(s) pedido(s) atrelados a um
// shipment ainda não confirmado. Um shipment pode cobrir mais de um pedido
// do Mercado Livre (agrupamento por pack_id) — por isso o retorno é sempre
// um array, mesmo quando só há um pedido.
const resolveOrdersFromShipment = async (
  shipmentId: string,
): Promise<string[]> => {
  throw new Error(
    `[MercadoLivre] resolveOrdersFromShipment ainda não implementado (shipmentId=${shipmentId}) — validar endpoint contra a API real na Etapa 1.`,
  );
};

export const mercadoLivreHandler: MarketplaceHandler<
  MercadoLivreOrderResponse,
  MercadoLivreShipmentResponse
> = {
  api: mercadoLivreApi,
  fetchOrder,
  mapOrderResponse,
  fetchShipment,
  mapShipmentResponse,
  resolveOrdersFromShipment,
};
