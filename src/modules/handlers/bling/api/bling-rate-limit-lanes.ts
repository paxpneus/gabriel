// Faixas do waitForBlingRateLimit: cada fila é uma faixa (BaseQueueService.rateLimitLane, default = nome da fila).
// Faixas comuns se revezam pegando até `weight` vagas seguidas; faixa strict passa na frente de todas.
export const BLING_LANE_DEFAULT_WEIGHT = 3;

// Override de peso por faixa (vazio = todas com BLING_LANE_DEFAULT_WEIGHT).
export const BLING_LANE_WEIGHTS: Record<string, number> = {};

// Ação manual de usuário esperando na tela (force-update de 1 pedido, criar produto de não mapeado), de qualquer fila.
export const BLING_MANUAL_LANE = "MANUAL";

// Ordem = prioridade entre strict. NFE_EMISSION: volume baixo + prazo de coleta real.
export const BLING_STRICT_LANES: string[] = [BLING_MANUAL_LANE, "NFE_EMISSION"];

// Chamada fora de job (request HTTP da API, script manual).
export const BLING_DEFAULT_LANE = "NO_QUEUE";
