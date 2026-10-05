import {
  PdvSalesRequestStatus,
  PdvShippingType,
} from "../pdv-sales-request.types";
import { PdvBoardScreen } from "../../helpers/pdv-screens.config";

export interface NextActionInput {
  status: PdvSalesRequestStatus;
  shipping_type: PdvShippingType | null;
  correction_origin_status: PdvSalesRequestStatus | null;
  has_receipt: boolean;
}

type NextActionRuleScreen = Exclude<PdvBoardScreen, "telesales">;

interface NextActionRule {
  screen: NextActionRuleScreen;
  status: PdvSalesRequestStatus;
  when?: (input: NextActionInput) => boolean;
  value: string;
}

const S = PdvSalesRequestStatus;

export const CD21_STATUS_LABELS: Record<PdvSalesRequestStatus, string> = {
  [S.OPEN]: "Em aberto",
  [S.PENDING_FINANCE]: "Aguardando financeiro",
  [S.PENDING_CORRECTION]: "Pendente correção",
  [S.PENDING_CD21_ANALYSIS]: "Aguardando análise CD21",
  [S.PENDING_NF_SALE]: "Aguardando NF de venda",
  [S.PENDING_NF_TRANSFER]: "Aguardando NF de transferência",
  [S.SHIPPING]: "Pendente expedição ADT",
  [S.SHIP_TODAY]: "Embarca hoje",
  [S.FINISHED]: "Finalizado",
  [S.CANCELLED]: "Cancelado",
  [S.INVOICE_CANCELLED]: "Nota cancelada",
  [S.EXCLUDED]: "Excluído",
};

// Por tela, vale a primeira regra que casar; sem regra = null. "Faltando" do
// OPEN olha só comprovante + tipo de envio (endereço/transportadora não contam).
export const NEXT_ACTION_RULES: readonly NextActionRule[] = [
  {
    screen: "store",
    status: S.OPEN,
    when: (input) => !input.has_receipt || !input.shipping_type,
    value: "Anexar comprovante e tipo de envio",
  },
  {
    screen: "store",
    status: S.OPEN,
    when: (input) => input.has_receipt && !!input.shipping_type,
    value: "Enviar solicitação para análise",
  },
  {
    screen: "store",
    status: S.PENDING_CORRECTION,
    when: (input) => input.correction_origin_status === S.PENDING_FINANCE,
    value: "Enviar solicitação para análise",
  },
  {
    screen: "store",
    status: S.PENDING_CORRECTION,
    when: (input) => input.correction_origin_status === S.PENDING_CD21_ANALYSIS,
    value: "Confirmar correção",
  },
  { screen: "store", status: S.PENDING_CORRECTION, value: "Resolver correção" },
  {
    screen: "finance",
    status: S.PENDING_FINANCE,
    value: "Aprovar ou rejeitar comprovante",
  },
  ...Object.values(S).map(
    (status): NextActionRule => ({
      screen: "cd21",
      status,
      value: CD21_STATUS_LABELS[status],
    }),
  ),
];

// TODO(telesales): regras próprias ainda não definidas — usa as da loja.
const RULE_SCREEN_BY_BOARD_SCREEN: Record<PdvBoardScreen, NextActionRuleScreen> = {
  store: "store",
  finance: "finance",
  cd21: "cd21",
  telesales: "store",
};

export function getNextAction(
  input: NextActionInput,
  screen: PdvBoardScreen,
): string | null {
  const ruleScreen = RULE_SCREEN_BY_BOARD_SCREEN[screen];
  const rule = NEXT_ACTION_RULES.find(
    (candidate) =>
      candidate.screen === ruleScreen &&
      candidate.status === input.status &&
      (!candidate.when || candidate.when(input)),
  );
  return rule?.value ?? null;
}
