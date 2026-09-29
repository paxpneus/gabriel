// src/modules/invoices/label.service.ts
import { parseStringPromise } from "xml2js";
import * as fs from "fs/promises";
import * as path from "path";
import { Op } from "sequelize";
import Invoice from "./invoice.model";
import { decryptXml, isEncrypted } from "../../../../../shared/utils/xml/xml-cipher";
import Transporter from "../../../transporter/transporter.model";
import {  InvoiceWithTransporter } from "./invoice.types";
import CarrierLabelRange from "../../../transporter/carrier-label-ranges/carrier-label-ranges.model";
import InvoiceItems from "../invoice-items/invoice-items.model";
import { Product, ProductConfig } from "../../../../inventory";
import supplierMappingService from "../../../../inventory/supplier-mapping/supplier-mapping.service";

// Importe seus modelos e a instância do sequelize se necessário
// import { Invoice } from '../../database/models/Invoice';

export interface LabelVolume {
  invoiceId: string;
  numero: string;
  serie: string;
  chaveAcesso: string;
  valorNota: number;
  dataEmissao: string;
  destNome: string;
  destEndereco: string;
  destNumero: string;
  destMunicipio: string;
  destUF: string;
  destCEP: string;
  produtos: string[];
  ean: string;
  productId: string;
  transportador: string;
  volumeAtual: number;
  volumeTotal: number;
  volNumber: string;
  codigoBarras: string;
   routeAcronym: string | null;
   destination: string | null;
  routeCode: string | null;
  observation: string | null;
}

export interface LabelData {
  invoiceId: string;
  numero: string;
  volumes: LabelVolume[];
  cnpjEmit: string;
}

interface LabelProductVolume {
  produtos: string[];
  ean: string;
  productId: string;
}

// Payload público de /invoice/labels/data (paginado) — só os campos que o
// front realmente usa pra imprimir a etiqueta, sem os campos de uso interno
// (productId, volNumber, destination, cnpjEmit) de LabelVolume/LabelData.
export interface LabelVolumeDTO {
  volumeAtual: number;
  ean: string;
  produtos: string[];
  codigoBarras: string;
}

export interface LabelDataDTO {
  invoiceId: string;
  numero: string;
  serie: string;
  chaveAcesso: string;
  valorNota: number;
  dataEmissao: string;
  destNome: string;
  destEndereco: string;
  destNumero: string;
  destMunicipio: string;
  destUF: string;
  destCEP: string;
  transportador: string;
  volumeTotal: number;
  routeAcronym: string | null;
  routeCode: string | null;
  observation: string | null;
  volumes: LabelVolumeDTO[];
}

// Posição de retomada: índice da nota dentro do invoiceIds da request +
// offset de volume já entregue dentro dela. Não existe volumeTotal em banco
// (só é conhecido depois de parsear o XML da nota), então não dá pra usar um
// cursor de banco — é posicional e stateless.
interface LabelCursor {
  invoiceIndex: number;
  volumeOffset: number;
}

export class LabelService {

  private async findItemMetaFromInvoiceItems(
    invoiceId: string,
    unitBusinessId: string,
  ): Promise<{
    byIndex: Map<number, { ean: string; productId: string }>;
    byGtin: Map<string, string>;
    bySku: Map<string, string>;
  }> {
  const items = await InvoiceItems.findAll({
    where: { invoice_id: invoiceId },
    include: [
      {
        model: Product,
        as: 'product',
        include: [
          {
            model: ProductConfig,
            as: 'productConfigs',
            required: false,
            where: { unit_business_id: unitBusinessId },
          },
        ],
      },
    ],
    order: [['createdAt', 'ASC']],
  });

  const byIndex = new Map<number, { ean: string; productId: string }>();
  const byGtin = new Map<string, string>();
  const bySku = new Map<string, string>();
  items.forEach((item, index) => {
    const product = (item as any).product as (Product & { productConfigs?: ProductConfig[] }) | undefined;
    const config = product?.productConfigs?.[0];
    const ean = config?.gtin || '';
    const sku = config?.sku || '';
    const productId = (item as any).product_id;
    byIndex.set(index, { ean, productId });
    if (ean) byGtin.set(ean, productId);
    if (sku) bySku.set(sku, productId);
  });

  return { byIndex, byGtin, bySku };
}
  private encodeCursor(pos: LabelCursor): string {
    return Buffer.from(JSON.stringify({ i: pos.invoiceIndex, v: pos.volumeOffset })).toString('base64');
  }

