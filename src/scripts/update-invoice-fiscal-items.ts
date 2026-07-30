import { parseStringPromise } from "xml2js";
import { Op } from "sequelize";
import InvoiceFiscalItem from "../modules/warehouse/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import { Invoice } from "../modules/warehouse";
import { Product, ProductConfig, SupplierMapping } from "../modules/inventory";
import { decryptXml, isEncrypted } from "../shared/utils/xml/xml-cipher";
import { cleanDocument } from "../shared/utils/normalizers/document";
import sequelize from "../config/sequelize";

const BLING_UNIT_BUSINESS_ID = process.env.BLING_UNIT_BUSINESS_ID;

function getTaxValue(group: any, key: string): number {
  if (!group) return 0;
  const item = Array.isArray(group) ? group[0] : group;
  return Number(item?.[key]) || 0;
}

// ─── Resolve o produto interno com o MESMO fallback usado no bling-webhook ────
// (ean/ean_tribut → ProductConfig por SKU → SupplierMapping por código+CNPJ)
async function findProductForInvoiceItem(params: {
  sku?: string | null;
  ean?: string | number | null;
  supplierCnpj?: string | null;
}): Promise<Product | null> {
  const sku = params.sku?.trim();
  const ean = params.ean ? String(params.ean).trim() : null;

  let product: Product | null = null;

  if (ean) {
    product = await Product.findOne({
      where: { [Op.or]: [{ ean }, { ean_tribut: ean }] },
    });
  }

  if (!product && sku) {
    const config = await ProductConfig.findOne({
      where: { sku, unit_business_id: BLING_UNIT_BUSINESS_ID },
    });
    if (config) product = await Product.findByPk(config.product_id);
  }

  if (product || !ean) return product;

  const supplierProductCode: string = ean;
  const cleanSupplierCnpj = params.supplierCnpj
    ? cleanDocument(params.supplierCnpj)
    : null;

  const supplierMapping = cleanSupplierCnpj
    ? ((await SupplierMapping.findOne({
        where: {
          supplier_product_code: supplierProductCode,
          supplier_cnpj: cleanSupplierCnpj,
        },
        order: [["updatedAt", "DESC"]],
      })) ??
      (await SupplierMapping.findOne({
        where: { supplier_product_code: supplierProductCode },
        order: [["updatedAt", "DESC"]],
      })))
    : await SupplierMapping.findOne({
        where: { supplier_product_code: supplierProductCode },
        order: [["updatedAt", "DESC"]],
      });

  if (!supplierMapping) return null;

  product = await Product.findByPk(supplierMapping.product_id);
  return product;
}

// ─── Grupo agregado de itens repetidos do XML (mesmo produto) ─────────────────
interface FiscalItemGroup {
  product: Product | null;
  sku: string | null;
  gtin: string | null;
  description: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  qty: number;
  vProd: number;
  freightValue: number;
  insuranceValue: number;
  otherExpensesValue: number;
  discountValue: number;
  vIPI: number;
  icmsStValue: number;
  icmsRate: number;
  icmsValue: number;
  pisValue: number;
  cofinsValue: number;
  difalValue: number;
  ibsValue: number;
  cbsValue: number;
  approxTaxValue: number;
}

