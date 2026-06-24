import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import {
  ProductConfig,
  Product,
  SupplierMapping,
  Stock,
} from "../../../inventory";
import Customer from "../../../sales/customers/customers.model";
import UnitBusiness from "../../../warehouse/unit-business/unit-business.model";
import {
  TCarProdutoPayload,
  TCarClientePayload,
  TCarInvoiceXmlPayload,
  TCarResource,
  TCarAction,
  TCarNotaFiscalItem,
} from "../service/tecinco/tecinco.types";
import { getTCarIntegration } from "../api/tecinco_api";
import {
  TCarConferenciaEstoqueService,
  TCarNotaFiscalXmlByChaveComposta,
} from "../service/conferencias-estoque/conferencias-estoque.service";
import { upsertInvoiceFromXml } from "../../../../shared/utils/xml/invoice-xml";
import TCarClienteService from "../service/clientes/clientes.service";
import TCarProdutoService from "../service/produtos/produtos.service";
import { extractProductMeasureAndLine } from "../../bling/services/bling/queues/bling-api-fetch.queue";
import { normalizeEan, ensureSupplierMappings, resolveProduct } from "./helpers/product.helpers";
import { upsertCustomerFromTCar } from "./helpers/customer.helper";
export interface TCarUpsertJobPayload {
  eventId: string;
  resource: TCarResource;
  action: TCarAction;
  companyId: string;
  branchId?: number;
  data: unknown;
}

export class TCarUpsertQueue extends BaseQueueService<TCarUpsertJobPayload> {
  constructor(options: { workless?: boolean } = {}) {
    super("TCAR_UPSERT", {
      concurrency: 1,
      limiter: { max: 5, duration: 1000 },
      workless: options.workless,
    });
  }

  async process(job: Job<TCarUpsertJobPayload>): Promise<void> {
    const { resource, action, data, branchId } = job.data;

    console.log(
      `[TCAR_UPSERT] ${resource}.${action} | eventId=${job.data.eventId}`,
    );

    switch (resource) {
      case "invoice_xml":
        await this.processInvoiceXml(data as TCarInvoiceXmlPayload, branchId);
        break;

      case "product":
        await this.processProduct(action, data as TCarProdutoPayload, branchId);
        break;

      case "customer":
        await this.processCustomer(action, data as TCarClientePayload);
        break;

      default:
        console.warn(`[TCAR_UPSERT] Resource desconhecido: ${resource}`);
    }
  }

  // ─── Produto ───────────────────────────────────────────────────────────────