  private decodeCursor(cursor?: string): LabelCursor {
    if (!cursor) return { invoiceIndex: 0, volumeOffset: 0 };
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
      return {
        invoiceIndex: Number(parsed.i) || 0,
        volumeOffset: Number(parsed.v) || 0,
      };
    } catch {
      return { invoiceIndex: 0, volumeOffset: 0 };
    }
  }

  private toVolumeDTO(volume: LabelVolume): LabelVolumeDTO {
    return {
      volumeAtual: volume.volumeAtual,
      ean: volume.ean,
      produtos: volume.produtos,
      codigoBarras: volume.codigoBarras,
    };
  }

  private toLabelDataDTO(labelData: LabelData, pageVolumes: LabelVolume[]): LabelDataDTO {
    const first = pageVolumes[0];
    return {
      invoiceId: labelData.invoiceId,
      numero: labelData.numero,
      serie: first.serie,
      chaveAcesso: first.chaveAcesso,
      valorNota: first.valorNota,
      dataEmissao: first.dataEmissao,
      destNome: first.destNome,
      destEndereco: first.destEndereco,
      destNumero: first.destNumero,
      destMunicipio: first.destMunicipio,
      destUF: first.destUF,
      destCEP: first.destCEP,
      transportador: first.transportador,
      volumeTotal: first.volumeTotal,
      routeAcronym: first.routeAcronym,
      routeCode: first.routeCode,
      observation: first.observation,
      volumes: pageVolumes.map((v) => this.toVolumeDTO(v)),
    };
  }

  /**
   * Soma leve de qCom/qTrib por nota (sem montar destinatário/EAN/carrier
   * range) — usada só pra responder totalVolumes na 1ª página.
   */
  private async countVolumesFromXml(xml: string): Promise<number> {
    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: false,
    });
    const nfe = parsed.nfeProc?.NFe ?? parsed["nfeProc:NFe"]?.NFe ?? parsed.NFe;
    const infNFe = nfe?.infNFe;
    if (!infNFe) return 0;

    let itens = infNFe.det ?? [];
    if (!Array.isArray(itens)) itens = [itens];

    let somaQtd = 0;
    for (const det of itens) {
      const prod = det.prod ?? {};
      somaQtd += parseFloat(String(prod.qCom ?? prod.qTrib ?? 1));
    }
    return Math.max(1, Math.round(somaQtd));
  }

  async countVolumesForInvoices(invoiceIds: string[]): Promise<number> {
    const invoices = await (Invoice as any).findAll({
      where: { id: { [Op.in]: invoiceIds } },
      attributes: ['id', 'xml_path'],
    });

    const CONCURRENCY = 10;
    let total = 0;

    for (let i = 0; i < invoices.length; i += CONCURRENCY) {
      const batch = invoices.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (invoice: any) => {
          let xml: string = invoice.xml_path ?? '';
          if (isEncrypted(xml)) xml = decryptXml(xml);
          return this.countVolumesFromXml(xml);
        }),
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled') total += r.value;
        else console.error('Erro ao contar volumes de uma invoice', r.reason);
      }
    }

    return total;
  }

  /**
   * Página de volumes (não de notas) de /invoice/labels/data. Sem
   * volumeTotal em banco, o cursor é posicional (índice da nota dentro de
   * invoiceIds + offset de volume dentro dela) — cada nota é reparseada do
   * zero sempre que a paginação chega nela, sem cache entre requests.
   */
  async getLabelDataPage(
    invoiceIds: string[],
    unitBusinessId: string,
    opts: { cursor?: string; limit: number },
  ): Promise<{ data: LabelDataDTO[]; nextCursor?: string; totalVolumes?: number }> {
    const { invoiceIndex: startIndex, volumeOffset: startOffset } = this.decodeCursor(opts.cursor);

    const totalVolumes =
      startIndex === 0 && startOffset === 0
        ? await this.countVolumesForInvoices(invoiceIds)
        : undefined;

    const invoices = await (Invoice as any).findAll({
      where: { id: { [Op.in]: invoiceIds } },
      include: ['transporter'],
    });
    const invoiceById = new Map<string, any>(invoices.map((inv: any) => [inv.id, inv]));

    const data: LabelDataDTO[] = [];
    let remaining = opts.limit;
    let index = startIndex;
    let offset = startOffset;

    while (index < invoiceIds.length && remaining > 0) {
      const invoice = invoiceById.get(invoiceIds[index]);
      if (!invoice) {
        index += 1;
        offset = 0;
        continue;
      }

      let labelData: LabelData;
      try {
        labelData = await this.extractFromXml(invoice, unitBusinessId);
      } catch (err) {
        console.error(`Erro ao gerar etiqueta da invoice ${invoice.id}`, err);
        const update: Record<string, boolean> = { label_error: true };
        if (!invoice.printed_label) update.printed_label = false;
        await invoice.update(update);
        index += 1;
        offset = 0;
        continue;
      }

      const sliceEnd = Math.min(labelData.volumes.length, offset + remaining);
      const pageVolumes = labelData.volumes.slice(offset, sliceEnd);

      if (pageVolumes.length) {
        data.push(this.toLabelDataDTO(labelData, pageVolumes));
      }

      remaining -= pageVolumes.length;

      if (sliceEnd >= labelData.volumes.length) {
        await invoice.update({ printed_label: true });
        index += 1;
        offset = 0;
      } else {
        offset = sliceEnd;
      }
    }

    const nextCursor =
      index < invoiceIds.length ? this.encodeCursor({ invoiceIndex: index, volumeOffset: offset }) : undefined;

    return { data, nextCursor, totalVolumes };
  }

