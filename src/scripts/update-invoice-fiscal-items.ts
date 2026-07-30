import { parseStringPromise } from "xml2js";
import InvoiceFiscalItem from "../modules/warehouse/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import { Invoice } from "../modules/warehouse";
import { decryptXml, isEncrypted } from "../shared/utils/xml/xml-cipher";
import sequelize from "../config/sequelize";

function getTaxValue(group: any, key: string): number {
  if (!group) return 0;
  const item = Array.isArray(group) ? group[0] : group;
  return Number(item?.[key]) || 0;
}

export async function backfillAcquisitionCosts() {
  const BATCH_SIZE = 100;
  let offset = 0;
  let processedInvoices = 0;
  let skippedNullXmlInvoices = 0;

  console.log("🚀 Iniciando o Backfill do acquisition_unit_cost...");

  while (true) {
    const invoices = await Invoice.findAll({
      attributes: ["id", "xml_path"],
      limit: BATCH_SIZE,
      offset: offset,
      order: [["createdAt", "ASC"]],
    });

    if (invoices.length === 0) break;

    console.log(`📦 Processando lote de ${invoices.length} notas (Offset: ${offset})...`);

    for (const invoice of invoices) {
      try {
        const rawXml = (invoice as any).xml_path;

        // ⚠️ Validação de XML nulo, indefinido ou vazio
        if (!rawXml || typeof rawXml !== "string" || rawXml.trim() === "") {
          console.warn(`⚠️ [SKIP] Invoice ID ${invoice.id} ignorada: 'xml_path' está null ou vazio.`);
          skippedNullXmlInvoices++;
          continue; // Não segue o processamento para esta nota
        }

        // 1. Descriptografa e limpa caracteres de controle/invisíveis do XML
        let xmlContent = isEncrypted(rawXml) ? decryptXml(rawXml) : rawXml;
        xmlContent = xmlContent
          .replace(/^\uFEFF/, "") // Remove BOM
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // Remove caracteres de controle inválidos
          .trim();

        if (!xmlContent) {
          console.warn(`⚠️ [SKIP] Invoice ID ${invoice.id} ignorada: XML descriptografado ficou vazio.`);
          skippedNullXmlInvoices++;
          continue;
        }

        // 2. Parse do XML
        const parsedXml = await parseStringPromise(xmlContent, {
          explicitArray: false,
          ignoreAttrs: false,
        });

        const nfeProc = parsedXml.nfeProc ?? parsedXml;
        const infNFe = nfeProc?.NFe?.infNFe;

        if (!infNFe) {
          console.warn(`⚠️ [SKIP] Invoice ID ${invoice.id} ignorada: Estrutura NFe/infNFe não encontrada no XML.`);
          continue;
        }

        const detList = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det];

        // 3. Busca itens fiscais no banco
        const dbFiscalItems = await InvoiceFiscalItem.findAll({
          where: { invoice_id: invoice.id },
        });

        if (!dbFiscalItems.length) continue;

        // 4. Atualização via Transaction
        await sequelize.transaction(async (transaction) => {
          for (const det of detList) {
            const itemNumber = Number(det.$?.nItem);
            const prod = det.prod ?? {};
            const imposto = det.imposto ?? {};

            const dbItem = dbFiscalItems.find(
              (i) => i.item_number === itemNumber || i.sku === prod.cProd
            );

            if (!dbItem) continue;

            const qty = Number(prod.qCom) || 1;
            const vProd = Number(prod.vProd) || 0;
            const freightValue = Number(prod.vFrete) || 0;
            const insuranceValue = Number(prod.vSeg) || 0;
            const otherExpensesValue = Number(prod.vOutro) || 0;
            const discountValue = Number(prod.vDesc) || 0;

            const ipiObj = imposto.IPI?.IPITrib ?? imposto.IPI?.IPINT;
            const vIPI = getTaxValue(ipiObj, "vIPI");

            const icmsGroup = imposto.ICMS ? Object.values(imposto.ICMS)[0] : {};
            const icmsStValue = getTaxValue(icmsGroup, "vICMSST");

            const acquisitionTotal =
              vProd +
              freightValue +
              insuranceValue +
              otherExpensesValue +
              vIPI +
              icmsStValue -
              discountValue;

            const acquisitionUnitCost = qty > 0 ? acquisitionTotal / qty : 0;

            await dbItem.update(
              {
                freight_value: freightValue,
                insurance_value: insuranceValue,
                other_expenses_value: otherExpensesValue,
                discount_value: discountValue,
                ipi_value: vIPI,
                icms_st_value: icmsStValue,
                acquisition_unit_cost: acquisitionUnitCost,
              },
              { transaction }
            );
          }
        });

        processedInvoices++;
      } catch (err) {
        console.error(`❌ Erro ao processar Invoice ID ${invoice.id}:`, err);
      }
    }

    offset += BATCH_SIZE;
  }

  console.log("\n--- RESUMO DO PROCESSAMENTO ---");
  console.log(`✅ Total de notas processadas com sucesso: ${processedInvoices}`);
  console.log(`⚠️ Total de notas ignoradas (XML null/vazio): ${skippedNullXmlInvoices}`);
}

// Adicione isso na última linha do arquivo para executar o script
backfillAcquisitionCosts()
  .then(() => {
    console.log("🏁 Processamento finalizado com sucesso!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Erro fatal ao rodar backfill:", err);
    process.exit(1);
  });