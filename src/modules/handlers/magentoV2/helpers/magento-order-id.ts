// Bling grava numeroLoja de pedido do site como "<increment_id>_<entity_id>" (ex.: "000001271_631").
const MAGENTO_NUMERO_LOJA_PATTERN = /^\d+_(\d+)$/;

/** entity_id do pedido na Magento a partir do numeroLoja da Bling, ou null se não for pedido do site. */
export function parseMagentoOrderId(numeroLoja: string | number | null | undefined): string | null {
  if (numeroLoja == null) return null;
  const match = String(numeroLoja).trim().match(MAGENTO_NUMERO_LOJA_PATTERN);
  return match ? match[1] : null;
}