private async findCarrierRange(
  transporter_id: string,
  cep: string
): Promise<CarrierLabelRange | null> {
  const cleanedCep = cep.replace(/\D/g, '').padStart(8, '0')

  const range = await CarrierLabelRange.findOne({
    where: {
      transporter_id,
      active: true,
      cep_start: { [Op.lte]: cleanedCep },
      cep_end:   { [Op.gte]: cleanedCep },
    },
  })

  return range
}



  private async extractFromXml(invoice: any, unitBusinessId: string): Promise<LabelData> {
  let xmlPath: string = invoice.xml_path ?? '';


   if (isEncrypted(xmlPath)) {

      xmlPath = decryptXml(xmlPath)

  }

    return await this.parseNFeXml(invoice.id, xmlPath, invoice.transporter_id, unitBusinessId);

}

  private async parseNFeXml(
    invoiceId: string,
    xml: string,
    transporter_id: string,
    unitBusinessId: string,
  ): Promise<LabelData> {
    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: false,
    });

    const invoiceFallBack = await Invoice.findByPk(invoiceId, {
      include: [
        {
          model: Transporter,
          as: 'transporter'
        }
      ]
    }) as InvoiceWithTransporter | null;
    // Suporta nfeProc/NFe/infNFe ou direto
    const nfe = parsed.nfeProc?.NFe ?? parsed["nfeProc:NFe"]?.NFe ?? parsed.NFe;

    if (!nfe) throw new Error("Tag <NFe> não encontrada");

    const infNFe = nfe.infNFe;
    if (!infNFe) throw new Error("Tag <infNFe> não encontrada");

    // ── Chave de acesso ──────────────────────────────────────────────────────
    // O atributo Id fica em infNFe.$?.Id (ex: "NFe31260402316749002111...")
    const rawId: string = infNFe?.$ ? (infNFe.$["Id"] ?? "") : "";
    const chaveAcesso = rawId.replace(/^NFe/, "").replace(/\D/g, "");

    // ── Campos ide ───────────────────────────────────────────────────────────
    const ide = infNFe.ide ?? {};
    const numero = String(ide.nNF ?? "");
    const serie = String(ide.serie ?? "");
    const dataEmissao = String(ide.dhEmi ?? ide.dEmi ?? "").substring(0, 10);

    // ── Emitente ─────────────────────────────────────────────────────────────
    const emit = infNFe.emit ?? {};
    const cnpjEmit = String(emit.CNPJ ?? "").replace(/\D/g, "");

    // ── Destinatário ─────────────────────────────────────────────────────────
    const dest = infNFe.dest ?? {};
    const endDest = dest.enderDest ?? {};
    const destNome = String(dest.xNome ?? dest.xFant ?? "");
    const destEndereco = String(endDest.xLgr ?? "");
    const destNumero = String(endDest.nro ?? "");
    const destMunicipio = String(endDest.xMun ?? "");
    const destUF = String(endDest.UF ?? "");
    const destCEP = String(endDest.CEP ?? "").replace(/\D/g, "").padStart(8, '0');


    // ── Total ────────────────────────────────────────────────────────────────
    const total = infNFe.total ?? {};
    const icmsTot = total.ICMSTot ?? {};
    const valorNota = parseFloat(String(icmsTot.vNF ?? 0));

    // ── Itens (det) ──────────────────────────────────────────────────────────
    let itens = infNFe.det ?? [];
