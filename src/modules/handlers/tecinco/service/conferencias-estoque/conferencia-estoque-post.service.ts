import { Op } from "sequelize";
import Invoice from "../../../../warehouse/entrance/invoice/invoice.model";
import InvoiceItems from "../../../../warehouse/entrance/invoice-items/invoice-items.model";
import ExpeditionBatch from "../../../../warehouse/expedition/batch/batch.model";
import ExpeditionBatchInvoice from "../../../../warehouse/expedition/batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../../../../warehouse/expedition/batch-items/batch-items.model";
import {
  // TCarConferenciaEstoqueService,
  TCarConferenciaTipo,
  TCarNotaFiscalQueryParams,
} from "../../../../../modules/handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service";
import { Product, ProductConfig, SupplierMapping } from "../../../../inventory";
import { TCarConferenciaEstoqueService } from "./conferencias-estoque.service";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export interface TCarConferenciaUnitBusiness {
  id: string;
  cnpj: string;
  /** Número da filial (ex: "01"), usado para determinar o branchId se necessário */
  number?: string;
}

/**
 * Resultado da comparação entre o estado local (ExpeditionBatchItems)
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
  /** Quantidade scaneada localmente (quantity_scanned do BatchItem) */
  qtde_scaneada_local: number;
  /**
   * true  → há diferença entre o que temos localmente e o que está na Tecinco
   * false → já estão em sincronia
   */
  divergente: boolean;
  /**
   * true  → SKU local não encontrado no ProductConfig/EAN para este produto
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

// ─── Helpers internos ──────────────────────────────────────────────────────────

/**
 * Dado um product_id local, resolve o SKU que a Tecinco conhece para ele.
 * Ordem: ProductConfig da unidade → EAN do produto como fallback.
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

// ─── Service ───────────────────────────────────────────────────────────────────

export class TCarConferenciaPostService {
  private readonly conferenciaService: TCarConferenciaEstoqueService;

  constructor() {
    this.conferenciaService = new TCarConferenciaEstoqueService();
  }

  // ─── Verificação ─────────────────────────────────────────────────────────────

  /**
   * Lê o estado atual da conferência na Tecinco e compara com os
   * ExpeditionBatchItems do lote local.
   *
   * A comparação é feita do lado local para o remoto:
   * para cada BatchItem do lote, resolve o SKU via ProductConfig/EAN
   * e cruza com o que a Tecinco retornou no carregarDocumento.
   *
   * Não escreve nada — apenas retorna o diff para que o caller decida
   * se deve prosseguir com o post.
   */
  async verificarConferencia(
    batchId: string,
    invoiceId: string,
    unitBusiness: TCarConferenciaUnitBusiness,
    branchId: number,
    tipo: TCarConferenciaTipo = "nota-fiscal",
  ): Promise<TCarConferenciaVerificacaoResult> {
    const invoice = await Invoice.findByPk(invoiceId, {
      attributes: ["id", "number_system"],
    });

    if (!invoice) {
      throw new Error(
        `[TCarConferenciaPostService] Invoice não encontrada: ${invoiceId}`,
      );
    }

    const numero = invoice.number_system;

    if (!numero) {
      throw new Error(
        `[TCarConferenciaPostService] Invoice ${invoiceId} sem number_system`,
      );
    }

    // ── Resolve extra params da Tecinco (obrigatórios para nota-fiscal) ────────
    const extraParams =
      tipo === "nota-fiscal"
        ? await this.resolveExtraParams(branchId, numero)
        : {};

    const documento = await this.conferenciaService.carregarDocumento(
      branchId,
      tipo,
      numero,
      extraParams,
    );

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

    // ── 3. Carrega BatchItems do lote ─────────────────────────────────────────
    const batchItems = await ExpeditionBatchItems.findAll({
      where: { expedition_batch_id: batchId },
    });

    // ── 4. Monta mapa SKU → quantity_scanned a partir dos BatchItems ──────────
    // Resolve o SKU de cada BatchItem via ProductConfig da unidade / EAN.
    const scannedBySku = new Map<string, number>();
    const tecincoCodigosValidos = new Set(
      itensTecinco.map((i) => i.produto_codigo),
    );

    for (const bi of batchItems) {
      const sku = await findSkuByProductId(
        bi.product_id,
        unitBusiness.id,
        tecincoCodigosValidos,
      );
      if (!sku) {
        console.warn(
          `[TCarConferenciaPostService] Código Tecinco não resolvido | product_id=${bi.product_id} | unit_business=${unitBusiness.id}`,
        );
        continue;
      }
      scannedBySku.set(sku, (scannedBySku.get(sku) ?? 0) + bi.quantity_scanned);
    }
    console.log("[DEBUG] batchItems count:", batchItems.length);
    console.log("[DEBUG] scannedBySku:", Object.fromEntries(scannedBySku));
    console.log("[DEBUG] tecincoCodigosValidos:", [...tecincoCodigosValidos]);

    // ── 5. Compara item a item (usando os itens da Tecinco como referência) ───
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

      const qtde_scaneada_local = scannedBySku.get(produto_codigo) ?? 0;
      const nao_encontrado_local = !scannedBySku.has(produto_codigo);

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
    unitBusiness: TCarConferenciaUnitBusiness,
    branchId: number,
    userId: number,
    tipo: TCarConferenciaTipo = "nota-fiscal",
  ): Promise<TCarConferenciaPostResult> {
    const verificacao = await this.verificarConferencia(
      batchId,
      invoiceId,
      unitBusiness,
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
        usuario_id: userId,
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
    unitBusiness: TCarConferenciaUnitBusiness,
    branchId: number,
    userId: number,
    tipo: TCarConferenciaTipo = "nota-fiscal",
  ): Promise<TCarConferenciaPostResult[]> {
    const batchInvoices = (await ExpeditionBatchInvoice.findAll({
      where: { expedition_batch_id: batchId },
      include: [
        {
          model: Invoice,
          as: "invoice",
          attributes: ["id", "number_system"],
          required: true,
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
      const verificacao = await this.verificarConferencia(
        batchId,
        invoice.id,
        unitBusiness,
        branchId,
        tipo,
      );
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
        { usuario_id: userId, itens: itens_a_conferir },
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
  ): Promise<TCarNotaFiscalQueryParams> {
    const resultado = await this.conferenciaService.listarNotasFiscais(
      branchId,
      {
        nota: numero,
        entrada_saida: "E", // expedição = saída
      },
    );

    const nf = resultado?.data?.[0];

    if (!nf) {
      throw new Error(
        `[TCarConferenciaPostService] NF não encontrada na Tecinco | numero=${numero} | branchId=${branchId}`,
      );
    }

    const chave = nf.chave;

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
