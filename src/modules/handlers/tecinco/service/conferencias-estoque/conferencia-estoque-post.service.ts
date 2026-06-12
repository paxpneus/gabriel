import { Op } from "sequelize";
import Invoice from "../../../../warehouse/entrance/invoice/invoice.model";
import InvoiceItems from "../../../../warehouse/entrance/invoice-items/invoice-items.model";
import ExpeditionBatch from "../../../../warehouse/expedition/batch/batch.model";
import ExpeditionBatchInvoice from "../../../../warehouse/expedition/batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../../../../warehouse/expedition/batch-items/batch-items.model";
import {
  TCarConferenciaEstoqueService,
  TCarConferenciaTipo,
} from "../../../../../modules/handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service";
import { Product, ProductConfig, SupplierMapping } from "../../../../inventory";

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
   * true  → produto não foi encontrado nos BatchItems do lote
   *          (pode ser produto não mapeado ou fora do lote)
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
}

export interface TCarConferenciaPostResult {
  success: boolean;
  numero: string;
  itens_enviados: number;
  resposta_tecinco: unknown;
}

// ─── Helpers internos ──────────────────────────────────────────────────────────

/**
 * Resolve o produto interno a partir do SKU da Tecinco.
 * Ordem: ProductConfig (SKU) → Product (EAN direto) → SupplierMapping.
 */
async function resolveProductBySku(
  sku: string,
  unitBusinessId: string,
  supplierCnpj: string | null,
): Promise<Product | null> {
  // 1. SKU via ProductConfig na unidade de negócio informada
  const config = await ProductConfig.findOne({
    where: { sku, unit_business_id: unitBusinessId },
  });
  if (config) {
    const product = await Product.findByPk(config.product_id);
    if (product) return product;
  }

  // 2. EAN direto no produto (caso o SKU seja o próprio EAN)
  const byEan = await Product.findOne({
    where: { [Op.or]: [{ ean: sku }, { ean_tribut: sku }] },
  });
  if (byEan) return byEan;

  // 3. SupplierMapping com CNPJ do fornecedor/filial Tecinco
  if (supplierCnpj) {
    const mapping = await SupplierMapping.findOne({
      where: { supplier_product_code: sku, supplier_cnpj: supplierCnpj },
      order: [["updatedAt", "DESC"]],
    });
    if (mapping) {
      const product = await Product.findByPk(mapping.product_id);
      if (product) return product;
    }
  }

  // 4. SupplierMapping sem filtro de CNPJ (último recurso)
  const mappingAny = await SupplierMapping.findOne({
    where: { supplier_product_code: sku },
    order: [["updatedAt", "DESC"]],
  });
  if (mappingAny) {
    return Product.findByPk(mappingAny.product_id);
  }

  return null;
}

/**
 * Dado um product_id, retorna o SKU que a Tecinco conhece para ele
 * (ProductConfig da unidade ou ean do produto como fallback).
 * Usado apenas para log/debug — o `produto_codigo` no body do conferir
 * sempre vem direto do carregarDocumento da Tecinco.
 */