  private async processProduct(
  action: TCarAction,
  data: TCarProdutoPayload,
  branchId?: number,
): Promise<void> {
  const systemId = String(data.epctb_codigo);
  const logPrefix = `[TCAR_UPSERT][processProduct] id_system=${systemId}`;

  if (action === "deleted") {
    const deleted = await Product.destroy({ where: { id_system: systemId } });
    console.log(`${logPrefix} — deletado (${deleted} reg)`);
    return;
  }

  const filialNumber = String(data.fll_codigo ?? branchId ?? "").padStart(2, "0");
  const unitBusiness = filialNumber
    ? await UnitBusiness.findOne({ where: { number: filialNumber } })
    : null;

  if (!unitBusiness) {
    console.warn(`${logPrefix} — UnitBusiness não encontrada para fll_codigo=${filialNumber}`);
  }

  const integrations = await getTCarIntegration("Tecinco");
  const ean = normalizeEan(data.epctb_ean);
  const codigoFabrica = data.epctb_codigofabrica
    ? String(data.epctb_codigofabrica).trim()
    : undefined;

  // ─── Resolve produto pelos identificadores ────────────────────────────────
  let product = await resolveProduct({ systemId, codigoFabrica, ean, logPrefix });

  const isOwnProduct = !product || product.integrations_id === integrations.id;

  // ─── Produto de outra integração → apenas vincula, não sobrescreve ────────
  if (product && !isOwnProduct) {
    console.log(`${logPrefix} — produto pertence a outra integração (id=${product.integrations_id}) — apenas vinculando`);

    const supplierCnpj = unitBusiness?.cnpj ?? null;
    if (supplierCnpj && unitBusiness) {
      await ProductConfig.upsert(
        {
          product_id: product.id,
          unit_business_id: unitBusiness.id,
          sku: codigoFabrica ?? systemId,
          price: data.epprc_preco ?? 0,
          supplier_cost_price: Number(data.epcte_custcont ?? 0),
          average_cost: Number(data.epcte_custcont ?? 0) > 0 ? Number(data.epcte_custcont) : 0,
        },
        { conflictFields: ["product_id", "unit_business_id"] },
      );

      await ensureSupplierMappings({
        productId: product.id,
        supplierCnpj,
        ean,
        codigoFabrica,
        logPrefix,
      });
    } else {
      console.warn(`${logPrefix} — CNPJ do fornecedor não resolvível para filial=${filialNumber} — SupplierMapping não registrado`);
    }

    return;
  }

  // ─── Produto próprio da Tecinco: cria ou atualiza ─────────────────────────
  const { measure, line } = extractProductMeasureAndLine(data.epctb_nome, data.marca_descricao);

  const [upsertedProduct] = await Product.upsert(
    {
      id_system: systemId,
      name: data.epctb_nome?.trim() ?? "",
      ean,
      unit: data.epctb_unidade,
      gross_weight: data.epctb_pesobruto,
      net_weight: data.epctb_pesoliq,
      category: "TIRE",
      measure,
      line,
      brand: data.marca_descricao,
      integrations_id: integrations.id,
      source_payload: data as unknown as Record<string, unknown>,
    },
    { conflictFields: ["id_system"] },
  );
  product = upsertedProduct;
  console.log(`${logPrefix} — produto upsertado: id=${product.id}`);

  if (!unitBusiness) return;

  // ─── ProductConfig + Stock ────────────────────────────────────────────────
  const entryUnitCost = Number(data.epcte_custcont ?? 0);
  const stockQty = Math.round(Number(data.epcte_estoque ?? 0));

  const existingStock = await Stock.findOne({
    where: { product_id: product.id, unit_business_id: unitBusiness.id },
  });
  const oldQuantity = Number(existingStock?.quantity ?? 0);
  const oldTotalPrice = Number(existingStock?.total_price ?? 0);
  const newAverageCost =
    entryUnitCost > 0
      ? entryUnitCost
      : oldQuantity > 0
        ? oldTotalPrice / oldQuantity
        : 0;

  await ProductConfig.upsert(
    {
      product_id: product.id,
      unit_business_id: unitBusiness.id,
      sku: codigoFabrica ?? systemId,
      price: data.epprc_preco ?? 0,
      supplier_cost_price: entryUnitCost,
      average_cost: newAverageCost,
      average_cost_updated_at: new Date(),
    },
    { conflictFields: ["product_id", "unit_business_id"] },
  );

  await Stock.upsert(
    {
      product_id: product.id,
      unit_business_id: unitBusiness.id,
      quantity: stockQty,
      total_price: stockQty * newAverageCost,
    },
    { conflictFields: ["product_id", "unit_business_id"] },
  );

  console.log(
    `${logPrefix} — Stock upsertado: qty=${stockQty} | avg_cost=${newAverageCost.toFixed(4)} | total_price=${(stockQty * newAverageCost).toFixed(2)}`,
  );

  // ─── SupplierMappings ─────────────────────────────────────────────────────
  await ensureSupplierMappings({
    productId: product.id,
    supplierCnpj: unitBusiness.cnpj ?? "00000000000000",
    ean,
    codigoFabrica,
    logPrefix,
  });
}


  // ─── Cliente ───────────────────────────────────────────────────────────────

  private async processCustomer(
    action: TCarAction,
    data: TCarClientePayload,
  ): Promise<void> {
    const systemId = String(data.cln_codigo);
    const document = data.cln_cpfcnpj?.replace(/\D/g, "") || null;

    if (action === "deleted") {
      // Customer não tem id_system — deleta pelo document se disponível
      if (!document) {
        console.warn(
          `[TCAR_UPSERT] Delete de cliente cln_codigo=${systemId} sem document — ignorado`,
        );
        return;
      }
      const deleted = await Customer.destroy({ where: { document } });
      console.log(
        `[TCAR_UPSERT] Cliente deletado: document=${document} (${deleted} reg)`,
      );
      return;
    }

    if (!document) {
      console.warn(
        `[TCAR_UPSERT] Cliente cln_codigo=${systemId} sem CPF/CNPJ — ignorado`,
      );
      return;
    }

    const name = data.cln_nome?.trim() ?? "";
    const type: "F" | "J" = data.cln_fisjur === "J" ? "J" : "F";

    const existing = await Customer.findOne({ where: { document } });

    if (existing) {
      await existing.update({ name, type });
    } else {
      await Customer.create({ name, type, document });
    }

    console.log(`[TCAR_UPSERT] Cliente upsertado: document=${document}`);
  }

