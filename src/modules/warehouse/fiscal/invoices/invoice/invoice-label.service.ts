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
  transportador: string;
  volumeAtual: number;
  volumeTotal: number;
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
}

export class LabelService {

  private async findEanFromInvoiceItems(invoiceId: string, unitBusinessId: string): Promise<Map<number, string>> {
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

  const eanMap = new Map<number, string>();
  items.forEach((item, index) => {
    const product = (item as any).product as (Product & { productConfigs?: ProductConfig[] }) | undefined;
    const config = product?.productConfigs?.[0];
    const ean = config?.gtin || config?.gtin_package || '';
    if (ean) eanMap.set(index, ean);
  });

  return eanMap;
}
  /**
   * Busca os dados para etiquetas utilizando Sequelize
   */
  async getLabelData(invoiceIds: string[], unitBusinessId: string): Promise<LabelData[]> {
  const invoices = await (Invoice as any).findAll({
    where: { id: { [Op.in]: invoiceIds } },
    include: ["transporter"],
  });

  const CONCURRENCY = 10;
  const result: LabelData[] = [];

  for (let i = 0; i < invoices.length; i += CONCURRENCY) {
    const batch = invoices.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.allSettled(
      batch.map(async (invoice: any) => {
        try {
          const parsed = await this.extractFromXml(invoice, unitBusinessId);
          await invoice.update({ printed_label: true });
          return parsed;
        } catch (err) {
          console.error(`Erro ao gerar etiqueta da invoice ${invoice.id}`, err);
          await invoice.update({ label_error: true });
          return null;
        }
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) result.push(r.value);
    }
  }

  return result;
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

// Pré-carrega EANs do cadastro para usar como fallback
const eanFallbackMap = await this.findEanFromInvoiceItems(invoiceId, unitBusinessId);

let somaQtd = 0;
const produtos: string[] = [];
const productVolumes: LabelProductVolume[] = [];
let ean = "";

for (let idx = 0; idx < itens.length; idx++) {
  const det = itens[idx];
  const prod = det.prod ?? {};
  const qtd = parseFloat(String(prod.qCom ?? prod.qTrib ?? 1));
  somaQtd += qtd;

  const desc = String(prod.xProd ?? "");
  if (desc && desc !== "***" && !produtos.includes(desc))
    produtos.push(desc);

  let itemEan = "";
  const cEAN = String(prod.cEAN ?? prod.cEANTrib ?? "");
  if (cEAN && cEAN !== "SEM GTIN" && /^\d{8,14}$/.test(cEAN)) {
    itemEan = cEAN;
  } else {
    // Fallback: busca pelo índice do item no cadastro
    itemEan = eanFallbackMap.get(idx) ?? "";
  }

  if (itemEan && !ean) ean = itemEan;

  const labelQuantity = Math.max(0, Math.round(qtd));
  for (let i = 0; i < labelQuantity; i++) {
    productVolumes.push({
      produtos: desc && desc !== "***" ? [desc] : [],
      ean: itemEan,
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
      ean,
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
      const ean = productVolume?.ean || params.ean;
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
        volumeAtual: va,
        codigoBarras,
      });
    }
    return volumes;
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
      String(va).padStart(3, "0") +
      String(vt).padStart(3, "0")
    );
  }
}
