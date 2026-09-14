import { toTz } from "../../../../shared/utils/normalizers/date";
import { SupplierDiscountType } from "../supplier-discount-rule.types";

function formatDiscountUnit(discountType: SupplierDiscountType): string {
  return discountType === "PERCENTUAL" ? "%" : "Reais";
}

// `discount_value` é DECIMAL(14,2) — o driver pode devolver string. `Number(...)`
// já derruba zeros à direita sozinho (15.00 -> "15", 15.50 -> "15.5").
function formatDiscountValue(discountValue: number | string): string {
  return String(Number(discountValue));
}

function formatDateBR(date: Date | string): string {
  return toTz(date).format("DD/MM/YYYY");
}

// Eixo vazio = curinga (vale pra qualquer valor) — mostra o rótulo curinga
// em vez de deixar o segmento em branco. Com valores, lista até 3 por nome
// (separados por vírgula); a partir do 4º, corta e soma "+N" restantes em
// vez de listar tudo (evita um name absurdamente longo com muitas marcas/
// aros/lojas selecionadas).
const MAX_LISTED_VALUES = 3;

function formatAxis(values: string[], wildcardLabel: string): string {
  if (!values.length) return wildcardLabel;
  if (values.length <= MAX_LISTED_VALUES) return values.join(", ");
  const shown = values.slice(0, MAX_LISTED_VALUES).join(", ");
  return `${shown} +${values.length - MAX_LISTED_VALUES}`;
}

/**
 * Nome exibido pro usuário, sempre recalculado a partir dos campos da
 * própria regra — nunca aceito do client (ver `createOrUpdate` em
 * supplier-discount-rule.service.ts). `brand_names`/`rim_values`/
 * `store_labels` já vêm resolvidos (não ids) — quem chama busca isso via
 * `brandService`/`rimService`/`unitBusinessService`, essa função só
 * formata. `store_labels` já deve vir com a escolha "number se tiver,
 * senão name" feita pelo chamador (uma unit business pode não ter
 * `number` cadastrado). Ex.:
 * "Dinâmica Promocional - A cada 2 Pneus - Marcas: Pirelli, Goodyear -
 * Aros: 15, 16 - Lojas: Loja Centro - Desconto de 400 Reais - Entre
 * 06/08/2026 e 08/08/2026", ou com mais de 3 marcas selecionadas:
 * "Marcas: Pirelli, Goodyear, Michelin +2".
 */
export function buildSupplierDiscountRuleName(rule: {
  quantity_step: number;
  discount_type: SupplierDiscountType;
  discount_value: number | string;
  start_date: Date | string;
  end_date: Date | string;
  brand_names: string[];
  rim_values: string[];
  store_labels: string[];
}): string {
  const unit = formatDiscountUnit(rule.discount_type);
  const value = formatDiscountValue(rule.discount_value);
  const start = formatDateBR(rule.start_date);
  const end = formatDateBR(rule.end_date);
  const brands = formatAxis(rule.brand_names, "Todas as marcas");
  const rims = formatAxis(rule.rim_values, "Todos os aros");
  const stores = formatAxis(rule.store_labels, "Todas as lojas");

  return (
    `Dinâmica Promocional - A cada ${rule.quantity_step} Pneus` +
    ` - Marcas: ${brands}` +
    ` - Aros: ${rims}` +
    ` - Lojas: ${stores}` +
    ` - Desconto de ${value} ${unit}` +
    ` - Entre ${start} e ${end}`
  );
}
