import Invoice from "../../../../warehouse/invoices/invoice/invoice.model";
import InvoiceUnitBusinessAttributes from "../../../../warehouse/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import ExpeditionBatch from "../../../../warehouse/expedition/batch/batch.model";
import ExpeditionBatchInvoice from "../../../../warehouse/expedition/batch-invoices/batch-invoices.model";
import BatchInvoiceItems from "../../../../warehouse/expedition/batch-invoice-items/batch-invoice-items.model";
import ExpeditionBatchItems from "../../../../warehouse/expedition/batch-items/batch-items.model";
import UnitBusiness from "../../../../warehouse/unit-business/unit-business.model";
import {
  TCarConferenciaTipo,
  TCarNotaFiscalQueryParams,
} from "../../../../../modules/handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service";
import { Product, ProductConfig, SupplierMapping } from "../../../../inventory";
import { TCarConferenciaEstoqueService } from "./conferencias-estoque.service";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";
import {
  normalizeEan,
  resolveProduct,
} from "../../queues/helpers/product.helpers";
import TCarProdutoService from "../produtos/produtos.service";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

/**
 * Resultado da comparação entre o estado local (BatchInvoiceItems)
 * e o estado remoto (Tecinco).
 */
export interface TCarConferenciaItemDiff {
  /** seq do item conforme a Tecinco */
  seq: number;
  /** SKU conforme a Tecinco */
  produto_codigo: string;
  /** Quantidade solicitada na NF (Tecinco) */
  qtde_solicitada: number;
  /** Quantidade já conferida registrada na Tecinco */
  qtde_conferida_tecinco: number;
  /** Quantidade lida localmente (quantity_read do BatchInvoiceItem, escopado pela invoice) */
  qtde_scaneada_local: number;
  /**
   * true  → há diferença entre o que temos localmente e o que está na Tecinco
   * false → já estão em sincronia
   */
  divergente: boolean;
  /**
   * true  → SKU local não encontrado no ProductConfig/SupplierMapping/EAN para este produto
   */
  nao_encontrado_local: boolean;
}

export interface TCarConferenciaVerificacaoResult {
  /** Número da NF (number_system) */
  numero: string;
  /** true → tudo em sincronia, false → há divergências */
  sincronizado: boolean;
  itens: TCarConferenciaItemDiff[];
  /** Itens que seriam enviados num POST de conferência */
  itens_a_conferir: Array<{
    seq: number;
    produto_codigo: string;
    qtde_conferida: number;
  }>;
  extraParams: Partial<TCarNotaFiscalQueryParams>;
}

export interface TCarConferenciaPostResult {
  success: boolean;
  numero: string;
  itens_enviados: number;
  resposta_tecinco: unknown;
}

/**
 * Contexto totalmente resolvido de uma invoice dentro de um lote:
 * a junção (batchInvoice), a invoice, a unit_business (vinda do batch)
 * e o type da nota (vindo de invoice_unit_business_attributes).
 */
interface TCarConferenciaContexto {
  batchInvoiceId: string;
  invoiceId: string;
  numero: string;
  chaveNfe: string | null;
  senderCnpj: string;
  receiverCnpj: string;
  invoiceType: "INCOMING" | "OUTGOING" | null;
  unitBusiness: { id: string; cnpj: string; number?: string };
}

// ─── Helpers internos ──────────────────────────────────────────────────────────