  // ─── Invoice XML ───────────────────────────────────────────────────────────

  // ─── Invoice XML ───────────────────────────────────────────────────────────────

  private async processInvoiceXml(
    data: TCarInvoiceXmlPayload,
    branchId?: number,
  ): Promise<void> {
    if (!branchId) {
      console.warn("[TCAR_UPSERT] processInvoiceXml sem branchId — ignorado");
      return;
    }
    const { numero, entrada_saida, ...identificacao } = data;
    const logPrefix = `[TCAR_UPSERT] invoice_xml numero=${numero} branchId=${branchId}`;

    if (entrada_saida && entrada_saida !== "E") {
      console.log(`${logPrefix} — nota de saída (${entrada_saida}), ignorando`);
      return;
    }

    const conferenciaService = new TCarConferenciaEstoqueService();
    const chaveComposta = identificacao as TCarNotaFiscalXmlByChaveComposta;

    // ─── Busca detalhe da nota fiscal e garante produtos dos itens ───────────
    try {
      const notaFiscal = await conferenciaService.getNotaFiscal(
        numero,
        branchId,
        chaveComposta,
      );

      const itens = notaFiscal?.data?.itens ?? [];
      const clnCodigo = notaFiscal?.data?.cliente?.codigo ?? data.cln_codigo;

      // ─── Upsert do customer da nota ──────────────────────────────────────
      if (clnCodigo) {
        await upsertCustomerFromTCar(branchId, clnCodigo, logPrefix);
      } else {
        console.warn(
          `${logPrefix} — cln_codigo não resolvido, customer não sincronizado`,
        );
      }

      if (Array.isArray(itens) && itens.length > 0) {
        await this.ensureProductsFromInvoiceItems(itens, branchId);
      } else {
        console.warn(`${logPrefix} — nota fiscal sem itens retornados`);
      }
    } catch (err: any) {
      if (err?.response?.status === 404) {
        console.warn(
          `${logPrefix} — detalhe da nota fiscal não encontrado (404), seguindo sem upsert de produtos`,
        );
      } else {
        console.error(
          `${logPrefix} — erro ao buscar detalhe da nota fiscal: ${err?.message ?? err}`,
        );
      }
    }

    let xml: string | null = null;

    try {
      xml = await conferenciaService.buscarXmlNotaFiscal(
        branchId,
        numero,
        chaveComposta,
      );
    } catch (err: any) {
      if (err?.response?.status === 404) {
        console.warn(`${logPrefix} — XML não disponível (404), ignorando`);
        return;
      }
      throw err;
    }

    if (!xml?.trim()) {
      console.warn(`${logPrefix} — XML vazio, ignorando`);
      return;
    }

    await upsertInvoiceFromXml(xml);
    console.log(`${logPrefix} — invoice upsertada com sucesso`);
  }

  // ─── Upsert customer a partir da TeCinco ─────────────────────────────────────



  // ─── Garante produtos a partir dos itens da nota fiscal ─────────────────────

