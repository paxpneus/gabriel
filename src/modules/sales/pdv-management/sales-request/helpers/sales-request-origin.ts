import {
  PdvAccessContext,
  PdvAccessScreen,
} from "../../pdv-access/pdv-access.types";
import { PdvSalesRequestOrigin } from "../pdv-sales-request.types";

// Só a tela da loja origina — FINANCE/CD21 atuando antes da loja não definem origem.
export function resolveSalesRequestOrigin(
  access: PdvAccessContext,
): PdvSalesRequestOrigin | null {
  if (access.screen !== PdvAccessScreen.STORE_REQUEST) return null;
  return access.via === "TELESALES_LINK"
    ? PdvSalesRequestOrigin.TELESALES
    : PdvSalesRequestOrigin.STORE;
}