if (!Array.isArray(itens)) itens = [itens];

// Pré-carrega SKU/EAN + product_id do cadastro (correlação por SKU/GTIN; índice é só fallback quando a nota não traz nenhum dos dois)
const { byIndex: itemMetaByIndex, byGtin: productIdByGtin, bySku: productIdBySku } =
  await this.findItemMetaFromInvoiceItems(invoiceId, unitBusinessId);

let somaQtd = 0;
const produtos: string[] = [];

interface DetMeta {
  desc: string;
  qtd: number;
  sku: string;
  itemEan: string;
  productId: string;
  indexFallbackProductId: string;
}

const detMetas: DetMeta[] = itens.map((det: any, idx: number) => {
  const prod = det.prod ?? {};
  const qtd = parseFloat(String(prod.qCom ?? prod.qTrib ?? 1));
  somaQtd += qtd;

  const desc = String(prod.xProd ?? "");
  if (desc && desc !== "***" && !produtos.includes(desc))
    produtos.push(desc);

  const sku = prod.cProd ? String(prod.cProd).trim() : "";

  const itemMeta = itemMetaByIndex.get(idx);

  let itemEan = "";
  const cEAN = String(prod.cEAN ?? prod.cEANTrib ?? "");
  if (cEAN && cEAN !== "SEM GTIN" && /^\d{8,14}$/.test(cEAN)) {
    itemEan = cEAN;
  } else {
    // Fallback: busca pelo índice do item no cadastro
    itemEan = itemMeta?.ean ?? "";
  }

  // Correlaciona pelo SKU (nosso próprio código na nota) e, na falta dele,
  // pelo GTIN cadastrado — ordem dos itens no XML pode não bater com a ordem
  // de criação das linhas em invoice_items, então índice é só último recurso.
  const productId =
    (sku && productIdBySku.get(sku)) ||
    (itemEan && productIdByGtin.get(itemEan)) ||
    "";

  return { desc, qtd, sku, itemEan, productId, indexFallbackProductId: itemMeta?.productId ?? "" };
});

// SupplierMapping como fallback: o EAN da nota nem sempre bate com o GTIN
// cadastrado no produto (embalagem/código do fornecedor diferente do nosso).
// Roda em lote (Promise.all) pra não gerar N+1 — só pros itens ainda sem match.
const unresolvedCodes = new Set<string>();
for (const m of detMetas) {
  if (!m.productId) {
    if (m.itemEan) unresolvedCodes.add(m.itemEan);
    if (m.sku) unresolvedCodes.add(m.sku);
  }
}

