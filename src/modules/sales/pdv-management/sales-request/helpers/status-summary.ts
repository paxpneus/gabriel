import { Op, WhereOptions } from "sequelize";
import { PdvSalesRequestStatus } from "../pdv-sales-request.types";
import { PdvAccessScreen } from "../../pdv-access/pdv-access.types";

// Cada indicativo do resumo de status (getStatusSummary) é definido aqui uma
// única vez e reusado tanto pra contar quanto pro filtro filters[indicator]
// da listagem — nunca duplicar o critério (ver "Evitar valores hardcoded" no
// CLAUDE.md).
export type PdvStatusIndicatorKey =
  | "open"
  | "pending_finance"
  | "pending_correction"
  | "pending_correction_finance_origin"
  | "pending_cd21_analysis"
  | "pending_nf_sale"
  | "pending_nf_transfer"
  | "pending_expedition"
  | "cd21_billing";

interface PdvStatusIndicatorDefinition {
  label: string;
  statuses: PdvSalesRequestStatus[];
  // Só usado por indicativos que restringem por origem da correção (ex.:
  // Financeiro só enxerga correção originada dele mesmo) — nesse caso a
  // quantidade vem do agrupamento por correction_origin_status, não da soma
  // de `statuses`.
  correctionOrigin?: PdvSalesRequestStatus;
}

export const PDV_STATUS_INDICATORS: Record<
  PdvStatusIndicatorKey,
  PdvStatusIndicatorDefinition
> = {
  open: { label: "Em aberto", statuses: [PdvSalesRequestStatus.OPEN] },
  pending_finance: {
    label: "Análise financeiro",
    statuses: [PdvSalesRequestStatus.PENDING_FINANCE],
  },
  pending_correction: {
    label: "Pendente correção",
    statuses: [PdvSalesRequestStatus.PENDING_CORRECTION],
  },
  pending_correction_finance_origin: {
    label: "Correção",
    statuses: [PdvSalesRequestStatus.PENDING_CORRECTION],
    correctionOrigin: PdvSalesRequestStatus.PENDING_FINANCE,
  },
  pending_cd21_analysis: {
    label: "CD21 análise",
    statuses: [PdvSalesRequestStatus.PENDING_CD21_ANALYSIS],
  },
  pending_nf_sale: {
    label: "Aguardando NF de venda",
    statuses: [PdvSalesRequestStatus.PENDING_NF_SALE],
  },
  pending_nf_transfer: {
    label: "Aguardando NF de transferência",
    statuses: [PdvSalesRequestStatus.PENDING_NF_TRANSFER],
  },
  pending_expedition: {
    label: "Pendente expedição",
    statuses: [PdvSalesRequestStatus.SHIPPING],
  },
  cd21_billing: {
    label: "CD21 faturamento",
    statuses: [
      PdvSalesRequestStatus.PENDING_NF_SALE,
      PdvSalesRequestStatus.PENDING_NF_TRANSFER,
      PdvSalesRequestStatus.SHIPPING,
    ],
  },
};

// Quais indicativos cada tela vê — mesmo escopo de READ_SCREENS do
// controller.
export const PDV_STATUS_INDICATORS_BY_SCREEN: Record<
  PdvAccessScreen,
  PdvStatusIndicatorKey[]
> = {
  [PdvAccessScreen.STORE_REQUEST]: [
    "open",
    "pending_finance",
    "pending_correction",
    "pending_cd21_analysis",
    "cd21_billing",
  ],
  [PdvAccessScreen.FINANCE]: [
    "pending_finance",
    "pending_correction_finance_origin",
  ],
  [PdvAccessScreen.CD21]: [
    "pending_nf_transfer",
    "pending_nf_sale",
    "pending_cd21_analysis",
    "pending_expedition",
  ],
};

// Origens de correction_origin_status que aparecem como sub_stats do
// indicativo "pending_correction" — só Solicitação/Televendas expõe esse
// indicativo com sub_stats (Financeiro já usa pending_correction_finance_origin,
// que é a própria origem; CD21 não exibe pending_correction).
export const PDV_CORRECTION_ORIGINS_BY_SCREEN: Partial<
  Record<PdvAccessScreen, PdvSalesRequestStatus[]>
> = {
  [PdvAccessScreen.STORE_REQUEST]: [
    PdvSalesRequestStatus.PENDING_FINANCE,
    PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
    PdvSalesRequestStatus.SHIPPING,
    PdvSalesRequestStatus.INVOICE_CANCELLED,
    PdvSalesRequestStatus.FINISHED,
  ],
};

// Where fragment de um indicativo — usado tanto por filters[indicator] da
// listagem (pdv-sales-request.service.ts) quanto, em memória, pra somar os
// contadores agrupados dentro de getStatusSummary. Key desconhecida devolve
// {} (no-op) em vez de estourar.
export function indicatorWhere(key: PdvStatusIndicatorKey): WhereOptions {
  const definition = PDV_STATUS_INDICATORS[key];
  if (!definition) return {};

  const where: WhereOptions = { status: { [Op.in]: definition.statuses } };
  if (definition.correctionOrigin) {
    (where as any).correction_origin_status = definition.correctionOrigin;
  }

  return where;
}
