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
export interface TCarUpsertJobPayload {
  eventId: string;
  resource: TCarResource;
  action: TCarAction;
  companyId: string;
  branchId?: number;
  data: unknown;
}

function normalizeEan(ean?: string): string | undefined {
  if (!ean || ean.trim() === "" || ean.trim().toUpperCase() === "SEM GTIN")
    return undefined;
  return ean.trim();
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

    if (action === "deleted") {
      const deleted = await Product.destroy({ where: { id_system: systemId } });
      console.log(
        `[TCAR_UPSERT] Produto deletado: id_system=${systemId} (${deleted} reg)`,
      );
      return;
    }

    const filialNumber = String(data.fll_codigo ?? branchId ?? "").padStart(
      2,
      "0",
    );
    const unitBusiness = filialNumber
      ? await UnitBusiness.findOne({ where: { number: filialNumber } })
      : null;

    if (!unitBusiness) {
      console.warn(
        `[TCAR_UPSERT] UnitBusiness não encontrada para fll_codigo=${filialNumber} — product_config será ignorado`,
      );
    }

    const integrations = await getTCarIntegration("Tecinco");
    const ean = normalizeEan(data.epctb_ean);

    // ─── Verifica se já existe produto com esse EAN de outra integração ──────
    // Se existir e NÃO for da Tecinco, apenas registra o SupplierMapping (de x para)
    // e NÃO faz upsert do produto em si
    if (ean) {
      const existingProduct = await Product.findOne({
        where: { ean },
      });

      if (
        existingProduct &&
        existingProduct.integrations_id !== integrations.id
      ) {
        console.log(
          `[TCAR_UPSERT] Produto EAN=${ean} pertence a outra integração (id=${existingProduct.integrations_id}) — registrando SupplierMapping apenas`,
        );

        // CNPJ do emitente/fornecedor Tecinco — precisa vir da UnitBusiness
        // ou de um campo fixo configurado para a integração
        const supplierCnpj = unitBusiness?.cnpj ?? null;

        if (supplierCnpj) {
          const existingMapping = await SupplierMapping.findOne({
            where: {
              product_id: existingProduct.id,
              supplier_cnpj: supplierCnpj,
            },
          });

          if (existingMapping) {
            await existingMapping.update({
              supplier_product_code: ean,
            });
          } else {
            await SupplierMapping.create({
              product_id: existingProduct.id,
              supplier_cnpj: supplierCnpj,
              supplier_product_code: ean,
            });
          }

          await ProductConfig.upsert(
            {
              product_id: existingProduct.id,
              unit_business_id: unitBusiness!.id,
              sku: systemId,
              price: data.epprc_preco ?? 0,
              supplier_cost_price: Number(data.epcte_custcont ?? 0),
              average_cost:
                Number(data.epcte_custcont ?? 0) > 0
                  ? Number(data.epcte_custcont)
                  : 0,
            },
            { conflictFields: ["product_id", "unit_business_id"] },
          );

          console.log(
            `[TCAR_UPSERT] SupplierMapping ${existingMapping ? "atualizado" : "criado"}: product_id=${existingProduct.id} | sku_tecinco=${systemId} | cnpj=${supplierCnpj}`,
          );
        } else {
          console.warn(
            `[TCAR_UPSERT] CNPJ do fornecedor Tecinco não resolvível para filial=${filialNumber} — SupplierMapping não registrado`,
          );
        }

        return; // não toca no produto de outra integração
      }
    }

    // ─── Produto é da Tecinco (ou não existe ainda) — faz upsert normal ──────
    const [product] = await Product.upsert(
      {
        id_system: systemId,
        name: data.epctb_nome?.trim() ?? "",
        ean,
        unit: data.epctb_unidade,
        gross_weight: data.epctb_pesobruto,
        net_weight: data.epctb_pesoliq,
        category: "TIRE",
        integrations_id: integrations.id,
        source_payload: data as unknown as Record<string, unknown>,
      },
      { conflictFields: ["id_system"] },
    );

    // ─── SupplierMapping para produtos próprios da Tecinco também ────────────
    // Permite que o findProductForInvoiceItem resolva por supplier_product_code
    const supplierCnpj = unitBusiness?.cnpj ?? null;

    if (supplierCnpj) {
      const existingMapping = await SupplierMapping.findOne({
        where: { product_id: product.id, supplier_cnpj: supplierCnpj },
      });

      if (existingMapping) {
        await existingMapping.update({ supplier_product_code: ean });
      } else if (!existingMapping && ean) {
        await SupplierMapping.create({
          product_id: product.id,
          supplier_cnpj: supplierCnpj,
          supplier_product_code: ean,
        });
      }
    }

    if (!unitBusiness) return;

    // ─── Upsert de estoque ────────────────────────────────────────────────────
    const stockQty = Math.round(Number(data.epcte_estoque ?? 0));
    const entryUnitCost = Number(data.epcte_custcont ?? 0);

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
        sku: systemId,
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
      `[TCAR_UPSERT] Stock upsertado: id_system=${systemId} | qty=${stockQty} | avg_cost=${newAverageCost.toFixed(4)} | total_price=${(stockQty * newAverageCost).toFixed(2)}`,
    );
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
        await this.upsertCustomerFromTCar(branchId, clnCodigo, logPrefix);
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

  private async upsertCustomerFromTCar(
    branchId: number,
    clnCodigo: number | string,
    logPrefix: string,
  ): Promise<void> {
    const clienteService = new TCarClienteService();

    let raw: any;
    try {
      raw = await clienteService.obterCliente(branchId, clnCodigo);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        console.warn(
          `${logPrefix} — cliente cln_codigo=${clnCodigo} não encontrado na TeCinco (404)`,
        );
        return;
      }
      console.error(
        `${logPrefix} — erro ao buscar cliente cln_codigo=${clnCodigo}: ${err?.message ?? err}`,
      );
      return; // não interrompe o fluxo da invoice
    }

    // A resposta do GET /clientes/:id não é paginada — é o objeto direto
    const c = raw?.data ?? raw;

    const document =
      (c?.CLN_CPFCNPJ ?? c?.cln_cpfcnpj)?.replace(/\D/g, "") || null;

    if (!document) {
      console.warn(
        `${logPrefix} — cliente cln_codigo=${clnCodigo} sem CPF/CNPJ — ignorado`,
      );
      return;
    }

    const name: string = (c?.CLN_NOME ?? c?.cln_nome ?? c?.nome ?? "").trim();
    const type: "F" | "J" =
      (c?.CLN_FISJUR ?? c?.cln_fisjur ?? c?.tipo_pessoa) === "J" ? "J" : "F";

    const existing = await Customer.findOne({ where: { document } });

    if (existing) {
      await existing.update({ name, type });
    } else {
      await Customer.create({ name, type, document });
    }

    console.log(`${logPrefix} — customer upsertado: document=${document}`);
  }

  // ─── Garante produtos a partir dos itens da nota fiscal ─────────────────────

  private async ensureProductsFromInvoiceItems(
    itens: TCarNotaFiscalItem[],
    branchId: number,
  ): Promise<void> {
    const unitBusiness = await UnitBusiness.findOne({
      where: { id: branchId },
    });

    if (!unitBusiness) {
      console.warn(
        `[TCAR_UPSERT] UnitBusiness não encontrada para branchId=${branchId} — produtos da nota não serão vinculados a estoque/preço`,
      );
    }

    const integrations = await getTCarIntegration("Tecinco");

    for (const item of itens) {
      const systemId = String(item.epctb_codigo ?? "").trim();

      if (!systemId) {
        console.warn(
          `[TCAR_UPSERT] Item de nota fiscal sem epctb_codigo (seq=${item.epeit_seq}) — ignorado`,
        );
        continue;
      }

      const existingProduct = await Product.findOne({
        where: { id_system: systemId },
      });

      if (existingProduct) {
        // produto já existe — não sobrescreve dados, apenas garante presença
        continue;
      }

      const [product] = await Product.upsert(
        {
          id_system: systemId,
          name: item.produto_nome?.trim() ?? "",
          ean: undefined,
          unit: item.produto_unidade,
          category: "TIRE",
          integrations_id: integrations.id,
          source_payload: item as unknown as Record<string, unknown>,
        },
        { conflictFields: ["id_system"] },
      );

      console.log(
        `[TCAR_UPSERT] Produto criado a partir de item de nota fiscal: id_system=${systemId} | nome=${item.produto_nome}`,
      );

      if (!unitBusiness) continue;

      // ─── SupplierMapping universal (código Tecinco, CNPJ zerado) ──────────────
      const existingUniversalMapping = await SupplierMapping.findOne({
        where: { product_id: product.id, supplier_cnpj: "00000000000000" },
      });

      if (!existingUniversalMapping) {
        await SupplierMapping.create({
          product_id: product.id,
          supplier_cnpj: "00000000000000",
          supplier_product_code: systemId,
        });

        console.log(
          `[TCAR_UPSERT] SupplierMapping universal criado: id_system=${systemId} | product_id=${product.id}`,
        );
      }

      // ─── ProductConfig básico (sku/price) ──────────────────────────────────
      const existingConfig = await ProductConfig.findOne({
        where: { product_id: product.id, unit_business_id: unitBusiness.id },
      });

      if (!existingConfig) {
        await ProductConfig.upsert(
          {
            product_id: product.id,
            unit_business_id: unitBusiness.id,
            sku: systemId,
            price: 0,
            supplier_cost_price: Number(item.epeit_vlrunit ?? 0),
            average_cost: Number(item.epeit_vlrunit ?? 0),
            average_cost_updated_at: new Date(),
          },
          { conflictFields: ["product_id", "unit_business_id"] },
        );

        console.log(
          `[TCAR_UPSERT] ProductConfig criado para produto da nota: id_system=${systemId} | unit_business_id=${unitBusiness.id}`,
        );

        const itemQty = Number(item.epeit_qtdade ?? 0);
        const itemUnitCost = Number(item.epeit_vlrunit ?? 0);

        const existingStock = await Stock.findOne({
          where: { product_id: product.id, unit_business_id: unitBusiness.id },
        });

        const oldQuantity = Number(existingStock?.quantity ?? 0);
        const oldTotalPrice = Number(existingStock?.total_price ?? 0);

        const newQuantity = oldQuantity + itemQty;
        const newTotalPrice = oldTotalPrice + itemQty * itemUnitCost;

        await Stock.upsert(
          {
            product_id: product.id,
            unit_business_id: unitBusiness.id,
            quantity: newQuantity,
            total_price: newTotalPrice,
          },
          { conflictFields: ["product_id", "unit_business_id"] },
        );

        console.log(
          `[TCAR_UPSERT] Stock atualizado (produto novo via nota): id_system=${systemId} | qty=${newQuantity} | total_price=${newTotalPrice.toFixed(2)}`,
        );
      }

      // ─── SupplierMapping (CNPJ do emitente da nota) ────────────────────────
      const supplierCnpj = unitBusiness.cnpj ?? null;

      if (supplierCnpj) {
        const existingMapping = await SupplierMapping.findOne({
          where: { product_id: product.id, supplier_cnpj: supplierCnpj },
        });

        if (!existingMapping) {
          await SupplierMapping.create({
            product_id: product.id,
            supplier_cnpj: supplierCnpj,
            supplier_product_code: systemId,
          });
        }
      }
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
