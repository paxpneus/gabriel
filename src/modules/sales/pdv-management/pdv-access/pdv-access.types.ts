export enum PdvAccessScreen {
  STORE_REQUEST = "STORE_REQUEST",
  FINANCE = "FINANCE",
  CD21 = "CD21",
}

export type PdvAccessVia = "LOGIN" | "STORE_LINK" | "TELESALES_LINK";

export interface PdvAccessContext {
  screen: PdvAccessScreen;
  via: PdvAccessVia;
  // Loja usada pro forcedWhere de STORE_REQUEST — null quando screen = CD21
  // ou FINANCE (as duas são acesso global, sem scoping por loja — pedido
  // de qualquer loja aparece pra elas).
  unitBusinessId: string | null;
  // Só preenchido quando via = LOGIN, pra registrar autoria no histórico.
  userId?: string;
}