if (unresolvedCodes.size) {
  const supplierMappingByCode = new Map<string, string>();
  const lookups = await Promise.all(
    Array.from(unresolvedCodes).map(async (code) => {
      const mapping = await supplierMappingService
        .findByProductCode(code, unitBusinessId)
        .catch(() => null);
      return mapping ? ([code, mapping.product.id] as const) : null;
    }),
  );
  for (const entry of lookups) {
    if (entry) supplierMappingByCode.set(entry[0], entry[1]);
  }

  for (const m of detMetas) {
    if (!m.productId) {
      m.productId =
        (m.itemEan && supplierMappingByCode.get(m.itemEan)) ||
        (m.sku && supplierMappingByCode.get(m.sku)) ||
        "";
    }
  }
}

const productVolumes: LabelProductVolume[] = [];
for (const m of detMetas) {
  const productId = m.productId || m.indexFallbackProductId;
  const labelQuantity = Math.max(0, Math.round(m.qtd));
  for (let i = 0; i < labelQuantity; i++) {
    productVolumes.push({
      produtos: m.desc && m.desc !== "***" ? [m.desc] : [],
      ean: m.itemEan,
      productId,
    });
  }
}

    // ── Transporte ───────────────────────────────────────────────────────────
    const transp = infNFe.transp ?? {};
    const transportador = String(
      transp.transporta?.xNome ?? invoiceFallBack?.transporter?.name ?? "",
    );

    const volumeTotal = Math.max(1, Math.round(somaQtd));

    let routeAcronym: string | null = null
  let routeCode: string | null = null
  let observation: string | null = null
  let destination: string | null = null

  if (transporter_id && destCEP) {
    console.log(destCEP)
    const range = await this.findCarrierRange(transporter_id, destCEP)
    if (range) {
      routeAcronym = range.route_acronym ?? null
      routeCode    = range.route_code    ?? null
      observation  = (range.metadata as any)?.observation ?? null
      destination = range.destination ?? null
    }
  }

    const volumes = this.buildVolumes({
      invoiceId,
      numero,
      serie,
      chaveAcesso,
      valorNota,
      dataEmissao,
      destNome,
      destEndereco,
      destNumero,
      destMunicipio,
      destUF,
      destCEP,
      produtos,
      productVolumes,
      transportador,
      volumeTotal,
      cnpjEmit,
      routeAcronym,   
      destination,
    routeCode,
    observation,
    });

    return { invoiceId, numero, volumes, cnpjEmit };
  }

  private buildVolumes(params: any): LabelVolume[] {
    const volumes: LabelVolume[] = [];
    for (let va = 1; va <= params.volumeTotal; va++) {
      const productVolume: LabelProductVolume | undefined =
        params.productVolumes?.[va - 1];
      const produtos = productVolume?.produtos?.length
        ? productVolume.produtos
        : params.produtos;
      const ean = productVolume?.ean ?? "";
      const codigoBarras = this.buildBarcode(
        params.cnpjEmit,
        params.numero,
        ean,
        va,
        params.volumeTotal,
      );

      volumes.push({
        ...params,
        produtos,
        ean,
        productId: productVolume?.productId ?? "",
        volumeAtual: va,
        volNumber: this.buildVolNumber(va, params.volumeTotal),
        codigoBarras,
      });
    }
    return volumes;
  }

  private buildVolNumber(va: number, vt: number): string {
    return String(va).padStart(3, "0") + String(vt).padStart(3, "0");
  }

  private buildBarcode(
    cnpj: string,
    nf: string,
    ean: string,
    va: number,
    vt: number,
  ): string {
    const pad = (s: string, n: number) =>
      String(s || "")
        .replace(/\D/g, "")
        .padStart(n, "0")
        .slice(-n);
    return (
      pad(cnpj, 14) +
      pad(nf, 8) +
      pad(ean, 13) +
      this.buildVolNumber(va, vt)
    );
  }

  /**
   * Volumes da etiqueta de uma nota, sem efeitos colaterais (não marca printed_label).
   */
  async getInvoiceVolumes(invoiceId: string, unitBusinessId: string): Promise<LabelVolume[]> {
    const invoice = await Invoice.findByPk(invoiceId);
    if (!invoice) throw new Error("Nota fiscal não encontrada");

    const data = await this.extractFromXml(invoice, unitBusinessId);
    return data.volumes;
  }
}

export default new LabelService();