export async function backfillAcquisitionCosts() {
  const BATCH_SIZE = 100;
  let offset = 0;
  let processedInvoices = 0;
  let skippedNullXmlInvoices = 0;
  let createdFiscalItems = 0;
  let updatedFiscalItems = 0;
  let unresolvedGroups = 0;

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

        const nfeProc = parsedXml.nfeProc ?? parsedXml.procNFe ?? parsedXml;
        const infNFe = nfeProc?.NFe?.infNFe;

        if (!infNFe) {
          console.warn(`⚠️ [SKIP] Invoice ID ${invoice.id} ignorada: Estrutura NFe/infNFe não encontrada no XML.`);
          continue;
        }

        const detList = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det];
        const senderCnpj = infNFe.emit?.CNPJ ?? "";

        // 3. Busca itens fiscais já existentes no banco
        const dbFiscalItems = await InvoiceFiscalItem.findAll({
          where: { invoice_id: invoice.id },
        });

        // ─── 4. Agrupa itens do XML que são o MESMO produto ────────────────────
        // (a chave de agrupamento é o product_id resolvido; se não resolver
        //  nenhum produto, agrupa por SKU para não perder o item)
        const groups = new Map<string, FiscalItemGroup>();

        for (const det of detList) {
          const prod = det.prod ?? {};
          const imposto = det.imposto ?? {};

          const sku = prod.cProd ? String(prod.cProd).trim() : null;
          const gtin =
            prod.cEAN && prod.cEAN !== "SEM GTIN" ? String(prod.cEAN).trim() : null;

          const product = await findProductForInvoiceItem({
            sku,
            ean: gtin,
            supplierCnpj: senderCnpj,
          });

          const groupKey = product
            ? `p:${product.id}`
            : sku
              ? `s:${sku}`
              : `u:${Math.random()}`; // item sem SKU/produto resolvido, não agrupa

          const qty = Number(prod.qCom) || 1;
          const vProd = Number(prod.vProd) || 0;
          const freightValue = Number(prod.vFrete) || 0;
          const insuranceValue = Number(prod.vSeg) || 0;
          const otherExpensesValue = Number(prod.vOutro) || 0;
          const discountValue = Number(prod.vDesc) || 0;

          const ipiObj = imposto.IPI?.IPITrib ?? imposto.IPI?.IPINT;
          const vIPI = getTaxValue(ipiObj, "vIPI");

          const icmsGroupNode = imposto.ICMS ? Object.values(imposto.ICMS)[0] : {};
          const icmsStValue = getTaxValue(icmsGroupNode, "vICMSST");
          const icmsRate = getTaxValue(icmsGroupNode, "pICMS");
          const icmsValue = getTaxValue(icmsGroupNode, "vICMS");

          const pisGroupNode: any =
            imposto?.PIS?.PISAliq ??
            imposto?.PIS?.PISQtde ??
            imposto?.PIS?.PISNT ??
            imposto?.PIS?.PISOutr ??
            {};
          const pisValue = getTaxValue(pisGroupNode, "vPIS");

          const cofinsGroupNode: any =
            imposto?.COFINS?.COFINSAliq ??
            imposto?.COFINS?.COFINSQtde ??
            imposto?.COFINS?.COFINSNT ??
            imposto?.COFINS?.COFINSOutr ??
            {};
          const cofinsValue = getTaxValue(cofinsGroupNode, "vCOFINS");

          const difalValue = getTaxValue(imposto?.ICMSUFDest, "vICMSUFDest") ||
            getTaxValue(imposto?.ICMSUFDest, "vICMSDest");

          const ibsCbsGroupNode: any = imposto?.IBSCBS?.gIBSCBS ?? {};
          const ibsValue =
            getTaxValue(ibsCbsGroupNode?.gIBSUF, "vIBSUF") +
            getTaxValue(ibsCbsGroupNode?.gIBSMun, "vIBSMun");
          const cbsValue = getTaxValue(ibsCbsGroupNode?.gCBS, "vCBS");

          const approxTaxValue = Number(imposto?.vTotTrib) || 0;

          const existingGroup = groups.get(groupKey);

          if (existingGroup) {
            existingGroup.qty += qty;
            existingGroup.vProd += vProd;
            existingGroup.freightValue += freightValue;
            existingGroup.insuranceValue += insuranceValue;
            existingGroup.otherExpensesValue += otherExpensesValue;
            existingGroup.discountValue += discountValue;
            existingGroup.vIPI += vIPI;
            existingGroup.icmsStValue += icmsStValue;
            existingGroup.icmsValue += icmsValue;
            existingGroup.pisValue += pisValue;
            existingGroup.cofinsValue += cofinsValue;
            existingGroup.difalValue += difalValue;
            existingGroup.ibsValue += ibsValue;
            existingGroup.cbsValue += cbsValue;
            existingGroup.approxTaxValue += approxTaxValue;
          } else {
            groups.set(groupKey, {
              product,
              sku,
              gtin,
              description: String(prod.xProd ?? "").slice(0, 255) || null,
              ncm: prod.NCM ? String(prod.NCM) : null,
              cest: prod.CEST ? String(prod.CEST) : null,
              cfop: prod.CFOP ? String(prod.CFOP) : null,
              qty,
              vProd,
              freightValue,
              insuranceValue,
              otherExpensesValue,
              discountValue,
              vIPI,
              icmsStValue,
              icmsRate, // usa a alíquota do primeiro item do grupo
              icmsValue,
              pisValue,
              cofinsValue,
              difalValue,
              ibsValue,
              cbsValue,
              approxTaxValue,
            });
          }
        }

        if (!groups.size) continue;

        // Próximo item_number disponível, para os grupos que forem criados
        let nextItemNumber =
          dbFiscalItems.reduce((max, i) => Math.max(max, i.item_number ?? 0), 0) + 1;

        // 5. Cria ou atualiza via Transaction
        await sequelize.transaction(async (transaction) => {
          for (const group of groups.values()) {
            const acquisitionTotal =
              group.vProd +
              group.freightValue +
              group.insuranceValue +
              group.otherExpensesValue +
              group.vIPI +
              group.icmsStValue -
              group.discountValue;

            const acquisitionUnitCost =
              group.qty > 0 ? acquisitionTotal / group.qty : 0;

            const dbItem = group.product
              ? dbFiscalItems.find((i) => i.product_id === group.product!.id)
              : dbFiscalItems.find((i) => i.sku === group.sku);

            if (dbItem) {
              // ✅ Já existe: atualiza SOMENTE os campos de custo de aquisição
              await dbItem.update(
                {
                  freight_value: group.freightValue,
                  insurance_value: group.insuranceValue,
                  other_expenses_value: group.otherExpensesValue,
                  discount_value: group.discountValue,
                  ipi_value: group.vIPI,
                  icms_st_value: group.icmsStValue,
                  acquisition_unit_cost: acquisitionUnitCost,
                },
                { transaction },
              );
              updatedFiscalItems++;
            } else {
              // 🆕 Não existe: cria o fiscal item completo
              if (!group.product) {
                console.warn(
                  `⚠️ [UNRESOLVED] Invoice ID ${invoice.id} | sku=${group.sku ?? "N/A"} | produto não resolvido — fiscal item não criado.`,
                );
                unresolvedGroups++;
                continue;
              }

              await InvoiceFiscalItem.create(
                {
                  invoice_id: invoice.id,
                  product_id: group.product.id,
                  item_number: nextItemNumber++,
                  sku: group.sku,
                  description: group.description,
                  quantity: group.qty,
                  unit_price: group.qty > 0 ? group.vProd / group.qty : 0,
                  total_value: group.vProd,
                  ncm: group.ncm,
                  cest: group.cest,
                  cfop: group.cfop,
                  gtin: group.gtin,
                  approx_tax_value: group.approxTaxValue,
                  icms_rate: group.icmsRate,
                  icms_value: group.icmsValue,
                  ipi_value: group.vIPI,
                  pis_value: group.pisValue,
                  cofins_value: group.cofinsValue,
                  difal_value: group.difalValue,
                  ibs_value: group.ibsValue,
                  cbs_value: group.cbsValue,
                  freight_value: group.freightValue,
                  insurance_value: group.insuranceValue,
                  other_expenses_value: group.otherExpensesValue,
                  discount_value: group.discountValue,
                  icms_st_value: group.icmsStValue,
                  acquisition_unit_cost: acquisitionUnitCost,
                } as any,
                { transaction },
              );
              createdFiscalItems++;
            }
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
  console.log(`🆕 Fiscal items criados: ${createdFiscalItems}`);
  console.log(`♻️ Fiscal items atualizados: ${updatedFiscalItems}`);
  console.log(`❓ Grupos sem produto resolvido (não criados): ${unresolvedGroups}`);
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