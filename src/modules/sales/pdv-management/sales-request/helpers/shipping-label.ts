import { PdvShippingType } from "../pdv-sales-request.types";

// Transportadora da nota de venda no formato "LOGISTICA PAX PNEUS SP - CD 12"
// vira "ADT CD 12" — extrai o "CD <n>" em vez de mapear nome a nome.
const CD_PATTERN = /\bCD\s*(\d+)\b/i;

const TRANSPORTADORA_SHIPPING_LABEL = "Embarque hoje";

export function buildShippingLabel(
  shippingType: PdvShippingType | null | undefined,
  transporterName: string | null | undefined,
): string | null {
  if (shippingType === PdvShippingType.TRANSPORTADORA) {
    return TRANSPORTADORA_SHIPPING_LABEL;
  }
  if (shippingType !== PdvShippingType.ADT) return null;

  const match = transporterName ? CD_PATTERN.exec(transporterName) : null;
  return match ? `ADT CD ${match[1]}` : "ADT";
}
