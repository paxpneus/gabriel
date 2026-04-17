// src/modules/invoices/label.service.ts
import { parseStringPromise } from "xml2js";
import * as fs from "fs/promises";
import * as path from "path";
import { Op } from "sequelize";
import Invoice from "./invoice.model";

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
}

export interface LabelData {
  invoiceId: string;
  numero: string;
  volumes: LabelVolume[];
  cnpjEmit: string;
}

export class LabelService {
  /**
   * Busca os dados para etiquetas utilizando Sequelize
   */
  async getLabelData(invoiceIds: string[]): Promise<LabelData[]> {
  const invoices = await (Invoice as any).findAll({
    where: { id: { [Op.in]: invoiceIds } },
    include: ["transporter", "unitBusiness"],
  });

  const CONCURRENCY = 10;
  const result: LabelData[] = [];

  for (let i = 0; i < invoices.length; i += CONCURRENCY) {
    const batch = invoices.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.allSettled(
      batch.map(async (invoice: any) => {
        try {
          const parsed = await this.extractFromXml(invoice);
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

  private async extractFromXml(invoice: any): Promise<LabelData> {
  const xmlPath: string = invoice.xml_path ?? '';

  if (!xmlPath) {
    console.warn(`Invoice ${invoice.id}: sem xml_path — usando fallback`);
    return this.buildFromInvoiceFields(invoice);
  }

  // É uma URL HTTP — faz fetch
  if (xmlPath.startsWith('http')) {
    try {
      const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(xmlPath, {signal: controller.signal});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return await this.parseNFeXml(invoice.id, text);
    } catch (err) {
      console.error(`Erro ao baixar XML via URL (${invoice.id}):`, err);
      return this.buildFromInvoiceFields(invoice);
    }
  }

  // É um path no disco
  try {
    const fullPath = path.isAbsolute(xmlPath)
      ? xmlPath
      : path.join(process.cwd(), xmlPath);
    const text = await fs.readFile(fullPath, 'utf-8');
    return await this.parseNFeXml(invoice.id, text);
  } catch (err) {
    console.error(`Erro ao ler arquivo ${xmlPath}:`, err);
    return this.buildFromInvoiceFields(invoice);
  }
}

  private async parseNFeXml(
    invoiceId: string,
    xml: string,
  ): Promise<LabelData> {
    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: false,
    });

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
    const destCEP = String(endDest.CEP ?? "").replace(/\D/g, "");

    // ── Total ────────────────────────────────────────────────────────────────
    const total = infNFe.total ?? {};
    const icmsTot = total.ICMSTot ?? {};
    const valorNota = parseFloat(String(icmsTot.vNF ?? 0));

    // ── Itens (det) ──────────────────────────────────────────────────────────
    let itens = infNFe.det ?? [];
    if (!Array.isArray(itens)) itens = [itens];

    let somaQtd = 0;
    const produtos: string[] = [];
    let ean = "";

    for (const det of itens) {
      const prod = det.prod ?? {};
      somaQtd += parseFloat(String(prod.qCom ?? prod.qTrib ?? 1));

      const desc = String(prod.xProd ?? "");
      if (desc && desc !== "***" && !produtos.includes(desc))
        produtos.push(desc);

      if (!ean) {
        const cEAN = String(prod.cEAN ?? prod.cEANTrib ?? "");
        if (cEAN && cEAN !== "SEM GTIN" && /^\d{8,14}$/.test(cEAN)) ean = cEAN;
      }
    }

    // ── Transporte ───────────────────────────────────────────────────────────
    const transp = infNFe.transp ?? {};
    const transportador = String(
      transp.transporta?.xNome ?? transp.transporta?.CNPJ ?? "",
    );

    const volumeTotal = Math.max(1, Math.round(somaQtd));

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
      transportador,
      volumeTotal,
      cnpjEmit,
    });

    return { invoiceId, numero, volumes, cnpjEmit };
  }

  private buildFromInvoiceFields(invoice: any): LabelData {
  const volumeTotal = Math.max(1, invoice.volume_quantity ?? 1);
  const cnpjEmit = String(invoice.sender_cnpj || '').replace(/\D/g, '');

  const volumes = this.buildVolumes({
    invoiceId:    invoice.id,
    numero:       String(invoice.number_system ?? ''),
    serie:        String(invoice.serie ?? ''),
    chaveAcesso:  String(invoice.key ?? '').replace(/\D/g, ''),
    valorNota:    parseFloat(String(invoice.total_value ?? 0)),
    dataEmissao:  String(invoice.emitted_at ?? '').substring(0, 10),
    destNome:     String(invoice.customer_name ?? ''),
    destEndereco: String(invoice.customer_address ?? ''),
    destNumero:   String(invoice.customer_address_number ?? ''),
    destMunicipio:String(invoice.customer_city ?? ''),
    destUF:       String(invoice.customer_state ?? ''),
    destCEP:      String(invoice.customer_zip ?? '').replace(/\D/g, ''),
    produtos:     invoice.description ? [invoice.description] : [],
    ean:          String(invoice.ean ?? ''),
    transportador:invoice.transporter?.name ?? '',
    volumeTotal,
    cnpjEmit,
  });

  return {
    invoiceId: invoice.id,
    cnpjEmit,
    numero: volumes[0]?.numero ?? '',
    volumes,
  };
}

  private buildVolumes(params: any): LabelVolume[] {
    const volumes: LabelVolume[] = [];
    for (let va = 1; va <= params.volumeTotal; va++) {
      const codigoBarras = this.buildBarcode(
        params.cnpjEmit,
        params.numero,
        params.ean,
        va,
        params.volumeTotal,
      );

      volumes.push({
        ...params,
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