async function resolveSkuForProduct(
  productId: string,
  unitBusinessId: string,
): Promise<string | null> {
  const config = await ProductConfig.findOne({
    where: { product_id: productId, unit_business_id: unitBusinessId },
  });
  if (config?.sku) return config.sku;

  const product = await Product.findByPk(productId, {
    attributes: ["ean"],
  });
  return product?.ean ?? null;
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
    // ── 1. Carrega a Invoice ──────────────────────────────────────────────────
    const invoice = await Invoice.findByPk(invoiceId, {
      attributes: ["id", "number_system", "sender_cnpj", "receiver_cnpj"],
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

    // ── 2. Carrega documento na Tecinco ───────────────────────────────────────
    const documento = await this.conferenciaService.carregarDocumento(
      branchId,
      tipo,
      numero,
    );

    const itensTecinco: Array<{
      seq: number;
      produto_codigo: string;
      qtde_solicitada: number;
      qtde_conferida: number;
    }> = documento?.itens ?? [];

    if (!itensTecinco.length) {
      return {
        numero,
        sincronizado: true,
        itens: [],
        itens_a_conferir: [],
      };
    }

    // ── 3. Carrega BatchItems do lote agrupados por product_id ────────────────
    const batchItems = await ExpeditionBatchItems.findAll({
      where: { expedition_batch_id: batchId },
      include: [{ model: Product, as: "product" }],
    });

    // Mapa product_id → quantity_scanned para lookup rápido
    const scannedByProductId = new Map<string, number>(
      batchItems.map((bi) => [bi.product_id, bi.quantity_scanned]),
    );

    // ── 4. Resolve supplier CNPJ para lookup via SupplierMapping ─────────────
    // Usa o sender_cnpj da invoice quando é INCOMING (fornecedor externo),
    // ou o cnpj da UnitBusiness quando é OUTGOING (saída própria).
    const supplierCnpj =
      invoice.sender_cnpj?.replace(/\D/g, "") ??
      unitBusiness.cnpj.replace(/\D/g, "");

    // ── 5. Compara item a item ────────────────────────────────────────────────
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

      // Resolve produto interno pelo SKU da Tecinco
      const product = await resolveProductBySku(
        produto_codigo,
        unitBusiness.id,
        supplierCnpj,
      );

      let qtde_scaneada_local = 0;
      let nao_encontrado_local = false;

      if (!product) {
        nao_encontrado_local = true;
        console.warn(
          `[TCarConferenciaPostService] Produto não resolvido | sku=${produto_codigo} | invoice=${invoiceId}`,
        );
      } else {
        qtde_scaneada_local = scannedByProductId.get(product.id) ?? 0;
      }

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

      // Só inclui no payload de conferir se há diferença E produto foi encontrado
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
   * Erros em invoices individuais são logados mas não interrompem as demais.
   */
 async postarConferenciaPorLote(
  batchId: string,
  unitBusiness: TCarConferenciaUnitBusiness,
  branchId: number,
  userId: number,
  tipo: TCarConferenciaTipo = "nota-fiscal",
): Promise<TCarConferenciaPostResult[]> {
  const batchInvoices = await ExpeditionBatchInvoice.findAll({
    where: { expedition_batch_id: batchId },
    include: [
      {
        model: Invoice,
        as: "invoice",
        attributes: ["id", "number_system"],
        required: true,
      },
    ],
  }) as any[];

  if (!batchInvoices.length) {
    throw new Error(
      `[TCarConferenciaPostService] Nenhuma invoice encontrada para o lote ${batchId}`,
    );
  }

  // ── 1. Verifica todas antes de postar qualquer uma ──────────────────────────
  // Se qualquer verificação falhar, lança imediatamente sem ter postado nada.
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

  // ── 2. Posta todas — se qualquer post falhar, lança e nada mais é enviado ───
  // Como a Tecinco não tem transação distribuída, a estratégia é:
  // verificar tudo primeiro (fase 1) e só então postar em sequência (fase 2).
  // Se um post falhar no meio, os anteriores já foram — mas ao menos garantimos
  // que nunca enviamos uma conferência parcial por erro de validação local.
  const results: TCarConferenciaPostResult[] = [];

  for (const { invoiceId, verificacao } of verificacoes) {
    const { numero, sincronizado, itens_a_conferir } = verificacao;

    if (sincronizado) {
      console.log(
        `[TCarConferenciaPostService] Já sincronizado | invoice=${invoiceId} | numero=${numero}`,
      );
      results.push({ success: true, numero, itens_enviados: 0, resposta_tecinco: null });
      continue;
    }

    // Lança em caso de erro — interrompe o loop e nenhuma invoice posterior é postada
    const resposta = await this.conferenciaService.conferir(
      branchId,
      tipo,
      numero,
      { usuario_id: userId, itens: itens_a_conferir },
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
}

export default new TCarConferenciaPostService();