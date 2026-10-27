import { buildAuditEntries } from "../../../global/audit-logs/helpers/audit-change";
import { AuditAction, AuditEntity, AuditLogEntry, AuditOrigin } from "../../../global/audit-logs/audit-log.types";
import { EntityType } from "../../integration-mapping/integration-mapping.types";

// Nome pra leigo de cada tipo de pendência, usado no resumo da auditoria.
const ENTITY_LABELS: Record<EntityType, string> = {
  PRODUCT: "Produto",
  INVOICE: "Nota fiscal",
  CONTACT: "Contato",
  PAYMENT_METHOD: "Forma de pagamento",
  // ORDER não gera pendência (mapping criado direto na ingestão do pedido); só fecha o Record.
  ORDER: "Pedido",
};

// Pendência mapeada manualmente: entrada do mapping de integração criado (a pendência só some, não entra no log).
export const unmappedEntityMappedAudit = (params: {
  userId: string | null;
  entity: EntityType;
  description: string | null;
  mapping: { id: string; external_id: string };
}): AuditLogEntry[] => {
  const { mapping } = params;
  const name = params.description ? ` "${params.description}"` : "";

  return buildAuditEntries({
    userId: params.userId,
    origin: AuditOrigin.USER,
    summary: `${ENTITY_LABELS[params.entity]}${name} (código ${mapping.external_id} no ERP) foi mapeada`,
    main: {
      entity: AuditEntity.INTEGRATION_MAPPING,
      action: AuditAction.CREATE,
      fields: ["external_id"],
      change: { id: mapping.id, before: null, after: mapping },
    },
  });
};