async function findProductIdByTecincoCodigo(
  produtoCodigo: string,
  branchId: number,
  produtoService: TCarProdutoService,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(produtoCodigo)) return cache.get(produtoCodigo)!;

  let productId: string | null = null;

  try {
    const resultado = await produtoService.obterProduto(
      branchId,
      produtoCodigo,
    );
    const tcarPayload: any = resultado?.data ?? resultado;

    const codigoFabrica = tcarPayload?.epctb_codigofabrica
      ? String(tcarPayload.epctb_codigofabrica).trim()
      : undefined;
    const ean = normalizeEan(tcarPayload?.epctb_ean);

    const product = await resolveProduct({
      systemId: produtoCodigo,
      codigoFabrica,
      ean,
      logPrefix: `[TCarConferenciaPostService] produto_codigo=${produtoCodigo}`,
    });

    productId = product?.id ?? null;

    if (!productId) {
      console.warn(
        `[TCarConferenciaPostService] Produto Tecinco ${produtoCodigo} encontrado na API mas não resolvido localmente | codigoFabrica=${codigoFabrica} | ean=${ean}`,
      );
    }
  } catch (err: any) {
    console.warn(
      `[TCarConferenciaPostService] Falha ao buscar produto ${produtoCodigo} na Tecinco: ${err?.message ?? err}`,
    );
  }

  cache.set(produtoCodigo, productId);
  return productId;
}

/**
 * Dado um product_id local, resolve o SKU que a Tecinco conhece para ele.
 * Ordem: ProductConfig da unidade → SupplierMapping → EAN do produto como fallback.
 */
async function findSkuByProductId(
  productId: string,
  unitBusinessId: string,
  tecincoCodigosValidos: Set<string>,
): Promise<string | null> {
  // 1. ProductConfig — sku é o epctb_codigo da Tecinco
  const config = await ProductConfig.findOne({
    where: { product_id: productId, unit_business_id: unitBusinessId },
  });
  if (config?.sku && tecincoCodigosValidos.has(config.sku)) return config.sku;

  // 2. SupplierMapping — pega o que bate com algum item da Tecinco
  const mappings = await SupplierMapping.findAll({
    where: { product_id: productId },
  });
  for (const m of mappings) {
    if (tecincoCodigosValidos.has(m.supplier_product_code)) {
      return m.supplier_product_code;
    }
  }

  // 3. EAN como último fallback
  const product = await Product.findByPk(productId, { attributes: ["ean"] });
  if (product?.ean && tecincoCodigosValidos.has(product.ean))
    return product.ean;

  return null;
}