  private async ensureProductsFromInvoiceItems(
  itens: TCarNotaFiscalItem[],
  branchId: number,
): Promise<void> {
  const unitBusiness = await UnitBusiness.findOne({
    where: { number: String(branchId).padStart(2, "0") },
  });

  if (!unitBusiness) {
    console.warn(
      `[TCAR_UPSERT] UnitBusiness não encontrada para branchId=${branchId} — produtos da nota não serão vinculados`,
    );
  }

  const integrations = await getTCarIntegration("Tecinco");
  const produtoService = new TCarProdutoService();

  for (const item of itens) {
    const systemId = String(item.epctb_codigo ?? "").trim();
    const logPrefix = `[TCAR_UPSERT][ensureProducts] seq=${item.epeit_seq} systemId=${systemId}`;

    if (!systemId) {
      console.warn(`${logPrefix} — sem epctb_codigo, ignorado`);
      continue;
    }

    // ─── Busca Tecinco API para obter codigoFabrica e EAN ────────────────────
    let tcarPayload: any = null;
    let codigoFabrica: string | undefined;
    let ean: string | undefined;

    try {
      const resultado = await produtoService.obterProduto(branchId, systemId);
      tcarPayload = resultado?.data ?? resultado;
      codigoFabrica = tcarPayload?.epctb_codigofabrica
        ? String(tcarPayload.epctb_codigofabrica).trim()
        : undefined;
      ean = normalizeEan(tcarPayload?.epctb_ean);
    } catch (err: any) {
      console.warn(`${logPrefix} — falha ao buscar produto na Tecinco: ${err?.message ?? err}`);
    }

    // ─── Resolve produto pelos identificadores ────────────────────────────────
    let product = await resolveProduct({ systemId, codigoFabrica, ean, logPrefix });

    // ─── Produto não encontrado → cria ───────────────────────────────────────
    if (!product) {
      const { measure, line } = extractProductMeasureAndLine(
        tcarPayload?.epctb_nome ?? item.produto_nome,
        tcarPayload?.marca_descricao,
      );

      const [created] = await Product.upsert(
        {
          id_system: systemId,
          name: (tcarPayload?.epctb_nome ?? item.produto_nome)?.trim() ?? "",
          ean,
          unit: tcarPayload?.epctb_unidade ?? item.produto_unidade,
          category: "TIRE",
          measure,
          line,
          brand: tcarPayload?.marca_descricao,
          integrations_id: integrations.id,
          source_payload: (tcarPayload ?? item) as unknown as Record<string, unknown>,
        },
        { conflictFields: ["id_system"] },
      );
      product = created;
      console.log(`${logPrefix} — produto criado: id=${product.id} | sku_fabrica=${codigoFabrica}`);

      // Stock inicial (só para produtos recém-criados)
      if (unitBusiness) {
        const itemQty = Number(item.epeit_qtdade ?? 0);
        const itemUnitCost = Number(tcarPayload?.epcte_custcont ?? item.epeit_vlrunit ?? 0);
        await Stock.upsert(
          {
            product_id: product.id,
            unit_business_id: unitBusiness.id,
            quantity: itemQty,
            total_price: itemQty * itemUnitCost,
          },
          { conflictFields: ["product_id", "unit_business_id"] },
        );
      }
    }

    if (!product) {
      console.error(`${logPrefix} — produto não resolvido e criação falhou, ignorando`);
      continue;
    }

    // ─── Garante ProductConfig para a unit_business ───────────────────────────
    if (unitBusiness) {
      const existingConfig = await ProductConfig.findOne({
        where: { product_id: product.id, unit_business_id: unitBusiness.id },
      });

      if (!existingConfig) {
        const skuToUse = codigoFabrica ?? systemId;
        await ProductConfig.upsert(
          {
            product_id: product.id,
            unit_business_id: unitBusiness.id,
            sku: skuToUse,
            price: Number(tcarPayload?.epprc_preco ?? 0),
            supplier_cost_price: Number(tcarPayload?.epcte_custcont ?? item.epeit_vlrunit ?? 0),
            average_cost: Number(tcarPayload?.epcte_custcont ?? item.epeit_vlrunit ?? 0),
            average_cost_updated_at: new Date(),
          },
          { conflictFields: ["product_id", "unit_business_id"] },
        );
        console.log(`${logPrefix} — ProductConfig garantido: sku=${skuToUse}`);
      }
    }

    // ─── SupplierMappings ─────────────────────────────────────────────────────
    await ensureSupplierMappings({
      productId: product.id,
      supplierCnpj: unitBusiness?.cnpj ?? "00000000000000",
      ean,
      codigoFabrica,
      logPrefix,
    });
  }
}

  protected override onFailed(
    job: Job<TCarUpsertJobPayload>,
    error: Error,
  ): void {
    alertService.sendAlert({
      severity: "HIGH",
      title: "TCarUpsertQueue — job esgotou tentativas",
      message: `Job: ${job.id} | Resource: ${job.data.resource} | Action: ${job.data.action} | EventId: ${job.data.eventId} | Erro: ${error.message}`,
    });
  }
}
