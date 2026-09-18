// Entidade/módulo local que sofreu a falha de integração — controlado aqui
// (TS) em vez de ENUM de banco, pra permitir instrumentar integração nova
// sem precisar de migration.
export enum IntegrationErrorEntity {
  CTE = "CTE",
  PRODUCT = "PRODUCT",
  CUSTOMER = "CUSTOMER",
  INVOICE = "INVOICE",
  ORDER = "ORDER",
}

export interface IntegrationErrorAttributes {
  id: string;
  entity: IntegrationErrorEntity;
  type: string;
  integrations_id: string;
  // id na integração externa (ex.: produtoId no Bling) — null quando a
  // integração não expõe id pra essa entidade (ex.: CT-e, identificado por
  // chave/número, guardados em `reference`).
  external_id: string | null;
  // id da entidade no nosso próprio sistema (ex.: cte.id, product.id),
  // quando resolvível.
  internal_id: string | null;
  reference: string | null;
  message: string | null;
  resolved: boolean;
  resolved_at: Date | null;
  // evento (`events`) já disparado pra usuários developer na primeira
  // ocorrência dessa combinação de dedup — reincidência (occurrences++)
  // não dispara evento novo enquanto este já existir.
  event_id: string | null;
  occurrences: number;
  last_seen_at: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IntegrationErrorCreationAttributes
  extends Omit<IntegrationErrorAttributes, "id" | "createdAt" | "updatedAt"> {}
