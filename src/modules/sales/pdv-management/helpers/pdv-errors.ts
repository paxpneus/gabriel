// Parâmetro do quadro (column/cursor/limit/flags) malformado → 400.
export class PdvBoardParamError extends Error {}

// Tela sem acesso ao recurso pedido (ex.: coluna fora da tela + flags) → 403.
export class PdvForbiddenError extends Error {}
