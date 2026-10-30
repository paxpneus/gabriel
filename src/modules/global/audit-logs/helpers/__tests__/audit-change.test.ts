import { buildAuditEntries } from "../audit-change";
import { AuditAction, AuditEntity, AuditOrigin } from "../../audit-log.types";

describe("buildAuditEntries", () => {
  it("entrada principal com só os fields e as linhas mexidas em affected; copia na hora (alterar a linha depois não muda o log)", () => {
    const config = { id: "config-1", sku: "SKU-1", gtin: "789", price: 10 };

    const entries = buildAuditEntries({
      origin: AuditOrigin.SYSTEM,
      summary: "resumo",
      main: {
        entity: AuditEntity.PRODUCT,
        action: AuditAction.UPDATE,
        fields: ["is_active"],
        change: { id: "product-1", before: { id: "product-1", is_active: true }, after: { is_active: false } },
      },
      touched: [
        {
          entity: AuditEntity.PRODUCT_CONFIG,
          action: AuditAction.DELETE,
          fields: ["sku", "gtin"],
          changes: [{ id: config.id, before: config, after: null }],
        },
      ],
    });
    config.sku = "ALTERADO";

    expect(entries).toEqual([
      {
        userId: null,
        origin: AuditOrigin.SYSTEM,
        entity: AuditEntity.PRODUCT,
        internalId: "product-1",
        action: AuditAction.UPDATE,
        changes: {
          summary: "resumo",
          before: { is_active: true },
          after: { is_active: false },
          affected: [
            {
              entity: AuditEntity.PRODUCT_CONFIG,
              internal_id: "config-1",
              action: AuditAction.DELETE,
              label: undefined,
              before: { sku: "SKU-1", gtin: "789" },
              after: null,
            },
          ],
        },
      },
    ]);
  });

  it("mirror: uma entrada a mais por linha mexida, com origin apontando pra principal", () => {
    const entries = buildAuditEntries({
      userId: "user-1",
      summary: "resumo",
      main: {
        entity: AuditEntity.PRODUCT,
        action: AuditAction.UPDATE,
        fields: [],
        change: { id: "product-1", before: null, after: null },
      },
      touched: [
        {
          entity: AuditEntity.SUPPLIER_MAPPING,
          action: AuditAction.CREATE,
          fields: ["supplier_product_code"],
          changes: [{ id: "sm-1", before: null, after: { supplier_product_code: "789" } }],
        },
      ],
      mirror: true,
    });

    expect(entries).toHaveLength(2);
    expect(entries[1]).toEqual({
      userId: "user-1",
      origin: undefined,
      entity: AuditEntity.SUPPLIER_MAPPING,
      internalId: "sm-1",
      action: AuditAction.CREATE,
      changes: {
        summary: "resumo",
        before: null,
        after: { supplier_product_code: "789" },
        origin: { entity: AuditEntity.PRODUCT, internal_id: "product-1", label: undefined },
      },
    });
  });
});
