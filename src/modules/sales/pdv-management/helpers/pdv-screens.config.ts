import { PdvSalesRequestStatus } from "../sales-request/pdv-sales-request.types";
import { ADT_TRANSPORTER_CDS } from "../sales-request/helpers/transporter-cd";
import {
  PdvAccessContext,
  PdvAccessScreen,
} from "../pdv-access/pdv-access.types";

// Tela do Kanban — diferente de PdvAccessScreen (auth): Televendas é
// STORE_REQUEST no acesso, mas tem quadro próprio aqui.
export type PdvBoardScreen = "store" | "finance" | "cd21" | "telesales";

// Origem dos valores da entrada: lista fixa (CD) ou endpoint (transportadoras).
export interface PdvColumnValueSource {
  value_type: "cd" | "transporter";
  options?: { value: string; label: string }[];
  options_endpoint?: string;
}

// O que o front pergunta antes de confirmar a ação do header — card manda só sales_request_ids.
export interface PdvColumnActionInput extends PdvColumnValueSource {
  param: "cd" | "transporter_id";
  label: string;
}

// method/endpoint null = ação só do front (ex.: copy_link), sem chamada ao back.
export interface PdvColumnAction {
  key: string;
  label: string;
  method: "POST" | null;
  endpoint: string | null;
  fixed_body: Record<string, string>;
  selection: "none" | "optional" | "required";
  modal: string | null;
  scope: ("header" | "card")[];
  input: PdvColumnActionInput | null;
}

export interface PdvBoardColumn {
  key: string;
  label: string;
  // Subtítulo da coluna no front; null = sem subtítulo.
  description: string | null;
  statuses: readonly PdvSalesRequestStatus[];
  // Fila de trabalho da tela (borda destacada). Coluna extra nunca é destacada.
  highlighted?: boolean;
  // Só com include_other_screens ("Colunas de outras telas = Sim").
  extra?: boolean;
  // Só com include_closed (FINISHED/EXCLUDED nunca vêm por padrão).
  closed?: boolean;
  // Cards selecionáveis (ações em lote) + ações montadas dinamicamente pelo front.
  selectable?: boolean;
  actions?: readonly PdvColumnAction[];
}

export interface PdvBoardVisibilityFlags {
  includeClosed: boolean;
  includeOtherScreens: boolean;
}

const S = PdvSalesRequestStatus;

const ADT_CD_SOURCE: PdvColumnValueSource = {
  value_type: "cd",
  options: ADT_TRANSPORTER_CDS.map((cd) => ({ value: cd, label: `CD ${cd}` })),
};

const SHIP_TODAY_TRANSPORTER_SOURCE: PdvColumnValueSource = {
  value_type: "transporter",
  options_endpoint: "/api/sales-request/transporters/ship-today",
};

// As 3 ações de lote do PDV (batch.controller.ts, /pdv-sales-requests/*).
function pdvBatchActions(
  status: PdvSalesRequestStatus,
  selection: PdvColumnAction["selection"],
  input: PdvColumnActionInput | null,
): PdvColumnAction[] {
  return [
    { key: "generate_batch", label: "Gerar lote", path: "generate", modal: null },
    { key: "add_to_batch", label: "Adicionar a lote", path: "add", modal: "add_to_batch" },
    { key: "generate_delivery_note", label: "Gerar romaneio", path: "delivery-note", modal: null },
  ].map(({ path, ...action }) => ({
    ...action,
    method: "POST",
    endpoint: `/api/batch/pdv-sales-requests/${path}`,
    fixed_body: { status },
    selection,
    scope: ["header", "card"],
    input,
  }));
}

// Menu de 3 pontinhos do card, em toda coluna — o front copia o link da solicitação.
const COPY_LINK_ACTION: PdvColumnAction = {
  key: "copy_link",
  label: "Copiar link",
  method: null,
  endpoint: null,
  fixed_body: {},
  selection: "none",
  modal: null,
  scope: ["card"],
  input: null,
};

export function boardColumnActions(column: PdvBoardColumn): PdvColumnAction[] {
  return [...(column.actions ?? []), COPY_LINK_ACTION];
}

const STORE_OPEN_COLUMN: PdvBoardColumn = {
  key: "open",
  label: "Em Aberto",
  description: "Sem solicitação ou faltando anexos",
  statuses: [S.OPEN],
};

const STORE_FINANCE_ANALYSIS_COLUMN: PdvBoardColumn = {
  key: "finance_analysis",
  label: "Análise Financeiro",
  description: "Comprovante em conferência",
  statuses: [S.PENDING_FINANCE],
};

const STORE_COLUMNS: readonly PdvBoardColumn[] = [
  { ...STORE_OPEN_COLUMN, highlighted: true },
  STORE_FINANCE_ANALYSIS_COLUMN,
  {
    key: "correction",
    label: "Pendente Correções",
    description: "Retorno solicitado para a loja",
    statuses: [S.PENDING_CORRECTION],
    highlighted: true,
  },
  {
    key: "cd21_analysis",
    label: "CD21 Análise",
    description: "Conferência operacional",
    statuses: [S.PENDING_CD21_ANALYSIS],
  },
  {
    key: "cd21_billing",
    label: "CD21 Faturamento",
    description: "Notas e expedição",
    statuses: [
      S.PENDING_NF_SALE,
      S.PENDING_NF_TRANSFER,
      S.SHIPPING,
      S.SHIP_TODAY,
    ],
  },
  {
    key: "finished",
    label: "Finalizado",
    description: "Romaneio gerado",
    statuses: [S.FINISHED],
    closed: true,
  },
  {
    key: "excluded",
    label: "Excluídos",
    description: "Solicitação excluída pela loja",
    statuses: [S.EXCLUDED],
    closed: true,
  },
];

