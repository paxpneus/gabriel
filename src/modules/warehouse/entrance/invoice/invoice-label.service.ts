// src/modules/invoices/label.service.ts
import { parseStringPromise } from "xml2js";
import * as fs from "fs/promises";
import * as path from "path";
import { Op } from "sequelize";
import Invoice from "./invoice.model";
import { decryptXml, isEncrypted } from "../../../../shared/utils/xml/xml-cipher";

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
  let xmlPath: string = invoice.xml_path ?? '';


   if (isEncrypted(xmlPath)) {
 
      xmlPath = decryptXml(xmlPath)
    
  }
  
    return await this.parseNFeXml(invoice.id, xmlPath);
  
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
