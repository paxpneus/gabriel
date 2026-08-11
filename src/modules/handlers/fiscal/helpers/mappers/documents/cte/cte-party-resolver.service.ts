// modules/.../cte/cte-party-resolver.service.ts
import { cleanDocument } from "../../../../../../../shared/utils/normalizers/document";
import unitBusinessService from "../../../../../../company/unit-business/unit-business.service";
import supplierService from "../../../../../../inventory/suppliers/supplier.service";
import contactsService from "../../../../../../sales/contacts/contacts.service";
import transporterService from "../../../../../../warehouse/transporter/transporter.service";

export type CtePartyType =
  | "CUSTOMER"
  | "SUPPLIER"
  | "UNIT_BUSINESS"
  | "TRANSPORTER"
  | "UNKNOWN";

export interface ResolvedCteParty {
  taxId: string;
  type: CtePartyType;
  entityId: string | null;
  created: boolean;
}

interface ResolveCtePartyParams {
  taxId: string | null;
  name: string | null;
  city?: string | null;
  uf?: string | null;
  /** Ordem de prioridade de busca. */
  allowedTypes: CtePartyType[];
  /**
   * Se não achar em nenhuma tabela, faz upsert nessa tabela.
   * Não pode ser UNIT_BUSINESS (não criamos unit business a partir de XML).
   */
  createAsFallback?: Exclude<CtePartyType, "UNIT_BUSINESS" | "UNKNOWN">;
}

export async function resolveCteParty(
  params: ResolveCtePartyParams,
): Promise<ResolvedCteParty | null> {
  const { taxId, name, city, uf, allowedTypes, createAsFallback } = params;

  if (!taxId) return null;

  const cleanTaxId = cleanDocument(taxId) ?? taxId;
  const partyName = name?.trim() || `SEM NOME (${cleanTaxId})`;

  // ─── 1. Tenta achar em cada tabela permitida, na ordem de prioridade ────
  if (allowedTypes.includes("UNIT_BUSINESS")) {
    const unit = await unitBusinessService.findOne({ where: { cnpj: cleanTaxId } });
    if (unit) return { taxId: cleanTaxId, type: "UNIT_BUSINESS", entityId: unit.id, created: false };
  }

  if (allowedTypes.includes("TRANSPORTER") && createAsFallback !== "TRANSPORTER") {
    const transporter = await transporterService.findOne({ where: { cnpj: cleanTaxId } });
    if (transporter) return { taxId: cleanTaxId, type: "TRANSPORTER", entityId: transporter.id, created: false };
  }

  if (allowedTypes.includes("CUSTOMER") && createAsFallback !== "CUSTOMER") {
    const customer = await contactsService.findOne({
      where: { document: cleanTaxId, type: "CUSTOMER" },
    });
    if (customer) return { taxId: cleanTaxId, type: "CUSTOMER", entityId: customer.id, created: false };
  }

  if (allowedTypes.includes("SUPPLIER") && createAsFallback !== "SUPPLIER") {
    const supplier = await supplierService.findOne({ where: { document: cleanTaxId } });
    if (supplier) return { taxId: cleanTaxId, type: "SUPPLIER", entityId: supplier.id, created: false };
  }

  // ─── 2. Não achou em nenhuma — upsert conforme fallback ─────────────────
  if (!createAsFallback) {
    console.warn(`[CTE_PARTY_RESOLVER] ${cleanTaxId} não encontrado e sem fallback de criação definido.`);
    throw new Error(`[CTE_PARTY_RESOLVER] Parte com documento "${taxId}" não encontrada em nenhuma das tabelas permitidas (${allowedTypes.join(", ")}) e nenhum fallback de criação foi definido.`)
  }

  switch (createAsFallback) {
    case "TRANSPORTER": {
      const before = await transporterService.findOne({ where: { cnpj: cleanTaxId } });
      const transporter = await transporterService.upsertByFind(
        { cnpj: cleanTaxId },
        { name: partyName, ...(city ? { city } : {}), ...(uf ? { uf } : {}) },
        { cnpj: cleanTaxId, name: partyName, city: city ?? null, uf: uf ?? null },
      );
      return { taxId: cleanTaxId, type: "TRANSPORTER", entityId: transporter.id, created: !before };
    }

    case "SUPPLIER": {
      const before = await supplierService.findOne({ where: { document: cleanTaxId } });
      const supplier = await supplierService.upsertByFind(
        { document: cleanTaxId },
        { name: partyName, ...(city ? { city } : {}), ...(uf ? { uf } : {}) },
        {
          document: cleanTaxId,
          name: partyName,
          city: city ?? "NAO INFORMADO",
          uf: uf ?? "NI",
        },
      );
      return { taxId: cleanTaxId, type: "SUPPLIER", entityId: supplier.id, created: !before };
    }

    case "CUSTOMER": {
      const before = await contactsService.findOne({
        where: { document: cleanTaxId, type: "CUSTOMER" },
      });
      const customer = await contactsService.upsertByFind(
        { document: cleanTaxId, type: "CUSTOMER" },
        { name: partyName },
        {
          document: cleanTaxId,
          name: partyName,
          type: "CUSTOMER",
          id_system: cleanTaxId,
        },
      );
      return { taxId: cleanTaxId, type: "CUSTOMER", entityId: customer.id, created: !before };
    }

    default:
      return { taxId: cleanTaxId, type: "UNKNOWN", entityId: null, created: false };
  }
}

// Issuer do CTe é sempre transportador — sempre upsert direto, sem buscar em outras tabelas.
export async function resolveCteIssuerAsTransporter(
  taxId: string,
  name: string | null,
  city?: string | null,
  uf?: string | null,
) {
  const cleanTaxId = cleanDocument(taxId) ?? taxId;
  const partyName = name?.trim() || "TRANSPORTADOR SEM NOME";

  return transporterService.upsertByFind(
    { cnpj: cleanTaxId },
    { name: partyName, ...(city ? { city } : {}), ...(uf ? { uf } : {}) },
    { cnpj: cleanTaxId, name: partyName, city: city ?? null, uf: uf ?? null },
  );
}