// Ordem do array = ordem das colunas no quadro.
export const PDV_BOARD_SCREENS: Record<
  PdvBoardScreen,
  readonly PdvBoardColumn[]
> = {
  store: STORE_COLUMNS,
  finance: [
    { ...STORE_OPEN_COLUMN, extra: true },
    {
      key: "awaiting_analysis",
      label: "Aguardando Análise",
      description: "Comprovante para conferência",
      statuses: [S.PENDING_FINANCE],
      highlighted: true,
    },
    {
      key: "correction",
      label: "Correção",
      description: "Loja está corrigindo o comprovante",
      statuses: [S.PENDING_CORRECTION],
    },
    {
      key: "approved",
      label: "Aprovado",
      description: "Seguiu para o CD21",
      statuses: [
        S.PENDING_CD21_ANALYSIS,
        S.PENDING_NF_SALE,
        S.PENDING_NF_TRANSFER,
        S.SHIPPING,
        S.SHIP_TODAY,
      ],
    },
    {
      key: "finished",
      label: "Finalizados",
      description: "Romaneio gerado",
      statuses: [S.FINISHED],
      closed: true,
    },
    {
      key: "cancelled",
      label: "Cancelado",
      description: "Pedido ou nota cancelados",
      statuses: [S.CANCELLED, S.INVOICE_CANCELLED],
    },
  ],
  cd21: [
    { ...STORE_OPEN_COLUMN, extra: true },
    { ...STORE_FINANCE_ANALYSIS_COLUMN, extra: true },
    {
      key: "correction",
      label: "Correção",
      description: "Loja está corrigindo o pedido",
      statuses: [S.PENDING_CORRECTION],
    },
    {
      key: "awaiting_analysis",
      label: "Aguardando Análise",
      description: "Conferência do pedido antes de faturar",
      statuses: [S.PENDING_CD21_ANALYSIS],
      highlighted: true,
    },
    {
      key: "nf_sale",
      label: "Aguardando NF Venda",
      description: "Emitir nota de venda (Bling)",
      statuses: [S.PENDING_NF_SALE],
      highlighted: true,
    },
    {
      key: "nf_transfer",
      label: "Aguardando NF Transferência",
      description: "Vincular nota de transferência (Tecinco) — só ADT",
      statuses: [S.PENDING_NF_TRANSFER],
      highlighted: true,
    },
    {
      key: "shipping",
      label: "Pendente Expedição ADT",
      description: "Conferência física e romaneio",
      statuses: [S.SHIPPING],
      highlighted: true,
      selectable: true,
      actions: pdvBatchActions(S.SHIPPING, "optional", {
        param: "cd",
        label: "Transportadora",
        ...ADT_CD_SOURCE,
      }),
    },
    {
      key: "ship_today",
      label: "Embarca hoje",
      description: "Transportadora — conferência física e romaneio",
      statuses: [S.SHIP_TODAY],
      highlighted: true,
      selectable: true,
      actions: pdvBatchActions(S.SHIP_TODAY, "optional", {
        param: "transporter_id",
        label: "Transportadora",
        ...SHIP_TODAY_TRANSPORTER_SOURCE,
      }),
    },
    {
      key: "finished",
      label: "Finalizados",
      description: "Romaneio gerado",
      statuses: [S.FINISHED],
      closed: true,
    },
  ],
  // TODO(telesales): colunas próprias ainda não definidas — usa as da loja.
  telesales: STORE_COLUMNS,
};

// Flags só somam o que já está na tela — nunca liberam coluna de outra tela.
export function resolveColumns(
  screen: PdvBoardScreen,
  flags: PdvBoardVisibilityFlags,
): PdvBoardColumn[] {
  return PDV_BOARD_SCREENS[screen].filter(
    (column) =>
      (!column.closed || flags.includeClosed) &&
      (!column.extra || flags.includeOtherScreens),
  );
}

export function findVisibleColumn(
  screen: PdvBoardScreen,
  key: string,
  flags: PdvBoardVisibilityFlags,
): PdvBoardColumn | null {
  return (
    resolveColumns(screen, flags).find((column) => column.key === key) ?? null
  );
}

export function resolveBoardScreen(
  access: Pick<PdvAccessContext, "screen" | "via">,
): PdvBoardScreen {
  if (access.screen === PdvAccessScreen.FINANCE) return "finance";
  if (access.screen === PdvAccessScreen.CD21) return "cd21";
  return access.via === "TELESALES_LINK" ? "telesales" : "store";
}

export const TELESALES_SCREEN_PARAM = "telesales";

// Valor de `?screen=` nos links (pdv-access-link.service.ts monta os mesmos).
export const LINK_SCREEN_PARAMS: Record<string, PdvBoardScreen> = {
  [PdvAccessScreen.STORE_REQUEST.toLowerCase()]: "store",
  [PdvAccessScreen.FINANCE.toLowerCase()]: "finance",
  [PdvAccessScreen.CD21.toLowerCase()]: "cd21",
  [TELESALES_SCREEN_PARAM]: "telesales",
};
