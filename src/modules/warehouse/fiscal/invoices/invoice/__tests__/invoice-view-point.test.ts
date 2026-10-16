process.env.XML_ENCRYPTION_KEY ??= "ab".repeat(32);

import { resolveInvoiceViewPoint } from "../helpers/view-point";
import { NfeIde } from "../helpers/nfe-ide";

const { readNfeIde } = require("../helpers/nfe-ide") as typeof import("../helpers/nfe-ide");
const { encryptXml } = require("../../../../../../shared/utils/xml/xml-cipher") as typeof import("../../../../../../shared/utils/xml/xml-cipher");

describe("resolveInvoiceViewPoint", () => {
  const STORE_15 = "15000000000115";
  const STORE_16 = "16000000000116";
  const STORE_19 = "19000000000119";
  const STORE_21 = "21000000000121";
  const CUSTOMER = "12345678901";
  const SUPPLIER = "99000000000199";
  const unitBusinessCnpjs = new Set([STORE_15, STORE_16, STORE_19, STORE_21]);
  const viewAs = (viewerCnpj: string) => ({ viewerCnpj, unitBusinessCnpjs });
  const outgoingSale: NfeIde = { operationType: "OUTGOING", purpose: 1 };
  const incomingReturn: NfeIde = { operationType: "INCOMING", purpose: 4 };

  it("saída 15 → 16: transferência; sem direção pra quem não é parte", () => {
    const invoice = { sender_cnpj: STORE_15, receiver_cnpj: STORE_16 };
    expect(resolveInvoiceViewPoint(invoice, outgoingSale, viewAs(STORE_21))).toEqual({ view_point_type: "TRANSFER", view_point_direction: null });
    expect(resolveInvoiceViewPoint(invoice, outgoingSale, viewAs(STORE_15))).toEqual({ view_point_type: "TRANSFER", view_point_direction: "OUTGOING" });
    expect(resolveInvoiceViewPoint(invoice, outgoingSale, viewAs(STORE_16))).toEqual({ view_point_type: "TRANSFER", view_point_direction: "INCOMING" });
  });

  it("entrada emitida pela 19 (devolução de cliente): devolução, entrada pra 19", () => {
    const invoice = { sender_cnpj: STORE_19, receiver_cnpj: CUSTOMER };
    expect(resolveInvoiceViewPoint(invoice, incomingReturn, viewAs(STORE_21))).toEqual({ view_point_type: "RETURN", view_point_direction: null });
    expect(resolveInvoiceViewPoint(invoice, incomingReturn, viewAs(STORE_19))).toEqual({ view_point_type: "RETURN", view_point_direction: "INCOMING" });
  });

  it("entrada emitida pela 19 com destinatário 15: devolução, saída pra 15 (devolução vence transferência)", () => {
    const invoice = { sender_cnpj: STORE_19, receiver_cnpj: STORE_15 };
    expect(resolveInvoiceViewPoint(invoice, incomingReturn, viewAs(STORE_15))).toEqual({ view_point_type: "RETURN", view_point_direction: "OUTGOING" });
    expect(resolveInvoiceViewPoint(invoice, incomingReturn, viewAs(STORE_19))).toEqual({ view_point_type: "RETURN", view_point_direction: "INCOMING" });
  });

  it("saída da 19 pra cliente: venda, saída pra 19", () => {
    const invoice = { sender_cnpj: STORE_19, receiver_cnpj: CUSTOMER };
    expect(resolveInvoiceViewPoint(invoice, outgoingSale, viewAs(STORE_21))).toEqual({ view_point_type: "SALE", view_point_direction: null });
    expect(resolveInvoiceViewPoint(invoice, outgoingSale, viewAs(STORE_19))).toEqual({ view_point_type: "SALE", view_point_direction: "OUTGOING" });
  });

  it("fornecedor → 19: recebimento, entrada pra 19", () => {
    const invoice = { sender_cnpj: SUPPLIER, receiver_cnpj: STORE_19 };
    expect(resolveInvoiceViewPoint(invoice, outgoingSale, viewAs(STORE_21))).toEqual({ view_point_type: "RECEIVING", view_point_direction: null });
    expect(resolveInvoiceViewPoint(invoice, outgoingSale, viewAs(STORE_19))).toEqual({ view_point_type: "RECEIVING", view_point_direction: "INCOMING" });
  });

  it("entrada própria da 19 de terceiro (não devolução): recebimento", () => {
    const invoice = { sender_cnpj: STORE_19, receiver_cnpj: SUPPLIER };
    expect(resolveInvoiceViewPoint(invoice, { operationType: "INCOMING", purpose: 1 }, viewAs(STORE_19))).toEqual({ view_point_type: "RECEIVING", view_point_direction: "INCOMING" });
  });

  it("stub sem XML assume saída", () => {
    const invoice = { sender_cnpj: STORE_19, receiver_cnpj: CUSTOMER };
    expect(resolveInvoiceViewPoint(invoice, null, viewAs(STORE_19))).toEqual({ view_point_type: "SALE", view_point_direction: "OUTGOING" });
  });

  it("sem loja vendo: direção null", () => {
    const invoice = { sender_cnpj: STORE_15, receiver_cnpj: STORE_16 };
    expect(resolveInvoiceViewPoint(invoice, outgoingSale, { viewerCnpj: null, unitBusinessCnpjs })).toEqual({ view_point_type: "TRANSFER", view_point_direction: null });
  });
});

describe("readNfeIde", () => {
  const xml = `<nfeProc><NFe><infNFe Id="NFe1"><ide><tpNF>0</tpNF><finNFe>4</finNFe></ide>${"<det/>".repeat(2000)}</infNFe></NFe></nfeProc>`;
  // Mesmo corte do xmlHeadLiteral (LEFT(xml_path, 33 + 2752)).
  const head = (stored: string) => stored.slice(0, 33 + 2752);

  it("lê tpNF/finNFe só do início do XML cifrado", () => {
    expect(readNfeIde(head(encryptXml(xml)))).toEqual({ operationType: "INCOMING", purpose: 4 });
  });

  it("lê do XML cifrado inteiro (fallback)", () => {
    expect(readNfeIde(encryptXml(xml))).toEqual({ operationType: "INCOMING", purpose: 4 });
  });

  it("<ide> além do trecho = null (vai pro fallback)", () => {
    const late = `<nfeProc>${"<x/>".repeat(1000)}<ide><tpNF>1</tpNF><finNFe>1</finNFe></ide></nfeProc>`;
    expect(readNfeIde(head(encryptXml(late)))).toBeNull();
    expect(readNfeIde(encryptXml(late))).toEqual({ operationType: "OUTGOING", purpose: 1 });
  });

  it("XML legado em texto puro e sem XML", () => {
    expect(readNfeIde(xml)).toEqual({ operationType: "INCOMING", purpose: 4 });
    expect(readNfeIde(null)).toBeNull();
  });
});
