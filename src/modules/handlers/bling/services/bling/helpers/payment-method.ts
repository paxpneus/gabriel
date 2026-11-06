import integrationMappingService from "../../../../../integrations/integration-mapping/integration-mapping.service";
import { PaymentMethodErpData } from "../../../../../integrations/integration-mapping/integration-mapping.types";
import unmappedEntityService from "../../../../../integrations/unmapped-entities/unmapped-entity.service";
import paymentMethodService from "../../../../../sales/orders/payment_method/payment_method.service";
import { OTHER_PAYMENT_METHOD_GROUP } from "../../../../../sales/orders/payment_method/helpers/payment-method-groups";
import { CARD_BRANDS } from "../../../../../../shared/constants/card-brands";
import { BLING_PAYMENT_TYPES } from "../../../../../../shared/constants/bling-payment-types";

// Forma de pagamento como a Bling manda (formaPagamento.id + tipoPagamento + descricao). installments/cardBrand
// só vêm do detalhe da forma (pedido); undefined = não informado (populate), mantém o do erp_data.
export interface BlingPaymentForm {
  id: number | string;
  type: number | null;
  description: string | null;
  installments?: number | null;
  cardBrand?: number | null;
}

// Snapshot da forma pro erp_data do mapping, com os nomes de tipo/bandeira já resolvidos;
// campo não informado mantém o valor anterior.
function toErpData(
  form: BlingPaymentForm,
  previous: PaymentMethodErpData | null,
): PaymentMethodErpData {
  const cardBrand =
    form.cardBrand === undefined ? (previous?.card_brand ?? null) : form.cardBrand;
  return {
    name: form.description,
    type: form.type,
    type_name: BLING_PAYMENT_TYPES.find((item) => item.code === form.type)?.name ?? null,
    installments:
      form.installments === undefined ? (previous?.installments ?? null) : form.installments,
    card_brand: cardBrand,
    card_brand_name: CARD_BRANDS.find((brand) => brand.code === cardBrand)?.name ?? null,
    updated_at: new Date().toISOString(),
  };
}

// true se o snapshot novo difere do gravado (evita escrever erp_data a cada pedido importado).
function erpDataChanged(next: PaymentMethodErpData, previous: PaymentMethodErpData | null): boolean {
  if (!previous) return true;
  return (
    next.name !== previous.name ||
    next.type !== (previous.type ?? null) ||
    next.installments !== (previous.installments ?? null) ||
    next.card_brand !== (previous.card_brand ?? null) ||
    next.type_name !== (previous.type_name ?? null) ||
    next.card_brand_name !== (previous.card_brand_name ?? null)
  );
}

// Forma da Bling → id em payment_methods. Ordem: integration_mapping PAYMENT_METHOD; sem ele, auto-mapeia
// pelo tipoPagamento (raw_payload.blingTypes do catálogo, não lista no código) e grava o mapping; tipo que
// nenhum método cobre vira pendência em unmapped_entities e usa "Outros" até alguém mapear.
// erp_data do mapping guarda o snapshot da forma (nome, tipo, parcelas, bandeira) e é atualizado quando muda.
export async function resolveBlingPaymentMethods(
  forms: BlingPaymentForm[],
  integrationsId: string,
): Promise<Map<string, string>> {
  const uniqueForms = [...new Map(forms.map((form) => [String(form.id), form])).values()];
  const existing = await integrationMappingService.findMappingsByExternalIds(
    "PAYMENT_METHOD",
    integrationsId,
    uniqueForms.map((form) => String(form.id)),
  );

  const resolved = new Map<string, string>();
  const erpUpdates: Promise<void>[] = [];
  for (const form of uniqueForms) {
    const mapping = existing.get(String(form.id));
    if (!mapping) continue;
    resolved.set(String(form.id), mapping.internal_id);

    const previous = mapping.erp_data as PaymentMethodErpData | null;
    const next = toErpData(form, previous);
    if (erpDataChanged(next, previous)) {
      erpUpdates.push(integrationMappingService.updateErpData(mapping.id, next));
    }
  }
  await Promise.all(erpUpdates);

  const missing = uniqueForms.filter((form) => !resolved.has(String(form.id)));
  if (!missing.length) return resolved;

  const catalog = await paymentMethodService.findCatalogWithIntegrationTypes();
  const toMap: { form: BlingPaymentForm; paymentMethodId: string }[] = [];
  const pending: BlingPaymentForm[] = [];
  for (const form of missing) {
    const method = catalog.find((item) =>
      ((item.raw_payload?.blingTypes as number[] | undefined) ?? []).includes(Number(form.type)),
    );
    if (method) toMap.push({ form, paymentMethodId: method.id });
    else pending.push(form);
  }

  // Uma query só; código mapeado por outra fila no meio do caminho é ignorado e vale o que está no banco.
  const created = await integrationMappingService.bulkCreateNonPrimary(
    "PAYMENT_METHOD",
    integrationsId,
    toMap.map(({ form, paymentMethodId }) => ({
      external_id: String(form.id),
      internal_id: paymentMethodId,
      erp_data: toErpData(form, null),
    })),
  );
  for (const [externalId, mapping] of created) resolved.set(externalId, mapping.internal_id);
  // Pendência antiga de código que agora foi auto-mapeado (ex.: tipo novo no catálogo) sai da lista.
  await unmappedEntityService.removeMany("PAYMENT_METHOD", integrationsId, [...created.keys()]);

  if (pending.length) {
    const other = catalog.find((item) => item.id_system === OTHER_PAYMENT_METHOD_GROUP.key);
    if (!other) {
      throw new Error('Forma de pagamento "Outros" não cadastrada (seed m301) — não há destino para forma sem mapeamento');
    }
    await unmappedEntityService.registerMany(
      "PAYMENT_METHOD",
      integrationsId,
      pending.map((form) => ({ externalId: String(form.id), description: form.description })),
    );
    for (const form of pending) resolved.set(String(form.id), other.id);
  }

  return resolved;
}