function notaPertenceAFilial(ctx: TCarConferenciaContexto): boolean {
  if (!ctx.invoiceType) return false;

  const cnpjFilial = cleanDocument(ctx.unitBusiness.cnpj);
  const cnpjRelevante =
    ctx.invoiceType === "OUTGOING"
      ? cleanDocument(ctx.senderCnpj)
      : cleanDocument(ctx.receiverCnpj);

  return cnpjRelevante === cnpjFilial;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class TCarConferenciaPostService {
  private readonly conferenciaService: TCarConferenciaEstoqueService;

  constructor() {
    this.conferenciaService = new TCarConferenciaEstoqueService();
  }

  // ─── Contexto ─────────────────────────────────────────────────────────────────

  /**
   * Resolve, a partir de batchId + invoiceId, a junção exata em
   * expedition_batch_invoices (não confia em association singular do Invoice,
   * já que uma invoice pode ter passado por mais de um lote ao longo do tempo),
   * a unit_business (vinda do batch) e o type da nota (invoice_unit_business_attributes).
   */
  private async carregarContexto(
    batchId: string,
    invoiceId: string,
  ): Promise<TCarConferenciaContexto> {
    const batchInvoice = (await ExpeditionBatchInvoice.findOne({
      where: { expedition_batch_id: batchId, invoice_id: invoiceId },
      include: [
        {
          model: Invoice,
          as: "invoice",
          attributes: [
            "id",
            "number_system",
            "sender_cnpj",
            "receiver_cnpj",
            "xml_key",
          ],
          required: true,
        },
        {
          model: ExpeditionBatch,
          as: "batch",
          required: true,
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
              required: true,
            },
          ],
        },
      ],
    })) as any;

    if (!batchInvoice) {
      throw new Error(
        `[TCarConferenciaPostService] Junção batch/invoice não encontrada | batch=${batchId} | invoice=${invoiceId}`,
      );
    }

    const invoice = batchInvoice.invoice;
    const unitBusiness = batchInvoice.batch.unitBusiness;

    const numero = invoice.number_system;
    if (!numero) {
      throw new Error(
        `[TCarConferenciaPostService] Invoice ${invoiceId} sem number_system`,
      );
    }

    const attrs = await InvoiceUnitBusinessAttributes.findOne({
      where: { invoice_id: invoiceId, unit_business_id: unitBusiness.id },
      attributes: ["type"],
    });

    return {
      batchInvoiceId: batchInvoice.id,
      invoiceId,
      numero,
      chaveNfe: invoice.xml_key ?? null,
      senderCnpj: invoice.sender_cnpj,
      receiverCnpj: invoice.receiver_cnpj,
      invoiceType: (attrs?.type as "INCOMING" | "OUTGOING" | undefined) ?? null,
      unitBusiness: {
        id: unitBusiness.id,
        cnpj: unitBusiness.cnpj,
        number: unitBusiness.number,
      },
    };
  }

  // ─── Verificação ─────────────────────────────────────────────────────────────

  /**
   * Lê o estado atual da conferência na Tecinco e compara com os
   * BatchInvoiceItems da junção lote+invoice local.
   *
   * A comparação é feita do lado local para o remoto:
   * para cada BatchInvoiceItem da invoice dentro do lote, resolve o SKU via
   * ProductConfig/SupplierMapping/EAN e cruza com o que a Tecinco retornou
   * no carregarDocumento.
   *
   * Não escreve nada — apenas retorna o diff para que o caller decida
   * se deve prosseguir com o post.
   */
  async verificarConferencia(
    batchId: string,
    invoiceId: string,
    branchId: number,
    tipo: TCarConferenciaTipo = "nota-fiscal",
  ): Promise<TCarConferenciaVerificacaoResult> {
    const ctx = await this.carregarContexto(batchId, invoiceId);
    return this.montarVerificacao(ctx, branchId, tipo);
  }

  /**
   * Núcleo da verificação, já a partir de um contexto resolvido.
   * Separado para que postarConferenciaPorLote possa reaproveitar o contexto
   * (unit_business é a mesma para o lote inteiro) sem re-buscar a junção.
   */
  private async montarVerificacao(
    ctx: TCarConferenciaContexto,
    branchId: number,
    tipo: TCarConferenciaTipo,
  ): Promise<TCarConferenciaVerificacaoResult> {
    const { numero } = ctx;

    if (!notaPertenceAFilial(ctx)) {
      console.warn(
        `[TCarConferenciaPostService] Invoice ignorada — não pertence à filial | invoice=${ctx.invoiceId} | numero=${numero} | type=${ctx.invoiceType} | sender_cnpj=${ctx.senderCnpj} | receiver_cnpj=${ctx.receiverCnpj} | unit_business_cnpj=${ctx.unitBusiness.cnpj}`,
      );
      return {
        numero,
        sincronizado: true,
        itens: [],
        itens_a_conferir: [],
        extraParams: {},
      };
    }

    // ── Resolve extra params da Tecinco (obrigatórios para nota-fiscal) ────────
    let extraParams: Partial<TCarNotaFiscalQueryParams> = {};
    let documento: any;

    try {
      extraParams =
        tipo === "nota-fiscal"
          ? await this.resolveExtraParams(branchId, ctx.numero, ctx.chaveNfe)
          : {};

      documento = await this.conferenciaService.carregarDocumento(
        branchId,
        tipo,
        numero,
        extraParams,
      );
    } catch (err: any) {
      if (err?.response?.status === 404) {
        console.warn(
          `[TCarConferenciaPostService] Nota não encontrada na Tecinco — pulando | invoice=${ctx.invoiceId} | numero=${numero}`,
        );
        return {
          numero,
          sincronizado: true,
          itens: [],
          itens_a_conferir: [],
          extraParams: {},
        };
      }
      // Qualquer outro erro (500, timeout, etc.) continua propagando
      throw err;
    }

    const itensTecinco: Array<{
      seq: number;
      produto_codigo: string;
      qtde_solicitada: number;
      qtde_conferida: number;
    }> = documento?.itens ?? [];
    console.log("[DEBUG] documento raw:", JSON.stringify(documento, null, 2));
    console.log("[DEBUG] itensTecinco:", itensTecinco);

    if (!itensTecinco.length) {
      return {
        numero,
        sincronizado: true,
        itens: [],
        itens_a_conferir: [],
        extraParams,
      };
    }

    // ── Carrega BatchInvoiceItems da junção (escopados por essa invoice) ──────
    const batchInvoiceItems = (await BatchInvoiceItems.findAll({
      where: { expedition_batch_invoice_id: ctx.batchInvoiceId },
      include: [
        {
          model: ExpeditionBatchItems,
          as: "batchItem",
          attributes: ["product_id"],
          required: true,
        },
      ],
    })) as any[];

    // ── Monta mapa product_id → quantity_read a partir dos BatchInvoiceItems ──
    const scannedByProductId = new Map<string, number>();
    for (const bii of batchInvoiceItems) {
      const productId = bii.batchItem?.product_id;
      if (!productId) continue;
      scannedByProductId.set(
        productId,
        (scannedByProductId.get(productId) ?? 0) +
          Number(bii.quantity_read ?? 0),
      );
    }

    // ── Resolve, para cada produto_codigo da Tecinco, o product_id local ──────
    // O produto_codigo retornado pela conferência (epctb_codigo) não é salvo
    // localmente — busca na API da Tecinco pra obter codigofabrica/ean e
    // cruzar com o produto local
    const produtoService = new TCarProdutoService();
    const tecincoCodigoParaProductId = new Map<string, string | null>();
    for (const itemTecinco of itensTecinco) {
      await findProductIdByTecincoCodigo(
        itemTecinco.produto_codigo,
        branchId,
        produtoService,
        tecincoCodigoParaProductId,
      );
    }

    console.log("[DEBUG] batchInvoiceItems count:", batchInvoiceItems.length);
    console.log(
      "[DEBUG] scannedByProductId:",
      Object.fromEntries(scannedByProductId),
    );
    console.log(
      "[DEBUG] tecincoCodigoParaProductId:",
      Object.fromEntries(tecincoCodigoParaProductId),
    );

    // ── Compara item a item (usando os itens da Tecinco como referência) ──────
    const itens: TCarConferenciaItemDiff[] = [];
    const itens_a_conferir: Array<{
      seq: number;
      produto_codigo: string;
      qtde_conferida: number;
    }> = [];

    for (const itemTecinco of itensTecinco) {
      const produto_codigo = itemTecinco.produto_codigo;
      const qtde_solicitada = Number(itemTecinco.qtde_solicitada ?? 0);
      const qtde_conferida_tecinco = Number(itemTecinco.qtde_conferida ?? 0);

      const productId = tecincoCodigoParaProductId.get(produto_codigo) ?? null;
      const qtde_scaneada_local = productId
        ? (scannedByProductId.get(productId) ?? 0)
        : 0;
      const nao_encontrado_local = !productId;

      // Divergente = local diferente do que está na Tecinco
      const divergente = qtde_scaneada_local !== qtde_conferida_tecinco;

      itens.push({
        seq: Number(itemTecinco.seq),
        produto_codigo,
        qtde_solicitada,
        qtde_conferida_tecinco,
        qtde_scaneada_local,
        divergente,
        nao_encontrado_local,
      });

      // Só inclui no payload se há diferença E o produto foi encontrado localmente
      if (divergente && !nao_encontrado_local) {
        itens_a_conferir.push({
          seq: Number(itemTecinco.seq),
          produto_codigo,
          qtde_conferida: qtde_scaneada_local,
        });
      }
    }

    const sincronizado = itens_a_conferir.length === 0;

    console.log(
      `[TCarConferenciaPostService] Resultado da verificação | invoice=${ctx.invoiceId} | numero=${numero} | sincronizado=${sincronizado}`,
    );
    console.table(
      itens.map((i) => ({
        seq: i.seq,
        produto_codigo: i.produto_codigo,
        qtde_solicitada: i.qtde_solicitada,
        qtde_conferida_tecinco: i.qtde_conferida_tecinco,
        qtde_scaneada_local: i.qtde_scaneada_local,
        divergente: i.divergente,
        nao_encontrado_local: i.nao_encontrado_local,
      })),
    );
    console.log(
      `[TCarConferenciaPostService] Payload que seria enviado pra Tecinco (itens_a_conferir):`,
      JSON.stringify(itens_a_conferir, null, 2),
    );

    return {
      numero,
      sincronizado,
      itens,
      itens_a_conferir,
      extraParams,
    };
  }

  // ─── Post ─────────────────────────────────────────────────────────────────────

  /**
   * Executa a verificação e, se houver divergências, posta a conferência
   * na Tecinco substituindo as quantidades pelo estado atual do lote local.
   *
   * Não altera nenhuma tabela local — apenas lê e escreve na Tecinco.
   */
  async postarConferencia(
    batchId: string,
    invoiceId: string,
    branchId: number,
    userId: number,
    tipo: TCarConferenciaTipo = "nota-fiscal",
  ): Promise<TCarConferenciaPostResult> {
    const verificacao = await this.verificarConferencia(
      batchId,
      invoiceId,
      branchId,
      tipo,
    );

    const { numero, sincronizado, itens_a_conferir } = verificacao;

    if (sincronizado) {
      console.log(
        `[TCarConferenciaPostService] Conferência já sincronizada | invoice=${invoiceId} | numero=${numero}`,
      );
      return {
        success: true,
        numero,
        itens_enviados: 0,
        resposta_tecinco: null,
      };
    }

    console.log(
      `[TCarConferenciaPostService] Postando conferência | invoice=${invoiceId} | numero=${numero} | itens=${itens_a_conferir.length}`,
    );

    const resposta = await this.conferenciaService.conferir(
      branchId,
      tipo,
      numero,
      {
        usuario_id: "1",
        itens: itens_a_conferir,
      },
      verificacao.extraParams,
    );

    console.log(
      `[TCarConferenciaPostService] Conferência postada | invoice=${invoiceId} | numero=${numero} | resposta=`,
      resposta,
    );

    return {
      success: true,
      numero,
      itens_enviados: itens_a_conferir.length,
      resposta_tecinco: resposta,
    };
  }

  // ─── Conveniência: processa todas as invoices de um lote ──────────────────────

  /**
   * Itera sobre todas as invoices do lote e posta a conferência para cada uma.
   *
   * Estratégia two-phase:
   *   Fase 1 — verifica todas as invoices (sem escrever nada).
   *   Fase 2 — posta em sequência; erro em qualquer post interrompe as demais.
   */
  async postarConferenciaPorLote(
    batchId: string,
    branchId: number,
    userId: number,
    tipo: TCarConferenciaTipo = "nota-fiscal",
  ): Promise<TCarConferenciaPostResult[]> {
    console.log("ENVIANDO CONFERENCIA PARA TECINCO");
    console.log("USER", userId);

    const batchInvoices = (await ExpeditionBatchInvoice.findAll({
      where: { expedition_batch_id: batchId },
      include: [
        {
          model: Invoice,
          as: "invoice",
          attributes: [
            "id",
            "number_system",
            "sender_cnpj",
            "receiver_cnpj",
            "xml_key",
          ],
          required: true,
        },
        {
          model: ExpeditionBatch,
          as: "batch",
          required: true,
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
              required: true,
            },
          ],
        },
      ],
    })) as any[];

    if (!batchInvoices.length) {
      throw new Error(
        `[TCarConferenciaPostService] Nenhuma invoice encontrada para o lote ${batchId}`,
      );
    }

    // ── Fase 1: verifica todas antes de postar qualquer uma ───────────────────
    const verificacoes: Array<{
      invoiceId: string;
      verificacao: TCarConferenciaVerificacaoResult;
    }> = [];

    for (const batchInvoice of batchInvoices) {
      const invoice = batchInvoice.invoice;
      const unitBusiness = batchInvoice.batch.unitBusiness;

      const attrs = await InvoiceUnitBusinessAttributes.findOne({
        where: { invoice_id: invoice.id, unit_business_id: unitBusiness.id },
        attributes: ["type"],
      });

      const ctx: TCarConferenciaContexto = {
        batchInvoiceId: batchInvoice.id,
        invoiceId: invoice.id,
        numero: invoice.number_system,
        chaveNfe: invoice.xml_key ?? null,
        senderCnpj: invoice.sender_cnpj,
        receiverCnpj: invoice.receiver_cnpj,
        invoiceType:
          (attrs?.type as "INCOMING" | "OUTGOING" | undefined) ?? null,
        unitBusiness: {
          id: unitBusiness.id,
          cnpj: unitBusiness.cnpj,
          number: unitBusiness.number,
        },
      };

      const verificacao = await this.montarVerificacao(ctx, branchId, tipo);
      verificacoes.push({ invoiceId: invoice.id, verificacao });
    }

    // ── Fase 2: posta em sequência ────────────────────────────────────────────
    const results: TCarConferenciaPostResult[] = [];

    for (const { invoiceId, verificacao } of verificacoes) {
      const { numero, sincronizado, itens_a_conferir } = verificacao;

      if (sincronizado) {
        console.log(
          `[TCarConferenciaPostService] Já sincronizado | invoice=${invoiceId} | numero=${numero}`,
        );
        results.push({
          success: true,
          numero,
          itens_enviados: 0,
          resposta_tecinco: null,
        });
        continue;
      }

      // Lança em caso de erro — interrompe o loop e nenhuma invoice posterior é postada
      const resposta = await this.conferenciaService.conferir(
        branchId,
        tipo,
        numero,
        { usuario_id: "1", itens: itens_a_conferir },
        verificacao.extraParams,
      );

      console.log(
        `[TCarConferenciaPostService] Conferência postada | invoice=${invoiceId} | numero=${numero} | itens=${itens_a_conferir.length}`,
      );

      results.push({
        success: true,
        numero,
        itens_enviados: itens_a_conferir.length,
        resposta_tecinco: resposta,
      });
    }

    return results;
  }

  private async resolveExtraParams(
    branchId: number,
    numero: string,
    chaveNfe: string | null,
  ): Promise<TCarNotaFiscalQueryParams> {
    if (!chaveNfe) {
      throw new Error(
        `[TCarConferenciaPostService] Invoice sem xml_key — impossível identificar a NF na Tecinco de forma inequívoca | numero=${numero}`,
      );
    }

    const resultado = await this.conferenciaService.getNotaFiscal(
      numero,
      branchId,
      { chave_nfe: chaveNfe },
    );

    const chave = resultado?.data?.chave;

    if (!chave) {
      throw new Error(
        `[TCarConferenciaPostService] NF não encontrada na Tecinco pela chave de acesso | numero=${numero} | chave_nfe=${chaveNfe} | branchId=${branchId}`,
      );
    }

    return {
      CLN_CODIGO: chave.cln_codigo,
      TPNEG_CODIGO: chave.tpneg_codigo,
      NTZ_CODIGO: chave.ntz_codigo,
      OPR_CODIGO: chave.opr_codigo,
      EPENF_SERIE: chave.serie,
    };
  }
}

export default new TCarConferenciaPostService();
