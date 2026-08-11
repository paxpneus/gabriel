// modules/.../cte/cte-upsert.service.ts
import { XmlDocumentResult } from "../map-fiscal-documents.types";
import { extractCteFromXml } from "./cte-xml-parser";
import cteService from "../../../../../../warehouse/fiscal/ctes/cte/cte.service";
import { resolveCteIssuerAsTransporter } from "./cte-party-resolver.service";
import { encryptXml } from "../../../../../../../shared/utils/xml/xml-cipher";
import { CteCreationAttributes } from "../../../../../../warehouse/fiscal/ctes/cte/cte.types";

// Resolve o nome do tomador com base em qual papel ele corresponde,
// já que o XML não repete o nome do tomador — só o taxId + o taker_type.
function resolveTakerName(extracted: ReturnType<typeof extractCteFromXml>): string | null {
  if (!extracted.takerTaxId) return null;

  if (extracted.takerTaxId === extracted.senderTaxId) return extracted.senderName ?? null;
  if (extracted.takerTaxId === extracted.recipientTaxId) return extracted.recipientName ?? null;
  if (extracted.takerTaxId === extracted.dispatcherTaxId) return extracted.dispatcherName ?? null;
  if (extracted.takerTaxId === extracted.receiverTaxId) return extracted.receiverName ?? null;

  return null;
}

export async function fetchAndUpsertCte(doc: XmlDocumentResult): Promise<void> {
  const xmlContent = Buffer.from(doc.xmlBase64, "base64").toString("utf-8");
  const extracted = extractCteFromXml(xmlContent);

  if (!extracted.chave) {
    console.warn("[CTE_UPSERT] CTe sem chave de acesso identificável. Ignorado.");
    return;
  }

  // ─── Issuer: sempre Transportador — único papel com mapeamento fixo,
  //     por isso é o único que ainda passa por um resolver dedicado ────────
  if (extracted.issuerTaxId) {
    await resolveCteIssuerAsTransporter(
      extracted.issuerTaxId,
      extracted.issuerName,
      extracted.issuerCity,
      extracted.issuerUf,
    );
  }

  const cteData: CteCreationAttributes = {
    xml_key: extracted.chave,
    number: extracted.number ?? 0,
    series: extracted.series ?? 0,
    total_value: extracted.totalValue,
    issue_date: extracted.issueDate ?? new Date(),
    operation_date: extracted.operationDate ?? new Date(),

    issuer_tax_id: extracted.issuerTaxId ?? "",
    issuer_name: extracted.issuerName ?? null,

    sender_tax_id: extracted.senderTaxId ?? null,
    sender_name: extracted.senderName ?? null,

    recipient_tax_id: extracted.recipientTaxId ?? null,
    recipient_name: extracted.recipientName ?? null,

    dispatcher_tax_id: extracted.dispatcherTaxId ?? null,
    dispatcher_name: extracted.dispatcherName ?? null,

    receiver_tax_id: extracted.receiverTaxId ?? null,
    receiver_name: extracted.receiverName ?? null,

    taker_type: extracted.takerType ?? null,
    taker_tax_id: extracted.takerTaxId ?? null,
    taker_name: resolveTakerName(extracted),

    xml_path: encryptXml(xmlContent),
  };

  const existing = await cteService.findOne({ where: { xml_key: extracted.chave } });

  if (existing) {
    await cteService.update(existing.id, cteData);
    console.log(`[CTE_UPSERT] CTe atualizado: chave=${extracted.chave}`);
  } else {
    await cteService.create(cteData);
    console.log(`[CTE_UPSERT] CTe criado: chave=${extracted.chave}`);
  }
}