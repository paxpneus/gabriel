// Retorno do token OAuth do Mercado Livre.
export interface MercadoLivreTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token: string;
}

// Fila dos processos de get de token, falhos e aceitos — mesmo formato de
// bling_api.types.ts's QueueItem, usado pelo dedupe de refresh concorrente.
export interface QueueItem {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}

// Shape cru (parcial, só os campos usados) de GET /orders/$ORDER_ID.
export interface MercadoLivreOrderResponse {
  id: number;
  shipping?: {
    id: number;
  };
  pack_id?: number | null;
  [key: string]: unknown;
}

// Shape cru (parcial) de GET /shipments/$SHIPMENT_ID (com header x-format-new: true).
export interface MercadoLivreShipmentResponse {
  id: number;
  status?: string;
  substatus?: string;
  lead_time?: {
    estimated_handling_limit?: {
      date?: string;
    };
  };
  [key: string]: unknown;
}
